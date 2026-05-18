import { Effect, Stream } from "effect";
import { EffectInputCallbackError, invokeEffectInput, type EffectInput } from "./effect-like.js";
import { rejectPlainSyncCallbackValue } from "./effect-input-sync.js";
import {
  ProgramCommandTypeId,
  type ProgramHandlerDefinition,
  type ProgramHandlerMap,
  ProgramStepTypeId,
  ProgramSubscriptionTypeId,
  type ProgramCommand,
  type ProgramCommandInput,
  type ProgramDefinition,
  type ProgramFailure,
  type ProgramModelValue,
  type ProgramMessageValue,
  type ProgramPhase,
  type ProgramRuntimeError,
  type ProgramStep,
  type ProgramSubscription,
  type ProgramSubscriptionInput,
  type ProgramTaggedMessage,
  type ProgramUpdate,
} from "./program-contract.js";

export const isProgramStep = <Model, Message, E, R>(
  value: ProgramUpdate<Model, Message, E, R>,
): value is ProgramStep<Model, Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramStepTypeId]?: unknown })[ProgramStepTypeId] === ProgramStepTypeId;

export const isProgramCommand = <Message, E, R>(
  value: unknown,
): value is ProgramCommand<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramCommandTypeId]?: unknown })[ProgramCommandTypeId] ===
    ProgramCommandTypeId;

export const isProgramSubscription = <Message, E, R>(
  value: unknown,
): value is ProgramSubscription<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramSubscriptionTypeId]?: unknown })[ProgramSubscriptionTypeId] ===
    ProgramSubscriptionTypeId;

export const normalizeProgramCommands = <Message, E, R>(
  input: ProgramCommandInput<Message, E, R>,
): ReadonlyArray<ProgramCommand<Message, E, R>> => {
  if (!input) {
    return [];
  }

  return isProgramCommand<Message, E, R>(input) ? [input] : input;
};

export const normalizeProgramSubscriptions = <Message, E, R>(
  input: ProgramSubscriptionInput<Message, E, R>,
): ReadonlyArray<ProgramSubscription<Message, E, R>> => {
  if (!input) {
    return [];
  }

  if (isProgramSubscription<Message, E, R>(input)) {
    return [input];
  }

  if (Stream.isStream(input)) {
    return [programSubscription(input as Stream.Stream<ProgramMessageValue<Message>, E, R>)];
  }

  return input.flatMap((entry) => normalizeProgramSubscriptions(entry));
};

export const makeProgramFailure = <Message, E>(
  phase: ProgramPhase,
  error: E,
  message?: Message,
): ProgramFailure<Message, E> => ({
  _tag: "ProgramFailure",
  phase,
  ...(message === undefined ? {} : { message }),
  error,
});

/** Builds an update callback from exhaustive tagged-message handlers. */
export const programUpdate = <Model, Message extends ProgramTaggedMessage, E = never, R = never>(
  handlers: ProgramHandlerMap<Model, Message, E, R>,
): ProgramDefinition<Model, Message, E, R>["update"] => {
  type Tag = Message["_tag"] & PropertyKey;
  type Handler = (
    model: Model,
    message: ProgramMessageValue<Message>,
  ) => EffectInput<ProgramUpdate<Model, Message, E, R>, E, R>;

  return (model, message) => {
    const tag = (message as ProgramTaggedMessage)._tag as Tag;
    const handler = handlers[tag] as unknown as Handler | undefined;
    if (handler === undefined) {
      throw new TypeError(`Program.update has no handler for message tag ${String(tag)}.`);
    }

    return handler(model, message as ProgramMessageValue<Message>);
  };
};

const isProgramHandlerDefinition = (
  definition: unknown,
): definition is ProgramHandlerDefinition<unknown, ProgramTaggedMessage, unknown, unknown> =>
  typeof definition === "object" && definition !== null && "on" in definition;

/**
 * Defines a reusable Program with centralized model, messages, commands, and subscriptions.
 */
