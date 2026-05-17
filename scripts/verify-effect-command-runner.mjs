#!/usr/bin/env node

import { Data, Effect, Fiber } from "effect";
import {
  runScriptCommandEffect,
  scriptCommandErrorMessage,
  scriptCommandErrorRepair,
  scriptCommandKillProcessBestEffortEffect,
  scriptCommandProcessExistsEffect,
} from "./effect-command-runner.mjs";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

class EffectCommandRunnerSelfTestError extends Data.TaggedError(
  "EffectCommandRunnerSelfTestError",
) {}

const fail = (message, cause) => new EffectCommandRunnerSelfTestError({ message, cause });

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
  const error = yield* Effect.flip(
    runScriptCommandEffect(process.execPath, [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)",
    ]),
  );

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
  const missingCommand = `sunfall-arc-missing-command-${process.pid}`;
  const error = yield* Effect.flip(runScriptCommandEffect(missingCommand, []));

  yield* assert(
    error.code === undefined,
    "spawn failure should not pretend to be a process exit.",
    error,
  );
  yield* assert(
    error.commandText === missingCommand + " ",
    "spawn failure should expose command text.",
    error,
  );
});

const waitForChunkEffect = (read, predicate) =>
  Effect.gen(function* () {
    while (!predicate(read())) {
      yield* Effect.sleep("10 millis");
    }
  }).pipe(Effect.timeout("2 seconds"));

const parsePidFromFirstLine = (text) => Number(text.split(/\r?\n/, 1)[0]);

const parsePidLine = (text, prefix) => {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  return line === undefined ? undefined : Number(line.slice(prefix.length));
};

const signalExitStatusSelfTest = Effect.gen(function* () {
  let stdout = "";
  const fiber = Effect.runFork(
    runScriptCommandEffect(
      process.execPath,
      [
        "-e",
        ["process.stdout.write(String(process.pid) + '\\n');", "setInterval(() => {}, 1000)"].join(
          "",
        ),
      ],
      {
        onStdoutChunk: (chunk) => {
          stdout += chunk;
        },
      },
    ),
  );

  yield* waitForChunkEffect(
    () => stdout,
    (text) => text.includes("\n"),
  );
  const pid = parsePidFromFirstLine(stdout);
  yield* assert(
    Number.isInteger(pid) && pid > 0,
    "signal self-test should capture a child pid.",
    stdout,
  );
  yield* Effect.sync(() => {
    process.kill(pid, "SIGTERM");
  });
  const error = yield* Effect.flip(Fiber.join(fiber).pipe(Effect.timeout("3 seconds")));

  yield* assert(
    error.signal === "SIGTERM",
    "signal-killed command should expose its signal.",
    error,
  );
});

const signalErrorFormattingSelfTest = Effect.gen(function* () {
  const signaledError = {
    commandText: "node hanging-script.mjs",
    code: undefined,
    signal: "SIGTERM",
    stdout: "",
    stderr: "terminated",
  };
  const spawnError = {
    commandText: "missing-command ",
    code: undefined,
    signal: undefined,
    stdout: "",
    stderr: "",
  };

  yield* assert(
    scriptCommandErrorMessage("signal formatting self-test", signaledError) ===
      "Command failed while running signal formatting self-test.",
    "signal-killed commands should format as process failures, not spawn failures.",
    signaledError,
  );
  yield* assert(
    scriptCommandErrorRepair(signaledError, "spawn repair").includes("Signal: SIGTERM"),
    "signal-killed command repairs should preserve signal semantics.",
    signaledError,
  );
  yield* assert(
    scriptCommandErrorMessage("spawn formatting self-test", spawnError) ===
      "Failed to run spawn formatting self-test.",
    "spawn failures should keep spawn-specific formatting.",
    spawnError,
  );
  yield* assert(
    scriptCommandErrorRepair(spawnError, "spawn repair") === "spawn repair",
    "spawn failure repairs should keep caller-provided spawn guidance.",
    spawnError,
  );
});

