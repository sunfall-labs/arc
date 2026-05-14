import { Effect, PubSub } from "effect";
import { describe, expect, it } from "vitest";
import { disposeResourceStoreEffect, makeResourceStore } from "../src/index.js";

describe("Resource Store disposal", () => {
  it("shuts down its event pubsub", async () => {
    const store = makeResourceStore();

    expect(PubSub.isShutdownUnsafe(store.events)).toBe(false);

    await Effect.runPromise(disposeResourceStoreEffect(store));

    expect(PubSub.isShutdownUnsafe(store.events)).toBe(true);
    await expect(Effect.runPromise(disposeResourceStoreEffect(store))).resolves.toBeUndefined();
  });

  it("shuts down its event pubsub when a module finalizer fails", async () => {
    const store = makeResourceStore();
    store.modules.set(Symbol("failing-module"), {
      disposeEffect: Effect.fail("dispose failed")
    });

    await expect(Effect.runPromise(disposeResourceStoreEffect(store))).rejects.toBeDefined();

    expect(PubSub.isShutdownUnsafe(store.events)).toBe(true);
    expect(store.modules.size).toBe(0);
  });
});
