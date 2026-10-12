import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Capability, EffectInputPromiseRejected, makeRuntime } from "../src/index.js";

describe("Capability", () => {
  interface Numbers {
    readonly get: (id: string) => Effect.Effect<number>;
    readonly save: (value: number) => Effect.Effect<number>;
  }

  const Numbers = Capability.define<Numbers>("@sunfall/arc-core/test/Capability/Numbers");

  it("defines an Effect service with layer helpers", () => {
    const runtime = makeRuntime(
      Numbers.layer({
        get: (id) => Effect.succeed(id.length),
        save: (value) => Effect.succeed(value + 1),
      }),
    );

    return Effect.runPromise(
      runtime.provide(
        Numbers.use((numbers) => numbers.get("atlas")).pipe(
          Effect.tap((value) => Effect.sync(() => expect(value).toBe(5))),
          Effect.asVoid,
          Effect.ensuring(Effect.orDie(runtime.dispose)),
        ),
      ),
    );
  });

  it("supports pure and Effect-returning accessors", () =>
    Effect.runPromise(
      Effect.provide(
        Effect.all([
          Numbers.use((numbers) => numbers.get("kepler")),
          Numbers.use((numbers) => numbers.save),
        ]),
        Numbers.layer({
          get: (id) => Effect.succeed(id.length),
          save: (value) => Effect.succeed(value + 1),
        }),
      ).pipe(
        Effect.flatMap(([length, save]) =>
          Effect.map(save(length), (saved) => ({ length, saved })),
        ),
        Effect.tap((value) => Effect.sync(() => expect(value).toEqual({ length: 6, saved: 7 }))),
        Effect.asVoid,
      ),
    ));

  it("reports a throwing callback as a defect", () =>
    Effect.runPromise(
      Effect.exit(
        Effect.provide(
          Numbers.use((): void => {
            throw new Error("capability failed");
          }),
          Numbers.layer({
            get: (id) => Effect.succeed(id.length),
            save: (value) => Effect.succeed(value + 1),
          }),
        ),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              const defect = exit.cause.reasons.find((reason) => reason._tag === "Die");
              expect(defect?.defect).toEqual(new Error("capability failed"));
            }
          }),
        ),
        Effect.asVoid,
      ),
    ));

  it("rejects Promise-shaped return values as EffectInput defects", () =>
    Effect.runPromise(
      Effect.exit(
        Effect.provide(
          Numbers.use((numbers) => Effect.runPromise(numbers.get("kepler")) as unknown as number),
          Numbers.layer({
            get: (id) => Effect.succeed(id.length),
            save: (value) => Effect.succeed(value + 1),
          }),
        ),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              const defect = exit.cause.reasons.find((reason) => reason._tag === "Die");
              expect(defect?.defect).toBeInstanceOf(EffectInputPromiseRejected);
            }
          }),
        ),
        Effect.asVoid,
      ),
    ));

  it("exposes layers for test doubles", () => {
    const TestNumbers = Numbers.layer({
      get: (id) => Effect.succeed(id.length * 2),
      save: (value) => Effect.succeed(value),
    });

    return Effect.runPromise(
      Effect.provide(
        Numbers.use((numbers) => numbers.get("ada")),
        TestNumbers,
      ).pipe(
        Effect.tap((value) => Effect.sync(() => expect(value).toBe(6))),
        Effect.asVoid,
      ),
    );
  });

  it("composes with ordinary Effect layers", () => {
    interface Names {
      readonly normalize: (name: string) => string;
    }
    const Names = Capability.define<Names>("@sunfall/arc-core/test/Capability/Names");
    const runtime = makeRuntime(
      Layer.mergeAll(
        Numbers.layer({
          get: (id) => Effect.succeed(id.length),
          save: (value) => Effect.succeed(value + 1),
        }),
        Names.layer({
          normalize: (name) => name.trim().toLowerCase(),
        }),
      ),
    );

    return Effect.runPromise(
      runtime.provide(
        Names.use((names) =>
          Numbers.use((numbers) => numbers.get(names.normalize("  ATLAS  "))),
        ).pipe(
          Effect.tap((value) => Effect.sync(() => expect(value).toBe(5))),
          Effect.asVoid,
          Effect.ensuring(Effect.orDie(runtime.dispose)),
        ),
      ),
    );
  });
});
