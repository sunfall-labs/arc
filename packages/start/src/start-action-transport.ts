import { ActionTransport, ActionTransportError, type Action } from "@sunfall/arc-core";
import { Effect, Exit, Layer, Option } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  applyStartActionInvalidation,
  applyStartActionResponse,
  decodeStartActionOutcome,
  parseStartActionResponse,
} from "./start-action-response-codec.js";
import {
  encodeStartActionRequest,
  type StartActionDefinition,
} from "./start-action-request-codec.js";
import { serverActionPath } from "./rpc.js";

/** Options for `makeActionTransportLayer`: the Actions the Start server serves. */
export interface ActionTransportLayerOptions {
  /**
   * Actions the Start server serves (the same list given to the server app's
   * registry). Submissions of these Actions go over the network; every other
   * Action keeps running locally. Matched by name.
   */
  readonly actions: ReadonlyArray<StartActionDefinition>;
}

const submitRemoteEffect = <I, A, E, R>(
  client: HttpClient.HttpClient,
  definition: Action.Definition<I, A, E, R>,
  input: I,
  submission: Action.TransportSubmission | undefined,
): Effect.Effect<Action.TransportResponse<A, E>, Action.ClientError> =>
  Effect.gen(function* () {
    const request = yield* encodeStartActionRequest(definition, input, submission?.id);
    const response = yield* HttpClientRequest.post(serverActionPath).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJsonUnsafe(request),
      client.execute,
      // A JSON submission answers redirects in the body; never follow one.
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.mapError(
        (cause) =>
          new ActionTransportError({
            reason: "Network",
            message: "Start action request failed.",
            cause,
          }),
      ),
    );
    const body = yield* parseStartActionResponse(response);
    const outcome = yield* decodeStartActionOutcome(definition, body);
    return {
      exit: outcome._tag === "Value" ? Exit.succeed(outcome.value) : Exit.fail(outcome.error),
      // Runs inside the Action workflow, which the submitting runtime provides.
      apply: (current: boolean) =>
        current ? applyStartActionResponse(body) : applyStartActionInvalidation(body),
    };
  });

/**
 * Layer that provides Start's `ActionTransport` over the runtime's
 * `HttpClient` (the same client the server-function `RpcClient` uses):
 * submissions of the Actions the server serves run on the server, and their
 * responses (hydrated Resources, Resource invalidations) apply to the
 * submitting runtime. UI code is unchanged: the same `Component.action(...)`
 * handle submits locally or remotely, with the same result and error types
 * (plus `Action.ClientError` for transport failures).
 */
export const makeActionTransportLayer = (
  options: ActionTransportLayerOptions,
): Layer.Layer<ActionTransport, never, HttpClient.HttpClient> => {
  const served = new Set(options.actions.map((action) => action.name));
  return Layer.effect(ActionTransport)(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return ActionTransport.of({
        submit: (definition, input, submission) =>
          served.has(definition.name)
            ? Option.some(submitRemoteEffect(client, definition, input, submission))
            : Option.none(),
      });
    }),
  );
};
