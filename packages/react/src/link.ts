import {
  Route,
  browserRouterLinkClickDecision,
  browserRouterLinkPreloadDecision,
  browserRouterLinkPreloadIdentity,
  isPlainLeftClick as coreIsPlainLeftClick,
  makeBrowserRouterLinkPreloader,
} from "@sunfall/arc-core";
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "./router.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

type RouterLinkRouteOptions<R extends AnyRoute> =
  {} extends Route.Params<R>
    ? { readonly options?: Route.HrefOptions<R> }
    : { readonly options: Route.HrefOptions<R> };

/** Props for a typed router-owned anchor. */
export type RouterLinkProps<R extends AnyRoute> = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
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

/** Typed React anchor that builds hrefs, preloads on hover, and navigates on plain clicks. */
export const RouterLink = <R extends AnyRoute>(props: RouterLinkProps<R>): ReactNode => {
  const {
    route,
    options,
    replace,
    preload: preloadOption,
    onClick,
    onMouseEnter,
    ...anchorProps
  } = props;
  const router = useRouter();
  const routeValue = route as R;
  const currentHrefArgs = (): Route.HrefArgs<R> =>
    hrefArgs(options as Route.HrefOptions<R> | undefined);
  const routeHref = Route.href<R>(routeValue, ...currentHrefArgs());
  const browserHref = router.createHref(routeHref);
  const preloadIdentity = browserRouterLinkPreloadIdentity({
    href: routeHref,
    preload: preloadOption !== false,
    canHandleRoute: router.canHandleRoute(routeValue),
    target: anchorProps.target,
    download: anchorProps.download,
  });
  const preloadConfig = useRef<
    | {
        readonly enabled: () => boolean;
        readonly preloadEffect: () => ReturnType<typeof router.preloadEffect<R>>;
      }
    | undefined
  >(undefined);
  preloadConfig.current = {
    enabled: () =>
      browserRouterLinkPreloadDecision({
        defaultPrevented: false,
        preload: preloadOption !== false,
        canHandleRoute: router.canHandleRoute(routeValue),
        target: anchorProps.target,
        download: anchorProps.download,
      })._tag === "Preload",
    preloadEffect: () => router.preloadEffect<R>(routeValue, ...currentHrefArgs()),
  };
  const preloader = useMemo(
    () =>
      makeBrowserRouterLinkPreloader({
        runtime: router.runtime,
        enabled: () => preloadConfig.current?.enabled() ?? false,
        preloadEffect: () => preloadConfig.current!.preloadEffect(),
      }),
    [router],
  );

  useEffect(() => {
    preloader.bindPreloadIdentity(preloadIdentity);
  }, [preloadIdentity.key, preloadIdentity.enabled, preloader]);
  useEffect(
    () => () => {
      preloader.interrupt();
    },
    [preloader, router.runtime],
  );

  return createElement("a", {
    ...anchorProps,
    href: browserHref,
    onMouseEnter: (event: MouseEvent<HTMLAnchorElement>) => {
      onMouseEnter?.(event);
      const preloadDecision = browserRouterLinkPreloadDecision({
        defaultPrevented: event.defaultPrevented,
        preload: preloadOption !== false,
        canHandleRoute: router.canHandleRoute(routeValue),
        target: anchorProps.target,
        download: anchorProps.download,
      });
      if (preloadDecision._tag === "Preload") {
        preloader.preload();
      }
    },
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      const clickDecision = browserRouterLinkClickDecision({
        event,
        href: routeHref,
        replace: replace === true,
        canHandleRoute: router.canHandleRoute(routeValue),
        target: anchorProps.target,
        download: anchorProps.download,
      });
      if (clickDecision._tag === "Ignore") {
        return;
      }

      event.preventDefault();
      router.navigateHref(clickDecision.href, clickDecision.options);
    },
  });
};
