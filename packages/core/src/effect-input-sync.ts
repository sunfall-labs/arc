import { Effect } from "effect";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  isPromiseLikeValue
} from "./effect-like.js";
export { isPromiseLikeValue } from "./effect-like.js";

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

export const isEffectLikeValue = (value: unknown): boolean =>
  !(value instanceof Error) && Effect.isEffect(value);

export const effectLikeSyncCallbackError = (
  operation: string,
  guidance: string
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation,
    cause: new TypeError("Plain data metadata must not be an Effect value."),
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

export const rejectEffectLikeSyncCallbackValue = <A>(
  operation: string,
  value: A,
  guidance: string
): A => {
  if (isEffectLikeValue(value)) {
    throw effectLikeSyncCallbackError(operation, guidance);
  }

  return value;
};

export const rejectPlainSyncCallbackValue = <A>(
  operation: string,
  value: A,
  guidance: string
): A =>
  rejectEffectLikeSyncCallbackValue(
    operation,
    rejectPromiseLikeSyncCallbackValue(operation, value, guidance),
    guidance
  );
