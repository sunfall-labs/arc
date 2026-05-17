import { Effect, Fiber, Queue, Scope, Stream } from "effect";
import type { EffectInput } from "./effect-like.js";
import { EffectInputCallbackError, invokeEffectInput } from "./effect-like.js";
import { runFork } from "./runtime.js";
import { getCurrentScope, UiScopeMissing } from "./scope.js";
import {
  makeSignalDependencyTracker,
  trackSignalDependency,
  withoutSignalDependencyObserver,
  type SignalDependencyTracker,
  type Subscribable,
} from "./signal-dependencies.js";

export const SignalTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/Signal",
) as typeof SignalTypeId;

/** Read-only reactive cell that participates in Sunfall Arc dependency tracking. */
export interface ReadableSignal<A> extends Subscribable {
  readonly [SignalTypeId]: typeof SignalTypeId;
  /** Reads the value and records a dependency for derived signals/watchers. */
  get(): A;
}

/** Mutable signal. Writes notify subscribers only when `Object.is` sees a new value. */
export interface WritableSignal<A> extends ReadableSignal<A> {
  /** Replaces the value or computes a next value from the current one. */
  set(value: A | ((current: A) => A)): void;
  /** Computes and writes a next value from the current one. */
  update(f: (current: A) => A): void;
}

/** Buffer settings for signal-backed streams. */
export interface SignalStreamOptions {
  /** Queue size used by the generated stream. */
  readonly bufferSize?: number;
  /** Queue overflow strategy used by the generated stream. */
  readonly strategy?: "sliding" | "dropping" | "suspend";
}

/** Options for `watch`, including first-run behavior and equality checks. */
export interface WatchOptions<A> {
  /** Run the effect for the initial value. Defaults to true. */
  readonly immediate?: boolean;
  /** Equality function used to suppress duplicate watcher executions. Defaults to `Object.is`. */
  readonly equals?: (left: A, right: A) => boolean;
}

/** Manually records a dependency on a subscribable source for the active tracker. */
export const trackDependency = (source: Subscribable): void => {
  trackSignalDependency(source);
};

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

const signalEvaluationError = (operation: string, cause: unknown): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation,
    cause,
    guidance:
      "Signal evaluators must be pure and total. Synchronous evaluator throws are reported as typed callback failures.",
  });

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

abstract class BaseSignal<A> implements ReadableSignal<A> {
  readonly [SignalTypeId]: typeof SignalTypeId = SignalTypeId;
  protected readonly listeners = new Set<() => void>();

  abstract get(): A;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected notify(): void {
    const listeners = Array.from(this.listeners);
    for (const listener of listeners) {
      listener();
    }
  }
}

class WritableSignalImpl<A> extends BaseSignal<A> implements WritableSignal<A> {
  constructor(private value: A) {
    super();
  }

  get(): A {
    trackDependency(this);
    return this.value;
  }

  set(value: A | ((current: A) => A)): void {
    const next = typeof value === "function" ? (value as (current: A) => A)(this.value) : value;

    if (Object.is(this.value, next)) {
      return;
    }

    this.value = next;
    this.notify();
  }

  update(f: (current: A) => A): void {
    this.set(f);
  }
}

class DerivedSignalImpl<A> extends BaseSignal<A> {
  private value!: A;
  private initialized = false;
  private failure: { readonly cause: unknown } | undefined;
  private tracker: SignalDependencyTracker | undefined;

  constructor(private readonly compute: () => A) {
    super();
    this.evaluateUntracked();
  }

  override subscribe(listener: () => void): () => void {
    const unsubscribe = super.subscribe(listener);
    if (this.listeners.size === 1) {
      this.startTracking();
    }

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }

