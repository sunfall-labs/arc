import { Data } from "effect";

export class StableStringifyCircularData extends Data.TaggedError("StableStringifyCircularData")<{
  readonly path: string;
  readonly referencePath: string;
  readonly guidance: string;
}> {}

export class StableStringifyUnsupportedValue extends Data.TaggedError("StableStringifyUnsupportedValue")<{
  readonly path: string;
  readonly valueType: string;
  readonly guidance: string;
}> {}

export class StableStringifyInvalidDate extends Data.TaggedError("StableStringifyInvalidDate")<{
  readonly path: string;
  readonly guidance: string;
}> {}

export class StableStringifyEncodeFailure extends Data.TaggedError("StableStringifyEncodeFailure")<{
  readonly path: string;
  readonly cause: unknown;
  readonly guidance: string;
}> {}

const circularDataGuidance =
  "Break cycles before using values as stable keys, or provide an explicit key function.";
const unsupportedValueGuidance =
  "Use JSON-compatible data plus Date, URL, Map, Set, ArrayBuffer, typed arrays, bigint, undefined, and finite or tagged non-finite numbers for stable keys.";
const stableMarker = "$effectUiStableStringify";

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
  fields: Record<string, unknown> = {}
): Record<string, unknown> => ({
  [stableMarker]: tag,
  ...fields
});

const pathSegment = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const viewBytes = (view: ArrayBufferView): string => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return bytesToHex(bytes);
};

const stableSortKey = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string") {
    throw new StableStringifyEncodeFailure({
      path: "$",
      cause: value,
      guidance: unsupportedValueGuidance
    });
  }
  return encoded;
};

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
        guidance: unsupportedValueGuidance
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
        guidance: circularDataGuidance
      });
    }

    active.set(input, path);

    try {
      if (input instanceof Date) {
        const millis = input.getTime();
        if (!Number.isFinite(millis)) {
          throw new StableStringifyInvalidDate({
            path,
            guidance: unsupportedValueGuidance
          });
        }
        return tagged("Date", { value: input.toISOString() });
      }

      if (input instanceof URL) {
        return tagged("URL", { value: input.href });
      }

      if (input instanceof ArrayBuffer) {
        return tagged("ArrayBuffer", {
          bytes: bytesToHex(new Uint8Array(input))
        });
      }

      if (input instanceof DataView) {
        return tagged("DataView", {
          bytes: viewBytes(input)
        });
      }

      if (ArrayBuffer.isView(input)) {
        return tagged("TypedArray", {
          type: input.constructor.name,
          bytes: viewBytes(input)
        });
      }

      if (input instanceof Map) {
        const entries = Array.from(input.entries()).map(([key, entryValue], index) => {
          const normalizedKey = normalize(key, `${path}.<key:${index}>`);
          const normalizedValue = normalize(entryValue, `${path}.<value:${index}>`);
          return [normalizedKey, normalizedValue] as const;
        });
        entries.sort((left, right) => {
          const leftKey = stableSortKey(left[0]);
          const rightKey = stableSortKey(right[0]);
          return leftKey === rightKey
            ? stableSortKey(left[1]).localeCompare(stableSortKey(right[1]))
            : leftKey.localeCompare(rightKey);
        });
        return tagged("Map", { entries });
      }

      if (input instanceof Set) {
        const values = Array.from(input.values()).map((entryValue, index) =>
          normalize(entryValue, `${path}.<value:${index}>`)
        );
        values.sort((left, right) => stableSortKey(left).localeCompare(stableSortKey(right)));
        return tagged("Set", { values });
      }

      if (Array.isArray(input)) {
        const out: Array<unknown> = [];
        for (let index = 0; index < input.length; index++) {
          out.push(
            Object.prototype.hasOwnProperty.call(input, index)
              ? normalize(input[index], `${path}[${index}]`)
              : tagged("SparseArrayHole")
          );
        }
        return out;
      }

      const object = input as Record<string, unknown>;
      const sortedKeys = Object.keys(object).sort();
      if (Object.prototype.hasOwnProperty.call(object, stableMarker)) {
        return tagged("Object", {
          entries: sortedKeys.map((key) => [
            key,
            normalize(object[key], `${path}${pathSegment(key)}`)
          ])
        });
      }

      const out: Record<string, unknown> = {};
      for (const key of sortedKeys) {
        out[key] = normalize(object[key], `${path}${pathSegment(key)}`);
      }
      return out;
    } finally {
      active.delete(input);
    }
  };

  const normalized = normalize(value, "$");
  const encoded = JSON.stringify(normalized);
  if (typeof encoded !== "string") {
    throw new StableStringifyEncodeFailure({
      path: "$",
      cause: normalized,
      guidance: unsupportedValueGuidance
    });
  }
  return encoded;
};
