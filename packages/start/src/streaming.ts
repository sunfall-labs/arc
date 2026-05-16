import type { EffectInput } from "@effect-ui/core";
import { toEffect } from "@effect-ui/core";
import { Data, Effect, Exit, Stream } from "effect";
import {
  createStreamHydrationScriptEffect,
  StartHydrationPayloadSerializeError,
  type StartHydrationPayload
} from "./hydration.js";
import type { StartRenderHydrationPlan } from "./render-hydration-plan.js";
import type {
  StartRequestTraceFailureKind,
  StartRequestTraceStatus,
  StartRequestTraceStream
} from "./request-trace.js";

export {
  createStreamHydrationScript,
  createStreamHydrationScriptEffect,
  serializeStreamHydrationPayload,
  streamHydrationAttribute,
  streamHydrationConsumedAttribute,
  streamHydrationSequenceAttribute,
  streamHydrationScriptType
} from "./hydration.js";

/**
 * Typed chunk accepted by Start's HTML stream helpers.
 *
 * `Html` chunks are UTF-8 encoded strings, `Bytes` chunks are passed through,
 * and `Hydration` chunks are serialized as inline hydration scripts.
 */
export type HtmlStreamChunk =
  | {
      /** Raw HTML text to append to the response stream. */
      readonly _tag: "Html";
      readonly html: string;
    }
  | {
      /** Pre-encoded bytes for hosts that already rendered a binary chunk. */
      readonly _tag: "Bytes";
      readonly bytes: Uint8Array;
    }
  | {
      /** Resource and collection hydration payload streamed to the browser. */
      readonly _tag: "Hydration";
      readonly payload: StartHydrationPayload;
      /** Optional explicit sequence number; omitted chunks auto-increment. */
      readonly sequence?: number;
    };

/**
 * Convenience input accepted by HTML stream helpers.
 *
 * Plain strings become HTML chunks, `Uint8Array` values become byte chunks, and
 * typed chunks preserve hydration metadata.
 */
export type HtmlStreamInput = string | Uint8Array | HtmlStreamChunk;

/**
 * Parts of a streamed HTML response.
 *
 * `shell` is emitted first, `chunks` stream after the shell, and `tail` is
 * emitted last. Failures are wrapped in `StartStreamError` with reason
 * `Shell`, `Chunk`, or `Tail` so adapters can report which phase failed.
 */
export interface HtmlStreamOptions<E = never, R = never> {
  /** First response chunk, usually the opening document shell. */
  readonly shell: EffectInput<HtmlStreamInput, E, R>;
  /** Optional middle stream for progressively rendered chunks. */
  readonly chunks?: Stream.Stream<HtmlStreamInput, E, R>;
  /** Optional final chunk, usually closing tags or final hydration data. */
  readonly tail?: EffectInput<HtmlStreamInput, E, R>;
}

/** Options for creating a `Response` from Start HTML stream parts. */
export interface HtmlResponseOptions<E = never, R = never> extends HtmlStreamOptions<E, R> {
  /** HTTP status for the response. */
  readonly status?: number;
  /** Headers for the response; `content-type` defaults to HTML when omitted. */
  readonly headers?: HeadersInit;
}

/** Options for creating a Start streamed HTML response from a render hydration plan. */
export interface StartStreamedHtmlResponseOptions<E = never, R = never>
  extends Omit<HtmlResponseOptions<E, R>, "chunks"> {
  /** Middle stream emitted after the shell and before streamed hydration chunks. */
  readonly chunks?: Stream.Stream<HtmlStreamInput, E, R>;
  /** Render hydration plan whose streamed chunks are appended before the tail. */
  readonly hydrationPlan: Pick<StartRenderHydrationPlan, "streamedResourceChunks">;
}

/** Stream phase labels preserved across Start stream adapters. */
export type StartStreamPhase = "Shell" | "Chunk" | "Tail";

/** Stream lifecycle event emitted while adapting a Web `Response` body. */
export interface StartResponseStreamFinalizeEvent {
  /** Stream fact recorded for request traces and host diagnostics. */
  readonly stream: StartRequestTraceStream;
  /** Final request status implied by stream close, error, or cancellation. */
  readonly status: StartRequestTraceStatus;
  /** Failure category when the stream finalized because of an error. */
  readonly failureKind?: StartRequestTraceFailureKind;
  /** Stable teardown reason such as `stream-close`, `stream-error`, or a cancel reason. */
  readonly teardownReason: string;
  /** Failed Start stream phase when the underlying body error is a `StartStreamError`. */
  readonly failurePhase?: StartStreamPhase;
}

