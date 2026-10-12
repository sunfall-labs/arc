import { Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { CliError, Command } from "effect/cli";
import { ChildProcessSpawner } from "effect/process";

const noopConsole = {
  assert: () => undefined,
  clear: () => undefined,
  count: () => undefined,
  countReset: () => undefined,
  debug: () => undefined,
  dir: () => undefined,
  dirxml: () => undefined,
  error: () => undefined,
  group: () => undefined,
  groupCollapsed: () => undefined,
  groupEnd: () => undefined,
  info: () => undefined,
  log: () => undefined,
  table: () => undefined,
  time: () => undefined,
  timeEnd: () => undefined,
  timeLog: () => undefined,
  trace: () => undefined,
  warn: () => undefined,
};

const formatConsoleArgs = (args) =>
  args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ");

const scriptCliConsole = {
  ...noopConsole,
  error: (...args) => {
    process.stderr.write(`${formatConsoleArgs(args)}\n`);
  },
  log: (...args) => {
    process.stdout.write(`${formatConsoleArgs(args)}\n`);
  },
};

const scriptCliEnvironmentLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(Terminal.Terminal)(
    Terminal.make({
      columns: Effect.succeed(80),
      readInput: Effect.die("script CLIs do not read interactive input"),
      readLine: Effect.fail(new Terminal.QuitError()),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
    ChildProcessSpawner.make(() => Effect.die("script CLI parsers do not spawn child processes")),
  ),
);

/**
 * Runs an `effect/cli` Command as a workspace script's main Effect.
 *
 * `--help` exits 0 (1 when it was shown for parse errors). Any other failure is
 * written to stderr through `formatFailure` and sets exit code 1.
 */
export const runScriptCliEffect = (
  command,
  { version, args = process.argv.slice(2), formatFailure = String },
) =>
  Effect.gen(function* () {
    const result = yield* Command.runWith(command, { version })(args).pipe(
      Effect.provideService(Console.Console, scriptCliConsole),
      Effect.provide(scriptCliEnvironmentLayer),
      Effect.map(() => ({ _tag: "Success" })),
      Effect.catch((cause) => Effect.succeed({ _tag: "Failure", cause })),
    );

    if (result._tag === "Success") {
      return;
    }

    if (CliError.isCliError(result.cause) && result.cause._tag === "ShowHelp") {
      process.exitCode = result.cause.errors.length === 0 ? 0 : 1;
      return;
    }

    process.stderr.write(`${formatFailure(result.cause)}\n`);
    process.exitCode = 1;
  });
