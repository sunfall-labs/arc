import { ServerRpcProtocolError, ServerTransportError } from "@effect-ui/core";
import { Data, Effect } from "effect";

/** Default POST endpoint for Start server function RPC. */
export const serverRpcPath = "/__effect-ui/rpc";
/** Default POST endpoint for Start actions. */
export const serverActionPath = "/__effect-ui/action";

/** Start transport protocol version emitted on response diagnostics headers. */
export const startTransportProtocolVersion = "1";
/** JSON media type used by RPC and action JSON payloads. */
export const startJsonMediaType = "application/json";
/** Form-url-encoded media type accepted by progressive action posts. */
export const startFormUrlEncodedMediaType = "application/x-www-form-urlencoded";
/** Multipart media type accepted by progressive action posts. */
export const startMultipartFormDataMediaType = "multipart/form-data";
/** HTML media type accepted by progressive action responses. */
export const startHtmlMediaType = "text/html";

/** Request/response correlation header propagated by Start transports. */
export const startRequestIdHeader = "x-effect-ui-request-id";
/** W3C trace context header forwarded through Start transports. */
export const startTraceparentHeader = "traceparent";
/** W3C baggage header forwarded through Start transports. */
export const startBaggageHeader = "baggage";
/** Response diagnostics header describing the transport kind. */
export const startTransportKindHeader = "x-effect-ui-transport";
/** Response diagnostics header describing the Start transport protocol version. */
export const startTransportProtocolHeader = "x-effect-ui-protocol-version";

/** Start transport families that share request validation helpers. */
export type StartTransportKind = "rpc" | "action";

/** Request diagnostics captured before handling a Start transport request. */
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

/** Optional facts already resolved by the Start Transport Endpoint Envelope. */
export interface StartTransportDiagnosticsOptions {
  readonly requestId?: string | undefined;
}

/** Per-request transport envelope shared by diagnostics and trace emitters. */
export interface StartTransportEndpointEnvelope {
  readonly kind: StartTransportKind;
  readonly requestId: string;
  readonly diagnostics: StartTransportDiagnostics;
}

/** 405/406/415 request validation error for Start transport endpoints. */
export class StartTransportRequestError extends Data.TaggedError("StartTransportRequestError")<{
  readonly kind: StartTransportKind;
  readonly status: 405 | 406 | 415;
  readonly error: ServerRpcProtocolError;
  readonly allow?: string;
  readonly acceptedMediaTypes?: readonly string[];
  readonly supportedMediaTypes?: readonly string[];
}> {}

/** Headers to seed on Start transport requests from clients and tests. */
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

/** Extracts the lowercase media type from a Content-Type/Accept header value. */
export const mediaTypeOf = (value: string | null | undefined): string | undefined =>
  nonEmptySafeHeaderValue(value)?.split(";", 1)[0]?.trim().toLowerCase();

const mediaTypeMatches = (accepted: string, offered: string): boolean => {
  if (accepted === "*/*") {
    return true;
  }

  const [acceptedType, acceptedSubtype] = accepted.split("/");
  const [offeredType, offeredSubtype] = offered.split("/");
  return (
    acceptedType === offeredType && (acceptedSubtype === "*" || acceptedSubtype === offeredSubtype)
  );
};

interface AcceptedMediaRange {
  readonly media: string;
  readonly q: number;
  readonly order: number;
}

const acceptedMediaRanges = (accept: string): readonly AcceptedMediaRange[] =>
  accept
    .split(",")
    .map((part, order) => {
      const [media = "", ...parameters] = part.trim().split(";");
      const q = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      return {
        media: media.toLowerCase(),
        q: q ? Number(q.slice(2)) : 1,
        order,
      };
    })
    .filter(({ media, q }) => media.includes("/") && Number.isFinite(q) && q > 0);

const mediaTypeSpecificity = (accepted: string): number =>
  accepted === "*/*" ? 0 : accepted.endsWith("/*") ? 1 : 2;

/** Negotiates the best offered media type from Accept quality, specificity, and header order. */
export const negotiateAcceptedMediaType = (
  headers: Headers,
  mediaTypes: readonly string[],
): string | undefined => {
  const accept = nonEmptySafeHeaderValue(headers.get("accept"));
  if (!accept) {
    return mediaTypes[0];
  }

  const accepted = acceptedMediaRanges(accept);
  let best:
    | {
        readonly mediaType: string;
        readonly q: number;
        readonly specificity: number;
        readonly order: number;
        readonly offeredIndex: number;
      }
    | undefined;

  mediaTypes.forEach((mediaType, offeredIndex) => {
    for (const candidate of accepted) {
      if (!mediaTypeMatches(candidate.media, mediaType)) {
        continue;
      }

      const match = {
        mediaType,
        q: candidate.q,
        specificity: mediaTypeSpecificity(candidate.media),
        order: candidate.order,
        offeredIndex,
      };
      if (
        best === undefined ||
        match.q > best.q ||
        (match.q === best.q && match.specificity > best.specificity) ||
        (match.q === best.q &&
          match.specificity === best.specificity &&
          match.order < best.order) ||
        (match.q === best.q &&
          match.specificity === best.specificity &&
          match.order === best.order &&
          match.offeredIndex < best.offeredIndex)
      ) {
        best = match;
      }
    }
  });

  return best?.mediaType;
};

/** Checks whether request Accept headers allow at least one offered media type. */
export const acceptsMediaType = (headers: Headers, mediaTypes: readonly string[]): boolean => {
  const accept = nonEmptySafeHeaderValue(headers.get("accept"));
  return !accept || negotiateAcceptedMediaType(headers, mediaTypes) !== undefined;
};

