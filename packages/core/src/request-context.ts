import { Context, Effect } from "effect";

export interface RequestContext {
  readonly request: Request;
  readonly url: URL;
  readonly headers: Headers;
  readonly cookies: ReadonlyMap<string, string>;
}

export const RequestContext = Context.Service<RequestContext>("@effect-ui/core/RequestContext");

export type ResponseCookieSameSite =
  | "Strict"
  | "Lax"
  | "None"
  | "strict"
  | "lax"
  | "none";

export interface ResponseCookieOptions {
  readonly domain?: string;
  readonly path?: string;
  readonly expires?: Date;
  readonly maxAge?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: ResponseCookieSameSite;
}

export type ResponseDeleteCookieOptions = Omit<ResponseCookieOptions, "expires" | "maxAge">;

export interface ResponseContext {
  readonly headers: Headers;
  readonly cookies: ReadonlyArray<string>;
  readonly status: number | undefined;
  readonly statusText: string | undefined;
  setStatus(status: number, statusText?: string): Effect.Effect<void>;
  setHeader(name: string, value: string): Effect.Effect<void>;
  appendHeader(name: string, value: string): Effect.Effect<void>;
  setCookie(name: string, value: string, options?: ResponseCookieOptions): Effect.Effect<void>;
  deleteCookie(name: string, options?: ResponseDeleteCookieOptions): Effect.Effect<void>;
}

export const ResponseContext = Context.Service<ResponseContext>("@effect-ui/core/ResponseContext");

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

export const makeRequestContext = (request: Request): RequestContext => ({
  request,
  url: new URL(request.url),
  headers: request.headers,
  cookies: parseCookies(request.headers.get("cookie"))
});

const isSetCookieHeader = (name: string): boolean =>
  name.toLowerCase() === "set-cookie";

const normalizeSameSite = (sameSite: ResponseCookieSameSite): string => {
  const lower = sameSite.toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
};

export const serializeResponseCookie = (
  name: string,
  value: string,
  options: ResponseCookieOptions = {}
): string => {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

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
    parts.push(`SameSite=${normalizeSameSite(options.sameSite)}`);
  }

  return parts.join("; ");
};

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
      Effect.sync(() => {
        status = nextStatus;
        statusText = nextStatusText;
      }),
    setHeader: (name, value) =>
      Effect.sync(() => {
        if (isSetCookieHeader(name)) {
          cookies.splice(0, cookies.length, value);
        } else {
          headers.set(name, value);
        }
      }),
    appendHeader: (name, value) =>
      Effect.sync(() => {
        if (isSetCookieHeader(name)) {
          cookies.push(value);
        } else {
          headers.append(name, value);
        }
      }),
    setCookie: (name, value, options) =>
      Effect.sync(() => {
        cookies.push(serializeResponseCookie(name, value, options));
      }),
    deleteCookie: (name, options) =>
      Effect.sync(() => {
        cookies.push(
          serializeResponseCookie(name, "", {
            ...options,
            expires: new Date(0),
            maxAge: 0
          })
        );
      })
  };
};

export const applyResponseContext = (
  context: ResponseContext,
  response: Response
): Response => {
  const headers = new Headers(response.headers);
  context.headers.forEach((value, key) => {
    headers.set(key, value);
  });
  for (const cookie of context.cookies) {
    headers.append("set-cookie", cookie);
  }

  const init: ResponseInit = {
    status: context.status ?? response.status,
    headers
  };
  const statusText = context.statusText ?? response.statusText;
  if (statusText) {
    init.statusText = statusText;
  }

  return new Response(response.body, init);
};

export const provideRequest = (request: Request) => {
  const context = Context.make(RequestContext, makeRequestContext(request));
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, RequestContext>> =>
    Effect.provideContext(effect, context);
};

export const provideResponse = (context: ResponseContext = makeResponseContext()) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, ResponseContext>> =>
    Effect.provideService(effect, ResponseContext, context);
