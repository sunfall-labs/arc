import { describe, expect, it } from "vitest";
import { createEffect, createRoot } from "@solidjs/signals";
import { derive, flush, make } from "../src/raw-solid-signal.js";

describe("Arc Signal on @solidjs/signals", () => {
  it("Q1: set then get in the same tick (core code relies on sync reads)", () => {
    const s = make(1);
    s.set(2);
    const before = s.get();
    flush();
    expect({ before, after: s.get() }).toMatchInlineSnapshot(`
      {
        "after": 2,
        "before": 1,
      }
    `);
  });

  it("Q2: derived signal after set without flush", () => {
    const s = make(1);
    const d = derive(() => s.get() * 10);
    s.set(2);
    const before = d.get();
    flush();
    expect({ before, after: d.get() }).toMatchInlineSnapshot(`
      {
        "after": 20,
        "before": 10,
      }
    `);
  });

  it("Q3: subscribe fires for non-Solid consumers (Program runtime, devtools)", async () => {
    const s = make(0);
    const seen: number[] = [];
    const off = s.subscribe(() => seen.push(s.peek()));
    flush();
    s.set(1);
    s.set(2);
    flush();
    s.set(3);
    await Promise.resolve();
    await Promise.resolve();
    off();
    s.set(4);
    flush();
    expect(seen).toMatchInlineSnapshot(`
      [
        2,
        3,
      ]
    `);
  });

  it("Q4: Solid computations track Arc signals natively (no copy layer)", () => {
    const s = make("a");
    const seen: string[] = [];
    const dispose = createRoot((d) => {
      createEffect(
        () => s.get(),
        (v) => {
          seen.push(v);
        },
      );
      return d;
    });
    flush();
    s.set("b");
    flush();
    dispose();
    expect(seen).toMatchInlineSnapshot(`
      [
        "a",
        "b",
      ]
    `);
  });

  it("Q5: write from inside a memo (Arc's read-time setState pattern)", () => {
    const s = make(0);
    const t = make(0);
    let error: unknown;
    try {
      const d = derive(() => {
        t.set(s.get() + 1);
        return s.get();
      });
      d.get();
      flush();
    } catch (e) {
      error = e;
    }
    expect({ error: error ? String(error).slice(0, 120) : undefined, t: t.get() })
      .toMatchInlineSnapshot(`
      {
        "error": undefined,
        "t": 1,
      }
    `);
  });
});
