import { ActionTransport, type Server, type Action } from "@sunfall/arc-core";
import { Effect, Exit, Layer, Option } from "effect";
import { executeStartClientTransport } from "./start-client-transport.js";
import {
  applyStartActionInvalidation,
  applyStartActionResponse,
} from "./start-action-response-application.js";
import {
  decodeStartActionOutcome,
  parseStartActionResponse,
} from "./start-action-response-codec.js";
import {
  encodeStartActionRequest,
  type StartActionDefinition,
} from "./start-action-request-codec.js";
import { resolveStartActionEndpoint } from "./start-transport-endpoints.js";
import type { StartActionClientOptions } from "./start-transport-protocol.js";

/**
 * Options for `makeActionTransportLayer`: the Actions the Start server serves,
 * plus action transport settings (endpoint, fetch, and headers).
 */
export interface ActionTransportLayerOptions<
  FetchError = never,
  FetchRequirements = never,
> extends StartActionClientOptions<FetchError, FetchRequirements> {
  /**
   * Actions the Start server serves (the same list given to the server app's
   * registry). Submissions of these Actions go over the network; every other
   * Action keeps running locally. Matched by name.
   */
  readonly actions: ReadonlyArray<StartActionDefinition>;
}

const submitRemoteEffect = <I, A, E, R, FetchError, FetchRequirements>(
  definition: Action.Definition<I, A, E, R>,
  input: I,
  submission: Action.TransportSubmission | undefined,
  options: ActionTransportLayerOptions<FetchError, FetchRequirements>,
): Effect.Effect<Action.TransportResponse<A, E>, Server.ClientError> => {
  const exchange = Effect.gen(function* () {
    const request = yield* encodeStartActionRequest(definition, input, submission?.id);
    const { body } = yield* executeStartClientTransport({
      kind: "action",
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      endpoint: resolveStartActionEndpoint(options),
      request,
      init: { redirect: "manual" },
      parseResponse: parseStartActionResponse,
    });
    const outcome = yield* decodeStartActionOutcome(definition, body);
    return { body, outcome };
  });
  const transported = (
    options.transportRuntime === undefined ? exchange : options.transportRuntime.provide(exchange)
  ) as Effect.Effect<Effect.Success<typeof exchange>, Server.ClientError>;
  return Effect.map(transported, ({ body, outcome }) => ({
    exit: outcome._tag === "Value" ? Exit.succeed(outcome.value) : Exit.fail(outcome.error),
    // Runs inside the Action workflow, which the submitting runtime provides.
    apply: (current) =>
      current ? applyStartActionResponse(body) : applyStartActionInvalidation(body),
  }));
};

/**
 * Layer that provides Start's `ActionTransport`: submissions of the Actions
 * the server serves run on the server, and their responses (hydrated
 * Resources, Resource invalidations) apply to the submitting
 * runtime. UI code is unchanged: the same `Component.action(...)` handle
 * submits locally or remotely, with the same result and error types (plus
 * `Server.ClientError` for transport failures).
 *
 * @example
 * ```ts
 * const runtime = makeRuntime(
 *   Layer.mergeAll(makeRpcClientLayer(), makeActionTransportLayer({ actions: [RenameProject] }), AppLive),
 * );
 * ```
 */
export function makeActionTransportLayer<FetchError = never>(
  options: ActionTransportLayerOptions<FetchError, never> & {
    readonly transportRuntime?: undefined;
  },
): Layer.Layer<ActionTransport>;
export function makeActionTransportLayer<FetchError = never, FetchRequirements = never>(
  options: ActionTransportLayerOptions<FetchError, FetchRequirements> & {
    readonly transportRuntime: NonNullable<
      ActionTransportLayerOptions<FetchError, FetchRequirements>["transportRuntime"]
    >;
  },
): Layer.Layer<ActionTransport>;
export function makeActionTransportLayer<FetchError = never, FetchRequirements = never>(
  options: ActionTransportLayerOptions<FetchError, FetchRequirements>,
): Layer.Layer<ActionTransport> {
  const served = new Set(options.actions.map((action) => action.name));
  return Layer.succeed(ActionTransport)({
    submit: (definition, input, submission) =>
      served.has(definition.name)
        ? Option.some(submitRemoteEffect(definition, input, submission, options))
        : Option.none(),
  });
}
