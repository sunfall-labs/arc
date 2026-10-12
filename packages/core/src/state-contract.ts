import { Data, type Effect, type Stream } from "effect";
import type { EffectInput, EffectInputCallbackError, PlainValue } from "./effect-like.js";
import type { ReadableSignal, WritableSignal } from "./signal.js";

/** Runtime marker for values created by `State.next(...)` or `State.commands(...)`. */
export const StateStepTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/StateStep",
) as typeof StateStepTypeId;
/** Runtime marker for Effect-backed State commands. */
export const StateCommandTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/StateCommand",
) as typeof StateCommandTypeId;
/** Runtime marker for Stream-backed State subscriptions. */
export const StateSubscriptionTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/StateSubscription",
) as typeof StateSubscriptionTypeId;
/** Runtime marker carrying a running State's model cell (`State.Ref`). */
export const StateRefTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/StateRef",
) as typeof StateRefTypeId;

/** Runtime phase that produced a State failure. */
export type StatePhase = "Update" | "Command" | "Subscription";

type IsAny<T> = 0 extends 1 & T ? true : false;
type StateUnknownMessageValue = Exclude<PlainValue<unknown>, undefined>;
type NonUndefinedStateMessage<Message> =
  IsAny<Message> extends true
    ? StateUnknownMessageValue
    : [unknown] extends [Message]
      ? StateUnknownMessageValue
      : [Message] extends [void]
        ? never
        : undefined extends Message
          ? never
          : PlainValue<Message>;

/**
 * Plain State message value.
 *
 * Promise-shaped messages must be adapted through Effects first. State
 * messages cannot be `undefined` or `void`; command Effects reserve
 * `undefined`/`void` as the no-message sentinel. Direct Effect values are
 * executable work, not messages.
 */
export type StateMessageValue<Message> = NonUndefinedStateMessage<Message>;

/**
 * Plain State model value.
 *
 * Promise-shaped models must be resolved inside Effects first. Direct Effect
 * values are executable work, not model data; wrap Effect-valued domain data in
 * `Effect.succeed(effectValue)` before returning it from an update.
 */
export type StateModelValue<Model> = PlainValue<Model>;

/** Failure reported by a running State without tearing down the UI loop. */
export interface StateFailure<Message, E> {
  readonly _tag: "StateFailure";
  readonly phase: StatePhase;
  readonly message?: Message;
  readonly error: E;
}

/** Effect command that may emit one follow-up message. */
export interface StateCommand<Message, E = never, R = never> {
  readonly [StateCommandTypeId]: typeof StateCommandTypeId;
  readonly effect: Effect.Effect<StateMessageValue<Message> | void, E, R>;
}

/** Accepted command input: none, one command, several commands, or no-op sentinels. */
export type StateCommandInput<Message, E = never, R = never> =
  | StateCommand<Message, E, R>
  | ReadonlyArray<StateCommand<Message, E, R>>
  | false
  | null
  | undefined;

/** State transition plus optional commands to run after the model is written. */
export interface StateStep<Model, Message, E = never, R = never> {
  readonly [StateStepTypeId]: typeof StateStepTypeId;
  readonly model: Model;
  readonly commands: ReadonlyArray<StateCommand<Message, E, R>>;
}

/** Value a message handler returns: the next model, or the next model plus commands. */
export type StateUpdate<Model, Message, E = never, R = never> =
  | StateModelValue<Model>
  | StateStep<Model, Message, E, R>;

/** Tagged message shape every State message has. */
export interface StateTaggedMessage {
  readonly _tag: string;
}

/**
 * Exhaustive message handlers keyed by each message `_tag`.
 *
 * Handlers are pure and synchronous: they return the next model, optionally
 * with commands. Effect work goes in commands (`State.emit(effect)`), so a
 * transition can be tested by calling `State.step(...)` with no runtime.
 */
export type StateHandlerMap<Model, Message extends StateTaggedMessage, E = never, R = never> = {
  readonly [Tag in Message["_tag"]]: (
    model: Model,
    message: StateMessageValue<Extract<Message, { readonly _tag: Tag }>>,
  ) => StateUpdate<Model, Message, E, R>;
};

/** Stream subscription that emits messages into a State. */
export interface StateSubscription<Message, E = never, R = never> {
  readonly [StateSubscriptionTypeId]: typeof StateSubscriptionTypeId;
  readonly stream: Stream.Stream<StateMessageValue<Message>, E, R>;
}

/** Accepted subscription input: none, one stream/subscription, or nested groups. */
export type StateSubscriptionInput<Message, E = never, R = never> =
  | Stream.Stream<StateMessageValue<Message>, E, R>
  | StateSubscription<Message, E, R>
  | ReadonlyArray<StateSubscriptionInput<Message, E, R>>
  | false
  | null
  | undefined;

/** Definition for a headless model/message loop with Effect-owned work. */
export interface StateDefinition<Model, Message extends StateTaggedMessage, E = never, R = never> {
  /** Stable name: labels the model on the `Timeline` and names its `State` causes. */
  readonly name: string;
  readonly initial: StateModelValue<Model>;
  /** Exhaustive pure message handlers keyed by each message `_tag`. */
  readonly on: StateHandlerMap<Model, Message, E, R>;
  readonly subscriptions?: (
    model: Model,
  ) => EffectInput<StateSubscriptionInput<Message, E, R>, E, R>;
}

/** State error channel plus callback and Runtime Spine startup/provision errors. */
export type StateRuntimeError<E, ER = never> = E | EffectInputCallbackError | ER;

/** Error channel for live `dispatch(...)`, including disposal drops. */
export type StateDispatchError<E, ER = never> = StateRuntimeError<E, ER> | StateDisposed;

/**
 * Error reported when `dispatch(...)` cannot apply because the State
 * was disposed before the message update committed.
 */
export class StateDisposed extends Data.TaggedError("StateDisposed")<{
  readonly reason: string;
}> {}

/**
 * A running State's model, as an Action's `optimistic` transaction patches it
 * (`transaction.set(state, update)`). Every `State.Instance` and
 * `Component.state` handle is one.
 */
export interface StateRef<Model> {
  /** @internal The model cell; written only by the State loop and optimistic layers. */
  readonly [StateRefTypeId]: WritableSignal<Model>;
}

/** Running State handle with model state, dispatch, failure, and disposal APIs. */
export interface StateInstance<Model, Message, E = never, DispatchE = E> extends StateRef<Model> {
  /** Centralized model signal for adapter-neutral reads and derived state. */
  readonly model: ReadableSignal<Model>;
  /** Accumulated typed failures from updates, commands, and subscriptions. */
  readonly failures: ReadableSignal<ReadonlyArray<StateFailure<Message, E>>>;
  /**
   * Effect dispatch that completes after the message update has committed.
   *
   * If disposal happens before the update commits, the Effect fails with a
   * `StateFailure` whose error is `StateDisposed`.
   */
  dispatch(
    message: StateMessageValue<Message>,
  ): Effect.Effect<void, StateFailure<Message, DispatchE>>;
  /** Clears accumulated failures. */
  clearFailures(): void;
  /** Stops the message loop and interrupts active subscriptions/commands. */
  dispose: Effect.Effect<void>;
}
