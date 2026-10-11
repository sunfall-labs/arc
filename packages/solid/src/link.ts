import { Route } from "@sunfall/arc-core";
import {
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  isPlainLeftClick as coreIsPlainLeftClick,
  makeBrowserRouterLinkPreloader,
} from "@sunfall/arc-core/internal";
import { createComponent, createMemo, createRenderEffect, merge, omit, onCleanup } from "solid-js";
import { Dynamic, type DynamicProps, type JSX } from "@solidjs/web";
import { useRouter } from "./router.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

type RouterLinkRouteOptions<R extends AnyRoute> =
  {} extends Route.Params<R>
    ? { readonly options?: Route.HrefOptions<R> }
    : { readonly options: Route.HrefOptions<R> };

type AnchorMouseEvent = MouseEvent & {
  readonly currentTarget: HTMLAnchorElement;
  readonly target: Element;
};

type AnchorMouseHandler =
  | JSX.AnchorHTMLAttributes<HTMLAnchorElement>["onClick"]
  | JSX.AnchorHTMLAttributes<HTMLAnchorElement>["onMouseEnter"];

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
    /** Preload the route on hover. Enabled by default. */
    readonly preload?: boolean;
  };

/** Returns true for clicks that should be handled by the client router. */
export const isPlainLeftClick = coreIsPlainLeftClick;

const hrefArgs = <R extends AnyRoute>(
  options: Route.HrefOptions<R> | undefined,
): Route.HrefArgs<R> => (options === undefined ? [] : [options]) as Route.HrefArgs<R>;

const callAnchorMouseHandler = (
  handler: AnchorMouseHandler | undefined,
  event: AnchorMouseEvent,
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

/** Typed Solid anchor that builds hrefs, preloads on hover, and navigates on plain clicks. */
export const RouterLink = <R extends AnyRoute>(props: RouterLinkProps<R>): JSX.Element => {
  const anchorProps = omit(
    props,
    "route",
    "options",
    "replace",
    "preload",
    "onClick",
    "onMouseEnter",
  ) as Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
  const router = useRouter();
  const route = (): R => props.route;
  const currentHrefArgs = (): Route.HrefArgs<R> =>
    hrefArgs(props.options as Route.HrefOptions<R> | undefined);
  const target = (): string | undefined =>
    typeof props.target === "string" ? props.target : undefined;
  const routeHref = createMemo(() => Route.href<R>(route(), ...currentHrefArgs()));
  const browserHref = createMemo(() => router.createHref(routeHref()));
  const preloadDecision = (defaultPrevented: boolean) =>
    browserRouterLinkPreloadDecision({
      defaultPrevented,
      preload: props.preload !== false,
      canHandleRoute: router.canHandleRoute(route()),
      target: target(),
      download: props.download,
    });
  const preloader = makeBrowserRouterLinkPreloader({
    runtime: router.runtime,
    enabled: () => preloadDecision(false)._tag === "Preload",
    preloadEffect: () => router.preloadEffect<R>(route(), ...currentHrefArgs()),
  });

  createRenderEffect(
    () =>
      browserRouterLinkPreloadIdentity({
        href: routeHref(),
        preload: props.preload !== false,
        canHandleRoute: router.canHandleRoute(route()),
        target: target(),
        download: props.download,
      }),
    (identity) => {
      preloader.bindPreloadIdentity(identity);
    },
  );
  onCleanup(() => {
    preloader.interrupt();
  });

  const onMouseEnter: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(props.onMouseEnter, event);
    if (preloadDecision(event.defaultPrevented)._tag === "Preload") {
      preloader.preload();
    }
  };
  const onClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(props.onClick, event);
    const clickDecision = browserRouterLinkClickDecision({
      event,
      href: routeHref(),
      replace: props.replace === true,
      canHandleRoute: router.canHandleRoute(route()),
      target: target(),
      download: props.download,
    });
    if (clickDecision._tag === "Ignore") {
      return;
    }

    event.preventDefault();
    router.navigateHref(clickDecision.href, clickDecision.options);
  };

  return createComponent(
    Dynamic as (props: DynamicProps<"a">) => JSX.Element,
    merge(anchorProps, {
      component: "a" as const,
      get href() {
        return browserHref();
      },
      onClick,
      onMouseEnter,
    }) as unknown as DynamicProps<"a">,
  );
};
