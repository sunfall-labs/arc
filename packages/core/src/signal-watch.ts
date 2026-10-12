import { Effect, Fiber, type Scope } from "effect";
import type { EffectInput } from "./effect-like.js";
import { type EffectInputCallbackError, invokeEffectInput } from "./effect-like.js";
import { runFork } from "./runtime.js";
import { getCurrentScope, UiScopeMissing } from "./scope.js";
import { makeSignalDependencyTracker, signalEvaluationError } from "./signal-dependencies.js";

/** Options for `watch`, including first-run behavior and equality checks. */
export interface WatchOptions<A> {
  /** Run the effect for the initial value. Defaults to true. */
  readonly immediate?: boolean;
  /** Equality function used to suppress duplicate watcher executions. Defaults to `Object.is`. */
  readonly equals?: (left: A, right: A) => boolean;
}

const observeDependencies = <A>(
  evaluate: () => A,
  onChange: (value: A, previous: A | undefined) => void,
  options: WatchOptions<A> = {},
  onFailure?: (error: EffectInputCallbackError) => void,
): (() => void) => {
  const equals = options.equals ?? Object.is;
  let initialized = false;
  let previous: A | undefined;

  const tracker = makeSignalDependencyTracker(
    evaluate,
    (value) => {
      const changed = !initialized || !equals(previous as A, value);
      const previousValue = previous;
      previous = value;

      if (changed && (initialized || options.immediate !== false)) {
        onChange(value, initialized ? previousValue : undefined);
      }

      initialized = true;
    },
    (cause) => onFailure?.(signalEvaluationError("Signal.watch.evaluate", cause)),
  );

  tracker.run();

  return () => tracker.dispose();
};

/**
 * Runs an Effect whenever the signals read by `evaluate` change.
 *
 * Must be called inside a `UiScope`; disposal interrupts the active watcher
 * fiber and removes dependency subscriptions.
 */
export const watch = <A, E = never>(
  evaluate: () => A,
  effect: (value: A, previous: A | undefined) => EffectInput<void, E, Scope.Scope>,
  options?: WatchOptions<A>,
): (() => void) => {
  const scope = getCurrentScope();
  if (!scope) {
    throw new UiScopeMissing({ operation: "watch" });
  }

  let disposed = false;
  let fiber: Fiber.Fiber<void, E | EffectInputCallbackError> | undefined;

  const disposeDependencies = observeDependencies(
    evaluate,
    (value, previous) => {
      if (disposed) {
        return;
      }

      if (fiber) {
        void runFork(Fiber.interrupt(fiber));
      }

      fiber = scope.fork(invokeEffectInput("Signal.watch", effect, value, previous));
    },
    options,
    (error) => {
      if (disposed) {
        return;
      }

      if (fiber) {
        void runFork(Fiber.interrupt(fiber));
      }

      fiber = scope.fork(Effect.fail(error));
    },
  );

  const dispose = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (disposed) {
        return;
      }

      disposed = true;
      disposeDependencies();
      if (fiber) {
        yield* Fiber.interrupt(fiber);
        fiber = undefined;
      }
    });

  scope.addFinalizer(() => dispose());

  return () => {
    void runFork(dispose());
  };
};
