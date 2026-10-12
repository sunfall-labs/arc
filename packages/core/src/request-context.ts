import { Context, Data, Duration, Effect, Result } from "effect";
import * as Cookies from "effect/http/Cookies";
import { EffectInputCallbackError } from "./effect-like.js";

/** Request-scoped service available while handling Start/server requests. */
export interface RequestContext {
  /** Original web request. */
  readonly request: Request;
  /** Parsed request URL. */
  readonly url: URL;
  /** Incoming request headers. */
  readonly headers: Headers;
  /** Parsed `Cookie` header values. Duplicate cookie names keep the first value (the most specific path, per RFC 6265); undecodable values stay percent-encoded. */
  readonly cookies: ReadonlyMap<string, string>;
}

export const RequestContext = Context.Service<RequestContext>("@sunfall/arc-core/RequestContext");

/** SameSite values for response cookies (serialized as `Strict`, `Lax`, or `None`). */
export type ResponseCookieSameSite = "strict" | "lax" | "none";

/** Attributes used when serializing a `Set-Cookie` response header. */
export interface ResponseCookieOptions {
  /** Cookie domain attribute. */
  readonly domain?: string;
  /** Cookie path attribute. */
  readonly path?: string;
  /** Absolute expiry date. */
  readonly expires?: Date;
  /** Max-Age in seconds. Fractions are truncated. */
  readonly maxAge?: number;
  /** Adds the HttpOnly attribute. */
  readonly httpOnly?: boolean;
  /** Adds the Secure attribute. */
  readonly secure?: boolean;
  /** Adds the SameSite attribute (serialized as `Strict`, `Lax`, or `None`). */
  readonly sameSite?: ResponseCookieSameSite;
  /** Adds the Partitioned (CHIPS) attribute. */
  readonly partitioned?: boolean;
  /** Adds the Priority attribute. */
  readonly priority?: "low" | "medium" | "high";
}

/** Cookie attributes accepted when expiring a cookie. */
export type ResponseDeleteCookieOptions = Omit<ResponseCookieOptions, "expires" | "maxAge">;

/** Error raised when response cookie data cannot be serialized safely. */
export class ResponseCookieSerializationError extends Data.TaggedError(
  "ResponseCookieSerializationError",
)<{
  /** Cookie field or attribute that failed validation. */
  readonly attribute: string;
  /** Original invalid value or platform encoding failure. */
  readonly cause: unknown;
  /** Human-readable repair hint for diagnostics and tests. */
  readonly guidance: string;
}> {}

/**
 * Mutable response metadata accumulated during request handling.
 *
 * Adapters apply this context to the final `Response` so handlers can set
 * headers, cookies, and status without leaving Effect code.
 */
export interface ResponseContext {
  /** Non-cookie headers accumulated for the final response. */
  readonly headers: Headers;
  /** Serialized `Set-Cookie` headers accumulated for the final response. */
  readonly cookies: ReadonlyArray<string>;
  /** Optional status override for the final response. */
  readonly status: number | undefined;
  /** Optional status text override for the final response. */
  readonly statusText: string | undefined;
  /** Sets the final response status and optional status text. */
  setStatus(status: number, statusText?: string): Effect.Effect<void, EffectInputCallbackError>;
  /** Sets a response header, replacing existing values except for `set-cookie`. */
  setHeader(name: string, value: string): Effect.Effect<void, EffectInputCallbackError>;
  /** Appends a response header value. `set-cookie` is preserved as a separate header. */
  appendHeader(name: string, value: string): Effect.Effect<void, EffectInputCallbackError>;
  /** Appends a serialized `Set-Cookie` header. */
  setCookie(
    name: string,
    value: string,
    options?: ResponseCookieOptions,
  ): Effect.Effect<void, ResponseCookieSerializationError>;
  /** Appends a cookie-expiring `Set-Cookie` header. */
  deleteCookie(
    name: string,
    options?: ResponseDeleteCookieOptions,
  ): Effect.Effect<void, ResponseCookieSerializationError>;
}

export const ResponseContext = Context.Service<ResponseContext>(
  "@sunfall/arc-core/ResponseContext",
);

const parseCookies = (header: string | null): ReadonlyMap<string, string> => {
  const cookies = new Map<string, string>();
  if (header) {
    for (const [name, value] of Object.entries(Cookies.parseHeader(header))) {
      if (name !== "") {
        cookies.set(name, value);
      }
    }
  }
  return cookies;
};

/** Creates the request service value and reports host parsing failures as typed Effects. */
export const makeRequestContext = (
  request: Request,
): Effect.Effect<RequestContext, EffectInputCallbackError> =>
  Effect.try({
    try: () => ({
      request,
      url: new URL(request.url),
      headers: request.headers,
      cookies: parseCookies(request.headers.get("cookie")),
    }),
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: "RequestContext.make",
        cause,
        guidance:
          "Request URL and Cookie headers must be parseable before server route handlers can read RequestContext.",
      }),
  });

const isSetCookieHeader = (name: string): boolean => name.toLowerCase() === "set-cookie";

const cookieSerializationError = (
  attribute: string,
  cause: unknown,
): ResponseCookieSerializationError =>
  new ResponseCookieSerializationError({
    attribute,
    cause,
    guidance:
      "Response cookie names, values, and attributes must be valid Set-Cookie data. Wrap host-specific cookie work in an Effect and keep invalid values in the Effect error channel.",
  });

const cookieErrorAttribute: Record<Cookies.CookiesErrorReason["_tag"], string> = {
  InvalidCookieName: "Name",
  InvalidCookieValue: "Value",
  InvalidCookieDomain: "Domain",
  InvalidCookiePath: "Path",
  CookieInfinityMaxAge: "Max-Age",
};

