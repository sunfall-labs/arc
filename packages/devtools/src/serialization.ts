import {
  isResourceRef,
  isResourceTag,
  type ResourceInvalidation,
  type ResourceInvalidationCause,
  type ResourceInvalidationPlan,
  type Route,
} from "@effect-ui/core";
import { Data } from "effect";
import type {
  DevtoolsCollectionStoreEvent,
  DevtoolsInvalidationCause,
  DevtoolsInvalidationPlan,
  DevtoolsInvalidationTarget,
  DevtoolsRequestTrace,
  DevtoolsRequestTraceCookie,
  DevtoolsRequestTraceCleanupFailure,
  DevtoolsRequestTraceHeader,
  DevtoolsRequestTraceRequest,
  DevtoolsRequestTraceResponse,
  DevtoolsRequestTraceTeardown,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSerializationPolicy,
  DevtoolsSerializableValue,
  DevtoolsSnapshot,
  DevtoolsStartAppGraphDiagnostics,
} from "./devtools-contract.js";
import { normalizeDevtoolsAppGraphDiagnostics } from "./app-graph-normalizer.js";

export type { DevtoolsSerializationPolicy } from "./devtools-contract.js";

/** Error raised when a live invalidation plan contains a non-serializable target shape. */
export class DevtoolsUnknownInvalidationTarget extends Data.TaggedError(
  "DevtoolsUnknownInvalidationTarget",
)<{
  readonly target: unknown;
  readonly guidance: string;
}> {}

const describeResourceRef = (ref: {
  readonly key: string;
  readonly family: { readonly options: { readonly name: string } };
  readonly input: unknown;
}) => ({
  key: ref.key,
  family: ref.family.options.name,
  input: copyDetachedValue(ref.input),
});

const describeTarget = (target: ResourceInvalidation): DevtoolsInvalidationTarget => {
  if (isResourceRef(target)) {
    return {
      _tag: "Ref",
      ...describeResourceRef(target),
    };
  }

  if (isResourceTag(target)) {
    return {
      _tag: "Tag",
      key: target.key,
      name: target.name,
    };
  }

  throw new DevtoolsUnknownInvalidationTarget({
    target,
    guidance: "Record invalidation targets as Resource refs or Resource tags.",
  });
};

const describeCause = (cause: ResourceInvalidationCause): DevtoolsInvalidationCause => {
  switch (cause._tag) {
    case "Ref":
      return {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name,
      };
    case "Tag":
      return {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name,
      };
  }
};

const objectTag = (
  tag: string,
  value?: string,
): { readonly [key: string]: DevtoolsSerializableValue } =>
  value === undefined
    ? { _tag: tag }
    : {
        _tag: tag,
        value,
      };

const defaultSerializationPolicy = {
  maxDepth: 8,
  maxEntries: 50,
  maxStringLength: 1_000,
  redactKeys: [],
} satisfies NormalizedDevtoolsSerializationPolicy;

interface NormalizedDevtoolsSerializationPolicy {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxStringLength: number;
  readonly redactKeys: ReadonlyArray<string | RegExp>;
}

const normalizePolicyBound = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) || value < 0
    ? fallback
    : Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);

const normalizeSerializationPolicy = (
  policy: DevtoolsSerializationPolicy | undefined,
): NormalizedDevtoolsSerializationPolicy => ({
  maxDepth: normalizePolicyBound(policy?.maxDepth, defaultSerializationPolicy.maxDepth),
  maxEntries: normalizePolicyBound(policy?.maxEntries, defaultSerializationPolicy.maxEntries),
  maxStringLength: normalizePolicyBound(
    policy?.maxStringLength,
    defaultSerializationPolicy.maxStringLength,
  ),
  redactKeys: policy?.redactKeys ?? defaultSerializationPolicy.redactKeys,
});

const truncatedMarker = (remaining: number): DevtoolsSerializableValue => ({
  _tag: "Truncated",
  remaining,
});

const redactedMarker = (): DevtoolsSerializableValue => ({
  _tag: "Redacted",
});

const redactedTraceText = "[redacted]";

const keySegments = (key: string): ReadonlyArray<string> =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const defaultRedactedKey = (key: string): boolean => {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const segments = keySegments(key);
  return (
    segments.some(
      (segment) =>
        segment === "password" ||
        segment === "passwd" ||
        segment === "pwd" ||
        segment === "secret" ||
        segment === "token" ||
        segment === "authorization" ||
        segment === "auth" ||
        segment === "cookie" ||
        segment === "credential" ||
        segment === "credentials",
    ) ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized === "api-key" ||
    normalized === "apikey" ||
    normalized.endsWith("-api-key") ||
    (segments.includes("api") && segments.includes("key"))
  );
};

const regexRedactsKey = (matcher: RegExp, key: string): boolean => {
  matcher.lastIndex = 0;
  return matcher.test(key);
};

