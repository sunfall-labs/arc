import { Effect, Layer, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

/** Effect-returning fetch the test `HttpClient` hands each request to. */
export type TestFetch = (
  input: RequestInfo | URL,
  init: RequestInit,
) => Effect.Effect<Response, unknown, any>;

const requestBody = (request: HttpClientRequest.HttpClientRequest): BodyInit | null => {
  switch (request.body._tag) {
    case "Uint8Array":
      // Start's transports send text; tests read it back with `String(init.body)`.
      return new TextDecoder().decode(request.body.body);
    case "Raw":
      return request.body.body as BodyInit;
    default:
      return null;
  }
};

/**
 * An `HttpClient` that hands each request to `fetch`. Start's transports post
 * to relative paths (the browser resolves them against the page); tests have
 * no page, so relative URLs resolve against `base` after every request
 * mapping, the way a browser would.
 */
export const testHttpClient = (
  fetch: TestFetch,
  base = "https://example.com",
): HttpClient.HttpClient => {
  const inner = HttpClient.make(
    (request, url, signal) =>
      Effect.try({
        try: () =>
          fetch(url.href, {
            method: request.method,
            headers: new Headers(request.headers),
            body: requestBody(request),
            signal,
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.flatten,
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        Effect.mapError(
          (cause) =>
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause }),
            }),
        ),
      ) as Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
  );
  return HttpClient.makeWith(
    (
      request: Effect.Effect<HttpClientRequest.HttpClientRequest, HttpClientError.HttpClientError>,
    ) =>
      Effect.flatMap(request, (request) =>
        inner.execute(
          request.url.startsWith("/") ? HttpClientRequest.prependUrl(request, base) : request,
        ),
      ),
    (request) => Effect.succeed(request),
  );
};

/** Layer providing `testHttpClient(fetch)`. */
export const testHttpClientLayer = (fetch: TestFetch): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(HttpClient.HttpClient)(testHttpClient(fetch));

/** A `TestFetch` that runs a Start request handler in-process. */
export const handlerFetch =
  <E, R>(handle: (request: Request) => Effect.Effect<Response, E, R | Scope.Scope>): TestFetch =>
  (input, init) =>
    Effect.scoped(handle(new Request(input, init)));
