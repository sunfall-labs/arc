import { type EffectInput, type SunfallArcRuntime } from "@sunfall/arc-core";
import { Effect } from "effect";
import {
  invokeStartEffectInputCallback,
  requestRuntimeDisposeTrace,
  type StartRequestTraceCleanupFailure,
  type StartRequestTraceFailureKind,
  type StartRequestTraceStatus,
  type StartRequestTraceStream,
  type StartRequestTraceTeardownSnapshot,
} from "./request-trace.js";
import { responseWithStreamFinalizer, type StartResponseStreamFinalizeEvent } from "./streaming.js";

export interface RequestRuntimeFinalizeState {
  readonly stream?: StartRequestTraceStream;
  readonly status: StartRequestTraceStatus;
  readonly failureKind?: StartRequestTraceFailureKind;
  readonly teardownReason: string;
  readonly runtimeDisposed: boolean;
  readonly beforeDispose: StartRequestTraceTeardownSnapshot;
  readonly afterDispose: StartRequestTraceTeardownSnapshot;
  readonly completedAt: number;
  readonly cleanupFailure?: StartRequestTraceCleanupFailure;
}

export interface RequestRuntimeStreamFinalizeState extends RequestRuntimeFinalizeState {
  readonly stream: StartRequestTraceStream;
}

const requestRuntimeStreamFinalizer = <RuntimeServices, RuntimeError>(
  runtime: SunfallArcRuntime<RuntimeServices, RuntimeError>,
  options: {
    readonly onFinalize?: (state: RequestRuntimeFinalizeState) => EffectInput<void, never, never>;
  },
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
        ...(yield* requestRuntimeDisposeTrace(runtime)),
        stream: event.stream,
        status: event.status,
        ...(event.failureKind === undefined ? {} : { failureKind: event.failureKind }),
        teardownReason: event.teardownReason,
      };
      yield* invokeStartEffectInputCallback(options.onFinalize, state);
    });
};

export const completeRequestRuntimeWithResponse = <RuntimeServices, RuntimeError>(
  runtime: SunfallArcRuntime<RuntimeServices, RuntimeError>,
  response: Response,
  options: {
    /** Runs once the request runtime is disposed; stream responses populate `stream`. */
    readonly onFinalize?: (state: RequestRuntimeFinalizeState) => EffectInput<void, never, never>;
  } = {},
): Effect.Effect<Response> =>
  response.body
    ? Effect.succeed(
        responseWithStreamFinalizer(response, {
          runEffect: (effect) => Effect.runPromise(runtime.provide(effect)),
          onFinalize: requestRuntimeStreamFinalizer(runtime, options),
        }),
      )
    : Effect.gen(function* () {
        const teardown = yield* requestRuntimeDisposeTrace(runtime);
        yield* invokeStartEffectInputCallback(options.onFinalize, {
          status: "success",
          teardownReason: "response-end",
          ...teardown,
        });
        return response;
      });