/** Effect finalizer invoked once when a wrapped response body ends. */
export type StartResponseStreamFinalizer = (
  event: StartResponseStreamFinalizeEvent
) => Effect.Effect<void>;

/**
 * Failure event or mapper used when a suspended success finalizer is replaced.
 *
 * The mapper receives the failed/interrupted host-work `Exit`, allowing
 * adapters to translate request aborts into `cancelled` trace events instead
 * of reporting a generic transform failure.
 */
export type StartResponseStreamFinalizeFailureEvent<A = unknown, E = unknown> =
  | StartResponseStreamFinalizeEvent
  | ((exit: Exit.Exit<A, E>) => StartResponseStreamFinalizeEvent);

/** Runs stream adapter Effects from Web stream callbacks. */
export type StartResponseStreamRunner = <A, E>(
  effect: Effect.Effect<A, E>
) => void | PromiseLike<A>;

/** Options for wrapping a Web `Response` body with lifecycle finalization. */
export interface StartResponseStreamFinalizerOptions {
  /** Runs the Effect program produced by Web stream pull/cancel callbacks. */
  readonly runEffect?: StartResponseStreamRunner;
  /** Cancels the wrapped response body when the host request aborts after response creation. */
  readonly abortSignal?: AbortSignal;
  /** Stable teardown reason used when `abortSignal` cancels the response body. */
  readonly abortTeardownReason?: string;
  /** Receives the close/error/cancel lifecycle event exactly once. */
  readonly onFinalize?: StartResponseStreamFinalizer;
}

interface StartResponseStreamFinalizerState {
  suspendSuccess: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    failureEvent: StartResponseStreamFinalizeFailureEvent<A, E>
  ) => Effect.Effect<A, E, R>;
}

const resolveResponseStreamFailureEvent = <A, E>(
  failureEvent: StartResponseStreamFinalizeFailureEvent<A, E>,
  exit: Exit.Exit<A, E>
): StartResponseStreamFinalizeEvent =>
  typeof failureEvent === "function"
    ? failureEvent(exit)
    : failureEvent;

const responseStreamFinalizerStates = new WeakMap<
  Response,
  StartResponseStreamFinalizerState
>();

/**
 * Runs host response work while holding a successful stream finalizer.
 *
 * Dev SSR uses this when it must fully read a Start HTML response before
 * applying host transforms. If the host work fails after the body has been
 * consumed, the held success finalizer is replaced with the supplied failure
 * event so request traces do not report premature success.
 */
export const suspendResponseStreamSuccessFinalizerEffect = <A, E, R>(
  response: Response,
  effect: Effect.Effect<A, E, R>,
  failureEvent: StartResponseStreamFinalizeFailureEvent<A, E>
): Effect.Effect<A, E, R> => {
  const state = responseStreamFinalizerStates.get(response);
  return state === undefined
    ? effect
    : state.suspendSuccess(effect, failureEvent);
};

/**
 * Error emitted by HTML stream helpers when a stream phase fails.
 *
 * `reason` identifies whether the failed work came from shell creation,
 * progressive chunks, or the tail chunk.
 */
export class StartStreamError<E = never> extends Data.TaggedError("StartStreamError")<{
  readonly reason: StartStreamPhase;
  readonly cause: E;
}> {}

type HtmlStreamEncodingError<E> =
  | StartStreamError<E>
  | StartStreamError<StartHydrationPayloadSerializeError>;

interface PhasedHtmlStreamInput {
  readonly reason: StartStreamPhase;
  readonly input: HtmlStreamInput;
}

const textEncoder = new TextEncoder();
const runResponseStreamEffect: StartResponseStreamRunner = (effect) =>
  Effect.runPromise(effect);

const startStreamFailurePhase = (cause: unknown): StartStreamPhase | undefined =>
  cause instanceof StartStreamError
    ? cause.reason
    : undefined;

const startStreamFailureKind = (cause: unknown): StartRequestTraceFailureKind =>
  cause instanceof StartStreamError ? "domain" : "transport";

