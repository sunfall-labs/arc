import type { ResponseContext } from "@sunfall/arc-core";
import { Crypto, Effect, Option } from "effect";
import { Base64Url, Hex } from "effect/encoding";
import * as Cookies from "effect/http/Cookies";

/**
 * The browser a durable submission belongs to.
 *
 * Start mints a random token into this HttpOnly cookie on the first document
 * (or durable Action) response a browser receives without one. Durable
 * submissions are recorded under the token's SHA-256 digest (the submitter's
 * *owner key*) plus the submission id, so only the browser that made a
 * submission can replay it or learn that it settled: a request from any other
 * browser, or with no token, starts a fresh execution. Scripts never see the
 * token, and engines persist only its digest.
 */
export const startActionSubmitterCookieName = "sunfall-arc-submitter";

/** 32 random bytes, base64url without padding. */
const tokenBytes = 32;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** Durable submissions outlive the browser session (the browser caps this at 400 days). */
const tokenMaxAgeSeconds = 400 * 24 * 60 * 60;

/** The host's Web Crypto as Effect's `Crypto` service: secure randomness and SHA digests. */
const webCrypto = Crypto.make({
  randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
  digest: (algorithm, data) =>
    Effect.map(
      Effect.promise(() => globalThis.crypto.subtle.digest(algorithm, data as BufferSource)),
      (digest) => new Uint8Array(digest),
    ),
});

/** The well-formed submitter token a request carries, if any. */
const readSubmitterToken = (request: Request): Option.Option<string> => {
  const header = request.headers.get("cookie");
  const token =
    header === null ? undefined : Cookies.parseHeader(header)[startActionSubmitterCookieName];
  return token !== undefined && tokenPattern.test(token) ? Option.some(token) : Option.none();
};

const ownerKeyOf = (token: string): Effect.Effect<string> =>
  webCrypto
    .digest("SHA-256", new TextEncoder().encode(token))
    .pipe(Effect.map(Hex.encode), Effect.orDie);

/**
 * The owner key of the browser that sent `request`. A request without a
 * submitter token gets a fresh one, set on the response as an HttpOnly,
 * SameSite=Lax cookie (Secure over https), so the browser's next submissions
 * share it. The response is marked `Cache-Control: private` so no shared cache
 * hands the token to another browser.
 */
export const ensureRequestSubmitterOwner = (
  request: Request,
  responseContext: ResponseContext,
): Effect.Effect<string> =>
  Option.match(readSubmitterToken(request), {
    onSome: ownerKeyOf,
    onNone: () =>
      Effect.gen(function* () {
        const token = Base64Url.encode(yield* Effect.orDie(webCrypto.randomBytes(tokenBytes)));
        yield* responseContext
          .setCookie(startActionSubmitterCookieName, token, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: new URL(request.url).protocol === "https:",
            maxAge: tokenMaxAgeSeconds,
          })
          .pipe(Effect.orDie);
        yield* responseContext.setHeader("cache-control", "private").pipe(Effect.orDie);
        return yield* ownerKeyOf(token);
      }),
  });
