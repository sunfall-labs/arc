import { Deferred, Effect, Fiber, Queue, Scope, Stream } from "effect";
import { invokeEffectInput } from "./effect-like.js";
import {
  type ProgramCommand,
  type ProgramDefinition,
  type ProgramDispatchError,
  type ProgramEvent,
  type ProgramFailure,
  type ProgramInstance,
  ProgramDisposed,
  type ProgramRuntimeError
} from "./program-contract.js";
import {
  isProgramStep,
  makeProgramFailure,
  normalizeProgramSubscriptions,
  programNext,
  validateProgramMessageEffect,
  validateProgramStepModelEffect
} from "./program-primitives.js";
import {
  makeProgramRuntimeTimeline,
  type ProgramRuntimeTimelineEventInput
} from "./program-runtime-timeline.js";
import { makeProgramRuntimeScheduler } from "./program-runtime-scheduler.js";
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
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>> => {
  const { definition, runtime, scope } = options;
  const model = Signal.make(definition.initial);
  const failures = Signal.make<ReadonlyArray<ProgramFailure<Message, ProgramRuntimeError<E, ER>>>>([]);
  const queue = Effect.runSync(Queue.unbounded<QueuedMessage<Message, ProgramDispatchError<E, ER>>>());
  let disposed = false;
  let processorFiber: Fiber.Fiber<void, unknown> | undefined;
  let subscriptionFiber: Fiber.Fiber<void, unknown> | undefined;
  let commandSequence = 0;
  let subscriptionGeneration = 0;
  const pendingDispatches = new Set<QueuedMessage<Message, ProgramDispatchError<E, ER>>>();
  const committedDispatches = new Set<QueuedMessage<Message, ProgramDispatchError<E, ER>>>();

  type RuntimeFailure = ProgramRuntimeError<E, ER>;
  type DispatchFailure = ProgramDispatchError<E, ER>;
  type RuntimeProgramEvent = ProgramEvent<Model, Message, RuntimeFailure>;
  type RuntimeProgramEventInput = ProgramRuntimeTimelineEventInput<RuntimeProgramEvent>;

  const runtimeTimeline = makeProgramRuntimeTimeline<RuntimeProgramEvent>({
    ...(definition.name === undefined ? {} : { name: definition.name }),
    ...(definition.timeline === undefined ? {} : { timeline: definition.timeline })
  });
  const scheduler = makeProgramRuntimeScheduler(runtime);
  const timeline = runtimeTimeline.timeline;
  const recordTimeline = (event: RuntimeProgramEventInput): void =>
    runtimeTimeline.record(event);

  const appendFailure = (failure: ProgramFailure<Message, ProgramRuntimeError<E, ER>>): void => {
    failures.update((current) => [...current, failure]);
  };

  const disposedFailure = (message: Message): ProgramFailure<Message, DispatchFailure> =>
    makeProgramFailure("Update", new ProgramDisposed({
      reason: "Program was disposed before the message update was applied."
    }), message);

  const enqueue = (message: Message): Effect.Effect<void> =>
    disposed
      ? Effect.void
      : Queue.offer(queue, { message }).pipe(Effect.asVoid);

  const completePendingDispatches = (): Effect.Effect<void> => {
    const pending = Array.from(pendingDispatches);
    pendingDispatches.clear();
    return Effect.forEach(
      pending,
      (queued) =>
        committedDispatches.has(queued)
          ? completeAck(queued)
          : completeAck(queued, disposedFailure(queued.message)),
      { discard: true }
    ).pipe(
      Effect.ensuring(Effect.sync(() => {
        committedDispatches.clear();
      })),
      Effect.asVoid
    );
  };

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
                  message === undefined
                    ? Effect.sync(() => recordTimeline({ _tag: "CommandCompleted", commandId, source }))
                    : validateProgramMessageEffect("Program.command", message).pipe(
                        Effect.matchEffect({
                          onFailure: (error) => {
                            const failure = makeProgramFailure<Message, RuntimeFailure>(
                              "Command",
                              error as RuntimeFailure,
                              source
                            );
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
                          onSuccess: (emitted) =>
                            Effect.gen(function* () {
                              yield* Effect.sync(() =>
                                recordTimeline({ _tag: "CommandCompleted", commandId, source, emitted })
                              );
                              yield* enqueue(emitted);
                            })
                        })
                      )
              })
            )
          ),
          Effect.forkScoped({ startImmediately: true })
        );
      },
      { discard: true }
    );

  const processMessage = (queued: QueuedMessage<Message, DispatchFailure>): Effect.Effect<void, never, R | Scope.Scope> =>
    invokeEffectInput("Program.update", definition.update, Signal.peek(model), queued.message as never).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const failure = makeProgramFailure("Update", error, queued.message);
            const reportFailure = yield* Effect.sync(() => {
              if (disposed) {
                return false;
              }
              appendFailure(failure);
              recordTimeline({ _tag: "UpdateFailed", failure });
              return true;
            });
            yield* completeAck(queued, reportFailure ? failure : disposedFailure(queued.message));
          }),
        onSuccess: (update) =>
          validateProgramStepModelEffect(
            isProgramStep(update)
              ? update
              : programNext<Model, Message, E, R>(update)
          ).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.gen(function* () {
                  const failure = makeProgramFailure("Update", error, queued.message);
                  const reportFailure = yield* Effect.sync(() => {
                    if (disposed) {
                      return false;
                    }
                    appendFailure(failure);
                    recordTimeline({ _tag: "UpdateFailed", failure });
                    return true;
                  });
                  yield* completeAck(queued, reportFailure ? failure : disposedFailure(queued.message));
                }),
              onSuccess: (step) =>
                Effect.gen(function* () {
                  const before = Signal.peek(model);
                  const committed = yield* Effect.sync(() => {
                    if (disposed) {
                      return false;
                    }
                    recordTimeline({
                      _tag: "Message",
                      message: queued.message,
                      before,
                      after: step.model,
                      commandCount: step.commands.length
                    });
                    committedDispatches.add(queued);
                    model.set(step.model);
                    if (!Object.is(before, step.model)) {
                      restartSubscriptions(step.model);
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
                })
            })
          )
      })
    );

  const failQueuedMessage = (
    queued: QueuedMessage<Message, DispatchFailure>,
    error: RuntimeFailure
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const failure = makeProgramFailure("Update", error, queued.message);
      const reportFailure = yield* Effect.sync(() => {
        if (disposed) {
          return false;
        }
        appendFailure(failure);
        recordTimeline({ _tag: "UpdateFailed", failure });
        return true;
      });
      yield* completeAck(queued, reportFailure ? failure : disposedFailure(queued.message));
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
    const generation = ++subscriptionGeneration;

    if (subscriptionFiber) {
      const fiber = subscriptionFiber;
      subscriptionFiber = undefined;
      void scheduler.forkRuntime(Fiber.interrupt(fiber).pipe(Effect.catch(() => Effect.void)));
    }

    const subscriptionsForModel = definition.subscriptions;
    if (!subscriptionsForModel || disposed) {
      return;
    }

    const runSubscriptions = Effect.gen(function* () {
      const input = yield* invokeEffectInput("Program.subscriptions", subscriptionsForModel, nextModel);
      const subscriptions = normalizeProgramSubscriptions(input);
      yield* Effect.sync(() => {
        if (disposed || generation !== subscriptionGeneration) {
          return;
        }
        recordTimeline({
          _tag: "SubscriptionStarted",
          model: nextModel,
          count: subscriptions.length
        });
      });
      yield* Effect.all(
        subscriptions.map((entry) =>
          entry.stream.pipe(
            Stream.runForEach((message) =>
              validateProgramMessageEffect("Program.subscription", message).pipe(
                Effect.matchEffect({
                  onFailure: (error) => {
                    const failure = makeProgramFailure<Message, RuntimeFailure>(
                      "Subscription",
                      error as RuntimeFailure
                    );
                    return Effect.sync(() => {
                      if (disposed || generation !== subscriptionGeneration) {
                        return;
                      }
                      appendFailure(failure);
                      recordTimeline({ _tag: "SubscriptionFailed", failure });
                    });
                  },
                  onSuccess: (emitted) =>
                    Effect.gen(function* () {
                      const current = yield* Effect.sync(() => {
                        if (disposed || generation !== subscriptionGeneration) {
                          return false;
                        }
                        recordTimeline({ _tag: "SubscriptionEmitted", message: emitted });
                        return true;
                      });
                      if (current) {
                        yield* enqueue(emitted);
                      }
                    })
                })
              )
            ),
            Effect.catch((error: RuntimeFailure) => {
              const failure = makeProgramFailure<Message, RuntimeFailure>("Subscription", error);
              return Effect.sync(() => {
                if (disposed || generation !== subscriptionGeneration) {
                  return;
                }
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

    subscriptionFiber = scheduler.forkProvided(
      runWithProgramRuntime(Effect.scoped(runSubscriptions)).pipe(
        Effect.catch((error: RuntimeFailure) => {
          const failure = makeProgramFailure<Message, RuntimeFailure>("Subscription", error);
          return Effect.sync(() => {
            if (disposed || generation !== subscriptionGeneration) {
              return;
            }
            appendFailure(failure);
            recordTimeline({ _tag: "SubscriptionFailed", failure });
          });
        })
      )
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
      void scheduler.forkRuntime(instanceDispatchEffect(message).pipe(Effect.catch(() => Effect.void)));
    },
    dispatchEffect: instanceDispatchEffect,
    clearFailures: () => failures.set([]),
    clearTimeline: runtimeTimeline.clear,
    disposeEffect
  };

  function instanceDispatchEffect(
    message: Message
  ): Effect.Effect<void, ProgramFailure<Message, DispatchFailure>> {
    if (disposed) {
      return Effect.fail(disposedFailure(message));
    }

    return validateProgramMessageEffect("Program.dispatch", message).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.gen(function* () {
            const failure = makeProgramFailure<Message, RuntimeFailure>(
              "Update",
              error as RuntimeFailure,
              message
            );
            yield* Effect.sync(() => {
              if (disposed) {
                return;
              }
              appendFailure(failure);
              recordTimeline({ _tag: "UpdateFailed", failure });
            });
            yield* Effect.fail(failure);
          }),
        onSuccess: (validMessage) =>
          Effect.gen(function* () {
            const ack = yield* Deferred.make<void, ProgramFailure<Message, DispatchFailure>>();
            const queued = { message: validMessage as Message, ack };
            const registered = yield* Effect.sync(() => {
              if (disposed) {
                return false;
              }
              pendingDispatches.add(queued);
              return true;
            });

            if (!registered) {
              return yield* Effect.fail(disposedFailure(validMessage as Message));
            }

            yield* Queue.offer(queue, queued).pipe(
              Effect.flatMap((offered) =>
                offered
                  ? Deferred.await(ack)
                  : Effect.fail(disposedFailure(validMessage as Message))
              ),
              Effect.ensuring(Effect.sync(() => {
                pendingDispatches.delete(queued);
                committedDispatches.delete(queued);
              }))
            );
          })
      })
    );
  }
};
