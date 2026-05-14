import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Capability, makeRuntime } from "../src/index.js";

describe("Capability", () => {
  interface Numbers {
    readonly get: (id: string) => Effect.Effect<number>;
    readonly save: (value: number) => Effect.Effect<number>;
  }

  const Numbers = Capability.define<Numbers>("@effect-ui/core/test/Capability/Numbers");

  it("defines an Effect service with layer helpers", async () => {
    const runtime = makeRuntime(
      Numbers.layer({
        get: (id) => Effect.succeed(id.length),
        save: (value) => Effect.succeed(value + 1)
      })
    );

    const value = await runtime.runPromise(
      Numbers.use((numbers) => numbers.get("atlas"))
    );

    expect(value).toBe(5);
    await runtime.dispose();
  });

  it("supports pure and Effect-returning accessors", async () => {
    const value = await Effect.runPromise(
      Numbers.provide(
        Effect.all([
          Numbers.useEffect((numbers) => numbers.get("kepler")),
          Numbers.useSync((numbers) => numbers.save)
        ]),
        {
          get: (id) => Effect.succeed(id.length),
          save: (value) => Effect.succeed(value + 1)
        }
      ).pipe(
        Effect.flatMap(([length, save]) =>
          Effect.map(save(length), (saved) => ({ length, saved }))
        )
      )
    );

    expect(value).toEqual({ length: 6, saved: 7 });
  });

  it("exposes mock layers for tests", async () => {
    const TestNumbers = Numbers.mock({
      get: (id) => Effect.succeed(id.length * 2),
      save: (value) => Effect.succeed(value)
    });

    const value = await Effect.runPromise(
      Effect.provide(
        Numbers.use((numbers) => numbers.get("ada")),
        TestNumbers
      )
    );

    expect(value).toBe(6);
  });

  it("composes with ordinary Effect layers", async () => {
    interface Names {
      readonly normalize: (name: string) => string;
    }
    const Names = Capability.define<Names>("@effect-ui/core/test/Capability/Names");
    const runtime = makeRuntime(
      Layer.mergeAll(
        Numbers.layer({
          get: (id) => Effect.succeed(id.length),
          save: (value) => Effect.succeed(value + 1)
        }),
        Names.layer({
          normalize: (name) => name.trim().toLowerCase()
        })
      )
    );

    const value = await runtime.runPromise(
      Names.useEffect((names) =>
        Numbers.use((numbers) => numbers.get(names.normalize("  ATLAS  ")))
      )
    );

    expect(value).toBe(5);
    await runtime.dispose();
  });
});
