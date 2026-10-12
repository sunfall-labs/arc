import { Cause, Data, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EffectInputPromiseRejected, Server, ServerTransportError, Route } from "@sunfall/arc-core";
import type { StartFetch } from "../src/index.js";
import { makeRpcClientLayer } from "../src/start-rpc-client.js";
import type { ServerRpcClientOptions } from "../src/start-fetch.js";
import { makeStartServerApp } from "../src/start-server-app.js";
import {
  createServerActionResponse,
  createServerRpcResponse,
} from "../src/start-request-endpoints.js";
import {
  serverActionPath,
  serverRpcPath,
  startJsonMediaType,
  startRequestIdHeader,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion,
} from "../src/rpc.js";
import {
  encodeStartClientTransportRequestBody,
  executeStartClientTransport,
} from "../src/start-client-transport.js";
import { resolveStartFetch } from "../src/start-fetch.js";
import { parseStartActionResponse } from "../src/start-action-response-codec.js";
import { parseRpcResponse } from "../src/start-transport-protocol.js";

const makeRpcClient = (options: ServerRpcClientOptions<any, any, never> = {}): Server.Client =>
  Effect.runSync(
    Effect.gen(function* () {
      return yield* Server.Client;
    }).pipe(Effect.provide(makeRpcClientLayer(options as never))),
  );

const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

const app = makeStartServerApp({
  routes: [Route.define("/", {})] as const,
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

const erroringBodyStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("body read failed"));
    },
  });

const requestStreamInit = (
  init: Omit<RequestInit, "body"> & { readonly body: ReadableStream<Uint8Array> },
): RequestInit =>
  ({
    ...init,
    duplex: "half",
  }) as RequestInit;

const readRpcFailureBodyEffect = (
  response: Response,
): Effect.Effect<RpcFailureBody, RpcFailureBodyReadError> =>
  Effect.tryPromise({
    try: () => response.json() as Promise<RpcFailureBody>,
    catch: (cause) => new RpcFailureBodyReadError({ cause }),
  });

