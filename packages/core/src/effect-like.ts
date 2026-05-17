import { Data, Effect } from "effect";

type CallableThenableMember<Out> = Out extends { readonly then?: infer Then }
  ? Extract<Then, (...args: any) => unknown> extends never
    ? never
    : Out
  : never;
type PromiseShapedMember<Out> = Out extends unknown
  ? Out extends PromiseLike<unknown>
    ? Out
    : CallableThenableMember<Out>
  : never;
type EffectShapedMember<Out> = Out extends unknown
  ? Out extends Error
    ? never
    : Out extends Effect.Effect<unknown, unknown, unknown>
      ? Out
      : never
  : never;

type HasPromiseLike<Out> = [unknown] extends [Out]
  ? false
  : [PromiseShapedMember<Out>] extends [never]
    ? false
    : true;
type HasEffectLike<Out> = [unknown] extends [Out]
  ? false
  : [EffectShapedMember<Out>] extends [never]
    ? false
    : true;
type IsAny<T> = 0 extends 1 & T ? true : false;

type NonPromiseLikeUnknown =
  | null
  | undefined
  | string
  | number
  | boolean
  | bigint
  | symbol
  | (object & { readonly then?: never; readonly [Effect.TypeId]?: never });

export type RejectPromiseLikeValue<A> = [unknown] extends [A]
  ? NonPromiseLikeUnknown
  : HasPromiseLike<A> extends true
    ? never
    : unknown;

export type PromiseSafeValue<A> =
  IsAny<A> extends true
    ? NonPromiseLikeUnknown
    : [unknown] extends [A]
      ? NonPromiseLikeUnknown
      : HasPromiseLike<A> extends true
        ? never
        : A;

type DirectEffectInputValue<A> =
  IsAny<A> extends true
    ? NonPromiseLikeUnknown
    : [unknown] extends [A]
      ? NonPromiseLikeUnknown
      : HasPromiseLike<A> extends true
        ? never
        : HasEffectLike<A> extends true
          ? never
          : A;

/**
 * Plain data accepted by non-executable public seams.
 *
 * Promise-shaped values must be adapted through `Effect.tryPromise(...)`.
 * Direct Effect values are interpreted as executable work at EffectInput seams,
 * so a domain value that is itself an Effect must be wrapped in
 * `Effect.succeed(effectValue)` before it crosses as data.
 */
export type PlainValue<A> = DirectEffectInputValue<A>;

/**
 * Input accepted by convenience APIs that can run either a plain value or an Effect.
 *
 * Public core APIs prefer Effect-returning variants. EffectInput exists so definitions
 * can stay ergonomic while still being normalized before execution.
 * Promise-shaped values are rejected; adapt host Promise work explicitly with
 * `Effect.tryPromise(...)` before returning from an EffectInput boundary.
 * Direct Effect values are interpreted as work; if the domain value itself is
 * an Effect, wrap it with `Effect.succeed(effectValue)` so it crosses this
 * Interface as data.
 */
export type EffectInput<A, E = never, R = never> =
  | DirectEffectInputValue<A>
  | Effect.Effect<PromiseSafeValue<A>, E, R>;

export type EffectInputValue<Out> =
  Out extends Effect.Effect<infer A, infer _E, infer _R>
    ? PromiseSafeValue<A>
    : DirectEffectInputValue<Out>;

export type EffectInputError<Out> =
  Out extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;

export type EffectInputRequirements<Out> =
  Out extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;

export type EnsureEffectInputValue<Out, A> =
  EffectInputValue<Out> extends A ? EnsureEffectInput<Out> : never;

export type EnsureEffectInput<Out> =
  Out extends Effect.Effect<infer A, infer E, infer R>
    ? PromiseSafeValue<A> extends never
      ? never
      : Effect.Effect<PromiseSafeValue<A>, E, R>
    : DirectEffectInputValue<Out> extends never
      ? never
      : DirectEffectInputValue<Out>;

export function isEffectLike<A, E, R>(value: unknown): value is Effect.Effect<A, E, R>;
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
export class EffectInputPromiseRejected extends Data.TaggedError("EffectInputPromiseRejected")<{
  readonly guidance: string;
}> {}

/**
 * Typed failure raised when an EffectInput callback throws synchronously.
 *
 * The callback is invoked inside Effect so public Effect-returning APIs can
 * preserve the failure in the Effect error channel instead of surfacing it as a
 * construction-time throw or Effect defect.
 */
export class EffectInputCallbackError extends Data.TaggedError("EffectInputCallbackError")<{
  readonly operation: string;
  readonly cause: unknown;
  readonly guidance: string;
}> {}

/**
 * Runtime guard for Promise-shaped values crossing EffectInput and host seams.
 *
 * Some hostile thenables expose a throwing `then` getter. Those values are
 * still treated as Promise-shaped so callers can map them into their typed
 * boundary error instead of surfacing the getter throw as a defect.
 */
export const isPromiseLikeValue = (value: unknown): boolean => {
  if (value === null) {
    return false;
  }

  const valueType = typeof value;
  if (valueType !== "object" && valueType !== "function") {
    return false;
  }

  try {
    return typeof Reflect.get(value as object, "then") === "function";
  } catch {
    return true;
  }
};

const promiseRejectedDefect = (): EffectInputPromiseRejected =>
  new EffectInputPromiseRejected({
    guidance:
      "EffectInput does not accept Promise-shaped values. Wrap host Promise work in Effect.tryPromise(...) at the host adapter seam.",
  });

/**
 * Normalizes a value or Effect into an Effect.
 *
 * Use this at API boundaries that accept EffectInput, then keep the rest of the
 * implementation Effect-first.
 */
export const toEffect = <A, E = never, R = never>(
  value: EffectInput<A, E, R>,
): Effect.Effect<A, E, R> => {
  if (isEffectLike(value)) {
    return Effect.flatMap(value, (success) =>
      isPromiseLikeValue(success)
        ? Effect.die(promiseRejectedDefect())
        : Effect.succeed(success as A),
    ) as Effect.Effect<A, E, R>;
  }

  if (isPromiseLikeValue(value)) {
    return Effect.die(promiseRejectedDefect());
  }

  return Effect.succeed(value as A);
};

const promiseRejectedCallbackError = (
  operation: string,
  cause: EffectInputPromiseRejected,
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation,
    cause,
    guidance:
      "EffectInput callbacks must return values or Effects. Wrap host Promise work in Effect.tryPromise(...) at the host adapter seam.",
  });

/**
 * Converts the controlled Promise-shaped EffectInput defect into a typed
 * callback failure while preserving unrelated defects.
 *
 * Use this when a callback result needs extra Effect policy, such as retrying
 * only the returned domain Effect instead of retrying callback normalization.
 */
export const catchEffectInputPromiseDefect = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  Effect.catchDefect(effect, (defect) =>
    defect instanceof EffectInputPromiseRejected
      ? Effect.fail(promiseRejectedCallbackError(operation, defect))
      : Effect.die(defect),
  );

const normalizeEffectInput = <A, E, R>(
  operation: string,
  value: EffectInput<A, E, R>,
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  catchEffectInputPromiseDefect(operation, toEffect(value as never) as Effect.Effect<A, E, R>);

/**
 * Invokes an EffectInput-returning callback inside Effect and normalizes the
 * returned value through `toEffect(...)`.
 */
export const invokeEffectInput = <Args extends ReadonlyArray<unknown>, A, E = never, R = never>(
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
          guidance:
            "EffectInput callbacks must return values or Effects. Synchronous callback throws are reported in the Effect error channel.",
        }),
    }),
    (value) => normalizeEffectInput(operation, value),
  );
