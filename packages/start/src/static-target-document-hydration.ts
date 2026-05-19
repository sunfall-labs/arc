import { Data, Effect } from "effect";
import { hydrateFromDocumentEffect } from "./hydration.js";
import {
  startStaticHydratedHrefPreparationOutcomeEffect,
  type StartStaticHrefPreparationOutcome,
  type StartStaticNavigationHydrationRuntime,
} from "./static-href-preparation-cache.js";

export interface StartStaticTargetDocumentWindow {
  readonly location: {
    readonly pathname: string;
    readonly search: string;
    readonly href?: string;
    readonly origin?: string;
  };
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

export interface StartStaticTargetDocumentHydrationOptions<RuntimeError = unknown> {
  readonly runtime: StartStaticNavigationHydrationRuntime<RuntimeError>;
  readonly href: string;
  readonly browserHref: string;
  readonly window: StartStaticTargetDocumentWindow;
  readonly fetch?: typeof globalThis.fetch;
  readonly parseDocument?: (html: string) => Document;
}

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

const staticWindowHref = (windowLike: StartStaticTargetDocumentWindow, fallback = "/"): string => {
  const href = `${windowLike.location.pathname}${windowLike.location.search}`;
  return href.length === 0 ? fallback : href;
};

const documentFetchBaseUrl = (windowLike: StartStaticTargetDocumentWindow): string =>
  windowLike.location.href ??
  `${windowLike.location.origin ?? "https://sunfall-arc.local"}${staticWindowHref(windowLike)}`;

const defaultFetch = (): StartStaticTargetDocumentHydrationOptions["fetch"] | undefined =>
  typeof fetch === "function" ? fetch.bind(globalThis) : undefined;

const defaultParseDocument = ():
  | StartStaticTargetDocumentHydrationOptions["parseDocument"]
  | undefined =>
  typeof DOMParser === "undefined"
    ? undefined
    : (html) => new DOMParser().parseFromString(html, "text/html");

export const hydrateStartStaticTargetDocumentEffect = <RuntimeError = unknown>(
  options: StartStaticTargetDocumentHydrationOptions<RuntimeError>,
): Effect.Effect<StartStaticHrefPreparationOutcome, StartStaticNavigationHydrationError> =>
  Effect.gen(function* () {
    const fetchDocument = options.fetch ?? defaultFetch();
    if (!fetchDocument) {
      return yield* Effect.fail(
        staticHydrationError(options.href, options.browserHref, "FetchUnavailable"),
      );
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchDocument(new URL(options.browserHref, documentFetchBaseUrl(options.window)), {
          credentials: "same-origin",
          headers: { accept: "text/html" },
        }),
      catch: (cause) =>
        staticHydrationError(options.href, options.browserHref, "FetchFailed", { cause }),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        staticHydrationError(options.href, options.browserHref, "HttpStatus", {
          status: response.status,
        }),
      );
    }

    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        staticHydrationError(options.href, options.browserHref, "ReadFailed", { cause }),
    });
    const parseDocument = options.parseDocument ?? defaultParseDocument();
    if (!parseDocument) {
      return yield* Effect.fail(
        staticHydrationError(options.href, options.browserHref, "ParseUnavailable"),
      );
    }

    const staticDocument = yield* Effect.try({
      try: () => parseDocument(html),
      catch: (cause) =>
        staticHydrationError(options.href, options.browserHref, "ParseFailed", { cause }),
    });
    const hydrateEffect = options.runtime.provide(
      hydrateFromDocumentEffect(staticDocument).pipe(
        Effect.flatMap(startStaticHydratedHrefPreparationOutcomeEffect),
      ),
    ) as Effect.Effect<StartStaticHrefPreparationOutcome, unknown>;
    return yield* hydrateEffect.pipe(
      Effect.mapError((cause) =>
        staticHydrationError(options.href, options.browserHref, "HydrateFailed", { cause }),
      ),
    );
  });
