#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Data, Effect, FileSystem, Layer, Option, Path, Stdio, Terminal } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import { runScriptCommandEffect } from "./effect-command-runner.mjs";
import { runScriptMainEffect } from "./effect-main-runner.mjs";
import { workspaceVerifyPackageTargetsEffect } from "./workspace-verification-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

class VerifyCommandError extends Data.TaggedError("VerifyCommandError") {}

const verifyCliVersion = "0.0.0-alpha.0";

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

const verifyCliConsole = {
  ...noopConsole,
  error: (...args) => {
    process.stderr.write(`${formatConsoleArgs(args)}\n`);
  },
  log: (...args) => {
    process.stdout.write(`${formatConsoleArgs(args)}\n`);
  },
};

const verifyCliEnvironmentLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(Terminal.Terminal)(
    Terminal.make({
      columns: Effect.succeed(80),
      readInput: Effect.die("verify CLI does not read interactive input"),
      readLine: Effect.fail(new Terminal.QuitError()),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(
    ChildProcessSpawner.make(() => Effect.die("verify CLI parser does not spawn child processes")),
  ),
);

const parsePositiveConcurrencyEffect = (raw, source) => {
  if (raw === undefined || raw.trim() === "") {
    return Effect.fail(
      new VerifyCommandError({
        message: `${source} must be a positive integer.`,
      }),
    );
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? Effect.succeed(parsed)
    : Effect.fail(
        new VerifyCommandError({
          message: `${source} must be a positive integer, got ${JSON.stringify(raw)}.`,
        }),
      );
};

const laneConcurrencyFromCliEffect = (concurrencyOption, env = process.env) => {
  const concurrency = Option.getOrUndefined(concurrencyOption);
  if (concurrency !== undefined) {
    return Effect.succeed(concurrency);
  }

  const envConcurrency = env.SUNFALL_ARC_VERIFY_CONCURRENCY;
  return envConcurrency === undefined || envConcurrency.trim() === ""
    ? Effect.succeed(4)
    : parsePositiveConcurrencyEffect(envConcurrency, "SUNFALL_ARC_VERIFY_CONCURRENCY");
};

const formatDuration = (startedAt) => {
  const ms = Date.now() - startedAt;
  const seconds = ms / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

const writePrefixedChunk = (label, write, state, chunk) => {
  const text = `${state.buffer}${chunk}`;
  const lines = text.split(/\r?\n/);
  state.buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.length > 0) {
      write(`[${label}] ${line}\n`);
    }
  }
};

const flushPrefixedChunk = (label, write, state) => {
  if (state.buffer.length > 0) {
    write(`[${label}] ${state.buffer}\n`);
    state.buffer = "";
  }
};

const run = (label, args, options = {}) =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    const commandText = `${pnpmCommand} ${args.join(" ")}`;
    const output = {
      stdout: { buffer: "" },
      stderr: { buffer: "" },
    };
    const flushOutput = () => {
      flushPrefixedChunk(label, (text) => process.stdout.write(text), output.stdout);
      flushPrefixedChunk(label, (text) => process.stderr.write(text), output.stderr);
    };

    console.log(`▶ ${label}`);
    yield* runScriptCommandEffect(pnpmCommand, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ...options.env,
      },
      onStdoutChunk: (chunk) =>
        writePrefixedChunk(label, (text) => process.stdout.write(text), output.stdout, chunk),
      onStderrChunk: (chunk) =>
        writePrefixedChunk(label, (text) => process.stderr.write(text), output.stderr, chunk),
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Effect.sync(flushOutput);
          return yield* Effect.fail(
            new VerifyCommandError({
              label,
              command: commandText,
              message:
                error.signal !== null && error.signal !== undefined
                  ? `${label} failed with signal ${error.signal}.`
                  : error.code === undefined
                    ? `Failed to start ${label}.`
                    : `${label} failed with exit code ${error.code}.`,
              cause: error.cause,
            }),
          );
        }),
      ),
    );
    flushOutput();
    console.log(`✓ ${label} (${formatDuration(startedAt)})`);
  });

const runAll = (label, effects, laneConcurrency) =>
  Effect.gen(function* () {
    console.log(`\n== ${label} ==`);
    yield* Effect.all(effects, { concurrency: laneConcurrency });
  });

const verifyWorkspacePackage = ({ label, packageName }) =>
  run(`${label} verify`, ["--filter", packageName, "verify"]);

const packageStarters = Effect.gen(function* () {
  yield* run("starter package generation", ["starter:package"], {
    env: {
      SUNFALL_ARC_VERIFY_FAST_STARTERS: "1",
      SUNFALL_ARC_VERIFY_PREBUILT_PACKAGES: "1",
    },
  });
  yield* run("package dry runs", ["example:pack-dry-run"]);
});

const verifyEffect = (laneConcurrency) =>
  Effect.gen(function* () {
    console.log(`Sunfall Arc verify running with lane concurrency ${laneConcurrency}.`);

    yield* run("package builds", ["build"]);

    yield* runAll(
      "source static gates",
      [
        run("workspace format check", ["format:check"]),
        run("workspace lint", ["lint"]),
        run("workspace typecheck", ["typecheck"]),
        run("public API audit", ["audit:public-api"]),
        run("Effect command runner policy", ["verify:command-runner"]),
        run("package payload policy", ["verify:package-payload-policy"]),
        run("Effect-first audit", ["audit:effect-first"]),
      ],
      laneConcurrency,
    );

    yield* run("workspace tests", ["test"]);

    const verifyPackageTargets = yield* workspaceVerifyPackageTargetsEffect(workspaceRoot);
    yield* runAll(
      "package verifies",
      verifyPackageTargets.map(verifyWorkspacePackage),
      laneConcurrency,
    );

    yield* packageStarters;
  });

const makeVerifyCommand = (env = process.env) =>
  Command.make(
    "sunfall-arc-verify",
    {
      concurrency: Flag.integer("concurrency").pipe(
        Flag.filter(
          (value) => value > 0,
          (value) => `--concurrency must be a positive integer, got ${value}.`,
        ),
        Flag.withDescription("Number of package/example lanes to run in parallel. Defaults to 4."),
        Flag.optional,
      ),
    },
    (config) =>
      Effect.gen(function* () {
        const laneConcurrency = yield* laneConcurrencyFromCliEffect(config.concurrency, env);
        yield* verifyEffect(laneConcurrency);
      }),
  ).pipe(
    Command.withDescription("Run the full Sunfall Arc verification plan."),
    Command.withExamples([
      {
        command: "node scripts/verify.mjs",
        description: "Run the full verification plan with the default lane concurrency.",
      },
      {
        command: "node scripts/verify.mjs --concurrency 1",
        description: "Run package and example lanes serially.",
      },
    ]),
  );

const runVerifyCliCommandEffect = (args = process.argv.slice(2), env = process.env) =>
  Command.runWith(makeVerifyCommand(env), { version: verifyCliVersion })(args).pipe(
    Effect.provideService(Console.Console, verifyCliConsole),
    Effect.provide(verifyCliEnvironmentLayer),
  );

const verifyMainFailureMessage = (cause) =>
  cause instanceof VerifyCommandError
    ? cause.message
    : cause instanceof Error
      ? cause.message
      : String(cause);

const runVerifyCliMainEffect = (args = process.argv.slice(2), env = process.env) =>
  Effect.gen(function* () {
    const result = yield* runVerifyCliCommandEffect(args, env).pipe(
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

    process.stderr.write(`${verifyMainFailureMessage(result.cause)}\n`);
    process.exitCode = 1;
  });

runScriptMainEffect(runVerifyCliMainEffect());
