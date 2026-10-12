#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { runScriptCliEffect } from "./effect-cli-runner.mjs";
import { runScriptCommandEffect } from "./effect-command-runner.mjs";
import { runScriptMainEffect } from "./effect-main-runner.mjs";
import { workspaceVerifyPackageTargetsEffect } from "./workspace-verification-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

class VerifyCommandError extends Data.TaggedError("VerifyCommandError") {}

const verifyCliVersion = "0.1.0-alpha.1";

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
      concurrency: Flag.Int("concurrency").pipe(
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

const verifyMainFailureMessage = (cause) =>
  cause instanceof VerifyCommandError
    ? cause.message
    : cause instanceof Error
      ? cause.message
      : String(cause);

const runVerifyCliMainEffect = (args = process.argv.slice(2), env = process.env) =>
  runScriptCliEffect(makeVerifyCommand(env), {
    version: verifyCliVersion,
    args,
    formatFailure: verifyMainFailureMessage,
  });

runScriptMainEffect(runVerifyCliMainEffect());
