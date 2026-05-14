import { Deferred, Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { read, runWithScope, Signal, UiScope, UiScopeMissing } from "../src/index.js";

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
    expect(computes).toBe(2);
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
    expect(computes).toBe(3);
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

    expect(read(doubled)).toBe(2);
    count.set(2);
    expect(read(doubled)).toBe(2);
  });

  it("exposes current and future values as an Effect stream", () => {
    const count = Signal.make(0);

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Signal.values(count).pipe(
            Stream.take(3),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true })
          );

          yield* Effect.yieldNow;
          count.set(1);
          count.set(2);

          const values = yield* Fiber.join(fiber);
          yield* Effect.sync(() => expect(values).toEqual([0, 1, 2]));
        })
      )
    );
  });

  it("projects a non-failing Effect stream into a scoped signal", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const settled = yield* Deferred.make<void>();
          const signal = yield* Signal.fromStreamEffect(
            Stream.make(1, 2).pipe(
              Stream.tap((n) => (n === 2 ? Deferred.succeed(settled, undefined) : Effect.void))
            ),
            0
          );

          yield* Deferred.await(settled);
          yield* Effect.sync(() => expect(read(signal)).toBe(2));
        })
      )
    ));

  it("requires a UI scope for the boundary stream helper", () => {
    expect(() => Signal.fromStream(Stream.make(1), 0)).toThrow(UiScopeMissing);

    const scope = new UiScope();
    const signal = runWithScope(scope, () => Signal.fromStream<number>(Stream.empty, 0));

    expect(read(signal)).toBe(0);
  });
});
