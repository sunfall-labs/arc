import { Deferred, Effect, Fiber, Queue, Scope, Stream } from "effect";
import { invokeEffectInput } from "./effect-like.js";
import {
  type ProgramCommand,
  type ProgramDefinition,
  type ProgramDispatchError,
  type ProgramFailure,
  type ProgramInstance,
  type ProgramMessageValue,
  ProgramDisposed,
  type ProgramRuntimeError,
} from "./program-contract.js";
import {
  isProgramStep,
  makeProgramFailure,
  normalizeProgramSubscriptions,
  programNext,
  validateProgramModelSync,
  validateProgramMessageEffect,
  validateProgramStepModelEffect,
} from "./program-primitives.js";
import { makeProgramRuntimeScheduler } from "./program-runtime-scheduler.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { Signal } from "./signal.js";
import type { TimelineProgramCause } from "./timeline.js";

interface QueuedMessage<Message, E> {
  readonly message: ProgramMessageValue<Message>;
  readonly ack?: Deferred.Deferred<void, ProgramFailure<Message, E>>;
}

export interface ProgramRuntimeInstanceOptions<Model, Message, E, R, ER> {
  readonly definition: ProgramDefinition<Model, Message, E, R>;
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly scope:
    | {
        addFinalizer(finalizer: () => Effect.Effect<void>): void;
      }
    | undefined;
}

const completeAck = <Message, E>(
  queued: QueuedMessage<Message, E>,
  failure?: ProgramFailure<Message, E>,
): Effect.Effect<void> => {
  if (!queued.ack) {
    return Effect.void;
  }

  return failure
    ? Deferred.fail(queued.ack, failure).pipe(Effect.asVoid)
    : Deferred.succeed(queued.ack, undefined).pipe(Effect.asVoid);
};

