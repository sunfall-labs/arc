import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { forkScoped, onScopeDispose, read, runWithScope, Signal, UiScope, watch } from "../src/index.js";

describe("UiScope", () => {
  it("runs finalizers through Effect in reverse order", () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onScopeDispose(() => Effect.sync(() => events.push("first")));
      onScopeDispose(() => Effect.sync(() => events.push("second")));
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.disposeEffect();
        expect(events).toEqual(["second", "first"]);
      })
    );
  });

  it("interrupts scoped fibers on disposal", () => {
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

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.disposeEffect();
        expect(interrupted).toBe(true);
      })
    );
  });

  it("watches signal dependencies until disposal", () => {
    const scope = new UiScope();
    const count = Signal.make(0);
    const values: Array<number> = [];

    runWithScope(scope, () => {
      watch(
        () => read(count),
        (value) => Effect.sync(() => values.push(value))
      );
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("10 millis");
        Signal.set(count, 1);
        yield* Effect.sleep("10 millis");

        yield* scope.disposeEffect();
        Signal.set(count, 2);
        yield* Effect.sleep("10 millis");

        expect(values).toEqual([0, 1]);
      })
    );
  });
});
