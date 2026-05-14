import { Effect, Fiber, Queue, Scope, Stream } from "effect";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { runPromise } from "./runtime.js";
import { getCurrentScope, UiScopeMissing } from "./scope.js";

export const SignalTypeId: unique symbol = Symbol.for("@effect-ui/core/Signal") as never;

export interface Subscribable {
  subscribe(listener: () => void): () => void;
}

export interface ReadableSignal<A> extends Subscribable {
  readonly [SignalTypeId]: typeof SignalTypeId;
  get(): A;
}

export interface WritableSignal<A> extends ReadableSignal<A> {
  set(value: A | ((current: A) => A)): void;
  update(f: (current: A) => A): void;
}

export interface SignalStreamOptions {
  readonly bufferSize?: number;
  readonly strategy?: "sliding" | "dropping" | "suspend";
}

interface Observer {
  depend(source: Subscribable): void;
}

export interface WatchOptions<A> {
  readonly immediate?: boolean;
  readonly equals?: (left: A, right: A) => boolean;
}

let currentObserver: Observer | undefined;

export const trackDependency = (source: Subscribable): void => {
  currentObserver?.depend(source);
};

const withObserver = <A>(observer: Observer, f: () => A): A => {
  const previous = currentObserver;
  currentObserver = observer;
  try {
    return f();
  } finally {
    currentObserver = previous;
  }
};

const withoutObserver = <A>(f: () => A): A => {
  const previous = currentObserver;
  currentObserver = undefined;
  try {
    return f();
  } finally {
    currentObserver = previous;
  }
};

const observeDependencies = <A>(
  evaluate: () => A,
  onChange: (value: A, previous: A | undefined) => void,
  options: WatchOptions<A> = {}
): (() => void) => {
  const equals = options.equals ?? Object.is;
  const cleanups = new Set<() => void>();
  const sources = new Set<Subscribable>();
  let disposed = false;
  let initialized = false;
  let previous: A | undefined;
  let running = false;
  let queued = false;

  const clearDependencies = (): void => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.clear();
    sources.clear();
  };

  const run = (): void => {
    if (disposed) {
      return;
    }

    if (running) {
      queued = true;
      return;
    }

    running = true;
    clearDependencies();

    try {
      const value = withObserver({
        depend: (source) => {
          if (sources.has(source)) {
            return;
          }

          sources.add(source);
          cleanups.add(source.subscribe(run));
        }
      }, evaluate);
      const changed = !initialized || !equals(previous as A, value);
      const previousValue = previous;
      previous = value;

      if (changed && (initialized || options.immediate !== false)) {
        onChange(value, initialized ? previousValue : undefined);
      }

      initialized = true;
    } finally {
      running = false;
      if (queued) {
        queued = false;
        run();
      }
    }
  };

  run();

  return () => {
    disposed = true;
    clearDependencies();
  };
};

export const watch = <A, E = unknown>(
  evaluate: () => A,
  effect: (value: A, previous: A | undefined) => EffectInput<void, E, Scope.Scope>,
  options?: WatchOptions<A>
): (() => void) => {
  const scope = getCurrentScope();
  if (!scope) {
    throw new UiScopeMissing({ operation: "watch" });
  }

  let disposed = false;
  let fiber: Fiber.Fiber<void, E> | undefined;

  const disposeDependencies = observeDependencies(
    evaluate,
    (value, previous) => {
      if (disposed) {
        return;
      }

      if (fiber) {
        void runPromise(Fiber.interrupt(fiber));
      }

      fiber = scope.fork(
        toEffect(effect(value, previous)) as Effect.Effect<void, E, Scope.Scope>
      );
    },
    options
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
    void runPromise(dispose());
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
    const next =
      typeof value === "function" ? (value as (current: A) => A)(this.value) : value;

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
  private readonly cleanups = new Set<() => void>();
  private initialized = false;
  private computing = false;

  constructor(private readonly compute: () => A) {
    super();
    this.recompute();
  }

  get(): A {
    trackDependency(this);
    return this.value;
  }

  private depend(source: Subscribable): void {
    const cleanup = source.subscribe(() => this.recompute());
    this.cleanups.add(cleanup);
  }

  private clearDependencies(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups.clear();
  }

  private recompute(): void {
    if (this.computing) {
      return;
    }

    this.computing = true;
    this.clearDependencies();

    try {
      const next = withObserver({ depend: (source) => this.depend(source) }, this.compute);
      const changed = !this.initialized || !Object.is(this.value, next);
      this.value = next;
      this.initialized = true;

      if (changed) {
        this.notify();
      }
    } finally {
      this.computing = false;
    }
  }
}

export const isSignal = (value: unknown): value is ReadableSignal<unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [SignalTypeId]?: unknown })[SignalTypeId] === SignalTypeId;

export namespace Signal {
  export type Readable<A> = ReadableSignal<A>;
  export type Writable<A> = WritableSignal<A>;
  export type StreamOptions = SignalStreamOptions;

  export const make = <A>(initial: A): WritableSignal<A> => new WritableSignalImpl(initial);

  export const derive = <A>(compute: () => A): ReadableSignal<A> =>
    new DerivedSignalImpl(compute);

  export const get = <A>(signal: ReadableSignal<A>): A => signal.get();

  export const peek = <A>(signal: ReadableSignal<A>): A =>
    withoutObserver(() => signal.get());

  export const untracked = <A>(f: () => A): A => withoutObserver(f);

  export const set = <A>(signal: WritableSignal<A>, value: A | ((current: A) => A)): void => {
    signal.set(value);
  };

  export const subscribe = <A>(signal: ReadableSignal<A>, listener: () => void): (() => void) =>
    signal.subscribe(listener);

  export const changes = <A>(
    signal: ReadableSignal<A>,
    options?: SignalStreamOptions
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
      options
    );

  export const values = <A>(
    signal: ReadableSignal<A>,
    options?: SignalStreamOptions
  ): Stream.Stream<A> =>
    Stream.concat(Stream.sync(() => peek(signal)), changes(signal, options));

  export const fromStreamEffect = <A, R>(
    stream: Stream.Stream<A, never, R>,
    initial: A
  ): Effect.Effect<ReadableSignal<A>, never, R | Scope.Scope> =>
    Effect.gen(function* () {
      const signal = make(initial);

      yield* stream.pipe(
        Stream.runForEach((value) => Effect.sync(() => signal.set(value))),
        Effect.forkScoped({ startImmediately: true })
      );

      return signal;
    });

  export const fromStream = <A>(
    stream: Stream.Stream<A, never, never>,
    initial: A
  ): ReadableSignal<A> => {
    const scope = getCurrentScope();
    if (!scope) {
      throw new UiScopeMissing({ operation: "Signal.fromStream" });
    }

    const signal = make(initial);
    scope.fork(
      stream.pipe(Stream.runForEach((value) => Effect.sync(() => signal.set(value))))
    );

    return signal;
  };
}
