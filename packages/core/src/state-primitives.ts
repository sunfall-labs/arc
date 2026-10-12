import { Effect, Stream } from "effect";
import { EffectInputCallbackError, type EffectInput } from "./effect-like.js";
import { rejectPlainSyncCallbackValue } from "./effect-input-sync.js";
import {
  StateCommandTypeId,
  StateStepTypeId,
  StateSubscriptionTypeId,
  type StateCommand,
  type StateCommandInput,
  type StateDefinition,
  type StateFailure,
  type StateModelValue,
  type StateMessageValue,
  type StatePhase,
  type StateScope,
  type StateStep,
  type StateSubscription,
  type StateSubscriptionInput,
  type StateTaggedMessage,
  type StateUpdate,
} from "./state-contract.js";

export const isStateStep = <Model, Message, E, R>(
  value: StateUpdate<Model, Message, E, R>,
): value is StateStep<Model, Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [StateStepTypeId]?: unknown })[StateStepTypeId] === StateStepTypeId;

export const isStateCommand = <Message, E, R>(
  value: unknown,
): value is StateCommand<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [StateCommandTypeId]?: unknown })[StateCommandTypeId] === StateCommandTypeId;

export const isStateSubscription = <Message, E, R>(
  value: unknown,
): value is StateSubscription<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [StateSubscriptionTypeId]?: unknown })[StateSubscriptionTypeId] ===
    StateSubscriptionTypeId;

export const normalizeStateCommands = <Message, E, R>(
  input: StateCommandInput<Message, E, R>,
): ReadonlyArray<StateCommand<Message, E, R>> => {
  if (!input) {
    return [];
  }

  return isStateCommand<Message, E, R>(input) ? [input] : input;
};

export const normalizeStateSubscriptions = <Message, E, R>(
  input: StateSubscriptionInput<Message, E, R>,
): ReadonlyArray<StateSubscription<Message, E, R>> => {
  if (!input) {
    return [];
  }

  if (isStateSubscription<Message, E, R>(input)) {
    return [input];
  }

  if (Stream.isStream(input)) {
    return [stateSubscription(input as Stream.Stream<StateMessageValue<Message>, E, R>)];
  }

  return input.flatMap((entry) => normalizeStateSubscriptions(entry));
};

export const makeStateFailure = <Message, E>(
  phase: StatePhase,
  error: E,
  message?: Message,
): StateFailure<Message, E> => ({
  _tag: "StateFailure",
  phase,
  ...(message === undefined ? {} : { message }),
  error,
});

/**
 * Handlers accepted by the inferred `State.define({ ... })` form: one pure
 * handler per message tag. The second parameter, when present, types the
 * message's fields; commands may only emit nothing (use the explicit
 * `State.define<Model, Message>()` form for commands that emit messages).
 */
