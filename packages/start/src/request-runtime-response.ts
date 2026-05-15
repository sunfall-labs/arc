import {
  type EffectInput,
  type EffectUiRuntime
} from "@effect-ui/core";
import { Effect } from "effect";
import {
  invokeStartEffectInputCallbackEffect,
  requestRuntimeDisposeTraceEffect,
  type StartRequestTraceStatus,
  type StartRequestTraceStream,
  type StartRequestTraceTeardownSnapshot
} from "./request-trace.js";
import {
  responseWithStreamFinalizer,
  type StartResponseStreamFinalizeEvent
} from "./streaming.js";

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

const requestRuntimeStreamFinalizer = <RuntimeServices, RuntimeError>(
  runtime: EffectUiRuntime<RuntimeServices, RuntimeError>,
  options: {
    readonly onFinalize?: (state: RequestRuntimeFinalizeState) => EffectInput<void, never, never>;
    readonly onStreamFinalize?: (state: RequestRuntimeStreamFinalizeState) => EffectInput<void, never, never>;
  }
): ((event: StartResponseStreamFinalizeEvent) => Effect.Effect<void>) => {
  let disposed = false;

  return (event) =>
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

      const state: RequestRuntimeStreamFinalizeState = {
        ...(yield* requestRuntimeDisposeTraceEffect(runtime)),
        stream: event.stream,
        status: event.status,
        teardownReason: event.teardownReason
      };
      yield* invokeStartEffectInputCallbackEffect(
        options.onStreamFinalize ?? options.onFinalize,
        state
      );
    });
};

export const completeRequestRuntimeWithResponse = <RuntimeServices, RuntimeError>(
  runtime: EffectUiRuntime<RuntimeServices, RuntimeError>,
  response: Response,
  options: {
    readonly onFinalize?: (state: RequestRuntimeFinalizeState) => EffectInput<void, never, never>;
    /**
     * @deprecated Use `onFinalize`; stream responses now emit the same finalization state
     * shape with `stream` populated.
     */
    readonly onStreamFinalize?: (state: RequestRuntimeStreamFinalizeState) => EffectInput<void, never, never>;
  } = {}
): Effect.Effect<Response> =>
  response.body
    ? Effect.succeed(
        responseWithStreamFinalizer(response, {
          runEffect: (effect) => Effect.runPromise(runtime.provide(effect)),
          onFinalize: requestRuntimeStreamFinalizer(runtime, options)
        })
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
