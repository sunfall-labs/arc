import { Data, type Effect, type Stream } from "effect";
import type {
  EffectInput,
  EffectInputCallbackError,
  EffectInputError,
  EffectInputRequirements,
  PlainValue,
} from "./effect-like.js";
import type { ReadableSignal } from "./signal.js";

/** Runtime marker for values created by `Program.next(...)` or `Program.commands(...)`. */
export const ProgramStepTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ProgramStep",
) as typeof ProgramStepTypeId;
/** Runtime marker for Effect-backed Program commands. */
export const ProgramCommandTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ProgramCommand",
) as typeof ProgramCommandTypeId;
/** Runtime marker for Stream-backed Program subscriptions. */
export const ProgramSubscriptionTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ProgramSubscription",
) as typeof ProgramSubscriptionTypeId;

/** Runtime phase that produced a Program failure or timeline event. */
export type ProgramPhase = "Update" | "Command" | "Subscription";

type IsAny<T> = 0 extends 1 & T ? true : false;
type ProgramUnknownMessageValue = Exclude<PlainValue<unknown>, undefined>;
type NonUndefinedProgramMessage<Message> =
  IsAny<Message> extends true
    ? ProgramUnknownMessageValue
    : [unknown] extends [Message]
      ? ProgramUnknownMessageValue
      : [Message] extends [void]
        ? never
        : undefined extends Message
          ? never
          : PlainValue<Message>;

/**
 * Plain Program message value.
 *
 * Promise-shaped messages must be adapted through Effects first. Program
 * messages cannot be `undefined` or `void`; command Effects reserve
 * `undefined`/`void` as the no-message sentinel. Direct Effect values are
 * executable work, not messages.
 */
export type ProgramMessageValue<Message> = NonUndefinedProgramMessage<Message>;

/**
 * Plain Program model value.
 *
 * Promise-shaped models must be resolved inside Effects first. Direct Effect
 * values are executable work, not model data; wrap Effect-valued domain data in
 * `Effect.succeed(effectValue)` before returning it from an update.
 */
export type ProgramModelValue<Model> = PlainValue<Model>;

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
  readonly effect: Effect.Effect<ProgramMessageValue<Message> | void, E, R>;
}

/** Accepted command input: none, one command, several commands, or no-op sentinels. */
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

/** Value returned by an update callback: a model or a model plus commands. */
export type ProgramUpdate<Model, Message, E = never, R = never> =
  | ProgramModelValue<Model>
  | ProgramStep<Model, Message, E, R>;

/** Tagged Program message shape accepted by handler-map definitions. */
export interface ProgramTaggedMessage {
  readonly _tag: PropertyKey;
}

/** Exhaustive tag-indexed handlers for Program message unions. */
export type ProgramHandlerMap<Model, Message extends ProgramTaggedMessage, E = never, R = never> = {
  readonly [Tag in Message["_tag"] & PropertyKey]: (
    model: Model,
    message: ProgramMessageValue<Extract<Message, { readonly _tag: Tag }>>,
  ) => EffectInput<ProgramUpdate<Model, Message, E, R>, E, R>;
};

/** Stream subscription that emits messages into a Program. */
export interface ProgramSubscription<Message, E = never, R = never> {
  readonly [ProgramSubscriptionTypeId]: typeof ProgramSubscriptionTypeId;
  readonly stream: Stream.Stream<ProgramMessageValue<Message>, E, R>;
}

/** Accepted subscription input: none, one stream/subscription, or nested groups. */
export type ProgramSubscriptionInput<Message, E = never, R = never> =
  | Stream.Stream<ProgramMessageValue<Message>, E, R>
  | ProgramSubscription<Message, E, R>
  | ReadonlyArray<ProgramSubscriptionInput<Message, E, R>>
  | false
  | null
  | undefined;

