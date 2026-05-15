import { Server, ServerTransportError } from "@effect-ui/core";
import { Effect } from "effect";
import {
  callStartFetchEffect,
  getStartTransportHeadersEffect,
  resolveStartFetchEffect,
  type ServerRpcClientOptions,
  type StartFetch,
  type StartFetchInit,
  type StartFetchInput
} from "./start-fetch.js";
import {
  validateStartResponseStatusEffect,
  type StartActionResponseBody
} from "./start-transport-protocol.js";
import type { StartTransportKind } from "./rpc.js";

type StartClientTransportBody = Server.RpcResponse | StartActionResponseBody;

type StartClientTransportErrorBody =
  | { readonly _tag: "ServerError"; readonly error: unknown }
  | { readonly _tag: "Defect"; readonly defect: unknown };

export type StartClientTransportDomainBody<Body extends StartClientTransportBody> =
  Exclude<Body, StartClientTransportErrorBody>;

export interface StartClientTransportExchange<Body extends StartClientTransportBody> {
  readonly response: Response;
  readonly body: StartClientTransportDomainBody<Body>;
}

export interface ExecuteStartClientTransportOptions<
  Body extends StartClientTransportBody,
  ParseError,
  FetchError,
  FetchRequirements
> extends Pick<ServerRpcClientOptions<FetchError, FetchRequirements>, "headers"> {
  readonly kind: StartTransportKind;
  readonly fetch?: StartFetch<FetchError, FetchRequirements>;
  readonly endpoint: StartFetchInput;
  readonly request: unknown;
  readonly init?: Omit<NonNullable<StartFetchInit>, "body" | "headers">;
  readonly parseResponse: (response: Response) => Effect.Effect<Body, ParseError>;
}

const startClientTransportMessages = (
  kind: StartTransportKind
): {
  readonly unavailable: string;
  readonly encodeRequest: string;
  readonly requestFailed: string;
  readonly defect: string;
} =>
  kind === "rpc"
    ? {
        unavailable: "No fetch implementation is available for server functions.",
        encodeRequest: "Could not encode the server function request body.",
        requestFailed: "Server function request failed.",
        defect: "Server function failed with a defect."
      }
    : {
        unavailable: "No fetch implementation is available for Start actions.",
        encodeRequest: "Could not encode the action request body.",
        requestFailed: "Start action request failed.",
        defect: "Start action failed with a defect."
      };

export const encodeStartClientTransportRequestBodyEffect = (
  kind: StartTransportKind,
  request: unknown
): Effect.Effect<string, ServerTransportError> =>
  Effect.try({
    try: () => JSON.stringify(request),
    catch: (cause) =>
      new ServerTransportError({
        reason: "InvalidResponse",
        message: startClientTransportMessages(kind).encodeRequest,
        cause,
        payload: request
      })
  });

const validateStartClientTransportStatusEffect = <Body extends StartClientTransportBody>(
  kind: StartTransportKind,
  response: Response,
  body: Body
): Effect.Effect<void, ServerTransportError> =>
  kind === "rpc"
    ? validateStartResponseStatusEffect("rpc", response, body as Server.RpcResponse)
    : validateStartResponseStatusEffect("action", response, body as StartActionResponseBody);

const decodeStartClientTransportDomainBodyEffect = <Body extends StartClientTransportBody>(
  kind: StartTransportKind,
  response: Response,
  body: Body
): Effect.Effect<StartClientTransportDomainBody<Body>, Server.ClientError> => {
  if (body._tag === "ServerError") {
    return Effect.fail(Server.deserializeServerError(body.error));
  }

  if (body._tag === "Defect") {
    return Effect.fail(
      new ServerTransportError({
        reason: "Defect",
        status: response.status,
        message: startClientTransportMessages(kind).defect,
        payload: body.defect
      })
    );
  }

  return Effect.succeed(body as StartClientTransportDomainBody<Body>);
};

export const executeStartClientTransportEffect = <
  Body extends StartClientTransportBody,
  ParseError = never,
  FetchError = never,
  FetchRequirements = never
>(
  options: ExecuteStartClientTransportOptions<Body, ParseError, FetchError, FetchRequirements>
): Effect.Effect<
  StartClientTransportExchange<Body>,
  ParseError | Server.ClientError,
  FetchRequirements
> =>
  Effect.gen(function* () {
    const messages = startClientTransportMessages(options.kind);
    const fetcher = yield* resolveStartFetchEffect(
      options.fetch,
      messages.unavailable
    );
    const body = yield* encodeStartClientTransportRequestBodyEffect(options.kind, options.request);
    const headers = yield* getStartTransportHeadersEffect(options);
    const response = yield* callStartFetchEffect(
      fetcher,
      options.endpoint,
      {
        ...options.init,
        method: options.init?.method ?? "POST",
        headers,
        body
      },
      (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: messages.requestFailed,
          cause
        })
    );
    const parsed = yield* options.parseResponse(response);
    yield* validateStartClientTransportStatusEffect(options.kind, response, parsed);
    const domainBody = yield* decodeStartClientTransportDomainBodyEffect(
      options.kind,
      response,
      parsed
    );

    return {
      response,
      body: domainBody
    };
  });
