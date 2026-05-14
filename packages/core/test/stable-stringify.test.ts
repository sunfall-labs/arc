import { describe, expect, it } from "vitest";
import { StableStringifyCircularData, stableStringify } from "../src/stable-stringify.js";

describe("stableStringify", () => {
  it("sorts object keys and allows repeated acyclic references", () => {
    const shared = { z: 1, a: 2 };

    expect(stableStringify({ right: shared, left: shared })).toBe(
      "{\"left\":{\"a\":2,\"z\":1},\"right\":{\"a\":2,\"z\":1}}"
    );
  });

  it("throws a typed error with both circular paths", () => {
    const value: { readonly name: string; child?: unknown } = { name: "root" };
    value.child = { parent: value };

    try {
      stableStringify(value);
      throw new Error("Expected stableStringify to reject circular data");
    } catch (error) {
      expect(error).toBeInstanceOf(StableStringifyCircularData);
      expect(error).toMatchObject({
        _tag: "StableStringifyCircularData",
        path: "$.child.parent",
        referencePath: "$"
      });
    }
  });
});
