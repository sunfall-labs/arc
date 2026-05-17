import { Effect, Stream } from "effect";
import {
  EffectInputCallbackError,
  invokeEffectInput,
  type RejectPromiseLikeValue
} from "./effect-like.js";
import { rejectPromiseLikeSyncCallbackValue } from "./effect-input-sync.js";
import {
  ProgramCommandTypeId,
  ProgramStepTypeId,
  ProgramSubscriptionTypeId,
  type ProgramCommand,
  type ProgramCommandInput,
  type ProgramDefinition,
  type ProgramFailure,
  type ProgramMessageValue,
  type ProgramPhase,
  type ProgramRuntimeError,
  type ProgramStep,
  type ProgramSubscription,
  type ProgramSubscriptionInput,
  type ProgramUpdate
} from "./program-contract.js";

export const isProgramStep = <Model, Message, E, R>(
  value: ProgramUpdate<Model, Message, E, R>
): value is ProgramStep<Model, Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramStepTypeId]?: unknown })[ProgramStepTypeId] === ProgramStepTypeId;

export const isProgramCommand = <Message, E, R>(
  value: unknown
): value is ProgramCommand<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramCommandTypeId]?: unknown })[ProgramCommandTypeId] === ProgramCommandTypeId;

export const isProgramSubscription = <Message, E, R>(
  value: unknown
): value is ProgramSubscription<Message, E, R> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [ProgramSubscriptionTypeId]?: unknown })[ProgramSubscriptionTypeId] === ProgramSubscriptionTypeId;

export const normalizeProgramCommands = <Message, E, R>(
  input: ProgramCommandInput<Message, E, R>
): ReadonlyArray<ProgramCommand<Message, E, R>> => {
  if (!input) {
    return [];
  }

  return isProgramCommand<Message, E, R>(input) ? [input] : input;
};

export const normalizeProgramSubscriptions = <Message, E, R>(
  input: ProgramSubscriptionInput<Message, E, R>
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
  message?: Message
): ProgramFailure<Message, E> => ({
  _tag: "ProgramFailure",
  phase,
  ...(message === undefined ? {} : { message }),
  error
});

/** Defines a reusable Program with centralized model, messages, commands, and subscriptions. */
export const defineProgram = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R> &
    (RejectPromiseLikeValue<Message> extends never ? never : unknown)
): ProgramDefinition<Model, Message, E, R> => definition;

/** Runs one Program update and normalizes the result into a ProgramStep. */
export const programStepEffect = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>,
  model: Model,
  message: ProgramMessageValue<Message>
): Effect.Effect<
  ProgramStep<Model, Message, E, R>,
  ProgramFailure<Message, ProgramRuntimeError<E>>,
  R
> =>
  invokeEffectInput("Program.update", definition.update, model, message).pipe(
    Effect.flatMap((update) =>
      validateProgramStepModelEffect(
        isProgramStep(update)
          ? update
          : programNext<Model, Message, E, R>(update)
      )
    ),
    Effect.mapError((error) => makeProgramFailure("Update", error, message))
  );

const programModelPromiseGuidance =
  "Program update models must be plain values. Move host Promise work into Program.command(Effect.tryPromise(...)) and dispatch a follow-up message with the resolved value.";

const programMessagePromiseGuidance =
  "Program messages must be plain values. Move host Promise work into Effect.tryPromise(...) inside Program.command(...) or a subscription stream before emitting a resolved follow-up message.";

export const validateProgramStepModelEffect = <Model, Message, E, R>(
  step: ProgramStep<Model, Message, E, R>
): Effect.Effect<ProgramStep<Model, Message, E, R>, EffectInputCallbackError> =>
  Effect.try({
    try: () => {
      rejectPromiseLikeSyncCallbackValue(
        "Program.update",
        step.model,
        programModelPromiseGuidance
      );
      return step;
    },
    catch: (cause) =>
      cause instanceof EffectInputCallbackError
        ? cause
        : new EffectInputCallbackError({
            operation: "Program.update",
            cause,
            guidance: programModelPromiseGuidance
          })
  });

export const validateProgramMessageEffect = <Message>(
  operation: string,
  message: Message
): Effect.Effect<ProgramMessageValue<Message>, EffectInputCallbackError> =>
  Effect.try({
    try: () =>
      rejectPromiseLikeSyncCallbackValue(
        operation,
        message,
        programMessagePromiseGuidance
      ) as ProgramMessageValue<Message>,
    catch: (cause) =>
      cause instanceof EffectInputCallbackError
        ? cause
        : new EffectInputCallbackError({
            operation,
            cause,
            guidance: programMessagePromiseGuidance
          })
  });

/** Builds a state transition, optionally with commands to run after the model is written. */
export const programNext = <Model, Message, E = never, R = never>(
  model: Model & RejectPromiseLikeValue<Model>,
  commands?: ProgramCommandInput<Message, E, R>
): ProgramStep<Model, Message, E, R> => ({
  [ProgramStepTypeId]: ProgramStepTypeId,
  model,
  commands: normalizeProgramCommands(commands)
});

/** Effect command that emits its successful value as the next message. */
export const programCommand = <Message, E = never, R = never>(
  effect: Effect.Effect<ProgramMessageValue<Message> | void, E, R>
): ProgramCommand<Message, E, R> => ({
  [ProgramCommandTypeId]: ProgramCommandTypeId,
  effect
});

/** Command that immediately dispatches a message. */
export const programDispatch = <Message>(
  message: ProgramMessageValue<Message>
): ProgramCommand<Message> =>
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
  stream: Stream.Stream<ProgramMessageValue<Message>, E, R>
): ProgramSubscription<Message, E, R> => ({
  [ProgramSubscriptionTypeId]: ProgramSubscriptionTypeId,
  stream
});
