import {
  Action,
  Server,
  ServerRpcProtocolError,
  applyResponseContext,
  makeResponseContext,
  type ActionDefinition,
  type AppDefinition,
  type AppDefinitionRegistry,
  type AppDefinitionRegistryActionRequirements,
  type AppDefinitionRegistryServerFunctionRequirements,
  type ActionDefinitionRequirements,
  type EffectUiRuntime,
  type Route,
  type ResponseContext
} from "@effect-ui/core";
import { Effect, Exit, type Scope } from "effect";
import {
  startTransportEndpointEnvelopeEffect,
  validateStartActionRequestEffect,
  validateStartRpcRequestEffect,
  withStartTransportDiagnostics
} from "./rpc.js";
import {
  makeRequestRuntime,
  provideRequestRuntime,
  type RequestRuntimeRemainingRequirements
} from "./request-runtime.js";
import {
  withStartActionObservability,
  withStartRpcObservability,
  type StartRequestTraceFacts
} from "./request-trace.js";
import {
  recordStartRequestTraceAction,
  recordStartRequestTraceFailure,
  recordStartRequestTraceServerFunction
} from "./request-trace-recorder.js";
import {
  actionExitResponseEffect,
  actionFunctionNotFoundResponse,
  actionProtocolFailureResponse,
  actionResponseMetaEffect,
  actionResponseMode,
  actionRuntimeFailureResponse,
  actionTransportRequestFailureResponse
} from "./start-action-response-codec.js";
import {
  actionFailureKindEffect,
  decodeWithSchema,
  exitToRpcResponse,
  functionNotFoundResponse,
  makeActionMap,
  protocolFailureResponse,
  readJsonEffect,
  rpcFailureKindEffect,
  rpcRuntimeFailureResponse,
  rpcTransportRequestFailureResponse
} from "./start-transport-protocol.js";
import {
  readStartActionRequestEffect,
  type StartActionDefinition
} from "./start-action-request-codec.js";

export const createServerRpcResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client,
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError, Registry>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  responseContext: ResponseContext = makeResponseContext(),
  traceFacts?: StartRequestTraceFacts
): Effect.Effect<
  Response,
  never,
  Scope.Scope | RequestRuntimeRemainingRequirements<
    AppDefinitionRegistryServerFunctionRequirements<Registry>,
    ServerServices
  >
> => {
  return Effect.gen(function* () {
    const envelope = yield* startTransportEndpointEnvelopeEffect("rpc", request, {
      requestId: traceFacts?.requestId
    });
    const diagnostics = envelope.diagnostics;
    const validation = yield* validateStartRpcRequestEffect(request).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.sync(() => {
          recordStartRequestTraceFailure(traceFacts, "transport");
          return rpcTransportRequestFailureResponse(error);
        })
      )
    );
    if (validation instanceof Response) {
      return withStartTransportDiagnostics(validation, diagnostics);
    }

    const response = yield* provideRequestRuntime(
      runtime,
      request,
      Effect.gen(function* () {
        const payload = yield* readJsonEffect(request).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              recordStartRequestTraceFailure(traceFacts, "protocol");
              return protocolFailureResponse(error);
            })
          )
        );
        if (payload instanceof Response) {
          return payload;
        }

        const decoded = yield* Server.decodeRpcRequest(payload).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              recordStartRequestTraceFailure(traceFacts, "protocol");
              return protocolFailureResponse(
                new ServerRpcProtocolError({
                  message: error.message,
                  payload: Server.serializeDefect(error)
                })
              );
            })
          )
        );
        if (decoded instanceof Response) {
          return decoded;
        }

        const fn = app.registry.serverFunctions.get(decoded.name);
        if (!fn) {
          recordStartRequestTraceServerFunction(traceFacts, {
            name: decoded.name,
            status: "failure",
            failureKind: "protocol"
          });
          return functionNotFoundResponse(decoded.name);
        }

        const exit = yield* Effect.exit(
          withStartRpcObservability(decoded.name, fn.invoke(decoded.input))
        );
        const failureKind = Exit.isSuccess(exit)
          ? undefined
          : yield* rpcFailureKindEffect(fn, exit);
        recordStartRequestTraceServerFunction(traceFacts, {
          name: decoded.name,
          status: Exit.isSuccess(exit) ? "success" : "failure",
          ...(failureKind === undefined ? {} : { failureKind })
        });
        return yield* exitToRpcResponse(fn, exit);
      }),
      responseContext,
      app.registry
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          recordStartRequestTraceFailure(traceFacts, "defect");
          return rpcRuntimeFailureResponse(error);
        })
      )
    );

    return withStartTransportDiagnostics(response, diagnostics);
  }) as Effect.Effect<
    Response,
    never,
    Scope.Scope | RequestRuntimeRemainingRequirements<
      AppDefinitionRegistryServerFunctionRequirements<Registry>,
      ServerServices
    >
  >;
};

/**
 * Handles one server-function RPC request and encodes the protocol response.
 *
 * This is the low-level RPC endpoint handler. Most applications use
 * `createRequestHandlerEffect`, which routes RPC, actions, and SSR together.
 */
