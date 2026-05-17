import { Effect } from "effect";
import {
  type ProgramCommand,
  type ProgramDefinition,
  type ProgramFailure,
  type ProgramModelValue,
  type ProgramMessageValue,
  type ProgramRuntimeError,
  type ProgramStory,
  type ProgramStoryEntry,
  type ProgramStoryOptions,
} from "./program-contract.js";
import {
  makeProgramFailure,
  programStepEffect,
  validateProgramModelSync,
  validateProgramMessageEffect,
} from "./program-primitives.js";
import { Signal } from "./signal.js";

/** Creates an Effect-first story harness for deterministic Program tests. */
export const makeProgramStory = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>,
  options: ProgramStoryOptions<Model> = {},
): ProgramStory<Model, Message, E, R> => {
  const initial = validateProgramModelSync(
    "Program.story.initial",
    "initial" in options ? options.initial : definition.initial,
  );
  const model = Signal.make(initial as Model);
  const history = Signal.make<ReadonlyArray<ProgramStoryEntry<Model, Message, E, R>>>([]);

  const send = (
    message: ProgramMessageValue<Message>,
  ): Effect.Effect<
    ProgramStoryEntry<Model, Message, E, R>,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  > =>
    Effect.gen(function* () {
      const before = Signal.peek(model);
      const validMessage = yield* validateProgramMessageEffect<Message>(
        "Program.story.send",
        message as Message,
      ).pipe(
        Effect.mapError((error) =>
          makeProgramFailure<Message, ProgramRuntimeError<E>>("Update", error, message as Message),
        ),
      );
      const step = yield* programStepEffect(definition, before, validMessage);
      const entry: ProgramStoryEntry<Model, Message, E, R> = {
        message: validMessage as Message,
        before,
        after: step.model as Model,
        commands: step.commands,
      };
      yield* Effect.sync(() => {
        model.set(step.model as Model);
        history.update((current) => [...current, entry]);
      });
      return entry;
    });

  const run = (
    command: ProgramCommand<Message, E, R>,
  ): Effect.Effect<
    ProgramMessageValue<Message> | void,
    ProgramFailure<Message, ProgramRuntimeError<E>>,
    R
  > =>
    command.effect.pipe(
      Effect.flatMap((message) =>
        message === undefined
          ? Effect.succeed(undefined)
          : validateProgramMessageEffect<Message>("Program.story.run", message as Message).pipe(
              Effect.mapError((error) =>
                makeProgramFailure<Message, ProgramRuntimeError<E>>("Command", error),
              ),
            ),
      ),
      Effect.mapError((error) =>
        error && typeof error === "object" && "_tag" in error && error._tag === "ProgramFailure"
          ? (error as ProgramFailure<Message, ProgramRuntimeError<E>>)
          : makeProgramFailure<Message, ProgramRuntimeError<E>>(
              "Command",
              error as ProgramRuntimeError<E>,
            ),
      ),
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
    reset: (next: ProgramModelValue<Model> = definition.initial) => {
      const validNext = validateProgramModelSync("Program.story.reset", next);
      model.set(validNext as Model);
      history.set([]);
    },
  };
};
