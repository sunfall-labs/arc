import { createSignal, getObserver, untrack } from "@solidjs/signals";
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
import {
  batchSignalWrites,
  currentSignalCommitSequence,
  currentSignalTransaction,
  currentSignalTravelView,
  isReadingSignalView,
  readSignalsThroughView,
  readSignalTransactionValue,
  renderedSignalProjections,
  signalTransaction,
  writeSignalTransactionValue,
  type SignalTransactionOptions,
  type SignalTransactionState,
  type SignalTransactionWritable,
} from "./signal-transaction.js";

export const SignalTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/Signal",
) as typeof SignalTypeId;

/**
 * Read-only reactive cell that participates in Sunfall Arc dependency tracking.
 *
 * Effect and synchronous code read committed state (or their own transaction's
 * writes). Solid computations read the rendered value, which tracks natively
 * and catches up atomically at Solid's next flush.
 */
export interface ReadableSignal<A> extends Subscribable {
  readonly [SignalTypeId]: typeof SignalTypeId;
  /** Reads the value and records a dependency for derived signals/watchers. */
  get(): A;
}

/**
 * Mutable signal. Every write is transactional: it joins the caller's open
 * transaction (`Signal.transaction` / `Signal.batch`) or commits on its own.
 * Subscribers run only after commit, and only when `Object.is` sees a change.
 */
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

export type { SignalTransactionOptions };

/** Options for `Signal.make`. */
export interface SignalOptions {
  /** Label shown on `Timeline` entries. Unnamed signals get a stable `signal#N` id. */
  readonly name?: string;
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
  private projection: (() => A) | undefined;

  abstract get(): A;

  /** Value visible to Effect and synchronous code. */
  protected abstract readVisible(): A;

  /**
   * Value shown to Solid: committed state, or the travelled view while a
   * timeline travels. Effects keep reading committed state either way.
   */
  private renderedValue(): A {
    const view = currentSignalTravelView();
    return view === undefined
      ? untrack(() => this.readVisible())
      : readSignalsThroughView(view, () =>
          withoutSignalDependencyObserver(() => untrack(() => this.readVisible())),
        );
  }

  /**
   * Solid-facing read. The projection is created on the first tracked read and
   * released once Solid stops observing it, so unrendered signals cost nothing.
   */
  protected readRendered(): A {
    if (!this.projection) {
      let rendered = this.renderedValue();
      // Values are boxed: Solid treats a bare function passed to `createSignal`
      // or its setter as a computation, but signal values may be functions.
      const [read, write] = createSignal<{ readonly value: A }>(
        { value: rendered },
        {
          ownedWrite: true,
          unobserved: () => {
            unsubscribe();
            renderedSignalProjections.delete(refresh);
            this.projection = undefined;
          },
        },
      );
      const refresh = (): void => {
        const next = this.renderedValue();
        if (!Object.is(next, rendered)) {
          rendered = next;
          write({ value: next });
        }
      };
      const unsubscribe = this.subscribe(refresh);
      renderedSignalProjections.add(refresh);
      this.projection = () => read().value;
    }
    return this.projection();
  }

