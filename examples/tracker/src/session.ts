import { Resource, Route } from "@sunfall/arc-core";
import { Effect } from "effect";
import { CurrentUserRef, ProjectsRef, TeamRef } from "./resources.js";

/** The sign-in page's href, coming back to `next` afterwards. */
export const signInHref = (next: string): string =>
  next === "/" ? "/signin" : `/signin?${new URLSearchParams({ next })}`;

/**
 * Only same-site paths are redirect targets: `/projects/TRK`, never
 * `https://elsewhere` or `//elsewhere`.
 */
export const safeRedirect = (next: string | undefined): string =>
  next !== undefined && next.startsWith("/") && !next.startsWith("//") ? next : "/";

/**
 * The signed-in user, or a redirect to the sign-in page that comes back to
 * `href`. Every page but the sign-in page preloads through this.
 */
export const requireSession = (href: string) =>
  Resource.preload(CurrentUserRef).pipe(
    Effect.flatMap((user) =>
      user === null ? Route.redirect(signInHref(href)) : Effect.succeed(user),
    ),
  );

/**
 * What every signed-in page shows around its content: the session, the
 * project navigation, and the team. Loaded before the page's own data, so a
 * page that turns out not to exist (a 404) still renders inside the shell.
 */
export const preloadShell = (href: string) =>
  requireSession(href).pipe(Effect.andThen(Resource.preload([ProjectsRef, TeamRef])));

/**
 * Maps the domain's "this does not exist" and "you are not signed in" to
 * route verdicts: a 404 page and the sign-in redirect.
 */
export const routeVerdicts =
  (href: string) =>
  <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchIf(
        (error): error is Extract<E, { readonly _tag: "ProjectNotFound" | "IssueNotFound" }> =>
          error._tag === "ProjectNotFound" || error._tag === "IssueNotFound",
        () => Route.notFound(),
      ),
      Effect.catchIf(
        (error): error is Extract<E, { readonly _tag: "Unauthenticated" }> =>
          (error as { readonly _tag: string })._tag === "Unauthenticated",
        () => Route.redirect(signInHref(href)),
      ),
    );
