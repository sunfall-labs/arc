import {
  Route,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
} from "@sunfall/arc-core";
import { Data, Effect } from "effect";
import {
  makeStartStaticHrefPreparationCache,
  type StartStaticHrefPreparationOutcome,
  type StartStaticNavigationHydrationRuntime,
} from "./static-href-preparation-cache.js";
import {
  hydrateStartStaticTargetDocumentEffect,
  type StartStaticNavigationHydrationError,
} from "./static-target-document-hydration.js";

export type { StartStaticNavigationHydrationRuntime } from "./static-href-preparation-cache.js";
export { StartStaticNavigationHydrationError } from "./static-target-document-hydration.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

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

export interface StartStaticHistoryAdapterOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  RuntimeError = unknown,
> {
  readonly runtime: StartStaticNavigationHydrationRuntime<RuntimeError>;
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

const hydratedHrefSet = (
  hrefs: string | readonly string[] | undefined,
  basePath: string,
): Set<string> =>
  new Set(
    (hrefs === undefined ? [] : typeof hrefs === "string" ? [hrefs] : hrefs).map((href) =>
      stripStartStaticBasePath(href, basePath),
    ),
  );

export const makeStartStaticHrefPreparationEffect = <
  const Routes extends readonly AnyRoute[],
  RuntimeError = unknown,
>(
  options: StartStaticHistoryAdapterOptions<Routes, RuntimeError>,
): ((href: string) => Effect.Effect<void, StartStaticNavigationHydrationError | RuntimeError>) => {
  const basePath = normalizeStartStaticBasePath(options.basePath);
  const getWindow = options.getWindow ?? defaultStaticWindow;
  const shouldHydrateHref = options.shouldHydrateHref ?? routeNeedsStaticHydration;

  const hydrateStaticHref = (
    href: string,
  ): Effect.Effect<StartStaticHrefPreparationOutcome, StartStaticNavigationHydrationError> =>
    Effect.gen(function* () {
      const match = yield* Route.matchEffect(options.routes, href).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );
      if (!match || !shouldHydrateHref(match)) {
        return { _tag: "NoHydrationNeeded" };
      }

      const windowLike = getWindow();
      if (windowLike === undefined) {
        return { _tag: "EnvironmentUnavailable" };
      }

      const browserHref = withStartStaticBasePath(href, basePath);
      return yield* hydrateStartStaticTargetDocumentEffect({
        runtime: options.runtime,
        href,
        browserHref,
        window: windowLike,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.parseDocument === undefined ? {} : { parseDocument: options.parseDocument }),
      });
    });

  return makeStartStaticHrefPreparationCache({
    runtime: options.runtime,
    initialHydratedHrefs: hydratedHrefSet(options.hydratedHrefs, basePath),
    prepareHrefEffect: hydrateStaticHref,
  });
};

export const makeStartStaticHistoryAdapter = <
  const Routes extends readonly AnyRoute[],
  RuntimeError = unknown,
>(
  options: StartStaticHistoryAdapterOptions<Routes, RuntimeError>,
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
