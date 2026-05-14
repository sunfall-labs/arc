import { Data, Effect, Exit, Fiber, Scope } from "effect";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { runPromise } from "./runtime.js";

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

export class UiScope {
  readonly effectScope: Scope.Closeable = Scope.makeUnsafe("sequential");
  private disposed = false;

  addFinalizer(finalizer: () => EffectInput<void>): void {
    if (this.disposed) {
      void runPromise(toEffect(finalizer()));
      return;
    }

    Effect.runSync(
      Scope.addFinalizer(
        this.effectScope,
        toEffect(finalizer()).pipe(Effect.catch(() => Effect.void))
      )
    );
  }

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

  dispose(): Promise<void> {
    return runPromise(this.disposeEffect());
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

export const onScopeDispose = (finalizer: () => EffectInput<void>): void => {
  currentScope?.addFinalizer(finalizer);
};

export const onDispose = onScopeDispose;

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
