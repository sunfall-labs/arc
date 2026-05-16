import { Effect, Fiber } from "effect";
import type { AnyEffectUiRuntime } from "./runtime.js";
import type { BrowserNavigateOptions } from "./browser-router-history-adapter.js";

/** Mouse event shape used to decide whether a router link should intercept a click. */
export interface BrowserRouterClickEvent {
  readonly defaultPrevented?: boolean;
  readonly button: number;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

/** Returns true for plain primary-button clicks that should stay inside the router. */
export const isPlainLeftClick = (event: BrowserRouterClickEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey;

/** Returns true when anchor attributes intentionally hand navigation to the browser. */
export const opensOutsideRouter = (
  target: string | undefined,
  download: unknown
): boolean =>
  download !== undefined ||
  (target !== undefined && target.length > 0 && target !== "_self");

/** Reason a router-owned link left navigation or preloading to the adapter/browser. */
export type BrowserRouterLinkIgnoreReason =
  | "default-prevented"
  | "preload-disabled"
  | "non-plain-click"
  | "browser-handled"
  | "outside-router";

/** Anchor attributes that affect whether a router link should stay inside the router. */
export interface BrowserRouterLinkTarget {
  /** Anchor target attribute. Non-empty targets other than `_self` are browser-handled. */
  readonly target?: string | undefined;
  /** Anchor download attribute. Any defined value is browser-handled. */
  readonly download?: unknown;
}

/** Facts used by Core to decide whether a link hover should preload. */
export interface BrowserRouterLinkPreloadDecisionOptions extends BrowserRouterLinkTarget {
  /** Whether a framework/user handler already prevented the hover's default behavior. */
  readonly defaultPrevented: boolean;
  /** Resolved RouterLink preload setting. Defaults are adapter-owned before this call. */
  readonly preload: boolean;
  /** Whether the route belongs to the active router provider. */
  readonly canHandleRoute: boolean;
}

/** Adapter-neutral hover preload decision for router-owned links. */
export type BrowserRouterLinkPreloadDecision =
  | { readonly _tag: "Preload" }
  | {
      readonly _tag: "Ignore";
      readonly reason: Exclude<BrowserRouterLinkIgnoreReason, "non-plain-click">;
    };

/** Builds the shared hover preload decision used by framework RouterLink adapters. */
export const browserRouterLinkPreloadDecision = (
  options: BrowserRouterLinkPreloadDecisionOptions
): BrowserRouterLinkPreloadDecision => {
  if (options.defaultPrevented) {
    return { _tag: "Ignore", reason: "default-prevented" };
  }
  if (!options.preload) {
    return { _tag: "Ignore", reason: "preload-disabled" };
  }
  if (opensOutsideRouter(options.target, options.download)) {
    return { _tag: "Ignore", reason: "browser-handled" };
  }
  if (!options.canHandleRoute) {
    return { _tag: "Ignore", reason: "outside-router" };
  }
  return { _tag: "Preload" };
};

/** Facts used by Core to decide whether a link click should navigate in-router. */
export interface BrowserRouterLinkClickDecisionOptions extends BrowserRouterLinkTarget {
  /** Click event facts supplied by the framework adapter after user handlers run. */
  readonly event: BrowserRouterClickEvent;
  /** Href already built from the route definition and current href options. */
  readonly href: string;
  /** Whether in-router navigation should replace the current history entry. */
  readonly replace?: boolean | undefined;
  /** Whether the route belongs to the active router provider. */
  readonly canHandleRoute: boolean;
}

/** Adapter-neutral click decision for router-owned links. */
export type BrowserRouterLinkClickDecision =
  | {
      readonly _tag: "Navigate";
      readonly href: string;
      readonly options?: BrowserNavigateOptions;
    }
  | {
      readonly _tag: "Ignore";
      readonly reason: Exclude<BrowserRouterLinkIgnoreReason, "preload-disabled">;
    };

/** Builds the shared click decision used by framework RouterLink adapters. */
export const browserRouterLinkClickDecision = (
  options: BrowserRouterLinkClickDecisionOptions
): BrowserRouterLinkClickDecision => {
  if (options.event.defaultPrevented === true) {
    return { _tag: "Ignore", reason: "default-prevented" };
  }
  if (!isPlainLeftClick(options.event)) {
    return { _tag: "Ignore", reason: "non-plain-click" };
  }
  if (opensOutsideRouter(options.target, options.download)) {
    return { _tag: "Ignore", reason: "browser-handled" };
  }
  if (!options.canHandleRoute) {
    return { _tag: "Ignore", reason: "outside-router" };
  }
  return {
    _tag: "Navigate",
    href: options.href,
    ...(options.replace === true ? { options: { replace: true } } : {})
  };
};

/** Controls hover preloads for router-owned links. */
export interface BrowserRouterLinkPreloader {
  /** Starts a fresh preload, interrupting any previous hover preload first. */
  preload(): void;
  /** Interrupts the active hover preload, when one is running. */
  interrupt(): void;
}

/** Options for the framework-neutral router link preload policy. */
export interface BrowserRouterLinkPreloaderOptions<ER = unknown> {
  /** Runtime that owns route preload execution and interruption. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /** Dynamic gate for disabled preloads or links outside this router. */
  readonly enabled: () => boolean;
  /** Builds the current route preload Effect when hover starts. */
  readonly preloadEffect: () => Effect.Effect<void, unknown, unknown>;
}

/**
 * Creates the shared hover-preload policy used by framework link adapters.
 *
 * The policy interrupts stale hover work, swallows fire-and-forget failures, and
 * clears only the latest fiber when preloads race.
 */
export const makeBrowserRouterLinkPreloader = <ER>(
  options: BrowserRouterLinkPreloaderOptions<ER>
): BrowserRouterLinkPreloader => {
  let revision = 0;
  let preloadFiber: Fiber.Fiber<void, unknown> | undefined;

  const interrupt = (): void => {
    const fiber = preloadFiber;
    if (!fiber) {
      return;
    }
    preloadFiber = undefined;
    void options.runtime.runFork(
      Fiber.interrupt(fiber).pipe(Effect.catch(() => Effect.void))
    );
  };

  const preload = (): void => {
    if (!options.enabled()) {
      return;
    }
    interrupt();
    const currentRevision = ++revision;
    preloadFiber = options.runtime.runFork(
      options.preloadEffect().pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => {
          if (revision === currentRevision) {
            preloadFiber = undefined;
          }
        }))
      )
    );
  };

  return { interrupt, preload };
};
