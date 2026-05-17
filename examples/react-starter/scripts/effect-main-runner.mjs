import { Effect, Fiber, Runtime } from "effect";

const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143
};

const setProcessExitCode = (code) => {
  if (code === 0 && process.exitCode !== undefined && process.exitCode !== 0) {
    return;
  }
  process.exitCode = code;
};

/**
 * Runs a script Effect as the process main fiber.
 *
 * Terminal signals interrupt the main fiber, so scoped finalizers in script
 * implementations run before Node exits. A script that catches its own failure
 * and sets a non-zero process.exitCode keeps that reported status.
 */
export const runScriptMainEffect = (effect, options = {}) => {
  let interruptSignal;
  const signals = options.signals ?? ["SIGINT", "SIGTERM"];
  const onExit = options.onExit ?? setProcessExitCode;
  const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
    const handlers = signals.map((signal) => {
      const handler = () => {
        interruptSignal ??= signal;
        Effect.runFork(Fiber.interrupt(fiber));
      };
      process.once(signal, handler);
      return [signal, handler];
    });
    const cleanupHandlers = () => {
      for (const [signal, handler] of handlers) {
        process.removeListener(signal, handler);
      }
    };

    fiber.addObserver((exit) => {
      cleanupHandlers();
      teardown(exit, (code) => {
        onExit(interruptSignal === undefined
          ? code
          : signalExitCodes[interruptSignal] ?? code);
      });
    });
  });

  runMain(effect, options);
};
