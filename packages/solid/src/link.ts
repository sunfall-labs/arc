import {
  Route,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  isPlainLeftClick as coreIsPlainLeftClick,
  makeBrowserRouterLinkPreloader,
} from "@sunfall/arc-core";
import {
  createMemo,
  createRenderEffect,
  onCleanup,
  sharedConfig,
  splitProps,
  type JSX,
} from "solid-js";
import {
  createComponent,
  Dynamic,
  getNextElement,
  insert,
  isServer,
  spread,
  template,
  type DynamicProps,
} from "solid-js/web";
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

let anchorTemplate: ReturnType<typeof template> | undefined;

const createAnchorElement = (): HTMLAnchorElement => {
  anchorTemplate ??= template("<a></a>");
  return (
    sharedConfig.context ? getNextElement(anchorTemplate) : anchorTemplate()
  ) as HTMLAnchorElement;
};

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
  const [local, anchorProps] = splitProps(props, [
    "route",
    "options",
    "replace",
    "preload",
    "onClick",
    "onMouseEnter",
    "ref",
  ]);
  const router = useRouter();
  const route = (): R => local.route as R;
  const currentHrefArgs = (): Route.HrefArgs<R> =>
    hrefArgs(local.options as Route.HrefOptions<R> | undefined);
  const routeHref = createMemo(() => Route.href<R>(route(), ...currentHrefArgs()));
  const browserHref = createMemo(() => router.createHref(routeHref()));
  let anchorElement: HTMLAnchorElement | undefined;
  const assignAnchorRef = (element: HTMLAnchorElement): void => {
    anchorElement = element;
    const ref = local.ref;
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
        download: anchorProps.download,
      })._tag === "Preload",
    preloadEffect: () => router.preloadEffect<R>(route(), ...currentHrefArgs()),
  });

  createRenderEffect(() => {
    const canHandleRoute = router.canHandleRoute(route());
    const preload = local.preload !== false;
    preloader.bindPreloadIdentity(
      browserRouterLinkPreloadIdentity({
        href: routeHref(),
        preload,
        canHandleRoute,
        target: anchorProps.target,
        download: anchorProps.download,
      }),
    );
  });
  createRenderEffect(() => {
    anchorElement?.setAttribute("href", browserHref());
  });
  createRenderEffect(() => {
    const className = anchorProps.class;
    if (className === undefined || className === null) {
      anchorElement?.removeAttribute("class");
    } else {
      anchorElement?.setAttribute("class", String(className));
    }
  });
  createRenderEffect(() => {
    const ariaCurrent = anchorProps["aria-current"];
    if (ariaCurrent === undefined || ariaCurrent === null || ariaCurrent === false) {
      anchorElement?.removeAttribute("aria-current");
    } else {
      anchorElement?.setAttribute("aria-current", String(ariaCurrent));
    }
  });
  onCleanup(() => {
    preloader.interrupt();
  });

  const onMouseEnter: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(local.onMouseEnter, event);
    const preloadDecision = browserRouterLinkPreloadDecision({
      defaultPrevented: event.defaultPrevented,
      preload: local.preload !== false,
      canHandleRoute: router.canHandleRoute(route()),
      target: anchorProps.target,
      download: anchorProps.download,
    });
    if (preloadDecision._tag === "Preload") {
      preloader.preload();
    }
  };
  const onClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callAnchorMouseHandler(local.onClick, event);
    const clickDecision = browserRouterLinkClickDecision({
      event,
      href: routeHref(),
      replace: local.replace === true,
      canHandleRoute: router.canHandleRoute(route()),
      target: anchorProps.target,
      download: anchorProps.download,
    });
    if (clickDecision._tag === "Ignore") {
      return;
    }

    event.preventDefault();
    router.navigateHref(clickDecision.href, clickDecision.options);
  };

  const anchorElementProps = {
    ...anchorProps,
    ref: assignAnchorRef,
    get href() {
      return browserHref();
    },
    onClick,
    onMouseEnter,
  } as unknown as Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    readonly href: string;
  };

  if (isServer) {
    return createComponent(
      Dynamic as (props: DynamicProps<"a">) => JSX.Element,
      {
        ...anchorElementProps,
        component: "a",
      } as unknown as DynamicProps<"a">,
    );
  }

  const anchor = createAnchorElement();

  spread(anchor, anchorElementProps, false, true);
  insert(anchor, () => anchorProps.children);
  return anchor;
};
