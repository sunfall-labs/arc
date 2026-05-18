import {
  Route,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
} from "@sunfall/arc-core";
import { Data, Effect } from "effect";
import { hydrateFromDocumentEffect } from "./hydration.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

export interface StartStaticNavigationHydrationRuntime {
  readonly provide: (effect: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>;
}

export interface StartStaticHistoryWindow extends BrowserHistoryWindow {
  readonly location: BrowserHistoryWindow["location"] & {
    readonly href?: string;
    readonly origin?: string;
  };
}

export class StartStaticBasePathError extends Data.TaggedError("StartStaticBasePathError")<{
  readonly input: string;
  readonly guidance: string;
}> {}

export class StartStaticNavigationHydrationError extends Data.TaggedError(
  "StartStaticNavigationHydrationError",
)<{
  readonly href: string;
  readonly browserHref: string;
  readonly reason:
    | "FetchUnavailable"
    | "FetchFailed"
    | "HttpStatus"
    | "ReadFailed"
    | "ParseUnavailable"
    | "ParseFailed"
    | "HydrateFailed";
  readonly status?: number;
  readonly cause?: unknown;
  readonly guidance: string;
}> {}

export interface StartStaticHistoryAdapterOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
> {
  readonly runtime: StartStaticNavigationHydrationRuntime;
  readonly routes: Routes;
  readonly basePath?: string;
  readonly hydratedHrefs?: string | readonly string[];
  readonly getWindow?: () => StartStaticHistoryWindow | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly parseDocument?: (html: string) => Document;
  readonly shouldHydrateHref?: (match: Route.Match<Routes[number]>) => boolean;
}

const absoluteUrlPattern = /^[a-zA-Z][a-zA-Z\d+.-]*:/u;

export const normalizeStartStaticBasePath = (input = "/"): string => {
  const value = input.trim();
  if (value.length === 0 || value === "/") {
    return "/";
  }
  if (value.includes("?") || value.includes("#")) {
    throw new StartStaticBasePathError({
      input,
      guidance: "Static base paths must not include a query string or hash.",
    });
  }
  if (absoluteUrlPattern.test(value) || value.startsWith("//")) {
    throw new StartStaticBasePathError({
      input,
      guidance: "Static base paths must be path-only, such as '/repository-name/'.",
    });
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+/gu, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

export const withStartStaticBasePath = (href: string, basePath = "/"): string => {
  if (!href.startsWith("/") || href.startsWith("//")) {
    return href;
  }

  const normalizedBasePath = normalizeStartStaticBasePath(basePath);
  return normalizedBasePath === "/" ? href : `${normalizedBasePath.slice(0, -1)}${href}`;
};

export const stripStartStaticBasePath = (href: string, basePath = "/"): string => {
  const normalizedBasePath = normalizeStartStaticBasePath(basePath);
  if (normalizedBasePath === "/") {
    return href;
  }

  const url = new URL(href, "https://sunfall-arc.local");
  const basePathWithoutTrailingSlash = normalizedBasePath.slice(0, -1);
  if (url.pathname === basePathWithoutTrailingSlash || url.pathname === normalizedBasePath) {
    return `/${url.search}`;
  }
  if (url.pathname.startsWith(normalizedBasePath)) {
    return `/${url.pathname.slice(normalizedBasePath.length)}${url.search}`;
  }

  return `${url.pathname}${url.search}`;
};

const defaultStaticWindow = (): StartStaticHistoryWindow | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as StartStaticHistoryWindow);

const staticWindowHref = (windowLike: StartStaticHistoryWindow, fallback = "/"): string => {
  const href = `${windowLike.location.pathname}${windowLike.location.search}`;
  return href.length === 0 ? fallback : href;
};

export const currentStartStaticHref = (
  options: {
    readonly basePath?: string;
    readonly fallback?: string;
    readonly getWindow?: () => StartStaticHistoryWindow | undefined;
  } = {},
): string => {
  const windowLike = (options.getWindow ?? defaultStaticWindow)();
  const href = windowLike === undefined ? (options.fallback ?? "/") : staticWindowHref(windowLike);
  return stripStartStaticBasePath(href, options.basePath);
};

const routeNeedsStaticHydration = <R extends AnyRoute>(match: Route.Match<R>): boolean =>
  Route.describePreloadResources(match.route).status !== "none" ||
  Route.describePreloadCollections(match.route).status !== "none";

const staticHydrationError = (
  href: string,
  browserHref: string,
  reason: StartStaticNavigationHydrationError["reason"],
  options: { readonly status?: number; readonly cause?: unknown } = {},
): StartStaticNavigationHydrationError =>
  new StartStaticNavigationHydrationError({
    href,
    browserHref,
    reason,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
    guidance:
      "Static prerendered client navigation must hydrate route-owned payloads from the target HTML before route preload runs.",
  });

const hydratedHrefSet = (
  hrefs: string | readonly string[] | undefined,
  basePath: string,
): Set<string> =>
  new Set(
    (hrefs === undefined ? [] : typeof hrefs === "string" ? [hrefs] : hrefs).map((href) =>
      stripStartStaticBasePath(href, basePath),
    ),
  );

const documentFetchBaseUrl = (windowLike: StartStaticHistoryWindow): string =>
  windowLike.location.href ??
  `${windowLike.location.origin ?? "https://sunfall-arc.local"}${staticWindowHref(windowLike)}`;

const defaultFetch = (): StartStaticHistoryAdapterOptions["fetch"] | undefined =>
  typeof fetch === "function" ? fetch.bind(globalThis) : undefined;

const defaultParseDocument = (): StartStaticHistoryAdapterOptions["parseDocument"] | undefined =>
  typeof DOMParser === "undefined"
    ? undefined
    : (html) => new DOMParser().parseFromString(html, "text/html");

export const makeStartStaticHrefPreparationEffect = <const Routes extends readonly AnyRoute[]>(
  options: StartStaticHistoryAdapterOptions<Routes>,
): ((href: string) => Effect.Effect<void, StartStaticNavigationHydrationError>) => {
  const basePath = normalizeStartStaticBasePath(options.basePath);
  const getWindow = options.getWindow ?? defaultStaticWindow;
  const hydratedHrefs = hydratedHrefSet(options.hydratedHrefs, basePath);
  const shouldHydrateHref = options.shouldHydrateHref ?? routeNeedsStaticHydration;

  return (href) =>
    Effect.gen(function* () {
      if (hydratedHrefs.delete(href)) {
        return;
      }

      const match = yield* Route.matchEffect(options.routes, href).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );
      if (!match || !shouldHydrateHref(match)) {
        return;
      }

      const windowLike = getWindow();
      if (windowLike === undefined) {
        return;
      }

      const browserHref = withStartStaticBasePath(href, basePath);
      const fetchDocument = options.fetch ?? defaultFetch();
      if (!fetchDocument) {
        return yield* Effect.fail(staticHydrationError(href, browserHref, "FetchUnavailable"));
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetchDocument(new URL(browserHref, documentFetchBaseUrl(windowLike)), {
            credentials: "same-origin",
            headers: { accept: "text/html" },
          }),
        catch: (cause) => staticHydrationError(href, browserHref, "FetchFailed", { cause }),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          staticHydrationError(href, browserHref, "HttpStatus", {
            status: response.status,
          }),
        );
      }

      const html = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => staticHydrationError(href, browserHref, "ReadFailed", { cause }),
      });
      const parseDocument = options.parseDocument ?? defaultParseDocument();
      if (!parseDocument) {
        return yield* Effect.fail(staticHydrationError(href, browserHref, "ParseUnavailable"));
      }

