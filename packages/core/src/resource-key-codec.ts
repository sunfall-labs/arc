import { ResourceKeyError } from "./resource-errors.js";

export interface ResourceKeyEncodeOptions {
  readonly operation: string;
  readonly name: string;
}

const resourceKeyGuidance =
  "Default Resource keys support JSON-compatible values plus Date, URL, Map, and Set. Provide Resource.family({ key }) or Resource.tag(name, { key }) for unsupported key inputs.";

const pathSegment = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;

interface ResourceKeyErrorFields {
  readonly path: string;
  readonly reason: "CircularReference" | "UnsupportedObject" | "InvalidDate" | "EncodeFailure";
  readonly referencePath?: string;
  readonly cause?: unknown;
}

const keyError = (
  options: ResourceKeyEncodeOptions,
  fields: ResourceKeyErrorFields
): ResourceKeyError =>
  new ResourceKeyError({
    operation: options.operation,
    name: options.name,
    guidance: resourceKeyGuidance,
    ...fields
  });

const objectTag = (value: object): string =>
  Object.prototype.toString.call(value).slice("[object ".length, -1);

export const encodeResourceKey = (
  value: unknown,
  options: ResourceKeyEncodeOptions
): string => {
  const active = new WeakMap<object, string>();

  const normalize = (input: unknown, path: string): unknown => {
    if (input === undefined) {
      return { $effectUiResourceKey: "Undefined" };
    }

    if (typeof input === "number" && !Number.isFinite(input)) {
      return { $effectUiResourceKey: "Number", value: String(input) };
    }

    if (typeof input === "bigint") {
      return { $effectUiResourceKey: "BigInt", value: input.toString() };
    }

    if (typeof input === "symbol" || typeof input === "function") {
      throw keyError(options, {
        path,
        reason: "UnsupportedObject",
        cause: input
      });
    }

    if (input === null || typeof input !== "object") {
      return input;
    }

    const referencePath = active.get(input);
    if (referencePath !== undefined) {
      throw keyError(options, {
        path,
        reason: "CircularReference",
        referencePath
      });
    }

    active.set(input, path);

    try {
      if (input instanceof Date) {
        const millis = input.getTime();
        if (!Number.isFinite(millis)) {
          throw keyError(options, {
            path,
            reason: "InvalidDate",
            cause: input
          });
        }

        return {
          $effectUiResourceKey: "Date",
          value: input.toISOString()
        };
      }

      if (input instanceof URL) {
        return {
          $effectUiResourceKey: "URL",
          value: input.href
        };
      }

      if (input instanceof Map) {
        const entries = Array.from(input.entries()).map(([key, entryValue], index) => {
          const normalizedKey = normalize(key, `${path}.<key:${index}>`);
          const normalizedValue = normalize(entryValue, `${path}.<value:${index}>`);
          return [normalizedKey, normalizedValue] as const;
        });
        entries.sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))
        );
        return {
          $effectUiResourceKey: "Map",
          entries
        };
      }

      if (input instanceof Set) {
        const values = Array.from(input.values()).map((entryValue, index) =>
          normalize(entryValue, `${path}.<value:${index}>`)
        );
        values.sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))
        );
        return {
          $effectUiResourceKey: "Set",
          values
        };
      }

      if (Array.isArray(input)) {
        return input.map((item, index) => normalize(item, `${path}[${index}]`));
      }

      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw keyError(options, {
          path,
          reason: "UnsupportedObject",
          cause: objectTag(input)
        });
      }

      const object = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(object).sort()) {
        out[key] = normalize(object[key], `${path}${pathSegment(key)}`);
      }
      return out;
    } finally {
      active.delete(input);
    }
  };

  try {
    return JSON.stringify(normalize(value, "$"));
  } catch (cause) {
    if (cause instanceof ResourceKeyError) {
      throw cause;
    }

    throw keyError(options, {
      path: "$",
      reason: "EncodeFailure",
      cause
    });
  }
};