/** Creates a typed HTML text chunk. */
export const htmlChunk = (html: string): HtmlStreamChunk => ({
  _tag: "Html",
  html
});

/** Creates a typed pre-encoded byte chunk. */
export const bytesChunk = (bytes: Uint8Array): HtmlStreamChunk => ({
  _tag: "Bytes",
  bytes
});

/**
 * Creates a typed streamed hydration chunk.
 *
 * Omit `sequence` to let `createHtmlStream(...)` assign monotonically
 * increasing hydration script sequence numbers.
 */
export const streamHydrationChunk = (
  payload: StartHydrationPayload,
  options: { readonly sequence?: number } = {}
): HtmlStreamChunk => ({
  _tag: "Hydration",
  payload,
  ...(options.sequence === undefined ? {} : { sequence: options.sequence })
});

const isHtmlStreamChunk = (input: HtmlStreamInput): input is HtmlStreamChunk =>
  typeof input === "object" &&
  input !== null &&
  "_tag" in input &&
  ((input as { readonly _tag?: unknown })._tag === "Html" ||
    (input as { readonly _tag?: unknown })._tag === "Bytes" ||
    (input as { readonly _tag?: unknown })._tag === "Hydration");

const encodeInputEffect = (
  input: HtmlStreamInput,
  hydrationSequence = 0
): Effect.Effect<Uint8Array, StartHydrationPayloadSerializeError> => {
  if (input instanceof Uint8Array) {
    return Effect.succeed(input);
  }

  if (typeof input === "string") {
    return Effect.succeed(textEncoder.encode(input));
  }

  if (isHtmlStreamChunk(input)) {
    switch (input._tag) {
      case "Html":
        return Effect.succeed(textEncoder.encode(input.html));
      case "Bytes":
        return Effect.succeed(input.bytes);
      case "Hydration":
        return createStreamHydrationScriptEffect(
          input.payload,
          input.sequence ?? hydrationSequence
        ).pipe(
          Effect.map((script) => textEncoder.encode(script))
        );
    }
  }

  return Effect.succeed(textEncoder.encode(String(input)));
};

const encodeInputWithHydrationSequenceEffect = (
  nextSequence: number,
  chunk: PhasedHtmlStreamInput
): Effect.Effect<
  readonly [nextSequence: number, chunks: ReadonlyArray<Uint8Array>],
  StartStreamError<StartHydrationPayloadSerializeError>
> => {
  const input = chunk.input;
  if (isHtmlStreamChunk(input) && input._tag === "Hydration") {
    const sequence = input.sequence ?? nextSequence;
    return encodeInputEffect(input, sequence).pipe(
      Effect.map((encoded) => [Math.max(nextSequence, sequence + 1), [encoded]] as const),
      Effect.mapError((cause) => new StartStreamError({ reason: chunk.reason, cause }))
    );
  }

  return encodeInputEffect(input).pipe(
    Effect.map((encoded) => [nextSequence, [encoded]] as const),
    Effect.mapError((cause) => new StartStreamError({ reason: chunk.reason, cause }))
  );
};

const streamFromEffectInput = <E, R>(
  reason: StartStreamError<E>["reason"],
  input: EffectInput<HtmlStreamInput, E, R>
): Stream.Stream<PhasedHtmlStreamInput, StartStreamError<E>, R> =>
  Stream.unwrap(
    toEffect(input).pipe(
      Effect.map((input) => Stream.make({ reason, input })),
      Effect.mapError((cause) => new StartStreamError({ reason, cause }))
    )
  );

const tailStream = <E, R>(
  options: HtmlStreamOptions<E, R>
): Stream.Stream<PhasedHtmlStreamInput, StartStreamError<E>, R> =>
  options.tail === undefined
    ? Stream.empty
    : streamFromEffectInput("Tail", options.tail);

/**
 * Builds a byte stream in shell -> chunks -> tail order.
 *
 * Hydration chunks without explicit sequence numbers are numbered in emission
 * order, so streamed clients can replay them deterministically.
 */
