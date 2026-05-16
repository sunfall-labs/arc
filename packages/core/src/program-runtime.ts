import { Deferred, Effect, Fiber, Queue, Scope, Stream } from "effect";
import { invokeEffectInput } from "./effect-like.js";
import {
  type ProgramCommand,
  type ProgramDefinition,
  type ProgramEvent,
  type ProgramFailure,
  type ProgramInstance,
  type ProgramRuntimeError
} from "./program-contract.js";
import {
  isProgramStep,
  makeProgramFailure,
  normalizeProgramSubscriptions,
  programNext
} from "./program-primitives.js";
import {
  makeProgramRuntimeTimeline,
  type ProgramRuntimeTimelineEventInput
} from "./program-runtime-timeline.js";
import type { AnyEffectUiRuntime } from "./runtime.js";
import { Signal } from "./signal.js";

interface QueuedMessage<Message, E> {
  readonly message: Message;
  readonly ack?: Deferred.Deferred<void, ProgramFailure<Message, E>>;
}

export interface ProgramRuntimeInstanceOptions<Model, Message, E, R, ER> {
  readonly definition: ProgramDefinition<Model, Message, E, R>;
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly scope: {
    addFinalizer(finalizer: () => Effect.Effect<void>): void;
  } | undefined;
}

const completeAck = <Message, E>(
  queued: QueuedMessage<Message, E>,
  failure?: ProgramFailure<Message, E>
): Effect.Effect<void> => {
  if (!queued.ack) {
    return Effect.void;
  }

  return failure
    ? Deferred.fail(queued.ack, failure).pipe(Effect.asVoid)
    : Deferred.succeed(queued.ack, undefined).pipe(Effect.asVoid);
};