export const createServerRpcResponseEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client,
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError, Registry>,
  request: Request
): Effect.Effect<
  Response,
  never,
  Scope.Scope | RequestRuntimeRemainingRequirements<
    AppDefinitionRegistryServerFunctionRequirements<Registry>,
    ServerServices
  >
> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.map(
      createServerRpcResponseEffectWithRuntime(app, request, runtime, responseContext),
      (response) => applyResponseContext(responseContext, response)
    ),
    runtime.disposeEffect
  ) as Effect.Effect<
    Response,
    never,
    Scope.Scope | RequestRuntimeRemainingRequirements<
      AppDefinitionRegistryServerFunctionRequirements<Registry>,
      ServerServices
    >
  >;
};

export const createServerActionResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client,
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition = never
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError, Registry>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  actions?: Iterable<Actions>,
  responseContext: ResponseContext = makeResponseContext(),
  traceFacts?: StartRequestTraceFacts
): Effect.Effect<
  Response,
  never,
  Scope.Scope | RequestRuntimeRemainingRequirements<
    AppDefinitionRegistryActionRequirements<Registry> | ActionDefinitionRequirements<Actions>,
    ServerServices
  >
> => {
  return Effect.gen(function* () {
    const envelope = yield* startTransportEndpointEnvelopeEffect("action", request, {
      requestId: traceFacts?.requestId
    });
    const diagnostics = envelope.diagnostics;
    const validation = yield* validateStartActionRequestEffect(request).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.sync(() => {
          recordStartRequestTraceFailure(traceFacts, "transport");
          return actionTransportRequestFailureResponse(error);
        })
      )
    );
    if (validation instanceof Response) {
      return withStartTransportDiagnostics(validation, diagnostics);
    }

    const response = yield* provideRequestRuntime(
      runtime,
      request,
      Effect.gen(function* () {
        const decoded = yield* readStartActionRequestEffect(request).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              recordStartRequestTraceFailure(traceFacts, "protocol");
              return actionProtocolFailureResponse(error);
            })
          )
        );
        if (decoded instanceof Response) {
          return decoded;
        }

        const actionMap = yield* Effect.try({
          try: () => makeActionMap(actions, app.registry),
          catch: (error) => error
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              recordStartRequestTraceFailure(traceFacts, "defect");
              return actionRuntimeFailureResponse(error);
            })
          )
        );
        if (actionMap instanceof Response) {
          return actionMap;
        }

        const action = actionMap.get(decoded.name);
        if (!action) {
          recordStartRequestTraceAction(traceFacts, {
            name: decoded.name,
            state: "Failure",
            failureKind: "protocol"
          });
          return actionFunctionNotFoundResponse(decoded.name);
        }

        const input = yield* decodeWithSchema(action.input, decoded.input).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              recordStartRequestTraceFailure(traceFacts, "validation");
              return actionProtocolFailureResponse(
                new ServerRpcProtocolError({
                  message: error.message,
                  payload: Server.serializeDefect(error)
                })
              );
            })
          )
        );
        if (input instanceof Response) {
          recordStartRequestTraceAction(traceFacts, {
            name: action.name,
            state: "Failure",
            failureKind: "validation"
          });
          return input;
        }

        const instance = Action.use(action as unknown as ActionDefinition<any, any, never, any>);
        const exit = yield* Effect.exit(
          withStartActionObservability(action.name, instance.submitEffect(input))
        );
        const meta = yield* actionResponseMetaEffect(instance.invalidationPlan.get());
        const failureKind = yield* actionFailureKindEffect(action, exit);
        recordStartRequestTraceAction(traceFacts, {
          name: action.name,
          state: failureKind === undefined ? "Success" : "Failure",
          ...(failureKind === undefined ? {} : { failureKind })
        });
        return yield* actionExitResponseEffect(action, exit, meta, actionResponseMode(request));
      }),
      responseContext,
      app.registry
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          recordStartRequestTraceFailure(traceFacts, "defect");
          return actionRuntimeFailureResponse(error);
        })
      )
    );

    return withStartTransportDiagnostics(response, diagnostics);
  }) as Effect.Effect<
    Response,
    never,
    Scope.Scope | RequestRuntimeRemainingRequirements<
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
export const createServerActionResponseEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client,
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition = never
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError, Registry>,
  request: Request,
  actions?: Iterable<Actions>
): Effect.Effect<
  Response,
  never,
  Scope.Scope | RequestRuntimeRemainingRequirements<
    AppDefinitionRegistryActionRequirements<Registry> | ActionDefinitionRequirements<Actions>,
    ServerServices
  >
> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.map(
      createServerActionResponseEffectWithRuntime(app, request, runtime, actions, responseContext),
      (response) => applyResponseContext(responseContext, response)
    ),
    runtime.disposeEffect
  ) as Effect.Effect<
    Response,
    never,
    Scope.Scope | RequestRuntimeRemainingRequirements<
      AppDefinitionRegistryActionRequirements<Registry> | ActionDefinitionRequirements<Actions>,
      ServerServices
    >
  >;
};