export const createHtmlStream = <E = never, R = never>(
  options: HtmlStreamOptions<E, R>
): Stream.Stream<Uint8Array, HtmlStreamEncodingError<E>, R> => {
  const shell = streamFromEffectInput("Shell", options.shell);
  const chunks = (options.chunks ?? Stream.empty).pipe(
    Stream.map((input): PhasedHtmlStreamInput => ({ reason: "Chunk", input })),
    Stream.mapError((cause) => new StartStreamError({ reason: "Chunk", cause }))
  );

  return shell.pipe(
    Stream.concat(chunks),
    Stream.concat(tailStream(options)),
    Stream.mapAccumEffect(() => 0, encodeInputWithHydrationSequenceEffect)
  );
};

/** Effect wrapper for `createHtmlStream(...)`. */
export const createHtmlStreamEffect = <E = never, R = never>(
  options: HtmlStreamOptions<E, R>
): Effect.Effect<Stream.Stream<Uint8Array, HtmlStreamEncodingError<E>, R>> =>
  Effect.succeed(createHtmlStream(options));

/** Converts a Start HTML byte stream into a platform `ReadableStream`. */
export const createReadableHtmlStreamEffect = <E = never, R = never>(
  options: HtmlStreamOptions<E, R>
): Effect.Effect<ReadableStream<Uint8Array>, never, R> =>
  Effect.flatMap(createHtmlStreamEffect(options), (stream) =>
    Stream.toReadableStreamEffect(stream)
  );

const htmlHeaders = (input: HeadersInit | undefined): Headers => {
  const headers = new Headers(input);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return headers;
};

/**
 * Creates a streaming HTML `Response`.
 *
 * The response body is a `ReadableStream`; the response itself is created
 * without failing, while stream failures are represented in the stream Effect.
 */
export const createHtmlResponseEffect = <E = never, R = never>(
  options: HtmlResponseOptions<E, R>
): Effect.Effect<Response, never, R> =>
  Effect.map(
    createReadableHtmlStreamEffect(options),
    (body) => {
      const init: ResponseInit = {
        headers: htmlHeaders(options.headers)
      };
      if (options.status !== undefined) {
        init.status = options.status;
      }

      return new Response(body, init);
    }
  );

/**
 * Creates a Start streaming HTML `Response` and appends route hydration chunks
 * from the render hydration plan before the tail.
 */
export const createStartStreamedHtmlResponseEffect = <E = never, R = never>(
  options: StartStreamedHtmlResponseOptions<E, R>
): Effect.Effect<Response, never, R> => {
  const {
    hydrationPlan,
    chunks,
    ...htmlOptions
  } = options;
  const hydrationChunks = hydrationPlan.streamedResourceChunks.map((payload) =>
    streamHydrationChunk(payload)
  );
  const responseChunks = hydrationChunks.length === 0
    ? chunks
    : chunks === undefined
      ? Stream.make(...hydrationChunks)
      : chunks.pipe(Stream.concat(Stream.make(...hydrationChunks)));
  return createHtmlResponseEffect({
    ...htmlOptions,
    ...(responseChunks === undefined ? {} : { chunks: responseChunks })
  });
};

/**
 * Wraps a Web `Response` body so a finalizer runs when the body closes,
 * errors, or is cancelled.
 *
 * Request/runtime modules use this Adapter to keep Web stream mechanics out of
 * lifecycle code while preserving the original response status and headers.
 */
