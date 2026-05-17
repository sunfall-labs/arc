import {
  Action,
  ActionResult,
  type CoreDefinitionRegistry,
  Server,
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
  type ActionDefinition,
  type AnySunfallArcRuntime,
  type SunfallArcRuntime,
  type ServerFunction,
} from "@sunfall/arc-core";
import { Cause, Data, Effect, Exit, Schema } from "effect";
import type { StartCollectionHydrationOptions } from "./hydration.js";
import {
  startJsonMediaType,
  validateStartRpcResponseEffect,
  type StartTransportRequestError,
} from "./rpc.js";
import {
  isStartActionEndpointRequest,
  isStartRpcEndpointRequest,
  type StartActionEndpointSource,
  type StartTransportEndpointSource,
} from "./start-transport-endpoints.js";
import {
  readStartTransportJsonBodyEffect,
  readStartTransportResponseTextEffect,
} from "./start-transport-body.js";
import type { StartActionDefinition } from "./start-action-request-codec.js";
import type { StartRequestTraceFailureKind } from "./request-trace.js";
import type { ServerRpcClientOptions } from "./start-fetch.js";
import { encodeWithSchema } from "./start-schema-codec.js";

export {
  actionExitResponseEffect,
  actionFunctionNotFoundResponse,
  actionProtocolFailureResponse,
  actionResponseMetaEffect,
  actionResponseMode,
  actionRuntimeFailureResponse,
  actionTransportRequestFailureResponse,
  decodeStartActionResponseEffect,
  describeStartActionInvalidationPlan,
  parseStartActionResponse,
} from "./start-action-response-codec.js";
export type {
  ActionDefinitionErrorValue,
  ActionDefinitionOutputValue,
  StartActionInvalidationCause,
  StartActionInvalidationPlan,
  StartActionInvalidationTarget,
  StartActionResponseBody,
  StartActionResponseMeta,
  StartActionResult,
  StartActionResultFor,
} from "./start-action-response-codec.js";
export { decodeWithSchema, encodeWithSchema } from "./start-schema-codec.js";

export {
  applyStartActionResponseEffect,
  hydrateActionResponseEffect,
} from "./start-action-response-application.js";

export {
  encodeStartActionFormInputEffect,
  encodeStartActionInputEffect,
  encodeStartActionPartialInputEffect,
  encodeStartActionRequestEffect,
  readStartActionRequestEffect,
  StartActionFormEncodeError,
  startActionForm,
  startActionInputField,
  startActionNameField,
} from "./start-action-request-codec.js";
export type {
  StartActionDefinition,
  StartActionForm,
  StartActionFormField,
  StartActionFormOptions,
  StartActionRequest,
} from "./start-action-request-codec.js";

/**
 * Options for clients that submit Start actions.
 *
 * Extends RPC options with optional collection hydration settings. Supplying a
 * runtime runs action response hydration in that runtime.
 */
export interface StartActionClientOptions<
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never,
>
  extends
    ServerRpcClientOptions<FetchError, FetchRequirements, RuntimeError>,
    Pick<StartActionEndpointSource, "actionPath" | "actionManifest" | "appGraph" | "endpoints">,
    StartCollectionHydrationOptions {
  /**
   * Runtime used for action response hydration and, when `transportRuntime` is
   * omitted, for fetch Effects that require services.
   */
  readonly runtime?:
    | SunfallArcRuntime<FetchRequirements, RuntimeError>
    | AnySunfallArcRuntime<RuntimeError>;
  /**
   * Runtime used only for action response hydration and invalidation metadata.
   *
   * Use this with `transportRuntime` when fetch transport services live in a
   * different Runtime Spine than application Resource/Collection state.
   */
  readonly responseRuntime?: SunfallArcRuntime<any, RuntimeError> | AnySunfallArcRuntime<RuntimeError>;
}

/** Extracts the input value type from a core `ActionDefinition`. */
export type ActionDefinitionInputValue<D> =
  D extends ActionDefinition<infer I, infer _A, infer _E, infer _R> ? I : never;

/** True when a request targets the Start server-function RPC endpoint. */
export const isServerRpcRequest = (
  request: Request,
  endpoints?: StartTransportEndpointSource,
): boolean => isStartRpcEndpointRequest(request, endpoints);

/** True when a request targets the Start action endpoint. */
export const isServerActionRequest = (
  request: Request,
  endpoints?: StartTransportEndpointSource,
): boolean => isStartActionEndpointRequest(request, endpoints);

type StartTransportJsonBody = Server.RpcResponse;

