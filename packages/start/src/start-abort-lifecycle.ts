import { defaultRuntime } from "@effect-ui/core";
import { Effect, Fiber, Scope } from "effect";

/** Shared cleanup handle for Start AbortSignal lifecycle helpers. */
export interface StartAbortSignalLifecycle {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
}

const noop = (): void => undefined;

const abortSignalAny = (
  signals: readonly AbortSignal[]
): AbortSignal | undefined => {
  const any = (AbortSignal as typeof AbortSignal & {
    readonly any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  return typeof any === "function" ? any([...signals]) : undefined;
};

const uniqueAbortSignals = (
  signals: Iterable<AbortSignal | undefined>
): readonly AbortSignal[] => {
  const unique: AbortSignal[] = [];
  for (const signal of signals) {
    if (signal !== undefined && !unique.includes(signal)) {
      unique.push(signal);
    }
  }
  return unique;
};

/**
 * Merges one or more AbortSignals while keeping fallback listener cleanup local.
 *
 * Native `AbortSignal.any(...)` owns cleanup when available. The fallback keeps
 * listener removal idempotent and propagates the first abort reason.
 */
export const mergeStartAbortSignals = (
  signals: Iterable<AbortSignal | undefined>
): StartAbortSignalLifecycle => {
  const uniqueSignals = uniqueAbortSignals(signals);
  if (uniqueSignals.length === 0) {
    return { signal: new AbortController().signal, cleanup: noop };
  }
  if (uniqueSignals.length === 1) {
    return { signal: uniqueSignals[0]!, cleanup: noop };
  }

  const nativeSignal = abortSignalAny(uniqueSignals);
  if (nativeSignal !== undefined) {
    return { signal: nativeSignal, cleanup: noop };
  }

  for (const signal of uniqueSignals) {
    if (signal.aborted) {
      return { signal, cleanup: noop };
    }
  }

  const controller = new AbortController();
  const cleanupHandlers: Array<() => void> = [];
  const abortFrom = (signal: AbortSignal): void => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of uniqueSignals) {
    const abort = (): void => abortFrom(signal);
    signal.addEventListener("abort", abort, { once: true });
    cleanupHandlers.push(() => signal.removeEventListener("abort", abort));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanupHandlers.splice(0)) {
        cleanup();
      }
    }
  };
};

/**
 * Installs a scoped abort finalizer and removes the listener when the scope ends.
 */
export const runStartAbortFinalizerOnSignalEffect = (
  signal: AbortSignal,
  finalizer: (reason: unknown) => void
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const runFinalizer = (): void => finalizer(signal.reason);
      if (signal.aborted) {
        runFinalizer();
      } else {
        signal.addEventListener("abort", runFinalizer, { once: true });
      }
      return runFinalizer;
    }),
    (runFinalizer) =>
      Effect.sync(() => {
        signal.removeEventListener("abort", runFinalizer);
      })
  ).pipe(Effect.asVoid);

/** Interrupts a forked host Effect from an AbortSignal and removes listeners on completion. */
export const interruptStartHostFiberOnSignal = <A, E>(
  fiber: Fiber.Fiber<A, E>,
  signal: AbortSignal,
  options: { readonly runOptions?: Effect.RunOptions } = {}
): (() => void) => {
  const interrupt = (): void => {
    void defaultRuntime.runFork(
      Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void)),
      options.runOptions
    );
  };
  const dispose = (): void => {
    signal.removeEventListener("abort", interrupt);
  };

  if (signal.aborted) {
    interrupt();
    return dispose;
  }

  signal.addEventListener("abort", interrupt, { once: true });
  const removeObserver = fiber.addObserver(dispose);
  return () => {
    dispose();
    removeObserver();
  };
};
