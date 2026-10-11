// Spike: Arc Resource reads as fiber-backed Solid 2 async memos.
// Cached values return synchronously (hydration path); misses return a
// thenable over a forked fiber, which is interrupted when the computation
// re-runs or its owner is disposed.
import { Cause, Effect, Exit, Fiber } from "effect";
import { createMemo, onCleanup, type Accessor } from "@solidjs/signals";

export class EffectFailure<E> extends Error {
  readonly _tag = "EffectFailure";
  constructor(readonly cause: Cause.Cause<E>) {
    super(Cause.pretty(cause));
  }
}

export interface EffectMemoOptions<A> {
  /** Synchronous cache lookup (Resource Store hit / hydrated value). */
  readonly peek?: () => { readonly value: A } | undefined;
}

export const effectMemo = <A, E>(
  compute: () => Effect.Effect<A, E>,
  options: EffectMemoOptions<A> = {},
): Accessor<A> =>
  createMemo(() => {
    const effect = compute();
    const hit = options.peek?.();
    if (hit !== undefined) return hit.value;

    const fiber = Effect.runFork(effect);
    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });
    return new Promise<A>((resolve, reject) => {
      fiber.addObserver((exit) => {
        if (Exit.isSuccess(exit)) resolve(exit.value);
        else if (!Cause.hasInterruptsOnly(exit.cause)) reject(new EffectFailure(exit.cause));
      });
    });
  });
