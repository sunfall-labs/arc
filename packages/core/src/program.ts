import { Deferred, Effect, Fiber, Queue, Scope, Stream } from "effect";
import type {
  EffectInput,
  EffectInputCallbackError,
  EffectInputError,
  EffectInputRequirements
} from "./effect-like.js";
import { invokeEffectInput } from "./effect-like.js";
import {
  makeProgramRuntimeTimeline,
  type ProgramRuntimeTimelineEventInput
} from "./program-runtime-timeline.js";
import { currentOrDefaultRuntime, type AnyEffectUiRuntime } from "./runtime.js";
import { getCurrentScope } from "./scope.js";
import {
  Signal,
  type ReadableSignal
} from "./signal.js";

export const ProgramStepTypeId: unique symbol = Symbol.for("@effect-ui/core/ProgramStep") as typeof ProgramStepTypeId;
export const ProgramCommandTypeId: unique symbol = Symbol.for("@effect-ui/core/ProgramCommand") as typeof ProgramCommandTypeId;
export const ProgramSubscriptionTypeId: unique symbol = Symbol.for("@effect-ui/core/ProgramSubscription") as typeof ProgramSubscriptionTypeId;

export type ProgramPhase = "Update" | "Command" | "Subscription";

/** Failure reported by a running Program without tearing down the UI loop. */
export interface ProgramFailure<Message, E> {
  readonly _tag: "ProgramFailure";
  readonly phase: ProgramPhase;
  readonly message?: Message;
  readonly error: E;
}

/** Effect command that may emit one follow-up message. */
export interface ProgramCommand<Message, E = never, R = never> {
  readonly [ProgramCommandTypeId]: typeof ProgramCommandTypeId;
  readonly effect: Effect.Effect<Message | void, E, R>;
}

export type ProgramCommandInput<Message, E = never, R = never> =
  | ProgramCommand<Message, E, R>
  | ReadonlyArray<ProgramCommand<Message, E, R>>
  | false
  | null
  | undefined;

/** State transition plus optional commands to run after the model is written. */
export interface ProgramStep<Model, Message, E = never, R = never> {
  readonly [ProgramStepTypeId]: typeof ProgramStepTypeId;
  readonly model: Model;
  readonly commands: ReadonlyArray<ProgramCommand<Message, E, R>>;
}

export type ProgramUpdate<Model, Message, E = never, R = never> =
  | Model
  | ProgramStep<Model, Message, E, R>;

/** Stream subscription that emits messages into a Program. */
export interface ProgramSubscription<Message, E = never, R = never> {
  readonly [ProgramSubscriptionTypeId]: typeof ProgramSubscriptionTypeId;
  readonly stream: Stream.Stream<Message, E, R>;
}

export type ProgramSubscriptionInput<Message, E = never, R = never> =
  | Stream.Stream<Message, E, R>
  | ProgramSubscription<Message, E, R>
  | ReadonlyArray<ProgramSubscriptionInput<Message, E, R>>
  | false
  | null
  | undefined;

export type ProgramUpdateError<Out> = EffectInputError<Out>;
export type ProgramUpdateRequirements<Out> = EffectInputRequirements<Out>;
export type ProgramSubscriptionError<Out> = EffectInputError<Out>;
export type ProgramSubscriptionRequirements<Out> = EffectInputRequirements<Out>;

export interface ProgramDefinition<Model, Message, E = never, R = never> {
  /** Optional stable name used by timeline/devtools events. */
  readonly name?: string;
  readonly initial: Model;
  readonly update: (
    model: Model,
    message: Message
  ) => EffectInput<ProgramUpdate<Model, Message, E, R>, E, R>;
  readonly subscriptions?: (
    model: Model
  ) => EffectInput<ProgramSubscriptionInput<Message, E, R>, E, R>;
  /** Bounded runtime event retention. Set to `false` to disable timeline storage. */
  readonly timeline?: false | ProgramTimelineOptions;
}

export type ProgramRuntimeError<E, ER = never> = E | EffectInputCallbackError | ER;

export interface ProgramTimelineOptions {
  /** Maximum retained timeline events. Defaults to 200. */
  readonly limit?: number;
}

export interface ProgramEventBase {
  readonly sequence: number;
  readonly program?: string;
}

export interface ProgramMessageEvent<Model, Message> extends ProgramEventBase {
  readonly _tag: "Message";
  readonly message: Message;
  readonly before: Model;
  readonly after: Model;
  readonly commandCount: number;
}

export interface ProgramCommandStartedEvent<Message> extends ProgramEventBase {
  readonly _tag: "CommandStarted";
  readonly commandId: number;
  readonly source?: Message;
}

