import { createSignal, getObserver, untrack } from "@solidjs/signals";
import { Effect, Queue, Scope, Stream } from "effect";
import {
  makeSignalDependencyTracker,
  signalEvaluationError,
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
  withSignalTransition,
  writeSignalTransactionValue,
  type SignalTransactionState,
  type SignalTransactionWritable,
} from "./signal-transaction.js";
import type { TimelineTransitionCause } from "./timeline.js";

export { SignalWriteOutsideTransition } from "./signal-transaction.js";

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
 * Mutable signal. Every write is transactional and named: it joins the
 * caller's open transaction (`Signal.transaction` / `Signal.batch`, an Action,
 * a Program update) or commits on its own under the caller's named
 * `Component.callback`. A write outside every named transition dies with
 * `SignalWriteOutsideTransition`. Subscribers run only after commit, and only
 * when `Object.is` sees a change.
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

/** Options for `Signal.transaction` and `Signal.batch`. */
export interface SignalTransactionOptions {
  /**
   * Names the commit on the `Timeline` (a `Transition` cause). Without one the
   * transaction commits under the caller's named transition, and writing in it
   * outside any dies with `SignalWriteOutsideTransition`. A nested transaction
   * names the commit only when the outer one has no name.
   */
  readonly name?: string;
}

/** Options for `Signal.make` and `Signal.fromStream`. */
export interface SignalOptions {
  /** Label shown on `Timeline` changes and in `SignalWriteOutsideTransition`. */
  readonly name: string;
}

const transitionCause = (name: string | undefined): TimelineTransitionCause | undefined =>
  name === undefined ? undefined : { _tag: "Transition", name };

/** Manually records a dependency on a subscribable source for the active tracker. */
export const trackDependency = (source: Subscribable): void => {
  trackSignalDependency(source);
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

class WritableSignalImpl<A>
  extends BaseSignal<A>
  implements WritableSignal<A>, SignalTransactionWritable
{
  constructor(
    private value: A,
    private readonly name: string,
  ) {
    super();
  }

  timelineName(): string {
    return this.name;
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

  /**
   * Creates a writable signal. `name` labels its `Timeline` changes and the
   * `SignalWriteOutsideTransition` defect a write outside a named transition raises.
   */
  export const make = <A>(initial: A, options: SignalOptions): WritableSignal<A> =>
    new WritableSignalImpl(initial, options.name);

  /** Creates a derived signal that tracks the signals read by `compute`. */
  export const derive = <A>(compute: () => A): ReadableSignal<A> => new DerivedSignalImpl(compute);

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
   * fibers forked inside belong to it until it ends. `name` labels the commit
   * on the `Timeline`; without it the commit takes the caller's named
   * transition, and a write with neither dies with `SignalWriteOutsideTransition`.
   */
  export const transaction = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: SignalTransactionOptions,
  ): Effect.Effect<A, E, R> => signalTransaction(effect, transitionCause(options?.name));

  /**
   * Synchronous counterpart of `transaction`: reads inside `f` see its writes,
   * subscribers run once after it returns, and a throw commits nothing. Name
   * it to write from plain synchronous code (a test, a Solid handler).
   */
  export const batch = <A>(f: () => A, options?: SignalTransactionOptions): A =>
    batchSignalWrites(f, transitionCause(options?.name));

  /** Writes `f(current)` and returns the value now visible to the caller. */
  export const updateAndGet = <A>(
    signal: WritableSignal<A>,
    f: (current: A) => A,
  ): Effect.Effect<A> =>
    Effect.sync(() => {
      signal.set(f);
      return peek(signal);
    });

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

  /**
   * Creates a signal from a stream inside an Effect scope. `name` labels the
   * signal, and each element commits under a transition of the same name.
   */
  export const fromStream = <A, R>(
    stream: Stream.Stream<A, never, R>,
    initial: A,
    options: SignalOptions,
  ): Effect.Effect<ReadableSignal<A>, never, R | Scope.Scope> =>
    Effect.gen(function* () {
      const signal = make(initial, options);

      yield* stream.pipe(
        Stream.runForEach((value) => Effect.sync(() => signal.set(value))),
        (run) => withSignalTransition(run, { _tag: "Transition", name: options.name }),
        Effect.forkScoped({ startImmediately: true }),
      );

      return signal;
    });
}
