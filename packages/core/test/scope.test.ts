import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { forkScoped, onScopeDispose, read, runWithScope, Signal, UiScope, watch } from "../src/index.js";

describe("UiScope", () => {
  it("runs finalizers through Effect in reverse order", async () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onScopeDispose(() => Effect.sync(() => events.push("first")));
      onScopeDispose(() => Effect.sync(() => events.push("second")));
    });

    await Effect.runPromise(scope.disposeEffect());

    expect(events).toEqual(["second", "first"]);
  });

  it("interrupts scoped fibers on disposal", async () => {
    const scope = new UiScope();
    let interrupted = false;

    runWithScope(scope, () => {
      forkScoped(
        Effect.ensuring(
          Effect.never,
          Effect.sync(() => {
            interrupted = true;
          })
        )
      );
    });

    await Effect.runPromise(scope.disposeEffect());

    expect(interrupted).toBe(true);
  });

  it("watches signal dependencies until disposal", async () => {
    const scope = new UiScope();
    const count = Signal.make(0);
    const values: Array<number> = [];

    runWithScope(scope, () => {
      watch(
        () => read(count),
        (value) => Effect.sync(() => values.push(value))
      );
    });

    await Effect.runPromise(Effect.sleep("10 millis"));
    Signal.set(count, 1);
    await Effect.runPromise(Effect.sleep("10 millis"));

    await Effect.runPromise(scope.disposeEffect());
    Signal.set(count, 2);
    await Effect.runPromise(Effect.sleep("10 millis"));

    expect(values).toEqual([0, 1]);
  });
});
