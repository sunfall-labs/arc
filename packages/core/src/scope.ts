import { Data, Effect, Exit, Fiber, Scope } from "effect";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { runFork } from "./runtime.js";

/** Options controlling how forked scoped Effects are started. */
export interface ForkScopedOptions {
  readonly startImmediately?: boolean;
  readonly uninterruptible?: boolean | "inherit";
}

export class UiScopeMissing extends Data.TaggedError("UiScopeMissing")<{
  readonly operation: string;
}> {}

export class UiScopeDisposed extends Data.TaggedError("UiScopeDisposed")<{
  readonly operation: string;
}> {}

/**
 * Closeable UI lifetime for Effects and finalizers.
 *
 * Use one UiScope per mounted UI boundary. Forked fibers and registered finalizers
 * are tied to the scope and are interrupted or run when the scope is disposed.
 */
export class UiScope {
  readonly effectScope: Scope.Closeable = Effect.runSync(Scope.make("sequential"));
  private disposed = false;

  /** Registers a finalizer to run when the scope is disposed. */
  addFinalizer(finalizer: () => EffectInput<void>): void {
    if (this.disposed) {
      void runFork(toEffect(finalizer()).pipe(Effect.catch(() => Effect.void)));
      return;
    }

    Effect.runSync(
      Scope.addFinalizer(
        this.effectScope,
        toEffect(finalizer()).pipe(Effect.catch(() => Effect.void))
      )
    );
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
  disposeEffect(): Effect.Effect<void, unknown> {
    const scope = this;
    return Effect.gen(function* () {
      if (scope.disposed) {
        return;
      }

      scope.disposed = true;
      yield* Scope.close(scope.effectScope, Exit.void);
    });
  }
}

let currentScope: UiScope | undefined;

export const getCurrentScope = (): UiScope | undefined => currentScope;

export const runWithScope = <A>(scope: UiScope, f: () => A): A => {
  const previous = currentScope;
  currentScope = scope;
  try {
    return f();
  } finally {
    currentScope = previous;
  }
};

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
