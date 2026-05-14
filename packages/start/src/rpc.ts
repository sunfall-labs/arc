import { ServerRpcProtocolError, ServerTransportError } from "@effect-ui/core";
import { Data, Effect } from "effect";

export const serverRpcPath = "/__effect-ui/rpc";
export const serverActionPath = "/__effect-ui/action";

export const startTransportProtocolVersion = "1";
export const startJsonMediaType = "application/json";
export const startFormUrlEncodedMediaType = "application/x-www-form-urlencoded";
export const startMultipartFormDataMediaType = "multipart/form-data";
export const startHtmlMediaType = "text/html";

export const startRequestIdHeader = "x-effect-ui-request-id";
export const startTraceparentHeader = "traceparent";
export const startBaggageHeader = "baggage";
export const startTransportKindHeader = "x-effect-ui-transport";
export const startTransportProtocolHeader = "x-effect-ui-protocol-version";

export type StartTransportKind = "rpc" | "action";

export interface StartTransportDiagnostics {
  readonly kind: StartTransportKind;
  readonly method: string;
  readonly path: string;
  readonly requestId: string;
  readonly traceparent?: string;
  readonly baggage?: string;
  readonly accept?: string;
  readonly contentType?: string;
  readonly protocolVersion: typeof startTransportProtocolVersion;
}

export class StartTransportRequestError extends Data.TaggedError("StartTransportRequestError")<{
  readonly kind: StartTransportKind;
  readonly status: 405 | 406 | 415;
  readonly error: ServerRpcProtocolError;
  readonly allow?: string;
  readonly acceptedMediaTypes?: readonly string[];
  readonly supportedMediaTypes?: readonly string[];
}> {}

export interface StartTransportRequestHeadersOptions {
  readonly headers?: HeadersInit;
  readonly requestId?: string;
  readonly traceparent?: string;
  readonly baggage?: string;
}

const nonEmptySafeHeaderValue = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && !/[\r\n]/.test(trimmed) ? trimmed : undefined;
};

export const mediaTypeOf = (value: string | null | undefined): string | undefined =>
  nonEmptySafeHeaderValue(value)?.split(";", 1)[0]?.trim().toLowerCase();

const mediaTypeMatches = (accepted: string, offered: string): boolean => {
  if (accepted === "*/*") {
    return true;
  }

  const [acceptedType, acceptedSubtype] = accepted.split("/");
  const [offeredType, offeredSubtype] = offered.split("/");
  return (
    acceptedType === offeredType &&
    (acceptedSubtype === "*" || acceptedSubtype === offeredSubtype)
  );
};

const acceptedMediaTypes = (accept: string): readonly string[] =>
  accept
    .split(",")
    .map((part) => {
      const [media = "", ...parameters] = part.trim().split(";");
      const q = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      return {
        media: media.toLowerCase(),
        q: q ? Number(q.slice(2)) : 1
      };
    })
    .filter(({ media, q }) => media.includes("/") && Number.isFinite(q) && q > 0)
    .map(({ media }) => media);

export const acceptsMediaType = (
  headers: Headers,
  mediaTypes: readonly string[]
): boolean => {
  const accept = nonEmptySafeHeaderValue(headers.get("accept"));
  if (!accept) {
    return true;
  }

  const accepted = acceptedMediaTypes(accept);
  return mediaTypes.some((mediaType) =>
    accepted.some((candidate) => mediaTypeMatches(candidate, mediaType))
  );
};

export const hasContentType = (
  headers: Headers,
  mediaTypes: readonly string[]
): boolean => {
  const contentType = mediaTypeOf(headers.get("content-type"));
  return contentType !== undefined && mediaTypes.includes(contentType);
};

const expectedMediaTypes = (mediaTypes: readonly string[]): string =>
  mediaTypes.length === 1
    ? mediaTypes[0]!
    : `${mediaTypes.slice(0, -1).join(", ")} or ${mediaTypes[mediaTypes.length - 1]}`;

export const makeStartRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

export const makeStartRequestIdEffect: Effect.Effect<string> =
  Effect.sync(makeStartRequestId);

export const startTransportDiagnosticsEffect = (
  kind: StartTransportKind,
  request: Request
): Effect.Effect<StartTransportDiagnostics> =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const incomingRequestId = nonEmptySafeHeaderValue(request.headers.get(startRequestIdHeader));
    const requestId = incomingRequestId ?? (yield* makeStartRequestIdEffect);
    const traceparent = nonEmptySafeHeaderValue(request.headers.get(startTraceparentHeader));
    const baggage = nonEmptySafeHeaderValue(request.headers.get(startBaggageHeader));
    const accept = nonEmptySafeHeaderValue(request.headers.get("accept"));
    const contentType = nonEmptySafeHeaderValue(request.headers.get("content-type"));

    return {
      kind,
      method: request.method,
      path: url.pathname,
      requestId,
      ...(traceparent === undefined ? {} : { traceparent }),
      ...(baggage === undefined ? {} : { baggage }),
      ...(accept === undefined ? {} : { accept }),
      ...(contentType === undefined ? {} : { contentType }),
      protocolVersion: startTransportProtocolVersion
    };
  });