      const staticDocument = yield* Effect.try({
        try: () => parseDocument(html),
        catch: (cause) => staticHydrationError(href, browserHref, "ParseFailed", { cause }),
      });
      const hydrateEffect = options.runtime.provide(
        hydrateFromDocumentEffect(staticDocument),
      ) as Effect.Effect<unknown, unknown>;
      yield* hydrateEffect.pipe(
        Effect.asVoid,
        Effect.mapError((cause) =>
          staticHydrationError(href, browserHref, "HydrateFailed", { cause }),
        ),
      );
    });
};

export const makeStartStaticHistoryAdapter = <const Routes extends readonly AnyRoute[]>(
  options: StartStaticHistoryAdapterOptions<Routes>,
): BrowserHistoryAdapter => {
  const basePath = normalizeStartStaticBasePath(options.basePath);
  const getWindow = options.getWindow ?? defaultStaticWindow;
  const prepareHrefEffect = makeStartStaticHrefPreparationEffect({
    ...options,
    basePath,
    getWindow,
  });
  return {
    currentHref: (fallback = "/") => currentStartStaticHref({ basePath, fallback, getWindow }),
    listen: (onChange) => {
      const windowLike = getWindow();
      if (windowLike === undefined) {
        return () => undefined;
      }

      const listener = (): void => {
        onChange(stripStartStaticBasePath(staticWindowHref(windowLike), basePath));
      };
      windowLike.addEventListener("popstate", listener);
      return () => {
        windowLike.removeEventListener("popstate", listener);
      };
    },
    createHref: (href) => withStartStaticBasePath(href, basePath),
    prepareHrefEffect,
    commit: (href, navigateOptions: BrowserNavigateOptions = {}) => {
      const windowLike = getWindow();
      if (windowLike === undefined) {
        return href;
      }

      const browserHref = withStartStaticBasePath(href, basePath);
      if (browserHref !== staticWindowHref(windowLike)) {
        if (navigateOptions.replace) {
          windowLike.history.replaceState(null, "", browserHref);
        } else {
          windowLike.history.pushState(null, "", browserHref);
        }
      }

      return stripStartStaticBasePath(staticWindowHref(windowLike), basePath);
    },
  };
};
