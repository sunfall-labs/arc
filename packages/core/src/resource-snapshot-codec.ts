import { Data, Effect, Schema } from "effect";
import type {
  AnyResourceFamily,
  ResourceHydrationInput,
  ResourceHydrationPayload,
  ResourceHydrationSnapshot,
  ResourceRef,
  ResourceState
} from "./resource.js";

export type ResourceSnapshotCodecOperation =
  | "decode"
  | "encode"
  | "hydrate"
  | "snapshot";

/**
 * Typed failure for invalid Resource hydration payloads.
 *
 * `operation` identifies the codec phase, `path` is a JSONPath-like location
 * in the payload, and `reason` describes the validation failure.
 */
export class ResourceSnapshotCodecError extends Data.TaggedError(
  "ResourceSnapshotCodecError"
)<{
  readonly operation: ResourceSnapshotCodecOperation;
  readonly path: string;
  readonly reason: string;
}> {}

export type ResourceHydrationApplyReason =
  | "MissingFamily"
  | "KeyMismatch";

/**
 * Typed failure for snapshots that are structurally valid but cannot be applied
 * to the active Resource definitions.
 */
export class ResourceHydrationApplyError extends Data.TaggedError(
  "ResourceHydrationApplyError"
)<{
  readonly reason: ResourceHydrationApplyReason;
  readonly path: string;
  readonly name: string;
  readonly key: string;
  readonly expectedKey?: string;
  readonly guidance: string;
}> {}

const failCodec = (
  operation: ResourceSnapshotCodecOperation,
  path: string,
  reason: string
): never => {
  throw new ResourceSnapshotCodecError({ operation, path, reason });
};

const assertCodec: (
  condition: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
  reason: string
) => asserts condition = (
  condition: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
  reason: string
) => {
  if (!condition) {
    failCodec(operation, path, reason);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const cloneResourceSnapshotValue = <A>(
  value: A,
  seen = new WeakMap<object, unknown>()
): A => {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as A;
  }

  const existing = seen.get(value);
  if (existing) {
    return existing as A;
  }

  if (Array.isArray(value)) {
    const output: Array<unknown> = [];
    seen.set(value, output);
    for (const entry of value) {
      output.push(cloneResourceSnapshotValue(entry, seen));
    }
    return output as A;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, entry] of Object.entries(value)) {
    output[key] = cloneResourceSnapshotValue(entry, seen);
  }
  return output as A;
};

const validateRecord = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
  label: string
): Record<string, unknown> => {
  assertCodec(isRecord(value), operation, path, `Expected ${label}.`);
  return value;
};

const validateArray = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
  label: string
): ReadonlyArray<unknown> => {
  assertCodec(Array.isArray(value), operation, path, `Expected ${label}.`);
  return value;
};

const validateString = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string
): string => {
  assertCodec(typeof value === "string", operation, path, "Expected a string.");
  return value;
};

const validateNumber = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string
): number => {
  assertCodec(
    typeof value === "number" && Number.isFinite(value),
    operation,
    path,
    "Expected a finite number."
  );
  return value;
};

export const validateResourceHydrationSnapshot = <I = unknown, A = unknown, E = never>(
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate",
  path = "$"
): ResourceHydrationSnapshot<I, A, E> => {
  const snapshot = validateRecord(value, operation, path, "a resource hydration snapshot");
  assertCodec(hasOwn(snapshot, "input"), operation, `${path}.input`, "Expected a resource input.");
  const state = validateRecord(snapshot.state, operation, `${path}.state`, "a resource success state");
  assertCodec(state._tag === "Success", operation, `${path}.state._tag`, "Expected resource state tag Success.");
  assertCodec(state.waiting === false, operation, `${path}.state.waiting`, "Expected success state waiting to be false.");
  assertCodec(hasOwn(state, "value"), operation, `${path}.state.value`, "Expected a resource success value.");

  return {
    name: validateString(snapshot.name, operation, `${path}.name`),
    key: validateString(snapshot.key, operation, `${path}.key`),
    input: cloneResourceSnapshotValue(snapshot.input) as I,
    state: {
      _tag: "Success",
      waiting: false,
      value: cloneResourceSnapshotValue(state.value) as A,
      updatedAt: validateNumber(state.updatedAt, operation, `${path}.state.updatedAt`)
    } satisfies Extract<ResourceState<A, E>, { readonly _tag: "Success" }>
  };
};

