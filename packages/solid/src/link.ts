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
  type Owner,
} from "solid-js";
import { dynamic, isServer, type JSX } from "@solidjs/web";
import { Effect } from "effect";
import { useRouter, type BrowserRouter } from "./router.js";

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
 * A browser link's state. Its behavior lives on the prototype, so a link
 * holds this object, its three event handlers, and its `href` getter; the
 * preloader and its effect exist only after the first hover or focus.
 */
class BrowserLink<R extends AnyRoute> {
  private preloader: BrowserRouterLinkPreloader | undefined;

  constructor(
    private readonly props: RouterLinkProps<R>,
    private readonly router: BrowserRouter<readonly AnyRoute[], unknown>,
    private readonly owner: Owner | null,
  ) {}

  href(): string {
    return Route.href<R>(
      this.props.route,
      ...hrefArgs(this.props.options as Route.HrefOptions<R> | undefined),
    );
  }

  private target(): string | undefined {
    return typeof this.props.target === "string" ? this.props.target : undefined;
  }

  private preloadDecision(defaultPrevented: boolean) {
    return browserRouterLinkPreloadDecision({
      defaultPrevented,
      preload: this.props.preload !== false,
      canHandleRoute: this.router.canHandleRoute(this.props.route),
      target: this.target(),
      download: this.props.download,
    });
  }

  private preloadIdentity() {
    return browserRouterLinkPreloadIdentity({
      href: this.href(),
      preload: this.props.preload !== false,
      canHandleRoute: this.router.canHandleRoute(this.props.route),
      target: this.target(),
      download: this.props.download,
    });
  }

  private intentPreloader(): BrowserRouterLinkPreloader {
    if (this.preloader !== undefined) {
      return this.preloader;
    }
    const preloader = makeBrowserRouterLinkPreloader({
      runtime: this.router.runtime,
      enabled: () => this.preloadDecision(false)._tag === "Preload",
      preload: () =>
        this.router.preload<R>(
          this.props.route,
          ...hrefArgs(this.props.options as Route.HrefOptions<R> | undefined),
        ),
    });
    this.preloader = preloader;
    // Bound now, so the effect's first run sees the same identity and keeps
    // the preload this intent starts.
    preloader.bindPreloadIdentity(untrack(() => this.preloadIdentity()));
    runWithOwner(this.owner, () => {
      createRenderEffect(
        () => this.preloadIdentity(),
        (identity) => {
          preloader.bindPreloadIdentity(identity);
        },
      );
      onCleanup(() => {
        void Effect.runFork(preloader.interrupt());
      });
    });
    return preloader;
  }

  intent(
    handler: AnchorHandler<MouseEvent> | AnchorHandler<FocusEvent> | undefined,
    event: AnchorEvent<Event>,
  ): void {
    callAnchorHandler(handler as AnchorHandler<Event> | undefined, event);
    if (this.preloadDecision(event.defaultPrevented)._tag === "Preload") {
      this.intentPreloader().preload();
    }
  }

  click(event: AnchorEvent<MouseEvent>): void {
    callAnchorHandler(this.props.onClick, event);
    const clickDecision = browserRouterLinkClickDecision({
      event,
      href: this.href(),
      replace: this.props.replace === true,
      canHandleRoute: this.router.canHandleRoute(this.props.route),
      target: this.target(),
      download: this.props.download,
    });
    if (clickDecision._tag === "Ignore") {
      return;
    }

    event.preventDefault();
    this.router.navigateHref(clickDecision.href, clickDecision.options);
  }
}

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
  const link = new BrowserLink(props, router, isServer ? null : getOwner());
  const href = {
    get href() {
      return router.createHref(link.href());
    },
  };
  if (isServer) {
    return createComponent(Anchor, merge(anchorProps, href));
  }
  return createComponent(
    Anchor,
    merge(anchorProps, href, {
      onClick: (event: AnchorEvent<MouseEvent>) => link.click(event),
      onMouseEnter: (event: AnchorEvent<MouseEvent>) => link.intent(props.onMouseEnter, event),
      onFocus: (event: AnchorEvent<FocusEvent>) => link.intent(props.onFocus, event),
    }),
  );
};
