import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { makeRuntime, Signal } from "../src/index.js";
import {
  eraseRuntime,
  forkScoped,
  getCurrentScope,
  makeRuntimeUiScope,
  makeRuntimeUiScopeFrame,
  runWithScope,
  UiScope,
  UiScopeDisposed,
  onDispose,
  watch,
} from "../src/internal.js";

describe("UiScope", () => {
  it("runs finalizers through Effect in reverse order", () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onDispose(() => Effect.sync(() => events.push("first")));
      onDispose(() => Effect.sync(() => events.push("second")));
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.dispose();
        expect(events).toEqual(["second", "first"]);
      }),
    );
  });

  it("continues finalizer disposal after defects", () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onDispose(() => Effect.sync(() => events.push("first")));
      onDispose(() => Effect.die("finalizer defect"));
      onDispose(() => Effect.sync(() => events.push("third")));
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.dispose();
        expect(events).toEqual(["third", "first"]);
      }),
    );
  });

  it("defers pure finalizer callbacks until disposal", () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onDispose(() => {
        events.push("cleanup");
      });
    });

    expect(events).toEqual([]);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.dispose();
        expect(events).toEqual(["cleanup"]);
      }),
    );
  });

  it("awaits async finalizers before disposal completes", () => {
    const scope = new UiScope();
    const events: Array<string> = [];

    runWithScope(scope, () => {
      onDispose(() =>
        Effect.gen(function* () {
          events.push("start");
          yield* Effect.sleep("10 millis");
          events.push("done");
        }),
      );
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.dispose();
        expect(events).toEqual(["start", "done"]);
      }),
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
          }),
        ),
      );
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* scope.dispose();
        expect(interrupted).toBe(true);
      }),
    );
  });

  it("watches signal dependencies until disposal", () => {
    const scope = new UiScope();
    const count = Signal.make(0);
    const values: Array<number> = [];

    runWithScope(scope, () => {
      watch(
        () => count.get(),
        (value) => Effect.sync(() => values.push(value)),
      );
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("10 millis");
        count.set(1);
        yield* Effect.sleep("10 millis");

        yield* scope.dispose();
        count.set(2);
        yield* Effect.sleep("10 millis");

        expect(values).toEqual([0, 1]);
      }),
    );
  });

  it("runs watch callbacks inside the Effect callback seam", async () => {
    const scope = new UiScope();
    const count = Signal.make(0);

    expect(() =>
      runWithScope(scope, () => {
        watch(
          () => count.get(),
          () => {
            throw new Error("watch failed");
          },
        );
      }),
    ).not.toThrow();

    expect(() => count.set(1)).not.toThrow();
    await Effect.runPromise(scope.dispose());
  });

  it("runs finalizers registered after disposal through the configured runner", async () => {
    const events: Array<string> = [];
    let lateFinalizer: Promise<void> | undefined;
    const scope = new UiScope({
      runLateFinalizer: (effect) => {
        events.push("runner");
        lateFinalizer = Effect.runPromise(effect);
      },
    });

    await Effect.runPromise(scope.dispose());
    scope.addFinalizer(() =>
      Effect.sync(() => {
        events.push("late");
      }),
    );

    await lateFinalizer;
    expect(events).toEqual(["runner", "late"]);
  });

  it("swallows late finalizer defects in the configured runner", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let lateFinalizer: Effect.Effect<void> | undefined;
        const scope = new UiScope({
          runLateFinalizer: (effect) => {
            lateFinalizer = effect;
          },
        });

        yield* scope.dispose();
        scope.addFinalizer(() => Effect.die("late finalizer defect"));

        if (lateFinalizer === undefined) {
          expect.fail("Expected late finalizer to be handed to the runner.");
        }
        const exit = yield* Effect.exit(lateFinalizer);
        expect(exit._tag).toBe("Success");
      }),
    ));

  it("creates Runtime Spine-bound scopes for adapter-owned UI lifetimes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const scope = makeRuntimeUiScope(eraseRuntime(runtime));
          const events: Array<string> = [];

          yield* scope.dispose();
          scope.addFinalizer(() =>
            Effect.sync(() => {
              events.push("late");
            }),
          );
          yield* Effect.sleep("10 millis");

          expect(events).toEqual(["late"]);
        }),
      ),
    ));

  it("creates Runtime Spine-bound scope frames for adapter render lifetimes", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const frame = makeRuntimeUiScopeFrame(eraseRuntime(runtime));
          const events: Array<string> = [];

          const value = frame.run(() => {
            expect(getCurrentScope()).toBe(frame.scope);
            onDispose(() =>
              Effect.sync(() => {
                events.push("dispose");
              }),
            );
            return "rendered";
          });

          expect(value).toBe("rendered");
          yield* frame.dispose();
          frame.scope.addFinalizer(() =>
            Effect.sync(() => {
              events.push("late");
            }),
          );
          yield* Effect.sleep("10 millis");

          expect(events).toEqual(["dispose", "late"]);
        }),
      ),
    ));

  it("forking frame dispose closes the scope immediately", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const frame = makeRuntimeUiScopeFrame(eraseRuntime(runtime));
          const events: Array<string> = [];

          frame.run(() => {
            onDispose(() =>
              Effect.sync(() => {
                events.push("dispose");
              }),
            );
          });

          const fiber = runtime.runFork(frame.dispose());
          expect(() => frame.scope.fork(Effect.never)).toThrow(UiScopeDisposed);
          yield* Fiber.join(fiber);
          expect(events).toEqual(["dispose"]);
        }),
      ),
    ));
});
