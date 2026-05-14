import { Data, Effect } from "effect";

/**
 * Input accepted by convenience APIs that can run either a plain value or an Effect.
 *
 * Public core APIs prefer Effect-returning variants. EffectInput exists so definitions
 * can stay ergonomic while still being normalized before execution.
 */
export type EffectInput<A, E = never, R = never> =
  | A
  | Effect.Effect<A, E, R>;

export type EffectInputValue<Out> = Out extends PromiseLike<unknown>
  ? never
  : Out extends Effect.Effect<infer A, unknown, unknown>
    ? A
    : Out;

export type EffectInputError<Out> = Out extends Effect.Effect<unknown, infer E, unknown> ? E : never;

export type EffectInputRequirements<Out> = Out extends Effect.Effect<unknown, unknown, infer R> ? R : never;

export type EnsureEffectInputValue<Out, A> = EffectInputValue<Out> extends A ? Out : never;

export type EnsureEffectInput<Out> = Out extends PromiseLike<unknown> ? never : Out;

export function isEffectLike<A, E, R>(value: EffectInput<A, E, R>): value is Effect.Effect<A, E, R>;
export function isEffectLike(value: unknown): value is Effect.Effect<unknown, unknown, unknown>;
export function isEffectLike(value: unknown): value is Effect.Effect<unknown, unknown, unknown> {
  return Effect.isEffect(value);
}

/**
 * Defect raised when a Promise-shaped value crosses an EffectInput seam.
 *
 * Promise work should be adapted explicitly at host boundaries with
 * `Effect.tryPromise(...)`; library internals should stay Effect-first.
 */
export class EffectInputPromiseRejected extends Data.TaggedError(
  "EffectInputPromiseRejected"
)<{
  readonly guidance: string;
}> {}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => {
  if (value === null) {
    return false;
  }

  const valueType = typeof value;
  if (valueType !== "object" && valueType !== "function") {
    return false;
  }

  return typeof (value as { readonly then?: unknown }).then === "function";
};

/**
 * Normalizes a value or Effect into an Effect.
 *
 * Use this at API boundaries that accept EffectInput, then keep the rest of the
 * implementation Effect-first.
 */
export const toEffect = <A, E = never, R = never>(
  value: EffectInput<A, E, R>
): Effect.Effect<A, E, R> => {
  if (isEffectLike(value)) {
    return value;
  }

  if (isPromiseLike(value)) {
    return Effect.die(new EffectInputPromiseRejected({
      guidance: "EffectInput does not accept Promise-shaped values. Wrap host Promise work in Effect.tryPromise(...) at the host adapter seam."
    }));
  }

  return Effect.succeed(value as A);
};
