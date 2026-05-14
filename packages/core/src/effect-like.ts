import { Effect } from "effect";
import { runPromise } from "./runtime.js";

export type EffectInput<A, E = unknown, R = never> =
  | A
  | Effect.Effect<A, E, R>;

export type EffectInputValue<Out> = Out extends PromiseLike<unknown>
  ? never
  : Out extends Effect.Effect<infer A, any, any>
    ? A
    : Out;

export type EffectInputError<Out> = Out extends Effect.Effect<any, infer E, any> ? E : never;

export type EffectInputRequirements<Out> = Out extends Effect.Effect<any, any, infer R> ? R : never;

export type EnsureEffectInputValue<Out, A> = EffectInputValue<Out> extends A ? Out : never;

export type EnsureEffectInput<Out> = Out extends PromiseLike<unknown> ? never : Out;

export const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof (value as { then?: unknown }).then === "function";

export const isEffectLike = (value: unknown): value is Effect.Effect<unknown, unknown, unknown> =>
  Effect.isEffect(value);

export const toEffect = <A, E = unknown, R = never>(
  value: EffectInput<A, E, R>
): Effect.Effect<A, E, R> => {
  if (isEffectLike(value)) {
    return value as Effect.Effect<A, E, R>;
  }

  if (isPromiseLike(value)) {
    return Effect.tryPromise({
      try: () => value,
      catch: (error) => error as E
    }) as Effect.Effect<A, E, R>;
  }

  return Effect.succeed(value as A);
};

export const runEffectInput = <A, E = unknown, R = never>(
  value: EffectInput<A, E, R>
): Promise<A> =>
  runPromise(toEffect(value) as Effect.Effect<A, E, R>);
