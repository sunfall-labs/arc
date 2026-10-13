// Internal: the one path a value thrown to a Solid `<Errored>` takes.
//
// Every Arc boundary (`Component.catchTags`, `catchAll`, `catchDefect`, the
// root boundary `mount` and `embed` install, and each route the outlet
// renders) is an `<Errored>` whose fallback handles what it can and hands the
// rest to the next boundary out, read from context. No fallback rethrows: a
// server render swallows a throw from a fallback (a blank region), so a
// failure no boundary handles ends at the root's defect handler, which logs
// it and renders an opaque view.
import { ResourceFailure } from "@sunfall/arc-core";
import { isServer, type JSX } from "@solidjs/web";
import { Cause, Effect } from "effect";
import { createComponent, createContext, Errored, getOwner, useContext } from "solid-js";

/** Renders a value a boundary caught; `reset` re-renders the boundary's children. */
export type FailureHandler = (thrown: unknown, reset: () => void) => JSX.Element;

/** A boundary's handler: renders what it handles, and passes the rest to `next`. */
export type BoundaryHandler = (
  thrown: unknown,
  reset: () => void,
  next: FailureHandler,
) => JSX.Element;

/** The cause a thrown render value stands for: a failed read's own, else a defect. */
export const defectCause = (thrown: unknown): Cause.Cause<unknown> =>
  thrown instanceof ResourceFailure ? thrown.result.cause : Cause.die(thrown);

/**
 * Logs a defect a boundary renders. A server render logs the original cause
 * where it turns it into its page-safe wire (`render-failure.ts`); what
 * reaches a server boundary is only that wire.
 */
export const logRenderDefect = (cause: Cause.Cause<unknown>): void => {
  if (!isServer) {
    Effect.runSync(Effect.logError("Render failed", cause));
  }
};

/**
 * The server request id a failure carries, if any: an Action transport error's
 * `requestId`, or the `(reference <id>)` an opaque server defect's message ends
 * with. It is the one detail safe to show: it links the user's report to the
 * server log.
 */
export const defectReference = (cause: Cause.Cause<unknown>): string | undefined => {
  for (const reason of cause.reasons) {
    const value: unknown = Cause.isFailReason(reason)
      ? reason.error
      : Cause.isDieReason(reason)
        ? reason.defect
        : undefined;
    if (typeof value !== "object" || value === null) continue;
    const requestId = (value as { readonly requestId?: unknown }).requestId;
    if (typeof requestId === "string") return requestId;
    const message = (value as { readonly message?: unknown }).message;
    const match = typeof message === "string" ? /\(reference ([\w.-]+)\)$/.exec(message) : null;
    if (match !== null) return match[1];
  }
  return undefined;
};

/** What the root renders for a failure nothing handled: nothing about it but its reference. */
const rootHandler: FailureHandler = (thrown) => {
  const cause = defectCause(thrown);
  logRenderDefect(cause);
  const reference = defectReference(cause);
  return reference === undefined
    ? "Something went wrong."
    : `Something went wrong. Reference: ${reference}`;
};

const FailureContext = createContext<FailureHandler>(rootHandler);

/**
 * An `<Errored>` around `children`. With `handle`, it renders through
 * `handle` and is the next boundary for every boundary inside it; without,
 * it hands everything to the next boundary out (a route's boundary, or the
 * root's, whose next is the root defect handler).
 */
export const failureBoundary = (
  handle: BoundaryHandler | undefined,
  children: () => JSX.Element,
): JSX.Element => {
  // A root rendered with no owner (a server render's top level) has no
  // boundary above it.
  const next = getOwner() === null ? rootHandler : useContext(FailureContext);
  const own: FailureHandler =
    handle === undefined ? next : (thrown, reset) => handle(thrown, reset, next);
  return createComponent(Errored, {
    fallback: (error, reset) => own(error(), reset),
    get children() {
      return handle === undefined
        ? children()
        : createComponent(FailureContext, {
            value: own,
            get children() {
              return children();
            },
          });
    },
  });
};
