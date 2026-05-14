import {
  Action,
  Server,
  ServerRpcProtocolError,
  applyResponseContext,
  makeResponseContext,
  type AppDefinition,
  type EffectUiRuntime,
  type Route,
  type ResponseContext
} from "@effect-ui/core";
import { Effect, Exit } from "effect";
import {
  startTransportDiagnosticsEffect,
  validateStartActionRequestEffect,
  validateStartRpcRequestEffect,
  withStartTransportDiagnostics
} from "./rpc.js";
import {
  makeRequestRuntime,
  provideRequestRuntime
} from "./request-runtime.js";
import {
  withStartActionObservability,
  withStartRpcObservability,
  type StartRequestTraceFacts
} from "./request-trace.js";
import {
  actionExitResponseEffect,
  actionFailureKindEffect,
  actionFunctionNotFoundResponse,
  actionProtocolFailureResponse,
  actionResponseMetaEffect,
  actionResponseMode,
  actionRuntimeFailureResponse,
  actionTransportRequestFailureResponse,
  decodeWithSchema,
  exitToRpcResponse,
  functionNotFoundResponse,
  makeActionMap,
  protocolFailureResponse,
  readJsonEffect,
  readStartActionRequestEffect,
  rpcFailureKindEffect,
  rpcRuntimeFailureResponse,
  rpcTransportRequestFailureResponse,
  type StartActionDefinition
} from "./start-transport-protocol.js";

export const createServerRpcResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  _app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  responseContext: ResponseContext = makeResponseContext(),
  traceFacts?: StartRequestTraceFacts
): Effect.Effect<Response, never, unknown> => {
  return Effect.gen(function* () {
    const diagnostics = yield* startTransportDiagnosticsEffect("rpc", request);
    const validation = yield* validateStartRpcRequestEffect(request).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "transport";
          }
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
              if (traceFacts) {
                traceFacts.failureKind = "protocol";
              }
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
              if (traceFacts) {
                traceFacts.failureKind = "protocol";
              }
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

        const fn = Server.get(decoded.name);
        if (!fn) {
          if (traceFacts) {
            traceFacts.failureKind = "protocol";
          }
          traceFacts?.serverFunctions.push({
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
        if (failureKind !== undefined && traceFacts) {
          traceFacts.failureKind = failureKind;
        }
        traceFacts?.serverFunctions.push({
          name: decoded.name,
          status: Exit.isSuccess(exit) ? "success" : "failure",
          ...(failureKind === undefined ? {} : { failureKind })
        });
        return yield* exitToRpcResponse(fn, exit);
      }),
      responseContext
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "defect";
          }
          return rpcRuntimeFailureResponse(error);
        })
      )
    );

    return withStartTransportDiagnostics(response, diagnostics);
  });
};

/**
 * Handles one server-function RPC request and encodes the protocol response.
 *
 * This is the low-level RPC endpoint handler. Most applications use
 * `createRequestHandlerEffect`, which routes RPC, actions, and SSR together.
 */
export const createServerRpcResponseEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request
): Effect.Effect<Response, never, unknown> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.map(
      createServerRpcResponseEffectWithRuntime(app, request, runtime, responseContext),
      (response) => applyResponseContext(responseContext, response)
    ),
    runtime.disposeEffect
  );
};

export const createServerActionResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  _app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  actions?: Iterable<StartActionDefinition>,
  responseContext: ResponseContext = makeResponseContext(),
  traceFacts?: StartRequestTraceFacts
): Effect.Effect<Response, never, unknown> => {
  return Effect.gen(function* () {
    const diagnostics = yield* startTransportDiagnosticsEffect("action", request);
    const validation = yield* validateStartActionRequestEffect(request).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "transport";
          }
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
              if (traceFacts) {
                traceFacts.failureKind = "protocol";
              }
              return actionProtocolFailureResponse(error);
            })
          )
        );
        if (decoded instanceof Response) {
          return decoded;
        }

        const action = makeActionMap(actions).get(decoded.name);
        if (!action) {
          if (traceFacts) {
            traceFacts.failureKind = "protocol";
          }
          traceFacts?.actions.push({
            name: decoded.name,
            state: "Failure",
            failureKind: "protocol"
          });
          return actionFunctionNotFoundResponse(decoded.name);
        }

        const input = yield* decodeWithSchema(action.input, decoded.input).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              if (traceFacts) {
                traceFacts.failureKind = "validation";
              }
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
          traceFacts?.actions.push({
            name: action.name,
            state: "Failure",
            failureKind: "validation"
          });
          return input;
        }

        const instance = Action.use(action, { runtime });
        const exit = yield* Effect.exit(
          withStartActionObservability(action.name, instance.submitEffect(input))
        );
        const meta = yield* actionResponseMetaEffect(instance.invalidationPlan.get());
        const failureKind = yield* actionFailureKindEffect(action, exit);
        if (failureKind !== undefined && traceFacts) {
          traceFacts.failureKind = failureKind;
        }
        traceFacts?.actions.push({
          name: action.name,
          state: failureKind === undefined ? "Success" : "Failure",
          ...(failureKind === undefined ? {} : { failureKind })
        });
        return yield* actionExitResponseEffect(action, exit, meta, actionResponseMode(request));
      }),
      responseContext
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "defect";
          }
          return actionRuntimeFailureResponse(error);
        })
      )
    );

    return withStartTransportDiagnostics(response, diagnostics);
  });
};

/**
 * Handles one Start action request and encodes the protocol response.
 *
 * Accepts JSON action requests and progressively enhanced form posts. The
 * returned Effect runs the action inside a fresh request runtime and includes
 * hydration or invalidation metadata when needed.
 */
export const createServerActionResponseEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  actions?: Iterable<StartActionDefinition>
): Effect.Effect<Response, never, unknown> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.map(
      createServerActionResponseEffectWithRuntime(app, request, runtime, actions, responseContext),
      (response) => applyResponseContext(responseContext, response)
    ),
    runtime.disposeEffect
  );
};