const makeResponseCookie = (
  name: string,
  value: string,
  options: ResponseCookieOptions,
): Result.Result<Cookies.Cookie, ResponseCookieSerializationError> => {
  // Effect's cookie validation covers name/value/domain/path/Infinity; NaN, invalid
  // dates, and untyped SameSite values would otherwise serialize silently.
  if (options.maxAge !== undefined && Number.isNaN(options.maxAge)) {
    return Result.fail(cookieSerializationError("Max-Age", options.maxAge));
  }
  if (options.expires !== undefined && !Number.isFinite(options.expires.getTime())) {
    return Result.fail(cookieSerializationError("Expires", options.expires));
  }
  const sameSite = options.sameSite;
  if (
    sameSite !== undefined &&
    sameSite !== "strict" &&
    sameSite !== "lax" &&
    sameSite !== "none"
  ) {
    return Result.fail(cookieSerializationError("SameSite", options.sameSite));
  }
  let made: Result.Result<Cookies.Cookie, Cookies.CookiesError>;
  try {
    made = Cookies.makeCookie(name, value, {
      domain: options.domain,
      path: options.path,
      expires: options.expires,
      maxAge: options.maxAge === undefined ? undefined : Duration.seconds(options.maxAge),
      httpOnly: options.httpOnly,
      secure: options.secure,
      partitioned: options.partitioned,
      priority: options.priority,
      sameSite,
    });
  } catch (cause) {
    // encodeURIComponent throws URIError for lone surrogates in the value.
    return Result.fail(cookieSerializationError("Value", cause));
  }
  return Result.mapError(made, (error) =>
    cookieSerializationError(cookieErrorAttribute[error.reason._tag], error),
  );
};

/** Serializes a cookie name, value, and attributes for a `Set-Cookie` header. */
export const serializeResponseCookie = (
  name: string,
  value: string,
  options: ResponseCookieOptions = {},
): Effect.Effect<string, ResponseCookieSerializationError> =>
  Effect.map(Effect.fromResult(makeResponseCookie(name, value, options)), Cookies.serializeCookie);

/** Creates an empty mutable response context. */
export const makeResponseContext = (): ResponseContext => {
  const headers = new Headers();
  const cookies: string[] = [];
  let status: number | undefined;
  let statusText: string | undefined;

  return {
    headers,
    cookies,
    get status() {
      return status;
    },
    get statusText() {
      return statusText;
    },
    setStatus: (nextStatus, nextStatusText) =>
      Effect.try({
        try: () => {
          status = nextStatus;
          statusText = nextStatusText;
        },
        catch: (cause) =>
          new EffectInputCallbackError({
            operation: "ResponseContext.setStatus",
            cause,
            guidance:
              "Response status metadata must be valid for the platform Response constructor.",
          }),
      }),
    setHeader: (name, value) =>
      Effect.try({
        try: () => {
          if (isSetCookieHeader(name)) {
            cookies.splice(0, cookies.length, value);
          } else {
            headers.set(name, value);
          }
        },
        catch: (cause) =>
          new EffectInputCallbackError({
            operation: "ResponseContext.setHeader",
            cause,
            guidance:
              "Response header names and values must be accepted by the platform Headers implementation.",
          }),
      }),
    appendHeader: (name, value) =>
      Effect.try({
        try: () => {
          if (isSetCookieHeader(name)) {
            cookies.push(value);
          } else {
            headers.append(name, value);
          }
        },
        catch: (cause) =>
          new EffectInputCallbackError({
            operation: "ResponseContext.appendHeader",
            cause,
            guidance:
              "Response header names and values must be accepted by the platform Headers implementation.",
          }),
      }),
    setCookie: (name, value, options) =>
      Effect.flatMap(serializeResponseCookie(name, value, options), (cookie) =>
        Effect.sync(() => {
          cookies.push(cookie);
        }),
      ),
    deleteCookie: (name, options) =>
      Effect.flatMap(
        serializeResponseCookie(name, "", {
          ...options,
          expires: new Date(0),
          maxAge: 0,
        }),
        (cookie) =>
          Effect.sync(() => {
            cookies.push(cookie);
          }),
      ),
  };
};

const applyResponseContextUnsafe = (context: ResponseContext, response: Response): Response => {
  const headers = new Headers(response.headers);
  context.headers.forEach((value, key) => {
    headers.set(key, value);
  });
  for (const cookie of context.cookies) {
    headers.append("set-cookie", cookie);
  }

  const init: ResponseInit = {
    status: context.status ?? response.status,
    headers,
  };
  const statusText = context.statusText ?? response.statusText;
  if (statusText) {
    init.statusText = statusText;
  }

  return new Response(response.body, init);
};

/** Applies accumulated response metadata and reports host failures as typed Effects. */
export const applyResponseContext = (
  context: ResponseContext,
  response: Response,
): Effect.Effect<Response, EffectInputCallbackError> =>
  Effect.try({
    try: () => applyResponseContextUnsafe(context, response),
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: "ResponseContext.apply",
        cause,
        guidance:
          "Accumulated response status, headers, and cookies must be accepted by the platform Response implementation.",
      }),
  });

/** Provides `RequestContext` to an Effect. */
export const provideRequest =
  (request: Request) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | EffectInputCallbackError, Exclude<R, RequestContext>> =>
    Effect.flatMap(makeRequestContext(request), (requestContext) =>
      Effect.provideService(effect, RequestContext, requestContext),
    );

/** Provides `ResponseContext` to an Effect. */
export const provideResponse =
  (context: ResponseContext = makeResponseContext()) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, ResponseContext>> =>
    Effect.provideService(effect, ResponseContext, context);