export function defineProgram<Model, Message extends ProgramTaggedMessage, E = never, R = never>(
  definition: ProgramHandlerDefinition<Model, Message, E, R> &
    ([ProgramModelValue<Model>] extends [never] ? never : unknown) &
    ([ProgramMessageValue<Message>] extends [never] ? never : unknown),
): ProgramDefinition<Model, Message, E, R>;
export function defineProgram<Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R> &
    ([ProgramModelValue<Model>] extends [never] ? never : unknown) &
    ([ProgramMessageValue<Message>] extends [never] ? never : unknown),
): ProgramDefinition<Model, Message, E, R>;
export function defineProgram<Model, Message, E = never, R = never>(
  definition:
    | (ProgramDefinition<Model, Message, E, R> &
        ([ProgramModelValue<Model>] extends [never] ? never : unknown) &
        ([ProgramMessageValue<Message>] extends [never] ? never : unknown))
    | (ProgramHandlerDefinition<Model, Extract<Message, ProgramTaggedMessage>, E, R> &
        ([ProgramModelValue<Model>] extends [never] ? never : unknown) &
        ([ProgramMessageValue<Message>] extends [never] ? never : unknown)),
): ProgramDefinition<Model, Message, E, R> {
  validateProgramModelSync("Program.initial", definition.initial);
  if (isProgramHandlerDefinition(definition)) {
    const { on, ...rest } = definition as ProgramHandlerDefinition<
      Model,
      Extract<Message, ProgramTaggedMessage>,
      E,
      R
    >;
    return {
      ...rest,
      update: programUpdate(on) as ProgramDefinition<Model, Message, E, R>["update"],
    } as ProgramDefinition<Model, Message, E, R>;
  }

  return definition as ProgramDefinition<Model, Message, E, R>;
}

/** Runs one Program update and normalizes the result into a ProgramStep. */
export const programStepEffect = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>,
  model: Model,
  message: ProgramMessageValue<Message>,
): Effect.Effect<
  ProgramStep<Model, Message, E, R>,
  ProgramFailure<Message, ProgramRuntimeError<E>>,
  R
> =>
  invokeEffectInput("Program.update", definition.update, model, message).pipe(
    Effect.flatMap((update) =>
      validateProgramStepModelEffect(
        isProgramStep(update) ? update : programNext<Model, Message, E, R>(update),
      ),
    ),
    Effect.mapError((error) =>
      makeProgramFailure<Message, ProgramRuntimeError<E>>("Update", error, message as Message),
    ),
  );

const programModelPromiseGuidance =
  "Program update models must be plain values. Move host Promise work into Program.emit(Effect.tryPromise(...)) and emit a follow-up message with the resolved value. If the domain model itself is an Effect, wrap it with Effect.succeed(effectValue).";

const programMessagePromiseGuidance =
  "Program messages must be plain values. Move host Promise work into Effect.tryPromise(...) inside Program.emit(...) or a subscription stream before emitting a resolved follow-up message. Direct Effect values are executable work, not messages.";

const programMessageUndefinedGuidance =
  "Program messages cannot be undefined because undefined is reserved for command Effects that intentionally emit no follow-up message. Use a tagged message value instead.";

export const validateProgramStepModelEffect = <Model, Message, E, R>(
  step: ProgramStep<Model, Message, E, R>,
): Effect.Effect<ProgramStep<Model, Message, E, R>, EffectInputCallbackError> =>
  Effect.try({
    try: () => {
      validateProgramModelSync("Program.update", step.model);
      return step;
    },
    catch: (cause) =>
      cause instanceof EffectInputCallbackError
        ? cause
        : new EffectInputCallbackError({
            operation: "Program.update",
            cause,
            guidance: programModelPromiseGuidance,
          }),
  });

export const validateProgramModelSync = <Model>(
  operation: string,
  model: Model,
): ProgramModelValue<Model> =>
  rejectPlainSyncCallbackValue(
    operation,
    model,
    programModelPromiseGuidance,
  ) as ProgramModelValue<Model>;

