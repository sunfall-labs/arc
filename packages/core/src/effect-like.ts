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
  : Out extends Effect.Effect<infer A, infer _E, infer _R>
    ? A
    : Out;

export type EffectInputError<Out> = Out extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;

export type EffectInputRequirements<Out> = Out extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;

type HasPromiseLike<Out> = unknown extends Out
  ? false
  : Extract<Out, PromiseLike<unknown>> extends never ? false : true;

export type EnsureEffectInputValue<Out, A> =
  HasPromiseLike<Out> extends true ? never : EffectInputValue<Out> extends A ? Out : never;

export type EnsureEffectInput<Out> =
  HasPromiseLike<Out> extends true ? never : Out;

export function isEffectLike<A, E, R>(value: EffectInput<A, E, R>): value is Effect.Effect<A, E, R>;
export function isEffectLike(value: unknown): value is Effect.Effect<unknown, never, never>;
export function isEffectLike(value: unknown): value is Effect.Effect<unknown, never, never> {
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

/**
 * Typed failure raised when an EffectInput callback throws synchronously.
 *
 * The callback is invoked inside Effect so public Effect-returning APIs can
 * preserve the failure in the Effect error channel instead of surfacing it as a
 * construction-time throw or Effect defect.
 */
export class EffectInputCallbackError extends Data.TaggedError(
  "EffectInputCallbackError"
)<{
  readonly operation: string;
  readonly cause: unknown;
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
  value: EffectInput<A, E, R> & (A extends PromiseLike<unknown> ? never : unknown)
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

const normalizeEffectInput = <A, E, R>(
  value: EffectInput<A, E, R>
): Effect.Effect<A, E, R> =>
  toEffect(value as never) as Effect.Effect<A, E, R>;

/**
 * Invokes an EffectInput-returning callback inside Effect and normalizes the
 * returned value through `toEffect(...)`.
 */
export const invokeEffectInput = <
  Args extends ReadonlyArray<unknown>,
  A,
  E = never,
  R = never
>(
  operation: string,
  callback: (...args: Args) => EffectInput<A, E, R>,
  ...args: Args
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  Effect.flatMap(
    Effect.try({
      try: () => callback(...args),
      catch: (cause) =>
        new EffectInputCallbackError({
          operation,
          cause,
          guidance: "EffectInput callbacks must return values or Effects. Synchronous callback throws are reported in the Effect error channel."
        })
    }),
    normalizeEffectInput
  );
