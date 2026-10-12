import { Route, type AnySunfallArcRuntime, type BrowserRouterState } from "@sunfall/arc-core";
import {
  browserRouteInstanceKey,
  browserRouteRenderIdentity,
  browserRouteRenderDecision,
  makeRuntimeUiScopeFrame,
  SignalWrites,
  writeUntracedSignals,
  type AnyBrowserRoute,
  type BrowserRouteOutletRenderers,
  type WritableSignal,
} from "@sunfall/arc-core/internal";
import { Effect, Fiber } from "effect";
import { createComponent, createMemo, createRoot, runWithOwner, type Owner } from "solid-js";
import type { JSX } from "@solidjs/web";
import { renderFailure } from "./render-failure.js";

type AnyRoute = AnyBrowserRoute;

export type SolidRouteOutletRenderers<
  Routes extends readonly AnyRoute[],
  ER,
> = BrowserRouteOutletRenderers<Routes, ER, JSX.Element>;

export interface SolidRouteRenderInput<Routes extends readonly AnyRoute[], ER> {
  readonly state: BrowserRouterState<Routes, ER>;
  readonly renderers: SolidRouteOutletRenderers<Routes, ER>;
}

export interface SolidRouteRenderScopeController<Routes extends readonly AnyRoute[], ER> {
  update(input: SolidRouteRenderInput<Routes, ER>): void;
  dispose(): Effect.Effect<void>;
}

interface RenderedRouteScope {
  readonly node: JSX.Element;
  readonly dispose?: Effect.Effect<void, never, never>;
  /** Set when the node is a route component: the page it shows and its props. */
  readonly instance?: RenderedRouteInstance;
}

/**
 * A rendered route component: the page (route and params) it shows, and the
 * props signal later navigations to the same page write their search into.
 */
interface RenderedRouteInstance {
  readonly key: string;
  readonly component: unknown;
  readonly props: WritableSignal<Record<string, unknown>>;
}

/**
 * Route component props that read the current props signal, so a navigation
 * to the same page (new search) updates them in place.
 */
const reactiveRouteProps = (
  props: WritableSignal<Record<string, unknown>>,
): Record<string, unknown> =>
  new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => (props.get() as Record<PropertyKey, unknown>)[key],
    has: (_target, key) => key in props.get(),
    ownKeys: () => Reflect.ownKeys(props.get()),
    getOwnPropertyDescriptor: (_target, key) =>
      key in props.get()
        ? {
            enumerable: true,
            configurable: true,
            get: () => (props.get() as Record<PropertyKey, unknown>)[key],
          }
        : undefined,
  });

class SolidRouteRenderFailure {
  readonly _tag = "SolidRouteRenderFailure";

  constructor(
    readonly error: unknown,
    readonly dispose: Effect.Effect<void, never, never>,
  ) {}
}

const defaultPending = (): JSX.Element => undefined;

const defaultFailure = <ER>(
  state: Extract<BrowserRouterState<readonly AnyRoute[], ER>, { readonly _tag: "Failure" }>,
): JSX.Element => {
  throw renderFailure(state.cause);
};

const defaultNotFound = (): JSX.Element => undefined;

const routeRenderDefaults = {
  pending: defaultPending,
  failure: defaultFailure,
  notFound: defaultNotFound,
};

type RouteComponent = (props: Record<string, unknown>) => JSX.Element;

/**
 * Renders a route component value that is not a plain function (a typed
 * `Component`), or returns `undefined` for plain Solid components.
 */
export type SolidRouteViewRenderer = (
  component: unknown,
  props: Record<string, unknown>,
) => JSX.Element | undefined;

const renderReadyComponent = (
  component: unknown,
  props: Record<string, unknown>,
  renderView: SolidRouteViewRenderer,
): JSX.Element =>
  typeof component === "function"
    ? createComponent(component as RouteComponent, props)
    : renderView(component, props);

/**
 * Renders a route component. An unloaded lazy component becomes an async memo
 * over its preload fiber, so it suspends the nearest Solid `<Loading>` boundary
 * and load failures reach the nearest `<Errored>` boundary.
 */
const renderRouteComponent = <ER>(
  component: unknown,
  props: Record<string, unknown>,
  runtime: AnySunfallArcRuntime<ER>,
  renderView: SolidRouteViewRenderer,
): JSX.Element => {
  let ready: unknown;
  try {
    ready = Route.readComponent(component);
  } catch (error) {
    const preload = Route.forkLazyComponentSuspense(error, runtime);
    if (preload === undefined) {
      throw error;
    }
    const loaded = createMemo<{ readonly component: unknown }>(() =>
      Effect.runPromise(
        Fiber.join(preload).pipe(Effect.map(() => ({ component: Route.readComponent(component) }))),
      ),
    );
    return createMemo(() =>
      renderReadyComponent(loaded().component, props, renderView),
    ) as unknown as JSX.Element;
  }
  return renderReadyComponent(ready, props, renderView);
};

