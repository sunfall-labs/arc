import { Data } from "effect";
import type { AsyncResult } from "effect/reactivity";
import type { ResourceRef } from "./resource.js";

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
  readonly result: AsyncResult.AsyncResult<A, E>;
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

/**
 * Typed render failure of a Resource family that declares no `error` schema.
 *
 * Without a schema only the failure's `_tag` can cross a server render, so a
 * Component reader reports every schema-less load failure as this value, on
 * the server, on the client, and after hydration alike. Declare an `error`
 * schema on the family to render the failure with its data.
 */
export class ResourceUntypedFailure extends Data.TaggedError("ResourceUntypedFailure")<{
  /** Name of the Resource family whose load failed. */
  readonly resource: string;
  /** `_tag` of the original failure, when it had one. */
  readonly tag?: string;
}> {
  override get message(): string {
    return this.tag === undefined
      ? `Resource "${this.resource}" failed to load (declare an \`error\` schema to keep the failure)`
      : `Resource "${this.resource}" failed to load with "${this.tag}" (declare an \`error\` schema to keep its data)`;
  }
}

/**
 * Defect for a Resource load failure that could not cross a server render
 * with the family's `error` schema: encoding failed on the server, or decoding
 * failed on the client. It carries no failure data.
 */
export class ResourceFailureCodecError extends Data.TaggedError("ResourceFailureCodecError")<{
  readonly resource: string;
  readonly operation: "encode" | "decode";
}> {
  override get message(): string {
    return `Resource "${this.resource}" load failure could not ${this.operation} with the family's error schema`;
  }
}
