import { Route, type BrowserHistoryAdapter } from "@sunfall/arc-core";
import { hydrateFromDocumentEffect } from "@sunfall/arc-start";
import { Data, Effect } from "effect";
import {
  normalizeDocsSiteBasePath,
  stripDocsSiteBasePath,
  withDocsSiteBasePath,
} from "./base-path.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

interface DocsHydrationRuntime {
  readonly provide: (effect: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>;
}

export class DocsStaticPageHydrationError extends Data.TaggedError("DocsStaticPageHydrationError")<{
  readonly href: string;
  readonly browserHref: string;
  readonly reason: "FetchFailed" | "HttpStatus" | "ReadFailed" | "ParseFailed" | "HydrateFailed";
  readonly status?: number;
  readonly cause?: unknown;
  readonly guidance: string;
}> {}

export interface DocsSiteHistoryAdapterOptions {
  readonly runtime?: unknown;
  readonly routes?: readonly AnyRoute[];
  readonly hydratedHrefs?: readonly string[];
}

export const docsSiteBasePath = normalizeDocsSiteBasePath(import.meta.env.BASE_URL);

export const docsSiteHref = (href: string): string => withDocsSiteBasePath(href, docsSiteBasePath);

const currentBrowserHref = (): string => `${window.location.pathname}${window.location.search}`;

export const currentDocsSiteHref = (fallback = "/"): string =>
  typeof window === "undefined"
    ? stripDocsSiteBasePath(fallback, docsSiteBasePath)
    : stripDocsSiteBasePath(currentBrowserHref(), docsSiteBasePath);

const docsStaticPageHydrationError = (
  href: string,
  browserHref: string,
  reason: DocsStaticPageHydrationError["reason"],
  options: { readonly status?: number; readonly cause?: unknown } = {},
): DocsStaticPageHydrationError =>
  new DocsStaticPageHydrationError({
    href,
    browserHref,
    reason,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
    guidance:
      "GitHub Pages client navigation must hydrate route-owned Resource data from the prerendered static HTML before route preload runs.",
  });

const canPrepareStaticHref = (): boolean =>
  typeof window !== "undefined" &&
  typeof fetch !== "undefined" &&
  typeof DOMParser !== "undefined" &&
  typeof document !== "undefined";

const docsHydrationRuntime = (runtime: unknown): DocsHydrationRuntime | undefined =>
  typeof runtime === "object" &&
  runtime !== null &&
  typeof (runtime as { readonly provide?: unknown }).provide === "function"
    ? (runtime as DocsHydrationRuntime)
    : undefined;

const routeStaticPreloadFamilies = (
  href: string,
  routes: readonly AnyRoute[] | undefined,
): readonly string[] => {
  if (!routes) {
    return [];
  }

  const match = Effect.runSync(
    Route.matchEffect(routes, href).pipe(Effect.catch(() => Effect.succeed(undefined))),
  );
  if (!match) {
    return [];
  }

  return Route.preloadResourceFamilies(match.route);
};

const hydrateStaticDocumentEffect = (
  staticDocument: Document,
  href: string,
  browserHref: string,
  runtime: DocsHydrationRuntime,
): Effect.Effect<void, DocsStaticPageHydrationError> => {
  const hydrateEffect = runtime.provide(hydrateFromDocumentEffect(staticDocument)) as Effect.Effect<
    unknown,
    unknown
  >;
  return hydrateEffect.pipe(
    Effect.asVoid,
    Effect.mapError((cause) =>
      docsStaticPageHydrationError(href, browserHref, "HydrateFailed", { cause }),
    ),
  );
};

const prepareStaticPageHydrationEffect = (
  href: string,
  options: DocsSiteHistoryAdapterOptions,
): Effect.Effect<void, DocsStaticPageHydrationError> =>
  Effect.gen(function* () {
    const runtime = docsHydrationRuntime(options.runtime);
    if (!canPrepareStaticHref() || !runtime) {
      return;
    }

    const preloadFamilies = routeStaticPreloadFamilies(href, options.routes);
    if (preloadFamilies.length === 0) {
      return;
    }

    const browserHref = docsSiteHref(href);
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(new URL(browserHref, window.location.href), {
          credentials: "same-origin",
          headers: { accept: "text/html" },
        }),
      catch: (cause) => docsStaticPageHydrationError(href, browserHref, "FetchFailed", { cause }),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        docsStaticPageHydrationError(href, browserHref, "HttpStatus", {
          status: response.status,
        }),
      );
    }

    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => docsStaticPageHydrationError(href, browserHref, "ReadFailed", { cause }),
    });
    const staticDocument = yield* Effect.try({
      try: () => new DOMParser().parseFromString(html, "text/html"),
      catch: (cause) => docsStaticPageHydrationError(href, browserHref, "ParseFailed", { cause }),
    });

    yield* hydrateStaticDocumentEffect(staticDocument, href, browserHref, runtime);
    return yield* Effect.void;
  });

export const makeDocsSiteHistoryAdapter = (
  options: DocsSiteHistoryAdapterOptions = {},
): BrowserHistoryAdapter => {
  const hydratedHrefs = new Set(options.hydratedHrefs ?? []);

  return {
    currentHref: currentDocsSiteHref,
    listen: (onChange) => {
      if (typeof window === "undefined") {
        return () => undefined;
      }

      const listener = (): void => {
        onChange(currentDocsSiteHref());
      };
      window.addEventListener("popstate", listener);
      return () => {
        window.removeEventListener("popstate", listener);
      };
    },
    createHref: docsSiteHref,
    prepareHrefEffect: (href) => {
      if (hydratedHrefs.delete(href)) {
        return Effect.void;
      }
      return prepareStaticPageHydrationEffect(href, options);
    },
    commit: (href, options = {}) => {
      if (typeof window === "undefined") {
        return href;
      }

      const browserHref = docsSiteHref(href);
      if (browserHref !== currentBrowserHref()) {
        if (options.replace) {
          window.history.replaceState(null, "", browserHref);
        } else {
          window.history.pushState(null, "", browserHref);
        }
      }

      return currentDocsSiteHref();
    },
  };
};
