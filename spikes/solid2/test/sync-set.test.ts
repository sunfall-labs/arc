import { expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  latest,
} from "@solidjs/signals";
it("Q11: sync read-after-write options", () => {
  const [a, setA] = createSignal(1, { ownedWrite: true } as never);
  const d = createRoot(() => createMemo(() => a() * 10));
  setA(2);
  const viaLatest = latest(a);
  flush();
  setA(3);
  flush();
  const viaFlush = { a: a(), d: d() };
  // flush() called from inside an effect's apply phase (nested)
  let nested: unknown;
  createRoot(() =>
    createEffect(
      () => a(),
      (v) => {
        if (v === 3) {
          try {
            setA(4);
            flush();
            nested = a();
          } catch (e) {
            nested = "throws: " + String(e).slice(0, 80);
          }
        }
      },
    ),
  );
  flush();
  expect({ viaLatest, viaFlush, nested, final: a() }).toMatchInlineSnapshot(`
    {
      "final": 4,
      "nested": 3,
      "viaFlush": {
        "a": 3,
        "d": 30,
      },
      "viaLatest": 1,
    }
  `);
});
