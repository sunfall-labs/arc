import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EffectInputCallbackError, makeCoreDefinitionRegistry, Server, ServerClient, ServerFunctionNotFound } from "../src/index.js";

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

  it("captures synchronous mock throws in the Effect error channel", () =>
    Effect.runPromise(
      Effect.exit(
        Server.provideMocks(
          getUser.effect({ id: "broken" }),
          Server.mock(GetUser, () => {
            throw new Error("mock failed");
          })
        )
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
              expect(failure?.error).toBeInstanceOf(EffectInputCallbackError);
            }
          })
        ),
        Effect.asVoid
      )
    ));

  it("captures synchronous local handler throws in the Effect error channel", () => {
    const Broken = Server.fn<void, string>("Test.Broken.local", {
      handler: () => {
        throw new Error("handler failed");
      }
    });

    return Effect.runPromise(
      Effect.exit(Broken.effect(undefined)).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
              expect(failure?.error).toBeInstanceOf(EffectInputCallbackError);
            }
          })
        ),
        Effect.asVoid
      )
    );
  });

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

  it("validates mock failures against the contract error schema", () => {
    const FailingUser = Server.contract<void, string, { readonly code: string }>("Test.User.mockFailure", {
      output: Schema.String,
      error: Schema.Struct({ code: Schema.String })
    });
    const failingUser = Server.client(FailingUser);

    return Effect.runPromise(
      Effect.exit(
        Server.provideMocks(
          failingUser.effect(undefined),
          Server.mock(FailingUser, () =>
            Effect.fail({ code: 500 } as unknown as { readonly code: string })
          )
        )
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
              expect(Schema.isSchemaError(failure?.error)).toBe(true);
            }
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("validates local client failures against the contract error schema", () => {
    const FailingUser = Server.contract<void, string, { readonly code: string }>("Test.User.localFailure", {
      output: Schema.String,
      error: Schema.Struct({ code: Schema.String })
    });
    const failingUser = Server.client(FailingUser);
    Server.implement(FailingUser, () =>
      Effect.fail({ code: 500 } as unknown as { readonly code: string })
    );

    return Effect.runPromise(
      Effect.exit(
        Effect.provideService(failingUser.effect(undefined), ServerClient, Server.localClient())
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
              expect(Schema.isSchemaError(failure?.error)).toBe(true);
            }
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("dispatches local clients through explicit registry snapshots", () => {
    const EchoContract = Server.contract<string, string>("Test.Server.localClient.registry", {
      input: Schema.String,
      output: Schema.String
    });
    const snapshotImplementation = Server.implement(EchoContract, (input) =>
      Effect.succeed(`snapshot:${input}`)
    );
    Server.implement(EchoContract, (input) =>
      Effect.succeed(`global:${input}`)
    );
    const echo = Server.client(EchoContract);
    const registry = makeCoreDefinitionRegistry({
      serverFunctions: [snapshotImplementation]
    });

    return Effect.runPromise(
      Effect.provideService(
        echo.effect("atlas"),
        ServerClient,
        Server.localClient({ registry })
      ).pipe(
        Effect.tap((value) =>
          Effect.sync(() => expect(value).toBe("snapshot:atlas"))
        ),
        Effect.asVoid
      )
    );
  });
});
