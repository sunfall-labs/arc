export const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") {
      return input;
    }

    if (seen.has(input)) {
      throw new TypeError("Cannot create a stable key for circular data");
    }

    seen.add(input);

    if (Array.isArray(input)) {
      return input.map(normalize);
    }

    const object = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      out[key] = normalize(object[key]);
    }
    return out;
  };

  return JSON.stringify(normalize(value));
};
