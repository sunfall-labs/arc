import {
  browserRouteRenderIdentity,
  browserRouteRenderDecision,
  forkRouteLazyComponentSuspense,
  makeRuntimeUiScopeFrame,
  readRouteComponent,
  type AnySunfallArcRuntime,
  type WritableSignal,
  type AnyBrowserRoute,
  type BrowserRouterState,
  type BrowserRouteOutletRenderers,
} from "@sunfall/arc-core";
import { Effect, Fiber } from "effect";
import { createComponent, createMemo, createRoot, runWithOwner, type Owner } from "solid-js";
import type { JSX } from "@solidjs/web";

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
  disposeEffect(): Effect.Effect<void>;
  dispose(): void;
}

interface RenderedRouteScope {
  readonly node: JSX.Element;
  readonly dispose?: Effect.Effect<void, never, never>;
}

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
  throw state.cause;
};

const defaultNotFound = (): JSX.Element => undefined;

const routeRenderDefaults = {
  pending: defaultPending,
  failure: defaultFailure,
  notFound: defaultNotFound,
};

type RouteComponent = (props: Record<string, unknown>) => JSX.Element;

/**
 * Renders a route component. An unloaded lazy component becomes an async memo
 * over its preload fiber, so it suspends the nearest Solid `<Loading>` boundary
 * and load failures reach the nearest `<Errored>` boundary.
 */
const renderRouteComponent = <ER>(
  component: unknown,
  props: Record<string, unknown>,
  runtime: AnySunfallArcRuntime<ER>,
): JSX.Element => {
  let ready: RouteComponent;
  try {
    ready = readRouteComponent(component) as RouteComponent;
  } catch (error) {
    const preload = forkRouteLazyComponentSuspense(error, runtime);
    if (preload === undefined) {
      throw error;
    }
    const loaded = createMemo<RouteComponent>(() =>
      Effect.runPromise(
        Fiber.join(preload).pipe(Effect.map(() => readRouteComponent(component) as RouteComponent)),
      ),
    );
    return createMemo(() => createComponent(loaded(), props)) as unknown as JSX.Element;
  }
  return createComponent(ready, props);
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
    frame.disposeEffect(),
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
    case "Ready":
      return renderInRouteScope(owner, runtime, () =>
        renderRouteComponent(
          decision.component,
          decision.props as unknown as Record<string, unknown>,
          runtime,
        ),
      );
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
  let transitionVersion = 0;
  let disposalFiber: Fiber.Fiber<void, unknown> | undefined;

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
    renderRouteState(options.owner, input.state, input.renderers, options.runtime);

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
          options.node.set(() => undefined);
          options.renderError.set(() => renderError);
        }
        return;
      }

      if (transition !== transitionVersion) {
        disposeStaleRenderedRoute(next);
        return;
      }

      disposeRoute = next.dispose;
      options.renderError.set(() => undefined);
      options.node.set(() => next.node);
    });

  const disposeEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      transitionVersion++;
      return joinRouteDisposal(startCurrentRouteDisposal());
    });

  const dispose = (): void => {
    transitionVersion++;
    void startCurrentRouteDisposal();
  };

  const renderInitial = (): void => {
    try {
      const initial = render(options.initialInput);
      disposeRoute = initial.dispose;
      options.node.set(() => initial.node);
    } catch (error) {
      const failure = solidRouteRenderFailure(error);
      if (failure === undefined) {
        throw error;
      }
      startRouteDisposal(failure.dispose);
      options.node.set(() => undefined);
      options.renderError.set(() => failure.error);
    }
  };

  renderInitial();

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

      renderedState = input.state;
      renderedIdentity = nextIdentity;
      const transition = ++transitionVersion;
      options.node.set(() => undefined);
      options.renderError.set(() => undefined);
      void options.runtime.runFork(
        renderTransition(input, transition, startCurrentRouteDisposal()),
      );
    },
    disposeEffect,
    dispose,
  };
};