  /** Solid computations read rendered state; everything else reads committed state. */
  protected read(): A {
    trackDependency(this);
    return getObserver() ? this.readRendered() : this.readVisible();
  }

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

/** Ids handed to unnamed signals the first time a timeline labels them. */
let unnamedSignalCount = 0;

class WritableSignalImpl<A>
  extends BaseSignal<A>
  implements WritableSignal<A>, SignalTransactionWritable
{
  private label: string | undefined;

  constructor(
    private value: A,
    options: SignalOptions | undefined,
  ) {
    super();
    this.label = options?.name;
  }

  timelineName(): string {
    this.label ??= `signal#${++unnamedSignalCount}`;
    return this.label;
  }

  get(): A {
    return this.read();
  }

  protected readVisible(): A {
    return readSignalTransactionValue(this) as A;
  }

  set(value: A | ((current: A) => A)): void {
    const next =
      typeof value === "function" ? (value as (current: A) => A)(this.readVisible()) : value;
    writeSignalTransactionValue(this, next);
  }

  readCommitted(): unknown {
    return this.value;
  }

  writeCommitted(value: unknown): boolean {
    if (Object.is(this.value, value)) {
      return false;
    }
    this.value = value as A;
    return true;
  }

  notifyCommitted(): void {
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
      () => untrack(this.compute),
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
    return this.read();
  }

  protected readVisible(): A {
    // A travelled view is not committed state, so derive from it uncached.
    if (isReadingSignalView()) {
      try {
        return untrack(this.compute);
      } catch (cause) {
        throw signalEvaluationError("Signal.derive", cause);
      }
    }
    // Staged writes are not committed yet, so derive from them, caching the
    // value for the transaction's current write set.
    const transaction = currentSignalTransaction();
    if (transaction !== undefined && transaction.writes.size > 0) {
      return this.readStaged(transaction);
    }
    if (!this.tracker) {
      this.evaluateUntracked();
    }
    if (this.failure) {
      throw signalEvaluationError("Signal.derive", this.failure.cause);
    }
    return this.value;
  }

  private staged:
    | {
        readonly transaction: SignalTransactionState;
        readonly version: number;
        readonly commits: number;
        readonly value: A;
      }
    | undefined;

  private readStaged(transaction: SignalTransactionState): A {
    const staged = this.staged;
    const commits = currentSignalCommitSequence();
    if (
      staged?.transaction === transaction &&
      staged.version === transaction.version &&
      staged.commits === commits
    ) {
      return staged.value;
    }
    let value: A;
    try {
      value = withoutSignalDependencyObserver(() => untrack(this.compute));
    } catch (cause) {
      throw signalEvaluationError("Signal.derive", cause);
    }
    this.staged = { transaction, version: transaction.version, commits, value };
    return value;
  }

  private evaluateUntracked(): void {
    try {
      this.applyValue(withoutSignalDependencyObserver(() => untrack(this.compute)));
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

  /** Creates a writable signal, optionally named for `Timeline` entries. */
  export const make = <A>(initial: A, options?: SignalOptions): WritableSignal<A> =>
    new WritableSignalImpl(initial, options);

  /** Creates a derived signal that tracks the signals read by `compute`. */
  export const derive = <A>(compute: () => A): ReadableSignal<A> => new DerivedSignalImpl(compute);

  /** Reads a signal and records dependency tracking when one is active. */
  export const get = <A>(signal: ReadableSignal<A>): A => signal.get();

  /** Reads a signal's committed (or own-transaction) value without recording a dependency. */
  export const peek = <A>(signal: ReadableSignal<A>): A =>
    withoutSignalDependencyObserver(() => untrack(() => signal.get()));

  /** Runs synchronous work with dependency tracking disabled. */
  export const untracked = <A>(f: () => A): A => withoutSignalDependencyObserver(() => untrack(f));

  /**
   * Runs an Effect as one atomic transaction owned by the current fiber.
   *
   * Reads inside see the transaction's own writes; other fibers and the UI see
   * none of them until success commits all of them at once. Failure or
   * interruption commits nothing. Nested transactions join the outer one, and
   * fibers forked inside belong to it until it ends. `cause` labels the
   * commit on a recording `Timeline`.
   */
  export const transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: SignalTransactionOptions,
  ) => Effect.Effect<A, E, R> = signalTransaction;

  /**
   * Synchronous counterpart of `transaction`: reads inside `f` see its writes,
   * subscribers run once after it returns, and a throw commits nothing.
   */
  export const batch: <A>(f: () => A, options?: SignalTransactionOptions) => A = batchSignalWrites;

  /** Writes `f(current)` and returns the value now visible to the caller. */
  export const updateAndGet = <A>(
    signal: WritableSignal<A>,
    f: (current: A) => A,
  ): Effect.Effect<A> =>
    Effect.sync(() => {
      signal.set(f);
      return peek(signal);
    });

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
