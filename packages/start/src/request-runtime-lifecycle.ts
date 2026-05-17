import {
  applyResponseContextEffect,
  type EffectInputCallbackError,
  type EffectUiRuntime,
  type ResponseContext,
} from "@effect-ui/core";
import { Cause, Effect, Exit } from "effect";
import {
  completeRequestRuntimeWithResponse,
  type RequestRuntimeFinalizeState,
} from "./request-runtime-response.js";
import {
  buildStartRequestTrace,
  emitStartRequestTraceEffect,
  finalizeStartRequestMetricsEffect,
  requestRuntimeDisposeTraceEffect,
  startRequestTraceTeardown,
  withStartRequestObservability,
  type StartRequestTraceFacts,
  type StartRequestTraceFailureKind,
  type StartRequestTraceHandler,
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
  interrupted: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const teardown = yield* requestRuntimeDisposeTraceEffect(options.runtime);
    yield* finalizeStartRequestMetricsEffect(options.request, options.traceFacts, {
      status: interrupted ? "cancelled" : "failure",
      completedAt: teardown.completedAt,
    });
    if (options.onRequestTrace !== undefined) {
      yield* emitStartRequestTraceEffect(
        options.onRequestTrace,
        buildStartRequestTrace(
          options.request,
          options.traceFacts,
          interrupted ? "cancelled" : "failure",
          {
            teardown: startRequestTraceTeardown(options.traceFacts, {
              reason: interrupted ? "interruption" : "request-failure",
              ...teardown,
            }),
          },
        ),
      );
    }
  });

const requestRuntimeFailureKind = (cause: Cause.Cause<unknown>): StartRequestTraceFailureKind =>
  cause.reasons.some(Cause.isInterruptReason)
    ? "interruption"
    : cause.reasons.some(Cause.isDieReason)
      ? "defect"
      : "domain";

const requestRuntimeFinalizeOptions = <RuntimeServices, RuntimeError>(
  options: Pick<
    RequestRuntimeLifecycleOptions<unknown, unknown, RuntimeServices, RuntimeError>,
    "request" | "traceFacts" | "onRequestTrace"
  >,
  response: Response,
) => ({
  onFinalize: (state: RequestRuntimeFinalizeState) =>
    Effect.gen(function* () {
      yield* finalizeStartRequestMetricsEffect(options.request, options.traceFacts, {
        status: state.status,
        completedAt: state.completedAt,
      });
      if (state.failureKind !== undefined) {
        options.traceFacts.failureKind = state.failureKind;
      }
      if (options.onRequestTrace !== undefined) {
        yield* emitStartRequestTraceEffect(
          options.onRequestTrace,
          buildStartRequestTrace(options.request, options.traceFacts, state.status, {
            response,
            teardown: startRequestTraceTeardown(options.traceFacts, {
              reason: state.teardownReason,
              runtimeDisposed: state.runtimeDisposed,
              beforeDispose: state.beforeDispose,
              afterDispose: state.afterDispose,
              completedAt: state.completedAt,
              ...(state.cleanupFailure === undefined
                ? {}
                : { cleanupFailure: state.cleanupFailure }),
            }),
            ...(state.stream === undefined ? {} : { stream: state.stream }),
          }),
        );
      }
    }),
});

/**
 * Runs a selected Start response Effect through Request Runtime lifecycle.
 *
 * Start Request Handler owns endpoint/render selection. This Module owns the
 * lifecycle around that selected response: failure teardown, ResponseContext
 * application, Request Runtime disposal, request trace emission, and streamed
 * response finalization.
 */
export const runRequestRuntimeLifecycleEffect = <E, R, RuntimeServices, RuntimeError>(
  options: RequestRuntimeLifecycleOptions<E, R, RuntimeServices, RuntimeError>,
): Effect.Effect<Response, E | EffectInputCallbackError, R> =>
  withStartRequestObservability(
    options.request,
    options.traceFacts,
    Effect.gen(function* () {
      const responseExit = yield* Effect.exit(
        Effect.flatMap(options.responseEffect, (response) =>
          applyResponseContextEffect(options.responseContext, response),
        ),
      );

      if (Exit.isFailure(responseExit)) {
        const failureKind = requestRuntimeFailureKind(responseExit.cause as Cause.Cause<unknown>);
        const interrupted = failureKind === "interruption";
        options.traceFacts.failureKind = failureKind;
        yield* emitRequestRuntimeFailureTraceEffect(options, interrupted);
        return yield* Effect.failCause(responseExit.cause);
      }

      const response = responseExit.value;
      return yield* completeRequestRuntimeWithResponse(
        options.runtime,
        response,
        requestRuntimeFinalizeOptions(options, response),
      );
    }),
  );
