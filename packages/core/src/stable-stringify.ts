import { Data } from "effect";

/** Error raised when stable identity encoding finds cyclic data. */
export class StableStringifyCircularData extends Data.TaggedError("StableStringifyCircularData")<{
  readonly path: string;
  readonly referencePath: string;
  readonly guidance: string;
}> {}

/** Error raised when stable identity data contains unsupported executable values. */
export class StableStringifyUnsupportedValue extends Data.TaggedError(
  "StableStringifyUnsupportedValue",
)<{
  readonly path: string;
  readonly valueType: string;
  readonly guidance: string;
}> {}

/** Error raised when stable identity data contains an invalid Date. */
export class StableStringifyInvalidDate extends Data.TaggedError("StableStringifyInvalidDate")<{
  readonly path: string;
  readonly guidance: string;
}> {}

/** Error raised when reading host object data fails during stable identity encoding. */
export class StableStringifyEncodeFailure extends Data.TaggedError("StableStringifyEncodeFailure")<{
  readonly path: string;
  readonly cause: unknown;
  readonly guidance: string;
}> {}

const circularDataGuidance =
  "Break cycles before using values as stable keys, or provide an explicit key function.";
const unsupportedValueGuidance =
  "Use JSON-compatible data plus Date, URL, Map, Set, ArrayBuffer, typed arrays, bigint, undefined, and finite or tagged non-finite numbers for stable keys.";
const stableMarker = "$sunfallArcStableStringify";

type StableMarkerTag =
  | "ArrayBuffer"
  | "BigInt"
  | "DataView"
  | "Date"
  | "Map"
  | "NonFiniteNumber"
  | "Object"
  | "Set"
  | "SparseArrayHole"
  | "TypedArray"
  | "Undefined"
  | "URL";

const tagged = (
  tag: StableMarkerTag,
  fields: Record<string, unknown> = {},
): Record<string, unknown> => ({
  [stableMarker]: tag,
  ...fields,
});

const pathSegment = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;

const encodeFailure = (path: string, cause: unknown): StableStringifyEncodeFailure =>
  new StableStringifyEncodeFailure({
    path,
    cause,
    guidance: unsupportedValueGuidance,
  });

const isStableStringifyError = (error: unknown): boolean =>
  error instanceof StableStringifyCircularData ||
  error instanceof StableStringifyUnsupportedValue ||
  error instanceof StableStringifyInvalidDate ||
  error instanceof StableStringifyEncodeFailure;

const readHostValue = <A>(path: string, read: () => A): A => {
  try {
    return read();
  } catch (cause) {
    if (isStableStringifyError(cause)) {
      throw cause;
    }
    throw encodeFailure(path, cause);
  }
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const viewBytes = (view: ArrayBufferView): string => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return bytesToHex(bytes);
};

const stableSortKey = (value: unknown, path: string): string => {
  const encoded = readHostValue(path, () => JSON.stringify(value));
  if (typeof encoded !== "string") {
    throw encodeFailure(path, value);
  }
  return encoded;
};

/**
 * Encodes stable cache identity data with deterministic key ordering.
 *
 * Supports JSON-compatible data plus Date, URL, Map, Set, ArrayBuffer,
 * DataView, typed arrays, bigint, undefined, sparse array holes, and tagged
 * non-finite numbers. Cycles, invalid Dates, functions, symbols, and hostile
 * host object reads fail with typed stable-stringify errors.
 */
