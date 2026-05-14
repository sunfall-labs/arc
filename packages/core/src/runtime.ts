import { Effect, Fiber, Layer, ManagedRuntime, type Exit, type Scope } from "effect";
import {
  disposeResourceStoreEffect,
  makeResourceStore,
  ResourceStore,
  type ResourceStore as ResourceStoreState
} from "./resource-store.js";

export const RuntimeTypeId: unique symbol = Symbol.for("@effect-ui/core/Runtime") as typeof RuntimeTypeId;

type RuntimeManagedBoundary<ER> = ManagedRuntime.ManagedRuntime<any, ER>;
type CurrentRuntimeBoundary = EffectUiRuntime<any, any>;

/**
 * Runtime boundary used by core APIs to run Effect programs and share resource state.
 *
 * Use this when a UI root, server adapter, or test needs a stable Effect context.
 * The runtime provides its managed services plus a ResourceStore to every effect it
 * runs.
 */
export interface EffectUiRuntime<R = never, ER = never> {
  readonly [RuntimeTypeId]: typeof RuntimeTypeId;
  readonly managed: RuntimeManagedBoundary<ER>;
  readonly resourceStore: ResourceStoreState;
  /** Provides this runtime's services without starting the effect. */
  provide<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: RuntimeProvideOptions): Effect.Effect<A, E | ER, Scope.Scope>;
  /** Forks an Effect on the runtime and returns the running fiber. */
  runFork<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: Effect.RunOptions): Fiber.Fiber<A, E | ER>;
  /** Runs an Effect on the runtime and resolves or rejects a Promise with its result. */
  runPromise<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: Effect.RunOptions): Promise<A>;
  /** Runs an Effect on the runtime and resolves with its Exit. */
  runPromiseExit<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: Effect.RunOptions): Promise<Exit.Exit<A, E | ER>>;
  /** Runs a synchronous Effect with this runtime as the current runtime. */
  runSync<A, E, RIn>(effect: Effect.Effect<A, E, RIn>): A;
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

export const isEffectUiRuntime = (value: unknown): value is EffectUiRuntime<unknown, never> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [RuntimeTypeId]?: unknown })[RuntimeTypeId] === RuntimeTypeId;

const fromManagedRuntime = <R, ER>(
  managed: ManagedRuntime.ManagedRuntime<R, ER>,
  resourceStore: ResourceStoreState = makeResourceStore(),
  options: { readonly disposeManaged: boolean } = { disposeManaged: true }
): EffectUiRuntime<R, ER> => {
  const managedRuntime: RuntimeManagedBoundary<ER> = managed;

  const provideStore = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    store: ResourceStoreState = resourceStore
  ): Effect.Effect<A, E, Exclude<RIn, ResourceStoreState>> =>
    Effect.provideService(effect, ResourceStore, store);

  const provideManagedServices = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>
  ): Effect.Effect<A, E, unknown> =>
    provideStore(effect);

  const provideRuntimeServices = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    provideOptions?: RuntimeProvideOptions
  ): Effect.Effect<A, E | ER, Scope.Scope> =>
    Effect.flatMap(managedRuntime.contextEffect, (context) =>
      provideStore(
        Effect.provideContext(effect, context),
        provideOptions?.resourceStore
      )
    );

  const disposeStore = disposeResourceStoreEffect(resourceStore);
  const disposeEffect = options.disposeManaged
    ? Effect.andThen(disposeStore, managed.disposeEffect)
    : disposeStore;
  const runtime: EffectUiRuntime<R, ER> = {
    [RuntimeTypeId]: RuntimeTypeId,
    managed: managedRuntime,
    resourceStore,
    provide: provideRuntimeServices,
    runFork: (effect, options) => managedRuntime.runFork(provideManagedServices(effect), options),
    runPromise: (effect, options) => managedRuntime.runPromise(provideManagedServices(effect), options),
    runPromiseExit: (effect, options) => managedRuntime.runPromiseExit(provideManagedServices(effect), options),
    runSync: (effect) =>
      runWithRuntime(runtime, () =>
        managedRuntime.runSync(provideManagedServices(effect))
      ),
    disposeEffect
  };

  return runtime;
};

/**
 * Creates an Effect UI runtime from a Layer, ManagedRuntime, existing runtime, or no services.
 *
 * Prefer one runtime per app boundary so resources, server functions, and actions share
 * the same service context and ResourceStore.
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
  fromManagedRuntime(runtime.managed as ManagedRuntime.ManagedRuntime<R, ER>, resourceStore, {
    disposeManaged: false
  });

export const defaultRuntime: EffectUiRuntime<never, never> = makeRuntime(Layer.empty);

let currentRuntime: CurrentRuntimeBoundary | undefined;

export const getCurrentRuntime = (): CurrentRuntimeBoundary | undefined => currentRuntime;

export const currentOrDefaultRuntime = (): CurrentRuntimeBoundary =>
  currentRuntime ?? defaultRuntime;

/**
 * Runs synchronous work while making `runtime` the ambient runtime for core helpers.
 *
 * This is useful around render or adapter code that needs the ambient runtime.
 */
export const runWithRuntime = <A, R, ER>(
  runtime: EffectUiRuntime<R, ER>,
  f: () => A
): A => {
  const previous = currentRuntime;
  currentRuntime = runtime;
  try {
    return f();
  } finally {
    currentRuntime = previous;
  }
};

/**
 * Runs an Effect with the current runtime, falling back to the default empty runtime.
 *
 * Effect requirements are provided by the ambient EffectUiRuntime when one was set
 * with runWithRuntime.
 */
export const runPromise = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: Effect.RunOptions
): Promise<A> =>
  currentOrDefaultRuntime().runPromise(effect, options);

/** Runs an Effect with the current runtime and returns its Exit instead of throwing. */
export const runPromiseExit = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: Effect.RunOptions
): Promise<Exit.Exit<A, E>> =>
  currentOrDefaultRuntime().runPromiseExit(effect, options) as Promise<Exit.Exit<A, E>>;

/**
 * Forks an Effect on the current runtime.
 *
 * Use this for background UI work that should keep running independently of the
 * calling Promise.
 */
export const runFork = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: Effect.RunOptions
): Fiber.Fiber<A, E> =>
  currentOrDefaultRuntime().runFork(effect, options) as Fiber.Fiber<A, E>;
