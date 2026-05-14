import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createNodeHandler,
  nodeRequestOrigin,
  nodeRequestToWebRequest,
  toFetchHandler,
  toFetchHandlerEffect
} from "../src/adapters.js";
import {
  toFetchHandlerEffect as toPackagedFetchHandlerEffect
} from "@effect-ui/start-fetch";
import {
  nodeRequestOrigin as packagedNodeRequestOrigin
} from "@effect-ui/start-node";

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

  it("adapts an Effect request handler to a Node HTTP server", async () => {
    const nodeHandler = createNodeHandler((request) =>
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
    const server = createServer((request, response) => {
      void Effect.runFork(
        nodeHandler(request, response).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              response.statusCode = 500;
              response.end(String(error));
            })
          )
        )
      );
    });
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
    await expect(
      Effect.runPromise(effectHandler(new Request("https://example.com/from-package")))
    ).resolves.toMatchObject({
      status: 200
    });
  });
});
