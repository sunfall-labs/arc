import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { Deferred, Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { defineApp, makeRuntime, route } from "@effect-ui/core";
import {
  createFetchHandler,
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  StartRequestHandlerError,
  toFetchHandler,
  toFetchHandlerEffect,
  writeNodeResponseEffect
} from "../src/adapters.js";
import { StartNodeAdapterError } from "../src/node-adapter.js";
import {
  createFetchHandler as createPackagedFetchHandler,
  toFetchHandlerEffect as toPackagedFetchHandlerEffect
} from "@effect-ui/start-fetch";
import {
  createNodeServerHandler as createPackagedNodeServerHandler,
  nodeRequestOrigin as packagedNodeRequestOrigin
} from "@effect-ui/start-node";
import { createRequestHandler } from "../src/start-request-handler.js";
import {
  normalizeStartRequestHandlerError,
  StartRequestHandlerInvalidReturn
} from "../src/start-request-handler-error.js";
import { startRequestHandlerError } from "../src/start-host-adapter.js";

const listen = (server: ReturnType<typeof createServer>): Promise<number> =>
  Effect.runPromise(Effect.callback<number, unknown>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error));
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resume(Effect.succeed((server.address() as AddressInfo).port));
    });
    return Effect.sync(() => server.off("error", onError));
  }));

const close = (server: ReturnType<typeof createServer>): Promise<void> =>
  Effect.runPromise(Effect.callback<void, unknown>((resume) => {
    server.close((error) =>
      resume(error ? Effect.fail(error) : Effect.void)
    );
  }));

