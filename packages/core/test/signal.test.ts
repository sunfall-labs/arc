import { Deferred, Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { EffectInputCallbackError, Signal } from "../src/index.js";
import { runWithScope, UiScope, watch } from "../src/internal.js";

/** Commits `f`'s writes under a named transition, as an app's callback would. */
const write = (f: () => void): void => Signal.batch(f, { name: "test" });

describe("Signal", () => {
  it("tracks derived dependencies", () => {
    const count = Signal.make(1, { name: "count" });
    const doubled = Signal.derive(() => count.get() * 2);

    expect(doubled.get()).toBe(2);
    write(() => count.set(3));
    expect(doubled.get()).toBe(6);
  });

  it("deduplicates repeated derived reads of the same source", () => {
    const count = Signal.make(1, { name: "count" });
    let computes = 0;
    const repeated = Signal.derive(() => {
      computes++;
      return count.get() + count.get();
    });
    const values: number[] = [];
    const unsubscribe = repeated.subscribe(() => {
      values.push(repeated.get());
    });

    expect(repeated.get()).toBe(2);
    write(() => count.set(2));
    unsubscribe();

    expect(repeated.get()).toBe(4);
    expect(computes).toBe(4);
    expect(values).toEqual([4]);
  });

  it("queues derived recomputes triggered during computation", () => {
    const count = Signal.make(0, { name: "count" });
    let computes = 0;
    const derived = Signal.derive(() => {
      computes++;
      const value = count.get();
      if (value === 0) {
        write(() => count.set(1));
      }
      return value;
    });

    expect(derived.get()).toBe(1);
    expect(computes).toBe(2);
  });

  it("unsubscribes stale conditional derived dependencies", () => {
    const useLeft = Signal.make(true, { name: "useLeft" });
    const left = Signal.make("left", { name: "left" });
    const right = Signal.make("right", { name: "right" });
    let computes = 0;
    const selected = Signal.derive(() => {
      computes++;
      return useLeft.get() ? left.get() : right.get();
    });

    expect(selected.get()).toBe("left");
    write(() => useLeft.set(false));
    expect(selected.get()).toBe("right");
    write(() => left.set("stale"));
    expect(selected.get()).toBe("right");
    write(() => right.set("fresh"));
    expect(selected.get()).toBe("fresh");
    expect(computes).toBe(5);
  });

  it("rolls back derived subscriptions when evaluation throws", () => {
    const left = Signal.make(0, { name: "left" });
    const right = Signal.make(0, { name: "right" });
    const shouldThrow = Signal.make(false, { name: "shouldThrow" });
    const cause = new Error("derive failed");
    let computes = 0;
    const selected = Signal.derive(() => {
      computes++;
      const value = left.get();
      if (shouldThrow.get()) {
        right.get();
        throw cause;
      }
      return value;
    });
    const unsubscribe = selected.subscribe(() => undefined);

    expect(selected.get()).toBe(0);
    write(() => shouldThrow.set(true));
    const computesAfterFailure = computes;

    expect(() => selected.get()).toThrow(EffectInputCallbackError);
    write(() => right.set(1));
    expect(computes).toBe(computesAfterFailure);

    write(() => shouldThrow.set(false));
    expect(selected.get()).toBe(0);
    unsubscribe();
  });

  it("keeps unrelated subscribers running when a derived evaluator throws", () => {
    const count = Signal.make(0, { name: "count" });
    const cause = new Error("derive failed");
    const derived = Signal.derive(() => {
      const value = count.get();
      if (value > 0) {
        throw cause;
      }
      return value;
    });
    const derivedUnsubscribe = derived.subscribe(() => undefined);
    let unrelatedRuns = 0;
    const unrelatedUnsubscribe = count.subscribe(() => {
      unrelatedRuns++;
    });

    expect(derived.get()).toBe(0);
    expect(() => write(() => count.set(1))).not.toThrow();
    expect(unrelatedRuns).toBe(1);
    expect(() => derived.get()).toThrow(EffectInputCallbackError);

    derivedUnsubscribe();
    unrelatedUnsubscribe();
  });

  it("rolls back watch subscriptions and keeps subscribers running when evaluation throws", async () => {
    const scope = new UiScope();
    const left = Signal.make(0, { name: "left" });
    const right = Signal.make(0, { name: "right" });
    const shouldThrow = Signal.make(false, { name: "shouldThrow" });
    const cause = new Error("watch failed");
    let evaluates = 0;

    runWithScope(scope, () => {
      watch(
        () => {
          evaluates++;
          const value = left.get();
          if (shouldThrow.get()) {
            right.get();
            throw cause;
          }
          return value;
        },
        () => undefined,
      );
    });

    let unrelatedRuns = 0;
    const unrelatedUnsubscribe = shouldThrow.subscribe(() => {
      unrelatedRuns++;
    });

    expect(() => write(() => shouldThrow.set(true))).not.toThrow();
    expect(unrelatedRuns).toBe(1);
    const evaluatesAfterFailure = evaluates;

    write(() => right.set(1));
    expect(evaluates).toBe(evaluatesAfterFailure);

    write(() => shouldThrow.set(false));
    expect(evaluates).toBe(evaluatesAfterFailure + 1);

    unrelatedUnsubscribe();
    await Effect.runPromise(scope.dispose());
  });

  it("stops tracking derived dependencies after the last subscriber unsubscribes", () => {
    const count = Signal.make(1, { name: "count" });
    let computes = 0;
    const doubled = Signal.derive(() => {
      computes++;
      return count.get() * 2;
    });
    const unsubscribe = doubled.subscribe(() => undefined);

    expect(doubled.get()).toBe(2);
    unsubscribe();
    const computesAfterUnsubscribe = computes;

    write(() => count.set(2));

    expect(computes).toBe(computesAfterUnsubscribe);
    expect(doubled.get()).toBe(4);
    expect(computes).toBe(computesAfterUnsubscribe + 1);
  });

  it("notifies subscribers only when values change", () => {
    const count = Signal.make(0, { name: "count" });
    let updates = 0;
    const unsubscribe = count.subscribe(() => {
      updates++;
    });

    write(() => count.set(0));
    write(() => count.set(1));
    unsubscribe();
    write(() => count.set(2));

    expect(updates).toBe(1);
  });

  it("supports untracked reads", () => {
    const count = Signal.make(1, { name: "count" });
    const doubled = Signal.derive(() => Signal.peek(count) * 2);
    const values: number[] = [];
    const unsubscribe = doubled.subscribe(() => {
      values.push(doubled.get());
    });

    expect(doubled.get()).toBe(2);
    write(() => count.set(2));
    expect(doubled.get()).toBe(2);
    expect(values).toEqual([]);
    unsubscribe();
  });

  it("exposes current and future values as an Effect stream", () => {
    const count = Signal.make(0, { name: "count" });

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Signal.values(count).pipe(
            Stream.take(3),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          );

          yield* Effect.yieldNow;
          write(() => count.set(1));
          write(() => count.set(2));

          const values = yield* Fiber.join(fiber);
          yield* Effect.sync(() => expect(values).toEqual([0, 1, 2]));
        }),
      ),
    );
  });

  it("projects a non-failing Effect stream into a scoped signal", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const settled = yield* Deferred.make<void>();
          const signal = yield* Signal.fromStream(
            Stream.make(1, 2).pipe(
              Stream.tap((n) => (n === 2 ? Deferred.succeed(settled, undefined) : Effect.void)),
            ),
            0,
            { name: "streamed" },
          );

          yield* Deferred.await(settled);
          yield* Effect.sync(() => expect(signal.get()).toBe(2));
        }),
      ),
    ));
});
