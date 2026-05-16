import {
  Route,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  isPlainLeftClick as coreIsPlainLeftClick,
  makeBrowserRouterLinkPreloader
} from "@effect-ui/core";
import { createMemo, createRenderEffect, onCleanup, splitProps, type JSX } from "solid-js";
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
  const href = createMemo(() => Route.href<R>(route(), ...currentHrefArgs()));
  let anchorElement: HTMLAnchorElement | undefined;
  const assignAnchorRef = (element: HTMLAnchorElement): void => {
    anchorElement = element;
    const ref = anchorProps.ref;
    if (typeof ref === "function") {
      ref(element);
    }
  };
  const preloader = makeBrowserRouterLinkPreloader({
    runtime: router.runtime,
    enabled: () =>
      browserRouterLinkPreloadDecision({
        defaultPrevented: false,
        preload: local.preload !== false,
        canHandleRoute: router.canHandleRoute(route()),
        target: anchorProps.target,
        download: anchorProps.download
      })._tag === "Preload",
    preloadEffect: () => router.preloadEffect<R>(route(), ...currentHrefArgs())
  });

  createRenderEffect(() => {
    const canHandleRoute = router.canHandleRoute(route());
    const preload = local.preload !== false;
    preloader.bindPreloadIdentity(
      browserRouterLinkPreloadIdentity({
        href: href(),
        preload,
        canHandleRoute,
        target: anchorProps.target,
        download: anchorProps.download
      })
    );
  });
  createRenderEffect(() => {
    anchorElement?.setAttribute("href", href());
  });
  onCleanup(preloader.interrupt);

  const onMouseEnter: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(local.onMouseEnter, event);
    const preloadDecision = browserRouterLinkPreloadDecision({
      defaultPrevented: event.defaultPrevented,
      preload: local.preload !== false,
      canHandleRoute: router.canHandleRoute(route()),
      target: anchorProps.target,
      download: anchorProps.download
    });
    if (preloadDecision._tag === "Preload") {
      preloader.preload();
    }
  };
  const onClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(local.onClick, event);
    const clickDecision = browserRouterLinkClickDecision({
      event,
      href: href(),
      replace: local.replace === true,
      canHandleRoute: router.canHandleRoute(route()),
      target: anchorProps.target,
      download: anchorProps.download
    });
    if (clickDecision._tag === "Ignore") {
      return;
    }

    event.preventDefault();
    router.navigateHref(clickDecision.href, clickDecision.options);
  };

  const dynamicProps = {
    ...anchorProps,
    component: "a",
    ref: assignAnchorRef,
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
