import { spawn } from "node:child_process";
import { Data, Deferred, Effect, Fiber, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

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

const platformError = (message, cause) =>
  new ScriptCommandError({ message, cause });

const readableProcessStream = (readable) =>
  readable === null || readable === undefined
    ? Stream.empty
    : Stream.fromAsyncIterable(readable, (cause) =>
        platformError("Child process stream failed.", cause)
      );

const nodeChildProcessHandle = (child, command) =>
  Effect.gen(function* () {
    const exitCode = yield* Deferred.make();
    const completeExit = (effect) => {
      Effect.runSync(effect.pipe(Effect.catchCause(() => Effect.void)));
    };

    child.once("error", (cause) => {
      completeExit(Deferred.fail(exitCode, platformError("Child process failed to start.", cause)));
    });
    child.once("close", (code) => {
      completeExit(Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(code ?? 1)));
    });

    const stdout = readableProcessStream(child.stdout);
    const stderr = readableProcessStream(child.stderr);

    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(child.pid ?? 0),
      exitCode: Deferred.await(exitCode),
      isRunning: Effect.sync(() => child.exitCode === null && child.signalCode === null),
      kill: (options = {}) =>
        Effect.gen(function* () {
          yield* Effect.try({
            try: () => {
              if (child.exitCode === null && child.signalCode === null) {
                child.kill(options.killSignal ?? command.options.killSignal ?? "SIGTERM");
              }
            },
            catch: (cause) => platformError("Child process kill failed.", cause),
          });
          yield* Deferred.await(exitCode).pipe(
            Effect.timeout(options.forceKillAfter ?? "1 second"),
            Effect.catchCause(() =>
              Effect.gen(function* () {
                yield* Effect.try({
                  try: () => {
                    if (child.exitCode === null && child.signalCode === null) {
                      child.kill("SIGKILL");
                    }
                  },
                  catch: (cause) => platformError("Child process force-kill failed.", cause),
                });
                yield* Deferred.await(exitCode);
              }).pipe(Effect.catchCause(() => Effect.void))
            ),
            Effect.asVoid
          );
        }),
      stdin: Sink.drain,
      stdout,
      stderr,
      all: Stream.merge(stdout, stderr),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.try({
        try: () => {
          child.unref();
          return Effect.sync(() => child.ref());
        },
        catch: (cause) => platformError("Child process unref failed.", cause),
      }),
    });
  });

const nodeChildProcessSpawner = ChildProcessSpawner.make((command) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.fail(platformError("Piped child process commands are not supported by the script command runner."));
      }
      const child = yield* Effect.try({
        try: () =>
          spawn(command.command, command.args, {
            cwd: command.options.cwd,
            env: command.options.env,
            stdio: ["ignore", "pipe", "pipe"],
          }),
        catch: (cause) => platformError("Child process spawn failed.", cause),
      });
      return yield* nodeChildProcessHandle(child, command);
    }),
    (handle) =>
      handle.isRunning.pipe(
        Effect.flatMap((running) =>
          running
            ? handle.kill({ killSignal: command.options.killSignal ?? "SIGTERM" })
            : Effect.void
        ),
        Effect.catchCause(() => Effect.void)
      )
  )
);

const collectProcessOutputEffect = (stream, onChunk) =>
  Effect.gen(function* () {
    const decoder = new TextDecoder();
    let text = "";
    const append = (chunk) => {
      if (chunk.length === 0) {
        return;
      }
      text += chunk;
      onChunk?.(chunk);
    };

    yield* Stream.runForEach(stream, (chunk) =>
      Effect.sync(() => append(decoder.decode(chunk, { stream: true })))
    );
    yield* Effect.sync(() => append(decoder.decode()));
    return text;
  });

/**
 * Runs an Effect v4 ChildProcess command through the local Node spawner service.
 *
 * The adapter captures stdout/stderr for release gates while also allowing
 * callers such as `verify.mjs` to stream chunks as they arrive.
 */
export const runScriptCommandEffect = (command, args, options = {}) =>
  Effect.gen(function* () {
    const effectCommand = makeScriptCommand(command, args, options);
    const commandText = scriptCommandText(effectCommand.command, effectCommand.args);
    const handle = yield* effectCommand;
    const stdoutFiber = yield* collectProcessOutputEffect(
      handle.stdout,
      options.onStdoutChunk
    ).pipe(Effect.forkDetach({ startImmediately: true }));
    const stderrFiber = yield* collectProcessOutputEffect(
      handle.stderr,
      options.onStderrChunk
    ).pipe(Effect.forkDetach({ startImmediately: true }));
    const code = yield* handle.exitCode;
    const stdout = yield* Fiber.join(stdoutFiber);
    const stderr = yield* Fiber.join(stderrFiber);
    const numericCode = Number(code);

    if (numericCode === 0) {
      return { stdout, stderr, code: numericCode, signal: null };
    }

    return yield* Effect.fail(
      new ScriptCommandError({
        command,
        args,
        commandText,
        cwd: options.cwd,
        message: `Command failed with exit code ${numericCode}: ${commandText}`,
        cause: { code: numericCode, signal: null },
        code: numericCode,
        signal: null,
        stdout,
        stderr,
      })
    );
  }).pipe(
    Effect.scoped,
    Effect.mapError((cause) => {
      if (cause instanceof ScriptCommandError && cause.commandText !== undefined) {
        return cause;
      }
      const commandText = scriptCommandText(command, args);
      return new ScriptCommandError({
        command,
        args,
        commandText,
        cwd: options.cwd,
        message: `Failed to start command: ${commandText}`,
        cause,
        stdout: "",
        stderr: "",
      });
    }),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, nodeChildProcessSpawner)
  );