const shouldRedactKey = (key: string, policy: NormalizedDevtoolsSerializationPolicy): boolean =>
  defaultRedactedKey(key) ||
  policy.redactKeys.some((matcher) =>
    typeof matcher === "string"
      ? key.toLowerCase() === matcher.toLowerCase()
      : regexRedactsKey(matcher, key),
  );

const isTruncatedMarker = (
  value: unknown,
): value is { readonly _tag: "Truncated"; readonly remaining: number } =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly _tag?: unknown })._tag === "Truncated" &&
  typeof (value as { readonly remaining?: unknown }).remaining === "number";

const truncatedString = (
  value: string,
  policy: NormalizedDevtoolsSerializationPolicy,
): string | DevtoolsSerializableValue =>
  value.length <= policy.maxStringLength
    ? value
    : {
        _tag: "TruncatedString",
        length: value.length,
        value: value.slice(0, policy.maxStringLength),
      };

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "Error");

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const safeInstanceOf = (value: unknown, constructor: Function): boolean => {
  try {
    return value instanceof constructor;
  } catch {
    return false;
  }
};

const uninspectableObject = (
  error: unknown,
  policy: NormalizedDevtoolsSerializationPolicy,
): DevtoolsSerializableValue => ({
  _tag: "UninspectableObject",
  name: errorName(error),
  message: truncatedString(errorMessage(error), policy),
});

const serializeEntries = <A>(
  values: Iterable<A>,
  policy: NormalizedDevtoolsSerializationPolicy,
  serialize: (value: A) => DevtoolsSerializableValue,
  knownSize?: number,
): ReadonlyArray<DevtoolsSerializableValue> => {
  const serialized: DevtoolsSerializableValue[] = [];
  if (policy.maxEntries === 0) {
    if (knownSize !== undefined && knownSize > 0) {
      serialized.push(truncatedMarker(knownSize));
    }
    return serialized;
  }

  let index = 0;
  for (const value of values) {
    if (index < policy.maxEntries) {
      serialized.push(serialize(value));
    } else {
      serialized.push(
        truncatedMarker(knownSize === undefined ? 1 : Math.max(0, knownSize - policy.maxEntries)),
      );
      return serialized;
    }
    index += 1;
    if (knownSize !== undefined && index >= policy.maxEntries && knownSize > policy.maxEntries) {
      serialized.push(truncatedMarker(knownSize - policy.maxEntries));
      return serialized;
    }
  }

  if (knownSize !== undefined && index < knownSize) {
    serialized.push(truncatedMarker(knownSize - index));
  }

  return serialized;
};

const detachedEntryMetadata = new WeakMap<object, { readonly originalSize: number }>();

const detachedOriginalSize = (value: object, fallback: number): number =>
  detachedEntryMetadata.get(value)?.originalSize ?? fallback;

const rememberDetachedOriginalSize = <A extends object>(
  value: A,
  copiedSize: number,
  originalSize: number,
): A => {
  if (originalSize > copiedSize) {
    detachedEntryMetadata.set(value, { originalSize });
  }
  return value;
};

const serializeBytes = (
  bytes: Uint8Array,
  policy: NormalizedDevtoolsSerializationPolicy,
  originalByteLength: number,
): ReadonlyArray<DevtoolsSerializableValue> =>
  serializeEntries(bytes, policy, (byte) => byte, originalByteLength);

const serializeArrayBufferMarker = (
  value: ArrayBuffer,
  policy: NormalizedDevtoolsSerializationPolicy,
): DevtoolsSerializableValue => {
  try {
    const bytes = new Uint8Array(value);
    const byteLength = detachedOriginalSize(value, value.byteLength);
    return {
      _tag: "ArrayBuffer",
      byteLength,
      bytes: serializeBytes(bytes, policy, byteLength),
    };
  } catch (error) {
    return uninspectableObject(error, policy);
  }
};

const serializeDataViewMarker = (
  value: DataView,
  policy: NormalizedDevtoolsSerializationPolicy,
): DevtoolsSerializableValue => {
  try {
    const byteLength = detachedOriginalSize(value, value.byteLength);
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return {
      _tag: "DataView",
      byteLength,
      byteOffset: value.byteOffset,
      bytes: serializeBytes(bytes, policy, byteLength),
    };
  } catch (error) {
    return uninspectableObject(error, policy);
  }
};

const serializeArrayBufferViewMarker = (
  value: ArrayBufferView,
  policy: NormalizedDevtoolsSerializationPolicy,
): DevtoolsSerializableValue => {
  try {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const byteLength = detachedOriginalSize(value as unknown as object, value.byteLength);
    return {
      _tag: "ArrayBufferView",
      constructorName: (value as object).constructor?.name ?? "ArrayBufferView",
      byteLength,
      byteOffset: value.byteOffset,
      bytes: serializeBytes(bytes, policy, byteLength),
    };
  } catch (error) {
    return uninspectableObject(error, policy);
  }
};