export const makeProgramRuntimeInstance = <Model, Message, E = never, R = never, ER = never>(
  options: ProgramRuntimeInstanceOptions<Model, Message, E, R, ER>,
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>> => {
  const { definition, runtime, scope } = options;
  const initialModel = validateProgramModelSync("Program.initial", definition.initial);
  const signalName = definition.name ?? "Program";
  const model = Signal.make(initialModel as Model, { name: `${signalName}.model` });
  const failures = Signal.make<ReadonlyArray<ProgramFailure<Message, ProgramRuntimeError<E, ER>>>>(
    [],
    { name: `${signalName}.failures` },
  );
  const queue = Effect.runSync(
    Queue.unbounded<QueuedMessage<Message, ProgramDispatchError<E, ER>>>(),
  );
  let disposed = false;
  let processorFiber: Fiber.Fiber<void, unknown> | undefined;
  let subscriptionFiber: Fiber.Fiber<void, unknown> | undefined;
  let subscriptionGeneration = 0;
  const pendingDispatches = new Set<QueuedMessage<Message, ProgramDispatchError<E, ER>>>();
  const committedDispatches = new Set<QueuedMessage<Message, ProgramDispatchError<E, ER>>>();

  type RuntimeFailure = ProgramRuntimeError<E, ER>;
  type DispatchFailure = ProgramDispatchError<E, ER>;

  const scheduler = makeProgramRuntimeScheduler(runtime);

  /** Timeline cause for this Program's commits. */
  const cause = (
    event: TimelineProgramCause["event"],
    message: Message | undefined,
  ): TimelineProgramCause => ({
    _tag: "Program",
    program: definition.name,
    event,
    ...(message === undefined ? {} : { message }),
  });

  const recordFailure = (failure: ProgramFailure<Message, ProgramRuntimeError<E, ER>>): void =>
    Signal.batch(() => failures.update((current) => [...current, failure]), {
      cause: cause("failure", failure.message),
    });

  const disposedFailure = (
    message: ProgramMessageValue<Message>,
  ): ProgramFailure<Message, DispatchFailure> =>
    makeProgramFailure(
      "Update",
      new ProgramDisposed({
        reason: "Program was disposed before the message update was applied.",
      }),
      message as Message,
    );

  const enqueue = (message: ProgramMessageValue<Message>): Effect.Effect<void> =>
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

  const runWithProgramRuntime = <A, E2, R2>(
    effect: Effect.Effect<A, E2, R2>,
  ): Effect.Effect<A, E2 | ER> => runtime.provide(effect) as Effect.Effect<A, E2 | ER>;

  const runCommands = (
    commands: ReadonlyArray<ProgramCommand<Message, E, R>>,
    source: ProgramMessageValue<Message>,
  ): Effect.Effect<void, never, R | Scope.Scope> =>
    Effect.forEach(
      commands,
      (command) =>
        command.effect.pipe(
          Effect.matchEffect({
            onFailure: (error: RuntimeFailure) =>
              Effect.sync(() =>
                recordFailure(
                  makeProgramFailure<Message, RuntimeFailure>("Command", error, source as Message),
                ),
              ),
            onSuccess: (message) =>
              message === undefined
                ? Effect.void
                : validateProgramMessageEffect<Message>("Program.command", message as Message).pipe(
                    Effect.matchEffect({
                      onFailure: (error) =>
                        Effect.sync(() =>
                          recordFailure(
                            makeProgramFailure<Message, RuntimeFailure>(
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
    invokeEffectInput(
      "Program.update",
      definition.update,
      Signal.peek(model),
      queued.message as never,
    ).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const failure = makeProgramFailure<Message, RuntimeFailure>(
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
          }),
        onSuccess: (update) =>
          validateProgramStepModelEffect(
            isProgramStep(update) ? update : programNext<Model, Message, E, R>(update),
          ).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.gen(function* () {
                  const failure = makeProgramFailure<Message, RuntimeFailure>(
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
                  yield* completeAck(
                    queued,
                    reportFailure ? failure : disposedFailure(queued.message),
                  );
                }),
              onSuccess: (step) =>
                Effect.gen(function* () {
                  const before = Signal.peek(model);
                  const committed = yield* Effect.sync(() => {
                    if (disposed) {
                      return false;
                    }
                    Signal.batch(
                      () => {
                        committedDispatches.add(queued);
                        model.set(step.model as Model);
                      },
                      { cause: cause("message", queued.message as Message) },
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
          ),
      }),
    );

  const failQueuedMessage = (
    queued: QueuedMessage<Message, DispatchFailure>,
    error: RuntimeFailure,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const failure = makeProgramFailure<Message, RuntimeFailure>(
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
          runWithProgramRuntime(processMessage(queued)).pipe(
            Effect.catch((error: ProgramRuntimeError<E, ER>) => failQueuedMessage(queued, error)),
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
        "Program.subscriptions",
        subscriptionsForModel,
        nextModel,
      );
      const subscriptions = normalizeProgramSubscriptions(input);
      yield* Effect.all(
        subscriptions.map((entry) =>
          entry.stream.pipe(
            Stream.runForEach((message) =>
              validateProgramMessageEffect<Message>(
                "Program.subscription",
                message as Message,
              ).pipe(
                Effect.matchEffect({
                  onFailure: (error) => {
                    const failure = makeProgramFailure<Message, RuntimeFailure>(
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
              const failure = makeProgramFailure<Message, RuntimeFailure>("Subscription", error);
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
      runWithProgramRuntime(Effect.scoped(runSubscriptions)).pipe(
        Effect.catch((error: RuntimeFailure) => {
          const failure = makeProgramFailure<Message, RuntimeFailure>("Subscription", error);
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
    model,
    failures,
    dispatch: (message) => {
      void scheduler.forkRuntime(
        instanceDispatchEffect(message).pipe(Effect.catchCause(() => Effect.void)),
      );
    },
    dispatchEffect: instanceDispatchEffect,
    clearFailures: () =>
      Signal.batch(() => failures.set([]), { cause: cause("clearFailures", undefined) }),
    disposeEffect,
  };

  function instanceDispatchEffect(
    message: ProgramMessageValue<Message>,
  ): Effect.Effect<void, ProgramFailure<Message, DispatchFailure>> {
    if (disposed) {
      return Effect.fail(disposedFailure(message));
    }

    return validateProgramMessageEffect<Message>("Program.dispatch", message as Message).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const failure = makeProgramFailure<Message, RuntimeFailure>(
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
            const ack = yield* Deferred.make<void, ProgramFailure<Message, DispatchFailure>>();
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
