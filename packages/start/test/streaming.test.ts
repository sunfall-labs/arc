import { Deferred, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { responseWithScopeLifetime } from "../src/response-lifetime.js";
import {
  completeResponse,
  completeResponseBytes,
  responseWithStreamFinalizer,
  type StartResponseStreamFinalizeEvent,
} from "../src/streaming.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

describe("Start streaming", () => {
  it("builds a complete response that Fetch hosts read and re-wrapping keeps complete", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = completeResponse("<html>ready</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
        expect(textDecoder.decode(completeResponseBytes(response))).toBe("<html>ready</html>");
        // ResponseContext and transport diagnostics re-wrap the body as is.
        const rewrapped = new Response(response.body, { status: 404, headers: response.headers });
        expect(textDecoder.decode(completeResponseBytes(rewrapped))).toBe("<html>ready</html>");
        expect(yield* Effect.promise(() => rewrapped.text())).toBe("<html>ready</html>");
        // Read, it is an ordinary used body.
        expect(completeResponseBytes(rewrapped)).toBeUndefined();
        expect(completeResponseBytes(new Response("<p>stream</p>"))).toBeUndefined();
      }),
    ));

  it("releases a response scope at once for a complete response", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: string[] = [];
        const response = yield* responseWithScopeLifetime(
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                events.push("scope");
              }),
            );
            return completeResponse("<html />", {});
          }),
        );
        // Released before anything read the body, which stays complete.
        expect(events).toEqual(["scope"]);
        expect(completeResponseBytes(response)).toBeDefined();
      }),
    ));

  it("closes response scopes when stream finalizer attachment fails", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: string[] = [];
        const response = new Response(new ReadableStream<Uint8Array>());
        const reader = response.body!.getReader();

        const exit = yield* Effect.exit(
          responseWithScopeLifetime(
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  events.push("scope");
                }),
              );
              return response;
            }),
            {
              onCleanup: () => {
                events.push("cleanup");
              },
            },
          ),
        );
        reader.releaseLock();

        expect(Exit.isFailure(exit)).toBe(true);
        expect(events).toEqual(["scope", "cleanup"]);
      }),
    ));

  it("finalizes wrapped Web response streams on close, cancel, and error", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const closedEvents: StartResponseStreamFinalizeEvent[] = [];
        const closed = responseWithStreamFinalizer(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(textEncoder.encode("a"));
                controller.enqueue(textEncoder.encode("b"));
                controller.close();
              },
            }),
          ),
          {
            onFinalize: (event) =>
              Effect.sync(() => {
                closedEvents.push(event);
              }),
          },
        );
        const closedText = yield* Effect.tryPromise(() => closed.text());

        const cancelledEvents: StartResponseStreamFinalizeEvent[] = [];
        const cancelled = responseWithStreamFinalizer(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(textEncoder.encode("hello"));
              },
            }),
          ),
          {
            onFinalize: (event) =>
              Effect.sync(() => {
                cancelledEvents.push(event);
              }),
          },
        );
        const reader = cancelled.body!.getReader();
        const first = yield* Effect.tryPromise(() => reader.read());
        yield* Effect.tryPromise(() => reader.cancel("client-left"));

        const error = new Error("stream failed");
        let errorPulls = 0;
        const erroredEvents: StartResponseStreamFinalizeEvent[] = [];
        const errored = responseWithStreamFinalizer(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (errorPulls === 0) {
                  errorPulls += 1;
                  controller.enqueue(textEncoder.encode("first"));
                  return;
                }

                controller.error(error);
              },
            }),
          ),
          {
            onFinalize: (event) =>
              Effect.sync(() => {
                erroredEvents.push(event);
              }),
          },
        );
        const erroredExit = yield* Effect.exit(Effect.tryPromise(() => errored.text()));

        yield* Effect.sync(() => {
          expect(closedText).toBe("ab");
          expect(closedEvents).toEqual([
            {
              stream: {
                name: "response",
                state: "closed",
                chunkCount: 2,
              },
              status: "success",
              teardownReason: "stream-close",
            },
          ]);
          expect(first).toEqual({
            done: false,
            value: textEncoder.encode("hello"),
          });
          expect(cancelledEvents).toEqual([
            {
              stream: {
                name: "response",
                state: "cancelled",
                chunkCount: 1,
              },
              status: "cancelled",
              teardownReason: "client-left",
            },
          ]);
          expect(Exit.isFailure(erroredExit)).toBe(true);
          expect(erroredEvents).toEqual([
            {
              stream: {
                name: "response",
                state: "errored",
                chunkCount: 1,
              },
              status: "failure",
              failureKind: "transport",
              teardownReason: "stream-error",
            },
          ]);
        });
      }),
    );
  });

  it("cancels wrapped Web response streams from abort signals", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const controller = new AbortController();
        const cancelled = yield* Deferred.make<unknown>();
        const finalized = yield* Deferred.make<StartResponseStreamFinalizeEvent>();

        responseWithStreamFinalizer(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel(reason) {
                Effect.runFork(Deferred.succeed(cancelled, reason));
              },
            }),
          ),
          {
            abortSignal: controller.signal,
            abortTeardownReason: "request-abort",
            onFinalize: (event) => Deferred.succeed(finalized, event),
          },
        );

        controller.abort("browser-left");
        const cancelReason = yield* Deferred.await(cancelled).pipe(Effect.timeout("1 second"));
        const event = yield* Deferred.await(finalized).pipe(Effect.timeout("1 second"));

        yield* Effect.sync(() => {
          expect(cancelReason).toBe("browser-left");
          expect(event).toEqual({
            stream: {
              name: "response",
              state: "cancelled",
              chunkCount: 0,
            },
            status: "cancelled",
            teardownReason: "request-abort",
          });
        });
      }),
    );
  });
});
