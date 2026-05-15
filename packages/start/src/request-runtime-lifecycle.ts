import {
  applyResponseContext,
  type EffectUiRuntime,
  type ResponseContext
} from "@effect-ui/core";
import { Cause, Effect, Exit } from "effect";
import {
  completeRequestRuntimeWithResponse,
  type RequestRuntimeFinalizeState
} from "./request-runtime-response.js";
import {
  buildStartRequestTrace,
  emitStartRequestTraceEffect,
  requestRuntimeDisposeTraceEffect,
  startRequestTraceTeardown,
  withStartRequestObservability,
  type StartRequestTraceFacts,
  type StartRequestTraceHandler
} from "./request-trace.js";

export interface RequestRuntimeLifecycleOptions<E, R, RuntimeServices, RuntimeError> {
  readonly request: Request;
  readonly runtime: EffectUiRuntime<RuntimeServices, RuntimeError>;
  readonly responseContext: ResponseContext;
  readonly traceFacts: StartRequestTraceFacts;
  readonly responseEffect: Effect.Effect<Response, E, R>;
  readonly onRequestTrace?: StartRequestTraceHandler;
}

const emitRequestRuntimeFailureTraceEffect = <RuntimeServices, RuntimeError>(
  options: Pick<
    RequestRuntimeLifecycleOptions<unknown, unknown, RuntimeServices, RuntimeError>,
    "request" | "runtime" | "traceFacts" | "onRequestTrace"
  >,
  interrupted: boolean
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const teardown = yield* requestRuntimeDisposeTraceEffect(options.runtime);
    if (options.onRequestTrace !== undefined) {
      yield* emitStartRequestTraceEffect(
        options.onRequestTrace,
        buildStartRequestTrace(options.request, options.traceFacts, interrupted ? "cancelled" : "failure", {
          teardown: startRequestTraceTeardown(options.traceFacts, {
            runtimeDisposed: true,
            reason: interrupted ? "interruption" : "request-failure",
            ...teardown
          })
        })
      );
    }
  });

const requestRuntimeFinalizeOptions = <RuntimeServices, RuntimeError>(
  options: Pick<
    RequestRuntimeLifecycleOptions<unknown, unknown, RuntimeServices, RuntimeError>,
    "request" | "traceFacts" | "onRequestTrace"
  >,
  response: Response
) =>
  options.onRequestTrace === undefined
    ? {}
    : {
        onFinalize: (state: RequestRuntimeFinalizeState) =>
          emitStartRequestTraceEffect(
            options.onRequestTrace,
            buildStartRequestTrace(options.request, options.traceFacts, state.status, {
              response,
              teardown: startRequestTraceTeardown(options.traceFacts, {
                runtimeDisposed: true,
                reason: state.teardownReason,
                beforeDispose: state.beforeDispose,
                afterDispose: state.afterDispose,
                completedAt: state.completedAt
              }),
              ...(state.stream === undefined ? {} : { stream: state.stream })
            })
          )
      };

/**
 * Runs a selected Start response Effect through Request Runtime lifecycle.
 *
 * Start Request Handler owns endpoint/render selection. This Module owns the
 * lifecycle around that selected response: failure teardown, ResponseContext
 * application, Request Runtime disposal, request trace emission, and streamed
 * response finalization.
 */
export const runRequestRuntimeLifecycleEffect = <E, R, RuntimeServices, RuntimeError>(
  options: RequestRuntimeLifecycleOptions<E, R, RuntimeServices, RuntimeError>
): Effect.Effect<Response, E, R> =>
  withStartRequestObservability(
    options.request,
    options.traceFacts,
    Effect.gen(function* () {
      const responseExit = yield* Effect.exit(options.responseEffect);

      if (Exit.isFailure(responseExit)) {
        const interrupted = responseExit.cause.reasons.some(Cause.isInterruptReason);
        if (interrupted) {
          options.traceFacts.failureKind = "interruption";
        }
        yield* emitRequestRuntimeFailureTraceEffect(options, interrupted);
        return yield* Effect.failCause(responseExit.cause);
      }

      const response = applyResponseContext(options.responseContext, responseExit.value);
      return yield* completeRequestRuntimeWithResponse(
        options.runtime,
        response,
        requestRuntimeFinalizeOptions(options, response)
      );
    })
  );
