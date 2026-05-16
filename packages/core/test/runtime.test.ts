import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  Action,
  disposeResourceStoreEffect,
  makeResourceStore,
  makeRuntime,
  Resource,
  ResourcePending,
  runWithRuntime,
  Server,
  ServerClient
} from "../src/index.js";

describe("Effect UI runtime", () => {
  interface Numbers {
    readonly get: (id: string) => Effect.Effect<number>;
    readonly save: (value: number) => Effect.Effect<number>;
  }

  const Numbers = Context.Service<Numbers>("@effect-ui/core/test/Numbers");

  const NumbersLive = Layer.succeed(Numbers)({
    get: (id) => Effect.succeed(id.length),
    save: (value) => Effect.succeed(value + 1)
  });

  it("runs effects with services from a runtime layer", () => {
    const runtime = makeRuntime(NumbersLive);

    return Effect.runPromise(runtime.provide(
      Numbers.use((numbers) => numbers.get("atlas")).pipe(
        Effect.tap((value) => Effect.sync(() => expect(value).toBe(5))),
        Effect.asVoid,
        Effect.ensuring(runtime.disposeEffect)
      )
    ));
  });

  it("uses the current runtime for server function Effect boundaries", () => {
    const runtime = makeRuntime(NumbersLive);
    const getNumber = Server.fn<string, number, never, Numbers>("Number.get", {
      handler: (id) => Numbers.use((numbers) => numbers.get(id))
    });

    return Effect.runPromise(runtime.provide(
      getNumber("kepler").pipe(
        Effect.tap((value) => Effect.sync(() => expect(value).toBe(6))),
        Effect.asVoid,
        Effect.ensuring(runtime.disposeEffect)
      )
    ));
  });

  it("routes server function effects through ServerClient when one is provided", () => {
    const getNumber = Server.fn<string, string>("Number.remote", {
      handler: (id) => Effect.succeed(`local:${id}`)
    });
    const runtime = makeRuntime(
      Layer.succeed(ServerClient)({
        call: (_fn, input) => Effect.succeed(`remote:${String(input)}`)
      })
    );

    return Effect.runPromise(runtime.provide(
      Effect.gen(function* () {
        const effectValue = yield* getNumber.effect("atlas");
        const effectValueFromCallable = yield* getNumber("kepler");

        yield* Effect.sync(() => {
          expect(effectValue).toBe("remote:atlas");
          expect(effectValueFromCallable).toBe("remote:kepler");
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    ));
  });

  it("dispatches shared server function stubs to local registered handlers", () => {
    const GetNumber = Server.contract<string, number, never>("Number.local-stub");
    const getNumber = Server.client(GetNumber);
    Server.implement(GetNumber, (id) => Effect.succeed(id.length));
    const runtime = makeRuntime(
      Layer.succeed(ServerClient)(Server.localClient())
    );

    return Effect.runPromise(runtime.provide(
      getNumber.effect("atlas").pipe(
        Effect.tap((value) => Effect.sync(() => expect(value).toBe(5))),
        Effect.asVoid,
        Effect.ensuring(runtime.disposeEffect)
      )
    ));
  });

  it("uses the current runtime for resource Effect boundaries", () => {
    const runtime = makeRuntime(NumbersLive);
    const NumberById = Resource.family<string, number, never, Numbers>({
      name: "Runtime.Number.byId",
      load: (id) => Numbers.use((numbers) => numbers.get(id))
    });
    const ref = NumberById("lumen");

    return Effect.runPromise(runtime.provide(
      Resource.prefetchEffect(ref).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            expect(value).toBe(5);
            expect(runWithRuntime(runtime, () => Resource.read(ref))).toBe(5);
          })
        ),
        Effect.asVoid,
        Effect.ensuring(runtime.disposeEffect)
      )
    ));
  });

  it("keeps provided Resource Store overrides visible to synchronous Resource reads", () => {
    const runtime = makeRuntime(NumbersLive);
    const overrideStore = makeResourceStore();
    const NumberById = Resource.family<string, number, never, Numbers>({
      name: "Runtime.Number.override.byId",
      load: (id) => Numbers.use((numbers) => numbers.get(id))
    });
    const ref = NumberById("atlas");

    return Effect.runPromise(runtime.provide(
      Effect.gen(function* () {
        yield* Resource.prefetchEffect(ref);
        const value = yield* Effect.sync(() => Resource.read(ref));
        yield* Effect.sync(() => {
          expect(value).toBe(5);
          expect(() => runWithRuntime(runtime, () => Resource.read(ref))).toThrow(ResourcePending);
        });
      }).pipe(
        Effect.ensuring(Effect.gen(function* () {
          yield* disposeResourceStoreEffect(overrideStore);
          yield* runtime.disposeEffect;
        }))
      ),
      { resourceStore: overrideStore }
    ));
  });

  it("uses an explicit runtime for action event boundaries", () => {
    const runtime = makeRuntime(NumbersLive);
    const SaveNumber = Action.define<number, number, never, Numbers>({
      name: "Runtime.Number.save",
      run: (value) => Numbers.use((numbers) => numbers.save(value))
    });
    const action = Action.use(SaveNumber, { runtime });

    return Effect.runPromise(
      action.submitEffect(41).pipe(
        Effect.tap((value) => Effect.sync(() => expect(value).toBe(42))),
        Effect.asVoid,
        Effect.ensuring(runtime.disposeEffect)
      )
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
              })
            )
          )
        );
        runtime.resourceStore.moduleRegistry.register(Symbol("failing-module"), {
          disposeEffect: Effect.fail("store dispose failed")
        });

        yield* runtime.provide(Effect.void);
        const exit = yield* Effect.exit(runtime.disposeEffect);

        yield* Effect.sync(() => {
          expect(exit._tag).toBe("Failure");
          if (exit._tag === "Failure") {
            expect(exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error).toBe("store dispose failed");
          }
          expect(layerFinalized).toBe(true);
        });
      })
    ));
});
