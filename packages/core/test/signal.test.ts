import { Deferred, Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  EffectInputCallbackError,
  read,
  runWithScope,
  Signal,
  UiScope,
  UiScopeMissing,
  watch,
} from "../src/index.js";

describe("Signal", () => {
  it("tracks derived dependencies", () => {
    const count = Signal.make(1);
    const doubled = Signal.derive(() => read(count) * 2);

    expect(read(doubled)).toBe(2);
    count.set(3);
    expect(read(doubled)).toBe(6);
  });

  it("deduplicates repeated derived reads of the same source", () => {
    const count = Signal.make(1);
    let computes = 0;
    const repeated = Signal.derive(() => {
      computes++;
      return read(count) + read(count);
    });
    const values: number[] = [];
    const unsubscribe = repeated.subscribe(() => {
      values.push(read(repeated));
    });

    expect(read(repeated)).toBe(2);
    count.set(2);
    unsubscribe();

    expect(read(repeated)).toBe(4);
    expect(computes).toBe(4);
    expect(values).toEqual([4]);
  });

  it("queues derived recomputes triggered during computation", () => {
    const count = Signal.make(0);
    let computes = 0;
    const derived = Signal.derive(() => {
      computes++;
      const value = read(count);
      if (value === 0) {
        count.set(1);
      }
      return value;
    });

    expect(read(derived)).toBe(1);
    expect(computes).toBe(2);
  });

  it("unsubscribes stale conditional derived dependencies", () => {
    const useLeft = Signal.make(true);
    const left = Signal.make("left");
    const right = Signal.make("right");
    let computes = 0;
    const selected = Signal.derive(() => {
      computes++;
      return read(useLeft) ? read(left) : read(right);
    });

    expect(read(selected)).toBe("left");
    useLeft.set(false);
    expect(read(selected)).toBe("right");
    left.set("stale");
    expect(read(selected)).toBe("right");
    right.set("fresh");
    expect(read(selected)).toBe("fresh");
    expect(computes).toBe(5);
  });

  it("rolls back derived subscriptions when evaluation throws", () => {
    const left = Signal.make(0);
    const right = Signal.make(0);
    const shouldThrow = Signal.make(false);
    const cause = new Error("derive failed");
    let computes = 0;
    const selected = Signal.derive(() => {
      computes++;
      const value = read(left);
      if (read(shouldThrow)) {
        read(right);
        throw cause;
      }
      return value;
    });
    const unsubscribe = selected.subscribe(() => undefined);

    expect(read(selected)).toBe(0);
    shouldThrow.set(true);
    const computesAfterFailure = computes;

    expect(() => read(selected)).toThrow(EffectInputCallbackError);
    right.set(1);
    expect(computes).toBe(computesAfterFailure);

    shouldThrow.set(false);
    expect(read(selected)).toBe(0);
    unsubscribe();
  });

  it("keeps unrelated subscribers running when a derived evaluator throws", () => {
    const count = Signal.make(0);
    const cause = new Error("derive failed");
    const derived = Signal.derive(() => {
      const value = read(count);
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

    expect(read(derived)).toBe(0);
    expect(() => count.set(1)).not.toThrow();
    expect(unrelatedRuns).toBe(1);
    expect(() => read(derived)).toThrow(EffectInputCallbackError);

    derivedUnsubscribe();
    unrelatedUnsubscribe();
  });

  it("rolls back watch subscriptions and keeps subscribers running when evaluation throws", async () => {
    const scope = new UiScope();
    const left = Signal.make(0);
    const right = Signal.make(0);
    const shouldThrow = Signal.make(false);
    const cause = new Error("watch failed");
    let evaluates = 0;

    runWithScope(scope, () => {
      watch(
        () => {
          evaluates++;
          const value = read(left);
          if (read(shouldThrow)) {
            read(right);
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

    expect(() => shouldThrow.set(true)).not.toThrow();
    expect(unrelatedRuns).toBe(1);
    const evaluatesAfterFailure = evaluates;

    right.set(1);
    expect(evaluates).toBe(evaluatesAfterFailure);

    shouldThrow.set(false);
    expect(evaluates).toBe(evaluatesAfterFailure + 1);

    unrelatedUnsubscribe();
    await Effect.runPromise(scope.disposeEffect());
  });

  it("stops tracking derived dependencies after the last subscriber unsubscribes", () => {
    const count = Signal.make(1);
    let computes = 0;
    const doubled = Signal.derive(() => {
      computes++;
      return read(count) * 2;
    });
    const unsubscribe = doubled.subscribe(() => undefined);

    expect(read(doubled)).toBe(2);
    unsubscribe();
    const computesAfterUnsubscribe = computes;

    count.set(2);

    expect(computes).toBe(computesAfterUnsubscribe);
    expect(read(doubled)).toBe(4);
    expect(computes).toBe(computesAfterUnsubscribe + 1);
  });

  it("notifies subscribers only when values change", () => {
    const count = Signal.make(0);
    let updates = 0;
    const unsubscribe = count.subscribe(() => {
      updates++;
    });

    count.set(0);
    count.set(1);
    unsubscribe();
    count.set(2);

    expect(updates).toBe(1);
  });

  it("supports untracked reads", () => {
    const count = Signal.make(1);
    const doubled = Signal.derive(() => Signal.peek(count) * 2);
    const values: number[] = [];
    const unsubscribe = doubled.subscribe(() => {
      values.push(read(doubled));
    });

    expect(read(doubled)).toBe(2);
    count.set(2);
    expect(read(doubled)).toBe(2);
    expect(values).toEqual([]);
    unsubscribe();
  });

  it("exposes current and future values as an Effect stream", () => {
    const count = Signal.make(0);

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Signal.values(count).pipe(
            Stream.take(3),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          );

          yield* Effect.yieldNow;
          count.set(1);
          count.set(2);

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
          const signal = yield* Signal.fromStreamEffect(
            Stream.make(1, 2).pipe(
              Stream.tap((n) => (n === 2 ? Deferred.succeed(settled, undefined) : Effect.void)),
            ),
            0,
          );

          yield* Deferred.await(settled);
          yield* Effect.sync(() => expect(read(signal)).toBe(2));
        }),
      ),
    ));

  it("requires a UI scope for the boundary stream helper", () => {
    expect(() => Signal.fromStream(Stream.make(1), 0)).toThrow(UiScopeMissing);

    const scope = new UiScope();
    const signal = runWithScope(scope, () => Signal.fromStream<number>(Stream.empty, 0));

    expect(read(signal)).toBe(0);
  });
});
