import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createNodeHandler,
  nodeRequestToWebRequest,
  toFetchHandler,
  toFetchHandlerEffect
} from "../src/adapters.js";

const listen = (server: ReturnType<typeof createServer>): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });

const close = (server: ReturnType<typeof createServer>): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

const delay = (millis: number): Promise<"timeout"> =>
  new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), millis);
  });

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
      void nodeHandler(request, response).catch((error) => {
        response.statusCode = 500;
        response.end(String(error));
      });
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
      void nodeHandler(request, response);
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
    let releaseSecond!: () => void;
    const secondChunk = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const encoder = new TextEncoder();
    const nodeHandler = createNodeHandler(() =>
      Effect.succeed(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("first"));
              void secondChunk.then(() => {
                controller.enqueue(encoder.encode("second"));
                controller.close();
              });
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
      void nodeHandler(request, response);
    });
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/stream`);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const first = await Promise.race([reader!.read(), delay(100)]);
      expect(first).not.toBe("timeout");
      expect(first).toMatchObject({
        done: false,
        value: encoder.encode("first")
      });

      releaseSecond();
      const second = await reader!.read();
      const end = await reader!.read();
      expect(second).toMatchObject({
        done: false,
        value: encoder.encode("second")
      });
      expect(end).toMatchObject({ done: true });
    } finally {
      releaseSecond();
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
      void nodeHandler(request, response);
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
    const promiseHandler = toFetchHandler((request) =>
      Promise.resolve(new Response(request.method))
    );

    await expect(
      Effect.runPromise(effectHandler(new Request("https://example.com/edge")))
    ).resolves.toMatchObject({
      status: 200
    });
    await expect(
      promiseHandler(new Request("https://example.com/edge", { method: "POST" })).then((response) => response.text())
    ).resolves.toBe("POST");
  });
});