const startTransportDefectBody = (
  cause: unknown,
): Extract<Server.RpcResponse, { readonly _tag: "Defect" }> => ({
  _tag: "Defect",
  defect: Server.serializeDefect(cause),
});

const startTransportJson = (body: StartTransportJsonBody, status = 200): Response => {
  const headers = {
    "content-type": startJsonMediaType,
  };

  try {
    return new Response(JSON.stringify(body), { status, headers });
  } catch (cause) {
    return new Response(JSON.stringify(startTransportDefectBody(cause)), {
      status: 500,
      headers,
    });
  }
};

const rpcJson = (body: Server.RpcResponse, status = 200): Response =>
  startTransportJson(body, status);

export const readJsonEffect = (request: Request): Effect.Effect<unknown, ServerRpcProtocolError> =>
  readStartTransportJsonBodyEffect(request, "Expected a JSON server function request body.");

const serverErrorBody = (
  error: ServerRpcProtocolError | ServerFunctionNotFound,
): Extract<Server.RpcResponse, { readonly _tag: "ServerError" }> => ({
  _tag: "ServerError",
  error: Server.serializeServerError(error),
});

const defectBody = (defect: unknown): Extract<Server.RpcResponse, { readonly _tag: "Defect" }> => ({
  _tag: "Defect",
  defect: Server.serializeDefect(defect),
});

const startTransportRuntimeFailureResponse = <
  Body extends Extract<StartTransportJsonBody, { readonly _tag: "Defect" }>,
>(
  json: (body: Body, status?: number) => Response,
  error: unknown,
): Response => json(defectBody(error) as Body, 500);

const startTransportProtocolFailureResponse = <
  Body extends Extract<StartTransportJsonBody, { readonly _tag: "ServerError" }>,
>(
  json: (body: Body, status?: number) => Response,
  error: ServerRpcProtocolError,
  status = 400,
): Response => json(serverErrorBody(error) as Body, status);

const startTransportFunctionNotFoundResponse = <
  Body extends Extract<StartTransportJsonBody, { readonly _tag: "ServerError" }>,
>(
  json: (body: Body, status?: number) => Response,
  functionName: string,
): Response => json(serverErrorBody(new ServerFunctionNotFound({ functionName })) as Body, 404);

export const rpcRuntimeFailureResponse = (error: unknown): Response =>
  startTransportRuntimeFailureResponse(rpcJson, error);

const withTransportRequestErrorHeaders = (
  response: Response,
  error: StartTransportRequestError,
): Response => {
  if (error.allow) {
    response.headers.set("allow", error.allow);
  }
  return response;
};

/** Error raised when multiple Start actions use the same public action name. */
export class StartActionDuplicateName extends Data.TaggedError("StartActionDuplicateName")<{
  readonly actionName: string;
  readonly first: number;
  readonly duplicate: number;
  readonly message: string;
}> {}

export type StartActionMap<Actions extends StartActionDefinition = StartActionDefinition> =
  ReadonlyMap<string, Actions>;

export type StartActionSource<Actions extends StartActionDefinition = StartActionDefinition> =
  | Iterable<Actions>
  | StartActionMap<Actions>;

const isStartActionMap = <Actions extends StartActionDefinition>(
  actions: StartActionSource<Actions>,
): actions is StartActionMap<Actions> =>
  typeof (actions as { readonly get?: unknown }).get === "function" &&
  typeof (actions as { readonly has?: unknown }).has === "function" &&
  typeof (actions as { readonly forEach?: unknown }).forEach === "function";

export const materializeStartActionMap = <Actions extends StartActionDefinition>(
  actions: Iterable<Actions>,
): StartActionMap<Actions> => {
  const actionMap = new Map<string, Actions>();
  const firstIndexes = new Map<string, number>();
  let index = 0;
  for (const action of actions) {
    const first = firstIndexes.get(action.name);
    if (first !== undefined) {
      throw new StartActionDuplicateName({
        actionName: action.name,
        first,
        duplicate: index,
        message: `Duplicate Start action name: ${action.name}`,
      });
    }
    actionMap.set(action.name, action);
    firstIndexes.set(action.name, index);
    index++;
  }

  return actionMap;
};

export const makeActionMap = <Actions extends StartActionDefinition = StartActionDefinition>(
  actions?: StartActionSource<Actions>,
  registry?: CoreDefinitionRegistry<Actions, ServerFunction<any, any, any, any>>,
): StartActionMap<Actions> => {
  if (actions === undefined) {
    return (registry?.actions ?? Action.definitions()) as StartActionMap<Actions>;
  }

  return isStartActionMap(actions) ? actions : materializeStartActionMap(actions);
};

