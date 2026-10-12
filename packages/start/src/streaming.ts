import { Effect, Exit } from "effect";
import type {
  StartRequestFailureKind,
  StartRequestStatus,
  StartRequestStream,
} from "./request-trace.js";

/** Stream lifecycle event emitted while adapting a Web `Response` body. */
export interface StartResponseStreamFinalizeEvent {
  /** Stream fact recorded on the request span and for host diagnostics. */
  readonly stream: StartRequestStream;
  /** Final request status implied by stream close, error, or cancellation. */
  readonly status: StartRequestStatus;
  /** Failure category when the stream finalized because of an error. */
  readonly failureKind?: StartRequestFailureKind;
  /** Stable teardown reason such as `stream-close`, `stream-error`, or a cancel reason. */
  readonly teardownReason: string;
}

/** Effect finalizer invoked once when a wrapped response body ends. */
export type StartResponseStreamFinalizer = (
  event: StartResponseStreamFinalizeEvent,
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
  effect: Effect.Effect<A, E>,
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
    failureEvent: StartResponseStreamFinalizeFailureEvent<A, E>,
  ) => Effect.Effect<A, E, R>;
}

const resolveResponseStreamFailureEvent = <A, E>(
  failureEvent: StartResponseStreamFinalizeFailureEvent<A, E>,
  exit: Exit.Exit<A, E>,
): StartResponseStreamFinalizeEvent =>
  typeof failureEvent === "function" ? failureEvent(exit) : failureEvent;

const responseStreamFinalizerStates = new WeakMap<Response, StartResponseStreamFinalizerState>();

/**
 * Runs host response work while holding a successful stream finalizer.
 *
 * Dev SSR uses this when it must fully read a Start HTML response before
 * applying host transforms. If the host work fails after the body has been
 * consumed, the held success finalizer is replaced with the supplied failure
 * event so request spans do not report premature success.
 */
export const suspendResponseStreamSuccessFinalizer = <A, E, R>(
  response: Response,
  effect: Effect.Effect<A, E, R>,
  failureEvent: StartResponseStreamFinalizeFailureEvent<A, E>,
): Effect.Effect<A, E, R> => {
  const state = responseStreamFinalizerStates.get(response);
  return state === undefined ? effect : state.suspendSuccess(effect, failureEvent);
};

const textEncoder = new TextEncoder();
const runResponseStreamEffect: StartResponseStreamRunner = (effect) => Effect.runPromise(effect);

/** The bytes of complete bodies, by body stream (which `new Response(body, init)` keeps). */
const completeBodies = new WeakMap<ReadableStream<Uint8Array>, Uint8Array>();

/**
 * A response whose whole body is known when it is created, like a fully
 * rendered document. Its body is a one-chunk stream, so Fetch hosts read it
 * as usual, and Start's own adapters skip the stream: the request runtime is
 * released at once, and the Node adapter writes the bytes in one `end`.
 * Re-wrapping it (`new Response(response.body, init)`) keeps it complete.
 */
export const completeResponse = (body: string, init: ResponseInit): Response => {
  const bytes = textEncoder.encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  completeBodies.set(stream, bytes);
  return new Response(stream, init);
};

/** The bytes of a `completeResponse` body, unless it is a stream still to be read. */
export const completeResponseBytes = (response: Response): Uint8Array | undefined =>
  response.body === null || response.bodyUsed ? undefined : completeBodies.get(response.body);

/**
 * Wraps a Web `Response` body so a finalizer runs when the body closes,
 * errors, or is cancelled.
 *
 * Request/runtime modules use this Adapter to keep Web stream mechanics out of
 * lifecycle code while preserving the original response status and headers.
 */
export const responseWithStreamFinalizer = (
  response: Response,
  options: StartResponseStreamFinalizerOptions = {},
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
  const runFinalize = (event: StartResponseStreamFinalizeEvent): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (finalized) {
        return Effect.void;
      }

      finalized = true;
      cleanupAbortSignal();
      return options.onFinalize === undefined ? Effect.void : options.onFinalize(event);
    });
  const finalize = (event: StartResponseStreamFinalizeEvent): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (event.status === "success" && successSuspensions > 0) {
        pendingSuccess = event;
        return Effect.void;
      }

      return runFinalize(event);
    });
  const cancelReaderEffect = (
    reason: unknown,
    options: { readonly ignoreFailure?: boolean } = {},
  ): Effect.Effect<void, unknown> =>
    Effect.suspend(() => {
      if (readerCancelled) {
        return Effect.void;
      }

      readerCancelled = true;
      const cancel = Effect.tryPromise({
        try: () => reader.cancel(reason),
        catch: (cause) => cause,
      });
      return options.ignoreFailure === true
        ? cancel.pipe(Effect.catchCause(() => Effect.void))
        : cancel;
    });
  const abortFinalizeEvent = (): StartResponseStreamFinalizeEvent => ({
    stream: {
      name: "response",
      state: "cancelled",
      chunkCount,
    },
    status: "cancelled",
    teardownReason:
      options.abortTeardownReason ??
      (typeof abortReason === "string" ? abortReason : "request-abort"),
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
            Effect.ensuring(
              Effect.sync(() => {
                try {
                  controller.error(reason);
                } catch {
                  // The consumer may have already closed or cancelled the stream.
                }
              }),
            ),
          ),
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
            catch: (cause) => cause,
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
                chunkCount,
              },
              status: "success",
              teardownReason: "stream-close",
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

              yield* finalize({
                stream: {
                  name: "response",
                  state: "errored",
                  chunkCount,
                },
                status: "failure",
                failureKind: "transport",
                teardownReason: "stream-error",
              });
              yield* Effect.sync(() => {
                controller.error(cause);
              });
            }),
          ),
        ),
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
                chunkCount,
              },
              status: "cancelled",
              teardownReason: typeof reason === "string" ? reason : "stream-cancel",
            }),
          ),
        ),
      );
    },
  });

  const wrapped = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
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
          }),
        ),
        failureEvent,
      ),
  });

  return wrapped;
};