export interface ProgramCommandCompletedEvent<Message> extends ProgramEventBase {
  readonly _tag: "CommandCompleted";
  readonly commandId: number;
  readonly source?: Message;
  readonly emitted?: Message;
}

export interface ProgramCommandFailedEvent<Message, E> extends ProgramEventBase {
  readonly _tag: "CommandFailed";
  readonly commandId: number;
  readonly source?: Message;
  readonly failure: ProgramFailure<Message, E>;
}

export interface ProgramUpdateFailedEvent<Message, E> extends ProgramEventBase {
  readonly _tag: "UpdateFailed";
  readonly failure: ProgramFailure<Message, E>;
}

export interface ProgramSubscriptionStartedEvent<Model> extends ProgramEventBase {
  readonly _tag: "SubscriptionStarted";
  readonly model: Model;
  readonly count: number;
}

export interface ProgramSubscriptionEmittedEvent<Message> extends ProgramEventBase {
  readonly _tag: "SubscriptionEmitted";
  readonly message: Message;
}

export interface ProgramSubscriptionFailedEvent<Message, E> extends ProgramEventBase {
  readonly _tag: "SubscriptionFailed";
  readonly failure: ProgramFailure<Message, E>;
}

export interface ProgramDisposedEvent extends ProgramEventBase {
  readonly _tag: "Disposed";
}

export type ProgramEvent<Model, Message, E = never> =
  | ProgramMessageEvent<Model, Message>
  | ProgramCommandStartedEvent<Message>
  | ProgramCommandCompletedEvent<Message>
  | ProgramCommandFailedEvent<Message, E>
  | ProgramUpdateFailedEvent<Message, E>
  | ProgramSubscriptionStartedEvent<Model>
  | ProgramSubscriptionEmittedEvent<Message>
  | ProgramSubscriptionFailedEvent<Message, E>
  | ProgramDisposedEvent;

/** One deterministic Program transition captured for story-style tests. */
export interface ProgramStoryEntry<Model, Message, E = never, R = never> {
  readonly message: Message;
  readonly before: Model;
  readonly after: Model;
  readonly commands: ReadonlyArray<ProgramCommand<Message, E, R>>;
}

export interface ProgramStory<Model, Message, E = never, R = never> {
  /** Current model after all story messages that have been applied. */
  readonly model: ReadableSignal<Model>;
  /** Alias for `model`, useful in state-oriented tests. */
  readonly state: ReadableSignal<Model>;
  /** Applied transitions, including returned commands that have not run implicitly. */
  readonly history: ReadableSignal<ReadonlyArray<ProgramStoryEntry<Model, Message, E, R>>>;
  /** Applies one message through `update` and records the resulting transition. */
  send(message: Message): Effect.Effect<
    ProgramStoryEntry<Model, Message, E, R>,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  >;
  /** Runs one command without applying its emitted message. */
  run(command: ProgramCommand<Message, E, R>): Effect.Effect<
    Message | void,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  >;
  /** Runs one command and applies its emitted message when it produces one. */
  resolve(command: ProgramCommand<Message, E, R>): Effect.Effect<
    ProgramStoryEntry<Model, Message, E, R> | undefined,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  >;
  /** Resets the story to a known model and clears history. */
  reset(model?: Model): void;
}

export interface ProgramStoryOptions<Model> {
  readonly initial?: Model;
}

export interface ProgramInstance<Model, Message, E = never> {
  /** Centralized model signal for adapter-neutral reads and derived state. */
  readonly model: ReadableSignal<Model>;
  /** Alias for `model`, useful in UI code that prefers state vocabulary. */
  readonly state: ReadableSignal<Model>;
  /** Accumulated typed failures from updates, commands, and subscriptions. */
  readonly failures: ReadableSignal<ReadonlyArray<ProgramFailure<Message, E>>>;
  /** Bounded runtime timeline for messages, commands, subscriptions, and failures. */
  readonly timeline: ReadableSignal<ReadonlyArray<ProgramEvent<Model, Message, E>>>;
  /** Fire-and-forget dispatch for UI event handlers. */
  dispatch(message: Message): void;
  /** Effect dispatch that completes after the message update has been applied. */
  dispatchEffect(message: Message): Effect.Effect<void, ProgramFailure<Message, E>>;
  /** Clears accumulated failures. */
  clearFailures(): void;
  /** Clears retained timeline events without changing model or failures. */
  clearTimeline(): void;
  /** Stops the message loop and interrupts active subscriptions/commands. */
  disposeEffect: Effect.Effect<void>;
}

interface QueuedMessage<Message, E> {
  readonly message: Message;
  readonly ack?: Deferred.Deferred<void, ProgramFailure<Message, E>>;
}

const isProgramStep = <Model, Message, E, R>(
  value: ProgramUpdate<Model, Message, E, R>
): value is ProgramStep<Model, Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramStepTypeId]?: unknown })[ProgramStepTypeId] === ProgramStepTypeId;