/** Checks whether request Content-Type exactly matches one supported media type. */
export const hasContentType = (headers: Headers, mediaTypes: readonly string[]): boolean => {
  const contentType = mediaTypeOf(headers.get("content-type"));
  return contentType !== undefined && mediaTypes.includes(contentType);
};

const expectedMediaTypes = (mediaTypes: readonly string[]): string =>
  mediaTypes.length === 1
    ? mediaTypes[0]!
    : `${mediaTypes.slice(0, -1).join(", ")} or ${mediaTypes[mediaTypes.length - 1]}`;

/** Creates a request id for Start transport diagnostics. */
export const makeStartRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

/** Effect wrapper around `makeStartRequestId`. */
export const makeStartRequestIdEffect: Effect.Effect<string> = Effect.sync(makeStartRequestId);

/** Captures sanitized request diagnostics and request id propagation data. */
export const startTransportDiagnosticsEffect = (
  kind: StartTransportKind,
  request: Request,
  options: StartTransportDiagnosticsOptions = {},
): Effect.Effect<StartTransportDiagnostics> =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const incomingRequestId = nonEmptySafeHeaderValue(request.headers.get(startRequestIdHeader));
    const envelopeRequestId = nonEmptySafeHeaderValue(options.requestId);
    const requestId = incomingRequestId ?? envelopeRequestId ?? (yield* makeStartRequestIdEffect);
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
      protocolVersion: startTransportProtocolVersion,
    };
  });

/** Constructs the Start Transport Endpoint Envelope for one RPC/action request. */
export const startTransportEndpointEnvelopeEffect = (
  kind: StartTransportKind,
  request: Request,
  options: StartTransportDiagnosticsOptions = {},
): Effect.Effect<StartTransportEndpointEnvelope> =>
  Effect.map(startTransportDiagnosticsEffect(kind, request, options), (diagnostics) => ({
    kind,
    requestId: diagnostics.requestId,
    diagnostics,
  }));

/** Builds request headers with optional request id and trace propagation values. */
export const startTransportRequestHeaders = (
  options: StartTransportRequestHeadersOptions = {},
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

/** Builds response headers carrying Start transport diagnostics. */
export const startTransportResponseHeaders = (
  diagnostics: StartTransportDiagnostics,
  headers: HeadersInit = {},
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

/** Clones a response while applying Start transport diagnostics headers. */
export const withStartTransportDiagnostics = (
  response: Response,
  diagnostics: StartTransportDiagnostics,
): Response =>
  new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: startTransportResponseHeaders(diagnostics, response.headers),
  });

/** Validates Accept headers and returns a typed 406 transport request error on mismatch. */
export const validateStartTransportAcceptEffect = (
  kind: StartTransportKind,
  request: Request,
  mediaTypes: readonly string[],
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
              accept: request.headers.get("accept"),
            },
          }),
        }),
      );

/** Validates Content-Type headers and returns a typed 415 transport request error on mismatch. */
export const validateStartTransportContentTypeEffect = (
  kind: StartTransportKind,
  request: Request,
  mediaTypes: readonly string[],
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
              contentType: request.headers.get("content-type"),
            },
          }),
        }),
      );

/** Validates HTTP method and returns a typed 405 transport request error on mismatch. */
export const validateStartTransportMethodEffect = (
  kind: StartTransportKind,
  request: Request,
  method: string,
): Effect.Effect<void, StartTransportRequestError> =>
  request.method === method
    ? Effect.void
    : Effect.fail(
        new StartTransportRequestError({
          kind,
          status: 405,
          allow: method,
          error: new ServerRpcProtocolError({
            message: `${kind === "rpc" ? "Server functions" : "Actions"} require ${method} requests, received ${request.method}.`,
          }),
        }),
      );

/** Validates a server-function RPC request. */
export const validateStartRpcRequestEffect = (
  request: Request,
): Effect.Effect<void, StartTransportRequestError> =>
  Effect.gen(function* () {
    yield* validateStartTransportMethodEffect("rpc", request, "POST");
    yield* validateStartTransportAcceptEffect("rpc", request, [startJsonMediaType]);
    yield* validateStartTransportContentTypeEffect("rpc", request, [startJsonMediaType]);
  });

/** Validates an action transport request, including progressive form media types. */
export const validateStartActionRequestEffect = (
  request: Request,
): Effect.Effect<void, StartTransportRequestError> =>
  Effect.gen(function* () {
    yield* validateStartTransportMethodEffect("action", request, "POST");
    yield* validateStartTransportAcceptEffect("action", request, [
      startJsonMediaType,
      startHtmlMediaType,
    ]);
    yield* validateStartTransportContentTypeEffect("action", request, [
      startJsonMediaType,
      startFormUrlEncodedMediaType,
      startMultipartFormDataMediaType,
    ]);
  });

const validateStartJsonResponseEffect = (
  response: Response,
  message: string,
): Effect.Effect<void, ServerTransportError> =>
  hasContentType(response.headers, [startJsonMediaType])
    ? Effect.void
    : Effect.fail(
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message,
          payload: {
            contentType: response.headers.get("content-type"),
          },
        }),
      );

/** Validates that an RPC response uses the JSON transport media type. */
export const validateStartRpcResponseEffect = (
  response: Response,
): Effect.Effect<void, ServerTransportError> =>
  validateStartJsonResponseEffect(
    response,
    "Server function response content-type was not application/json.",
  );

/** Validates that a Start action response uses the JSON transport media type. */
export const validateStartActionResponseEffect = (
  response: Response,
): Effect.Effect<void, ServerTransportError> =>
  validateStartJsonResponseEffect(
    response,
    "Start action response content-type was not application/json.",
  );