const processTreeInterruptionSelfTest = Effect.gen(function* () {
  let stdout = "";
  let grandchildPid;
  const fiber = Effect.runFork(
    runScriptCommandEffect(
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'ignore', 'ignore'] });",
          "process.stdout.write(String(child.pid) + '\\n');",
          "setInterval(() => {}, 1000)",
        ].join(""),
      ],
      {
        onStdoutChunk: (chunk) => {
          stdout += chunk;
        },
      },
    ),
  );

  yield* waitForChunkEffect(
    () => stdout,
    (text) => text.includes("\n"),
  );
  grandchildPid = parsePidFromFirstLine(stdout);
  yield* assert(
    Number.isInteger(grandchildPid) && grandchildPid > 0,
    "process-tree self-test should capture a grandchild pid.",
    stdout,
  );

  yield* Fiber.interrupt(fiber).pipe(Effect.timeout("3 seconds"));
  yield* Effect.gen(function* () {
    while (yield* scriptCommandProcessExistsEffect(grandchildPid)) {
      yield* Effect.sleep("10 millis");
    }
  }).pipe(
    Effect.timeout("3 seconds"),
    Effect.ensuring(scriptCommandKillProcessBestEffortEffect(grandchildPid)),
  );
});

const parentSignalMainRunnerSelfTest = Effect.gen(function* () {
  let stdout = "";
  const runnerUrl = new URL("./effect-main-runner.mjs", import.meta.url).href;
  const commandRunnerUrl = new URL("./effect-command-runner.mjs", import.meta.url).href;
  const parentScript = [
    "import { Effect } from 'effect';",
    `import { runScriptMainEffect } from ${JSON.stringify(runnerUrl)};`,
    `import { runScriptCommandEffect } from ${JSON.stringify(commandRunnerUrl)};`,
    "process.stdout.write('parent:' + process.pid + '\\n');",
    "runScriptMainEffect(runScriptCommandEffect(process.execPath, [",
    "  '-e',",
    "  \"process.stdout.write('grandchild:' + process.pid + '\\\\n'); setInterval(() => {}, 1000)\"",
    "], {",
    "  onStdoutChunk: (chunk) => process.stdout.write(chunk)",
    "}));",
  ].join("\n");
  const fiber = Effect.runFork(
    runScriptCommandEffect(process.execPath, ["--input-type=module", "-e", parentScript], {
      onStdoutChunk: (chunk) => {
        stdout += chunk;
      },
    }),
  );

  yield* waitForChunkEffect(
    () => stdout,
    (text) =>
      Number.isInteger(parsePidLine(text, "parent:")) &&
      Number.isInteger(parsePidLine(text, "grandchild:")),
  );
  const parentPid = parsePidLine(stdout, "parent:");
  const grandchildPid = parsePidLine(stdout, "grandchild:");
  yield* assert(
    parentPid !== undefined && parentPid > 0 && grandchildPid !== undefined && grandchildPid > 0,
    "main-runner signal self-test should capture parent and grandchild pids.",
    stdout,
  );

  yield* Effect.sync(() => {
    process.kill(parentPid, "SIGTERM");
  });
  const error = yield* Effect.flip(Fiber.join(fiber).pipe(Effect.timeout("3 seconds")));
  yield* assert(
    error.code === 143,
    "signalled script main should exit with SIGTERM status.",
    error,
  );
  yield* Effect.gen(function* () {
    while (yield* scriptCommandProcessExistsEffect(grandchildPid)) {
      yield* Effect.sleep("10 millis");
    }
  }).pipe(
    Effect.timeout("3 seconds"),
    Effect.ensuring(scriptCommandKillProcessBestEffortEffect(grandchildPid)),
  );
});