/** Extracts the error channel from a Program update EffectInput. */
export type ProgramUpdateError<Out> = EffectInputError<Out>;
/** Extracts the requirement channel from a Program update EffectInput. */
export type ProgramUpdateRequirements<Out> = EffectInputRequirements<Out>;
/** Extracts the error channel from a Program subscription EffectInput. */
export type ProgramSubscriptionError<Out> = EffectInputError<Out>;
/** Extracts the requirement channel from a Program subscription EffectInput. */
export type ProgramSubscriptionRequirements<Out> = EffectInputRequirements<Out>;

/** Definition for a headless model/message loop with Effect-owned work. */
export interface ProgramDefinition<Model, Message, E = never, R = never> {
  /** Optional stable name used by timeline/devtools events. */
  readonly name?: string;
  readonly initial: ProgramModelValue<Model>;
  readonly update: (
    model: Model,
    message: ProgramMessageValue<Message>,
  ) => EffectInput<ProgramUpdate<Model, Message, E, R>, E, R>;
  readonly subscriptions?: (
    model: Model,
  ) => EffectInput<ProgramSubscriptionInput<Message, E, R>, E, R>;
  /** Bounded runtime event retention. Set to `false` to disable timeline storage. */
  readonly timeline?: false | ProgramTimelineOptions;
}

/** Definition shorthand for tagged-message Programs. */
export interface ProgramHandlerDefinition<
  Model,
  Message extends ProgramTaggedMessage,
  E = never,
  R = never,
> {
  /** Optional stable name used by timeline/devtools events. */
  readonly name?: string;
  readonly initial: ProgramModelValue<Model>;
  /** Exhaustive message handlers keyed by each message `_tag`. */
  readonly on: ProgramHandlerMap<Model, Message, E, R>;
  readonly subscriptions?: (
    model: Model,
  ) => EffectInput<ProgramSubscriptionInput<Message, E, R>, E, R>;
  /** Bounded runtime event retention. Set to `false` to disable timeline storage. */
  readonly timeline?: false | ProgramTimelineOptions;
}

/** Program error channel plus callback and Runtime Spine startup/provision errors. */
export type ProgramRuntimeError<E, ER = never> = E | EffectInputCallbackError | ER;

/** Error channel for live `dispatchEffect(...)`, including disposal drops. */
export type ProgramDispatchError<E, ER = never> = ProgramRuntimeError<E, ER> | ProgramDisposed;

/**
 * Error reported when `dispatchEffect(...)` cannot apply because the Program
 * was disposed before the message update committed.
 */
export class ProgramDisposed extends Data.TaggedError("ProgramDisposed")<{
  readonly reason: string;
}> {}

/** Bounded retention options for Program timeline events. */
export interface ProgramTimelineOptions {
  /** Maximum retained timeline events. Defaults to 200. */
  readonly limit?: number;
}

/** Shared metadata carried by every Program timeline event. */
export interface ProgramEventBase {
  readonly sequence: number;
  readonly program?: string;
}

/** Timeline event recorded when a message is committed. */
export interface ProgramMessageEvent<Model, Message> extends ProgramEventBase {
  readonly _tag: "Message";
  readonly message: Message;
  readonly before: Model;
  readonly after: Model;
  readonly commandCount: number;
}

/** Timeline event recorded before a command fiber starts. */
export interface ProgramCommandStartedEvent<Message> extends ProgramEventBase {
  readonly _tag: "CommandStarted";
  readonly commandId: number;
  readonly source?: Message;
}

/** Timeline event recorded when a command emits a message or completes empty. */
export interface ProgramCommandCompletedEvent<Message> extends ProgramEventBase {
  readonly _tag: "CommandCompleted";
  readonly commandId: number;
  readonly source?: Message;
  readonly emitted?: Message;
}

/** Timeline event recorded when a command fails through the Program error channel. */
export interface ProgramCommandFailedEvent<Message, E> extends ProgramEventBase {
  readonly _tag: "CommandFailed";
  readonly commandId: number;
  readonly source?: Message;
  readonly failure: ProgramFailure<Message, E>;
}

/** Timeline event recorded when the update callback fails. */
export interface ProgramUpdateFailedEvent<Message, E> extends ProgramEventBase {
  readonly _tag: "UpdateFailed";
  readonly failure: ProgramFailure<Message, E>;
}

