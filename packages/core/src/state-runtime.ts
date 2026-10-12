import { Deferred, Effect, Fiber, Queue, Scope, Stream } from "effect";
import { invokeEffectInput } from "./effect-like.js";
import {
  type StateCommand,
  type StateDefinition,
  type StateDispatchError,
  type StateFailure,
  type StateInstance,
  type StateMessageValue,
  StateDisposed,
  StateRefTypeId,
  type StateRuntimeError,
  type StateTaggedMessage,
} from "./state-contract.js";
import {
  makeStateFailure,
  normalizeStateSubscriptions,
  stateStep,
  validateStateModelSync,
  validateStateMessage,
} from "./state-primitives.js";
import { makeStateRuntimeScheduler } from "./state-runtime-scheduler.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { Signal, SignalWrites } from "./signal.js";
import { readSignalOptimisticBase, writeSignalOptimisticBase } from "./signal-optimistic-layer.js";
import type { TimelineStateCause } from "./timeline.js";
import { batchSignalWrites } from "./signal-transaction.js";

interface QueuedMessage<Message, E> {
  readonly message: StateMessageValue<Message>;
  readonly ack?: Deferred.Deferred<void, StateFailure<Message, E>>;
}

export interface StateRuntimeInstanceOptions<Model, Message extends StateTaggedMessage, E, R, ER> {
  readonly definition: StateDefinition<Model, Message, E, R>;
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly scope:
    | {
        addFinalizer(finalizer: () => Effect.Effect<void>): void;
      }
    | undefined;
}

const completeAck = <Message, E>(
  queued: QueuedMessage<Message, E>,
  failure?: StateFailure<Message, E>,
): Effect.Effect<void> => {
  if (!queued.ack) {
    return Effect.void;
  }

  return failure
    ? Deferred.fail(queued.ack, failure).pipe(Effect.asVoid)
    : Deferred.succeed(queued.ack, undefined).pipe(Effect.asVoid);
};

export const makeStateRuntimeInstance = <
  Model,
  Message extends StateTaggedMessage,
  E = never,
  R = never,
  ER = never,