export const validateResourceHydrationSnapshots = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate",
  path = "$"
): ReadonlyArray<ResourceHydrationSnapshot> => {
  const snapshots = validateArray(value, operation, path, "a resource hydration snapshot array");
  return snapshots.map((snapshot, index) =>
    validateResourceHydrationSnapshot(snapshot, operation, `${path}[${index}]`)
  );
};

export const validateResourceHydrationPayload = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate"
): ResourceHydrationPayload => {
  const payload = validateRecord(value, operation, "$", "a resource hydration payload");
  return {
    resources: validateResourceHydrationSnapshots(payload.resources, operation, "$.resources")
  };
};

export const validateResourceHydrationInput = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate"
): ReadonlyArray<ResourceHydrationSnapshot> =>
  Array.isArray(value)
    ? validateResourceHydrationSnapshots(value, operation)
    : validateResourceHydrationPayload(value, operation).resources;

const catchSnapshotCodecError = (
  operation: ResourceSnapshotCodecOperation,
  path: string
) => (error: unknown): ResourceSnapshotCodecError => {
  if (error instanceof ResourceSnapshotCodecError) {
    return error;
  }

  return new ResourceSnapshotCodecError({
    operation,
    path,
    reason: error instanceof Error ? error.message : String(error)
  });
};

export const validateResourceHydrationInputEffect = (
  value: ResourceHydrationInput,
  operation: ResourceSnapshotCodecOperation = "hydrate"
): Effect.Effect<ReadonlyArray<ResourceHydrationSnapshot>, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => validateResourceHydrationInput(value, operation),
    catch: catchSnapshotCodecError(operation, "$")
  });

export const validateResourceHydrationPayloadEffect = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate"
): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => validateResourceHydrationPayload(value, operation),
    catch: catchSnapshotCodecError(operation, "$")
  });

export const resourceHydrationSnapshotFromRef = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>
): ResourceHydrationSnapshot<I, A, E> =>
  validateResourceHydrationSnapshot<I, A, E>(
    {
      name: ref.family.options.name,
      key: ref.key,
      input: ref.input,
      state
    },
    "snapshot"
  );

const decodeResourceHydrationValueEffect = <A>(
  schema: unknown,
  value: unknown
): Effect.Effect<A, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(value)
    : Effect.succeed(cloneResourceSnapshotValue(value) as A);

export const decodeResourceHydrationInputEffect = <I>(
  family: AnyResourceFamily,
  snapshot: ResourceHydrationSnapshot
): Effect.Effect<I, Schema.SchemaError> =>
  decodeResourceHydrationValueEffect<I>(family.options.input, snapshot.input);

export const decodeResourceHydrationStateEffect = <A, E>(
  family: AnyResourceFamily,
  snapshot: ResourceHydrationSnapshot
): Effect.Effect<Extract<ResourceState<A, E>, { readonly _tag: "Success" }>, Schema.SchemaError> =>
  Effect.map(
    decodeResourceHydrationValueEffect<A>(family.options.output, snapshot.state.value),
    (value) => ({
      _tag: "Success",
      waiting: false,
      value,
      updatedAt: snapshot.state.updatedAt
    })
  );

export const resourceHydrationPayloadFromSnapshots = (
  snapshots: Iterable<ResourceHydrationSnapshot>
): ResourceHydrationPayload =>
  validateResourceHydrationPayload({
    resources: Array.from(snapshots)
  }, "snapshot");

export const encodeResourceHydrationPayloadEffect = (
  value: ResourceHydrationPayload
): Effect.Effect<string, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => {
      const payload = validateResourceHydrationPayload(value, "encode");
      const encoded = JSON.stringify(payload);
      assertCodec(typeof encoded === "string", "encode", "$", "Expected JSON.stringify to return a string.");
      return encoded;
    },
    catch: catchSnapshotCodecError("encode", "$")
  });

export const decodeResourceHydrationPayloadEffect = (
  encoded: string
): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => validateResourceHydrationPayload(JSON.parse(encoded), "decode"),
    catch: catchSnapshotCodecError("decode", "$")
  });
