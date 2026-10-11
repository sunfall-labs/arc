import { describe, expect, it } from "vitest";
import { Data, Effect } from "effect";
import { createEffect, createRoot, createSignal, flush, isPending, latest } from "@solidjs/signals";
import { EffectFailure, effectMemo } from "../src/effect-memo.js";

class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const observe = <A>(make: () => () => A) => {
  const log: string[] = [];
  const dispose = createRoot((d) => {
    const read = make();
    createEffect(read, {
      effect: (v: A) => {
        log.push(`value:${String(v)}`);
      },
      error: (e: unknown) => {
        log.push(`error:${e instanceof EffectFailure ? "EffectFailure" : String(e)}`);
      },
    } as never);
    return d;
  });
  return { log, dispose };
};

describe("fiber-backed async memo", () => {
  it("Q6: pending → value, with isPending/latest on refetch", async () => {
    const [id, setId] = createSignal("a");
    const started: string[] = [];
    const interrupted: string[] = [];
    let pendingSamples: boolean[] = [];
    let read!: () => string;
    const dispose = createRoot((d) => {
      read = effectMemo(() => {
        const current = id();
        return Effect.gen(function* () {
          started.push(current);
          yield* Effect.sleep("20 millis");
          return `project-${current}`;
        }).pipe(Effect.onInterrupt(() => Effect.sync(() => interrupted.push(current))));
      });
      createEffect(
        () => [read(), isPending(() => read())] as const,
        ([v, p]) => {
          pendingSamples.push(p);
          void v;
        },
      );
      return d;
    });
    flush();
    await tick(40);
    flush();
    const first = latest(() => read());
    setId("b");
    flush();
    const staleWhilePending = { value: read(), pending: isPending(() => read()) };
    setId("c"); // should interrupt the in-flight "b" fiber
    flush();
    await tick(40);
    flush();
    const settled = read();
    dispose();
    expect({ first, staleWhilePending, settled, started, interrupted, pendingSamples })
      .toMatchInlineSnapshot(`
      {
        "first": "project-a",
        "interrupted": [
          "b",
        ],
        "pendingSamples": [
          false,
          true,
          true,
          false,
        ],
        "settled": "project-c",
        "staleWhilePending": {
          "pending": true,
          "value": "project-a",
        },
        "started": [
          "a",
          "b",
          "c",
        ],
      }
    `);
  });

  it("Q7: typed failure reaches the error channel with its Cause", async () => {
    let read!: () => string;
    let captured: unknown;
    const dispose = createRoot((d) => {
      read = effectMemo(() => Effect.fail(new NotFound({ id: "x" })));
      createEffect(read, {
        effect: () => {},
        error: (e: unknown) => {
          captured = e;
        },
      } as never);
      return d;
    });
    flush();
    await tick(5);
    flush();
    dispose();
    const tag =
      captured instanceof EffectFailure
        ? ((captured.cause.reasons?.[0] as { error?: { _tag?: string } } | undefined)?.error
            ?._tag ?? "EffectFailure(no reasons field)")
        : String(captured);
    expect(tag).toMatchInlineSnapshot(`"NotFound"`);
    void read;
  });

  it("Q8: cache hit returns synchronously (no pending flash on hydration)", () => {
    const { log, dispose } = observe(() =>
      effectMemo(() => Effect.succeed("network"), { peek: () => ({ value: "hydrated" }) }),
    );
    flush();
    dispose();
    expect(log).toMatchInlineSnapshot(`
      [
        "value:hydrated",
      ]
    `);
  });

  it("Q9: owner disposal interrupts the in-flight fiber", async () => {
    const interrupted: string[] = [];
    const { dispose } = observe(() =>
      effectMemo(() =>
        Effect.sleep("50 millis").pipe(
          Effect.as("late"),
          Effect.onInterrupt(() => Effect.sync(() => interrupted.push("interrupted"))),
        ),
      ),
    );
    flush();
    await tick(5);
    dispose();
    await tick(10);
    expect(interrupted).toEqual(["interrupted"]);
  });
});
