import {
  Server,
  ServerRpcProtocolError,
  applyResponseContext,
  type EffectInputCallbackError,
  makeResponseContext,
  type AnySunfallArcRuntime,
  type SunfallArcRuntime,
  type Route,
  type ResponseContext,
  type Action,
} from "@sunfall/arc-core";
import {
  decodeServerWire,
  makeActionInstance,
  type AppDefinitionRegistry,
  type AppDefinitionRegistryActionRequirements,
  type AppDefinitionRegistryServerFunctionRequirements,
  type ActionDefinitionRequirements,
} from "@sunfall/arc-core/internal";
import { Cause, Effect, Exit, type Scope } from "effect";
import { ensureRequestSubmitterOwner } from "./start-action-submitter.js";
import {
  makeStartActionWorkflows,
  runActionSubmissionWorkflow,
  type StartActionWorkflows,
} from "./start-action-workflow.js";
import type { StartServerApp } from "./start-server-app.js";
import { validateStartActionRequest, validateStartRpcRequest } from "./rpc.js";
import { makeRequestRuntime, type RequestRuntimeRemainingRequirements } from "./request-runtime.js";
import {
  recordStartRequestFailure,
  withStartActionObservability,
  withStartRpcObservability,
  type StartRequestFacts,
} from "./request-trace.js";
import {
  actionExitResponse,
  actionFunctionNotFoundResponse,
  actionProtocolFailureResponse,
  actionResponseMeta,
  actionResponseMode,
  actionRuntimeFailureResponse,
  actionTransportRequestFailureResponse,
} from "./start-action-response-codec.js";
import {
  actionFailureKind,
  exitToRpcResponse,
  functionNotFoundResponse,
  makeActionMap,
  protocolFailureResponse,
  readRequestJson,
  rpcFailureKind,
  rpcRuntimeFailureResponse,
  rpcTransportRequestFailureResponse,
} from "./start-transport-protocol.js";
import type { StartActionSource } from "./start-transport-protocol.js";
import {
  readStartActionRequest,
  type StartActionDefinition,
} from "./start-action-request-codec.js";
import { runStartTransportEndpoint } from "./start-transport-endpoint-runner.js";

export const createServerRpcResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
>(
  app: StartServerApp<Routes, ServerServices, ServerError, Registry>,
  request: Request,
  runtime: SunfallArcRuntime<ServerServices, ServerError>,
  responseContext: ResponseContext = makeResponseContext(),
  facts?: StartRequestFacts,
): Effect.Effect<
  Response,
  never,
  | Scope.Scope
  | RequestRuntimeRemainingRequirements<
      AppDefinitionRegistryServerFunctionRequirements<Registry>,
      ServerServices
    >
> => {
  return runStartTransportEndpoint({
    request,
    runtime,
    responseContext,
    registry: app.registry,
    ...(facts === undefined ? {} : { facts }),
    adapter: {
      kind: "rpc",
      validateRequest: validateStartRpcRequest,
      transportFailureResponse: rpcTransportRequestFailureResponse,
      runtimeFailureResponse: rpcRuntimeFailureResponse,
      run: () =>
        Effect.gen(function* () {
          const payload = yield* readRequestJson(request).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                recordStartRequestFailure(facts, "protocol");
                return protocolFailureResponse(error);
              }),
            ),
          );
          if (payload instanceof Response) {
            return payload;
          }

          const decoded = yield* Server.decodeRpcRequest(payload).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                recordStartRequestFailure(facts, "protocol");
                return protocolFailureResponse(
                  new ServerRpcProtocolError({
                    message: error.message,
                    payload: Server.serializeDefect(error),
                  }),
                );
              }),
            ),
          );
          if (decoded instanceof Response) {
            return decoded;
          }

          const fn = app.registry.serverFunctions.get(decoded.name);
          if (!fn) {
            recordStartRequestFailure(facts, "protocol");
            return functionNotFoundResponse(decoded.name);
          }

          const exit = yield* Effect.exit(
            withStartRpcObservability(decoded.name, fn.invoke(decoded.input)),
          );
          if (Exit.isFailure(exit)) {
            recordStartRequestFailure(facts, yield* rpcFailureKind(fn, exit));
          }
          return yield* exitToRpcResponse(fn, exit);
        }),
    },
  }) as Effect.Effect<
    Response,
    never,
    | Scope.Scope
    | RequestRuntimeRemainingRequirements<
        AppDefinitionRegistryServerFunctionRequirements<Registry>,
        ServerServices
      >
  >;
};

