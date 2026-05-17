#!/usr/bin/env node

import { Data, Effect, Fiber } from "effect";
import { runScriptCommandEffect } from "./effect-command-runner.mjs";

class EffectCommandRunnerSelfTestError extends Data.TaggedError("EffectCommandRunnerSelfTestError") {}

const fail = (message, cause) =>
  new EffectCommandRunnerSelfTestError({ message, cause });

const assert = (condition, message, cause) =>
  condition ? Effect.void : Effect.fail(fail(message, cause));

const successCaptureSelfTest = Effect.gen(function* () {
  const result = yield* runScriptCommandEffect(process.execPath, [
    "-e",
    "process.stdout.write('out'); process.stderr.write('err')",
  ]);

  yield* assert(result.code === 0, "success command should report exit code 0.", result);
  yield* assert(result.signal === null, "success command should not report a signal.", result);
  yield* assert(result.stdout === "out", "success command should capture stdout.", result);
  yield* assert(result.stderr === "err", "success command should capture stderr.", result);
});

const nonzeroExitSelfTest = Effect.gen(function* () {
  const error = yield* Effect.flip(runScriptCommandEffect(process.execPath, [
    "-e",
    "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)",
  ]));

  yield* assert(error.code === 7, "nonzero command should expose its exit code.", error);
  yield* assert(error.stdout === "out", "nonzero command should preserve stdout.", error);
  yield* assert(error.stderr === "err", "nonzero command should preserve stderr.", error);
  yield* assert(
    error.commandText?.includes(process.execPath) === true,
    "nonzero command should expose command text.",
    error,
  );
});

const spawnFailureSelfTest = Effect.gen(function* () {
  const missingCommand = `effect-ui-missing-command-${process.pid}`;
  const error = yield* Effect.flip(runScriptCommandEffect(missingCommand, []));

  yield* assert(error.code === undefined, "spawn failure should not pretend to be a process exit.", error);
  yield* assert(
    error.commandText === missingCommand + " ",
    "spawn failure should expose command text.",
    error,
  );
});

const interruptionSelfTest = Effect.gen(function* () {
  const fiber = Effect.runFork(runScriptCommandEffect(process.execPath, [
    "-e",
    "setInterval(() => {}, 1000)",
  ]));

  yield* Effect.sleep("50 millis");
  yield* Fiber.interrupt(fiber).pipe(Effect.timeout("3 seconds"));
  const exit = yield* Fiber.await(fiber);
  yield* assert(exit._tag === "Failure", "interrupted command fiber should fail instead of succeeding.", exit);
});

const selfTest = Effect.gen(function* () {
  yield* successCaptureSelfTest;
  yield* nonzeroExitSelfTest;
  yield* spawnFailureSelfTest;
  yield* interruptionSelfTest;
  yield* Effect.sync(() => {
    console.log("Verified Effect command runner policy.");
  });
});

await Effect.runPromise(
  selfTest.pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        console.error(cause);
        process.exitCode = 1;
      })
    )
  )
);
