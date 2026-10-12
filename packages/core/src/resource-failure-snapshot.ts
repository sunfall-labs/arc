import { Cause, Data, Exit, Option, Schema } from "effect";
import type { AnyResourceFamily } from "./resource.js";
import { ResourceFailureCodecError, ResourceUntypedFailure } from "./resource-errors.js";
import { defaultResourceDefinitionRegistry } from "./resource-registry.js";

/**
 * Wire form of a Resource load failure that a server render shows.
 *
 * - `Encoded`: the family declares an `error` schema; `value` is the typed
 *   failure encoded as JSON by that schema, decoded back into the same value.
 * - `Untyped`: the family has no `error` schema; only the failure `_tag`
 *   crosses and it is rebuilt as `ResourceUntypedFailure`.
 * - `Unencodable`: the failure did not encode with the family's schema; it is
 *   rebuilt as a `ResourceFailureCodecError` defect.
 * - `Defect`: the load died or was interrupted; nothing about it crosses.
 */
export type ResourceFailureEncoding =
  | { readonly _tag: "Encoded"; readonly value: Schema.Json }
  | { readonly _tag: "Untyped"; readonly tag?: string }
  | { readonly _tag: "Unencodable" }
  | { readonly _tag: "Defect" };

/**
 * Serializable record of a Resource load failure that a server render shows,
 * so the hydrating client renders the same typed failure. Failure data crosses
 * only as the family's `error` schema encodes it.
 */
export interface ResourceFailureSnapshot {
  /** Name of the Resource family whose load failed. */
  readonly resource: string;
  readonly failure: ResourceFailureEncoding;
}

const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined;

const untyped = (resource: string, error: unknown): ResourceUntypedFailure => {
  const tag = tagOf(error);
  return new ResourceUntypedFailure(tag === undefined ? { resource } : { resource, tag });
};

/**
 * The typed failure a render reports for a settled load failure of `family`:
 * the load error itself when the family declares an `error` schema,
 * `ResourceUntypedFailure` (its `_tag` only) without one. Defects and
 * interruptions report none.
 */
export const resourceRenderError = (
  family: AnyResourceFamily,
  cause: Cause.Cause<unknown>,
): Option.Option<unknown> =>
  Option.map(Cause.findErrorOption(cause), (error) =>
    family.options.error === undefined ? untyped(family.options.name, error) : error,
  );

/** `cause` with each typed failure replaced by the failure a render reports (see `resourceRenderError`). */
export const resourceRenderCause = (
  family: AnyResourceFamily,
  cause: Cause.Cause<unknown>,
): Cause.Cause<unknown> =>
  family.options.error === undefined
    ? Cause.map(cause, (error) => untyped(family.options.name, error))
    : cause;

/**
 * Captures the wire snapshot of a load failure of `family`, synchronously.
 *
 * With an `error` schema the failure is encoded as JSON by that schema (a
 * failure that does not encode is sent as `Unencodable`, without its data);
 * without one only the failure `_tag` is sent. Defects send nothing.
 */
export const resourceFailureSnapshot = (
  family: AnyResourceFamily,
  cause: Cause.Cause<unknown>,
): ResourceFailureSnapshot => {
  const resource = family.options.name;
  const snapshot = (failure: ResourceFailureEncoding): ResourceFailureSnapshot => ({
    resource,
    failure,
  });
  const error = Cause.findErrorOption(cause);
  if (Option.isNone(error)) {
    return snapshot({ _tag: "Defect" });
  }
  const schema = family.options.error;
  if (schema === undefined) {
    const tag = tagOf(error.value);
    return snapshot({ _tag: "Untyped", ...(tag === undefined ? {} : { tag }) });
  }
  const encoded = Schema.encodeUnknownExit(Schema.toCodecJson(schema))(error.value);
  return snapshot(
    Exit.isSuccess(encoded)
      ? { _tag: "Encoded", value: encoded.value as Schema.Json }
      : { _tag: "Unencodable" },
  );
};

/** Defect rebuilt from a `Defect` snapshot: the load died on the server; nothing else crossed. */
export class ResourceLoadDefect extends Data.TaggedError("ResourceLoadDefect")<{
  readonly resource: string;
}> {
  override get message(): string {
    return `Resource "${this.resource}" failed to load with a defect`;
  }
}

/**
 * Rebuilds the render failure a snapshot describes, synchronously.
 *
 * An `Encoded` failure decodes with the family's `error` schema into the typed
 * failure; an `Untyped` one becomes `ResourceUntypedFailure` with the same
 * `tag`. A failure that cannot cross with the family's schema (unknown family,
 * unencodable, undecodable, or a schema mismatch) is a
 * `ResourceFailureCodecError` defect; a `Defect` snapshot is a
 * `ResourceLoadDefect` defect.
 */
export const resourceRenderCauseFromSnapshot = (
  snapshot: ResourceFailureSnapshot,
): Cause.Cause<unknown> => {
  const resource = snapshot.resource;
  const codecDefect = (operation: "encode" | "decode") =>
    Cause.die(new ResourceFailureCodecError({ resource, operation }));
  const family = defaultResourceDefinitionRegistry.definitions().families.get(resource);
  const failure = snapshot.failure;
  if (failure._tag === "Defect") {
    return Cause.die(new ResourceLoadDefect({ resource }));
  }
  if (family === undefined) {
    return codecDefect("decode");
  }
  const schema = family.options.error;
  switch (failure._tag) {
    case "Unencodable":
      return codecDefect("encode");
    case "Untyped":
      return schema === undefined
        ? Cause.fail(
            new ResourceUntypedFailure(
              failure.tag === undefined ? { resource } : { resource, tag: failure.tag },
            ),
          )
        : codecDefect("decode");
    case "Encoded": {
      if (schema === undefined) {
        return codecDefect("decode");
      }
      const decoded = Schema.decodeUnknownExit(Schema.toCodecJson(schema))(failure.value);
      return Exit.isSuccess(decoded) ? Cause.fail(decoded.value) : codecDefect("decode");
    }
  }
};
