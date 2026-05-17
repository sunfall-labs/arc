import { spawn } from "node:child_process";
import { Data, Deferred, Effect, Fiber, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class ScriptCommandError extends Data.TaggedError("ScriptCommandError") {}

export const scriptCommandText = (command, args) => `${command} ${args.join(" ")}`;

export const makeScriptCommand = (command, args, options = {}) =>
  ChildProcess.make(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    killSignal: options.killSignal ?? "SIGTERM",
  });

export const scriptCommandErrorExitFacts = (error) =>
  [
    `Command: ${error.commandText}`,
    error.signal === null ? `Exit code: ${error.code}` : `Signal: ${error.signal}`,
    error.stdout.trim() === "" ? undefined : `stdout: ${error.stdout.trim()}`,
    error.stderr.trim() === "" ? undefined : `stderr: ${error.stderr.trim()}`,
  ]
    .filter(Boolean)
    .join(" ");

export const scriptCommandErrorMessage = (description, error) =>
  error.code === undefined && error.signal === undefined
    ? `Failed to run ${description}.`
    : `Command failed while running ${description}.`;

export const scriptCommandErrorRepair = (error, spawnRepair) =>
  error.code === undefined && error.signal === undefined
    ? spawnRepair
    : scriptCommandErrorExitFacts(error);

const platformError = (message, cause) => new ScriptCommandError({ message, cause });

const scriptCommandExitStatus = Symbol("sunfall-arc.scriptCommandExitStatus");

const signalExitCode = (signal) => {
  if (signal === null) {
    return 1;
  }
  const signalNumber = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGBUS: 7,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGUSR1: 10,
    SIGSEGV: 11,
    SIGUSR2: 12,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
  }[signal];
  return signalNumber === undefined ? 1 : 128 + signalNumber;
};

const isWindows = process.platform === "win32";

const isChildRunning = (child) => child.exitCode === null && child.signalCode === null;

const spawnWindowsTaskkill = (pid, force) => {
  const args = ["/pid", String(pid), "/T"];
  if (force) {
    args.push("/F");
  }
  try {
    const killer = spawn("taskkill", args, {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
  } catch {
    // `taskkill` is a best-effort Windows process-tree fallback.
  }
};

const interruptChildProcessTree = (child, signal, force = false) =>
  Effect.try({
    try: () => {
      if (child.pid === undefined || !isChildRunning(child)) {
        return;
      }
      if (isWindows) {
        spawnWindowsTaskkill(child.pid, force);
        child.kill(signal);
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch (cause) {
        if (cause && typeof cause === "object" && "code" in cause && cause.code === "ESRCH") {
          return;
        }
        throw cause;
      }
    },
    catch: (cause) => platformError("Child process kill failed.", cause),
  });

const processExistsEffect = (pid) =>
  Effect.try({
    try: () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (cause) {
        return cause && typeof cause === "object" && "code" in cause && cause.code === "ESRCH"
          ? false
          : true;
      }
    },
    catch: (cause) => platformError("Process existence probe failed.", cause),
  });

const killProcessBestEffortEffect = (pid, signal = "SIGKILL") =>
  Effect.sync(() => {
    try {
      process.kill(pid, signal);
    } catch {
      // Best-effort cleanup after a failed process-tree self-test.
    }
  });

const readableProcessStream = (readable) =>
  readable === null || readable === undefined
    ? Stream.empty
    : Stream.fromAsyncIterable(readable, (cause) =>
        platformError("Child process stream failed.", cause),
      );

const nodeChildProcessHandle = (child, command) =>
  Effect.gen(function* () {
    const exitStatus = yield* Deferred.make();
    const completeExit = (effect) => {
      Effect.runSync(effect.pipe(Effect.catchCause(() => Effect.void)));
    };

    child.once("error", (cause) => {
      completeExit(
        Deferred.fail(exitStatus, platformError("Child process failed to start.", cause)),
      );
    });
    child.once("close", (code, signal) => {
      completeExit(Deferred.succeed(exitStatus, { code, signal }));
    });

    const stdout = readableProcessStream(child.stdout);
    const stderr = readableProcessStream(child.stderr);

    return Object.assign(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(child.pid ?? 0),
        exitCode: Deferred.await(exitStatus).pipe(
          Effect.map((status) =>
            ChildProcessSpawner.ExitCode(status.code ?? signalExitCode(status.signal)),
          ),
        ),
        isRunning: Effect.sync(() => child.exitCode === null && child.signalCode === null),
        kill: (options = {}) =>
          Effect.gen(function* () {
            yield* interruptChildProcessTree(
              child,
              options.killSignal ?? command.options.killSignal ?? "SIGTERM",
              false,
            );
            yield* Deferred.await(exitStatus).pipe(
              Effect.timeout(options.forceKillAfter ?? "1 second"),
              Effect.catchCause(() =>
                Effect.gen(function* () {
                  yield* interruptChildProcessTree(child, "SIGKILL", true);
                  yield* Deferred.await(exitStatus);
                }).pipe(Effect.catchCause(() => Effect.void)),
              ),
              Effect.asVoid,
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
      }),
      {
        [scriptCommandExitStatus]: Deferred.await(exitStatus),
      },
    );
  });

const nodeChildProcessSpawner = ChildProcessSpawner.make((command) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.fail(
          platformError(
            "Piped child process commands are not supported by the script command runner.",
          ),
        );
      }
      const child = yield* Effect.try({
        try: () =>
          spawn(command.command, command.args, {
            cwd: command.options.cwd,
            env: command.options.env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: !isWindows,
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
            : Effect.void,
        ),
        Effect.catchCause(() => Effect.void),
      ),
  ),
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
      Effect.sync(() => append(decoder.decode(chunk, { stream: true }))),
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
      options.onStdoutChunk,
    ).pipe(Effect.forkChild({ startImmediately: true }));
    const stderrFiber = yield* collectProcessOutputEffect(
      handle.stderr,
      options.onStderrChunk,
    ).pipe(Effect.forkChild({ startImmediately: true }));
    const status = yield* (
      handle[scriptCommandExitStatus] ??
        Effect.map(handle.exitCode, (code) => ({ code: Number(code), signal: null }))
    );
    const stdout = yield* Fiber.join(stdoutFiber);
    const stderr = yield* Fiber.join(stderrFiber);

    if (status.code === 0 && status.signal === null) {
      return { stdout, stderr, code: status.code, signal: null };
    }

    return yield* Effect.fail(
      new ScriptCommandError({
        command,
        args,
        commandText,
        cwd: options.cwd,
        message:
          status.signal === null
            ? `Command failed with exit code ${status.code}: ${commandText}`
            : `Command failed with signal ${status.signal}: ${commandText}`,
        cause: { code: status.code, signal: status.signal },
        code: status.code ?? undefined,
        signal: status.signal,
        stdout,
        stderr,
      }),
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
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, nodeChildProcessSpawner),
  );

export const scriptCommandProcessExistsEffect = processExistsEffect;

export const scriptCommandKillProcessBestEffortEffect = killProcessBestEffortEffect;