      disposed = true;
      unsubscribe();
      if (this.listeners.size === 0) {
        this.stopTracking();
      }
    };
  }

  private startTracking(): void {
    if (this.tracker) {
      return;
    }

    this.tracker = makeSignalDependencyTracker(
      this.compute,
      (next) => this.applyValue(next),
      (cause) => this.applyFailure(cause),
    );
    this.tracker.run();
  }

  private stopTracking(): void {
    this.tracker?.dispose();
    this.tracker = undefined;
  }

  get(): A {
    trackDependency(this);
    if (!this.tracker) {
      this.evaluateUntracked();
    }
    if (this.failure) {
      throw signalEvaluationError("Signal.derive", this.failure.cause);
    }
    return this.value;
  }

  private evaluateUntracked(): void {
    try {
      this.applyValue(withoutSignalDependencyObserver(this.compute));
    } catch (cause) {
      this.applyFailure(cause);
    }
  }

  private applyFailure(cause: unknown): void {
    this.failure = { cause };
  }

  private applyValue(next: A): void {
    const hadFailure = this.failure !== undefined;
    const changed = !this.initialized || !Object.is(this.value, next);
    this.failure = undefined;
    this.value = next;
    this.initialized = true;

    if (changed || hadFailure) {
      this.notify();
    }
  }
}

/** Runtime guard for Sunfall Arc signals. */
export const isSignal = (value: unknown): value is ReadableSignal<unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [SignalTypeId]?: unknown })[SignalTypeId] === SignalTypeId;

export namespace Signal {
  export type Readable<A> = ReadableSignal<A>;
  export type Writable<A> = WritableSignal<A>;
  export type StreamOptions = SignalStreamOptions;

  /** Creates a writable signal. */
  export const make = <A>(initial: A): WritableSignal<A> => new WritableSignalImpl(initial);

  /** Creates a derived signal that tracks the signals read by `compute`. */
  export const derive = <A>(compute: () => A): ReadableSignal<A> => new DerivedSignalImpl(compute);

  /** Reads a signal and records dependency tracking when one is active. */
  export const get = <A>(signal: ReadableSignal<A>): A => signal.get();

  /** Reads a signal without recording a dependency. */
  export const peek = <A>(signal: ReadableSignal<A>): A =>
    withoutSignalDependencyObserver(() => signal.get());

  /** Runs synchronous work with dependency tracking disabled. */
  export const untracked = <A>(f: () => A): A => withoutSignalDependencyObserver(f);

  /** Writes to a writable signal. */
  export const set = <A>(signal: WritableSignal<A>, value: A | ((current: A) => A)): void => {
    signal.set(value);
  };

  /** Subscribes to change notifications and returns an unsubscribe function. */
  export const subscribe = <A>(signal: ReadableSignal<A>, listener: () => void): (() => void) =>
    signal.subscribe(listener);

  /** Stream of future signal values. The current value is not emitted immediately. */
  export const changes = <A>(
    signal: ReadableSignal<A>,
    options?: SignalStreamOptions,
  ): Stream.Stream<A> =>
    Stream.callback<A>(
      (queue) =>
        Effect.gen(function* () {
          const scope = yield* Scope.Scope;
          const unsubscribe = signal.subscribe(() => {
            Queue.offerUnsafe(queue, peek(signal));
          });

          yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe));
        }),
      options,
    );

  /** Stream that emits the current value first, then future changes. */
  export const values = <A>(
    signal: ReadableSignal<A>,
    options?: SignalStreamOptions,
  ): Stream.Stream<A> =>
    Stream.concat(
      Stream.sync(() => peek(signal)),
      changes(signal, options),
    );

  /** Creates a signal from a stream inside an Effect scope. */
  export const fromStreamEffect = <A, R>(
    stream: Stream.Stream<A, never, R>,
    initial: A,
  ): Effect.Effect<ReadableSignal<A>, never, R | Scope.Scope> =>
    Effect.gen(function* () {
      const signal = make(initial);

      yield* stream.pipe(
        Stream.runForEach((value) => Effect.sync(() => signal.set(value))),
        Effect.forkScoped({ startImmediately: true }),
      );

      return signal;
    });

  /** Creates a signal from a stream using the current `UiScope`. */
  export const fromStream = <A>(
    stream: Stream.Stream<A, never, never>,
    initial: A,
  ): ReadableSignal<A> => {
    const scope = getCurrentScope();
    if (!scope) {
      throw new UiScopeMissing({ operation: "Signal.fromStream" });
    }

    const signal = make(initial);
    scope.fork(stream.pipe(Stream.runForEach((value) => Effect.sync(() => signal.set(value)))));

    return signal;
  };
}
