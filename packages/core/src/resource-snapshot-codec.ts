import { Data, Effect, Schema } from "effect";
import type {
  AnyResourceFamily,
  ResourceHydrationPayload,
  ResourceHydrationSnapshot,
  ResourceRef,
  ResourceState,
} from "./resource.js";

/** Codec phase used in Resource hydration diagnostics. */
export type ResourceSnapshotCodecOperation = "decode" | "encode" | "hydrate" | "snapshot";

/**
 * Typed failure for invalid Resource hydration payloads.
 *
 * `operation` identifies the codec phase, `path` is a JSONPath-like location
 * in the payload, and `reason` describes the validation failure.
 */
export class ResourceSnapshotCodecError extends Data.TaggedError("ResourceSnapshotCodecError")<{
  readonly operation: ResourceSnapshotCodecOperation;
  readonly path: string;
  readonly reason: string;
}> {}

/** Reason a structurally valid Resource snapshot could not be applied. */
export type ResourceHydrationApplyReason = "MissingFamily" | "KeyMismatch";

/**
 * Typed failure for snapshots that are structurally valid but cannot be applied
 * to the active Resource definitions.
 */
export class ResourceHydrationApplyError extends Data.TaggedError("ResourceHydrationApplyError")<{
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
  reason: string,
): never => {
  throw new ResourceSnapshotCodecError({ operation, path, reason });
};

const assertCodec: (
  condition: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
  reason: string,
) => asserts condition = (
  condition: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
  reason: string,
) => {
  if (!condition) {
    failCodec(operation, path, reason);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Clone a value for Resource hydration snapshots.
 *
 * Plain objects, arrays, and `Date` values are copied. Non-plain objects keep
 * identity so adapters do not accidentally serialize custom instances.
 */
export const cloneResourceSnapshotValue = <A>(
  value: A,
  seen = new WeakMap<object, unknown>(),
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
  label: string,
): Record<string, unknown> => {
  assertCodec(isRecord(value), operation, path, `Expected ${label}.`);
  return value;
};

const validateArray = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
  label: string,
): ReadonlyArray<unknown> => {
  assertCodec(Array.isArray(value), operation, path, `Expected ${label}.`);
  return value;
};

const validateString = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
): string => {
  assertCodec(typeof value === "string", operation, path, "Expected a string.");
  return value;
};

const validateNumber = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
): number => {
  assertCodec(
    typeof value === "number" && Number.isFinite(value),
    operation,
    path,
    "Expected a finite number.",
  );
  return value;
};

/** Validates and clones one Resource success snapshot from unknown input. */
export const validateResourceHydrationSnapshot = <I = unknown, A = unknown, E = never>(
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate",
  path = "$",
): ResourceHydrationSnapshot<I, A, E> => {
  const snapshot = validateRecord(value, operation, path, "a resource hydration snapshot");
  assertCodec(hasOwn(snapshot, "input"), operation, `${path}.input`, "Expected a resource input.");
  const state = validateRecord(
    snapshot.state,
    operation,
    `${path}.state`,
    "a resource success state",
  );
  assertCodec(
    state._tag === "Success",
    operation,
    `${path}.state._tag`,
    "Expected resource state tag Success.",
  );
  assertCodec(
    state.waiting === false,
    operation,
    `${path}.state.waiting`,
    "Expected success state waiting to be false.",
  );
  assertCodec(
    hasOwn(state, "value"),
    operation,
    `${path}.state.value`,
    "Expected a resource success value.",
  );

  return {
    name: validateString(snapshot.name, operation, `${path}.name`),
    key: validateString(snapshot.key, operation, `${path}.key`),
    input: cloneResourceSnapshotValue(snapshot.input) as I,
    state: {
      _tag: "Success",
      waiting: false,
      value: cloneResourceSnapshotValue(state.value) as A,
      updatedAt: validateNumber(state.updatedAt, operation, `${path}.state.updatedAt`),
    } satisfies Extract<ResourceState<A, E>, { readonly _tag: "Success" }>,
  };
};