const serializeArray = (
  values: ReadonlyArray<unknown>,
  policy: NormalizedDevtoolsSerializationPolicy,
  seen: WeakSet<object>,
  depth: number,
): DevtoolsSerializableValue => {
  try {
    let entries = values;
    let knownSize = values.length;
    if (values.length > 0 && values.length <= policy.maxEntries + 1) {
      const last = values[values.length - 1];
      if (isTruncatedMarker(last)) {
        entries = values.slice(0, -1);
        knownSize = entries.length + last.remaining;
      }
    }
    return serializeEntries(
      entries,
      policy,
      (item) => serializeValue(item, policy, seen, depth + 1),
      knownSize,
    );
  } catch (error) {
    return uninspectableObject(error, policy);
  }
};

const serializeValue = (
  value: unknown,
  policy: NormalizedDevtoolsSerializationPolicy,
  seen: WeakSet<object>,
  depth: number,
): DevtoolsSerializableValue => {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncatedString(value, policy);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : objectTag("NonFiniteNumber", String(value));
  }

  if (typeof value === "bigint") {
    return objectTag("BigInt", value.toString());
  }

  if (typeof value === "undefined") {
    return objectTag("Undefined");
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return {
      _tag: "NonSerializable",
      kind: typeof value,
      value: String(value),
    };
  }

  if (safeInstanceOf(value, Date)) {
    try {
      const date = value as Date;
      return {
        _tag: "Date",
        value: Number.isNaN(date.getTime()) ? "Invalid Date" : date.toISOString(),
      };
    } catch (error) {
      return uninspectableObject(error, policy);
    }
  }

  if (safeInstanceOf(value, Error)) {
    try {
      const error = value as Error;
      return {
        _tag: "Error",
        name: error.name,
        message: truncatedString(error.message, policy),
        ...(error.stack === undefined ? {} : { stack: truncatedString(error.stack, policy) }),
      };
    } catch (error) {
      return uninspectableObject(error, policy);
    }
  }

  if (safeInstanceOf(value, DataView)) {
    return serializeDataViewMarker(value as DataView, policy);
  }

  try {
    if (ArrayBuffer.isView(value)) {
      return serializeArrayBufferViewMarker(value as ArrayBufferView, policy);
    }
  } catch (error) {
    return uninspectableObject(error, policy);
  }

  if (safeInstanceOf(value, ArrayBuffer)) {
    return serializeArrayBufferMarker(value as ArrayBuffer, policy);
  }

  if (depth >= policy.maxDepth) {
    return objectTag("MaxDepth");
  }

  if (seen.has(value)) {
    return objectTag("Circular");
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const serialized = serializeArray(value, policy, seen, depth);
    seen.delete(value);
    return serialized;
  }

  if (safeInstanceOf(value, Map)) {
    try {
      const map = value as Map<unknown, unknown>;
      const size = detachedOriginalSize(map, map.size);
      const entries = serializeEntries(
        map.entries(),
        policy,
        ([key, item]) => [
          serializeValue(key, policy, seen, depth + 1),
          serializeValue(item, policy, seen, depth + 1),
        ],
        size,
      );
      seen.delete(value);
      return {
        _tag: "Map",
        size,
        entries,
      };
    } catch (error) {
      seen.delete(value);
      return uninspectableObject(error, policy);
    }
  }

  if (safeInstanceOf(value, Set)) {
    try {
      const set = value as Set<unknown>;
      const size = detachedOriginalSize(set, set.size);
      const values = serializeEntries(
        set.values(),
        policy,
        (item) => serializeValue(item, policy, seen, depth + 1),
        size,
      );
      seen.delete(value);
      return {
        _tag: "Set",
        size,
        values,
      };
    } catch (error) {
      seen.delete(value);
      return uninspectableObject(error, policy);
    }
  }

  const record = value as Record<string, unknown>;
  let keys: string[];
  try {
    keys = Object.keys(record).sort();
  } catch (error) {
    seen.delete(value);
    return uninspectableObject(error, policy);
  }

  const serialized: Record<string, DevtoolsSerializableValue> = {};
  let truncated = 0;
  for (const key of keys) {
    if (Object.keys(serialized).length >= policy.maxEntries) {
      truncated += 1;
      continue;
    }

    if (shouldRedactKey(key, policy)) {
      serialized[key] = redactedMarker();
      continue;
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, key);
    } catch (error) {
      serialized[key] = {
        _tag: "UninspectableProperty",
        name: errorName(error),
        message: truncatedString(errorMessage(error), policy),
      };
      continue;
    }

    if (descriptor === undefined || !("value" in descriptor)) {
      serialized[key] = objectTag("Accessor");
      continue;
    }

    serialized[key] = serializeValue(descriptor.value, policy, seen, depth + 1);
  }

  if (truncated > 0) {
    serialized.__devtoolsTruncated = truncatedMarker(truncated);
  }

  seen.delete(value);
  return serialized;
};