const firstFail = <E>(cause: Cause.Cause<E>): E | undefined => {
  const reason = cause.reasons.find(Cause.isFailReason);
  return reason?.error;
};

const firstDefect = <E>(cause: Cause.Cause<E>): unknown | undefined => {
  const reason = cause.reasons.find(Cause.isDieReason);
  return reason?.defect;
};

export const rpcFailureKindEffect = <FnError>(
  fn: ServerFunction<unknown, unknown, FnError, unknown>,
  exit: Exit.Exit<unknown, FnError>,
): Effect.Effect<StartRequestTraceFailureKind> => {
  if (Exit.isSuccess(exit)) {
    return Effect.succeed("domain");
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed("validation");
    }

    return Effect.map(Effect.exit(Server.encodeError(fn, failure)), (encoded) =>
      Exit.isSuccess(encoded) ? "domain" : "defect",
    );
  }

  return Effect.succeed(
    exit.cause.reasons.some(Cause.isInterruptReason) ? "interruption" : "defect",
  );
};

const actionResultFailureKind = (result: unknown): StartRequestTraceFailureKind | undefined => {
  if (!ActionResult.is(result)) {
    return undefined;
  }
  if (ActionResult.isValidationFailure(result)) {
    return "validation";
  }
  if (ActionResult.isFailure(result)) {
    return "domain";
  }
  return undefined;
};

export const actionFailureKindEffect = <ActionError>(
  action: StartActionDefinition,
  exit: Exit.Exit<unknown, ActionError>,
): Effect.Effect<StartRequestTraceFailureKind | undefined> => {
  if (Exit.isSuccess(exit)) {
    return Effect.succeed(actionResultFailureKind(exit.value));
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed("validation");
    }

    return Effect.map(Effect.exit(encodeWithSchema(action.error, failure)), (encoded) =>
      Exit.isSuccess(encoded) ? "domain" : "defect",
    );
  }

  return Effect.succeed(
    exit.cause.reasons.some(Cause.isInterruptReason) ? "interruption" : "defect",
  );
};

export const protocolFailureResponse = (error: ServerRpcProtocolError, status = 400): Response =>
  startTransportProtocolFailureResponse(rpcJson, error, status);

export const rpcTransportRequestFailureResponse = (error: StartTransportRequestError): Response =>
  withTransportRequestErrorHeaders(protocolFailureResponse(error.error, error.status), error);

export const functionNotFoundResponse = (functionName: string): Response =>
  startTransportFunctionNotFoundResponse(rpcJson, functionName);

export const exitToRpcResponse = <FnError>(
  fn: ServerFunction<unknown, unknown, FnError, unknown>,
  exit: Exit.Exit<unknown, FnError>,
): Effect.Effect<Response, never> => {
  if (Exit.isSuccess(exit)) {
    return Effect.succeed(
      rpcJson({
        _tag: "Success",
        value: exit.value,
      }),
    );
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed(
        protocolFailureResponse(
          new ServerRpcProtocolError({
            message: failure.message,
            payload: Server.serializeDefect(failure),
          }),
        ),
      );
    }

    return Effect.gen(function* () {
      const encoded = yield* Effect.exit(Server.encodeError(fn, failure));
      if (Exit.isSuccess(encoded)) {
        return rpcJson({
          _tag: "Failure",
          error: encoded.value,
        });
      }

      return rpcJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encoded.cause)),
        },
        500,
      );
    });
  }

  if (exit.cause.reasons.some(Cause.isInterruptReason)) {
    return Effect.succeed(
      rpcJson(
        {
          _tag: "Defect",
          defect: {
            _tag: "Interrupted",
            message: "The server function fiber was interrupted.",
          },
        },
        499,
      ),
    );
  }

  return Effect.succeed(
    rpcJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(firstDefect(exit.cause) ?? Cause.pretty(exit.cause)),
      },
      500,
    ),
  );
};

export const parseRpcResponse = (
  response: Response,
): Effect.Effect<Server.RpcResponse, ServerTransportError | Schema.SchemaError> =>
  Effect.gen(function* () {
    yield* validateStartRpcResponseEffect(response);
    const text = yield* readStartTransportResponseTextEffect(
      response,
      "Could not read the server function response body.",
    );
    const payload = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Server function response was not valid JSON.",
          cause,
          payload: text,
        }),
    });
    return yield* Server.decodeRpcResponse(payload);
  });