export const makeProgramRuntimeInstance = <Model, Message, E = never, R = never, ER = never>(
  options: ProgramRuntimeInstanceOptions<Model, Message, E, R, ER>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>> => {
  const { definition, runtime, scope } = options;
  const model = Signal.make(definition.initial);
  const failures = Signal.make<ReadonlyArray<ProgramFailure<Message, ProgramRuntimeError<E, ER>>>>([]);
  const queue = Effect.runSync(Queue.unbounded<QueuedMessage<Message, ProgramRuntimeError<E, ER>>>());
  let disposed = false;
  let processorFiber: Fiber.Fiber<void, unknown> | undefined;
  let subscriptionFiber: Fiber.Fiber<void, unknown> | undefined;
  let unsubscribeModel: (() => void) | undefined;
  let commandSequence = 0;

  type RuntimeFailure = ProgramRuntimeError<E, ER>;
  type RuntimeProgramEvent = ProgramEvent<Model, Message, RuntimeFailure>;
  type RuntimeProgramEventInput = ProgramRuntimeTimelineEventInput<RuntimeProgramEvent>;

  const runtimeTimeline = makeProgramRuntimeTimeline<RuntimeProgramEvent>({
    ...(definition.name === undefined ? {} : { name: definition.name }),
    ...(definition.timeline === undefined ? {} : { timeline: definition.timeline })
  });
  const timeline = runtimeTimeline.timeline;
  const recordTimeline = (event: RuntimeProgramEventInput): void =>
    runtimeTimeline.record(event);

  const appendFailure = (failure: ProgramFailure<Message, ProgramRuntimeError<E, ER>>): void => {
    failures.update((current) => [...current, failure]);
  };

  const enqueue = (message: Message): Effect.Effect<void> =>
    disposed
      ? Effect.void
      : Queue.offer(queue, { message }).pipe(Effect.asVoid);

  const runWithProgramRuntime = <A, E2, R2>(
    effect: Effect.Effect<A, E2, R2>
  ): Effect.Effect<A, E2 | ER> =>
    runtime.provide(effect) as Effect.Effect<A, E2 | ER>;

  const runCommands = (
    commands: ReadonlyArray<ProgramCommand<Message, E, R>>,
    source: Message
  ): Effect.Effect<void, never, R | Scope.Scope> =>
    Effect.forEach(
      commands,
      (command) => {
        const commandId = ++commandSequence;
        return Effect.sync(() =>
          recordTimeline({ _tag: "CommandStarted", commandId, source })
        ).pipe(
          Effect.flatMap(() =>
            command.effect.pipe(
              Effect.matchEffect({
                onFailure: (error: RuntimeFailure) => {
                  const failure = makeProgramFailure<Message, RuntimeFailure>("Command", error);
                  return Effect.sync(() => {
                    appendFailure(failure);
                    recordTimeline({
                      _tag: "CommandFailed",
                      commandId,
                      source,
                      failure
                    });
                  });
                },
                onSuccess: (message) =>
                  Effect.gen(function* () {
                    yield* Effect.sync(() =>
                      recordTimeline(message === undefined
                        ? { _tag: "CommandCompleted", commandId, source }
                        : { _tag: "CommandCompleted", commandId, source, emitted: message })
                    );
                    if (message !== undefined) {
                      yield* enqueue(message);
                    }
                  })
              })
            )
          ),
          Effect.forkScoped({ startImmediately: true })
        );
      },
      { discard: true }
    );

  const processMessage = (queued: QueuedMessage<Message, ProgramRuntimeError<E, ER>>): Effect.Effect<void, never, R | Scope.Scope> =>
    invokeEffectInput("Program.update", definition.update, Signal.peek(model), queued.message).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const failure = makeProgramFailure("Update", error, queued.message);
            yield* Effect.sync(() => {
              appendFailure(failure);
              recordTimeline({ _tag: "UpdateFailed", failure });
            });
            yield* completeAck(queued, failure);
          }),
        onSuccess: (update) =>
          Effect.gen(function* () {
            const before = Signal.peek(model);
            const step = isProgramStep(update)
              ? update
              : programNext<Model, Message, E, R>(update);

            yield* Effect.sync(() => {
              recordTimeline({
                _tag: "Message",
                message: queued.message,
                before,
                after: step.model,
                commandCount: step.commands.length
              });
              model.set(step.model);
            });
            yield* runCommands(step.commands, queued.message);
            yield* completeAck(queued);
          })
      })
    );

  const failQueuedMessage = (
    queued: QueuedMessage<Message, ProgramRuntimeError<E, ER>>,
    error: ProgramRuntimeError<E, ER>
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const failure = makeProgramFailure("Update", error, queued.message);
      yield* Effect.sync(() => {
        appendFailure(failure);
        recordTimeline({ _tag: "UpdateFailed", failure });
      });
      yield* completeAck(queued, failure);
    });

  const processor = Effect.scoped(
    Effect.forever(
      Queue.take(queue).pipe(
        Effect.flatMap((queued) =>
          runWithProgramRuntime(processMessage(queued)).pipe(
            Effect.catch((error: ProgramRuntimeError<E, ER>) => failQueuedMessage(queued, error))
          )
        )
      )
    )
  );

  const restartSubscriptions = (nextModel: Model): void => {
    if (subscriptionFiber) {
      const fiber = subscriptionFiber;
      subscriptionFiber = undefined;
      void Effect.runFork(Fiber.interrupt(fiber).pipe(Effect.catch(() => Effect.void)));
    }

    const subscriptionsForModel = definition.subscriptions;
    if (!subscriptionsForModel || disposed) {
      return;
    }

    const runSubscriptions = Effect.gen(function* () {
      const input = yield* invokeEffectInput("Program.subscriptions", subscriptionsForModel, nextModel);
      const subscriptions = normalizeProgramSubscriptions(input);
      yield* Effect.sync(() =>
        recordTimeline({
          _tag: "SubscriptionStarted",
          model: nextModel,
          count: subscriptions.length
        })
      );
      yield* Effect.all(
        subscriptions.map((entry) =>
          entry.stream.pipe(
            Stream.runForEach((message) =>
              Effect.sync(() =>
                recordTimeline({ _tag: "SubscriptionEmitted", message })
              ).pipe(Effect.flatMap(() => enqueue(message)))
            ),
            Effect.catch((error: RuntimeFailure) => {
              const failure = makeProgramFailure<Message, RuntimeFailure>("Subscription", error);
              return Effect.sync(() => {
                appendFailure(failure);
                recordTimeline({ _tag: "SubscriptionFailed", failure });
              });
            }
            )
          )
        ),
        { concurrency: "unbounded" }
      );
    }).pipe(Effect.asVoid);

    subscriptionFiber = Effect.runFork(
      runWithProgramRuntime(Effect.scoped(runSubscriptions)).pipe(
        Effect.catch((error: RuntimeFailure) => {
          const failure = makeProgramFailure<Message, RuntimeFailure>("Subscription", error);
          return Effect.sync(() => {
            appendFailure(failure);
            recordTimeline({ _tag: "SubscriptionFailed", failure });
          });
        })
      )
    );
  };

  processorFiber = Effect.runFork(processor);
  restartSubscriptions(Signal.peek(model));
  unsubscribeModel = model.subscribe(() => restartSubscriptions(Signal.peek(model)));

  const disposeEffect = Effect.gen(function* () {
    if (disposed) {
      return;
    }

    disposed = true;
    unsubscribeModel?.();
    unsubscribeModel = undefined;
    const currentSubscriptionFiber = subscriptionFiber;
    const currentProcessorFiber = processorFiber;
    subscriptionFiber = undefined;
    processorFiber = undefined;

    if (currentSubscriptionFiber) {
      yield* Fiber.interrupt(currentSubscriptionFiber).pipe(Effect.catch(() => Effect.void));
    }
    if (currentProcessorFiber) {
      yield* Fiber.interrupt(currentProcessorFiber).pipe(Effect.catch(() => Effect.void));
    }
    yield* Queue.shutdown(queue).pipe(Effect.catch(() => Effect.void));
    yield* Effect.sync(() => recordTimeline({ _tag: "Disposed" }));
  });

  scope?.addFinalizer(() => disposeEffect);

  return {
    model,
    state: model,
    failures,
    timeline,
    dispatch: (message) => {
      void Effect.runFork(instanceDispatchEffect(message).pipe(Effect.catch(() => Effect.void)));
    },
    dispatchEffect: instanceDispatchEffect,
    clearFailures: () => failures.set([]),
    clearTimeline: runtimeTimeline.clear,
    disposeEffect
  };

  function instanceDispatchEffect(message: Message): Effect.Effect<void, ProgramFailure<Message, ProgramRuntimeError<E, ER>>> {
    if (disposed) {
      return Effect.void;
    }

    return Effect.gen(function* () {
      const ack = yield* Deferred.make<void, ProgramFailure<Message, ProgramRuntimeError<E, ER>>>();
      yield* Queue.offer(queue, { message, ack });
      yield* Deferred.await(ack);
    });
  }
};
