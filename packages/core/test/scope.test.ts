import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  forkScoped,
  getCurrentScope,
  makeRuntime,
  makeRuntimeUiScope,
  makeRuntimeUiScopeFrame,
  onScopeDispose,
  read,
  runWithScope,
  Signal,
  UiScope,
  watch
} from "../src/index.js";

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

  it("defers pure finalizer callbacks until disposal", () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onScopeDispose(() => {
        events.push("cleanup");
      });
    });

    expect(events).toEqual([]);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.disposeEffect();
        expect(events).toEqual(["cleanup"]);
      })
    );
  });

  it("awaits async finalizers before disposal completes", () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onScopeDispose(() =>
        Effect.gen(function* () {
          events.push("start");
          yield* Effect.sleep("10 millis");
          events.push("done");
        })
      );
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.disposeEffect();
        expect(events).toEqual(["start", "done"]);
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

  it("runs watch callbacks inside the Effect callback seam", async () => {
    const scope = new UiScope();
    const count = Signal.make(0);

    expect(() =>
      runWithScope(scope, () => {
        watch(
          () => read(count),
          () => {
            throw new Error("watch failed");
          }
        );
      })
    ).not.toThrow();

    expect(() => Signal.set(count, 1)).not.toThrow();
    await Effect.runPromise(scope.disposeEffect());
  });

  it("runs finalizers registered after disposal through the configured runner", async () => {
    const events: Array<string> = [];
    let lateFinalizer: Promise<void> | undefined;
    const scope = new UiScope({
      runLateFinalizer: (effect) => {
        events.push("runner");
        lateFinalizer = Effect.runPromise(effect);
      }
    });

    await Effect.runPromise(scope.disposeEffect());
    scope.addFinalizer(() => Effect.sync(() => {
      events.push("late");
    }));

    await lateFinalizer;
    expect(events).toEqual(["runner", "late"]);
  });

  it("creates Runtime Spine-bound scopes for adapter-owned UI lifetimes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const scope = makeRuntimeUiScope(runtime);
          const events: Array<string> = [];

          yield* scope.disposeEffect();
          scope.addFinalizer(() =>
            Effect.sync(() => {
              events.push("late");
            })
          );
          yield* Effect.sleep("10 millis");

          expect(events).toEqual(["late"]);
        })
      )
    ));

  it("creates Runtime Spine-bound scope frames for adapter render lifetimes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const frame = makeRuntimeUiScopeFrame(runtime);
          const events: Array<string> = [];

          const value = frame.run(() => {
            expect(getCurrentScope()).toBe(frame.scope);
            onScopeDispose(() => Effect.sync(() => {
              events.push("dispose");
            }));
            return "rendered";
          });

          expect(value).toBe("rendered");
          yield* frame.disposeEffect();
          frame.scope.addFinalizer(() =>
            Effect.sync(() => {
              events.push("late");
            })
          );
          yield* Effect.sleep("10 millis");

          expect(events).toEqual(["dispose", "late"]);
        })
      )
    ));
});