/**
 * Renders under the outlet's Solid owner, so route components see every context
 * above the outlet, inside a route `UiScope` frame whose disposal Arc controls:
 * Solid cleanup runs first, in the router runtime, then scoped finalizers.
 */
const renderInRouteScope = <ER>(
  owner: Owner | null,
  runtime: AnySunfallArcRuntime<ER>,
  render: () => JSX.Element,
): { readonly node: JSX.Element; readonly dispose: Effect.Effect<void, never, never> } => {
  const frame = makeRuntimeUiScopeFrame(runtime);
  let disposeSolid: (() => void) | undefined;
  let renderFailure: { readonly error: unknown } | undefined;
  const dispose = Effect.andThen(
    Effect.sync(() => {
      try {
        frame.run(() => {
          disposeSolid?.();
        });
      } catch {
        // Preserve the original render error or cleanup outcome.
      }
    }),
    frame.dispose(),
  ).pipe(Effect.catchCause(() => Effect.void));
  let node: JSX.Element;
  try {
    node = runWithOwner(owner, () =>
      createRoot((disposeRoot) => {
        disposeSolid = disposeRoot;
        return frame.run(() => {
          try {
            return render();
          } catch (error) {
            renderFailure = { error };
            return undefined;
          }
        });
      }),
    );
  } catch (error) {
    throw new SolidRouteRenderFailure(error, dispose);
  }
  if (renderFailure !== undefined) {
    throw new SolidRouteRenderFailure(renderFailure.error, dispose);
  }

  return { node, dispose };
};

const renderRouteState = <Routes extends readonly AnyRoute[], ER>(
  owner: Owner | null,
  state: BrowserRouterState<Routes, ER>,
  renderers: SolidRouteOutletRenderers<Routes, ER>,
  runtime: AnySunfallArcRuntime<ER>,
  renderView: SolidRouteViewRenderer,
): RenderedRouteScope => {
  const decision = browserRouteRenderDecision(state);
  switch (decision._tag) {
    case "Pending":
      return renderInRouteScope(owner, runtime, () =>
        (renderers.pending ?? defaultPending)(decision.state),
      );
    case "Failure":
      return renderInRouteScope(owner, runtime, () =>
        (renderers.failure ?? defaultFailure)(decision.state),
      );
    case "NotFound":
      return renderInRouteScope(owner, runtime, () =>
        (renderers.notFound ?? defaultNotFound)(decision.state),
      );
    case "Empty":
      return { node: undefined };
    case "Ready": {
      const props = SignalWrites.make<Record<string, unknown>>(
        decision.props as unknown as Record<string, unknown>,
        { name: "RouterOutlet.props" },
      );
      const rendered = renderInRouteScope(owner, runtime, () =>
        renderRouteComponent(decision.component, reactiveRouteProps(props), runtime, renderView),
      );
      const key = browserRouteInstanceKey(state);
      return key === undefined
        ? rendered
        : { ...rendered, instance: { key, component: decision.component, props } };
    }
  }
};

const disposeRenderedRoute = (
  dispose: Effect.Effect<void, never, never> | undefined,
): Effect.Effect<void> => dispose ?? Effect.void;

const solidRouteRenderFailure = (error: unknown): SolidRouteRenderFailure | undefined =>
  error instanceof SolidRouteRenderFailure ? error : undefined;

export const makeSolidRouteRenderScopeController = <
  Routes extends readonly AnyRoute[],
  ER,