/** Validates an array of Resource success snapshots from unknown input. */
export const validateResourceHydrationSnapshots = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate",
  path = "$",
): ReadonlyArray<ResourceHydrationSnapshot> => {
  const snapshots = validateArray(value, operation, path, "a resource hydration snapshot array");
  const validated = snapshots.map((snapshot, index) =>
    validateResourceHydrationSnapshot(snapshot, operation, `${path}[${index}]`),
  );
  const seen = new Map<string, Map<string, number>>();

  validated.forEach((snapshot, index) => {
    let keys = seen.get(snapshot.name);
    if (!keys) {
      keys = new Map();
      seen.set(snapshot.name, keys);
    }

    const first = keys.get(snapshot.key);
    if (first !== undefined) {
      failCodec(
        operation,
        `${path}[${index}].key`,
        `Duplicate Resource hydration snapshot for ${snapshot.name}/${snapshot.key}; first occurrence was at ${path}[${first}].key.`,
      );
    }
    keys.set(snapshot.key, index);
  });

  return validated;
};

/** Validates a Resource hydration payload object from unknown input. */
export const validateResourceHydrationPayload = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate",
): ResourceHydrationPayload => {
  const payload = validateRecord(value, operation, "$", "a resource hydration payload");
  return {
    resources: validateResourceHydrationSnapshots(payload.resources, operation, "$.resources"),
  };
};

/** Validates a Resource hydration payload and returns normalized snapshots. */
export const validateResourceHydrationInput = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate",
): ReadonlyArray<ResourceHydrationSnapshot> =>
  validateResourceHydrationPayload(value, operation).resources;

const catchSnapshotCodecError =
  (operation: ResourceSnapshotCodecOperation, path: string) =>
  (error: unknown): ResourceSnapshotCodecError => {
    if (error instanceof ResourceSnapshotCodecError) {
      return error;
    }

    return new ResourceSnapshotCodecError({
      operation,
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
  };

const encodeResourceHydrationValueSync = (
  schema: unknown,
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
): unknown => {
  try {
    const encoded = Schema.isSchema(schema)
      ? Schema.encodeUnknownSync(schema as Schema.Encoder<unknown>)(value)
      : value;
    return cloneResourceSnapshotValue(encoded);
  } catch (error) {
    throw catchSnapshotCodecError(operation, path)(error);
  }
};

const encodeResourceHydrationValueEffect = (
  schema: unknown,
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
): Effect.Effect<unknown, ResourceSnapshotCodecError> => {
  const encoded = Schema.isSchema(schema)
    ? Schema.encodeUnknownEffect(schema as Schema.Encoder<unknown>)(value).pipe(
        Effect.mapError(catchSnapshotCodecError(operation, path)),
      )
    : Effect.succeed(value);

  return Effect.flatMap(encoded, (encodedValue) =>
    Effect.try({
      try: () => cloneResourceSnapshotValue(encodedValue),
      catch: catchSnapshotCodecError(operation, path),
    }),
  );
};

/** Effect wrapper for validating Resource hydration payload input. */
export const validateResourceHydrationInputEffect = (
  value: ResourceHydrationPayload,
  operation: ResourceSnapshotCodecOperation = "hydrate",
): Effect.Effect<ReadonlyArray<ResourceHydrationSnapshot>, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => validateResourceHydrationInput(value, operation),
    catch: catchSnapshotCodecError(operation, "$"),
  });

/** Effect wrapper for validating a Resource hydration payload object. */
export const validateResourceHydrationPayloadEffect = (
  value: unknown,
  operation: ResourceSnapshotCodecOperation = "hydrate",
): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => validateResourceHydrationPayload(value, operation),
    catch: catchSnapshotCodecError(operation, "$"),
  });

/** Creates and validates a hydration snapshot from a resource ref success state. */
export const resourceHydrationSnapshotFromRef = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>,
  path = "$",
): ResourceHydrationSnapshot => {
  try {
    const input = encodeResourceHydrationValueSync(
      ref.family.options.input,
      ref.input,
      "snapshot",
      `${path}.input`,
    );
    const value = encodeResourceHydrationValueSync(
      ref.family.options.output,
      state.value,
      "snapshot",
      `${path}.state.value`,
    );

    return validateResourceHydrationSnapshot(
      {
        name: ref.family.options.name,
        key: ref.key,
        input,
        state: {
          _tag: "Success",
          waiting: false,
          value,
          updatedAt: state.updatedAt,
        },
      },
      "snapshot",
      path,
    );
  } catch (error) {
    if (error instanceof ResourceSnapshotCodecError) {
      throw error;
    }
    throw catchSnapshotCodecError("snapshot", path)(error);
  }
};

