import {
  Resource,
  Route,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
} from "@sunfall/arc-core";
import { lookupResourceFamily, matchRoutes } from "@sunfall/arc-core/internal";
import { Data, Effect, Exit, Fiber, PubSub } from "effect";
import { hydrateFromDocument } from "./hydration.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

export interface StartStaticHistoryWindow extends BrowserHistoryWindow {
  readonly location: BrowserHistoryWindow["location"] & {
    readonly href?: string;
    readonly origin?: string;
  };
}

/** Runtime that owns static navigation hydration (an Arc runtime satisfies it). */
export interface StartStaticNavigationHydrationRuntime<RuntimeError = unknown> {
  readonly provide: (effect: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>;
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, never>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E | RuntimeError>;
}

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

const startStaticRouterHref = (pathname: string, search: string): string => {
  const path = pathname.length === 0 ? "/" : pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${path.length > 1 ? path.replace(/\/+$/u, "") : path}${search}`;
};

export const stripStartStaticBasePath = (href: string, basePath = "/"): string => {
  const normalizedBasePath = normalizeStartStaticBasePath(basePath);
  const url = new URL(href, "https://sunfall-arc.local");
  if (normalizedBasePath === "/") {
    return startStaticRouterHref(url.pathname, url.search);
  }

  const basePathWithoutTrailingSlash = normalizedBasePath.slice(0, -1);
  if (url.pathname === basePathWithoutTrailingSlash || url.pathname === normalizedBasePath) {
    return startStaticRouterHref("/", url.search);
  }
  if (url.pathname.startsWith(normalizedBasePath)) {
    return startStaticRouterHref(url.pathname.slice(normalizedBasePath.length), url.search);
  }

  return startStaticRouterHref(url.pathname, url.search);
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
  Route.describePreloadResources(match.route).status !== "none";

/**
 * How an href was prepared. `Hydrated` keeps the hydrated refs so a later
 * navigation can reuse the preparation while they stay fresh;
 * `EnvironmentUnavailable` (no window) is never cached.
 */
type Preparation =
  | { readonly _tag: "Hydrated"; readonly refs: ReadonlyArray<Resource.AnyRef> }
  | { readonly _tag: "NoHydrationNeeded" }
  | { readonly _tag: "EnvironmentUnavailable" };

const hydratedPreparation = (
  payload: Resource.HydrationPayload | undefined,
): Effect.Effect<Preparation> =>
  Effect.forEach(payload?.resources ?? [], (snapshot) =>
    lookupResourceFamily(snapshot.name).pipe(
      Effect.map((family) => {
        const ref = family?.ref(snapshot.input);
        return ref !== undefined && ref.key === snapshot.key ? [ref] : [];
      }),
    ),
  ).pipe(Effect.map((refs) => ({ _tag: "Hydrated", refs: refs.flat() })));

const preparationReusable = (prepared: Preparation): Effect.Effect<boolean> =>
  prepared._tag !== "Hydrated"
    ? Effect.succeed(true)
    : Effect.forEach(prepared.refs, (ref) =>
        Resource.status(ref).pipe(
          Effect.map(
            (status) => status.result._tag === "Success" && !status.isStale && !status.isGcExpired,
          ),
        ),
      ).pipe(Effect.map((statuses) => statuses.every(Boolean)));

/** Fetches the target static document and hydrates its route payload into the runtime. */
const hydrateTargetDocument = <RuntimeError>(
  options: Pick<
    StartStaticHistoryAdapterOptions<readonly AnyRoute[], RuntimeError>,
    "runtime" | "fetch" | "parseDocument"
  >,
  windowLike: StartStaticHistoryWindow,
  href: string,
  browserHref: string,
): Effect.Effect<Preparation, StartStaticNavigationHydrationError> => {
  const fail = (
    reason: StartStaticNavigationHydrationError["reason"],
    extra: { readonly status?: number; readonly cause?: unknown } = {},
  ) =>
    new StartStaticNavigationHydrationError({
      href,
      browserHref,
      reason,
      ...extra,
      guidance:
        "Static prerendered client navigation must hydrate route-owned payloads from the target HTML before route preload runs.",
    });

  return Effect.gen(function* () {
    const fetchDocument =
      options.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
    if (!fetchDocument) {
      return yield* Effect.fail(fail("FetchUnavailable"));
    }
    const baseUrl =
      windowLike.location.href ??
      `${windowLike.location.origin ?? "https://sunfall-arc.local"}${staticWindowHref(windowLike)}`;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetchDocument(new URL(browserHref, baseUrl), {
          credentials: "same-origin",
          headers: { accept: "text/html" },
        }),
      catch: (cause) => fail("FetchFailed", { cause }),
    });
    if (!response.ok) {
      return yield* Effect.fail(fail("HttpStatus", { status: response.status }));
    }
    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => fail("ReadFailed", { cause }),
    });
    const parseDocument =
      options.parseDocument ??
      (typeof DOMParser === "undefined"
        ? undefined
        : (text: string) => new DOMParser().parseFromString(text, "text/html"));
    if (!parseDocument) {
      return yield* Effect.fail(fail("ParseUnavailable"));
    }
    const document = yield* Effect.try({
      try: () => parseDocument(html),
      catch: (cause) => fail("ParseFailed", { cause }),
    });
    const hydrate = options.runtime.provide(
      hydrateFromDocument(document, { timestamp: "now", skipFresh: true }).pipe(
        Effect.flatMap(hydratedPreparation),
      ),
    ) as Effect.Effect<Preparation, unknown>;
    return yield* hydrate.pipe(Effect.mapError((cause) => fail("HydrateFailed", { cause })));
  });
};

/**
 * Builds `prepareHref`, which hydrates the target static document before
 * route preload runs. Preparations run on the app runtime, so concurrent and
 * interrupted callers share one fetch per href. Successful preparations are
 * reused while their hydrated Resources stay fresh; any Resource invalidation
 * or deletion drops them (and the initial hydrated hrefs).
 */
const makeStaticHrefPreparation = <Routes extends readonly AnyRoute[], RuntimeError>(
  options: StartStaticHistoryAdapterOptions<Routes, RuntimeError>,
  basePath: string,
  getWindow: () => StartStaticHistoryWindow | undefined,
): ((href: string) => Effect.Effect<void, StartStaticNavigationHydrationError | RuntimeError>) => {
  type PreparationFiber = Fiber.Fiber<
    Preparation,
    StartStaticNavigationHydrationError | RuntimeError
  >;
  const shouldHydrateHref = options.shouldHydrateHref ?? routeNeedsStaticHydration;
  const hydratedHrefs = options.hydratedHrefs ?? [];
  const initialHydratedHrefs = new Set(
    (typeof hydratedHrefs === "string" ? [hydratedHrefs] : hydratedHrefs).map((href) =>
      stripStartStaticBasePath(href, basePath),
    ),
  );
  const prepared = new Map<string, Preparation>();
  const inFlight = new Map<string, PreparationFiber>();

  void options.runtime.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* Resource.subscribeEvents();
        yield* Effect.forever(
          PubSub.take(events).pipe(
            Effect.tap((event) =>
              event._tag === "ResourceInvalidated" || event._tag === "ResourceDeleted"
                ? Effect.sync(() => {
                    initialHydratedHrefs.clear();
                    prepared.clear();
                  })
                : Effect.void,
            ),
          ),
        );
      }),
    ),
  );

  const prepare = (href: string): Effect.Effect<Preparation, StartStaticNavigationHydrationError> =>
    Effect.gen(function* () {
      const match = yield* matchRoutes(options.routes, href).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );
      if (!match || !shouldHydrateHref(match)) {
        return { _tag: "NoHydrationNeeded" } as const;
      }
      const windowLike = getWindow();
      if (windowLike === undefined) {
        return { _tag: "EnvironmentUnavailable" } as const;
      }
      return yield* hydrateTargetDocument(
        options,
        windowLike,
        href,
        withStartStaticBasePath(href, basePath),
      );
    });

  const remember = (
    href: string,
    fiber: PreparationFiber,
    exit: Exit.Exit<Preparation, unknown>,
  ): void => {
    if (inFlight.get(href) === fiber) {
      inFlight.delete(href);
    }
    if (
      Exit.isSuccess(exit) &&
      (exit.value._tag === "NoHydrationNeeded" ||
        (exit.value._tag === "Hydrated" && exit.value.refs.length > 0))
    ) {
      prepared.set(href, exit.value);
    }
  };

  const preparationFiber = (href: string): PreparationFiber => {
    const existing = inFlight.get(href);
    if (existing) {
      return existing;
    }
    const fiber = options.runtime.runFork(prepare(href));
    inFlight.set(href, fiber);
    // Records the outcome even when every caller was interrupted.
    void options.runtime.runFork(
      Fiber.await(fiber).pipe(
        Effect.flatMap((exit) => Effect.sync(() => remember(href, fiber, exit))),
      ),
    );
    return fiber;
  };

  return (href) =>
    Effect.gen(function* () {
      if (initialHydratedHrefs.delete(href)) {
        return;
      }
      const cached = prepared.get(href);
      if (cached !== undefined) {
        const reusable = yield* options.runtime.provide(
          preparationReusable(cached),
        ) as Effect.Effect<boolean, RuntimeError>;
        if (reusable) {
          return;
        }
        prepared.delete(href);
      }
      const fiber = yield* Effect.sync(() => preparationFiber(href));
      const exit = yield* Fiber.await(fiber);
      remember(href, fiber, exit);
      if (Exit.isFailure(exit)) {
        return yield* Effect.failCause(exit.cause);
      }
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
    prepareHref: makeStaticHrefPreparation(options, basePath, getWindow),
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