>(options: {
  readonly initialInput: SolidRouteRenderInput<Routes, ER>;
  readonly runtime: AnySunfallArcRuntime<ER>;
  /** Renders route components that are typed `Component` values. */
  readonly renderView?: SolidRouteViewRenderer;
  /** Solid owner route roots render under; usually the outlet's. */
  readonly owner: Owner | null;
  /** Rendered route node; Arc owns outlet state and Solid renders it. */
  readonly node: WritableSignal<JSX.Element>;
  /** Route render failure surfaced to the host `<Errored>` boundary. */
  readonly renderError: WritableSignal<unknown>;
}): SolidRouteRenderScopeController<Routes, ER> => {
  let renderedState = options.initialInput.state;
  let renderedIdentity = browserRouteRenderIdentity({
    state: options.initialInput.state,
    renderers: options.initialInput.renderers,
    defaults: routeRenderDefaults,
  });
  let disposeRoute: Effect.Effect<void, never, never> | undefined;
  // The route component on screen, kept across navigations to the same page.
  let renderedInstance: RenderedRouteInstance | undefined;
  let transitionVersion = 0;
  let disposalFiber: Fiber.Fiber<void, unknown> | undefined;

  /**
   * Shows a route node or render failure. Outlet state is derived from the
   * router state the `Timeline` records (travel re-renders the route), so its
   * writes are bookkeeping, not named transitions.
   */
  const show = (node: JSX.Element, renderError: unknown): void =>
    writeUntracedSignals(() => {
      options.renderError.set(renderError);
      options.node.set(node);
    });

  const disposeStaleRenderedRoute = (rendered: RenderedRouteScope): void => {
    void options.runtime.runFork(
      disposeRenderedRoute(rendered.dispose).pipe(Effect.catchCause(() => Effect.void)),
    );
  };

  const joinRouteDisposal = (fiber: Fiber.Fiber<void, unknown> | undefined): Effect.Effect<void> =>
    fiber === undefined
      ? Effect.void
      : Fiber.join(fiber).pipe(Effect.catchCause(() => Effect.void));

  const startRouteDisposal = (
    routeDispose: Effect.Effect<void, never, never> | undefined,
  ): Fiber.Fiber<void, unknown> => {
    const previousDisposalFiber = disposalFiber;
    const currentDisposal = disposeRenderedRoute(routeDispose);
    const fiber = options.runtime.runFork(
      Effect.gen(function* () {
        yield* joinRouteDisposal(previousDisposalFiber);
        yield* currentDisposal;
      }).pipe(Effect.catchCause(() => Effect.void)),
    );
    disposalFiber = fiber;
    return fiber;
  };

  const startCurrentRouteDisposal = (): Fiber.Fiber<void, unknown> => {
    const currentDispose = disposeRoute;
    disposeRoute = undefined;
    return startRouteDisposal(currentDispose);
  };

  const render = (input: SolidRouteRenderInput<Routes, ER>): RenderedRouteScope =>
    renderRouteState(
      options.owner,
      input.state,
      input.renderers,
      options.runtime,
      options.renderView ?? (() => undefined),
    );

  const renderTransition = (
    input: SolidRouteRenderInput<Routes, ER>,
    transition: number,
    transitionDisposalFiber: Fiber.Fiber<void, unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* joinRouteDisposal(transitionDisposalFiber);
      if (transition !== transitionVersion) {
        return;
      }

      let next: RenderedRouteScope;
      try {
        next = render(input);
      } catch (error) {
        const failure = solidRouteRenderFailure(error);
        if (failure !== undefined) {
          startRouteDisposal(failure.dispose);
        }
        if (transition === transitionVersion) {
          const renderError = failure?.error ?? error;
          show(undefined, renderError);
        }
        return;
      }

      if (transition !== transitionVersion) {
        disposeStaleRenderedRoute(next);
        return;
      }

      disposeRoute = next.dispose;
      renderedInstance = next.instance;
      show(next.node, undefined);
    });

  const disposeEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      transitionVersion++;
      renderedInstance = undefined;
      return joinRouteDisposal(startCurrentRouteDisposal());
    });

  const renderInitial = (): void => {
    try {
      const initial = render(options.initialInput);
      disposeRoute = initial.dispose;
      renderedInstance = initial.instance;
      show(initial.node, undefined);
    } catch (error) {
      const failure = solidRouteRenderFailure(error);
      if (failure === undefined) {
        throw error;
      }
      startRouteDisposal(failure.dispose);
      show(undefined, failure.error);
    }
  };

  renderInitial();

  /**
   * A navigation to the page already on screen (same route and params, new
   * search) keeps its route instance: while it preloads the page stays
   * visible, and once ready its props take the new search. Returns whether it
   * was handled that way.
   */
  const updateSamePage = (input: SolidRouteRenderInput<Routes, ER>): boolean => {
    const instance = renderedInstance;
    if (instance === undefined || browserRouteInstanceKey(input.state) !== instance.key) {
      return false;
    }
    if (input.state._tag === "Pending") {
      renderedState = input.state;
      return true;
    }
    const decision = browserRouteRenderDecision(input.state);
    if (decision._tag !== "Ready" || decision.component !== instance.component) {
      return false;
    }
    renderedState = input.state;
    renderedIdentity = browserRouteRenderIdentity({
      state: input.state,
      renderers: input.renderers,
      defaults: routeRenderDefaults,
    });
    writeUntracedSignals(() => {
      instance.props.set(decision.props as unknown as Record<string, unknown>);
    });
    return true;
  };

  return {
    update: (input) => {
      const nextIdentity = browserRouteRenderIdentity({
        state: input.state,
        renderers: input.renderers,
        defaults: routeRenderDefaults,
      });
      const sameState = input.state === renderedState;
      if (sameState && nextIdentity === renderedIdentity) {
        return;
      }
      if (updateSamePage(input)) {
        return;
      }
      renderedInstance = undefined;

      renderedState = input.state;
      renderedIdentity = nextIdentity;
      const transition = ++transitionVersion;
      show(undefined, undefined);
      void options.runtime.runFork(
        renderTransition(input, transition, startCurrentRouteDisposal()),
      );
    },
    dispose: disposeEffect,
  };
};
