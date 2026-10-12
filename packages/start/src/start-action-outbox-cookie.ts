import type { ActionOutboxEntry } from "@sunfall/arc-core";
import { Option, Schema } from "effect";
import * as Cookies from "effect/http/Cookies";

/**
 * The browser's pending durable submissions, as `[action, id]` pairs.
 *
 * `App.launch` mirrors the Action Outbox's `pending` into this cookie, so the
 * next document request tells the server which submissions the reloading page
 * still holds. The server answers, in the hydration payload, with the ones it
 * already settled before rendering (`settledSubmissions`), and the outbox
 * restores those without re-applying their optimistic patch: the rendered
 * state already reflects them.
 */
export const startActionOutboxCookieName = "sunfall-arc-outbox";

/** Oldest-first cap that keeps the cookie well under the 4 KB header budget. */
const maxCookieSubmissions = 32;

const PendingSubmissions = Schema.fromJsonString(
  Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
);
const decodePendingSubmissions = Schema.decodeUnknownOption(PendingSubmissions);

/** One pending durable submission named by the outbox cookie. */
export interface StartPendingSubmission {
  readonly action: string;
  readonly id: string;
}

/** The `Set-Cookie`-shaped string `document.cookie` takes for `pending`. */
export const startActionOutboxCookie = (
  pending: ReadonlyArray<Pick<ActionOutboxEntry, "action" | "id">>,
  secure: boolean,
): string => {
  const entries = pending
    .slice(0, maxCookieSubmissions)
    .map((entry): readonly [string, string] => [entry.action, entry.id]);
  return Cookies.serializeCookie(
    Cookies.makeCookieUnsafe(
      startActionOutboxCookieName,
      entries.length === 0 ? "" : JSON.stringify(entries),
      {
        path: "/",
        sameSite: "lax",
        secure,
        // Durable submissions outlive the browser session; an empty outbox
        // expires the cookie.
        maxAge: entries.length === 0 ? 0 : "400 days",
      },
    ),
  );
};

/** Reads the pending durable submissions a document request carries. */
export const readStartActionOutboxCookie = (
  request: Request,
): ReadonlyArray<StartPendingSubmission> => {
  const header = request.headers.get("cookie");
  const value =
    header === null ? undefined : Cookies.parseHeader(header)[startActionOutboxCookieName];
  if (value === undefined || value === "") {
    return [];
  }
  return Option.match(decodePendingSubmissions(value), {
    onNone: () => [],
    onSome: (entries) =>
      entries.slice(0, maxCookieSubmissions).map(([action, id]) => ({ action, id })),
  });
};