describe("Start deployment adapters", () => {
  it("converts Node requests into Web requests with forwarded origin and body", async () => {
    const nodeRequest = Readable.from([Buffer.from("hello")]) as IncomingMessage;
    nodeRequest.method = "POST";
    nodeRequest.url = "/submit?tab=overview";
    nodeRequest.headers = {
      host: "internal.local",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.example.com",
      "content-type": "text/plain",
      "x-effect-ui-test": ["first", "second"]
    };

    const request = nodeRequestToWebRequest(nodeRequest);

    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://app.example.com/submit?tab=overview");
    expect(request.headers.get("content-type")).toBe("text/plain");
    expect(request.headers.get("x-effect-ui-test")).toBe("first, second");
    await expect(request.text()).resolves.toBe("hello");
  });

  it("makes Node forwarded origin trust explicit", () => {
    const nodeRequest = {
      method: "GET",
      url: "/settings",
      headers: {
        host: "internal.local",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "public.example.com"
      }
    } as IncomingMessage;

    expect(nodeRequestOrigin(nodeRequest, { trustForwardedHeaders: true })).toBe(
      "https://public.example.com"
    );
    expect(nodeRequestOrigin(nodeRequest, { trustForwardedHeaders: false })).toBe(
      "http://internal.local"
    );
    expect(nodeRequestToWebRequest(nodeRequest, { trustForwardedHeaders: false }).url).toBe(
      "http://internal.local/settings"
    );
  });

  it("adapts an Effect request handler to a Node HTTP server", async () => {
    const nodeHandler = createNodeServerHandler((request) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise(() => request.text());
        return new Response(
          JSON.stringify({
            method: request.method,
            url: request.url,
            body
          }),
          {
            status: 201,
            headers: {
              "content-type": "application/json",
              "x-effect-ui-adapter": "node"
            }
          }
        );
      })
    );
    const server = createServer(nodeHandler);
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/submit`, {
        method: "POST",
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "public.example.com"
        },
        body: "payload"
      });

      await expect(response.json()).resolves.toEqual({
        method: "POST",
        url: "https://public.example.com/submit",
        body: "payload"
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("x-effect-ui-adapter")).toBe("node");
    } finally {
      await close(server);
    }
  });

  it("runs Node server error hooks as Effects", async () => {
    const nodeHandler = createNodeServerHandler(
      () => Effect.fail("boom"),
      {
        onError: (_error, _request, response) =>
          Effect.sync(() => {
            response.statusCode = 503;
            response.setHeader("content-type", "text/plain; charset=utf-8");
            response.end("custom failure");
          })
      }
    );
    const server = createServer(nodeHandler);
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/failure`);

      expect(response.status).toBe(503);
      await expect(response.text()).resolves.toBe("custom failure");
    } finally {
      await close(server);
    }
  });

  it("normalizes synchronous handler throws in fetch adapters", async () => {
    const cause = new Error("sync handler failed");
    const request = new Request("https://example.com/sync-throw");
    const effectHandler = toFetchHandlerEffect(() => {
      throw cause;
    });
    const promiseHandler = createFetchHandler(() => {
      throw cause;
    });

    const error = await Effect.runPromise(Effect.flip(effectHandler(request)));

    expect(error).toBeInstanceOf(StartRequestHandlerError);
    expect(error).toMatchObject({
      operation: "handle-request",
      request: {
        method: "GET",
        url: "https://example.com/sync-throw"
      },
      cause
    });
    await expect(promiseHandler(request)).rejects.toBeInstanceOf(StartRequestHandlerError);
  });

  it("normalizes invalid handler return shapes in fetch adapters", async () => {
    const request = new Request("https://example.com/invalid-return");
    const effectHandler = toFetchHandlerEffect((() =>
      new Response("not an Effect")) as never);
    const promiseHandler = createFetchHandler((() =>
      Promise.resolve(new Response("not an Effect"))) as never);

    const error = await Effect.runPromise(Effect.flip(effectHandler(request)));

    expect(error).toBeInstanceOf(StartRequestHandlerError);
    expect(error.cause).toBeInstanceOf(StartRequestHandlerInvalidReturn);
    expect(error.cause).toMatchObject({
      message: expect.stringContaining("Effect.tryPromise")
    });
    await expect(promiseHandler(request)).rejects.toMatchObject({
      cause: expect.any(StartRequestHandlerInvalidReturn)
    });
  });

  it("preserves StartRequestHandlerError values through the shared host normalizer", async () => {
    const request = new Request("https://example.com/already-normalized", {
      method: "POST"
    });
    const cause = new Error("already normalized");
    const normalized = normalizeStartRequestHandlerError(request, cause);
    const effectHandler = toFetchHandlerEffect(() => Effect.fail(normalized));

    const error = await Effect.runPromise(Effect.flip(effectHandler(request)));

    expect(startRequestHandlerError(request, normalized)).toBe(normalized);
    expect(error).toBe(normalized);
    expect(error).toMatchObject({
      operation: "handle-request",
      request: {
        method: "POST",
        url: "https://example.com/already-normalized"
      },
      cause
    });
  });

  it("normalizes synchronous handler throws in Node server facades", async () => {
    const cause = new Error("sync node failure");
    let observed: unknown;
    const nodeHandler = createNodeServerHandler(
      () => {
        throw cause;
      },
      {
        onError: (error, _request, response) =>
          Effect.sync(() => {
            observed = error;
            response.statusCode = 502;
            response.setHeader("content-type", "text/plain; charset=utf-8");
            response.end("normalized failure");
          })
      }
    );
    const server = createServer(nodeHandler);
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/sync-throw`);

      expect(response.status).toBe(502);
      await expect(response.text()).resolves.toBe("normalized failure");
      expect(observed).toBeInstanceOf(StartRequestHandlerError);
      expect(observed).toMatchObject({ cause });
    } finally {
      await close(server);
    }
  });

  it("reports Node response header write throws through the adapter error channel", async () => {
    const cause = new Error("headers unavailable");
    const response = {
      statusCode: 0,
      statusMessage: "",
      setHeader: () => {
        throw cause;
      },
      end: () => {}
    } as unknown as ServerResponse;

    const error = await Effect.runPromise(
      Effect.flip(
        writeNodeResponseEffect(
          response,
          new Response("ok", {
            headers: {
              "x-effect-ui-adapter": "node"
            }
          })
        )
      )
    );

    expect(error).toBeInstanceOf(StartNodeAdapterError);
    expect(error).toMatchObject({
      _tag: "StartNodeAdapterError",
      operation: "write-response",
      error: cause
    });
  });

  it("routes synchronous runtime fork throws through Node server error hooks", async () => {
    const cause = new Error("runtime unavailable");
    let observed: unknown;
    const nodeHandler = createNodeServerHandler(
      () => Effect.succeed(new Response("ok")),
      {
        runtime: {
          runFork: () => {
            throw cause;
          }
        },
        onError: (error, _request, response) =>
          Effect.sync(() => {
            observed = error;
            response.statusCode = 503;
            response.setHeader("content-type", "text/plain; charset=utf-8");
            response.end("runtime failure");
          })
      }
    );
    const server = createServer(nodeHandler);
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/runtime-throw`);

      expect(response.status).toBe(503);
      await expect(response.text()).resolves.toBe("runtime failure");
      expect(observed).toBe(cause);
    } finally {
      await close(server);
    }
  });

  it("interrupts Node server handler Effects when the client disconnects before a response", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    const nodeHandler = createNodeServerHandler((request) =>
      Effect.gen(function* () {
        expect(request.signal.aborted).toBe(false);
        yield* Deferred.succeed(started, undefined).pipe(Effect.ignore);
        return yield* Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
        );
      })
    );
    const server = createServer(nodeHandler);
    const port = await listen(server);

    try {
      const client = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/disconnect",
        method: "GET"
      });
      client.on("error", () => {});
      client.end();

      await Effect.runPromise(Deferred.await(started));
      client.destroy();

      const interruptedResult = await Effect.runPromise(
        Deferred.await(interrupted).pipe(Effect.timeoutOption("1 second"))
      );
      expect(Option.isSome(interruptedResult)).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("keeps HEAD responses bodyless at the Node boundary", async () => {
    const nodeHandler = createNodeHandler(() =>
      Effect.succeed(
        new Response("body should not be sent", {
          status: 200,
          headers: {
            "x-effect-ui-adapter": "node-head"
          }
        })
      )
    );
    const server = createServer((request, response) => {
      void Effect.runFork(nodeHandler(request, response));
    });
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/head`, {
        method: "HEAD"
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-effect-ui-adapter")).toBe("node-head");
      await expect(response.text()).resolves.toBe("");
    } finally {
      await close(server);
    }
  });

  it("cancels HEAD response bodies so request runtime finalizers run", async () => {
    const traces: Array<{ readonly status?: string; readonly teardown?: { readonly runtimeDisposed?: boolean; readonly reason?: string } }> = [];
    let cancelled: unknown;
    const Home = route("/", {});
    const app = defineApp({
      routes: [Home] as const,
      client: {}
    });
    const startHandler = createRequestHandler(app, {
      onRequestTrace: (trace) =>
        Effect.sync(() => {
          traces.push(trace);
        }),
      render: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("body"));
            },
            cancel(reason) {
              cancelled = reason;
            }
          }),
          {
            headers: {
              "content-type": "text/html"
            }
          }
        )
    });
    const nodeHandler = createNodeHandler(startHandler);
    const server = createServer((request, response) => {
      void Effect.runFork(nodeHandler(request, response));
    });
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: "HEAD"
      });
      await expect(response.text()).resolves.toBe("");
      await Effect.runPromise(Effect.sleep("20 millis"));

      expect(cancelled).toBe("head-response");
      expect(traces).toEqual([
        expect.objectContaining({
          status: "cancelled",
          teardown: expect.objectContaining({
            runtimeDisposed: true,
            reason: "head-response"
          })
        })
      ]);
    } finally {
      await close(server);
    }
  });

  it("streams Web response bodies through the Node adapter", async () => {
    const secondChunk = Effect.runSync(Deferred.make<void>());
    const encoder = new TextEncoder();
    const nodeHandler = createNodeHandler(() =>
      Effect.succeed(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("first"));
              void Effect.runFork(
                Deferred.await(secondChunk).pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      controller.enqueue(encoder.encode("second"));
                      controller.close();
                    })
                  )
                )
              );
            }
          }),
          {
            headers: {
              "content-type": "text/plain"
            }
          }
        )
      )
    );
    const server = createServer((request, response) => {
      void Effect.runFork(nodeHandler(request, response));
    });
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/stream`);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const first = await Effect.runPromise(
        Effect.raceFirst(
          Effect.tryPromise(() => reader!.read()),
          Effect.sleep("100 millis").pipe(Effect.as("timeout" as const))
        )
      );
      expect(first).not.toBe("timeout");
      expect(first).toMatchObject({
        done: false,
        value: encoder.encode("first")
      });

      Effect.runSync(Deferred.succeed(secondChunk, undefined));
      const second = await reader!.read();
      const end = await reader!.read();
      expect(second).toMatchObject({
        done: false,
        value: encoder.encode("second")
      });
      expect(end).toMatchObject({ done: true });
    } finally {
      Effect.runSync(Deferred.succeed(secondChunk, undefined));
      await close(server);
    }
  });

  it("preserves multiple Set-Cookie headers at the Node boundary", async () => {
    const nodeHandler = createNodeHandler(() =>
      Effect.succeed(
        new Response("ok", {
          headers: new Headers([
            ["set-cookie", "a=1; Path=/"],
            ["set-cookie", "b=2; Path=/"],
            ["x-effect-ui-adapter", "node-cookies"]
          ])
        })
      )
    );
    const server = createServer((request, response) => {
      void Effect.runFork(nodeHandler(request, response));
    });
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/cookies`);

      expect(response.headers.get("x-effect-ui-adapter")).toBe("node-cookies");
      expect(response.headers.getSetCookie()).toEqual([
        "a=1; Path=/",
        "b=2; Path=/"
      ]);
    } finally {
      await close(server);
    }
  });

  it("exposes thin fetch adapters for edge-style hosts", async () => {
    const effectHandler = toFetchHandlerEffect((request) =>
      Effect.succeed(new Response(new URL(request.url).pathname))
    );
    const fetchHandler = toFetchHandler((request) =>
      Effect.succeed(new Response(request.method))
    );
    const promiseHandler = createFetchHandler(
      (request) => Effect.succeed(new Response(new URL(request.url).pathname)),
      {
        runtime: makeRuntime()
      }
    );

    await expect(
      Effect.runPromise(effectHandler(new Request("https://example.com/edge")))
    ).resolves.toMatchObject({
      status: 200
    });
    const response = await Effect.runPromise(
      fetchHandler(new Request("https://example.com/edge", { method: "POST" }))
    );
    await expect(
      response.text()
    ).resolves.toBe("POST");
    const promiseResponse = await promiseHandler(new Request("https://example.com/promise"));
    await expect(promiseResponse.text()).resolves.toBe("/promise");
  });

  it("interrupts Promise-shaped fetch handler Effects when the Request signal aborts before a response", async () => {
    const controller = new AbortController();
    const started = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    const promiseHandler = createFetchHandler((request) =>
      Effect.gen(function* () {
        expect(request.signal.aborted).toBe(false);
        yield* Deferred.succeed(started, undefined).pipe(Effect.ignore);
        return yield* Effect.never.pipe(
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
        );
      })
    );

    const response = promiseHandler(new Request("https://example.com/abort", {
      signal: controller.signal
    }));

    await Effect.runPromise(Deferred.await(started));
    controller.abort("fetch-client-disconnect");

    await expect(Effect.runPromise(
      Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
    )).resolves.toBeUndefined();
    await expect(response).rejects.toBeDefined();
  });

  it("provides request Scope in Promise-shaped fetch facades", async () => {
    let finalized = false;
    const promiseHandler = createFetchHandler(() =>
      Effect.acquireRelease(
        Effect.succeed(new Response("scoped")),
        () => Effect.sync(() => {
          finalized = true;
        })
      )
    );

    const response = await promiseHandler(new Request("https://example.com/scoped"));

    expect(finalized).toBe(false);
    await expect(response.text()).resolves.toBe("scoped");
    expect(finalized).toBe(true);
  });

  it("releases Promise-shaped fetch facade Scope when streamed bodies are cancelled", async () => {
    let finalized = false;
    let cancelled: unknown;
    const promiseHandler = createFetchHandler(() =>
      Effect.acquireRelease(
        Effect.succeed(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new TextEncoder().encode("chunk"));
              },
              cancel(reason) {
                cancelled = reason;
              }
            })
          )
        ),
        () => Effect.sync(() => {
          finalized = true;
        })
      )
    );

    const response = await promiseHandler(new Request("https://example.com/cancel"));
    const reader = response.body!.getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    expect(finalized).toBe(false);
    await reader.cancel("client-cancel");

    expect(cancelled).toBe("client-cancel");
    expect(finalized).toBe(true);
  });

  it("cancels Promise-shaped fetch facade streams when the request aborts after response creation", async () => {
    const controller = new AbortController();
    const bodyCancelled = Effect.runSync(Deferred.make<unknown>());
    const scopeFinalized = Effect.runSync(Deferred.make<void>());
    let finalized = false;
    const promiseHandler = createFetchHandler(() =>
      Effect.acquireRelease(
        Effect.succeed(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(streamController) {
                streamController.enqueue(new TextEncoder().encode("chunk"));
              },
              cancel(reason) {
                Effect.runFork(Deferred.succeed(bodyCancelled, reason));
              }
            })
          )
        ),
        () =>
          Effect.sync(() => {
            finalized = true;
          }).pipe(Effect.andThen(Deferred.succeed(scopeFinalized, undefined)))
      )
    );

    const response = await promiseHandler(new Request("https://example.com/abort-stream", {
      signal: controller.signal
    }));

    expect(finalized).toBe(false);
    expect(response.body).toBeDefined();
    controller.abort("fetch-client-left");

    await expect(
      Effect.runPromise(Deferred.await(bodyCancelled).pipe(Effect.timeout("1 second")))
    ).resolves.toBe("fetch-client-left");
    await expect(
      Effect.runPromise(Deferred.await(scopeFinalized).pipe(Effect.timeout("1 second")))
    ).resolves.toBeUndefined();
    expect(finalized).toBe(true);
  });

  it("exposes host facade packages over the tested adapter implementation", async () => {
    const nodeRequest = {
      headers: {
        host: "node.example.com"
      }
    } as IncomingMessage;
    const effectHandler = toPackagedFetchHandlerEffect((request) =>
      Effect.succeed(new Response(new URL(request.url).pathname))
    );

    expect(packagedNodeRequestOrigin(nodeRequest)).toBe(nodeRequestOrigin(nodeRequest));
    expect(typeof createPackagedNodeServerHandler(() => Effect.succeed(new Response("ok")))).toBe("function");
    await expect(
      createPackagedFetchHandler((request) =>
        Effect.succeed(new Response(new URL(request.url).pathname))
      )(new Request("https://example.com/from-fetch-package"))
    ).resolves.toMatchObject({
      status: 200
    });
    await expect(
      Effect.runPromise(effectHandler(new Request("https://example.com/from-package")))
    ).resolves.toMatchObject({
      status: 200
    });
  });

  it("keeps the packaged fetch facade pointed at the fetch-only adapter module", () => {
    const fetchAdapterSource = readFileSync(
      new URL("../src/fetch-adapter.ts", import.meta.url),
      "utf8"
    );
    const packagedFetchSource = readFileSync(
      new URL("../../start-fetch/src/index.ts", import.meta.url),
      "utf8"
    );

    expect(fetchAdapterSource).not.toContain("node:");
    expect(packagedFetchSource).toContain("@effect-ui/start/fetch-adapter");
  });
});