/** Converts arbitrary inspected values into JSON-safe tagged Devtools values. */
export const toDevtoolsSerializableValue = (
  value: unknown,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsSerializableValue =>
  serializeValue(value, normalizeSerializationPolicy(policy), new WeakSet(), 0);

const stableSerializableFingerprint = (value: DevtoolsSerializableValue): string => {
  if (typeof value === "number") {
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }

  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerializableFingerprint).join(",")}]`;
  }

  const record = value as { readonly [key: string]: DevtoolsSerializableValue };
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerializableFingerprint(record[key]!)}`)
    .join(",")}}`;
};

/** Converts arbitrary inspected values into a stable, policy-bounded Devtools fingerprint. */
export const toDevtoolsSerializableFingerprint = (
  value: unknown,
  policy?: DevtoolsSerializationPolicy,
): string => stableSerializableFingerprint(toDevtoolsSerializableValue(value, policy));

interface DetachedCopyState {
  readonly policy: NormalizedDevtoolsSerializationPolicy;
  readonly seen: WeakMap<object, unknown>;
  readonly depth: number;
}

const initialDetachedCopyState = (policy?: DevtoolsSerializationPolicy): DetachedCopyState => ({
  policy: normalizeSerializationPolicy(policy),
  seen: new WeakMap(),
  depth: 0,
});

const childDetachedCopyState = (state: DetachedCopyState): DetachedCopyState => ({
  ...state,
  depth: state.depth + 1,
});

const copyBoundedBytes = (
  buffer: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
  policy: NormalizedDevtoolsSerializationPolicy,
  byteAlignment = 1,
): Uint8Array => {
  const boundedLength = Math.min(byteLength, policy.maxEntries);
  const alignedLength =
    byteAlignment <= 1 ? boundedLength : Math.floor(boundedLength / byteAlignment) * byteAlignment;
  return new Uint8Array(new Uint8Array(buffer, byteOffset, alignedLength));
};

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const copyDetachedProperty = (
  record: Record<string, unknown>,
  key: string,
  state: DetachedCopyState,
): unknown => {
  if (shouldRedactKey(key, state.policy)) {
    return redactedMarker();
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch (error) {
    return {
      _tag: "UninspectableProperty",
      name: errorName(error),
      message: truncatedString(errorMessage(error), state.policy),
    };
  }

  return descriptor !== undefined && "value" in descriptor
    ? copyDetachedValue(descriptor.value, childDetachedCopyState(state))
    : objectTag("Accessor");
};

const copyDetachedRecordProperties = (
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  state: DetachedCopyState,
): void => {
  const copied = Math.min(keys.length, state.policy.maxEntries);
  for (let index = 0; index < copied; index++) {
    const key = keys[index]!;
    target[key] = copyDetachedProperty(source, key, state);
  }
  if (keys.length > copied) {
    target.__devtoolsTruncated = truncatedMarker(keys.length - copied);
  }
};

const copyDetachedArrayBuffer = <A>(value: A, state: DetachedCopyState): A => {
  try {
    const buffer = value as unknown as ArrayBuffer;
    const originalByteLength = detachedOriginalSize(buffer, buffer.byteLength);
    const bytes = copyBoundedBytes(buffer, 0, buffer.byteLength, state.policy);
    return rememberDetachedOriginalSize(
      bytesToArrayBuffer(bytes),
      bytes.byteLength,
      originalByteLength,
    ) as A;
  } catch (error) {
    return uninspectableObject(error, state.policy) as A;
  }
};

const copyDetachedDataView = <A>(value: A, state: DetachedCopyState): A => {
  try {
    const view = value as unknown as DataView;
    const originalByteLength = detachedOriginalSize(view, view.byteLength);
    const bytes = copyBoundedBytes(view.buffer, view.byteOffset, view.byteLength, state.policy);
    const copy = new DataView(bytesToArrayBuffer(bytes));
    return rememberDetachedOriginalSize(copy, bytes.byteLength, originalByteLength) as A;
  } catch (error) {
    return uninspectableObject(error, state.policy) as A;
  }
};

const copyDetachedArrayBufferView = <A>(value: A, state: DetachedCopyState): A => {
  try {
    const view = value as unknown as ArrayBufferView;
    const originalByteLength = detachedOriginalSize(value as unknown as object, view.byteLength);
    const bytesPerElement =
      typeof (value as { readonly BYTES_PER_ELEMENT?: unknown }).BYTES_PER_ELEMENT === "number"
        ? (value as { readonly BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT
        : 1;
    const copiedBytes = copyBoundedBytes(
      view.buffer,
      view.byteOffset,
      view.byteLength,
      state.policy,
      bytesPerElement,
    );
    const nodeBuffer = (
      globalThis as {
        readonly Buffer?: {
          isBuffer(value: unknown): boolean;
          from(value: Uint8Array): object;
        };
      }
    ).Buffer;
    if (nodeBuffer?.isBuffer(value)) {
      return rememberDetachedOriginalSize(
        nodeBuffer.from(copiedBytes),
        copiedBytes.byteLength,
        originalByteLength,
      ) as A;
    }

    const constructor = (value as object).constructor as {
      new (buffer: ArrayBuffer): object;
    };
    return rememberDetachedOriginalSize(
      new constructor(bytesToArrayBuffer(copiedBytes)),
      copiedBytes.byteLength,
      originalByteLength,
    ) as A;
  } catch (error) {
    return uninspectableObject(error, state.policy) as A;
  }
};

const copyDetachedMap = <A>(value: A, state: DetachedCopyState): A => {
  try {
    const map = value as unknown as Map<unknown, unknown>;
    const originalSize = detachedEntryMetadata.get(map)?.originalSize ?? map.size;
    const copy = new Map();
    state.seen.set(value as object, copy);
    const iterator = map.entries();
    const childState = childDetachedCopyState(state);
    const copied = Math.min(originalSize, state.policy.maxEntries);
    let index = 0;
    while (index < copied) {
      const next = iterator.next();
      if (next.done) {
        break;
      }
      const [key, item] = next.value;
      copy.set(copyDetachedValue(key, childState), copyDetachedValue(item, childState));
      index += 1;
    }
    return rememberDetachedOriginalSize(copy, index, originalSize) as A;
  } catch (error) {
    return uninspectableObject(error, state.policy) as A;
  }
};

const copyDetachedSet = <A>(value: A, state: DetachedCopyState): A => {
  try {
    const set = value as unknown as Set<unknown>;
    const originalSize = detachedEntryMetadata.get(set)?.originalSize ?? set.size;
    const copy = new Set();
    state.seen.set(value as object, copy);
    const iterator = set.values();
    const childState = childDetachedCopyState(state);
    const copied = Math.min(originalSize, state.policy.maxEntries);
    let index = 0;
    while (index < copied) {
      const next = iterator.next();
      if (next.done) {
        break;
      }
      copy.add(copyDetachedValue(next.value, childState));
      index += 1;
    }
    return rememberDetachedOriginalSize(copy, index, originalSize) as A;
  } catch (error) {
    return uninspectableObject(error, state.policy) as A;
  }
};

const copyDetachedValue = <A>(
  value: A,
  state: DetachedCopyState = initialDetachedCopyState(),
): A => {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncatedString(value, state.policy) as A;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : (objectTag("NonFiniteNumber", String(value)) as A);
  }

  if (typeof value === "bigint") {
    return objectTag("BigInt", value.toString()) as A;
  }

  if (typeof value === "undefined") {
    return objectTag("Undefined") as A;
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return {
      _tag: "NonSerializable",
      kind: typeof value,
      value: String(value),
    } as A;
  }

  if (safeInstanceOf(value, Date)) {
    try {
      return new Date((value as unknown as Date).getTime()) as A;
    } catch (error) {
      return uninspectableObject(error, state.policy) as A;
    }
  }

  if (safeInstanceOf(value, Error)) {
    try {
      const error = value as unknown as Error & Record<string, unknown>;
      const copy: Record<string, unknown> = {
        name: copyDetachedValue(error.name, state),
        message: copyDetachedValue(error.message, state),
      };
      if (error.stack !== undefined) {
        copy.stack = copyDetachedValue(error.stack, state);
      }
      state.seen.set(value, copy);
      copyDetachedRecordProperties(error, copy, Object.keys(error).sort(), state);
      return copy as A;
    } catch (error) {
      return uninspectableObject(error, state.policy) as A;
    }
  }

  if (safeInstanceOf(value, DataView)) {
    return copyDetachedDataView(value, state);
  }

  try {
    if (ArrayBuffer.isView(value)) {
      return copyDetachedArrayBufferView(value, state);
    }
  } catch (error) {
    return uninspectableObject(error, state.policy) as A;
  }

  if (safeInstanceOf(value, ArrayBuffer)) {
    return copyDetachedArrayBuffer(value, state);
  }

  if (state.depth >= state.policy.maxDepth) {
    return objectTag("MaxDepth") as A;
  }

  if (state.seen.has(value)) {
    return state.seen.get(value) as A;
  }

  if (safeInstanceOf(value, Map)) {
    return copyDetachedMap(value, state);
  }

  if (safeInstanceOf(value, Set)) {
    return copyDetachedSet(value, state);
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    state.seen.set(value, copy);
    try {
      const length = value.length;
      let sourceLength = length;
      let originalLength = detachedEntryMetadata.get(value)?.originalSize ?? length;
      if (length > 0 && length <= state.policy.maxEntries + 1) {
        const last = value[length - 1];
        if (isTruncatedMarker(last)) {
          sourceLength = length - 1;
          originalLength = sourceLength + last.remaining;
        }
      }
      const copied = Math.min(sourceLength, state.policy.maxEntries);
      const childState = childDetachedCopyState(state);
      for (let index = 0; index < copied; index++) {
        copy.push(copyDetachedValue(value[index], childState));
      }
      if (originalLength > copied) {
        copy.push(truncatedMarker(originalLength - copied));
      }
    } catch (error) {
      return uninspectableObject(error, state.policy) as A;
    }
    return copy as A;
  }

  const record = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  state.seen.set(value, copy);
  let keys: string[];
  try {
    keys = Object.keys(record).sort();
  } catch (error) {
    return uninspectableObject(error, state.policy) as A;
  }
  copyDetachedRecordProperties(record, copy, keys, state);
  return copy as A;
};

/** Converts a live Core invalidation plan into a detached Devtools DTO. */
export const describeInvalidationPlan = (
  plan: ResourceInvalidationPlan<any>,
): DevtoolsInvalidationPlan => ({
  targets: plan.targets.map(describeTarget),
  entries: plan.entries.map((entry) => ({
    ref: {
      ...describeResourceRef(entry.ref),
    },
    causes: entry.causes.map(describeCause),
  })),
});

const copyInvalidationTarget = (
  target: DevtoolsInvalidationTarget,
  state: DetachedCopyState,
): DevtoolsInvalidationTarget =>
  target._tag === "Ref"
    ? {
        ...target,
        input: copyDetachedValue(target.input, state),
      }
    : { ...target };

const copyInvalidationCause = (cause: DevtoolsInvalidationCause): DevtoolsInvalidationCause => ({
  ...cause,
});

/** Deep-copies a Devtools invalidation plan so panel bridge payloads cannot mutate live state. */
export const copyInvalidationPlan = (
  plan: DevtoolsInvalidationPlan,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsInvalidationPlan => {
  const state = initialDetachedCopyState(policy);
  return {
    targets: plan.targets.map((target) => copyInvalidationTarget(target, state)),
    entries: plan.entries.map((entry) => ({
      ref: {
        ...entry.ref,
        input: copyDetachedValue(entry.ref.input, state),
      },
      causes: entry.causes.map(copyInvalidationCause),
    })),
  };
};

const copyTraceHeaders = (
  headers: ReadonlyArray<DevtoolsRequestTraceHeader> | undefined,
  policy: NormalizedDevtoolsSerializationPolicy,
): ReadonlyArray<DevtoolsRequestTraceHeader> | undefined =>
  headers === undefined
    ? undefined
    : headers
        .map((header) =>
          shouldRedactKey(header.name, policy)
            ? {
                name: redactedTraceText,
                value: redactedTraceText,
              }
            : { ...header },
        )
        .sort((left, right) => left.name.localeCompare(right.name));

const defaultRedactedCookieName = (name: string): boolean => {
  const segments = keySegments(name);
  return (
    defaultRedactedKey(name) ||
    segments.some(
      (segment) =>
        segment === "session" ||
        segment === "sid" ||
        segment === "csrf" ||
        segment === "xsrf" ||
        segment === "jwt",
    )
  );
};

const shouldRedactCookieName = (
  name: string,
  policy: NormalizedDevtoolsSerializationPolicy,
): boolean =>
  defaultRedactedCookieName(name) ||
  policy.redactKeys.some((matcher) =>
    typeof matcher === "string"
      ? name.toLowerCase() === matcher.toLowerCase()
      : regexRedactsKey(matcher, name),
  );

const copyTraceCookies = (
  cookies: ReadonlyArray<DevtoolsRequestTraceCookie> | undefined,
  policy: NormalizedDevtoolsSerializationPolicy,
): ReadonlyArray<DevtoolsRequestTraceCookie> | undefined =>
  cookies === undefined
    ? undefined
    : cookies
        .map((cookie) => ({
          name: shouldRedactCookieName(cookie.name, policy) ? redactedTraceText : cookie.name,
          value: redactedTraceText,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

const decodeSearchParamName = (name: string): string => {
  try {
    return decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    return name;
  }
};

const redactTraceSearchParams = (
  search: string,
  policy: NormalizedDevtoolsSerializationPolicy,
): string =>
  search
    .split("&")
    .map((part) => {
      if (part === "") {
        return part;
      }

      const equalsIndex = part.indexOf("=");
      const name = equalsIndex === -1 ? part : part.slice(0, equalsIndex);
      return shouldRedactKey(decodeSearchParamName(name), policy)
        ? equalsIndex === -1
          ? redactedTraceText
          : `${redactedTraceText}=${redactedTraceText}`
        : part;
    })
    .join("&");

const redactTraceUrlQuery = (
  value: string,
  policy: NormalizedDevtoolsSerializationPolicy,
): string => {
  const queryIndex = value.indexOf("?");
  if (queryIndex === -1) {
    return value;
  }

  const fragmentIndex = value.indexOf("#", queryIndex + 1);
  const searchEnd = fragmentIndex === -1 ? value.length : fragmentIndex;
  const search = value.slice(queryIndex + 1, searchEnd);
  const redactedSearch = redactTraceSearchParams(search, policy);
  if (redactedSearch === search) {
    return value;
  }

  return `${value.slice(0, queryIndex + 1)}${redactedSearch}${value.slice(searchEnd)}`;
};

const copyRequestTraceCleanupFailure = (
  cleanupFailure: DevtoolsRequestTraceCleanupFailure,
  policy: DevtoolsSerializationPolicy | undefined,
): DevtoolsRequestTraceCleanupFailure => {
  const normalizedPolicy = normalizeSerializationPolicy(policy);
  return {
    _tag: cleanupFailure._tag,
    message:
      cleanupFailure.message.length <= normalizedPolicy.maxStringLength
        ? cleanupFailure.message
        : cleanupFailure.message.slice(0, normalizedPolicy.maxStringLength),
  };
};

/** Deep-copies a Devtools route plan, including params/search/resource inputs. */
export const copyDevtoolsRoutePlan = (
  plan: DevtoolsRoutePlan,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsRoutePlan => {
  const state = initialDetachedCopyState(policy);
  return {
    _tag: plan._tag,
    href: redactTraceUrlQuery(plan.href, state.policy),
    match:
      plan.match === undefined
        ? undefined
        : {
            path: plan.match.path,
            href: redactTraceUrlQuery(plan.match.href, state.policy),
            params: copyDetachedValue(plan.match.params, state),
            search: copyDetachedValue(plan.match.search, state),
          },
    resources: plan.resources.map((resource) => ({
      ...resource,
      input: copyDetachedValue(resource.input, state),
    })),
    hydration: {
      resourceCount: plan.hydration.resourceCount,
      ...(plan.hydration.resourceKeys === undefined
        ? {}
        : { resourceKeys: [...plan.hydration.resourceKeys] }),
    },
  };
};

const copyRequestTraceTeardown = (
  teardown: DevtoolsRequestTraceTeardown,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsRequestTraceTeardown => ({
  runtimeDisposed: teardown.runtimeDisposed,
  ...(teardown.reason === undefined ? {} : { reason: teardown.reason }),
  ...(teardown.at === undefined ? {} : { at: teardown.at }),
  ...(teardown.startedAt === undefined ? {} : { startedAt: teardown.startedAt }),
  ...(teardown.completedAt === undefined ? {} : { completedAt: teardown.completedAt }),
  ...(teardown.durationMillis === undefined ? {} : { durationMillis: teardown.durationMillis }),
  ...(teardown.beforeDispose === undefined ? {} : { beforeDispose: { ...teardown.beforeDispose } }),
  ...(teardown.afterDispose === undefined ? {} : { afterDispose: { ...teardown.afterDispose } }),
  ...(teardown.cleanupFailure === undefined
    ? {}
    : { cleanupFailure: copyRequestTraceCleanupFailure(teardown.cleanupFailure, policy) }),
});

/** Deep-copies a request trace and sorts copied header/cookie collections for stable panels. */
export const copyRequestTrace = (
  trace: DevtoolsRequestTrace,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsRequestTrace => {
  const state = initialDetachedCopyState(policy);
  const request: DevtoolsRequestTraceRequest = {
    method: trace.request.method,
    url: redactTraceUrlQuery(trace.request.url, state.policy),
    path: redactTraceUrlQuery(trace.request.path, state.policy),
    transport: trace.request.transport,
    ...(trace.request.id === undefined ? {} : { id: trace.request.id }),
    ...(trace.request.traceparent === undefined ? {} : { traceparent: trace.request.traceparent }),
    ...(trace.request.headers === undefined
      ? {}
      : { headers: copyTraceHeaders(trace.request.headers, state.policy)! }),
    ...(trace.request.cookies === undefined
      ? {}
      : { cookies: copyTraceCookies(trace.request.cookies, state.policy)! }),
  };
  const response: DevtoolsRequestTraceResponse | undefined =
    trace.response === undefined
      ? undefined
      : {
          status: trace.response.status,
          ...(trace.response.statusText === undefined
            ? {}
            : { statusText: trace.response.statusText }),
          ...(trace.response.headers === undefined
            ? {}
            : { headers: copyTraceHeaders(trace.response.headers, state.policy)! }),
          ...(trace.response.setCookieCount === undefined
            ? {}
            : { setCookieCount: trace.response.setCookieCount }),
        };

  return {
    request,
    ...(response === undefined ? {} : { response }),
    services: [...trace.services].sort(),
    ...(trace.routePlan === undefined
      ? {}
      : { routePlan: copyDevtoolsRoutePlan(trace.routePlan, policy) }),
    resources: trace.resources.map((resource) => ({
      ...resource,
      ...(resource.input === undefined ? {} : { input: copyDetachedValue(resource.input, state) }),
    })),
    collections: trace.collections.map((collection) => ({ ...collection })),
    serverFunctions: trace.serverFunctions.map((serverFunction) => ({ ...serverFunction })),
    actions: trace.actions.map((action) => ({
      ...action,
      ...(action.invalidationIndexes === undefined
        ? {}
        : { invalidationIndexes: [...action.invalidationIndexes] }),
    })),
    fibers: trace.fibers.map((fiber) => ({ ...fiber })),
    streams: trace.streams.map((stream) => ({ ...stream })),
    status: trace.status,
    ...(trace.failureKind === undefined ? {} : { failureKind: trace.failureKind }),
    ...(trace.teardown === undefined
      ? {}
      : { teardown: copyRequestTraceTeardown(trace.teardown, policy) }),
  };
};

const copyCollectionStoreEvent = (
  event: DevtoolsCollectionStoreEvent,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsCollectionStoreEvent => {
  switch (event._tag) {
    case "CollectionChangeFeedFailure":
    case "CollectionLoadFailure":
    case "CollectionMutateRolledBack":
      return {
        ...event,
        error: copyDetachedValue(event.error, initialDetachedCopyState(policy)),
      };
    default:
      return { ...event };
  }
};

/** Deep-copies one Devtools runtime event before storing or crossing a bridge. */
export const copyDevtoolsRuntimeEvent = (
  event: DevtoolsRuntimeEvent,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsRuntimeEvent => {
  const state = initialDetachedCopyState(policy);
  switch (event._tag) {
    case "ResourceStoreEvent":
      return {
        ...event,
        event: copyDetachedValue(event.event, state),
      };
    case "CollectionStoreEvent":
      return {
        ...event,
        event: copyCollectionStoreEvent(event.event, policy),
      };
    case "ProgramEvent":
      return {
        ...event,
        event: copyDetachedValue(event.event, state),
      };
    case "ActionState":
      return {
        ...event,
        ...(event.input === undefined ? {} : { input: copyDetachedValue(event.input, state) }),
        ...(event.invalidationIndexes === undefined
          ? {}
          : { invalidationIndexes: [...event.invalidationIndexes] }),
      };
    case "Invalidation":
      return {
        ...event,
        plan: copyInvalidationPlan(event.plan, policy),
      };
    case "RoutePlan":
      return {
        ...event,
        plan: copyDevtoolsRoutePlan(event.plan, policy),
      };
    case "RequestTrace":
      return {
        ...event,
        trace: copyRequestTrace(event.trace, policy),
      };
    case "Custom":
      return {
        ...event,
        ...(event.payload === undefined
          ? {}
          : { payload: copyDetachedValue(event.payload, state) }),
      };
  }
};

/** Deep-copies Start app graph diagnostics for panel-safe storage. */
export const copyAppGraphDiagnostics = (
  appGraph: DevtoolsStartAppGraphDiagnostics,
  options: { readonly preserveDerivedPreloadFacts?: boolean } = {},
): DevtoolsStartAppGraphDiagnostics => normalizeDevtoolsAppGraphDiagnostics(appGraph, options);

/** Deep-copies a complete Devtools snapshot for bridge or panel consumption. */
export const copyDevtoolsSnapshot = (
  snapshot: DevtoolsSnapshot,
  policy?: DevtoolsSerializationPolicy,
): DevtoolsSnapshot => ({
  ...(snapshot.appGraph === undefined
    ? {}
    : {
        appGraph: copyAppGraphDiagnostics(snapshot.appGraph, { preserveDerivedPreloadFacts: true }),
      }),
  resources: snapshot.resources.map((resource) => ({ ...resource })),
  actions: snapshot.actions.map((action) => ({
    ...action,
    ...(action.invalidationIndexes === undefined
      ? {}
      : { invalidationIndexes: [...action.invalidationIndexes] }),
  })),
  invalidations: snapshot.invalidations.map((plan) => copyInvalidationPlan(plan, policy)),
  routePlans: snapshot.routePlans.map((plan) => copyDevtoolsRoutePlan(plan, policy)),
  ...(snapshot.requestTraces === undefined
    ? {}
    : { requestTraces: snapshot.requestTraces.map((trace) => copyRequestTrace(trace, policy)) }),
  ...(snapshot.events === undefined
    ? {}
    : { events: snapshot.events.map((event) => copyDevtoolsRuntimeEvent(event, policy)) }),
});

/** Converts a live Core route navigation plan into the Devtools route-plan DTO. */
export const describeRoutePlan = (plan: Route.NavigationPlan): DevtoolsRoutePlan => ({
  _tag: plan._tag,
  href: plan.href,
  match: plan.match
    ? {
        path: plan.match.route.path,
        href: plan.match.href,
        params: copyDetachedValue(plan.match.params),
        search: copyDetachedValue(plan.match.search),
      }
    : undefined,
  resources: plan.refs.map(describeResourceRef),
  hydration: {
    resourceCount: plan.resources.resources.length,
    resourceKeys: plan.resources.resources.map((resource) => resource.key),
  },
});
