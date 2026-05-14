import { Effect } from "effect";

/**
 * Input accepted by convenience APIs that can run either a plain value or an Effect.
 *
 * Public core APIs prefer Effect-returning variants. EffectInput exists so definitions
 * can stay ergonomic while still being normalized before execution.
 */
export type EffectInput<A, E = unknown, R = never> =
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
 * Normalizes a value or Effect into an Effect.
 *
 * Use this at API boundaries that accept EffectInput, then keep the rest of the
 * implementation Effect-first.
 */
export const toEffect = <A, E = unknown, R = never>(
  value: EffectInput<A, E, R>
): Effect.Effect<A, E, R> => {
  if (isEffectLike(value)) {
    return value;
  }

  return Effect.succeed(value as A);
};