const isProgramCommand = <Message, E, R>(
  value: unknown
): value is ProgramCommand<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramCommandTypeId]?: unknown })[ProgramCommandTypeId] === ProgramCommandTypeId;

const isProgramSubscription = <Message, E, R>(
  value: unknown
): value is ProgramSubscription<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramSubscriptionTypeId]?: unknown })[ProgramSubscriptionTypeId] === ProgramSubscriptionTypeId;

const normalizeCommands = <Message, E, R>(
  input: ProgramCommandInput<Message, E, R>
): ReadonlyArray<ProgramCommand<Message, E, R>> => {
  if (!input) {
    return [];
  }

  return isProgramCommand<Message, E, R>(input) ? [input] : input;
};

const normalizeSubscriptions = <Message, E, R>(
  input: ProgramSubscriptionInput<Message, E, R>
): ReadonlyArray<ProgramSubscription<Message, E, R>> => {
  if (!input) {
    return [];
  }

  if (isProgramSubscription<Message, E, R>(input)) {
    return [input];
  }

  if (Stream.isStream(input)) {
    return [programSubscription(input as Stream.Stream<Message, E, R>)];
  }

  return input.flatMap((entry) => normalizeSubscriptions(entry));
};

const makeFailure = <Message, E>(
  phase: ProgramPhase,
  error: E,
  message?: Message
): ProgramFailure<Message, E> => ({
  _tag: "ProgramFailure",
  phase,
  ...(message === undefined ? {} : { message }),
  error
});

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

/** Defines a reusable Program with centralized model, messages, commands, and subscriptions. */
export const defineProgram = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>
): ProgramDefinition<Model, Message, E, R> => definition;

/** Runs one Program update and normalizes the result into a ProgramStep. */
export const programStepEffect = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>,
  model: Model,
  message: Message
): Effect.Effect<
  ProgramStep<Model, Message, E, R>,
  ProgramFailure<Message, ProgramRuntimeError<E>>,
  R
> =>
  invokeEffectInput("Program.update", definition.update, model, message).pipe(
    Effect.map((update) =>
      isProgramStep(update)
        ? update
        : programNext<Model, Message, E, R>(update)
    ),
    Effect.mapError((error) => makeFailure("Update", error, message))
  );

/** Builds a state transition, optionally with commands to run after the model is written. */
export const programNext = <Model, Message, E = never, R = never>(
  model: Model,
  commands?: ProgramCommandInput<Message, E, R>
): ProgramStep<Model, Message, E, R> => ({
  [ProgramStepTypeId]: ProgramStepTypeId,
  model,
  commands: normalizeCommands(commands)
});

/** Effect command that emits its successful value as the next message. */
export const programCommand = <Message, E = never, R = never>(
  effect: Effect.Effect<Message | void, E, R>
): ProgramCommand<Message, E, R> => ({
  [ProgramCommandTypeId]: ProgramCommandTypeId,
  effect
});

/** Command that immediately dispatches a message. */
export const programDispatch = <Message>(message: Message): ProgramCommand<Message> =>
  programCommand(Effect.succeed(message));

/** Command for background Effects that do not emit follow-up messages. */
export const programEffect = <Message = never, E = never, R = never>(
  effect: Effect.Effect<void, E, R>
): ProgramCommand<Message, E, R> =>
  programCommand<Message, E, R>(effect);

/** Groups commands for use with `Program.next(model, Program.commands(...))`. */
export const programCommands = <Message, E = never, R = never>(
  ...commands: ReadonlyArray<ProgramCommand<Message, E, R> | false | null | undefined>
): ReadonlyArray<ProgramCommand<Message, E, R>> =>
  commands.filter(isProgramCommand<Message, E, R>);

/** Wraps a Stream subscription that emits messages into the Program loop. */
export const programSubscription = <Message, E = never, R = never>(
  stream: Stream.Stream<Message, E, R>
): ProgramSubscription<Message, E, R> => ({
  [ProgramSubscriptionTypeId]: ProgramSubscriptionTypeId,
  stream
});