/** Timeline event recorded when model-dependent subscriptions start. */
export interface ProgramSubscriptionStartedEvent<Model> extends ProgramEventBase {
  readonly _tag: "SubscriptionStarted";
  readonly model: Model;
  readonly count: number;
}

/** Timeline event recorded when a subscription emits a message. */
export interface ProgramSubscriptionEmittedEvent<Message> extends ProgramEventBase {
  readonly _tag: "SubscriptionEmitted";
  readonly message: Message;
}

/** Timeline event recorded when a subscription fails through the Program error channel. */
export interface ProgramSubscriptionFailedEvent<Message, E> extends ProgramEventBase {
  readonly _tag: "SubscriptionFailed";
  readonly failure: ProgramFailure<Message, E>;
}

/** Timeline event recorded when a Program runtime is disposed. */
export interface ProgramDisposedEvent extends ProgramEventBase {
  readonly _tag: "Disposed";
}

/** Union of all Program runtime timeline event shapes. */
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

/** Deterministic Program runner for docs, tests, and reducer-style examples. */
export interface ProgramStory<Model, Message, E = never, R = never> {
  /** Current model after all story messages that have been applied. */
  readonly model: ReadableSignal<Model>;
  /** Alias for `model`, useful in state-oriented tests. */
  readonly state: ReadableSignal<Model>;
  /** Applied transitions, including returned commands that have not run implicitly. */
  readonly history: ReadableSignal<ReadonlyArray<ProgramStoryEntry<Model, Message, E, R>>>;
  /** Applies one message through `update` and records the resulting transition. */
  send(
    message: ProgramMessageValue<Message>,
  ): Effect.Effect<
    ProgramStoryEntry<Model, Message, E, R>,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  >;
  /** Runs one command without applying its emitted message. */
  run(
    command: ProgramCommand<Message, E, R>,
  ): Effect.Effect<
    ProgramMessageValue<Message> | void,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  >;
  /** Runs one command and applies its emitted message when it produces one. */
  resolve(
    command: ProgramCommand<Message, E, R>,
  ): Effect.Effect<
    ProgramStoryEntry<Model, Message, E, R> | undefined,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  >;
  /** Resets the story to a known model and clears history. */
  reset(model?: ProgramModelValue<Model>): void;
}

/** Options for creating a deterministic Program story. */
export interface ProgramStoryOptions<Model> {
  readonly initial?: ProgramModelValue<Model>;
}

/** Running Program handle with model state, dispatch, failure, timeline, and disposal APIs. */
export interface ProgramInstance<Model, Message, E = never, DispatchE = E> {
  /** Centralized model signal for adapter-neutral reads and derived state. */
  readonly model: ReadableSignal<Model>;
  /** Alias for `model`, useful in UI code that prefers state vocabulary. */
  readonly state: ReadableSignal<Model>;
  /** Accumulated typed failures from updates, commands, and subscriptions. */
  readonly failures: ReadableSignal<ReadonlyArray<ProgramFailure<Message, E>>>;
  /** Bounded runtime timeline for messages, commands, subscriptions, and failures. */
  readonly timeline: ReadableSignal<ReadonlyArray<ProgramEvent<Model, Message, E>>>;
  /** Fire-and-forget dispatch for UI event handlers. */
  dispatch(message: ProgramMessageValue<Message>): void;
  /**
   * Effect dispatch that completes after the message update has committed.
   *
   * If disposal happens before the update commits, the Effect fails with a
   * `ProgramFailure` whose error is `ProgramDisposed`.
   */
  dispatchEffect(
    message: ProgramMessageValue<Message>,
  ): Effect.Effect<void, ProgramFailure<Message, DispatchE>>;
  /** Clears accumulated failures. */
  clearFailures(): void;
  /** Clears retained timeline events without changing model or failures. */
  clearTimeline(): void;
  /** Stops the message loop and interrupts active subscriptions/commands. */
  disposeEffect: Effect.Effect<void>;
}
