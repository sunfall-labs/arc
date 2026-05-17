import { EffectInputCallbackError, EffectInputPromiseRejected } from "./effect-like.js";

export const isPromiseLikeValue = (value: unknown): boolean => {
  if (value === null) {
    return false;
  }

  const valueType = typeof value;
  if (valueType !== "object" && valueType !== "function") {
    return false;
  }

  return typeof Reflect.get(value as object, "then") === "function";
};

export const promiseLikeSyncCallbackError = (
  operation: string,
  guidance: string
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation,
    cause: new EffectInputPromiseRejected({
      guidance: "Sync metadata callbacks must not return Promise-shaped values. Move host Promise work into an Effect.tryPromise(...) Adapter seam before returning metadata."
    }),
    guidance
  });

export const rejectPromiseLikeSyncCallbackValue = <A>(
  operation: string,
  value: A,
  guidance: string
): A => {
  if (isPromiseLikeValue(value)) {
    throw promiseLikeSyncCallbackError(operation, guidance);
  }

  return value;
};