>(
  options: StateRuntimeInstanceOptions<Model, Message, E, R, ER>,
): StateInstance<Model, Message, StateRuntimeError<E, ER>, StateDispatchError<E, ER>> => {
  const { definition, runtime, scope } = options;
  const initialModel = validateStateModelSync("State.initial", definition.initial);
  const model = SignalWrites.make(initialModel as Model, { name: definition.name });
  const failures = SignalWrites.make<
    ReadonlyArray<StateFailure<Message, StateRuntimeError<E, ER>>>
  >([], { name: `${definition.name}.failures` });
  const queue = Effect.runSync(
    Queue.unbounded<QueuedMessage<Message, StateDispatchError<E, ER>>>(),
  );
  let disposed = false;
  let processorFiber: Fiber.Fiber<void, unknown> | undefined;
  let subscriptionFiber: Fiber.Fiber<void, unknown> | undefined;
  let subscriptionGeneration = 0;
  const pendingDispatches = new Set<QueuedMessage<Message, StateDispatchError<E, ER>>>();
  const committedDispatches = new Set<QueuedMessage<Message, StateDispatchError<E, ER>>>();

  type RuntimeFailure = StateRuntimeError<E, ER>;
  type DispatchFailure = StateDispatchError<E, ER>;

  const scheduler = makeStateRuntimeScheduler(runtime);

  /** Timeline cause for this State's commits. */
  const cause = (
    event: TimelineStateCause["event"],
    message: Message | undefined,
  ): TimelineStateCause => ({
    _tag: "State",
    state: definition.name,
    event,
    ...(message === undefined ? {} : { message }),
  });

  const recordFailure = (failure: StateFailure<Message, StateRuntimeError<E, ER>>): void =>
    batchSignalWrites(
      () => failures.update((current) => [...current, failure]),
      cause("failure", failure.message),
    );

  const disposedFailure = (
    message: StateMessageValue<Message>,
  ): StateFailure<Message, DispatchFailure> =>
    makeStateFailure(
      "Update",
      new StateDisposed({
        reason: "State was disposed before the message update was applied.",
      }),
      message as Message,
    );

  const enqueue = (message: StateMessageValue<Message>): Effect.Effect<void> =>
    disposed ? Effect.void : Queue.offer(queue, { message }).pipe(Effect.asVoid);

  const completePendingDispatches = (): Effect.Effect<void> => {
    const pending = Array.from(pendingDispatches);
    pendingDispatches.clear();
    return Effect.forEach(
      pending,
      (queued) =>
        committedDispatches.has(queued)
          ? completeAck(queued)
          : completeAck(queued, disposedFailure(queued.message)),
      { discard: true },
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          committedDispatches.clear();
        }),
      ),
      Effect.asVoid,
    );
  };

  const runWithStateRuntime = <A, E2, R2>(
    effect: Effect.Effect<A, E2, R2>,
  ): Effect.Effect<A, E2 | ER> => runtime.provide(effect) as Effect.Effect<A, E2 | ER>;

  const runCommands = (
    commands: ReadonlyArray<StateCommand<Message, E, R>>,
    source: StateMessageValue<Message>,
  ): Effect.Effect<void, never, R | Scope.Scope> =>
    Effect.forEach(
      commands,
      (command) =>
        command.effect.pipe(
          Effect.matchEffect({
            onFailure: (error: RuntimeFailure) =>
              Effect.sync(() =>
                recordFailure(
                  makeStateFailure<Message, RuntimeFailure>("Command", error, source as Message),
                ),
              ),
            onSuccess: (message) =>
              message === undefined
                ? Effect.void
                : validateStateMessage<Message>("State.emit", message as Message).pipe(
                    Effect.matchEffect({
                      onFailure: (error) =>
                        Effect.sync(() =>
                          recordFailure(
                            makeStateFailure<Message, RuntimeFailure>(
                              "Command",
                              error as RuntimeFailure,
                              source as Message,
                            ),
                          ),
                        ),
                      onSuccess: (emitted) => enqueue(emitted),
                    }),
                  ),
          }),
          Effect.forkScoped({ startImmediately: true }),
        ),
      { discard: true },
    );

  const processMessage = (
    queued: QueuedMessage<Message, DispatchFailure>,
  ): Effect.Effect<void, never, R | Scope.Scope> =>
    // Messages apply to the base model; in-flight optimistic patches re-apply over it.
    stateStep(definition, readSignalOptimisticBase(model), queued.message).pipe(
      Effect.matchEffect({
        onFailure: (error) => failQueuedMessage(queued, error),
        onSuccess: (step) =>
          Effect.gen(function* () {
            const before = readSignalOptimisticBase(model);
            const committed = yield* Effect.sync(() => {
              if (disposed) {
                return false;
              }
              batchSignalWrites(
                () => {
                  committedDispatches.add(queued);
                  writeSignalOptimisticBase(model, step.model as Model);
                },
                cause("message", queued.message as Message),
              );
              if (!Object.is(before, step.model)) {
                restartSubscriptions(step.model as Model);
              }
              return true;
            });

            if (!committed) {
              yield* completeAck(queued, disposedFailure(queued.message));
              return;
            }

            if (disposed) {
              yield* completeAck(queued);
              return;
            }

            yield* runCommands(step.commands, queued.message);
            yield* completeAck(queued);
          }),
      }),
    );

  const failQueuedMessage = (
    queued: QueuedMessage<Message, DispatchFailure>,
    error: RuntimeFailure,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const failure = makeStateFailure<Message, RuntimeFailure>(
        "Update",
        error,
        queued.message as Message,
      );
      const reportFailure = yield* Effect.sync(() => {
        if (disposed) {
          return false;
        }
        recordFailure(failure);
        return true;
      });
      yield* completeAck(queued, reportFailure ? failure : disposedFailure(queued.message));
    });

  const processor = Effect.scoped(
    Effect.forever(
      Queue.take(queue).pipe(
        Effect.flatMap((queued) =>
          runWithStateRuntime(processMessage(queued)).pipe(
            Effect.catch((error: StateRuntimeError<E, ER>) => failQueuedMessage(queued, error)),
          ),
        ),
      ),
    ),
  );

  const restartSubscriptions = (nextModel: Model): void => {
    const generation = ++subscriptionGeneration;

    if (subscriptionFiber) {
      const fiber = subscriptionFiber;
      subscriptionFiber = undefined;
      void scheduler.forkRuntime(Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void)));
    }

    const subscriptionsForModel = definition.subscriptions;
    if (!subscriptionsForModel || disposed) {
      return;
    }

    const runSubscriptions = Effect.gen(function* () {
      const input = yield* invokeEffectInput(
        "State.subscriptions",
        subscriptionsForModel,
        nextModel,
      );
      const subscriptions = normalizeStateSubscriptions(input);
      yield* Effect.all(
        subscriptions.map((entry) =>
          entry.stream.pipe(
            Stream.runForEach((message) =>
              validateStateMessage<Message>("State.subscription", message as Message).pipe(
                Effect.matchEffect({
                  onFailure: (error) => {
                    const failure = makeStateFailure<Message, RuntimeFailure>(
                      "Subscription",
                      error as RuntimeFailure,
                    );
                    return Effect.sync(() => {
                      if (disposed || generation !== subscriptionGeneration) {
                        return;
                      }
                      recordFailure(failure);
                    });
                  },
                  onSuccess: (emitted) =>
                    Effect.gen(function* () {
                      const current = yield* Effect.sync(
                        () => !disposed && generation === subscriptionGeneration,
                      );
                      if (current) {
                        yield* enqueue(emitted);
                      }
                    }),
                }),
              ),
            ),
            Effect.catch((error: RuntimeFailure) => {
              const failure = makeStateFailure<Message, RuntimeFailure>("Subscription", error);
              return Effect.sync(() => {
                if (disposed || generation !== subscriptionGeneration) {
                  return;
                }
                recordFailure(failure);
              });
            }),
          ),
        ),
        { concurrency: "unbounded" },
      );
    }).pipe(Effect.asVoid);

    subscriptionFiber = scheduler.forkProvided(
      runWithStateRuntime(Effect.scoped(runSubscriptions)).pipe(
        Effect.catch((error: RuntimeFailure) => {
          const failure = makeStateFailure<Message, RuntimeFailure>("Subscription", error);
          return Effect.sync(() => {
            if (disposed || generation !== subscriptionGeneration) {
              return;
            }
            recordFailure(failure);
          });
        }),
      ),
    );
  };

  processorFiber = scheduler.forkProvided(processor);
  restartSubscriptions(Signal.peek(model));

  const disposeEffect = Effect.gen(function* () {
    if (disposed) {
      return;
    }

    disposed = true;
    subscriptionGeneration++;
    yield* completePendingDispatches();
    const currentSubscriptionFiber = subscriptionFiber;
    const currentProcessorFiber = processorFiber;
    subscriptionFiber = undefined;
    processorFiber = undefined;

    if (currentSubscriptionFiber) {
      yield* Fiber.interrupt(currentSubscriptionFiber).pipe(Effect.catchCause(() => Effect.void));
    }
    if (currentProcessorFiber) {
      yield* Fiber.interrupt(currentProcessorFiber).pipe(Effect.catchCause(() => Effect.void));
    }
    yield* Queue.shutdown(queue).pipe(Effect.catchCause(() => Effect.void));
  });

  scope?.addFinalizer(() => disposeEffect);

  return {
    [StateRefTypeId]: model,
    model,
    failures,
    dispatch: instanceDispatchEffect,
    clearFailures: () =>
      batchSignalWrites(() => failures.set([]), cause("clearFailures", undefined)),
    dispose: disposeEffect,
  };

  function instanceDispatchEffect(
    message: StateMessageValue<Message>,
  ): Effect.Effect<void, StateFailure<Message, DispatchFailure>> {
    if (disposed) {
      return Effect.fail(disposedFailure(message));
    }

    return validateStateMessage<Message>("State.emit", message as Message).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const failure = makeStateFailure<Message, RuntimeFailure>(
              "Update",
              error as RuntimeFailure,
              message as Message,
            );
            yield* Effect.sync(() => {
              if (disposed) {
                return;
              }
              recordFailure(failure);
            });
            yield* Effect.fail(failure);
          }),
        onSuccess: (validMessage) =>
          Effect.gen(function* () {
            const ack = yield* Deferred.make<void, StateFailure<Message, DispatchFailure>>();
            const queued = { message: validMessage, ack };
            const registered = yield* Effect.sync(() => {
              if (disposed) {
                return false;
              }
              pendingDispatches.add(queued);
              return true;
            });

            if (!registered) {
              return yield* Effect.fail(disposedFailure(validMessage));
            }

            yield* Queue.offer(queue, queued).pipe(
              Effect.flatMap((offered) =>
                offered ? Deferred.await(ack) : Effect.fail(disposedFailure(validMessage)),
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  pendingDispatches.delete(queued);
                  committedDispatches.delete(queued);
                }),
              ),
            );
          }),
      }),
    );
  }
};