/**
 * Handles one server-function RPC request and encodes the protocol response.
 *
 * This is the low-level RPC endpoint handler. Most applications use
 * `createRequestHandler`, which routes RPC, actions, and SSR together.
 */
export const createServerRpcResponse = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
>(
  app: StartServerApp<Routes, ServerServices, ServerError, Registry>,
  request: Request,
): Effect.Effect<
  Response,
  EffectInputCallbackError,
  | Scope.Scope
  | RequestRuntimeRemainingRequirements<
      AppDefinitionRegistryServerFunctionRequirements<Registry>,
      ServerServices
    >
> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.flatMap(
      createServerRpcResponseEffectWithRuntime(app, request, runtime, responseContext),
      (response) => applyResponseContext(responseContext, response),
    ),
    runtime.dispose.pipe(Effect.catchCause(() => Effect.void)),
  ) as Effect.Effect<
    Response,
    EffectInputCallbackError,
    | Scope.Scope
    | RequestRuntimeRemainingRequirements<
        AppDefinitionRegistryServerFunctionRequirements<Registry>,
        ServerServices
      >
  >;
};

export const createServerActionResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition = never,
>(
  app: StartServerApp<Routes, ServerServices, ServerError, Registry>,
  request: Request,
  runtime: SunfallArcRuntime<ServerServices, ServerError>,
  actions?: StartActionSource<Actions>,
  responseContext: ResponseContext = makeResponseContext(),
  facts?: StartRequestFacts,
  workflows: StartActionWorkflows = makeStartActionWorkflows(),
): Effect.Effect<
  Response,
  never,
  | Scope.Scope
  | RequestRuntimeRemainingRequirements<
      AppDefinitionRegistryActionRequirements<Registry> | ActionDefinitionRequirements<Actions>,
      ServerServices
    >
