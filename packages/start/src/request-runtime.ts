import {
  makeResourceStore,
  provideRequest,
  provideResponse,
  Server,
  ServerClient,
  withResourceStore,
  type AppDefinition,
  type EffectInput,
  type EffectUiRuntime,
  type ResponseContext,
  type Route
} from "@effect-ui/core";
import { Effect, Option, type Scope } from "effect";
import {
  invokeStartEffectInputCallbackEffect,
  requestRuntimeDisposeTraceEffect,
  type StartRequestTraceStatus,
  type StartRequestTraceStream,
  type StartRequestTraceTeardownSnapshot
} from "./request-trace.js";

export interface RequestRuntimeFinalizeState {
  readonly stream?: StartRequestTraceStream;
  readonly status: StartRequestTraceStatus;
  readonly teardownReason: string;
  readonly beforeDispose: StartRequestTraceTeardownSnapshot;
  readonly afterDispose: StartRequestTraceTeardownSnapshot;
  readonly completedAt: number;
}

export interface RequestRuntimeStreamFinalizeState extends RequestRuntimeFinalizeState {
  readonly stream: StartRequestTraceStream;
}

export const makeRequestRuntime = <
  Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>
): EffectUiRuntime<ServerServices, ServerError> =>
  withResourceStore(app.runtime, makeResourceStore());

export const provideLocalServerClient = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const client = yield* Effect.serviceOption(ServerClient);
    if (Option.isSome(client)) {
      return yield* effect;
    }

    return yield* Effect.provideService(effect, ServerClient, Server.localClient());
  });

export const provideRequestRuntime = <A, E, R, RuntimeServices, RuntimeError>(
  runtime: EffectUiRuntime<RuntimeServices, RuntimeError>,
  request: Request,
  effect: Effect.Effect<A, E, R>,
  responseContext: ResponseContext
): Effect.Effect<A, E | RuntimeError, Scope.Scope> =>
  runtime.provide(
    provideRequest(request)(
      provideResponse(responseContext)(provideLocalServerClient(effect))
    )
  );

const responseWithRuntimeFinalizer = <RuntimeError>(
  response: Response,
  runtime: EffectUiRuntime<unknown, RuntimeError>,
  options: {
    readonly onFinalize?: (state: RequestRuntimeStreamFinalizeState) => EffectInput<void, never, never>;
  } = {}
): Response => {
  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  let disposed = false;
  let chunkCount = 0;
  const disposeEffect = (
    stream: StartRequestTraceStream,
    status: StartRequestTraceStatus,
    teardownReason: string
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const shouldDispose = yield* Effect.sync(() => {
        if (disposed) {
          return false;
        }

        disposed = true;
        return true;
      });
      if (!shouldDispose) {
        return;
      }

      const teardown = yield* requestRuntimeDisposeTraceEffect(runtime);
      yield* invokeStartEffectInputCallbackEffect(options.onFinalize, {
        stream,
        status,
        teardownReason,
        ...teardown
      });
    });

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      return runtime.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => reader.read(),
            catch: (cause) => cause
          });
          if (result.done) {
            yield* disposeEffect(
              {
                name: "response",
                state: "closed",
                chunkCount
              },
              "success",
              "stream-close"
            );
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
              yield* disposeEffect(
                {
                  name: "response",
                  state: "errored",
                  chunkCount
                },
                "failure",
                "stream-error"
              );
              yield* Effect.sync(() => {
                controller.error(cause);
              });
            })
          )
        )
      );
    },
    cancel(reason) {
      return runtime.runPromise(
        Effect.tryPromise({
          try: () => reader.cancel(reason),
          catch: (cause) => cause
        }).pipe(
          Effect.ensuring(
            disposeEffect(
              {
                name: "response",
                state: "cancelled",
                chunkCount
              },
              "cancelled",
              typeof reason === "string" ? reason : "stream-cancel"
            )
          )
        )
      );
    }
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
};

export const completeRequestRuntimeWithResponse = <RuntimeError>(
  runtime: EffectUiRuntime<unknown, RuntimeError>,
  response: Response,
  options: {
    readonly onFinalize?: (state: RequestRuntimeFinalizeState) => EffectInput<void, never, never>;
    readonly onStreamFinalize?: (state: RequestRuntimeStreamFinalizeState) => EffectInput<void, never, never>;
  } = {}
): Effect.Effect<Response> =>
  response.body
    ? Effect.succeed(
        responseWithRuntimeFinalizer(
          response,
          runtime,
          options.onStreamFinalize === undefined
            ? {}
            : { onFinalize: options.onStreamFinalize }
        )
      )
    : Effect.gen(function* () {
        const teardown = yield* requestRuntimeDisposeTraceEffect(runtime);
        yield* invokeStartEffectInputCallbackEffect(options.onFinalize, {
          status: "success",
          teardownReason: "response-end",
          ...teardown
        });
        return response;
      });
