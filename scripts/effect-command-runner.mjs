import { spawn } from "node:child_process";
import { Data, Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

export class ScriptCommandError extends Data.TaggedError("ScriptCommandError") {}

export const scriptCommandText = (command, args) =>
  `${command} ${args.join(" ")}`;

export const makeScriptCommand = (command, args, options = {}) =>
  ChildProcess.make(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    killSignal: options.killSignal ?? "SIGTERM"
  });

/**
 * Runs an Effect v4 ChildProcess command through the local Node host adapter.
 *
 * The adapter captures stdout/stderr for release gates while also allowing
 * callers such as `verify.mjs` to stream chunks as they arrive.
 */
export const runScriptCommandEffect = (command, args, options = {}) =>
  Effect.callback((resume) => {
    const effectCommand = makeScriptCommand(command, args, options);
    let completed = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(effectCommand.command, effectCommand.args, {
      cwd: effectCommand.options.cwd,
      env: effectCommand.options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const commandText = scriptCommandText(effectCommand.command, effectCommand.args);
    const finish = (effect) => {
      if (completed) {
        return;
      }
      completed = true;
      resume(effect);
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });
    child.on("error", (cause) => {
      finish(
        Effect.fail(
          new ScriptCommandError({
            command,
            args,
            commandText,
            cwd: options.cwd,
            message: `Failed to start command: ${commandText}`,
            cause,
            stdout,
            stderr,
          }),
        ),
      );
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish(Effect.succeed({ stdout, stderr, code, signal }));
        return;
      }

      finish(
        Effect.fail(
          new ScriptCommandError({
            command,
            args,
            commandText,
            cwd: options.cwd,
            message: `Command failed with ${signal === null ? `exit code ${code}` : `signal ${signal}`}: ${commandText}`,
            cause: { code, signal },
            code,
            signal,
            stdout,
            stderr,
          }),
        ),
      );
    });

    return Effect.sync(() => {
      if (!completed && !child.killed) {
        child.kill(effectCommand.options.killSignal ?? "SIGTERM");
      }
    });
  });
