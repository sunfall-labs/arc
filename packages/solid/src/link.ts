import { Route } from "@sunfall/arc-core";
import {
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  isPlainLeftClick as coreIsPlainLeftClick,
  makeBrowserRouterLinkPreloader,
  type BrowserRouterLinkPreloader,
} from "@sunfall/arc-core/internal";
import {
  createComponent,
  createRenderEffect,
  getOwner,
  merge,
  omit,
  onCleanup,
  runWithOwner,
  untrack,
} from "solid-js";
import { dynamic, isServer, type JSX } from "@solidjs/web";
import { Effect } from "effect";
import { useRouter } from "./router.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

type RouterLinkRouteOptions<R extends AnyRoute> =
  {} extends Route.Params<R>
    ? { readonly options?: Route.HrefOptions<R> }
    : { readonly options: Route.HrefOptions<R> };

type AnchorEvent<E extends Event> = E & {
  readonly currentTarget: HTMLAnchorElement;
  readonly target: Element;
};

type AnchorHandler<E extends Event> = JSX.EventHandlerUnion<HTMLAnchorElement, E>;

/** Props for a typed router-owned anchor. */
export type RouterLinkProps<R extends AnyRoute> = Omit<
  JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> &
  RouterLinkRouteOptions<R> & {
    /** Route definition to build and navigate to. */
    readonly route: R;
    /** Replace the current history entry on plain left-click navigation. */
    readonly replace?: boolean;
    /** Preload the route on hover or focus. Enabled by default. */
    readonly preload?: boolean;
  };

/** Returns true for clicks that should be handled by the client router. */
export const isPlainLeftClick = coreIsPlainLeftClick;

const hrefArgs = <R extends AnyRoute>(
  options: Route.HrefOptions<R> | undefined,
): Route.HrefArgs<R> => (options === undefined ? [] : [options]) as Route.HrefArgs<R>;

const callAnchorHandler = <E extends Event>(
  handler: AnchorHandler<E> | undefined,
  event: AnchorEvent<E>,
): void => {
  if (!handler) {
    return;
  }
  if (typeof handler === "function") {
    handler(event);
    return;
  }
  if (Array.isArray(handler)) {
    handler[0](handler[1], event);
  }
};

// One static anchor factory for every link: no per-link `<Dynamic>` memos.
const Anchor = dynamic(() => "a", { static: true }) as (
  props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
) => JSX.Element;

/**
 * Typed Solid anchor that builds hrefs, preloads on hover or focus, and
 * navigates on plain clicks.
 *
 * A link costs one anchor and its attribute bindings. The server renders a
 * plain `<a href>`. In the browser, the preloader, and the effect that
 * interrupts its work when the link's href or target changes, are created on
 * the first hover or focus, so a list of links nobody points at holds none.
 */
export const RouterLink = <R extends AnyRoute>(props: RouterLinkProps<R>): JSX.Element => {
  const anchorProps = omit(
    props,
    "route",
    "options",
    "replace",
    "preload",
    "onClick",
    "onMouseEnter",
    "onFocus",
  ) as Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
  const router = useRouter();
  const routeHref = (): string =>
    Route.href<R>(props.route, ...hrefArgs(props.options as Route.HrefOptions<R> | undefined));
  const href = {
    get href() {
      return router.createHref(routeHref());
    },
  };
  if (isServer) {
    return createComponent(Anchor, merge(anchorProps, href));
  }

  const owner = getOwner();
  const target = (): string | undefined =>
    typeof props.target === "string" ? props.target : undefined;
  const preloadDecision = (defaultPrevented: boolean) =>
    browserRouterLinkPreloadDecision({
      defaultPrevented,
      preload: props.preload !== false,
      canHandleRoute: router.canHandleRoute(props.route),
      target: target(),
      download: props.download,
    });
  const preloadIdentity = () =>
    browserRouterLinkPreloadIdentity({
      href: routeHref(),
      preload: props.preload !== false,
      canHandleRoute: router.canHandleRoute(props.route),
      target: target(),
      download: props.download,
    });
  let preloader: BrowserRouterLinkPreloader | undefined;
  const intentPreloader = (): BrowserRouterLinkPreloader => {
    if (preloader !== undefined) {
      return preloader;
    }
    const created = makeBrowserRouterLinkPreloader({
      runtime: router.runtime,
      enabled: () => preloadDecision(false)._tag === "Preload",
      preload: () =>
        router.preload<R>(
          props.route,
          ...hrefArgs(props.options as Route.HrefOptions<R> | undefined),
        ),
    });
    preloader = created;
    // Bound now, so the effect's first run sees the same identity and keeps
    // the preload this intent starts.
    created.bindPreloadIdentity(untrack(preloadIdentity));
    runWithOwner(owner, () => {
      createRenderEffect(preloadIdentity, (identity) => {
        created.bindPreloadIdentity(identity);
      });
      onCleanup(() => {
        void Effect.runFork(created.interrupt());
      });
    });
    return created;
  };
  const preloadOnIntent = (event: Event): void => {
    if (preloadDecision(event.defaultPrevented)._tag === "Preload") {
      intentPreloader().preload();
    }
  };

  const onMouseEnter: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorHandler(props.onMouseEnter, event);
    preloadOnIntent(event);
  };
  const onFocus: JSX.EventHandler<HTMLAnchorElement, FocusEvent> = (event) => {
    callAnchorHandler(props.onFocus, event);
    preloadOnIntent(event);
  };
  const onClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorHandler(props.onClick, event);
    const clickDecision = browserRouterLinkClickDecision({
      event,
      href: routeHref(),
      replace: props.replace === true,
      canHandleRoute: router.canHandleRoute(props.route),
      target: target(),
      download: props.download,
    });
    if (clickDecision._tag === "Ignore") {
      return;
    }

    event.preventDefault();
    router.navigateHref(clickDecision.href, clickDecision.options);
  };

  return createComponent(Anchor, merge(anchorProps, href, { onClick, onMouseEnter, onFocus }));
};
