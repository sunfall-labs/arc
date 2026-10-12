import {
  ActionProtocolError,
  applyResponseContext,
  type EffectInputCallbackError,
  makeResponseContext,
  type AnySunfallArcRuntime,
  type SunfallArcRuntime,
  type Route,
  type ResponseContext,
  type Action,
  type Server,
} from "@sunfall/arc-core";
import {
  decodeActionWire,
  makeActionInstance,
  type AppDefinitionRegistry,
  type AppDefinitionRegistryActionRequirements,
  type AppDefinitionRegistryServerFunctionRequirements,
  type ActionDefinitionRequirements,
} from "@sunfall/arc-core/internal";
import { Cause, Effect, Exit, Schema, type Scope } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { RpcGroup, RpcSerialization, RpcServer, type Rpc } from "effect/rpc";
import { ensureRequestSubmitterOwner } from "./start-action-submitter.js";
import {
  makeStartActionWorkflows,
  runActionSubmissionWorkflow,
  type StartActionWorkflows,
} from "./start-action-workflow.js";
import type { StartServerApp } from "./start-server-app.js";
import {
  hasContentType,
  startJsonMediaType,
  validateStartActionRequest,
  validateStartRpcRequest,
  type StartTransportRequestError,
} from "./rpc.js";
import { makeRequestRuntime, type RequestRuntimeRemainingRequirements } from "./request-runtime.js";
import {
  recordStartRequestFailure,
  withStartActionObservability,
  withStartRpcObservability,
  type StartRequestFacts,
  type StartRequestFailureKind,
} from "./request-trace.js";
import {
  actionExitResponse,
  actionFailureKind,
  actionFunctionNotFoundResponse,
  actionProtocolFailureResponse,
  actionResponseMeta,
  actionResponseMode,
  actionRuntimeFailureResponse,
  actionTransportRequestFailureResponse,
} from "./start-action-response-codec.js";
import {
  makeActionMap,
  serializeDefect,
  readStartActionRequest,
  startActionFormInput,
  type StartActionDefinition,
  type StartActionSource,
} from "./start-action-request-codec.js";
import { runStartTransportEndpoint } from "./start-transport-endpoint-runner.js";

type AnyServerFunction = Server.Fn<any, any, any, any>;

const rpcFailureKind = (
  fn: AnyServerFunction,
  exit: Exit.Exit<unknown, unknown>,
): StartRequestFailureKind | undefined => {
  if (Exit.isSuccess(exit)) {
    return undefined;
  }
  const failure = exit.cause.reasons.find(Cause.isFailReason);
  if (failure !== undefined) {
    return Schema.is(fn.rpc.errorSchema)(failure.error) ? "domain" : "defect";
  }
  return exit.cause.reasons.some(Cause.isInterruptReason) ? "interruption" : "defect";
};

/**
 * Serves the registry's server functions for one request with `effect/rpc`:
 * an `RpcGroup` of their Rpcs, handled by `RpcServer` over HTTP with JSON
 * serialization. Handlers run in this request's fiber context, so they see
 * the request runtime (`RequestContext`, `ResponseContext`, server services).
 */
const serveServerFunctions = (
  functions: ReadonlyMap<string, AnyServerFunction>,
  request: Request,
  facts: StartRequestFacts | undefined,
): Effect.Effect<Response, never, Scope.Scope> =>
  Effect.gen(function* () {
    let handled = false;
    const served = [...functions.values()];
    const group = RpcGroup.make(...served.map((fn) => fn.rpc as Rpc.Any));
    const handlers = yield* group.toHandlers(
      Object.fromEntries(
        served.map((fn) => [
          fn.name,
          (payload: unknown) => {
            handled = true;
            return withStartRpcObservability(fn.name, fn.local(payload)).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  const kind = rpcFailureKind(fn, exit);
                  if (kind !== undefined) {
                    recordStartRequestFailure(facts, kind);
                  }
                }),
              ),
            );
          },
        ]),
      ) as never,
    );
    const httpEffect = yield* RpcServer.toHttpEffect(group, {
      disableTracing: true,
      disableFatalDefects: true,
    }).pipe(
      Effect.provideContext(handlers),
      Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.json),
    );
    const response = yield* httpEffect.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(request),
      ),
    );
    if (!handled) {
      // Malformed messages, unknown functions, and payloads that fail their
      // input schema end before any handler runs.
      recordStartRequestFailure(facts, "protocol");
    }
    return HttpServerResponse.toWeb(response);
  }) as Effect.Effect<Response, never, Scope.Scope>;

const rpcTransportRequestFailureResponse = (error: StartTransportRequestError): Response =>
  new Response(null, {
    status: error.status,
    headers: error.allow === undefined ? {} : { allow: error.allow },
  });

const rpcRuntimeFailureResponse = (): Response => new Response(null, { status: 500 });

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
      run: () => serveServerFunctions(app.registry.serverFunctions, request, facts),
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

          // A form post carries strings: read them as the input's encoded shape.
          const wireInput = hasContentType(request.headers, [startJsonMediaType])
            ? decoded.input
            : startActionFormInput(action, decoded.input);
          const produce = Effect.gen(function* () {
            const input = yield* decodeActionWire(action.input, wireInput).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  recordStartRequestFailure(facts, "validation");
                  return actionProtocolFailureResponse(
                    new ActionProtocolError({
                      message: error.message,
                      payload: serializeDefect(error),
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