/** Effect wrapper for creating a Resource hydration snapshot from a success state. */
export const resourceHydrationSnapshotFromRefEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>,
  path = "$",
): Effect.Effect<ResourceHydrationSnapshot, ResourceSnapshotCodecError> =>
  Effect.gen(function* () {
    const input = yield* encodeResourceHydrationValueEffect(
      ref.family.options.input,
      ref.input,
      "snapshot",
      `${path}.input`,
    );
    const value = yield* encodeResourceHydrationValueEffect(
      ref.family.options.output,
      state.value,
      "snapshot",
      `${path}.state.value`,
    );

    return yield* Effect.try({
      try: () =>
        validateResourceHydrationSnapshot(
          {
            name: ref.family.options.name,
            key: ref.key,
            input,
            state: {
              _tag: "Success",
              waiting: false,
              value,
              updatedAt: state.updatedAt,
            },
          },
          "snapshot",
          path,
        ),
      catch: catchSnapshotCodecError("snapshot", path),
    });
  });

const decodeResourceHydrationValueEffect = <A>(
  schema: unknown,
  value: unknown,
  operation: ResourceSnapshotCodecOperation,
  path: string,
): Effect.Effect<A, ResourceSnapshotCodecError> =>
  Schema.isSchema(schema)
    ? Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(value).pipe(
        Effect.mapError(catchSnapshotCodecError(operation, path)),
      )
    : Effect.succeed(cloneResourceSnapshotValue(value) as A);

/** Decodes a snapshot input through the resource family's input schema. */
export const decodeResourceHydrationInputEffect = <I>(
  family: AnyResourceFamily,
  snapshot: ResourceHydrationSnapshot,
  operation: ResourceSnapshotCodecOperation = "hydrate",
  path = "$.input",
): Effect.Effect<I, ResourceSnapshotCodecError> =>
  decodeResourceHydrationValueEffect<I>(family.options.input, snapshot.input, operation, path);

/** Decodes a snapshot success value through the resource family's output schema. */
export const decodeResourceHydrationStateEffect = <A, E>(
  family: AnyResourceFamily,
  snapshot: ResourceHydrationSnapshot,
  operation: ResourceSnapshotCodecOperation = "hydrate",
  path = "$.state.value",
): Effect.Effect<
  Extract<ResourceState<A, E>, { readonly _tag: "Success" }>,
  ResourceSnapshotCodecError
> =>
  Effect.map(
    decodeResourceHydrationValueEffect<A>(
      family.options.output,
      snapshot.state.value,
      operation,
      path,
    ),
    (value) => ({
      _tag: "Success",
      waiting: false,
      value,
      updatedAt: snapshot.state.updatedAt,
    }),
  );

/** Builds and validates a payload object from Resource hydration snapshots. */
export const resourceHydrationPayloadFromSnapshots = (
  snapshots: Iterable<ResourceHydrationSnapshot>,
): ResourceHydrationPayload =>
  validateResourceHydrationPayload(
    {
      resources: Array.from(snapshots),
    },
    "snapshot",
  );

/** Encodes a validated Resource hydration payload to JSON. */
export const encodeResourceHydrationPayloadEffect = (
  value: ResourceHydrationPayload,
): Effect.Effect<string, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => {
      const payload = validateResourceHydrationPayload(value, "encode");
      const encoded = JSON.stringify(payload);
      assertCodec(
        typeof encoded === "string",
        "encode",
        "$",
        "Expected JSON.stringify to return a string.",
      );
      return encoded;
    },
    catch: catchSnapshotCodecError("encode", "$"),
  });

/** Decodes a JSON Resource hydration payload and validates its shape. */
export const decodeResourceHydrationPayloadEffect = (
  encoded: string,
): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
  Effect.try({
    try: () => validateResourceHydrationPayload(JSON.parse(encoded), "decode"),
    catch: catchSnapshotCodecError("decode", "$"),
  });