export type StateInferredHandlers<Model> = {
  readonly [tag: string]: (model: Model, message: never) => StateUpdate<Model, never, any, any>;
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type StateHandlerFields<H> = H extends (...args: infer Args) => any
  ? Args extends readonly [any, infer Fields, ...Array<any>]
    ? [Fields] extends [never]
      ? {}
      : Omit<Fields, "_tag">
    : {}
  : {};

/** The message union an inferred handler map accepts: one tagged message per key. */
export type StateMessagesOf<On> = {
  readonly [Tag in keyof On & string]: Simplify<
    { readonly _tag: Tag } & StateHandlerFields<On[Tag]>
  >;
}[keyof On & string];

type StateHandlerStep<H> = H extends (...args: any) => infer U
  ? Extract<U, StateStep<any, any, any, any>>
  : never;

type StateStepError<S> = S extends StateStep<any, any, infer E, any> ? E : never;
type StateStepRequirements<S> = S extends StateStep<any, any, any, infer R> ? R : never;

/** Command failures an inferred handler map can produce. */
export type StateHandlersError<On> = {
  readonly [Tag in keyof On]: StateStepError<StateHandlerStep<On[Tag]>>;
}[keyof On];

/** Command services an inferred handler map needs. */
export type StateHandlersRequirements<On> = {
  readonly [Tag in keyof On]: StateStepRequirements<StateHandlerStep<On[Tag]>>;
}[keyof On];

/** Input to the inferred `State.define({ ... })` form. */
export interface StateInferredDefinition<Model, On, ES, RS> {
  /** Stable name: labels the model on the `Timeline` and names its `State` causes. */
  readonly name: string;
  /** Who owns a bound instance: each Component instance (the default) or the runtime (`"app"`). */
  readonly scope?: StateScope;
  readonly initial: Model;
  /** One pure handler per message tag; the message union is inferred from it. */
  readonly on: On;
  readonly subscriptions?: (
    model: Model,
  ) => EffectInput<StateSubscriptionInput<StateMessagesOf<On>, ES, RS>, ES, RS>;
}

/**
 * Defines a State: a named model changed only by its messages.
 *
 * The inferred form derives the message union from `on`: each key is a
 * message `_tag`, and a handler's second parameter types that message's
 * fields. The explicit form, `State.define<Model, Message>()({ ... })`, takes
 * the message union up front, which commands that emit the State's own
 * messages need (their messages cannot be inferred from the handlers that
 * return them).
 */
export function defineState<Model, Message extends StateTaggedMessage>(): <E = never, R = never>(
  definition: StateDefinition<Model, Message, E, R> &
    ([StateModelValue<Model>] extends [never] ? never : unknown) &
    ([StateMessageValue<Message>] extends [never] ? never : unknown),
) => StateDefinition<Model, Message, E, R>;
export function defineState<
  Model,
  On extends StateInferredHandlers<NoInfer<Model>>,
  ES = never,
  RS = never,
>(
  definition: StateInferredDefinition<Model, On, ES, RS> &
    ([StateModelValue<Model>] extends [never] ? never : unknown),
): StateDefinition<
  Model,
  StateMessagesOf<On>,
  StateHandlersError<On> | ES,
  StateHandlersRequirements<On> | RS
>;
export function defineState(definition?: unknown): unknown {
  if (definition === undefined) {
    return (explicit: StateDefinition<unknown, StateTaggedMessage>) => validateDefinition(explicit);
  }
  return validateDefinition(definition as StateDefinition<unknown, StateTaggedMessage>);
}

const validateDefinition = <Definition extends StateDefinition<unknown, StateTaggedMessage>>(
  definition: Definition,
): Definition => {
  validateStateModelSync("State.initial", definition.initial);
  return definition;
};

/**
 * Applies one message to a model with the State's handler: a pure,
 * synchronous call that returns the next model and the commands the
 * transition returned, without running them. A throwing handler, a missing
 * handler, or a Promise-shaped model throws.
 */
export const stateStepSync = <Model, Message extends StateTaggedMessage, E = never, R = never>(
  definition: StateDefinition<Model, Message, E, R>,
  model: Model,
  message: StateMessageValue<Message>,
): StateStep<Model, Message, E, R> => {
  type Handler = (
    model: Model,
    message: StateMessageValue<Message>,
  ) => StateUpdate<Model, Message, E, R>;
  const tag = (message as StateTaggedMessage)._tag as Message["_tag"];
  const handler = definition.on[tag] as unknown as Handler | undefined;
  if (handler === undefined) {
    throw new TypeError(`State has no handler for message tag ${String(tag)}.`);
  }
  const update = handler(model, message);
  const step = isStateStep(update) ? update : stateNext<Model, Message, E, R>(update);
  validateStateModelSync("State.update", step.model);
  return step;
};

/** Runs `stateStepSync` for the runtime, turning a throw into `EffectInputCallbackError`. */
export const stateStep = <Model, Message extends StateTaggedMessage, E, R>(
  definition: StateDefinition<Model, Message, E, R>,
  model: Model,
  message: StateMessageValue<Message>,
): Effect.Effect<StateStep<Model, Message, E, R>, EffectInputCallbackError> =>
  Effect.try({
    try: () => stateStepSync(definition, model, message),
    catch: (cause) =>
      cause instanceof EffectInputCallbackError
        ? cause
        : new EffectInputCallbackError({
            operation: "State.update",
            cause,
            guidance:
              "State message handlers must be pure and total. Move Effect work into State.emit(effect).",
          }),
  });

const stateModelPromiseGuidance =
  "State update models must be plain values. Move host Promise work into State.emit(Effect.tryPromise(...)) and emit a follow-up message with the resolved value. If the domain model itself is an Effect, wrap it with Effect.succeed(effectValue).";

const stateMessagePromiseGuidance =
  "State messages must be plain values. Move host Promise work into Effect.tryPromise(...) inside State.emit(...) or a subscription stream before emitting a resolved follow-up message. Direct Effect values are executable work, not messages.";

const stateMessageUndefinedGuidance =
  "State messages cannot be undefined because undefined is reserved for command Effects that intentionally emit no follow-up message. Use a tagged message value instead.";

export const validateStateModelSync = <Model>(
  operation: string,
  model: Model,
): StateModelValue<Model> =>
  rejectPlainSyncCallbackValue(
    operation,
    model,
    stateModelPromiseGuidance,
  ) as StateModelValue<Model>;

export const validateStateMessage = <Message>(
  operation: string,
  message: Message,
): Effect.Effect<StateMessageValue<Message>, EffectInputCallbackError> =>
  Effect.try({
    try: () => {
      if (message === undefined) {
        throw new EffectInputCallbackError({
          operation,
          cause: new TypeError("State messages cannot be undefined."),
          guidance: stateMessageUndefinedGuidance,
        });
      }

      return rejectPlainSyncCallbackValue(
        operation,
        message,
        stateMessagePromiseGuidance,
      ) as StateMessageValue<Message>;
    },
    catch: (cause) =>
      cause instanceof EffectInputCallbackError
        ? cause
        : new EffectInputCallbackError({
            operation,
            cause,
            guidance: stateMessagePromiseGuidance,
          }),
  });

/** Builds a state transition, optionally with commands to run after the model is written. */
export const stateNext = <
  Model,
  Message,
  E = never,
  R = never,
  CommandMessage extends Message = Message,
>(
  model: StateModelValue<Model>,
  commands?: StateCommandInput<CommandMessage, E, R>,
): StateStep<Model, Message, E, R> => ({
  [StateStepTypeId]: StateStepTypeId,
  model: model as Model,
  commands: normalizeStateCommands(commands) as unknown as ReadonlyArray<
    StateCommand<Message, E, R>
  >,
});

/**
 * Command that emits an immediate message, or the message an Effect produces.
 * An Effect that completes with `void` emits nothing.
 */
export function stateEmit<Message>(
  message: StateMessageValue<Message>,
  ..._invalidMessageType: [StateMessageValue<Message>] extends [never]
    ? ["State message types cannot be undefined or void."]
    : []
): StateCommand<Message>;
export function stateEmit<Message, E = never, R = never>(
  effect: Effect.Effect<StateMessageValue<Message>, E, R>,
  ..._invalidMessageType: [StateMessageValue<Message>] extends [never]
    ? ["State message types cannot be undefined or void."]
    : []
): StateCommand<Message, E, R>;
export function stateEmit<A extends void, E = never, R = never, Message = never>(
  effect: Effect.Effect<A, E, R>,
): StateCommand<Message, E, R>;
export function stateEmit<Message, E = never, R = never>(
  effect: Effect.Effect<StateMessageValue<Message> | void, E, R>,
  ..._invalidMessageType: [StateMessageValue<Message>] extends [never]
    ? ["State message types cannot be undefined or void."]
    : []
): StateCommand<Message, E, R>;
export function stateEmit(input: unknown): unknown {
  return {
    [StateCommandTypeId]: StateCommandTypeId,
    effect: Effect.isEffect(input) ? input : Effect.succeed(input),
  };
}

/** Groups commands for use with `State.next(model, State.commands(...))`. */
export const stateCommands = <Message, E = never, R = never>(
  ...commands: ReadonlyArray<StateCommand<Message, E, R> | false | null | undefined>
): ReadonlyArray<StateCommand<Message, E, R>> => commands.filter(isStateCommand<Message, E, R>);

/** Wraps a Stream subscription that emits messages into the State loop. */
export const stateSubscription = <Message, E = never, R = never>(
  stream: Stream.Stream<StateMessageValue<Message>, E, R>,
): StateSubscription<Message, E, R> => ({
  [StateSubscriptionTypeId]: StateSubscriptionTypeId,
  stream,
});
