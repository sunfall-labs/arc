import type { SunfallArcRuntime } from "@sunfall/arc-core";
import { Effect } from "effect";
import {
  disposeRequestRuntime,
  type StartRequestFailureKind,
  type StartRequestStatus,
  type StartRequestStream,
  type StartRequestTeardown,
} from "./request-trace.js";
import { completeResponseBytes, responseWithStreamFinalizer } from "./streaming.js";

export interface RequestRuntimeFinalizeState {
  readonly status: StartRequestStatus;
  readonly failureKind?: StartRequestFailureKind;
  readonly teardownReason: string;
  readonly teardown: StartRequestTeardown;
  readonly stream?: StartRequestStream;
}

/**
 * Disposes the request runtime once the response is done: immediately for a
 * bodiless or complete (`completeResponse`) response, or when a streamed body
 * closes, errors, or is cancelled.
 * `onFinalize` runs once after disposal; its failures are ignored.
 */
export const completeRequestRuntimeWithResponse = <RuntimeServices, RuntimeError>(
  runtime: SunfallArcRuntime<RuntimeServices, RuntimeError>,
  response: Response,
  onFinalize: (state: RequestRuntimeFinalizeState) => Effect.Effect<void> = () => Effect.void,
): Effect.Effect<Response> => {
  const finalize = (state: Omit<RequestRuntimeFinalizeState, "teardown">) =>
    Effect.flatMap(disposeRequestRuntime(runtime), (teardown) =>
      Effect.suspend(() => onFinalize({ ...state, teardown })).pipe(
        Effect.catchCause(() => Effect.void),
      ),
    );
  // Nothing left to produce: a bodiless or complete response releases the
  // runtime now instead of when a host finishes reading it.
  if (!response.body || completeResponseBytes(response) !== undefined) {
    return Effect.as(finalize({ status: "success", teardownReason: "response-end" }), response);
  }
  let finalized = false;
  return Effect.succeed(
    responseWithStreamFinalizer(response, {
      runEffect: (effect) => Effect.runPromise(runtime.provide(effect)),
      onFinalize: (event) =>
        Effect.suspend(() => {
          if (finalized) {
            return Effect.void;
          }
          finalized = true;
          return finalize({
            stream: event.stream,
            status: event.status,
            ...(event.failureKind === undefined ? {} : { failureKind: event.failureKind }),
            teardownReason: event.teardownReason,
          });
        }),
    }),
  );
};
