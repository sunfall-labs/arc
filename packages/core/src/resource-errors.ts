import { Data } from "effect";
import type { AsyncResult } from "effect/reactivity";
import type { ResourceLoadError, ResourceRef } from "./resource.js";

/**
 * Error thrown by synchronous Resource reads when the latest load failed.
 *
 * `result` is the ref's settled `AsyncResult.Failure`: its `cause` holds the
 * typed error (`AsyncResult.error(failure.result)`), defect, or interruption,
 * and `previousSuccess` keeps stale data so UI adapters can decide whether to
 * render it or surface the failure.
 */
export class ResourceFailure<
  I = unknown,
  A = unknown,
  E = never,
  R = unknown,
  RefError = E,
> extends Data.TaggedError("ResourceFailure")<{
  /** Resource ref that was read synchronously. */
  readonly ref: ResourceRef<I, A, RefError, R>;
  /** Settled failure result: full `Cause` plus the latest success, when one exists. */
  readonly result: AsyncResult.Failure<A, E>;
}> {}

/**
 * Error thrown by synchronous Resource reads when no fresh value is available.
 *
 * Core uses this typed value instead of throwing a Promise. UI adapters such as
 * Solid Suspense own the host Promise seam and can use `reason`, `result`, and
 * `guidance` to choose their display or repair behavior.
 */
export class ResourcePending<
  I = unknown,
  A = unknown,
  E = never,
  R = unknown,
> extends Data.TaggedError("ResourcePending")<{
  /** Resource ref that needs preloading before a synchronous read can succeed. */
  readonly ref: ResourceRef<I, A, E, R>;
  /**
   * Why the read is unavailable: never loaded (`Initial`), first load in
   * flight (`Pending`), or the cached success outlived `gcFor` (`Collected`).
   */
  readonly reason: "Initial" | "Pending" | "Collected";
  /** The ref's `AsyncResult` when the read was attempted (stale data via `AsyncResult.value`). */
  readonly result: AsyncResult.AsyncResult<A, ResourceLoadError<E>>;
  /** Human-readable repair hint suitable for diagnostics and tests. */
  readonly guidance: string;
}> {}

/** Error raised when the default Resource key codec cannot encode an input. */
export class ResourceKeyError extends Data.TaggedError("ResourceKeyError")<{
  /** Resource or tag operation that tried to build the key. */
  readonly operation: string;
  /** Resource family or tag name whose default key failed. */
  readonly name: string;
  /** Input path that failed to encode. */
  readonly path: string;
  /** Machine-readable failure reason. */
  readonly reason:
    | "CircularReference"
    | "UnsupportedObject"
    | "InvalidDate"
    | "EncodeFailure"
    | "PromiseLikeKey"
    | "EffectLikeKey"
    | "NonStringKey";
  /** Path of the original value for circular references. */
  readonly referencePath?: string;
  /** Original thrown value, when available. */
  readonly cause?: unknown;
  /** Human-readable repair hint suitable for diagnostics and tests. */
  readonly guidance: string;
}> {}

/** Error raised when a keyed Resource ref is constructed without required input. */
export class MissingResourceInput extends Data.TaggedError("MissingResourceInput")<{
  /** Stable Resource key that could not be resolved from input. */
  readonly key: string;
}> {}
