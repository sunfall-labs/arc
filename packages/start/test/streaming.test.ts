import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { ResourceHydrationPayload } from "@effect-ui/core";
import {
  StartHydrationPayloadSerializeError,
  type StartHydrationPayload,
} from "../src/hydration.js";
import { responseWithScopeLifetimeEffect } from "../src/response-lifetime.js";
import {
  createHtmlResponseEffect,
  createHtmlStreamEffect,
  createStreamHydrationScript,
  htmlChunk,
  responseWithStreamFinalizer,
  StartStreamError,
  streamHydrationAttribute,
  streamHydrationSequenceAttribute,
  streamHydrationChunk,
  type StartResponseStreamFinalizeEvent,
} from "../src/streaming.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const decodeChunks = (chunks: ReadonlyArray<Uint8Array>): ReadonlyArray<string> =>
  chunks.map((chunk) => textDecoder.decode(chunk));

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;

const cyclicHydrationPayload = (): StartHydrationPayload => {
  const value: Record<string, unknown> = {};
  value.self = value;
  return {
    resources: [
      {
        name: "Streaming.Project.cyclic",
        key: "Streaming.Project.cyclic:1",
        input: "1",
        state: {
          _tag: "Success",
          waiting: false,
          value,
          updatedAt: 1,
        },
      },
    ],
  };
};

