#!/usr/bin/env node

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { runScriptCommandEffect } from "./effect-command-runner.mjs";
import { workspaceVerifyPackageTargetsEffect } from "./workspace-verification-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

class VerifyCommandError extends Data.TaggedError("VerifyCommandError") {}

const verifyUsage = `Usage: node scripts/verify.mjs [--concurrency=<positive-integer>]

Runs the full Effect UI verification plan.

Options:
  --concurrency=<n>  Number of package/example lanes to run in parallel. Defaults to 4.
  -h, --help         Print this help without running verification.`;

const parsePositiveConcurrency = (raw, source) => {
  if (raw === undefined || raw.trim() === "") {
    return {
      _tag: "Failure",
      message: `${source} must be a positive integer.`
    };
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? { _tag: "Success", value: parsed }
    : {
        _tag: "Failure",
        message: `${source} must be a positive integer, got ${JSON.stringify(raw)}.`
      };
};

const parseVerifyArgs = (args, env = process.env) => {
  let concurrencyFromArgs;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      return { _tag: "Help" };
    }

    if (arg.startsWith("--concurrency=")) {
      if (concurrencyFromArgs !== undefined) {
        return {
          _tag: "Failure",
          message: "Use --concurrency at most once."
        };
      }
      const parsed = parsePositiveConcurrency(
        arg.slice("--concurrency=".length),
        "--concurrency"
      );
      if (parsed._tag === "Failure") {
        return parsed;
      }
      concurrencyFromArgs = parsed.value;
      continue;
    }

    return {
      _tag: "Failure",
      message: `Unknown argument ${JSON.stringify(arg)}.`
    };
  }

  if (concurrencyFromArgs !== undefined) {
    return { _tag: "Run", laneConcurrency: concurrencyFromArgs };
  }

  const envConcurrency = env.EFFECT_UI_VERIFY_CONCURRENCY;
  if (envConcurrency !== undefined && envConcurrency.trim() !== "") {
    const parsed = parsePositiveConcurrency(
      envConcurrency,
      "EFFECT_UI_VERIFY_CONCURRENCY"
    );
    if (parsed._tag === "Failure") {
      return parsed;
    }
    return { _tag: "Run", laneConcurrency: parsed.value };
  }

  return { _tag: "Run", laneConcurrency: 4 };
};

const verifyArgs = parseVerifyArgs(process.argv.slice(2));
const laneConcurrency = verifyArgs._tag === "Run" ? verifyArgs.laneConcurrency : 4;

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
      stderr: { buffer: "" }
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
        ...options.env
      },
      onStdoutChunk: (chunk) =>
        writePrefixedChunk(label, (text) => process.stdout.write(text), output.stdout, chunk),
      onStderrChunk: (chunk) =>
        writePrefixedChunk(label, (text) => process.stderr.write(text), output.stderr, chunk)
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Effect.sync(flushOutput);
          return yield* Effect.fail(new VerifyCommandError({
            label,
            command: commandText,
            message: error.code === undefined
              ? `Failed to start ${label}.`
              : `${label} failed with ${error.signal === null ? "exit code " + error.code : "signal " + error.signal}.`,
            cause: error.cause
          }));
        })
      )
    );
    flushOutput();
    console.log(`✓ ${label} (${formatDuration(startedAt)})`);
  });

const runAll = (label, effects) =>
  Effect.gen(function* () {
    console.log(`\n== ${label} ==`);
    yield* Effect.all(effects, { concurrency: laneConcurrency });
  });

const verifyWorkspacePackage = ({ label, packageName }) =>
  run(`${label} verify`, ["--filter", packageName, "verify"]);

const packageStarters = Effect.gen(function* () {
  yield* run("starter package generation", ["starter:package"], {
    env: {
      EFFECT_UI_VERIFY_FAST_STARTERS: "1",
      EFFECT_UI_VERIFY_PREBUILT_PACKAGES: "1"
    }
  });
  yield* run("package dry runs", ["example:pack-dry-run"]);
});

const verify = Effect.gen(function* () {
  console.log(`Effect UI verify running with lane concurrency ${laneConcurrency}.`);

  yield* run("package builds", ["build"]);

  yield* runAll("source static gates", [
    run("workspace typecheck", ["typecheck"]),
    run("public API audit", ["audit:public-api"]),
    run("Effect-first audit", ["audit:effect-first"])
  ]);

  yield* run("workspace tests", ["test"]);

  const verifyPackageTargets = yield* workspaceVerifyPackageTargetsEffect(workspaceRoot);
  yield* runAll("package verifies", verifyPackageTargets.map(verifyWorkspacePackage));

  yield* packageStarters;
});

if (verifyArgs._tag === "Help") {
  console.log(verifyUsage);
} else if (verifyArgs._tag === "Failure") {
  console.error(`${verifyArgs.message}\n\n${verifyUsage}`);
  process.exitCode = 1;
} else {
  Effect.runPromise(
    verify.pipe(
      Effect.catch((cause) =>
        Effect.sync(() => {
          console.error(cause);
          process.exitCode = 1;
        })
      )
    )
  );
}
