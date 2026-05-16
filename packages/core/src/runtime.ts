import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Redactable } from "effect";
import {
  disposeResourceStoreEffect,
  makeMutableResourceStore,
  makeResourceStore,
  ResourceStore,
  unsafeMutableResourceStore,
  type MutableResourceStore,
  type ResourceStore as ResourceStoreState
} from "./resource-store.js";

export const RuntimeTypeId: unique symbol = Symbol.for("@effect-ui/core/Runtime") as typeof RuntimeTypeId;

type RuntimeManagedBoundary<ER> = ManagedRuntime.ManagedRuntime<any, ER>;
type CurrentRuntimeBoundary = AnyEffectUiRuntime<any>;
type RuntimeProvidedRequirements<R> = R | ResourceStoreState;
type RuntimeRemainingRequirements<RIn, RProvided> = Exclude<RIn, RuntimeProvidedRequirements<RProvided>>;
type RuntimeReadyEffect<A, E, RIn, RProvided> =
  [RuntimeRemainingRequirements<RIn, RProvided>] extends [never]
    ? Effect.Effect<A, E, RIn>
    : never;

/**
 * Runtime Spine whose service set is intentionally erased at a host seam.
 *
 * Prefer `EffectUiRuntime<R, ER>` when a function knows the services it needs.
 * Use this shape for UI contexts, platform adapters, and ambient runtime
 * plumbing where TypeScript cannot track the concrete app layer.
 */
export interface AnyEffectUiRuntime<ER = unknown> {
  readonly [RuntimeTypeId]: typeof RuntimeTypeId;
  readonly managed: RuntimeManagedBoundary<ER>;
  readonly resourceStore: ResourceStoreState;
  /** Provides the runtime's erased service set at a host or ambient seam. */
  provide<A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    options?: RuntimeProvideOptions
  ): Effect.Effect<A, E | ER>;
  /** Forks an Effect at a host or ambient seam where service typing is erased. */
  runFork<A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    options?: Effect.RunOptions
  ): Fiber.Fiber<A, E | ER>;
  /** Runs a synchronous Effect at a host or ambient seam where service typing is erased. */
  runSync<A, E, RIn>(effect: Effect.Effect<A, E, RIn>): A;
  readonly disposeEffect: Effect.Effect<void>;
}

/**
 * Runtime Spine used by core APIs to run Effect programs and share resource state.
 *
 * Use this when a UI root, server adapter, or test needs a stable Effect context.
 * The runtime provides its managed services plus a Resource Store to every effect it
 * runs.
 */
export interface EffectUiRuntime<R = never, ER = never> {
  readonly [RuntimeTypeId]: typeof RuntimeTypeId;
  readonly managed: RuntimeManagedBoundary<ER>;
  readonly resourceStore: ResourceStoreState;
  /**
   * Provides this runtime's services and Resource Store without starting the effect.
   *
   * Any requirements not present in the runtime remain in the returned Effect's
   * requirement channel, so missing services stay visible to TypeScript and LSPs.
   */
  provide<A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    options?: RuntimeProvideOptions
  ): Effect.Effect<A, E | ER, RuntimeRemainingRequirements<RIn, R>>;
  /** Forks an Effect whose service requirements are satisfied by this runtime. */
  runFork<A, E, RIn>(
    effect: RuntimeReadyEffect<A, E, RIn, R>,
    options?: Effect.RunOptions
  ): Fiber.Fiber<A, E | ER>;
  /** Runs a synchronous Effect whose service requirements are satisfied by this runtime. */
  runSync<A, E, RIn>(effect: RuntimeReadyEffect<A, E, RIn, R>): A;
  readonly disposeEffect: Effect.Effect<void>;
}

/** Options for providing runtime services to an Effect without executing it. */
export interface RuntimeProvideOptions {
  /** Override the resource store used by Resource operations inside this effect. */
  readonly resourceStore?: ResourceStoreState;
}

/** Accepted inputs for creating an Effect UI runtime. */
export type RuntimeSource<R = never, ER = never> =
  | EffectUiRuntime<R, ER>
  | ManagedRuntime.ManagedRuntime<R, ER>
  | Layer.Layer<R, ER, never>;

export const isEffectUiRuntime = (value: unknown): value is AnyEffectUiRuntime<never> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [RuntimeTypeId]?: unknown })[RuntimeTypeId] === RuntimeTypeId;

const AmbientRuntime = Context.Reference<CurrentRuntimeBoundary | undefined>("@effect-ui/core/AmbientRuntime", {
  defaultValue: () => undefined
});

const currentFiberContextProbe: Redactable.Redactable = {
  [Redactable.symbolRedactable]: (context) => context
};

const currentFiberRuntime = (): CurrentRuntimeBoundary | undefined =>
  Context.getReferenceUnsafe(
    Redactable.getRedacted(currentFiberContextProbe) as Context.Context<never>,
    AmbientRuntime
  );

