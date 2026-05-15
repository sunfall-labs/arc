import {
  Route,
  isPlainLeftClick as coreIsPlainLeftClick,
  makeBrowserRouterLinkPreloader,
  opensOutsideRouter
} from "@effect-ui/core";
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode
} from "react";
import { useRouter } from "./router.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

type RouterLinkRouteOptions<R extends AnyRoute> =
  {} extends Route.Params<R>
    ? { readonly options?: Route.HrefOptions<R> }
    : { readonly options: Route.HrefOptions<R> };

/** Props for a typed router-owned anchor. */
export type RouterLinkProps<R extends AnyRoute> =
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
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

/** Typed React anchor that builds hrefs, preloads on hover, and navigates on plain clicks. */
export const RouterLink = <R extends AnyRoute>(
  props: RouterLinkProps<R>
): ReactNode => {
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
  const href = Route.href<R>(routeValue, ...currentHrefArgs());
  const preloadConfig = useRef<{
    readonly enabled: () => boolean;
    readonly preloadEffect: () => ReturnType<typeof router.preloadEffect<R>>;
  } | undefined>(undefined);
  preloadConfig.current = {
    enabled: () => preloadOption !== false && router.canHandleRoute(routeValue),
    preloadEffect: () => router.preloadEffect<R>(routeValue, ...currentHrefArgs())
  };
  const preloader = useMemo(() =>
    makeBrowserRouterLinkPreloader({
      runtime: router.runtime,
      enabled: () => preloadConfig.current?.enabled() ?? false,
      preloadEffect: () => preloadConfig.current!.preloadEffect()
    }),
    [router.runtime]
  );

  useEffect(() => preloader.interrupt, [preloader]);

  return createElement("a", {
    ...anchorProps,
    href,
    onMouseEnter: (event: MouseEvent<HTMLAnchorElement>) => {
      onMouseEnter?.(event);
      if (!event.defaultPrevented) {
        preloader.preload();
      }
    },
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (
        event.defaultPrevented ||
        !isPlainLeftClick(event) ||
        opensOutsideRouter(anchorProps.target, anchorProps.download) ||
        !router.canHandleRoute(routeValue)
      ) {
        return;
      }

      event.preventDefault();
      router.navigateHref(href, replace ? { replace: true } : undefined);
    }
  });
};
