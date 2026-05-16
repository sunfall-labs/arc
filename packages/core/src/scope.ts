import { Data, Effect, Exit, Fiber, Scope } from "effect";
import type { EffectInput } from "./effect-like.js";
import { invokeEffectInput } from "./effect-like.js";
import { runFork, runWithRuntime, type AnyEffectUiRuntime } from "./runtime.js";

/** Options controlling how forked scoped Effects are started. */
export interface ForkScopedOptions {
  readonly startImmediately?: boolean;
  readonly uninterruptible?: boolean | "inherit";
}

/** Options controlling how a `UiScope` runs cleanup registered after disposal. */
export interface UiScopeOptions {
  /**
   * Runs a finalizer that is registered after the scope has already been
   * disposed. Framework adapters should bind this to the owning Runtime Spine.
   */
  readonly runLateFinalizer?: (effect: Effect.Effect<void>) => void;
}

/** Error thrown when scoped UI work runs without an active `UiScope`. */
export class UiScopeMissing extends Data.TaggedError("UiScopeMissing")<{
  readonly operation: string;
}> {}

/** Error thrown when work is forked into a `UiScope` that has already disposed. */
export class UiScopeDisposed extends Data.TaggedError("UiScopeDisposed")<{
  readonly operation: string;
}> {}

/**
 * Closeable UI lifetime for Effects and finalizers.
 *
 * Use one UiScope per mounted UI lifetime. Forked fibers and registered finalizers
 * are tied to the scope and are interrupted or run when the scope is disposed.
 */
export class UiScope {
  readonly effectScope: Scope.Closeable = Effect.runSync(Scope.make("sequential"));
  private readonly finalizers: Array<() => EffectInput<void>> = [];
  private readonly runLateFinalizer: (effect: Effect.Effect<void>) => void;
  private disposed = false;

  constructor(options: UiScopeOptions = {}) {
    this.runLateFinalizer =
      options.runLateFinalizer ??
      ((effect) => {
        void runFork(effect);
      });
  }

  /** Registers a finalizer to run when the scope is disposed. */
  addFinalizer(finalizer: () => EffectInput<void>): void {
    if (this.disposed) {
      this.runLateFinalizer(
        invokeEffectInput("UiScope.finalizer", finalizer).pipe(
          Effect.catch(() => Effect.void)
        )
      );
      return;
    }

    this.finalizers.push(finalizer);
  }

  /** Forks an Effect into this scope so it is interrupted on disposal. */
  fork<A, E>(
    effect: Effect.Effect<A, E, Scope.Scope>,
    options: ForkScopedOptions = {}
  ): Fiber.Fiber<A, E> {
    if (this.disposed) {
      throw new UiScopeDisposed({ operation: "fork" });
    }

    return Effect.runSync(
      Effect.forkIn(
        Scope.provide(effect, this.effectScope),
        this.effectScope,
        {
          startImmediately: options.startImmediately ?? true,
          uninterruptible: options.uninterruptible
        }
      )
    );
  }

  /** Effect-first disposal for integrations that already run inside Effect. */
  disposeEffect(): Effect.Effect<void> {
    const scope = this;
    return Effect.gen(function* () {
      if (scope.disposed) {
        return;
      }

      scope.disposed = true;
      const finalizers = scope.finalizers.splice(0).reverse();
      const closeExit = yield* Effect.exit(Scope.close(scope.effectScope, Exit.void));
      for (const finalizer of finalizers) {
        yield* invokeEffectInput("UiScope.finalizer", finalizer).pipe(
          Effect.catch(() => Effect.void)
        );
      }
      if (Exit.isFailure(closeExit)) {
        return yield* Effect.failCause(closeExit.cause);
      }
    });
  }
}

/**
 * Creates a UI lifetime whose late finalizers run on the owning Runtime Spine.
 *
 * Framework adapters should use this when a component, route frame, or preload
 * scope is tied to a runtime so cleanup registered after disposal still sees
 * the same services and runtime error channel.
 */
export const makeRuntimeUiScope = <ER>(runtime: AnyEffectUiRuntime<ER>): UiScope =>
  new UiScope({
    runLateFinalizer: (effect) => {
      void runtime.runFork(effect);
    }
  });

/** Runtime-owned UI frame used by framework adapters during one render lifetime. */
export interface RuntimeUiScopeFrame<ER = unknown> {
  /** Runtime Spine that owns Effect execution for this frame. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /** Ambient UI scope for component or route construction. */
  readonly scope: UiScope;
  /** Runs synchronous construction with both runtime and UI scope installed. */
  run<A>(f: () => A): A;
  /** Runtime-bound, failure-swallowing disposal for host cleanup hooks. */
  disposeEffect(): Effect.Effect<void>;
}

/** Creates a runtime-owned UI frame for adapter component or route lifetimes. */
export const makeRuntimeUiScopeFrame = <ER>(runtime: AnyEffectUiRuntime<ER>): RuntimeUiScopeFrame<ER> => {
  const scope = makeRuntimeUiScope(runtime);
  return {
    runtime,
    scope,
    run: (f) => runWithRuntime(runtime, () => runWithScope(scope, f)),
    disposeEffect: () =>
      runtime.provide(scope.disposeEffect()).pipe(Effect.catchCause(() => Effect.void))
  };
};

let currentScope: UiScope | undefined;

/** Returns the ambient `UiScope`, when framework construction installed one. */
export const getCurrentScope = (): UiScope | undefined => currentScope;

/** Runs synchronous construction while `scope` is the ambient UI scope. */
export const runWithScope = <A>(scope: UiScope, f: () => A): A => {
  const previous = currentScope;
  currentScope = scope;
  try {
    return f();
  } finally {
    currentScope = previous;
  }
};

/**
 * Runs synchronous construction while a new `UiScope` is the ambient UI scope.
 *
 * The returned scope is caller-owned. This helper does not dispose it
 * automatically; framework adapters should close the scope from their host
 * cleanup hook, and short-lived Effect workflows should prefer `Effect.scoped`.
 */
export const scoped = <A>(f: (scope: UiScope) => A): A => {
  const scope = new UiScope();
  return runWithScope(scope, () => f(scope));
};

/**
 * Registers cleanup work on the current UiScope.
 *
 * The finalizer can return void or an Effect. It is ignored when no scope is active,
 * which makes it safe for framework adapters to call conditionally.
 */
export const onScopeDispose = (finalizer: () => EffectInput<void>): void => {
  currentScope?.addFinalizer(finalizer);
};

/** Alias for onScopeDispose, intended for framework-style cleanup hooks. */
export const onDispose = onScopeDispose;

/**
 * Forks an Effect into the current UiScope.
 *
 * Use this for background UI work that should stop when the component or adapter
 * scope is disposed.
 */
export const forkScoped = <A, E>(
  effect: Effect.Effect<A, E, Scope.Scope>,
  options?: ForkScopedOptions
): Fiber.Fiber<A, E> => {
  const scope = getCurrentScope();
  if (!scope) {
    throw new UiScopeMissing({ operation: "forkScoped" });
  }

  return scope.fork(effect, options);
};
