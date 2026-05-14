import { Effect, PubSub } from "effect";
import { describe, expect, it } from "vitest";
import { disposeResourceStoreEffect, makeResourceStore } from "../src/index.js";

describe("Resource Store disposal", () => {
  it("shuts down its event pubsub", () => {
    const store = makeResourceStore();

    expect(PubSub.isShutdownUnsafe(store.events)).toBe(false);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* disposeResourceStoreEffect(store);
        expect(PubSub.isShutdownUnsafe(store.events)).toBe(true);
        yield* disposeResourceStoreEffect(store);
      })
    );
  });

  it("shuts down its event pubsub when a module finalizer fails", () => {
    const store = makeResourceStore();
    store.modules.set(Symbol("failing-module"), {
      disposeEffect: Effect.fail("dispose failed")
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.flip(disposeResourceStoreEffect(store));
        expect(PubSub.isShutdownUnsafe(store.events)).toBe(true);
        expect(store.modules.size).toBe(0);
      })
    );
  });
});
