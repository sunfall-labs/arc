import { Data } from "effect";

export class StableStringifyCircularData extends Data.TaggedError("StableStringifyCircularData")<{
  readonly path: string;
  readonly referencePath: string;
  readonly guidance: string;
}> {}

const circularDataGuidance =
  "Break cycles before using values as stable keys, or provide an explicit key function.";

const pathSegment = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;

export const stableStringify = (value: unknown): string => {
  const active = new WeakMap<object, string>();

  const normalize = (input: unknown, path: string): unknown => {
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
      if (Array.isArray(input)) {
        return input.map((item, index) => normalize(item, `${path}[${index}]`));
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

  return JSON.stringify(normalize(value, "$"));
};
