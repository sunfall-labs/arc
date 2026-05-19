import {
  Resource,
  Route,
  type BrowserHistoryAdapter,
  type BrowserHistoryWindow,
  type BrowserNavigateOptions,
  type ResourceStoreEvent,
} from "@sunfall/arc-core";
import { Data, Effect, Exit, Fiber, PubSub, Scope } from "effect";
import { hydrateFromDocumentEffect, type StartHydrationPayload } from "./hydration.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

export interface StartStaticNavigationHydrationRuntime<RuntimeError = unknown> {
  readonly provide: (effect: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>;
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, never>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E | RuntimeError>;
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

type StartStaticHrefPreparationOutcome =
  | { readonly _tag: "Hydrated"; readonly refs: ReadonlyArray<Resource.AnyRef> }
  | { readonly _tag: "NoHydrationNeeded" }
  | { readonly _tag: "EnvironmentUnavailable" };

type StartStaticPreparedHref = Exclude<
  StartStaticHrefPreparationOutcome,
  { readonly _tag: "EnvironmentUnavailable" }
>;

type StartStaticHrefPreparationFiber<RuntimeError> = Fiber.Fiber<
  StartStaticHrefPreparationOutcome,
  StartStaticNavigationHydrationError | RuntimeError
>;

const startStaticHrefPreparationOutcomeCacheable = (
  outcome: StartStaticHrefPreparationOutcome,
): outcome is StartStaticPreparedHref =>
  outcome._tag === "NoHydrationNeeded" || (outcome._tag === "Hydrated" && outcome.refs.length > 0);

const isResolvedStartStaticHydratedResourceRef = (
  ref: Resource.AnyRef | undefined,
): ref is Resource.AnyRef => ref !== undefined;

const resolveStartStaticHydratedResourceRefsEffect = (
  payload: StartHydrationPayload | undefined,
): Effect.Effect<ReadonlyArray<Resource.AnyRef>> =>
  Effect.forEach(payload?.resources ?? [], (snapshot) =>
    Resource.definitionEffect(snapshot.name).pipe(
      Effect.flatMap((family) =>
        family === undefined
          ? Effect.succeed(undefined)
          : Effect.sync(() => {
              const ref = family.ref(snapshot.input);
              return ref.key === snapshot.key ? ref : undefined;
            }),
      ),
    ),
  ).pipe(Effect.map((refs) => refs.filter(isResolvedStartStaticHydratedResourceRef)));

const startStaticPreparedHrefReusableEffect = (
  prepared: StartStaticPreparedHref,
): Effect.Effect<boolean> => {
  switch (prepared._tag) {
    case "NoHydrationNeeded":
      return Effect.succeed(true);
    case "Hydrated":
      return Effect.forEach(prepared.refs, (ref) =>
        Resource.statusEffect(ref).pipe(
          Effect.map((status) => status.isSuccess && !status.isStale && !status.isGcExpired),
        ),
      ).pipe(Effect.map((statuses) => statuses.every(Boolean)));
  }
};

const startStaticPreparedHrefInvalidatedByResourceEvent = (event: ResourceStoreEvent): boolean =>
  event._tag === "ResourceInvalidated" || event._tag === "ResourceDeleted";

const watchStartStaticPreparedHrefInvalidationsEffect = (
  initialHydratedHrefs: Set<string>,
  preparedHrefs: Map<string, StartStaticPreparedHref>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Resource.subscribeEventsEffect();
    yield* Effect.forever(
      PubSub.take(events).pipe(
        Effect.tap((event) =>
          startStaticPreparedHrefInvalidatedByResourceEvent(event)
            ? Effect.sync(() => {
                initialHydratedHrefs.clear();
                preparedHrefs.clear();
              })
            : Effect.void,
        ),
      ),
    );
  });

export const makeStartStaticHrefPreparationEffect = <
  const Routes extends readonly AnyRoute[],
  RuntimeError = unknown,
>(
  options: StartStaticHistoryAdapterOptions<Routes, RuntimeError>,
): ((href: string) => Effect.Effect<void, StartStaticNavigationHydrationError | RuntimeError>) => {
  const basePath = normalizeStartStaticBasePath(options.basePath);
  const getWindow = options.getWindow ?? defaultStaticWindow;
  const initialHydratedHrefs = hydratedHrefSet(options.hydratedHrefs, basePath);
  const preparedHrefs = new Map<string, StartStaticPreparedHref>();
  const inFlightPreparations = new Map<string, StartStaticHrefPreparationFiber<RuntimeError>>();
  const shouldHydrateHref = options.shouldHydrateHref ?? routeNeedsStaticHydration;
  void options.runtime.runFork(
    Effect.scoped(
      watchStartStaticPreparedHrefInvalidationsEffect(initialHydratedHrefs, preparedHrefs),
    ),
  );

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
        Effect.gen(function* () {
          const payload = yield* hydrateFromDocumentEffect(staticDocument);
          return yield* resolveStartStaticHydratedResourceRefsEffect(payload);
        }),
      ) as Effect.Effect<ReadonlyArray<Resource.AnyRef>, unknown>;
      const refs = yield* hydrateEffect.pipe(
        Effect.mapError((cause) =>
          staticHydrationError(href, browserHref, "HydrateFailed", { cause }),
        ),
      );
      return { _tag: "Hydrated", refs };
    });

  const rememberPreparationExit = (
    href: string,
    fiber: StartStaticHrefPreparationFiber<RuntimeError>,
    exit: Exit.Exit<
      StartStaticHrefPreparationOutcome,
      StartStaticNavigationHydrationError | RuntimeError
    >,
  ): void => {
    if (inFlightPreparations.get(href) === fiber) {
      inFlightPreparations.delete(href);
    }
    if (Exit.isSuccess(exit) && startStaticHrefPreparationOutcomeCacheable(exit.value)) {
      preparedHrefs.set(href, exit.value);
    }
  };

  const finishPreparationEffect = (
    href: string,
    fiber: StartStaticHrefPreparationFiber<RuntimeError>,
  ): Effect.Effect<void> =>
    Fiber.await(fiber).pipe(
      Effect.tap((exit) => Effect.sync(() => rememberPreparationExit(href, fiber, exit))),
      Effect.asVoid,
      Effect.catchCause(() => Effect.void),
    );

  const prepareHrefFiber = (href: string): StartStaticHrefPreparationFiber<RuntimeError> => {
    const inFlightPreparation = inFlightPreparations.get(href);
    if (inFlightPreparation) {
      return inFlightPreparation;
    }

    // Route-link hover preloads may be interrupted when UI remounts. The actual
    // static document hydration is host-owned so a later click can join it.
    const fiber = options.runtime.runFork(hydrateStaticHref(href));
    inFlightPreparations.set(href, fiber);
    void options.runtime.runFork(finishPreparationEffect(href, fiber));
    return fiber;
  };

  return (href) =>
    Effect.gen(function* () {
      if (initialHydratedHrefs.delete(href)) {
        return;
      }

      const prepared = preparedHrefs.get(href);
      if (prepared !== undefined) {
        const reusableEffect = options.runtime.provide(
          startStaticPreparedHrefReusableEffect(prepared),
        ) as Effect.Effect<boolean, RuntimeError>;
        const reusable = yield* reusableEffect;
        if (reusable) {
          return;
        }
        preparedHrefs.delete(href);
      }

      const fiber = yield* Effect.sync(() => prepareHrefFiber(href));
      const exit = yield* Fiber.await(fiber);
      yield* Effect.sync(() => rememberPreparationExit(href, fiber, exit));
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