export const validateProgramMessageEffect = <Message>(
  operation: string,
  message: Message,
): Effect.Effect<ProgramMessageValue<Message>, EffectInputCallbackError> =>
  Effect.try({
    try: () => {
      if (message === undefined) {
        throw new EffectInputCallbackError({
          operation,
          cause: new TypeError("Program messages cannot be undefined."),
          guidance: programMessageUndefinedGuidance,
        });
      }

      return rejectPlainSyncCallbackValue(
        operation,
        message,
        programMessagePromiseGuidance,
      ) as ProgramMessageValue<Message>;
    },
    catch: (cause) =>
      cause instanceof EffectInputCallbackError
        ? cause
        : new EffectInputCallbackError({
            operation,
            cause,
            guidance: programMessagePromiseGuidance,
          }),
  });

/** Builds a state transition, optionally with commands to run after the model is written. */
export const programNext = <
  Model,
  Message,
  E = never,
  R = never,
  CommandMessage extends Message = Message,
>(
  model: ProgramModelValue<Model>,
  commands?: ProgramCommandInput<CommandMessage, E, R>,
): ProgramStep<Model, Message, E, R> => ({
  [ProgramStepTypeId]: ProgramStepTypeId,
  model: model as Model,
  commands: normalizeProgramCommands(commands) as unknown as ReadonlyArray<
    ProgramCommand<Message, E, R>
  >,
});

/** Effect command that emits its successful value as the next message. */
export const programCommand = <Message, E = never, R = never>(
  effect: Effect.Effect<ProgramMessageValue<Message> | void, E, R>,
  ..._invalidMessageType: [ProgramMessageValue<Message>] extends [never]
    ? ["Program message types cannot be undefined or void."]
    : []
): ProgramCommand<Message, E, R> => ({
  [ProgramCommandTypeId]: ProgramCommandTypeId,
  effect,
});

/** Command that emits an immediate or Effect-produced follow-up message. */
export function programEmit<Message>(
  message: ProgramMessageValue<Message>,
  ..._invalidMessageType: [ProgramMessageValue<Message>] extends [never]
    ? ["Program message types cannot be undefined or void."]
    : []
): ProgramCommand<Message>;
export function programEmit<Message, E = never, R = never>(
  effect: Effect.Effect<ProgramMessageValue<Message>, E, R>,
  ..._invalidMessageType: [ProgramMessageValue<Message>] extends [never]
    ? ["Program message types cannot be undefined or void."]
    : []
): ProgramCommand<Message, E, R>;
export function programEmit<Message, E = never, R = never>(
  input: ProgramMessageValue<Message> | Effect.Effect<ProgramMessageValue<Message>, E, R>,
): ProgramCommand<Message, E, R> {
  return {
    [ProgramCommandTypeId]: ProgramCommandTypeId,
    effect: Effect.isEffect(input) ? input : Effect.succeed(input),
  };
}

/** Command that immediately dispatches a message. */
export const programDispatch = <Message>(
  message: ProgramMessageValue<Message>,
): ProgramCommand<Message> => ({
  [ProgramCommandTypeId]: ProgramCommandTypeId,
  effect: Effect.succeed(message),
});

/** Command for background Effects that do not emit follow-up messages. */
export const programEffect = <Message = never, E = never, R = never>(
  effect: Effect.Effect<void, E, R>,
): ProgramCommand<Message, E, R> => ({
  [ProgramCommandTypeId]: ProgramCommandTypeId,
  effect,
});

/** Groups commands for use with `Program.next(model, Program.commands(...))`. */
export const programCommands = <Message, E = never, R = never>(
  ...commands: ReadonlyArray<ProgramCommand<Message, E, R> | false | null | undefined>
): ReadonlyArray<ProgramCommand<Message, E, R>> => commands.filter(isProgramCommand<Message, E, R>);

/** Wraps a Stream subscription that emits messages into the Program loop. */
export const programSubscription = <Message, E = never, R = never>(
  stream: Stream.Stream<ProgramMessageValue<Message>, E, R>,
): ProgramSubscription<Message, E, R> => ({
  [ProgramSubscriptionTypeId]: ProgramSubscriptionTypeId,
  stream,
});