> => {
  return runStartTransportEndpoint({
    request,
    runtime,
    responseContext,
    registry: app.registry,
    ...(facts === undefined ? {} : { facts }),
    adapter: {
      kind: "action",
      validateRequest: validateStartActionRequest,
      transportFailureResponse: actionTransportRequestFailureResponse,
      runtimeFailureResponse: actionRuntimeFailureResponse,
      run: () =>
        Effect.gen(function* () {
          const decoded = yield* readStartActionRequest(request).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                recordStartRequestFailure(facts, "protocol");
                return actionProtocolFailureResponse(error);
              }),
            ),
          );
          if (decoded instanceof Response) {
            return decoded;
          }

          const actionMap = yield* Effect.try({
            try: () => makeActionMap(actions, app.registry),
            catch: (error) => error,
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                recordStartRequestFailure(facts, "defect");
                return actionRuntimeFailureResponse(error);
              }),
            ),
          );
          if (actionMap instanceof Response) {
            return actionMap;
          }

          const action = actionMap.get(decoded.name);
          if (!action) {
            recordStartRequestFailure(facts, "protocol");
            return actionFunctionNotFoundResponse(decoded.name);
          }

          const produce = Effect.gen(function* () {
            const input = yield* decodeServerWire(action.input, decoded.input).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  recordStartRequestFailure(facts, "validation");
                  return actionProtocolFailureResponse(
                    new ServerRpcProtocolError({
                      message: error.message,
                      payload: Server.serializeDefect(error),
                    }),
                  );
                }),
              ),
            );
            if (input instanceof Response) {
              return input;
            }

            // The request runtime is already running this endpoint, so it adds
            // no startup failures to the submission.
            // The endpoint runs the Action locally and skips `optimistic`: only
            // the submitting client applies it.
            const instance = makeActionInstance(
              action as unknown as Action.Definition<any, any, never, any>,
              runtime as unknown as AnySunfallArcRuntime<never>,
              "endpoint",
            );
            const exit = yield* Effect.exit(
              withStartActionObservability(action.name, instance.submit(input)),
            );
            const failureKind = yield* actionFailureKind(action, exit);
            const metaExit = yield* Effect.exit(
              actionResponseMeta(instance.invalidationPlan.get()),
            );
            if (Exit.isFailure(metaExit)) {
              const metaInterrupted = metaExit.cause.reasons.some(Cause.isInterruptReason);
              const metaFailureKind =
                failureKind === "interruption" || metaInterrupted ? "interruption" : "defect";
              recordStartRequestFailure(facts, metaFailureKind);
              if (failureKind === "interruption") {
                return yield* actionExitResponse(action, exit, {}, actionResponseMode(request));
              }
              if (metaInterrupted) {
                return yield* Effect.failCause(metaExit.cause);
              }
              return actionRuntimeFailureResponse(Cause.squash(metaExit.cause));
            }
            const response = yield* actionExitResponse(
              action,
              exit,
              metaExit.value,
              actionResponseMode(request),
            );
            const responseFailureKind =
              failureKind === "interruption" || response.status < 500 ? failureKind : "defect";
            if (responseFailureKind !== undefined) {
              recordStartRequestFailure(facts, responseFailureKind);
            }
            return response;
          });
          const durable = action.durable;
          if (decoded.id === undefined || durable === undefined) {
            return yield* produce;
          }
          // A durable submission runs as a Workflow execution keyed by its
          // submitter and id: the same browser replaying the id gets the
          // recorded response without running the Action again; a request
          // from any other browser starts its own execution.
          const owner = yield* ensureRequestSubmitterOwner(request, responseContext);
          return yield* runActionSubmissionWorkflow(
            workflows,
            runtime as unknown as AnySunfallArcRuntime<unknown>,
            { name: action.name, durable },
            { owner, id: decoded.id, input: decoded.input },
            produce,
          );
        }),
    },
  }) as Effect.Effect<
    Response,
    never,
    | Scope.Scope
    | RequestRuntimeRemainingRequirements<
        AppDefinitionRegistryActionRequirements<Registry> | ActionDefinitionRequirements<Actions>,
        ServerServices
      >
  >;
};

/**
 * Handles one Start action request and encodes the protocol response.
 *
 * Accepts JSON action requests and progressively enhanced form posts. The
 * returned Effect runs the action inside a fresh request runtime and includes
 * hydration or invalidation metadata when needed.
 */
export const createServerActionResponse = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition = never,
>(
  app: StartServerApp<Routes, ServerServices, ServerError, Registry>,
  request: Request,
  actions?: Iterable<Actions>,
): Effect.Effect<
  Response,
  EffectInputCallbackError,
  | Scope.Scope
  | RequestRuntimeRemainingRequirements<
      AppDefinitionRegistryActionRequirements<Registry> | ActionDefinitionRequirements<Actions>,
      ServerServices
    >
> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.flatMap(
      createServerActionResponseEffectWithRuntime(app, request, runtime, actions, responseContext),
      (response) => applyResponseContext(responseContext, response),
    ),
    runtime.dispose.pipe(Effect.catchCause(() => Effect.void)),
  ) as Effect.Effect<
    Response,
    EffectInputCallbackError,
    | Scope.Scope
    | RequestRuntimeRemainingRequirements<
        AppDefinitionRegistryActionRequirements<Registry> | ActionDefinitionRequirements<Actions>,
        ServerServices
      >
  >;
};