export const stableStringify = (value: unknown): string => {
  const active = new WeakMap<object, string>();

  const normalize = (input: unknown, path: string): unknown => {
    if (input === undefined) {
      return tagged("Undefined");
    }

    if (typeof input === "number" && !Number.isFinite(input)) {
      return tagged("NonFiniteNumber", { value: String(input) });
    }

    if (typeof input === "bigint") {
      return tagged("BigInt", { value: input.toString() });
    }

    if (typeof input === "symbol" || typeof input === "function") {
      throw new StableStringifyUnsupportedValue({
        path,
        valueType: typeof input,
        guidance: unsupportedValueGuidance,
      });
    }

    if (input === null || typeof input !== "object") {
      return input;
    }

    const referencePath = active.get(input);
    if (referencePath !== undefined) {
      throw new StableStringifyCircularData({
        path,
        referencePath,
        guidance: circularDataGuidance,
      });
    }

    active.set(input, path);

    try {
      if (input instanceof Date) {
        const millis = input.getTime();
        if (!Number.isFinite(millis)) {
          throw new StableStringifyInvalidDate({
            path,
            guidance: unsupportedValueGuidance,
          });
        }
        return tagged("Date", { value: input.toISOString() });
      }

      if (input instanceof URL) {
        return tagged("URL", { value: input.href });
      }

      if (input instanceof ArrayBuffer) {
        return tagged("ArrayBuffer", {
          bytes: bytesToHex(new Uint8Array(input)),
        });
      }

      if (input instanceof DataView) {
        return tagged("DataView", {
          bytes: viewBytes(input),
        });
      }

      if (ArrayBuffer.isView(input)) {
        return tagged("TypedArray", {
          type: input.constructor.name,
          bytes: viewBytes(input),
        });
      }

      if (input instanceof Map) {
        const entries = readHostValue(path, () => Array.from(input.entries())).map(
          ([key, entryValue], index) => {
            const keyPath = `${path}.<key:${index}>`;
            const valuePath = `${path}.<value:${index}>`;
            const normalizedKey = normalize(key, `${path}.<key:${index}>`);
            const normalizedValue = normalize(entryValue, `${path}.<value:${index}>`);
            return {
              key: normalizedKey,
              keySort: stableSortKey(normalizedKey, keyPath),
              value: normalizedValue,
              valueSort: stableSortKey(normalizedValue, valuePath),
            };
          },
        );
        entries.sort((left, right) => {
          return left.keySort === right.keySort
            ? left.valueSort.localeCompare(right.valueSort)
            : left.keySort.localeCompare(right.keySort);
        });
        return tagged("Map", {
          entries: entries.map((entry) => [entry.key, entry.value]),
        });
      }

      if (input instanceof Set) {
        const values = readHostValue(path, () => Array.from(input.values())).map(
          (entryValue, index) => {
            const valuePath = `${path}.<value:${index}>`;
            const normalizedValue = normalize(entryValue, valuePath);
            return {
              value: normalizedValue,
              sort: stableSortKey(normalizedValue, valuePath),
            };
          },
        );
        values.sort((left, right) => left.sort.localeCompare(right.sort));
        return tagged("Set", { values: values.map((entry) => entry.value) });
      }

      if (Array.isArray(input)) {
        const out: Array<unknown> = [];
        const length = readHostValue(path, () => input.length);
        for (let index = 0; index < length; index++) {
          const itemPath = `${path}[${index}]`;
          const hasIndex = readHostValue(itemPath, () =>
            Object.prototype.hasOwnProperty.call(input, index),
          );
          out.push(
            hasIndex
              ? normalize(
                  readHostValue(itemPath, () => input[index]),
                  itemPath,
                )
              : tagged("SparseArrayHole"),
          );
        }
        return out;
      }

      const object = input as Record<string, unknown>;
      const sortedKeys = readHostValue(path, () => Object.keys(object).sort());
      if (readHostValue(path, () => Object.prototype.hasOwnProperty.call(object, stableMarker))) {
        return tagged("Object", {
          entries: sortedKeys.map((key) => [
            key,
            normalize(
              readHostValue(`${path}${pathSegment(key)}`, () => object[key]),
              `${path}${pathSegment(key)}`,
            ),
          ]),
        });
      }

      const out: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        const propertyPath = `${path}${pathSegment(key)}`;
        out[key] = normalize(
          readHostValue(propertyPath, () => object[key]),
          propertyPath,
        );
      }
      return out;
    } catch (cause) {
      if (isStableStringifyError(cause)) {
        throw cause;
      }
      throw encodeFailure(path, cause);
    } finally {
      active.delete(input);
    }
  };

  const normalized = normalize(value, "$");
  const encoded = readHostValue("$", () => JSON.stringify(normalized));
  if (typeof encoded !== "string") {
    throw encodeFailure("$", normalized);
  }
  return encoded;
};
