import { expect, it } from "vitest";
import { Effect } from "effect";
import { createEffect, createMemo, createRoot, createSignal, flush } from "@solidjs/signals";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
it("Q13: commit inside an Effect fiber (outside Solid computations) is synchronous", async () => {
  const [a, setA] = createSignal(1, { ownedWrite: true } as never);
  const d = createRoot(() => createMemo(() => a() * 10));
  const commit = Effect.sync(() => flush());
  const update = (f: (n: number) => number) =>
    Effect.sync(() => {
      const next = f(a());
      setA(next);
      return next;
    });
  const program = Effect.gen(function* () {
    const returned = yield* update((n) => n + 1); // value flows forward, no read-back needed
    const beforeCommit = { a: a(), d: d() };
    yield* commit;
    const afterCommit = { a: a(), d: d() };
    return { returned, beforeCommit, afterCommit };
  });
  const forked = await Effect.runPromise(program);
  // the same program, but started from inside a Solid effect's apply phase
  let nested: unknown;
  createRoot(() =>
    createEffect(
      () => a(),
      (v) => {
        if (v === 2)
          Effect.runFork(
            Effect.gen(function* () {
              yield* Effect.yieldNow;
              return yield* program;
            }),
          ).addObserver((exit) => {
            nested = exit._tag === "Success" ? exit.value : exit;
          });
      },
    ),
  );
  flush();
  await tick(10);
  expect({ forked, nested }).toMatchInlineSnapshot(`
    {
      "forked": {
        "afterCommit": {
          "a": 2,
          "d": 20,
        },
        "beforeCommit": {
          "a": 1,
          "d": 10,
        },
        "returned": 2,
      },
      "nested": {
        "afterCommit": {
          "a": 3,
          "d": 30,
        },
        "beforeCommit": {
          "a": 2,
          "d": 20,
        },
        "returned": 3,
      },
    }
  `);
});
