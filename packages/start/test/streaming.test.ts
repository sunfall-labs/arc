import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { ResourceHydrationPayload } from "@effect-ui/core";
import type { StartHydrationPayload } from "../src/hydration.js";
import {
  createHtmlResponseEffect,
  createHtmlStreamEffect,
  createStreamHydrationScript,
  htmlChunk,
  StartStreamError,
  streamHydrationAttribute,
  streamHydrationSequenceAttribute,
  streamHydrationChunk
} from "../src/streaming.js";

const textDecoder = new TextDecoder();

const decodeChunks = (chunks: ReadonlyArray<Uint8Array>): ReadonlyArray<string> =>
  chunks.map((chunk) => textDecoder.decode(chunk));

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;

describe("Start streaming", () => {
  it("emits shell, HTML chunks, hydration chunks, and tail in order", () => {
    const payload: ResourceHydrationPayload = {
      resources: [
        {
          name: "Streaming.Project.byId",
          key: "Streaming.Project.byId:\"atlas\"",
          input: "atlas",
          state: {
            _tag: "Success",
            waiting: false,
            value: { id: "atlas", name: "Atlas" },
            updatedAt: 1
          }
        }
      ]
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const stream = yield* createHtmlStreamEffect({
          shell: "<html><body>",
          chunks: Stream.make(
            htmlChunk("<main>Atlas</main>"),
            streamHydrationChunk(payload)
          ),
          tail: "</body></html>"
        });

        const chunks = yield* Stream.runCollect(stream);

        yield* Effect.sync(() =>
          expect(decodeChunks(chunks)).toEqual([
            "<html><body>",
            "<main>Atlas</main>",
            `<script type="application/json" ${streamHydrationAttribute} ${streamHydrationSequenceAttribute}="0">{"_tag":"StartHydrationChunk","version":1,"sequence":0,"payload":{"resources":[{"name":"Streaming.Project.byId","key":"Streaming.Project.byId:\\"atlas\\"","input":"atlas","state":{"_tag":"Success","waiting":false,"value":{"id":"atlas","name":"Atlas"},"updatedAt":1}}]}}</script>`,
            "</body></html>"
          ])
        );
      })
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
            updatedAt: 1
          }
        }
      ]
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
            updatedAt: 2
          }
        }
      ]
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const stream = yield* createHtmlStreamEffect({
          shell: "<html>",
          chunks: Stream.make(streamHydrationChunk(first), htmlChunk("<main />"), streamHydrationChunk(second))
        });

        const chunks = yield* Stream.runCollect(stream);
        const decoded = decodeChunks(chunks);

        yield* Effect.sync(() => {
          expect(decoded[1]).toContain(`${streamHydrationSequenceAttribute}="0"`);
          expect(decoded[3]).toContain(`${streamHydrationSequenceAttribute}="1"`);
          expect(decoded[1]).toContain("\"sequence\":0");
          expect(decoded[3]).toContain("\"sequence\":1");
        });
      })
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
              origin: "remote"
            }
          ],
          pendingMutations: [],
          updatedAt: 2
        }
      ]
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const stream = yield* createHtmlStreamEffect({
          shell: "<html>",
          chunks: Stream.make(streamHydrationChunk(payload))
        });

        const chunks = yield* Stream.runCollect(stream);

        yield* Effect.sync(() =>
          expect(decodeChunks(chunks)).toEqual([
            "<html>",
            createStreamHydrationScript(payload)
          ])
        );
      })
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
              Stream.fail("boom")
            )
          });

          return yield* Stream.runCollect(stream);
        })
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const error = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
            expect(error).toBeInstanceOf(StartStreamError);
            expect(error).toMatchObject({
              reason: "Chunk",
              cause: "boom"
            });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("lets Effect interruption close a running stream", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const reachedBlockingChunk = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const blockingChunkEffect: Effect.Effect<ReturnType<typeof htmlChunk>> = Effect.gen(function* () {
          yield* Deferred.succeed(reachedBlockingChunk, undefined);
          yield* Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
          );
          return htmlChunk("");
        });
        const blockingChunk = Stream.fromEffect(blockingChunkEffect);
        const stream = yield* createHtmlStreamEffect({
          shell: "<html>",
          chunks: Stream.concat(Stream.make(htmlChunk("<body>")), blockingChunk)
        });
        const fiber = yield* Stream.runCollect(stream).pipe(
          Effect.forkChild({ startImmediately: true })
        );

        yield* Deferred.await(reachedBlockingChunk);
        yield* Fiber.interrupt(fiber);
        yield* Deferred.await(interrupted);
      })
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
            "x-effect-ui": "streaming"
          }
        });
        const text = yield* Effect.tryPromise(() => response.text());

        yield* Effect.sync(() => {
          expect(text).toBe("<html><body>ready</body></html>");
          expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
          expect(response.headers.get("x-effect-ui")).toBe("streaming");
        });
      })
    );
  });
});
