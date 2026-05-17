import { describe, expect, it } from "vitest";
import {
  StableStringifyCircularData,
  StableStringifyEncodeFailure,
  StableStringifyInvalidDate,
  StableStringifyUnsupportedValue,
  stableStringify,
} from "../src/stable-stringify.js";

describe("stableStringify", () => {
  it("sorts object keys and allows repeated acyclic references", () => {
    const shared = { z: 1, a: 2 };

    expect(stableStringify({ right: shared, left: shared })).toBe(
      '{"left":{"a":2,"z":1},"right":{"a":2,"z":1}}',
    );
  });

  it("keeps structured identity for Date, URL, Map, and Set values", () => {
    const first = stableStringify({
      created: new Date("2024-01-02T03:04:05.000Z"),
      url: new URL("https://example.com/projects?sort=name"),
      labels: new Set(["active", new Date("2024-01-01T00:00:00.000Z")]),
      meta: new Map<unknown, unknown>([
        ["count", 1],
        [new Date("2024-01-03T00:00:00.000Z"), "date-key"],
      ]),
    });
    const second = stableStringify({
      created: new Date("2024-01-02T03:04:06.000Z"),
      url: new URL("https://example.com/projects?sort=updated"),
      labels: new Set(["active", new Date("2024-01-01T00:00:01.000Z")]),
      meta: new Map<unknown, unknown>([
        ["count", 1],
        [new Date("2024-01-04T00:00:00.000Z"), "date-key"],
      ]),
    });

    expect(first).not.toBe(second);
    expect(first).toContain('"$effectUiStableStringify":"Date"');
    expect(first).toContain('"$effectUiStableStringify":"URL"');
    expect(first).toContain('"$effectUiStableStringify":"Map"');
    expect(first).toContain('"$effectUiStableStringify":"Set"');
  });

  it("distinguishes undefined, sparse array holes, and marker-shaped plain objects", () => {
    const withUndefined = stableStringify([undefined]);
    const withHole = stableStringify(new Array(1));
    const markerObject = stableStringify({ $effectUiStableStringify: "Date", value: "fake" });
    const realDate = stableStringify(new Date("2024-01-02T03:04:05.000Z"));

    expect(withUndefined).not.toBe(withHole);
    expect(markerObject).not.toBe(realDate);
    expect(markerObject).toContain('"$effectUiStableStringify":"Object"');
  });

  it("keeps binary values distinct", () => {
    expect(stableStringify(new Uint8Array([1, 2, 3]))).not.toBe(
      stableStringify(new Uint8Array([1, 2, 4])),
    );
    expect(stableStringify(new DataView(new Uint8Array([1, 2, 3]).buffer))).toContain(
      '"$effectUiStableStringify":"DataView"',
    );
  });

  it("throws a typed error with both circular paths", () => {
    const value: { readonly name: string; child?: unknown } = { name: "root" };
    value.child = { parent: value };

    try {
      stableStringify(value);
      expect.fail("Expected stableStringify to reject circular data");
    } catch (error) {
      expect(error).toBeInstanceOf(StableStringifyCircularData);
      expect(error).toMatchObject({
        _tag: "StableStringifyCircularData",
        path: "$.child.parent",
        referencePath: "$",
      });
    }
  });

  it("throws typed errors for invalid dates and unsupported values", () => {
    expect(() => stableStringify(new Date(Number.NaN))).toThrow(StableStringifyInvalidDate);
    expect(() => stableStringify(() => undefined)).toThrow(StableStringifyUnsupportedValue);
  });

  it("wraps host object access failures in typed encode errors", () => {
    const objectWithThrowingGetter: Record<string, unknown> = {};
    const getterCause = new Error("getter failed");
    Object.defineProperty(objectWithThrowingGetter, "boom", {
      enumerable: true,
      get: () => {
        throw getterCause;
      },
    });

    const arrayWithThrowingIndex: unknown[] = [];
    const arrayCause = new Error("array index failed");
    Object.defineProperty(arrayWithThrowingIndex, "0", {
      enumerable: true,
      get: () => {
        throw arrayCause;
      },
    });

    const ownKeysCause = new Error("own keys failed");
    const objectWithThrowingOwnKeys = new Proxy(
      {},
      {
        ownKeys: () => {
          throw ownKeysCause;
        },
      },
    );

    for (const [value, path, cause] of [
      [objectWithThrowingGetter, "$.boom", getterCause],
      [arrayWithThrowingIndex, "$[0]", arrayCause],
      [objectWithThrowingOwnKeys, "$", ownKeysCause],
    ] as const) {
      try {
        stableStringify(value);
        expect.fail("Expected stableStringify to wrap host access failures");
      } catch (error) {
        expect(error).toBeInstanceOf(StableStringifyEncodeFailure);
        expect(error).toMatchObject({
          _tag: "StableStringifyEncodeFailure",
          path,
          cause,
        });
      }
    }
  });
});