export const responseWithStreamFinalizer = (
  response: Response,
  options: StartResponseStreamFinalizerOptions = {}
): Response => {
  if (!response.body) {
    return response;
  }

  const upstreamState = responseStreamFinalizerStates.get(response);
  const runEffect = options.runEffect ?? runResponseStreamEffect;
  const reader = response.body.getReader();
  let chunkCount = 0;
  let finalized = false;
  let readerCancelled = false;
  let abortRequested = false;
  let abortReason: unknown;
  let successSuspensions = 0;
  let pendingSuccess: StartResponseStreamFinalizeEvent | undefined;
  let cleanupAbortSignal = (): void => undefined;
  const runFinalize = (
    event: StartResponseStreamFinalizeEvent
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (finalized) {
        return Effect.void;
      }

      finalized = true;
      cleanupAbortSignal();
      return options.onFinalize === undefined
        ? Effect.void
        : options.onFinalize(event);
    });
  const finalize = (
    event: StartResponseStreamFinalizeEvent
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (event.status === "success" && successSuspensions > 0) {
        pendingSuccess = event;
        return Effect.void;
      }

      return runFinalize(event);
    });
  const cancelReaderEffect = (
    reason: unknown,
    options: { readonly ignoreFailure?: boolean } = {}
  ): Effect.Effect<void, unknown> =>
    Effect.suspend(() => {
      if (readerCancelled) {
        return Effect.void;
      }

      readerCancelled = true;
      const cancel = Effect.tryPromise({
        try: () => reader.cancel(reason),
        catch: (cause) => cause
      });
      return options.ignoreFailure === true
        ? cancel.pipe(Effect.catchCause(() => Effect.void))
        : cancel;
    });
  const abortFinalizeEvent = (): StartResponseStreamFinalizeEvent => ({
    stream: {
      name: "response",
      state: "cancelled",
      chunkCount
    },
    status: "cancelled",
    teardownReason: options.abortTeardownReason ?? (
      typeof abortReason === "string" ? abortReason : "request-abort"
    )
  });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const signal = options.abortSignal;
      if (signal === undefined) {
        return;
      }

      const abort = (): void => {
        const reason = signal.reason ?? "request-abort";
        abortRequested = true;
        abortReason = reason;
        void runEffect(
          cancelReaderEffect(reason, { ignoreFailure: true }).pipe(
            Effect.ensuring(finalize(abortFinalizeEvent())),
            Effect.ensuring(Effect.sync(() => {
              try {
                controller.error(reason);
              } catch {
                // The consumer may have already closed or cancelled the stream.
              }
            }))
          )
        );
      };
      cleanupAbortSignal = () => {
        signal.removeEventListener("abort", abort);
      };
      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener("abort", abort, { once: true });
      }
    },
    pull(controller) {
      return runEffect(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => reader.read(),
            catch: (cause) => cause
          });
          if (result.done) {
            if (abortRequested) {
              yield* finalize(abortFinalizeEvent());
              yield* Effect.sync(() => {
                try {
                  controller.error(abortReason ?? "request-abort");
                } catch {
                  // The abort listener may have already errored the stream.
                }
              });
              return;
            }

            yield* finalize({
              stream: {
                name: "response",
                state: "closed",
                chunkCount
              },
              status: "success",
              teardownReason: "stream-close"
            });
            yield* Effect.sync(() => {
              controller.close();
            });
            return;
          }

          yield* Effect.sync(() => {
            chunkCount += 1;
            controller.enqueue(result.value);
          });
        }).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              if (abortRequested) {
                yield* finalize(abortFinalizeEvent());
                yield* Effect.sync(() => {
                  controller.error(cause);
                });
                return;
              }

              const failurePhase = startStreamFailurePhase(cause);
              yield* finalize({
                stream: {
                  name: "response",
                  state: "errored",
                  chunkCount,
                  ...(failurePhase === undefined ? {} : { failurePhase })
                },
                status: "failure",
                failureKind: startStreamFailureKind(cause),
                teardownReason: "stream-error",
                ...(failurePhase === undefined ? {} : { failurePhase })
              });
              yield* Effect.sync(() => {
                controller.error(cause);
              });
            })
          )
        )
      );
    },
    cancel(reason) {
      return runEffect(
        cancelReaderEffect(reason).pipe(
          Effect.ensuring(
            finalize({
              stream: {
                name: "response",
                state: "cancelled",
                chunkCount
              },
              status: "cancelled",
              teardownReason: typeof reason === "string" ? reason : "stream-cancel"
            })
          )
        )
      );
    }
  });

  const wrapped = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
  responseStreamFinalizerStates.set(wrapped, {
    suspendSuccess: (effect, failureEvent) =>
      (upstreamState?.suspendSuccess.bind(upstreamState) ?? ((inner) => inner))(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            successSuspensions += 1;
            const exit = yield* Effect.exit(restore(effect));
            successSuspensions -= 1;

            if (Exit.isSuccess(exit)) {
              if (successSuspensions === 0 && pendingSuccess !== undefined) {
                const event = pendingSuccess;
                pendingSuccess = undefined;
                yield* runFinalize(event);
              }
              return exit.value;
            }

            if (successSuspensions === 0) {
              pendingSuccess = undefined;
              yield* runFinalize(resolveResponseStreamFailureEvent(failureEvent, exit));
            }
            return yield* Effect.failCause(exit.cause);
          })
        ),
        failureEvent
      )
  });

  return wrapped;
};
