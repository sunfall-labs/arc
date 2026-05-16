import type { Effect, Stream } from "effect";
import type {
  EffectInput,
  EffectInputCallbackError,
  EffectInputError,
  EffectInputRequirements
} from "./effect-like.js";
import type { ReadableSignal } from "./signal.js";

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
