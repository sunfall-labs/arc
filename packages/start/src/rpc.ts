import { Data, Effect } from "effect";

/** POST endpoint where Start serves server functions (`effect/rpc`, JSON serialization). */
export const serverRpcPath = "/__sunfall-arc/rpc";
/** Default POST endpoint for Start actions. */
export const serverActionPath = "/__sunfall-arc/action";

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
export const startRequestIdHeader = "x-sunfall-arc-request-id";
/** Response diagnostics header describing the transport kind. */
export const startTransportKindHeader = "x-sunfall-arc-transport";
/** Response diagnostics header describing the Start transport protocol version. */
export const startTransportProtocolHeader = "x-sunfall-arc-protocol-version";

/** Start transport families that share request validation helpers. */
export type StartTransportKind = "rpc" | "action";

/** Request diagnostics captured before handling a Start transport request. */
export interface StartTransportDiagnostics {
  readonly kind: StartTransportKind;
  readonly method: string;
  readonly path: string;
  readonly requestId: string;
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
  readonly message: string;
  readonly payload?: unknown;
  readonly allow?: string;
  readonly acceptedMediaTypes?: readonly string[];
  readonly supportedMediaTypes?: readonly string[];
}> {}

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

/** Captures sanitized request diagnostics and request id propagation data. */
export const startTransportDiagnostics = (
  kind: StartTransportKind,
  request: Request,
  options: StartTransportDiagnosticsOptions = {},
): Effect.Effect<StartTransportDiagnostics> =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const incomingRequestId = nonEmptySafeHeaderValue(request.headers.get(startRequestIdHeader));
    const envelopeRequestId = nonEmptySafeHeaderValue(options.requestId);
    const requestId =
      incomingRequestId ?? envelopeRequestId ?? (yield* Effect.sync(makeStartRequestId));
    const accept = nonEmptySafeHeaderValue(request.headers.get("accept"));
    const contentType = nonEmptySafeHeaderValue(request.headers.get("content-type"));

    return {
      kind,
      method: request.method,
      path: url.pathname,
      requestId,
      ...(accept === undefined ? {} : { accept }),
      ...(contentType === undefined ? {} : { contentType }),
      protocolVersion: startTransportProtocolVersion,
    };
  });

/** Constructs the Start Transport Endpoint Envelope for one RPC/action request. */
export const startTransportEndpointEnvelope = (
  kind: StartTransportKind,
  request: Request,
  options: StartTransportDiagnosticsOptions = {},
): Effect.Effect<StartTransportEndpointEnvelope> =>
  Effect.map(startTransportDiagnostics(kind, request, options), (diagnostics) => ({
    kind,
    requestId: diagnostics.requestId,
    diagnostics,
  }));

/** Builds response headers carrying Start transport diagnostics. */
export const startTransportResponseHeaders = (
  diagnostics: StartTransportDiagnostics,
  headers: HeadersInit = {},
): Headers => {
  const next = new Headers(headers);
  next.set(startRequestIdHeader, diagnostics.requestId);
  next.set(startTransportKindHeader, diagnostics.kind);
  next.set(startTransportProtocolHeader, diagnostics.protocolVersion);

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
export const validateStartTransportAccept = (
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
          message: `Expected accept header to allow ${expectedMediaTypes(mediaTypes)}.`,
          payload: { accept: request.headers.get("accept") },
        }),
      );

/** Validates Content-Type headers and returns a typed 415 transport request error on mismatch. */
export const validateStartTransportContentType = (
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
          message: `Expected content-type ${expectedMediaTypes(mediaTypes)}.`,
          payload: { contentType: request.headers.get("content-type") },
        }),
      );

/** Validates HTTP method and returns a typed 405 transport request error on mismatch. */
export const validateStartTransportMethod = (
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
          message: `${kind === "rpc" ? "Server functions" : "Actions"} require ${method} requests, received ${request.method}.`,
        }),
      );

/**
 * Validates a server-function request: POST only. `RpcServer` reads the body
 * with `RpcSerialization.json` and answers malformed messages itself.
 */
export const validateStartRpcRequest = (
  request: Request,
): Effect.Effect<void, StartTransportRequestError> =>
  validateStartTransportMethod("rpc", request, "POST");

/** Validates an action transport request: a JSON POST (forms post to their page instead). */
export const validateStartActionRequest = (
  request: Request,
): Effect.Effect<void, StartTransportRequestError> =>
  Effect.gen(function* () {
    yield* validateStartTransportMethod("action", request, "POST");
    yield* validateStartTransportAccept("action", request, [startJsonMediaType]);
    yield* validateStartTransportContentType("action", request, [startJsonMediaType]);
  });

/** True when a request targets the Start server-function RPC endpoint. */
export const isServerRpcRequest = (request: Request): boolean =>
  new URL(request.url).pathname === serverRpcPath;

/** True when a request targets the Start action endpoint. */
export const isServerActionRequest = (request: Request): boolean =>
  new URL(request.url).pathname === serverActionPath;
