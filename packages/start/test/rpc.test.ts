import { Cause, Data, Effect, Exit, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  defineApp,
  route,
  Server,
  ServerClient,
  ServerTransportError
} from "@effect-ui/core";
import {
  createServerActionResponseEffect,
  createServerRpcResponseEffect,
  makeRpcClient,
  serverActionPath,
  serverRpcPath,
  startJsonMediaType,
  startRequestIdHeader,
  startTraceparentHeader,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion,
  startTransportRequestHeaders,
  type StartFetch
} from "../src/index.js";

const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

const app = defineApp({
  routes: [route("/", {})] as const,
  client: {}
});

interface RpcFailureBody {
  readonly _tag?: string;
  readonly error: {
    readonly _tag?: string;
    readonly message?: string;
    readonly payload?: Record<string, unknown>;
  };
}

class RpcFailureBodyReadError extends Data.TaggedError("RpcFailureBodyReadError")<{
  readonly cause: unknown;
}> {}

const readRpcFailureBodyEffect = (response: Response): Effect.Effect<RpcFailureBody, RpcFailureBodyReadError> =>
  Effect.tryPromise({
    try: () => response.json() as Promise<RpcFailureBody>,
    catch: (cause) => new RpcFailureBodyReadError({ cause })
  });

describe("Start RPC transport", () => {
  it("rejects RPC requests with unsupported content-type as typed protocol failures", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* createServerRpcResponseEffect(
          app,
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: {
              accept: startJsonMediaType,
              "content-type": "text/plain",
              [startRequestIdHeader]: "req-rpc-content-type",
              [startTraceparentHeader]: traceparent
            },
            body: JSON.stringify({ name: "missing", input: {} })
          })
        );
        const body = yield* readRpcFailureBodyEffect(response);

        yield* Effect.sync(() => {
          expect(response.status).toBe(415);
          expect(response.headers.get(startRequestIdHeader)).toBe("req-rpc-content-type");
          expect(response.headers.get(startTraceparentHeader)).toBe(traceparent);
          expect(response.headers.get(startTransportKindHeader)).toBe("rpc");
          expect(response.headers.get(startTransportProtocolHeader)).toBe(startTransportProtocolVersion);
          expect(body).toMatchObject({
            _tag: "ServerError",
            error: {
              _tag: "ServerRpcProtocolError",
              payload: {
                contentType: "text/plain"
              }
            }
          });
          expect(body.error.message).toContain("Expected content-type application/json");
        });
      })
    );
  });

  it("rejects RPC requests whose accept header does not allow JSON", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* createServerRpcResponseEffect(
          app,
          new Request(`https://example.com${serverRpcPath}`, {
            method: "POST",
            headers: {
              accept: "text/html",
              "content-type": startJsonMediaType
            },
            body: JSON.stringify({ name: "missing", input: {} })
          })
        );
        const body = yield* readRpcFailureBodyEffect(response);

        yield* Effect.sync(() => {
          expect(response.status).toBe(406);
          expect(body.error).toMatchObject({
            _tag: "ServerRpcProtocolError",
            payload: {
              accept: "text/html"
            }
          });
        });
      })
    );
  });

  it("rejects invalid RPC methods before parsing the body", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* createServerRpcResponseEffect(
          app,
          new Request(`https://example.com${serverRpcPath}`, {
            method: "GET",
            headers: {
              accept: startJsonMediaType
            }
          })
        );
        const body = yield* readRpcFailureBodyEffect(response);

        yield* Effect.sync(() => {
          expect(response.status).toBe(405);
          expect(response.headers.get("allow")).toBe("POST");
          expect(body.error).toMatchObject({
            _tag: "ServerRpcProtocolError"
          });
          expect(body.error.message).toContain("Server functions require POST requests");
        });
      })
    );
  });

  it("rejects action posts with unsupported content-type as typed protocol failures", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* createServerActionResponseEffect(
          app,
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: {
              accept: startJsonMediaType,
              "content-type": "text/plain",
              [startRequestIdHeader]: "req-action-content-type"
            },
            body: "not a supported action body"
          }),
          []
        );
        const body = yield* readRpcFailureBodyEffect(response);

        yield* Effect.sync(() => {
          expect(response.status).toBe(415);
          expect(response.headers.get(startRequestIdHeader)).toBe("req-action-content-type");
          expect(response.headers.get(startTransportKindHeader)).toBe("action");
          expect(body.error).toMatchObject({
            _tag: "ServerRpcProtocolError",
            payload: {
              contentType: "text/plain"
            }
          });
          expect(body.error.message).toContain("application/x-www-form-urlencoded");
        });
      })
    );
  });

  it("rejects malformed JSON action payloads as typed protocol failures", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* createServerActionResponseEffect(
          app,
          new Request(`https://example.com${serverActionPath}`, {
            method: "POST",
            headers: {
              accept: startJsonMediaType,
              "content-type": startJsonMediaType
            },
            body: JSON.stringify({ input: { value: "missing action name" } })
          }),
          []
        );
        const body = yield* readRpcFailureBodyEffect(response);

        yield* Effect.sync(() => {
          expect(response.status).toBe(400);
          expect(body.error).toMatchObject({
            _tag: "ServerRpcProtocolError"
          });
          expect(body.error.message).toContain("Expected an action request with string name");
        });
      })
    );
  });

  it("propagates request id and trace headers from the browser RPC client", () => {
    const Echo = Server.contract<string, string>("Start.transport.echo", {
      input: Schema.String,
      output: Schema.String
    });
    const echo = Server.client(Echo);
    let observedHeaders: Headers | undefined;
    const fetcher: StartFetch = (_input, init) => {
      observedHeaders = new Headers(init?.headers);
      return Effect.succeed(
        new Response(JSON.stringify({ _tag: "Success", value: "ok" }), {
          headers: { "content-type": startJsonMediaType }
        })
      );
    };
    const runtime = Layer.succeed(ServerClient)(
      makeRpcClient({
        fetch: fetcher,
        headers: startTransportRequestHeaders({
          requestId: "req-client",
          traceparent
        })
      })
    );

    return Effect.runPromise(
      Effect.provide(echo.effect("hello"), runtime).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            expect(value).toBe("ok");
            expect(observedHeaders?.get(startRequestIdHeader)).toBe("req-client");
            expect(observedHeaders?.get(startTraceparentHeader)).toBe(traceparent);
            expect(observedHeaders?.get("accept")).toBe(startJsonMediaType);
            expect(observedHeaders?.get("content-type")).toBe(startJsonMediaType);
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("rejects non-JSON RPC responses before decoding protocol payloads", () => {
    const Echo = Server.contract<string, string>("Start.transport.non-json", {
      input: Schema.String,
      output: Schema.String
    });
    const echo = Server.client(Echo);
    const runtime = Layer.succeed(ServerClient)(
      makeRpcClient({
        fetch: () =>
          Effect.succeed(
            new Response("not json", {
              status: 200,
              headers: { "content-type": "text/plain" }
            })
          )
      })
    );

    return Effect.runPromise(
      Effect.exit(Effect.provide(echo.effect("hello"), runtime)).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

            expect(failure).toBeInstanceOf(ServerTransportError);
            expect(failure).toMatchObject({
              _tag: "ServerTransportError",
              reason: "InvalidResponse",
              status: 200
            });
          })
        ),
        Effect.asVoid
      )
    );
  });
});

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;
