import {
  applyResponseContext,
  type EffectInputCallbackError,
  type SunfallArcRuntime,
  type ResponseContext,
} from "@sunfall/arc-core";
import { Cause, Effect, Exit } from "effect";
import { completeRequestRuntimeWithResponse } from "./request-runtime-response.js";
import {
  disposeRequestRuntime,
  finishStartRequest,
  recordStartRequestFailure,
  withStartRequestObservability,
  type StartRequestFacts,
} from "./request-trace.js";

export interface RequestRuntimeLifecycleOptions<E, R, RuntimeServices, RuntimeError> {
  readonly request: Request;
  readonly runtime: SunfallArcRuntime<RuntimeServices, RuntimeError>;
  readonly responseContext: ResponseContext;
  readonly facts: StartRequestFacts;
  readonly responseEffect: Effect.Effect<Response, E, R>;
}

/**
 * Runs a selected Start response Effect through Request Runtime lifecycle.
 *
 * Start Request Handler owns endpoint/render selection. This Module owns the
 * lifecycle around that selected response: ResponseContext application,
 * Request Runtime disposal (after a streamed body finishes), and ending the
 * request span.
 */
export const runRequestRuntimeLifecycle = <E, R, RuntimeServices, RuntimeError>(
  options: RequestRuntimeLifecycleOptions<E, R, RuntimeServices, RuntimeError>,
): Effect.Effect<Response, E | EffectInputCallbackError, R> => {
  const { request, facts } = options;
  return withStartRequestObservability(
    request,
    facts,
    Effect.gen(function* () {
      const responseExit = yield* Effect.exit(
        Effect.flatMap(options.responseEffect, (response) =>
          applyResponseContext(options.responseContext, response),
        ),
      );

      if (Exit.isFailure(responseExit)) {
        const interrupted = responseExit.cause.reasons.some(Cause.isInterruptReason);
        recordStartRequestFailure(
          facts,
          interrupted
            ? "interruption"
            : responseExit.cause.reasons.some(Cause.isDieReason)
              ? "defect"
              : "domain",
        );
        yield* finishStartRequest(request, facts, {
          status: interrupted ? "cancelled" : "failure",
          teardownReason: interrupted ? "interruption" : "request-failure",
          teardown: yield* disposeRequestRuntime(options.runtime),
          cause: responseExit.cause,
        });
        return yield* Effect.failCause(responseExit.cause);
      }

      const response = responseExit.value;
      return yield* completeRequestRuntimeWithResponse(options.runtime, response, (state) => {
        if (state.failureKind !== undefined) {
          recordStartRequestFailure(facts, state.failureKind);
        }
        return finishStartRequest(request, facts, { ...state, response });
      });
    }),
  );
};
