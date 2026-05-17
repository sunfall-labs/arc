import { Context, Data, Effect } from "effect";
import { EffectInputCallbackError } from "./effect-like.js";

/** Request-scoped service available while handling Start/server requests. */
export interface RequestContext {
  /** Original web request. */
  readonly request: Request;
  /** Parsed request URL. */
  readonly url: URL;
  /** Incoming request headers. */
  readonly headers: Headers;
  /** Parsed `Cookie` header values. Duplicate cookie names keep the last value. */
  readonly cookies: ReadonlyMap<string, string>;
}

export const RequestContext = Context.Service<RequestContext>("@sunfall/arc-core/RequestContext");

/** Accepted SameSite spellings for response cookies. */
export type ResponseCookieSameSite = "Strict" | "Lax" | "None" | "strict" | "lax" | "none";

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
  /** Adds the SameSite attribute. */
  readonly sameSite?: ResponseCookieSameSite;
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

export const ResponseContext = Context.Service<ResponseContext>("@sunfall/arc-core/ResponseContext");

const parseCookies = (header: string | null): ReadonlyMap<string, string> => {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) {
      continue;
    }
    cookies.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue.join("=")));
  }

  return cookies;
};

/** Creates the request service value from a web `Request`. */
export const makeRequestContext = (request: Request): RequestContext => ({
  request,
  url: new URL(request.url),
  headers: request.headers,
  cookies: parseCookies(request.headers.get("cookie")),
});

/** Creates the request service value and reports host parsing failures as typed Effects. */
export const makeRequestContextEffect = (
  request: Request,
): Effect.Effect<RequestContext, EffectInputCallbackError> =>
  Effect.try({
    try: () => makeRequestContext(request),
    catch: (cause) =>
      new EffectInputCallbackError({
        operation: "RequestContext.make",
        cause,
        guidance:
          "Request URL and Cookie headers must be parseable before server route handlers can read RequestContext.",
      }),
  });

const isSetCookieHeader = (name: string): boolean => name.toLowerCase() === "set-cookie";

type CookieSerializationResult =
  | { readonly _tag: "Success"; readonly value: string }
  | { readonly _tag: "Failure"; readonly error: ResponseCookieSerializationError };

const cookieSerializationSuccess = (value: string): CookieSerializationResult => ({
  _tag: "Success",
  value,
});

const cookieSerializationFailure = (
  attribute: string,
  cause: unknown,
): CookieSerializationResult => ({
  _tag: "Failure",
  error: new ResponseCookieSerializationError({
    attribute,
    cause,
    guidance:
      "Response cookie names, values, and attributes must be valid Set-Cookie data. Wrap host-specific cookie work in an Effect and keep invalid values in the Effect error channel.",
  }),
});

const normalizeSameSite = (sameSite: ResponseCookieSameSite): CookieSerializationResult => {
  const lower = sameSite.toLowerCase();
  if (lower !== "strict" && lower !== "lax" && lower !== "none") {
    return cookieSerializationFailure("SameSite", sameSite);
  }
  return cookieSerializationSuccess(`${lower.charAt(0).toUpperCase()}${lower.slice(1)}`);
};

const hasInvalidCookieAttributeCharacter = (value: string): boolean =>
  value.includes(";") ||
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const validateCookieAttribute = (
  name: string,
  value: string | undefined,
): CookieSerializationResult | undefined => {
  if (value !== undefined && hasInvalidCookieAttributeCharacter(value)) {
    return cookieSerializationFailure(name, value);
  }
  return undefined;
};

const encodeCookieComponent = (attribute: string, value: string): CookieSerializationResult => {
  try {
    return cookieSerializationSuccess(encodeURIComponent(value));
  } catch (cause) {
    return cookieSerializationFailure(attribute, cause);
  }
};

const serializeResponseCookieResult = (
  name: string,
  value: string,
  options: ResponseCookieOptions = {},
): CookieSerializationResult => {
  const domainValidation = validateCookieAttribute("Domain", options.domain);
  if (domainValidation) {
    return domainValidation;
  }
  const pathValidation = validateCookieAttribute("Path", options.path);
  if (pathValidation) {
    return pathValidation;
  }
  if (options.maxAge !== undefined && !Number.isFinite(options.maxAge)) {
    return cookieSerializationFailure("Max-Age", options.maxAge);
  }
  if (options.expires !== undefined && !Number.isFinite(options.expires.getTime())) {
    return cookieSerializationFailure("Expires", options.expires);
  }

  const encodedName = encodeCookieComponent("Name", name);
  if (encodedName._tag === "Failure") {
    return encodedName;
  }
  const encodedValue = encodeCookieComponent("Value", value);
  if (encodedValue._tag === "Failure") {
    return encodedValue;
  }

  const parts = [`${encodedName.value}=${encodedValue.value}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  if (options.domain !== undefined) {
    parts.push(`Domain=${options.domain}`);
  }
  if (options.path !== undefined) {
    parts.push(`Path=${options.path}`);
  }
  if (options.expires !== undefined) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.sameSite !== undefined) {
    const sameSite = normalizeSameSite(options.sameSite);
    if (sameSite._tag === "Failure") {
      return sameSite;
    }
    parts.push(`SameSite=${sameSite.value}`);
  }

  return cookieSerializationSuccess(parts.join("; "));
};

/** Serializes a cookie name, value, and attributes for a `Set-Cookie` header. */
export const serializeResponseCookie = (
  name: string,
  value: string,
  options: ResponseCookieOptions = {},
): string => {
  const result = serializeResponseCookieResult(name, value, options);
  if (result._tag === "Failure") {
    throw result.error;
  }
  return result.value;
};

/** Effect version of `serializeResponseCookie(...)` with typed validation errors. */
export const serializeResponseCookieEffect = (
  name: string,
  value: string,
  options: ResponseCookieOptions = {},
): Effect.Effect<string, ResponseCookieSerializationError> => {
  const result = serializeResponseCookieResult(name, value, options);
  return result._tag === "Success" ? Effect.succeed(result.value) : Effect.fail(result.error);
};

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
      Effect.flatMap(serializeResponseCookieEffect(name, value, options), (cookie) =>
        Effect.sync(() => {
          cookies.push(cookie);
        }),
      ),
    deleteCookie: (name, options) =>
      Effect.flatMap(
        serializeResponseCookieEffect(name, "", {
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

/** Applies accumulated status, headers, and cookies to a final `Response`. */
export const applyResponseContext = (context: ResponseContext, response: Response): Response => {
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
export const applyResponseContextEffect = (
  context: ResponseContext,
  response: Response,
): Effect.Effect<Response, EffectInputCallbackError> =>
  Effect.try({
    try: () => applyResponseContext(context, response),
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
    Effect.flatMap(makeRequestContextEffect(request), (requestContext) =>
      Effect.provideService(effect, RequestContext, requestContext),
    );

/** Provides `ResponseContext` to an Effect. */
export const provideResponse =
  (context: ResponseContext = makeResponseContext()) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, ResponseContext>> =>
    Effect.provideService(effect, ResponseContext, context);
