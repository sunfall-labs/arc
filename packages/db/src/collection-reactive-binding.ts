import { invokeEffectInput, runWithRuntime, type AnyEffectUiRuntime, type EffectInput } from "@effect-ui/core";
import { Effect, Fiber } from "effect";
import type { AnyCollection, CollectionLoadState } from "./collection-contract.js";
import { Query, type LiveQuery, type LiveQueryState, type QueryFactory } from "./query-builder.js";

/**
 * Subscribes to the collection signals that framework adapters use to refresh
 * collection-backed UI reads.
 */
export const subscribeCollectionReactiveSource = (
  runtime: AnyEffectUiRuntime<unknown>,
  collection: AnyCollection,
  notify: () => void
): (() => void) =>
  runWithRuntime(runtime, () => {
    const version = collection.version();
    const state = collection.state();
    const unsubscribeVersion = version.subscribe(notify);
    const unsubscribeState = state.subscribe(notify);
    return () => {
      unsubscribeVersion();
      unsubscribeState();
    };
  });

/** Provides the runtime and scopes a collection/live-query Effect. */
export const bindCollectionRuntimeEffect = <A, E, R, ER = never>(
  runtime: AnyEffectUiRuntime<ER>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | ER> =>
  Effect.scoped(runtime.provide(effect));

/** Returns true when two collection source lists have the same identity order. */
export const sameCollectionReactiveSources = (
  left: ReadonlyArray<AnyCollection>,
  right: ReadonlyArray<AnyCollection>
): boolean =>
  left.length === right.length && left.every((source, index) => Object.is(source, right[index]));

/** Extracts the current failure value from a collection load state. */
export const collectionStateError = <E>(state: CollectionLoadState<E>): E | undefined =>
  state._tag === "Failure" ? state.error : undefined;

/** Extracts the current failure value from a live-query state. */
export const liveQueryStateError = <T, E>(state: LiveQueryState<T, E>): E | undefined =>
  state._tag === "Failure" ? state.error : undefined;

/** Query factory or prebuilt LiveQuery accepted by framework live-query adapters. */
export type CollectionReactiveLiveQueryInput<T, E, R> =
  | QueryFactory<T, E, R>
  | LiveQuery<T, E, R>;

/** Memoized live-query selection state shared by framework adapters. */
export interface CollectionReactiveLiveQuerySelection<T, E, R, Runtime> {
  readonly runtime: Runtime;
  readonly stableLiveQueryInput: LiveQuery<T, E, R> | undefined;
  readonly deps: unknown;
  readonly live: LiveQuery<T, E, R>;
}

/** Resolves live-query dependency options to the value used for equality. */
export const collectionReactiveDepsValue = (deps: unknown): unknown =>
  typeof deps === "function" ? (deps as () => unknown)() : deps;

/** Returns true when two framework live-query dependency values are equal. */
export const sameCollectionReactiveDeps = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  }
  return Object.is(left, right);
};

/** Copies array dependency values so later caller mutation cannot change memo identity. */
export const snapshotCollectionReactiveDeps = (value: unknown): unknown =>
  Array.isArray(value) ? [...value] : value;

/** Selects or recreates a runtime-bound LiveQuery for framework adapters. */
export const selectCollectionReactiveLiveQuery = <T, E, R, Runtime extends AnyEffectUiRuntime<unknown>>(
  runtime: Runtime,
  input: CollectionReactiveLiveQueryInput<T, E, R>,
  deps: unknown,
  previous: CollectionReactiveLiveQuerySelection<T, E, R, Runtime> | undefined
): CollectionReactiveLiveQuerySelection<T, E, R, Runtime> => {
  const stableLiveQueryInput = typeof input === "function" ? undefined : input;
  if (
    previous !== undefined &&
    previous.runtime === runtime &&
    previous.stableLiveQueryInput === stableLiveQueryInput &&
    sameCollectionReactiveDeps(previous.deps, deps)
  ) {
    return previous;
  }

  return {
    runtime,
    stableLiveQueryInput,
    deps: snapshotCollectionReactiveDeps(deps),
    live: runWithRuntime(runtime, () =>
      typeof input === "function"
        ? Query.live<T, E, R>(input)
        : input
    )
  };
};

/** Controls mount-time preload fibers for framework collection adapters. */
export interface CollectionReactivePreloadController<E, ER = never> {
  /** Starts a new preload when enabled, interrupting any previous one first. */
  start(preloadEffect: Effect.Effect<void, E, unknown> | undefined, enabled: boolean): void;
  /** Interrupts the current preload fiber and retires its generation as an Effect. */
  interruptEffect(): Effect.Effect<void>;
  /** Runtime-owned synchronous convenience for framework cleanup hooks. */
  interrupt(): void;
}

/** Options for the shared collection/live-query preload controller. */
export interface CollectionReactivePreloadControllerOptions<E, ER = never> {
  /** Runtime that owns preload execution and interruption. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /**
   * Called when the latest preload succeeds.
   *
   * Return a plain value or an Effect. Promise-shaped observers are rejected at
   * the EffectInput seam; adapt host Promise work explicitly with
   * `Effect.tryPromise(...)` before returning it.
   */
  readonly onSuccess: () => EffectInput<void, unknown>;
  /**
   * Called when the latest preload fails.
   *
   * Return a plain value or an Effect. Promise-shaped observers are rejected at
   * the EffectInput seam; adapt host Promise work explicitly with
   * `Effect.tryPromise(...)` before returning it.
   */
  readonly onFailure: (error: E | ER) => EffectInput<void, unknown>;
}

/**
 * Creates the shared mount-time preload lifecycle used by React DB and Solid DB.
 *
 * The controller keeps generation checks in one place so stale preload failures
 * cannot overwrite newer UI state after a source refresh or unmount.
 */
export const makeCollectionReactivePreloadController = <E, ER = never>(
  options: CollectionReactivePreloadControllerOptions<E, ER>
): CollectionReactivePreloadController<E, ER> => {
  let preloadFiber: Fiber.Fiber<void, unknown> | undefined;
  let preloadGeneration = 0;

  const retireCurrentPreload = (): Fiber.Fiber<void, unknown> | undefined => {
    preloadGeneration++;
    const fiber = preloadFiber;
    preloadFiber = undefined;
    return fiber;
  };

  const interruptEffect = (): Effect.Effect<void> => Effect.suspend(() => {
    const fiber = retireCurrentPreload();
    return fiber === undefined
      ? Effect.void
      : Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void));
  });

  const interrupt = (): void => {
    const fiber = retireCurrentPreload();
    if (fiber !== undefined) {
      void options.runtime.runFork(
        Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void))
      );
    }
  };

  const start = (
    preloadEffect: Effect.Effect<void, E, unknown> | undefined,
    enabled: boolean
  ): void => {
    interrupt();
    if (!enabled || preloadEffect === undefined) {
      return;
    }

    const generation = ++preloadGeneration;
    const isCurrentGeneration = (): boolean => preloadGeneration === generation;
    preloadFiber = options.runtime.runFork(
      bindCollectionRuntimeEffect(options.runtime, preloadEffect).pipe(
        Effect.tap(() =>
          isCurrentGeneration()
            ? invokeEffectInput("CollectionReactivePreload.onSuccess", options.onSuccess).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.asVoid
              )
            : Effect.void
        ),
        Effect.catch((error) =>
          isCurrentGeneration()
            ? invokeEffectInput("CollectionReactivePreload.onFailure", options.onFailure, error).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.asVoid
              )
            : Effect.void
        ),
        Effect.catchCause(() => Effect.void)
      )
    );
  };

  return { interruptEffect, interrupt, start };
};