const mainRunnerPreservesReportedExitCodeSelfTest = Effect.gen(function* () {
  const runnerUrl = new URL("./effect-main-runner.mjs", import.meta.url).href;
  const parentScript = [
    "import { Effect } from 'effect';",
    `import { runScriptMainEffect } from ${JSON.stringify(runnerUrl)};`,
    "runScriptMainEffect(Effect.sync(() => {",
    "  process.exitCode = 9;",
    "}));",
  ].join("\n");
  const error = yield* Effect.flip(
    runScriptCommandEffect(process.execPath, ["--input-type=module", "-e", parentScript]),
  );

  yield* assert(
    error.code === 9,
    "script main should preserve a reported non-zero process.exitCode.",
    error,
  );
});

const interruptionSelfTest = Effect.gen(function* () {
  const fiber = Effect.runFork(
    runScriptCommandEffect(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
  );

  yield* Effect.sleep("50 millis");
  yield* Fiber.interrupt(fiber).pipe(Effect.timeout("3 seconds"));
  const exit = yield* Fiber.await(fiber);
  yield* assert(
    exit._tag === "Failure",
    "interrupted command fiber should fail instead of succeeding.",
    exit,
  );
});

const interruptionWithActiveCollectorsSelfTest = Effect.gen(function* () {
  let stdout = "";
  let stderr = "";
  const fiber = Effect.runFork(
    runScriptCommandEffect(
      process.execPath,
      [
        "-e",
        [
          "setInterval(() => {",
          "  process.stdout.write('out\\n');",
          "  process.stderr.write('err\\n');",
          "}, 5)",
        ].join(""),
      ],
      {
        onStdoutChunk: (chunk) => {
          stdout += chunk;
        },
        onStderrChunk: (chunk) => {
          stderr += chunk;
        },
      },
    ),
  );

  yield* Effect.gen(function* () {
    while (!stdout.includes("out") || !stderr.includes("err")) {
      yield* Effect.sleep("10 millis");
    }
  }).pipe(Effect.timeout("2 seconds"));
  yield* Fiber.interrupt(fiber).pipe(Effect.timeout("3 seconds"));
  const exit = yield* Fiber.await(fiber);
  yield* assert(
    exit._tag === "Failure",
    "interrupted noisy command fiber should fail instead of succeeding.",
    exit,
  );
});

const forceKillSelfTest = Effect.gen(function* () {
  let stderr = "";
  const fiber = Effect.runFork(
    runScriptCommandEffect(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => {}); process.stderr.write('ready\\n'); setInterval(() => {}, 1000)",
      ],
      {
        onStderrChunk: (chunk) => {
          stderr += chunk;
        },
      },
    ),
  );

  yield* Effect.gen(function* () {
    while (!stderr.includes("ready")) {
      yield* Effect.sleep("10 millis");
    }
  }).pipe(Effect.timeout("2 seconds"));
  yield* Fiber.interrupt(fiber).pipe(Effect.timeout("3 seconds"));
  const exit = yield* Fiber.await(fiber);
  yield* assert(
    exit._tag === "Failure",
    "force-killed command fiber should fail instead of succeeding.",
    exit,
  );
});

const selfTest = Effect.gen(function* () {
  yield* successCaptureSelfTest;
  yield* nonzeroExitSelfTest;
  yield* spawnFailureSelfTest;
  yield* signalExitStatusSelfTest;
  yield* signalErrorFormattingSelfTest;
  yield* interruptionSelfTest;
  yield* interruptionWithActiveCollectorsSelfTest;
  yield* forceKillSelfTest;
  yield* processTreeInterruptionSelfTest;
  yield* mainRunnerPreservesReportedExitCodeSelfTest;
  yield* parentSignalMainRunnerSelfTest;
  yield* Effect.sync(() => {
    console.log("Verified Effect command runner policy.");
  });
});

runScriptMainEffect(
  selfTest.pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        console.error(cause);
        process.exitCode = 1;
      }),
    ),
  ),
);
