import {
  Route,
  isPlainLeftClick as coreIsPlainLeftClick,
  makeBrowserRouterLinkPreloader,
  opensOutsideRouter
} from "@effect-ui/core";
import { onCleanup, splitProps, type JSX } from "solid-js";
import { createComponent, Dynamic, type DynamicProps } from "solid-js/web";
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
  JSX.AnchorHTMLAttributes<HTMLAnchorElement>["onClick"] |
  JSX.AnchorHTMLAttributes<HTMLAnchorElement>["onMouseEnter"];

/** Props for a typed router-owned anchor. */
export type RouterLinkProps<R extends AnyRoute> =
  Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
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
  options: Route.HrefOptions<R> | undefined
): Route.HrefArgs<R> =>
  (options === undefined ? [] : [options]) as Route.HrefArgs<R>;

const callAnchorMouseHandler = (
  handler: AnchorMouseHandler | undefined,
  event: AnchorMouseEvent
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
export const RouterLink = <R extends AnyRoute>(
  props: RouterLinkProps<R>
): JSX.Element => {
  const [local, anchorProps] = splitProps(props, [
    "route",
    "options",
    "replace",
    "preload",
    "onClick",
    "onMouseEnter"
  ]);
  const router = useRouter();
  const route = (): R => local.route as R;
  const currentHrefArgs = (): Route.HrefArgs<R> =>
    hrefArgs(local.options as Route.HrefOptions<R> | undefined);
  const href = () => Route.href<R>(route(), ...currentHrefArgs());
  const preloader = makeBrowserRouterLinkPreloader({
    runtime: router.runtime,
    enabled: () => local.preload !== false && router.canHandleRoute(route()),
    preloadEffect: () => router.preloadEffect<R>(route(), ...currentHrefArgs())
  });

  onCleanup(preloader.interrupt);

  const onMouseEnter: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(local.onMouseEnter, event);
    if (!event.defaultPrevented) {
      preloader.preload();
    }
  };
  const onClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(local.onClick, event);
    if (
      event.defaultPrevented ||
      !isPlainLeftClick(event) ||
      opensOutsideRouter(anchorProps.target, anchorProps.download) ||
      !router.canHandleRoute(route())
    ) {
      return;
    }

    event.preventDefault();
    router.navigateHref(href(), local.replace ? { replace: true } : undefined);
  };

  const dynamicProps = {
    ...anchorProps,
    component: "a",
    get href() {
      return href();
    },
    "on:click": onClick,
    "on:mouseenter": onMouseEnter
  } as unknown as DynamicProps<"a">;

  return createComponent(
    Dynamic as (props: DynamicProps<"a">) => JSX.Element,
    dynamicProps
  );
};