describe("Start streaming", () => {
  it("emits shell, HTML chunks, hydration chunks, and tail in order", () => {
    const payload: ResourceHydrationPayload = {
      resources: [
        {
          name: "Streaming.Project.byId",
          key: 'Streaming.Project.byId:"atlas"',
          input: "atlas",
          state: {
            _tag: "Success",
            waiting: false,
            value: { id: "atlas", name: "Atlas" },
            updatedAt: 1,
          },
        },
      ],
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const stream = yield* createHtmlStreamEffect({
          shell: "<html><body>",
          chunks: Stream.make(htmlChunk("<main>Atlas</main>"), streamHydrationChunk(payload)),
          tail: "</body></html>",
        });

        const chunks = yield* Stream.runCollect(stream);

        yield* Effect.sync(() =>
          expect(decodeChunks(chunks)).toEqual([
            "<html><body>",
            "<main>Atlas</main>",
            `<script type="application/json" ${streamHydrationAttribute} ${streamHydrationSequenceAttribute}="0">{"_tag":"StartHydrationChunk","version":1,"sequence":0,"payload":{"resources":[{"name":"Streaming.Project.byId","key":"Streaming.Project.byId:\\"atlas\\"","input":"atlas","state":{"_tag":"Success","waiting":false,"value":{"id":"atlas","name":"Atlas"},"updatedAt":1}}]}}</script>`,
            "</body></html>",
          ]),
        );
      }),
    );
  });

  it("assigns stable sequence numbers to streamed hydration chunks", () => {
    const first: StartHydrationPayload = {
      resources: [
        {
          name: "Streaming.Project.first",
          key: "Streaming.Project.first:1",
          input: "1",
          state: {
            _tag: "Success",
            waiting: false,
            value: { id: "1" },
            updatedAt: 1,
          },
        },
      ],
    };
    const second: StartHydrationPayload = {
      resources: [
        {
          name: "Streaming.Project.second",
          key: "Streaming.Project.second:2",
          input: "2",
          state: {
            _tag: "Success",
            waiting: false,
            value: { id: "2" },
            updatedAt: 2,
          },
        },
      ],
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const stream = yield* createHtmlStreamEffect({
          shell: "<html>",
          chunks: Stream.make(
            streamHydrationChunk(first),
            htmlChunk("<main />"),
            streamHydrationChunk(second),
          ),
        });

        const chunks = yield* Stream.runCollect(stream);
        const decoded = decodeChunks(chunks);

        yield* Effect.sync(() => {
          expect(decoded[1]).toContain(`${streamHydrationSequenceAttribute}="0"`);
          expect(decoded[3]).toContain(`${streamHydrationSequenceAttribute}="1"`);
          expect(decoded[1]).toContain('"sequence":0');
          expect(decoded[3]).toContain('"sequence":1');
        });
      }),
    );
  });

  it("emits collection payloads in hydration stream chunks", () => {
    const payload: StartHydrationPayload = {
      resources: [],
      collections: [
        {
          name: "Streaming.Collection.projects",
          rows: [
            {
              key: "atlas",
              value: { id: "atlas", name: "Atlas" },
              synced: true,
              origin: "remote",
            },
          ],
          pendingMutations: [],
          updatedAt: 2,
        },
      ],
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const stream = yield* createHtmlStreamEffect({
          shell: "<html>",
          chunks: Stream.make(streamHydrationChunk(payload)),
        });

        const chunks = yield* Stream.runCollect(stream);

        yield* Effect.sync(() =>
          expect(decodeChunks(chunks)).toEqual(["<html>", createStreamHydrationScript(payload)]),
        );
      }),
    );
  });

  it("represents chunk failures as typed stream errors", () => {
    return Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const stream = yield* createHtmlStreamEffect({
            shell: "<html>",
            chunks: Stream.concat(
              Stream.make<"ok" | "boom" | ReturnType<typeof htmlChunk>>(htmlChunk("<body>")),
              Stream.fail("boom"),
            ),
          });

          return yield* Stream.runCollect(stream);
        }),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const error = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
            expect(error).toBeInstanceOf(StartStreamError);
            expect(error).toMatchObject({
              reason: "Chunk",
              cause: "boom",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("wraps shell hydration serialization failures in StartStreamError", () => {
    return Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const stream = yield* createHtmlStreamEffect({
            shell: streamHydrationChunk(cyclicHydrationPayload()),
          });

          return yield* Stream.runCollect(stream);
        }),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const error = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
            expect(error).toBeInstanceOf(StartStreamError);
            expect(error).toMatchObject({ reason: "Shell" });
            expect((error as StartStreamError<unknown> | undefined)?.cause).toBeInstanceOf(
              StartHydrationPayloadSerializeError,
            );
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("wraps streamed chunk hydration serialization failures in StartStreamError", () => {
    return Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const stream = yield* createHtmlStreamEffect({
            shell: "<html>",
            chunks: Stream.make(streamHydrationChunk(cyclicHydrationPayload())),
          });

          return yield* Stream.runCollect(stream);
        }),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const error = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
            expect(error).toBeInstanceOf(StartStreamError);
            expect(error).toMatchObject({ reason: "Chunk" });
            expect((error as StartStreamError<unknown> | undefined)?.cause).toBeInstanceOf(
              StartHydrationPayloadSerializeError,
            );
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("wraps tail hydration serialization failures in StartStreamError", () => {
    return Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const stream = yield* createHtmlStreamEffect({
            shell: "<html>",
            tail: streamHydrationChunk(cyclicHydrationPayload()),
          });

          return yield* Stream.runCollect(stream);
        }),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const error = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
            expect(error).toBeInstanceOf(StartStreamError);
            expect(error).toMatchObject({ reason: "Tail" });
            expect((error as StartStreamError<unknown> | undefined)?.cause).toBeInstanceOf(
              StartHydrationPayloadSerializeError,
            );
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("lets Effect interruption close a running stream", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const reachedBlockingChunk = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const blockingChunkEffect: Effect.Effect<ReturnType<typeof htmlChunk>> = Effect.gen(
          function* () {
            yield* Deferred.succeed(reachedBlockingChunk, undefined);
            yield* Effect.never.pipe(
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            );
            return htmlChunk("");
          },
        );
        const blockingChunk = Stream.fromEffect(blockingChunkEffect);
        const stream = yield* createHtmlStreamEffect({
          shell: "<html>",
          chunks: Stream.concat(Stream.make(htmlChunk("<body>")), blockingChunk),
        });
        const fiber = yield* Stream.runCollect(stream).pipe(
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Deferred.await(reachedBlockingChunk);
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(interrupted);
      }),
    );
  });

  it("adapts the Effect stream to a Web Response host boundary", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* createHtmlResponseEffect({
          shell: "<html>",
          chunks: Stream.make("<body>ready</body>"),
          tail: "</html>",
          headers: {
            "x-effect-ui": "streaming",
          },
        });
        const text = yield* Effect.tryPromise(() => response.text());

        yield* Effect.sync(() => {
          expect(text).toBe("<html><body>ready</body></html>");
          expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
          expect(response.headers.get("x-effect-ui")).toBe("streaming");
        });
      }),
    );
  });

  it("closes response scopes when stream finalizer attachment fails", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events: string[] = [];
        const response = new Response(new ReadableStream<Uint8Array>());
        const reader = response.body!.getReader();

        const exit = yield* Effect.exit(
          responseWithScopeLifetimeEffect(
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

  it("preserves StartStreamError phases when wrapped Web response streams fail", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const events: StartResponseStreamFinalizeEvent[] = [];
        const response = yield* createHtmlResponseEffect({
          shell: "<html>",
          chunks: Stream.fail("chunk failed"),
        });
        const wrapped = responseWithStreamFinalizer(response, {
          onFinalize: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        });
        const exit = yield* Effect.exit(Effect.tryPromise(() => wrapped.text()));

        yield* Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          expect(events).toEqual([
            {
              stream: {
                name: "response",
                state: "errored",
                chunkCount: 0,
                failurePhase: "Chunk",
              },
              status: "failure",
              failureKind: "domain",
              teardownReason: "stream-error",
              failurePhase: "Chunk",
            },
          ]);
        });
      }),
    );
  });
});
