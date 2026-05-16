import { Data } from "effect";
import type { ResourceRef } from "./resource.js";

/**
 * Error thrown by synchronous Resource reads when the latest load failed.
 *
 * `previous` is the stale value, when one exists, so UI adapters can decide
 * whether to render stale content or surface the failure. Use `hasPrevious`
 * rather than `previous !== undefined` because `undefined` is a valid Resource
 * value.
 */
export class ResourceFailure<
  I = unknown,
  A = unknown,
  E = never,
  R = unknown,
  RefError = E
> extends Data.TaggedError("ResourceFailure")<{
  /** Resource ref that was read synchronously. */
  readonly ref: ResourceRef<I, A, RefError, R>;
  /** Typed load failure from the Resource's Effect error channel. */
  readonly error: E;
  /** Last successful value, when stale data exists. */
  readonly previous: A | undefined;
  /** Whether `previous` is present, even when the value itself is `undefined`. */
  readonly hasPrevious: boolean;
}> {}

/**
 * Error thrown by synchronous Resource reads when no fresh value is available.
 *
 * Core uses this typed value instead of throwing a Promise. UI adapters such as
 * Solid Suspense own the host Promise seam and can use `previous`, `state`, and
 * `guidance` to choose their display or repair behavior.
 */
export class ResourcePending<I = unknown, A = unknown, E = never, R = unknown> extends Data.TaggedError("ResourcePending")<{
  /** Resource ref that needs preloading before a synchronous read can succeed. */
  readonly ref: ResourceRef<I, A, E, R>;
  /** Cache state that made the read unavailable. */
  readonly state: "Initial" | "Pending" | "Collected";
  /** Last successful value, when stale data exists. */
  readonly previous: A | undefined;
  /** Whether `previous` is present, even when the value itself is `undefined`. */
  readonly hasPrevious: boolean;
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
  readonly reason: "CircularReference" | "UnsupportedObject" | "InvalidDate" | "EncodeFailure";
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
