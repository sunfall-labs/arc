import { Effect, Fiber, Layer, ManagedRuntime, type Exit, type Scope } from "effect";
import {
  disposeResourceStoreEffect,
  makeResourceStore,
  ResourceStore,
  type ResourceStore as ResourceStoreState
} from "./resource-store.js";

export const RuntimeTypeId: unique symbol = Symbol.for("@effect-ui/core/Runtime") as typeof RuntimeTypeId;

export interface EffectUiRuntime<R = never, ER = never> {
  readonly [RuntimeTypeId]: typeof RuntimeTypeId;
  readonly managed: ManagedRuntime.ManagedRuntime<any, ER>;
  readonly resourceStore: ResourceStoreState;
  provide<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: RuntimeProvideOptions): Effect.Effect<A, E | ER, Scope.Scope>;
  runFork<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: Effect.RunOptions): Fiber.Fiber<A, E | ER>;
  runPromise<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: Effect.RunOptions): Promise<A>;
  runPromiseExit<A, E, RIn>(effect: Effect.Effect<A, E, RIn>, options?: Effect.RunOptions): Promise<Exit.Exit<A, E | ER>>;
  runSync<A, E, RIn>(effect: Effect.Effect<A, E, RIn>): A;
  readonly disposeEffect: Effect.Effect<void>;
  dispose(): Promise<void>;
}

export interface RuntimeProvideOptions {
  readonly resourceStore?: ResourceStoreState;
}

export type RuntimeSource<R = never, ER = never> =
  | EffectUiRuntime<R, ER>
  | ManagedRuntime.ManagedRuntime<R, ER>
  | Layer.Layer<R, ER, never>;

export const isEffectUiRuntime = (value: unknown): value is EffectUiRuntime<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [RuntimeTypeId]?: unknown })[RuntimeTypeId] === RuntimeTypeId;

const fromManagedRuntime = <R, ER>(
  managed: ManagedRuntime.ManagedRuntime<R, ER>,
  resourceStore: ResourceStoreState = makeResourceStore(),
  options: { readonly disposeManaged: boolean } = { disposeManaged: true }
): EffectUiRuntime<R, ER> => {
  const managedRuntime: ManagedRuntime.ManagedRuntime<any, ER> = managed;

  const provideStore = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>,
    store: ResourceStoreState = resourceStore
  ): Effect.Effect<A, E, Exclude<RIn, ResourceStoreState>> =>
    Effect.provideService(effect, ResourceStore, store);

  const provideManagedServices = <A, E, RIn>(
    effect: Effect.Effect<A, E, RIn>
  ): Effect.Effect<A, E, any> =>
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
    disposeEffect,
    dispose: () => managedRuntime.runPromise(disposeEffect)
  };

  return runtime;
};

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

let currentRuntime: EffectUiRuntime<any, any> | undefined;

export const getCurrentRuntime = (): EffectUiRuntime<any, any> | undefined => currentRuntime;

export const currentOrDefaultRuntime = (): EffectUiRuntime<any, any> =>
  currentRuntime ?? defaultRuntime;

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

export const runPromise = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: Effect.RunOptions
): Promise<A> =>
  currentOrDefaultRuntime().runPromise(effect, options);

export const runPromiseExit = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: Effect.RunOptions
): Promise<Exit.Exit<A, E>> =>
  currentOrDefaultRuntime().runPromiseExit(effect, options) as Promise<Exit.Exit<A, E>>;

export const runFork = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: Effect.RunOptions
): Fiber.Fiber<A, E> =>
  currentOrDefaultRuntime().runFork(effect, options) as Fiber.Fiber<A, E>;