const fromManagedRuntime = <R, ER>(
  managed: ManagedRuntime.ManagedRuntime<R, ER>,
  resourceStore: MutableResourceStore = makeMutableResourceStore(),
  options: { readonly disposeManaged: boolean } = { disposeManaged: true }
): EffectUiRuntime<R, ER> => {
  const managedRuntime: RuntimeManagedBoundary<ER> = managed;
  let runtime: EffectUiRuntime<R, ER>;

  const provideStore = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    store: ResourceStoreState = resourceStore
  ): Effect.Effect<A, E, Exclude<RIn, ResourceStoreState>> =>
    Effect.provideService(effect, ResourceStore, store);

  const runtimeForResourceStore = (store: MutableResourceStore): AnyEffectUiRuntime<ER> => {
    if (store === resourceStore) {
      return runtime as AnyEffectUiRuntime<ER>;
    }

    let scopedRuntime: AnyEffectUiRuntime<ER>;
    scopedRuntime = {
      [RuntimeTypeId]: RuntimeTypeId,
      managed: managedRuntime,
      resourceStore: store,
      provide: (effect, options) =>
        provideRuntimeServices(effect, {
          ...options,
          resourceStore: options?.resourceStore ?? store
        }) as Effect.Effect<any, any>,
      runFork: (effect, options) =>
        managedRuntime.runFork(
          provideRuntimeServices(effect, { resourceStore: store }) as Effect.Effect<any, any>,
          options
        ),
      runSync: (effect) =>
        runWithRuntime(scopedRuntime, () =>
          managedRuntime.runSync(
            provideRuntimeServices(effect, { resourceStore: store }) as Effect.Effect<any, any>
          )
        ),
      disposeEffect
    };
    return scopedRuntime;
  };

  const provideManagedServices = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>
  ): Effect.Effect<A, E, unknown> =>
    provideStore(effect);

  const provideRuntimeServices = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    provideOptions?: RuntimeProvideOptions
  ): Effect.Effect<A, E | ER, RuntimeRemainingRequirements<RIn, R>> => {
    const store = provideOptions?.resourceStore === undefined
      ? resourceStore
      : unsafeMutableResourceStore(provideOptions.resourceStore);
    const ambientRuntime = runtimeForResourceStore(store);
    return Effect.flatMap(managedRuntime.contextEffect, (context) =>
      Effect.provideService(
        provideStore(Effect.provideContext(effect, context), store),
        AmbientRuntime,
        ambientRuntime
      )
    ) as Effect.Effect<A, E | ER, RuntimeRemainingRequirements<RIn, R>>;
  };

  const disposeStore = disposeResourceStoreEffect(resourceStore);
  const disposeEffect = options.disposeManaged
    ? Effect.gen(function* () {
        const storeExit = yield* Effect.exit(disposeStore);
        const managedExit = yield* Effect.exit(managed.disposeEffect);
        if (Exit.isFailure(storeExit)) {
          return yield* Effect.failCause(storeExit.cause);
        }
        if (Exit.isFailure(managedExit)) {
          return yield* Effect.failCause(managedExit.cause);
        }
      })
    : disposeStore;
  runtime = {
    [RuntimeTypeId]: RuntimeTypeId,
    managed: managedRuntime,
    resourceStore,
    provide: provideRuntimeServices,
    runFork: (effect, options) =>
      managedRuntime.runFork(
        provideRuntimeServices(effect) as Effect.Effect<any, any>,
        options
      ),
    runSync: (effect) =>
      runWithRuntime(runtime, () =>
        managedRuntime.runSync(
          provideRuntimeServices(effect) as Effect.Effect<any, any>
        )
      ),
    disposeEffect
  };

  return runtime;
};

/**
 * Creates an Effect UI runtime from a Layer, ManagedRuntime, existing runtime, or no services.
 *
 * Prefer one runtime per app seam so resources, server functions, and actions share
 * the same service context and Resource Store.
 *
 * @example
 * ```ts
 * const runtime = makeRuntime(AppLive);
 * runtime.runFork(program);
 * ```
 */
export const makeRuntime = <R = never, ER = never>(
  source?: RuntimeSource<R, ER>
): EffectUiRuntime<R, ER> => {
  if (isEffectUiRuntime(source)) {
    return source as EffectUiRuntime<R, ER>;
  }

  if (ManagedRuntime.isManagedRuntime(source)) {
    return fromManagedRuntime(source as ManagedRuntime.ManagedRuntime<R, ER>);
  }

  return fromManagedRuntime(
    ManagedRuntime.make((source ?? Layer.empty) as Layer.Layer<R, ER, never>)
  );
};

export const withResourceStore = <R, ER>(
  runtime: EffectUiRuntime<R, ER>,
  resourceStore: ResourceStoreState = makeResourceStore()
): EffectUiRuntime<R, ER> =>
  fromManagedRuntime(runtime.managed as ManagedRuntime.ManagedRuntime<R, ER>, unsafeMutableResourceStore(resourceStore), {
    disposeManaged: false
  });

export const defaultRuntime: EffectUiRuntime<never, never> = makeRuntime(Layer.empty);

let currentRuntime: CurrentRuntimeBoundary | undefined;

export const getCurrentRuntime = (): CurrentRuntimeBoundary | undefined =>
  currentRuntime ?? currentFiberRuntime();

export const currentOrDefaultRuntime = (): CurrentRuntimeBoundary =>
  (getCurrentRuntime() ?? defaultRuntime) as CurrentRuntimeBoundary;

/**
 * Runs synchronous work while making `runtime` the ambient runtime for core helpers.
 *
 * This is useful around render or adapter code that needs the ambient runtime.
 */
export const runWithRuntime = <A, R, ER>(
  runtime: EffectUiRuntime<R, ER> | AnyEffectUiRuntime<ER>,
  f: () => A
): A => {
  const previous = currentRuntime;
  currentRuntime = runtime as AnyEffectUiRuntime<any>;
  try {
    return f();
  } finally {
    currentRuntime = previous;
  }
};

/**
 * Forks an Effect on the current runtime.
 *
 * Use this for background UI work that should keep running independently of the
 * caller's Effect lifecycle.
 */
export const runFork = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: Effect.RunOptions
): Fiber.Fiber<A, E> =>
  currentOrDefaultRuntime().runFork(effect, options) as Fiber.Fiber<A, E>;