describe("Start RPC transport", () => {
  it("rejects RPC requests with unsupported content-type as typed protocol failures", () => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerRpcResponse(
            app,
            new Request(`https://example.com${serverRpcPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": "text/plain",
                [startRequestIdHeader]: "req-rpc-content-type",
                traceparent,
              },
              body: JSON.stringify({ name: "missing", input: {} }),
            }),
          );
          const body = yield* readRpcFailureBodyEffect(response);

          yield* Effect.sync(() => {
            expect(response.status).toBe(415);
            expect(response.headers.get(startRequestIdHeader)).toBe("req-rpc-content-type");
            // Trace context parents the server span; it is never echoed back.
            expect(response.headers.get("traceparent")).toBeNull();
            expect(response.headers.get(startTransportKindHeader)).toBe("rpc");
            expect(response.headers.get(startTransportProtocolHeader)).toBe(
              startTransportProtocolVersion,
            );
            expect(body).toMatchObject({
              _tag: "ServerError",
              error: {
                _tag: "ServerRpcProtocolError",
                payload: {
                  contentType: "text/plain",
                },
              },
            });
            expect(body.error.message).toContain("Expected content-type application/json");
          });
        }),
      ),
    );
  });

  it("rejects RPC requests whose accept header does not allow JSON", () => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerRpcResponse(
            app,
            new Request(`https://example.com${serverRpcPath}`, {
              method: "POST",
              headers: {
                accept: "text/html",
                "content-type": startJsonMediaType,
              },
              body: JSON.stringify({ name: "missing", input: {} }),
            }),
          );
          const body = yield* readRpcFailureBodyEffect(response);

          yield* Effect.sync(() => {
            expect(response.status).toBe(406);
            expect(body.error).toMatchObject({
              _tag: "ServerRpcProtocolError",
              payload: {
                accept: "text/html",
              },
            });
          });
        }),
      ),
    );
  });

  it("rejects invalid RPC methods before parsing the body", () => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerRpcResponse(
            app,
            new Request(`https://example.com${serverRpcPath}`, {
              method: "GET",
              headers: {
                accept: startJsonMediaType,
              },
            }),
          );
          const body = yield* readRpcFailureBodyEffect(response);

          yield* Effect.sync(() => {
            expect(response.status).toBe(405);
            expect(response.headers.get("allow")).toBe("POST");
            expect(body.error).toMatchObject({
              _tag: "ServerRpcProtocolError",
            });
            expect(body.error.message).toContain("Server functions require POST requests");
          });
        }),
      ),
    );
  });

  it("rejects action posts with unsupported content-type as typed protocol failures", () => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerActionResponse(
            app,
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": "text/plain",
                [startRequestIdHeader]: "req-action-content-type",
              },
              body: "not a supported action body",
            }),
            [],
          );
          const body = yield* readRpcFailureBodyEffect(response);

          yield* Effect.sync(() => {
            expect(response.status).toBe(415);
            expect(response.headers.get(startRequestIdHeader)).toBe("req-action-content-type");
            expect(response.headers.get(startTransportKindHeader)).toBe("action");
            expect(body.error).toMatchObject({
              _tag: "ServerRpcProtocolError",
              payload: {
                contentType: "text/plain",
              },
            });
            expect(body.error.message).toContain("application/x-www-form-urlencoded");
          });
        }),
      ),
    );
  });

  it("labels invalid action response content-types as action transport failures", () => {
    return Effect.runPromise(
      Effect.exit(
        parseStartActionResponse(
          new Response("not json", {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
        ),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

            expect(failure).toBeInstanceOf(ServerTransportError);
            expect(failure).toMatchObject({
              _tag: "ServerTransportError",
              reason: "InvalidResponse",
              status: 200,
              message: "Start action response content-type was not application/json.",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("maps request and response body reader failures as typed transport errors", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const rpcRequestResponse = yield* createServerRpcResponse(
            app,
            new Request(
              `https://example.com${serverRpcPath}`,
              requestStreamInit({
                method: "POST",
                headers: {
                  accept: startJsonMediaType,
                  "content-type": startJsonMediaType,
                },
                body: erroringBodyStream(),
              }),
            ),
          );
          const actionRequestResponse = yield* createServerActionResponse(
            app,
            new Request(
              `https://example.com${serverActionPath}`,
              requestStreamInit({
                method: "POST",
                headers: {
                  accept: startJsonMediaType,
                  "content-type": "application/x-www-form-urlencoded",
                },
                body: erroringBodyStream(),
              }),
            ),
            [],
          );
          const rpcRequestFailureBody = yield* readRpcFailureBodyEffect(rpcRequestResponse);
          const actionRequestFailureBody = yield* readRpcFailureBodyEffect(actionRequestResponse);
          const rpcResponseExit = yield* Effect.exit(
            parseRpcResponse(
              new Response(erroringBodyStream(), {
                status: 200,
                headers: { "content-type": startJsonMediaType },
              }),
            ),
          );
          const actionResponseExit = yield* Effect.exit(
            parseStartActionResponse(
              new Response(erroringBodyStream(), {
                status: 200,
                headers: { "content-type": startJsonMediaType },
              }),
            ),
          );

          yield* Effect.sync(() => {
            const rpcResponseFailure = Exit.isFailure(rpcResponseExit)
              ? firstFailure(rpcResponseExit.cause)
              : undefined;
            const actionResponseFailure = Exit.isFailure(actionResponseExit)
              ? firstFailure(actionResponseExit.cause)
              : undefined;

            expect(rpcRequestFailureBody.error).toMatchObject({
              _tag: "ServerRpcProtocolError",
              message: "Expected a JSON server function request body.",
            });
            expect(actionRequestFailureBody.error).toMatchObject({
              _tag: "ServerRpcProtocolError",
              message: "Expected an action form body.",
            });
            expect(rpcResponseFailure).toBeInstanceOf(ServerTransportError);
            expect(rpcResponseFailure).toMatchObject({
              reason: "InvalidResponse",
              status: 200,
              message: "Could not read the server function response body.",
            });
            expect(actionResponseFailure).toBeInstanceOf(ServerTransportError);
            expect(actionResponseFailure).toMatchObject({
              reason: "InvalidResponse",
              status: 200,
              message: "Could not read the action response body.",
            });
          });
        }),
      ),
    ));

  it("rejects malformed JSON action payloads as typed protocol failures", () => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerActionResponse(
            app,
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": startJsonMediaType,
              },
              body: JSON.stringify({ input: { value: "missing action name" } }),
            }),
            [],
          );
          const body = yield* readRpcFailureBodyEffect(response);

          yield* Effect.sync(() => {
            expect(response.status).toBe(400);
            expect(body.error).toMatchObject({
              _tag: "ServerRpcProtocolError",
            });
            expect(body.error.message).toContain("Expected an action request with string name");
          });
        }),
      ),
    );
  });

  it("labels malformed JSON action request bodies as action request failures", () => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerActionResponse(
            app,
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": startJsonMediaType,
              },
              body: "{",
            }),
            [],
          );
          const body = yield* readRpcFailureBodyEffect(response);

          yield* Effect.sync(() => {
            expect(response.status).toBe(400);
            expect(body.error).toMatchObject({
              _tag: "ServerRpcProtocolError",
              message: "Expected a JSON action request body.",
            });
          });
        }),
      ),
    );
  });

  it("propagates request id and the current span from the browser RPC client", () => {
    const Echo = Server.contract<string, string>("Start.transport.echo", {
      input: Schema.String,
      output: Schema.String,
    });
    const echo = Server.client(Echo);
    let observedHeaders: Headers | undefined;
    const fetcher: StartFetch = (_input, init) => {
      observedHeaders = new Headers(init?.headers);
      return Effect.succeed(
        new Response(JSON.stringify({ _tag: "Success", value: "ok" }), {
          headers: { "content-type": startJsonMediaType },
        }),
      );
    };
    const runtime = Layer.succeed(Server.Client)(
      makeRpcClient({
        fetch: fetcher,
        headers: { [startRequestIdHeader]: "req-client" },
      }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const span = yield* Effect.currentSpan;
        const value = yield* echo.effect("hello");
        return { span, value };
      }).pipe(
        Effect.withSpan("client.echo"),
        Effect.provide(runtime),
        Effect.tap(({ span, value }) =>
          Effect.sync(() => {
            expect(value).toBe("ok");
            expect(observedHeaders?.get(startRequestIdHeader)).toBe("req-client");
            expect(observedHeaders?.get("traceparent")).toBe(
              `00-${span.traceId}-${span.spanId}-01`,
            );
            expect(observedHeaders?.get("accept")).toBe(startJsonMediaType);
            expect(observedHeaders?.get("content-type")).toBe(startJsonMediaType);
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("normalizes RPC client header and fetch setup throws as transport errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Echo = Server.contract<string, string>("Start.transport.setup-throw", {
          input: Schema.String,
          output: Schema.String,
        });
        const echo = Server.client(Echo);
        const headerCause = new Error("headers failed");
        const fetchCause = new Error("fetcher failed");
        const headerRuntime = Layer.succeed(Server.Client)(
          makeRpcClient({
            headers: () => {
              throw headerCause;
            },
          }),
        );
        const fetchRuntime = Layer.succeed(Server.Client)(
          makeRpcClient({
            fetch: () => {
              throw fetchCause;
            },
          }),
        );

        const headerExit = yield* Effect.exit(Effect.provide(echo.effect("hello"), headerRuntime));
        const fetchExit = yield* Effect.exit(Effect.provide(echo.effect("hello"), fetchRuntime));

        yield* Effect.sync(() => {
          const headerFailure = Exit.isFailure(headerExit)
            ? firstFailure(headerExit.cause)
            : undefined;
          const fetchFailure = Exit.isFailure(fetchExit)
            ? firstFailure(fetchExit.cause)
            : undefined;

          expect(headerFailure).toBeInstanceOf(ServerTransportError);
          expect(headerFailure).toMatchObject({
            reason: "Network",
            message: "Could not construct Start transport headers.",
            cause: headerCause,
          });
          expect(fetchFailure).toBeInstanceOf(ServerTransportError);
          expect(fetchFailure).toMatchObject({
            reason: "Network",
            message: "Server function request failed.",
            cause: fetchCause,
          });
        });
      }),
    ));

  it("rejects Promise-shaped custom Start fetchers as transport errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Echo = Server.contract<string, string>("Start.transport.promise-fetcher", {
          input: Schema.String,
          output: Schema.String,
        });
        const echo = Server.client(Echo);
        const fetchRuntime = Layer.succeed(Server.Client)(
          makeRpcClient({
            fetch: (() =>
              Effect.runPromise(
                Effect.succeed(
                  new Response(JSON.stringify({ _tag: "Success", value: "ok" }), {
                    headers: { "content-type": startJsonMediaType },
                  }),
                ),
              )) as unknown as StartFetch,
          }),
        );

        const exit = yield* Effect.exit(Effect.provide(echo.effect("hello"), fetchRuntime));

        yield* Effect.sync(() => {
          const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

          expect(failure).toBeInstanceOf(ServerTransportError);
          expect(failure).toMatchObject({
            reason: "Network",
            message: "Server function request failed.",
          });
          expect(failure).toHaveProperty("cause");
          expect(String((failure as ServerTransportError).cause)).toContain(
            "Start fetch hooks must return an Effect",
          );
        });
      }),
    ));

  it("rejects Promise-shaped RPC client headers as transport errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Echo = Server.contract<string, string>("Start.transport.promise-headers", {
          input: Schema.String,
          output: Schema.String,
        });
        const echo = Server.client(Echo);
        const headerRuntime = Layer.succeed(Server.Client)(
          makeRpcClient({
            headers: (() => Promise.resolve({ authorization: "Bearer token" })) as never,
          }),
        );

        const exit = yield* Effect.exit(Effect.provide(echo.effect("hello"), headerRuntime));

        yield* Effect.sync(() => {
          const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

          expect(failure).toBeInstanceOf(ServerTransportError);
          expect(failure).toMatchObject({
            reason: "Network",
            message: "Could not construct Start transport headers.",
            cause: expect.any(EffectInputPromiseRejected),
          });
        });
      }),
    ));

  it("rejects RPC client headers with throwing then getters as transport errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Echo = Server.contract<string, string>("Start.transport.throwing-then-headers", {
          input: Schema.String,
          output: Schema.String,
        });
        const echo = Server.client(Echo);
        const throwingThenHeaders = Object.defineProperty({}, "then", {
          get: () => {
            throw new Error("then getter failed");
          },
        });
        const headerRuntime = Layer.succeed(Server.Client)(
          makeRpcClient({
            headers: () => throwingThenHeaders as never,
          }),
        );

        const exit = yield* Effect.exit(Effect.provide(echo.effect("hello"), headerRuntime));

        yield* Effect.sync(() => {
          const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

          expect(failure).toBeInstanceOf(ServerTransportError);
          expect(failure).toMatchObject({
            reason: "Network",
            message: "Could not construct Start transport headers.",
            cause: expect.any(EffectInputPromiseRejected),
          });
        });
      }),
    ));

  it("aborts the default global fetch when the client Effect is interrupted", () => {
    const previousFetch = globalThis.fetch;

    return Effect.runPromise(
      Effect.gen(function* () {
        const Echo = Server.contract<string, string>("Start.transport.abort-default-fetch", {
          input: Schema.String,
          output: Schema.String,
        });
        const echo = Server.client(Echo);
        const started = yield* Deferred.make<AbortSignal>();
        const aborted = yield* Deferred.make<void>();

        globalThis.fetch = ((_input, init) => {
          const signal = init?.signal;
          if (signal === undefined || signal === null) {
            return Effect.runPromise(Effect.fail(new Error("missing fetch abort signal")));
          }
          Effect.runFork(Deferred.succeed(started, signal));
          return Effect.runPromise(
            Effect.callback<Response, unknown>((resume) => {
              signal.addEventListener(
                "abort",
                () => {
                  Effect.runFork(Deferred.succeed(aborted, undefined));
                  resume(Effect.fail(signal.reason));
                },
                { once: true },
              );
            }),
          );
        }) as typeof globalThis.fetch;

        const runtime = Layer.succeed(Server.Client)(
          makeRpcClient({
            endpoint: `https://example.com${serverRpcPath}`,
          }),
        );

        const fiber = yield* Effect.forkDetach(Effect.provide(echo.effect("hello"), runtime), {
          startImmediately: true,
        });
        const signal = yield* Deferred.await(started);
        yield* Effect.sync(() => {
          expect(signal.aborted).toBe(false);
        });
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(aborted);
        yield* Effect.sync(() => {
          expect(signal.aborted).toBe(true);
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            globalThis.fetch = previousFetch;
          }),
        ),
      ),
    );
  });

  it("removes fallback abort listeners after default global fetch completes", () => {
    const previousFetch = globalThis.fetch;
    const abortSignalAnyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");

    return Effect.runPromise(
      Effect.gen(function* () {
        const externalAbort = new AbortController();
        const addEventListener = externalAbort.signal.addEventListener.bind(externalAbort.signal);
        const removeEventListener = externalAbort.signal.removeEventListener.bind(
          externalAbort.signal,
        );
        let abortListenersAdded = 0;
        let abortListenersRemoved = 0;
        let observedSignal: AbortSignal | undefined;

        Object.defineProperty(AbortSignal, "any", {
          configurable: true,
          value: undefined,
        });
        externalAbort.signal.addEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) => {
          if (type === "abort") {
            abortListenersAdded += 1;
          }
          addEventListener(type, listener, options);
        }) as AbortSignal["addEventListener"];
        externalAbort.signal.removeEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ) => {
          if (type === "abort") {
            abortListenersRemoved += 1;
          }
          removeEventListener(type, listener, options);
        }) as AbortSignal["removeEventListener"];
        globalThis.fetch = ((_input, init) => {
          observedSignal = init?.signal ?? undefined;
          return Effect.runPromise(Effect.succeed(new Response("ok")));
        }) as typeof globalThis.fetch;

        const fetcher = yield* resolveStartFetch(
          undefined,
          "No fetch implementation is available for server functions.",
        );
        const response = yield* fetcher("https://example.com/rpc", {
          signal: externalAbort.signal,
        });

        yield* Effect.sync(() => {
          expect(response.status).toBe(200);
          expect(observedSignal).toBeDefined();
          expect(observedSignal).not.toBe(externalAbort.signal);
          expect(abortListenersAdded).toBe(1);
          expect(abortListenersRemoved).toBe(1);
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            globalThis.fetch = previousFetch;
            if (abortSignalAnyDescriptor) {
              Object.defineProperty(AbortSignal, "any", abortSignalAnyDescriptor);
            } else {
              Reflect.deleteProperty(AbortSignal, "any");
            }
          }),
        ),
      ),
    );
  });

  it("shares client transport request serialization and defect response mapping", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const encodeExit = yield* Effect.exit(
          encodeStartClientTransportRequestBody("rpc", circular),
        );
        const rpcDefectExit = yield* Effect.exit(
          executeStartClientTransport({
            kind: "rpc",
            endpoint: "https://example.com/__sunfall-arc/rpc",
            request: {
              name: "Start.transport.defect",
              input: {},
            },
            fetch: () =>
              Effect.succeed(
                new Response(
                  JSON.stringify({
                    _tag: "Defect",
                    defect: { message: "rpc exploded" },
                  }),
                  {
                    status: 500,
                    headers: { "content-type": startJsonMediaType },
                  },
                ),
              ),
            parseResponse: parseRpcResponse,
          }),
        );
        const rpcSuccessBadStatusExit = yield* Effect.exit(
          executeStartClientTransport({
            kind: "rpc",
            endpoint: "https://example.com/__sunfall-arc/rpc",
            request: {
              name: "Start.transport.status",
              input: {},
            },
            fetch: () =>
              Effect.succeed(
                new Response(
                  JSON.stringify({
                    _tag: "Success",
                    value: "ok",
                  }),
                  {
                    status: 500,
                    headers: { "content-type": startJsonMediaType },
                  },
                ),
              ),
            parseResponse: parseRpcResponse,
          }),
        );
        const actionDefectExit = yield* Effect.exit(
          executeStartClientTransport({
            kind: "action",
            endpoint: "https://example.com/__sunfall-arc/action",
            request: {
              name: "Start.action.defect",
              input: {},
            },
            fetch: () =>
              Effect.succeed(
                new Response(
                  JSON.stringify({
                    _tag: "Defect",
                    defect: { message: "action exploded" },
                  }),
                  {
                    status: 500,
                    headers: { "content-type": startJsonMediaType },
                  },
                ),
              ),
            parseResponse: parseStartActionResponse,
          }),
        );

        yield* Effect.sync(() => {
          const encodeFailure = Exit.isFailure(encodeExit)
            ? firstFailure(encodeExit.cause)
            : undefined;
          const rpcFailure = Exit.isFailure(rpcDefectExit)
            ? firstFailure(rpcDefectExit.cause)
            : undefined;
          const rpcStatusFailure = Exit.isFailure(rpcSuccessBadStatusExit)
            ? firstFailure(rpcSuccessBadStatusExit.cause)
            : undefined;
          const actionFailure = Exit.isFailure(actionDefectExit)
            ? firstFailure(actionDefectExit.cause)
            : undefined;

          expect(encodeFailure).toBeInstanceOf(ServerTransportError);
          expect(encodeFailure).toMatchObject({
            reason: "InvalidResponse",
            message: "Could not encode the server function request body.",
          });
          expect(rpcFailure).toBeInstanceOf(ServerTransportError);
          expect(rpcFailure).toMatchObject({
            reason: "Defect",
            status: 500,
            message: "Server function failed with a defect.",
            payload: { message: "rpc exploded" },
          });
          expect(rpcStatusFailure).toBeInstanceOf(ServerTransportError);
          expect(rpcStatusFailure).toMatchObject({
            reason: "BadStatus",
            status: 500,
            message: "Server function succeeded with unexpected HTTP status 500.",
            payload: { _tag: "Success" },
          });
          expect(actionFailure).toBeInstanceOf(ServerTransportError);
          expect(actionFailure).toMatchObject({
            reason: "Defect",
            status: 500,
            message: "Start action failed with a defect.",
            payload: { message: "action exploded" },
          });
        });
      }),
    ));

  it("rejects non-JSON RPC responses before decoding protocol payloads", () => {
    const Echo = Server.contract<string, string>("Start.transport.non-json", {
      input: Schema.String,
      output: Schema.String,
    });
    const echo = Server.client(Echo);
    const runtime = Layer.succeed(Server.Client)(
      makeRpcClient({
        fetch: () =>
          Effect.succeed(
            new Response("not json", {
              status: 200,
              headers: { "content-type": "text/plain" },
            }),
          ),
      }),
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
              status: 200,
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });
});

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;
