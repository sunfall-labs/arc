import { Effect } from "effect";
import {
  type ProgramCommand,
  type ProgramDefinition,
  type ProgramFailure,
  type ProgramMessageValue,
  type ProgramRuntimeError,
  type ProgramStory,
  type ProgramStoryEntry,
  type ProgramStoryOptions
} from "./program-contract.js";
import {
  makeProgramFailure,
  programStepEffect,
  validateProgramMessageEffect
} from "./program-primitives.js";
import { Signal } from "./signal.js";

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
      const validMessage = yield* validateProgramMessageEffect("Program.story.send", message).pipe(
        Effect.mapError((error) =>
          makeProgramFailure<Message, ProgramRuntimeError<E>>("Update", error, message)
        )
      );
      const step = yield* programStepEffect(definition, before, validMessage);
      const entry: ProgramStoryEntry<Model, Message, E, R> = {
        message: validMessage,
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
  ): Effect.Effect<ProgramMessageValue<Message> | void, ProgramFailure<Message, ProgramRuntimeError<E>>, R> =>
    command.effect.pipe(
      Effect.flatMap((message) =>
        message === undefined
          ? Effect.succeed(undefined)
          : validateProgramMessageEffect("Program.story.run", message).pipe(
              Effect.mapError((error) =>
                makeProgramFailure<Message, ProgramRuntimeError<E>>("Command", error)
              )
            )
      ),
      Effect.mapError((error) =>
        error && typeof error === "object" && "_tag" in error && error._tag === "ProgramFailure"
          ? error as ProgramFailure<Message, ProgramRuntimeError<E>>
          : makeProgramFailure<Message, ProgramRuntimeError<E>>("Command", error as ProgramRuntimeError<E>)
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
