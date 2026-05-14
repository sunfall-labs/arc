import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Action, makeRuntime, Resource, runWithRuntime, Server, ServerClient } from "../src/index.js";

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

  it("runs effects with services from a runtime layer", async () => {
    const runtime = makeRuntime(NumbersLive);

    const value = await runtime.runPromise(
      Numbers.use((numbers) => numbers.get("atlas"))
    );

    expect(value).toBe(5);
    await runtime.dispose();
  });

  it("uses the current runtime for server function Promise boundaries", async () => {
    const runtime = makeRuntime(NumbersLive);
    const getNumber = Server.fn<string, number, never, Numbers>("Number.get", {
      handler: (id) => Numbers.use((numbers) => numbers.get(id))
    });

    const value = await runWithRuntime(runtime, () => getNumber("kepler"));

    expect(value).toBe(6);
    await runtime.dispose();
  });

  it("routes server function effects through ServerClient when one is provided", async () => {
    const getNumber = Server.fn<string, string>("Number.remote", {
      handler: (id) => Effect.succeed(`local:${id}`)
    });
    const runtime = makeRuntime(
      Layer.succeed(ServerClient)({
        call: (_fn, input) => Effect.succeed(`remote:${String(input)}`)
      })
    );

    const effectValue = await runtime.runPromise(getNumber.effect("atlas"));
    const promiseValue = await runWithRuntime(runtime, () => getNumber("kepler"));

    expect(effectValue).toBe("remote:atlas");
    expect(promiseValue).toBe("remote:kepler");
    await runtime.dispose();
  });

  it("dispatches shared server function stubs to local registered handlers", async () => {
    const GetNumber = Server.contract<string, number, never>("Number.local-stub");
    const getNumber = Server.client(GetNumber);
    Server.implement(GetNumber, (id) => Effect.succeed(id.length));
    const runtime = makeRuntime(
      Layer.succeed(ServerClient)(Server.localClient())
    );

    const value = await runtime.runPromise(getNumber.effect("atlas"));

    expect(value).toBe(5);
    await runtime.dispose();
  });

  it("uses the current runtime for resource Promise boundaries", async () => {
    const runtime = makeRuntime(NumbersLive);
    const NumberById = Resource.family<string, number, never, Numbers>({
      name: "Runtime.Number.byId",
      load: (id) => Numbers.use((numbers) => numbers.get(id))
    });
    const ref = NumberById("lumen");

    const value = await runWithRuntime(runtime, () => Resource.prefetch(ref));

    expect(value).toBe(5);
    expect(runWithRuntime(runtime, () => Resource.read(ref))).toBe(5);
    await runtime.dispose();
  });

  it("uses an explicit runtime for action event boundaries", async () => {
    const runtime = makeRuntime(NumbersLive);
    const SaveNumber = Action.define<number, number, never, Numbers>({
      name: "Runtime.Number.save",
      run: (value) => Numbers.use((numbers) => numbers.save(value))
    });
    const action = Action.use(SaveNumber, { runtime });

    await expect(action.submit(41)).resolves.toBe(42);
    await runtime.dispose();
  });
});
