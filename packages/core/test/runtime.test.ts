import { Cause, Context, Deferred, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  Action,
  disposeRuntimeProviderLifecycleEntryEffect,
  disposeRuntimeProviderLifecycleEffect,
  disposeResourceStoreEffect,
  makeRuntimeProviderLifecycleEntry,
  makeResourceStore,
  makeRuntime,
  Resource,
  ResourceStoreDisposeError,
  RuntimeDisposeError,
  type RuntimeProviderDisposeObserver,
  ResourcePending,
  runWithRuntime,
  Server,
  ServerClient,
} from "../src/index.js";

describe("Effect UI runtime", () => {
  interface Numbers {
    readonly get: (id: string) => Effect.Effect<number>;
    readonly save: (value: number) => Effect.Effect<number>;
  }

  const Numbers = Context.Service<Numbers>("@effect-ui/core/test/Numbers");

  const NumbersLive = Layer.succeed(Numbers)({
    get: (id) => Effect.succeed(id.length),
    save: (value) => Effect.succeed(value + 1),
  });

  it("runs effects with services from a runtime layer", () => {
    const runtime = makeRuntime(NumbersLive);

    return Effect.runPromise(
      runtime.provide(
        Numbers.use((numbers) => numbers.get("atlas")).pipe(
          Effect.tap((value) => Effect.sync(() => expect(value).toBe(5))),
          Effect.asVoid,
          Effect.ensuring(runtime.disposeEffect),
        ),
      ),
    );
  });

  it("uses the current runtime for server function Effect boundaries", () => {
    const runtime = makeRuntime(NumbersLive);
    const getNumber = Server.fn<string, number, never, Numbers>("Number.get", {
      handler: (id) => Numbers.use((numbers) => numbers.get(id)),
    });

    return Effect.runPromise(
      runtime.provide(
        getNumber("kepler").pipe(
          Effect.tap((value) => Effect.sync(() => expect(value).toBe(6))),
          Effect.asVoid,
          Effect.ensuring(runtime.disposeEffect),
        ),
      ),
    );
  });

  it("routes server function effects through ServerClient when one is provided", () => {
    const getNumber = Server.fn<string, string>("Number.remote", {
      handler: (id) => Effect.succeed(`local:${id}`),
    });
    const runtime = makeRuntime(
      Layer.succeed(ServerClient)({
        call: (_fn, input) => Effect.succeed(`remote:${String(input)}`),
      }),
    );

    return Effect.runPromise(
      runtime.provide(
        Effect.gen(function* () {
          const effectValue = yield* getNumber.effect("atlas");
          const effectValueFromCallable = yield* getNumber("kepler");

          yield* Effect.sync(() => {
            expect(effectValue).toBe("remote:atlas");
            expect(effectValueFromCallable).toBe("remote:kepler");
          });
        }).pipe(Effect.ensuring(runtime.disposeEffect)),
      ),
    );
  });

  it("dispatches shared server function stubs to local registered handlers", () => {
    const GetNumber = Server.contract<string, number, never>("Number.local-stub");
    const getNumber = Server.client(GetNumber);
    Server.implement(GetNumber, (id) => Effect.succeed(id.length));
    const runtime = makeRuntime(Layer.succeed(ServerClient)(Server.localClient()));

    return Effect.runPromise(
      runtime.provide(
        getNumber.effect("atlas").pipe(
          Effect.tap((value) => Effect.sync(() => expect(value).toBe(5))),
          Effect.asVoid,
          Effect.ensuring(runtime.disposeEffect),
        ),
      ),
    );
  });

  it("uses the current runtime for resource Effect boundaries", () => {
    const runtime = makeRuntime(NumbersLive);
    const NumberById = Resource.family<string, number, never, Numbers>({
      name: "Runtime.Number.byId",
      load: (id) => Numbers.use((numbers) => numbers.get(id)),
    });
    const ref = NumberById("lumen");

    return Effect.runPromise(
      runtime.provide(
        Resource.prefetchEffect(ref).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              expect(value).toBe(5);
              expect(runWithRuntime(runtime, () => Resource.read(ref))).toBe(5);
            }),
          ),
          Effect.asVoid,
          Effect.ensuring(runtime.disposeEffect),
        ),
      ),
    );
  });

  it("keeps provided Resource Store overrides visible to synchronous Resource reads", () => {
    const runtime = makeRuntime(NumbersLive);
    const overrideStore = makeResourceStore();
    const NumberById = Resource.family<string, number, never, Numbers>({
      name: "Runtime.Number.override.byId",
      load: (id) => Numbers.use((numbers) => numbers.get(id)),
    });
    const ref = NumberById("atlas");

    return Effect.runPromise(
      runtime.provide(
        Effect.gen(function* () {
          yield* Resource.prefetchEffect(ref);
          const value = yield* Effect.sync(() => Resource.read(ref));
          yield* Effect.sync(() => {
            expect(value).toBe(5);
            expect(() => runWithRuntime(runtime, () => Resource.read(ref))).toThrow(
              ResourcePending,
            );
          });
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              yield* disposeResourceStoreEffect(overrideStore);
              yield* runtime.disposeEffect;
            }),
          ),
        ),
        { resourceStore: overrideStore },
      ),
    );
  });

  it("uses an explicit runtime for action event boundaries", () => {
    const runtime = makeRuntime(NumbersLive);
    const SaveNumber = Action.define<number, number, never, Numbers>({
      name: "Runtime.Number.save",
      run: (value) => Numbers.use((numbers) => numbers.save(value)),
    });
    const action = Action.use(SaveNumber, { runtime });

    return Effect.runPromise(
      action.submitEffect(41).pipe(
        Effect.tap((value) => Effect.sync(() => expect(value).toBe(42))),
        Effect.asVoid,
        Effect.ensuring(runtime.disposeEffect),
      ),
    );
  });

  it("disposes managed services when Resource Store disposal fails", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let layerFinalized = false;
        const runtime = makeRuntime(
          Layer.effectDiscard(
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                layerFinalized = true;
              }),
            ),
          ),
        );
        runtime.resourceStore.moduleRegistry.register(Symbol("failing-module"), {
          disposeEffect: Effect.fail("store dispose failed"),
        });

        yield* runtime.provide(Effect.void);
        const exit = yield* Effect.exit(runtime.disposeEffect);

        yield* Effect.sync(() => {
          expect(exit._tag).toBe("Failure");
          const error =
            exit._tag === "Failure"
              ? exit.cause.reasons.find(Cause.isFailReason)?.error
              : undefined;
          expect(error).toBeInstanceOf(RuntimeDisposeError);
          if (error instanceof RuntimeDisposeError) {
            expect(error.phase).toBe("resource-store");
            const storeError = error.cause.reasons.find(Cause.isFailReason)?.error;
            expect(storeError).toBeInstanceOf(ResourceStoreDisposeError);
            if (storeError instanceof ResourceStoreDisposeError) {
              expect(storeError.cause.reasons.find(Cause.isFailReason)?.error).toBe(
                "store dispose failed",
              );
            }
          }
          expect(layerFinalized).toBe(true);
        });
      }),
    ));

  it("does not dispose host-owned runtime-provider entries", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let disposals = 0;
        const runtime = makeRuntime();
        const entry = makeRuntimeProviderLifecycleEntry({ runtime });
        runtime.resourceStore.moduleRegistry.register(Symbol("host-owned-runtime-provider"), {
          disposeEffect: Effect.sync(() => {
            disposals++;
          }),
        });

        yield* disposeRuntimeProviderLifecycleEffect(entry, {
          observerOperation: "CoreRuntimeProvider.onDisposeFailure",
        });

        yield* Effect.sync(() => {
          expect(entry.ownsRuntime).toBe(false);
          expect(disposals).toBe(0);
        });
        yield* runtime.disposeEffect;
      }),
    ));

  it("disposes provider-owned runtime lifecycle entries", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let disposals = 0;
        const entry = makeRuntimeProviderLifecycleEntry();
        entry.runtime.resourceStore.moduleRegistry.register(Symbol("owned-runtime-provider"), {
          disposeEffect: Effect.sync(() => {
            disposals++;
          }),
        });

        yield* disposeRuntimeProviderLifecycleEffect(entry, {
          observerOperation: "CoreRuntimeProvider.onDisposeFailure",
        });

        yield* Effect.sync(() => {
          expect(entry.ownsRuntime).toBe(true);
          expect(disposals).toBe(1);
        });
      }),
    ));

  it("exposes typed provider-owned runtime lifecycle disposal failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const hostOwnedRuntime = makeRuntime();
        const hostOwnedEntry = makeRuntimeProviderLifecycleEntry({ runtime: hostOwnedRuntime });
        const providerOwnedEntry = makeRuntimeProviderLifecycleEntry();
        providerOwnedEntry.runtime.resourceStore.moduleRegistry.register(
          Symbol("typed-runtime-provider-failure"),
          {
            disposeEffect: Effect.fail("typed dispose failed"),
          },
        );

        yield* disposeRuntimeProviderLifecycleEntryEffect(hostOwnedEntry);
        const failure = yield* Effect.flip(
          disposeRuntimeProviderLifecycleEntryEffect(providerOwnedEntry),
        );

        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(RuntimeDisposeError);
          expect(failure.phase).toBe("resource-store");
        });
        yield* hostOwnedRuntime.disposeEffect;
      }),
    ));

  it("reports provider-owned runtime disposal failures and swallows observer failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const observed = yield* Deferred.make<RuntimeDisposeError>();
        const failingObserver = yield* Deferred.make<RuntimeDisposeError>();
        const promiseRejectedObserver = yield* Deferred.make<RuntimeDisposeError>();

        const observedEntry = makeRuntimeProviderLifecycleEntry();
        observedEntry.runtime.resourceStore.moduleRegistry.register(
          Symbol("observed-runtime-provider-failure"),
          {
            disposeEffect: Effect.fail("observed dispose failed"),
          },
        );
        yield* disposeRuntimeProviderLifecycleEffect(observedEntry, {
          observerOperation: "CoreRuntimeProvider.onDisposeFailure",
          onDisposeFailure: (error) => Deferred.succeed(observed, error),
        });
        const observedError = yield* Deferred.await(observed);

        const failingEntry = makeRuntimeProviderLifecycleEntry();
        failingEntry.runtime.resourceStore.moduleRegistry.register(
          Symbol("failing-observer-runtime-provider"),
          {
            disposeEffect: Effect.fail("observer dispose failed"),
          },
        );
        yield* disposeRuntimeProviderLifecycleEffect(failingEntry, {
          observerOperation: "CoreRuntimeProvider.onDisposeFailure",
          onDisposeFailure: (error) =>
            Deferred.succeed(failingObserver, error).pipe(
              Effect.flatMap(() => Effect.fail("observer failed")),
            ),
        });
        const failingObservedError = yield* Deferred.await(failingObserver);

        const thenableEntry = makeRuntimeProviderLifecycleEntry();
        thenableEntry.runtime.resourceStore.moduleRegistry.register(
          Symbol("thenable-observer-runtime-provider"),
          {
            disposeEffect: Effect.fail("thenable observer dispose failed"),
          },
        );
        const thenableObserver: RuntimeProviderDisposeObserver = (error) => {
          void Effect.runFork(Deferred.succeed(promiseRejectedObserver, error));
          return { then: () => undefined } as never;
        };
        yield* disposeRuntimeProviderLifecycleEffect(thenableEntry, {
          observerOperation: "CoreRuntimeProvider.onDisposeFailure",
          onDisposeFailure: thenableObserver,
        });
        const thenableObservedError = yield* Deferred.await(promiseRejectedObserver);

        yield* Effect.sync(() => {
          expect(observedError).toBeInstanceOf(RuntimeDisposeError);
          expect(observedError.phase).toBe("resource-store");
          expect(failingObservedError).toBeInstanceOf(RuntimeDisposeError);
          expect(thenableObservedError).toBeInstanceOf(RuntimeDisposeError);
        });
      }),
    ));
});