/** Creates an Effect-first story harness for deterministic Program tests. */
export const makeProgramStory = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>,
  options: ProgramStoryOptions<Model> = {}
): ProgramStory<Model, Message, E, R> => {
  const initial = "initial" in options ? options.initial : definition.initial;
  const model = Signal.make(initial);
  const history = Signal.make<ReadonlyArray<ProgramStoryEntry<Model, Message, E, R>>>([]);

  const send = (
    message: Message
  ): Effect.Effect<
    ProgramStoryEntry<Model, Message, E, R>,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  > =>
    Effect.gen(function* () {
      const before = Signal.peek(model);
      const step = yield* programStepEffect(definition, before, message);
      const entry: ProgramStoryEntry<Model, Message, E, R> = {
        message,
        before,
        after: step.model,
        commands: step.commands
      };
      yield* Effect.sync(() => {
        model.set(step.model);
        history.update((current) => [...current, entry]);
      });
      return entry;
    });

  const run = (
    command: ProgramCommand<Message, E, R>
  ): Effect.Effect<Message | void, ProgramFailure<Message, ProgramRuntimeError<E>>, R> =>
    command.effect.pipe(
      Effect.mapError((error) =>
        makeFailure<Message, ProgramRuntimeError<E>>("Command", error as ProgramRuntimeError<E>)
      )
    );

  return {
    model,
    state: model,
    history,
    send,
    run,
    resolve: (command) =>
      Effect.gen(function* () {
        const message = yield* run(command);
        return message === undefined ? undefined : yield* send(message);
      }),
    reset: (next = definition.initial) => {
      model.set(next);
      history.set([]);
    }
  };
};

/** Starts a Program against the current Effect UI runtime and optional UI scope. */
export const startProgram = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>
): ProgramInstance<Model, Message, ProgramRuntimeError<E>> => startProgramWithRuntimeError<Model, Message, E, R, never>(definition);

export const startProgramWithRuntimeError = <Model, Message, E = never, R = never, ER = never>(
  definition: ProgramDefinition<Model, Message, E, R>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>> => {
  const runtime = currentOrDefaultRuntime() as AnyEffectUiRuntime<ER>;
  const scope = getCurrentScope();
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
                  const failure = makeFailure<Message, RuntimeFailure>("Command", error);
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
            const failure = makeFailure("Update", error, queued.message);
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
      const failure = makeFailure("Update", error, queued.message);
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
      const subscriptions = normalizeSubscriptions(input);
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
              const failure = makeFailure<Message, RuntimeFailure>("Subscription", error);
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
          const failure = makeFailure<Message, RuntimeFailure>("Subscription", error);
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

export namespace Program {
  export type Definition<Model, Message, E = never, R = never> = ProgramDefinition<Model, Message, E, R>;
  export type Instance<Model, Message, E = never> = ProgramInstance<Model, Message, E>;
  export type Failure<Message, E> = ProgramFailure<Message, E>;
  export type RuntimeError<E, ER = never> = ProgramRuntimeError<E, ER>;
  export type TimelineOptions = ProgramTimelineOptions;
  export type Event<Model, Message, E = never> = ProgramEvent<Model, Message, E>;
  export type EventBase = ProgramEventBase;
  export type MessageEvent<Model, Message> = ProgramMessageEvent<Model, Message>;
  export type CommandStartedEvent<Message> = ProgramCommandStartedEvent<Message>;
  export type CommandCompletedEvent<Message> = ProgramCommandCompletedEvent<Message>;
  export type CommandFailedEvent<Message, E> = ProgramCommandFailedEvent<Message, E>;
  export type UpdateFailedEvent<Message, E> = ProgramUpdateFailedEvent<Message, E>;
  export type SubscriptionStartedEvent<Model> = ProgramSubscriptionStartedEvent<Model>;
  export type SubscriptionEmittedEvent<Message> = ProgramSubscriptionEmittedEvent<Message>;
  export type SubscriptionFailedEvent<Message, E> = ProgramSubscriptionFailedEvent<Message, E>;
  export type DisposedEvent = ProgramDisposedEvent;
  export type Phase = ProgramPhase;
  export type Update<Model, Message, E = never, R = never> = ProgramUpdate<Model, Message, E, R>;
  export type Step<Model, Message, E = never, R = never> = ProgramStep<Model, Message, E, R>;
  export type Command<Message, E = never, R = never> = ProgramCommand<Message, E, R>;
  export type CommandInput<Message, E = never, R = never> = ProgramCommandInput<Message, E, R>;
  export type Subscription<Message, E = never, R = never> = ProgramSubscription<Message, E, R>;
  export type SubscriptionInput<Message, E = never, R = never> = ProgramSubscriptionInput<Message, E, R>;
  export type StoryEntry<Model, Message, E = never, R = never> = ProgramStoryEntry<Model, Message, E, R>;
  export type Story<Model, Message, E = never, R = never> = ProgramStory<Model, Message, E, R>;
  export type StoryOptions<Model> = ProgramStoryOptions<Model>;

  export const define = defineProgram;
  export const step = programStepEffect;
  export const story = makeProgramStory;
  export const start = startProgramWithRuntimeError;
  export const next = programNext;
  export const command = programCommand;
  export const effect = programEffect;
  export const dispatch = programDispatch;
  export const commands = programCommands;
  export const subscription = programSubscription;
}
