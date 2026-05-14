import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Server, ServerClient, ServerFunctionNotFound } from "../src/index.js";

describe("Server contracts", () => {
  const User = Schema.Struct({
    id: Schema.String,
    name: Schema.String
  });

  const GetUser = Server.contract<
    { readonly id: string },
    { readonly id: string; readonly name: string },
    never
  >("Test.User.get", {
    input: Schema.Struct({ id: Schema.String }),
    output: User
  });

  const getUser = Server.client(GetUser);

  it("provides typed mocks without registering a server handler", () =>
    Effect.runPromise(
      Server.provideMocks(
        getUser.effect({ id: "ada" }),
        Server.mock(GetUser, ({ id }) => Effect.succeed({ id, name: "Ada" }))
      ).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            expect(value).toEqual({ id: "ada", name: "Ada" });
            expect(Server.get(GetUser.name)?.hasHandler).toBe(false);
          })
        ),
        Effect.asVoid
      )
    ));

  it("exposes a mock layer for runtime dependency injection", () =>
    Effect.runPromise(
      Effect.provide(
        getUser.effect({ id: "grace" }),
        Server.mockLayer(
          Server.mock(GetUser, ({ id }) => Effect.succeed({ id, name: "Grace" }))
        )
      ).pipe(
        Effect.tap((value) => Effect.sync(() => expect(value.name).toBe("Grace"))),
        Effect.asVoid
      )
    ));

  it("fails fast when a server function has no mock", () =>
    Effect.runPromise(
      Effect.exit(
        Effect.provideService(getUser.effect({ id: "missing" }), ServerClient, Server.mockClient())
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
              expect(failure?.error).toBeInstanceOf(ServerFunctionNotFound);
            }
          })
        ),
        Effect.asVoid
      )
    ));

  it("validates mock output against the contract schema", () =>
    Effect.runPromise(
      Effect.exit(
        Server.provideMocks(
          getUser.effect({ id: "broken" }),
          Server.mock(GetUser, ({ id }) =>
            // @ts-expect-error invalid mock output is rejected by the contract schema at runtime
            Effect.succeed({ id, name: 42 })
          )
        )
      ).pipe(
        Effect.tap((exit) => Effect.sync(() => expect(Exit.isFailure(exit)).toBe(true))),
        Effect.asVoid
      )
    ));
});
