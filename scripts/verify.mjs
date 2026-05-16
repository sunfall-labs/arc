#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { workspaceVerifyPackageTargetsEffect } from "./workspace-verification-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

class VerifyCommandError extends Data.TaggedError("VerifyCommandError") {}

const parseConcurrency = () => {
  const raw = process.env.EFFECT_UI_VERIFY_CONCURRENCY;
  if (raw === undefined || raw.trim() === "") {
    return 4;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4;
};

const laneConcurrency = parseConcurrency();

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

const attachPrefixedOutput = (label, stream, write) => {
  const state = { buffer: "" };
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    writePrefixedChunk(label, write, state, chunk);
  });
  stream.on("end", () => {
    flushPrefixedChunk(label, write, state);
  });
};

const run = (label, args, options = {}) =>
  Effect.callback((resume) => {
    const startedAt = Date.now();
    const commandText = `${pnpmCommand} ${args.join(" ")}`;
    let completed = false;

    console.log(`▶ ${label}`);
    const child = spawn(pnpmCommand, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    if (child.stdout) {
      attachPrefixedOutput(label, child.stdout, (text) => process.stdout.write(text));
    }
    if (child.stderr) {
      attachPrefixedOutput(label, child.stderr, (text) => process.stderr.write(text));
    }

    child.on("error", (cause) => {
      if (completed) {
        return;
      }
      completed = true;
      resume(Effect.fail(new VerifyCommandError({
        label,
        command: commandText,
        message: `Failed to start ${label}.`,
        cause
      })));
    });

    child.on("close", (code, signal) => {
      if (completed) {
        return;
      }
      completed = true;
      if (code === 0) {
        console.log(`✓ ${label} (${formatDuration(startedAt)})`);
        resume(Effect.void);
        return;
      }

      resume(Effect.fail(new VerifyCommandError({
        label,
        command: commandText,
        message: `${label} failed with ${signal === null ? "exit code " + code : "signal " + signal}.`,
        cause: { code, signal }
      })));
    });

    return Effect.sync(() => {
      if (!completed && !child.killed) {
        child.kill("SIGTERM");
      }
    });
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