export const startTransportRequestHeaders = (
  options: StartTransportRequestHeadersOptions = {}
): Headers => {
  const headers = new Headers(options.headers);
  const requestId = nonEmptySafeHeaderValue(options.requestId);
  const traceparent = nonEmptySafeHeaderValue(options.traceparent);
  const baggage = nonEmptySafeHeaderValue(options.baggage);

  if (requestId) {
    headers.set(startRequestIdHeader, requestId);
  }
  if (traceparent) {
    headers.set(startTraceparentHeader, traceparent);
  }
  if (baggage) {
    headers.set(startBaggageHeader, baggage);
  }

  return headers;
};

export const startTransportResponseHeaders = (
  diagnostics: StartTransportDiagnostics,
  headers: HeadersInit = {}
): Headers => {
  const next = new Headers(headers);
  next.set(startRequestIdHeader, diagnostics.requestId);
  next.set(startTransportKindHeader, diagnostics.kind);
  next.set(startTransportProtocolHeader, diagnostics.protocolVersion);

  if (diagnostics.traceparent) {
    next.set(startTraceparentHeader, diagnostics.traceparent);
  }
  if (diagnostics.baggage) {
    next.set(startBaggageHeader, diagnostics.baggage);
  }

  return next;
};

export const withStartTransportDiagnostics = (
  response: Response,
  diagnostics: StartTransportDiagnostics
): Response =>
  new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: startTransportResponseHeaders(diagnostics, response.headers)
  });

export const validateStartTransportAcceptEffect = (
  kind: StartTransportKind,
  request: Request,
  mediaTypes: readonly string[]
): Effect.Effect<void, StartTransportRequestError> =>
  acceptsMediaType(request.headers, mediaTypes)
    ? Effect.void
    : Effect.fail(
        new StartTransportRequestError({
          kind,
          status: 406,
          acceptedMediaTypes: mediaTypes,
          error: new ServerRpcProtocolError({
            message: `Expected accept header to allow ${expectedMediaTypes(mediaTypes)}.`,
            payload: {
              accept: request.headers.get("accept")
            }
          })
        })
      );

export const validateStartTransportContentTypeEffect = (
  kind: StartTransportKind,
  request: Request,
  mediaTypes: readonly string[]
): Effect.Effect<void, StartTransportRequestError> =>
  hasContentType(request.headers, mediaTypes)
    ? Effect.void
    : Effect.fail(
        new StartTransportRequestError({
          kind,
          status: 415,
          supportedMediaTypes: mediaTypes,
          error: new ServerRpcProtocolError({
            message: `Expected content-type ${expectedMediaTypes(mediaTypes)}.`,
            payload: {
              contentType: request.headers.get("content-type")
            }
          })
        })
      );

export const validateStartTransportMethodEffect = (
  kind: StartTransportKind,
  request: Request,
  method: string
): Effect.Effect<void, StartTransportRequestError> =>
  request.method === method
    ? Effect.void
    : Effect.fail(
        new StartTransportRequestError({
          kind,
          status: 405,
          allow: method,
          error: new ServerRpcProtocolError({
            message: `${kind === "rpc" ? "Server functions" : "Actions"} require ${method} requests, received ${request.method}.`
          })
        })
      );

export const validateStartRpcRequestEffect = (
  request: Request
): Effect.Effect<void, StartTransportRequestError> =>
  Effect.gen(function* () {
    yield* validateStartTransportMethodEffect("rpc", request, "POST");
    yield* validateStartTransportAcceptEffect("rpc", request, [startJsonMediaType]);
    yield* validateStartTransportContentTypeEffect("rpc", request, [startJsonMediaType]);
  });

export const validateStartActionRequestEffect = (
  request: Request
): Effect.Effect<void, StartTransportRequestError> =>
  Effect.gen(function* () {
    yield* validateStartTransportMethodEffect("action", request, "POST");
    yield* validateStartTransportAcceptEffect("action", request, [startJsonMediaType, startHtmlMediaType]);
    yield* validateStartTransportContentTypeEffect("action", request, [
      startJsonMediaType,
      startFormUrlEncodedMediaType,
      startMultipartFormDataMediaType
    ]);
  });

export const validateStartRpcResponseEffect = (
  response: Response
): Effect.Effect<void, ServerTransportError> =>
  hasContentType(response.headers, [startJsonMediaType])
    ? Effect.void
    : Effect.fail(
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Server function response content-type was not application/json.",
          payload: {
            contentType: response.headers.get("content-type")
          }
        })
      );
