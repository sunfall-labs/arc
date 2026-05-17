import {
  invokeEffectInput,
  runWithRuntime,
  type AnySunfallArcRuntime,
  type EffectInput,
} from "@sunfall/arc-core";
import {
  bindCollectionRuntimeEffect,
  collectionStateError,
  liveQueryStateError,
  makeCollectionReactivePreloadController,
  sameCollectionReactiveSources,
  subscribeCollectionReactiveSource,
  type AnyCollection,
} from "@sunfall/arc-db";
import { useRuntime } from "@sunfall/arc-react";
import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export { collectionStateError, liveQueryStateError };

export interface ReactDbReactiveBinding<E, ER = never> {
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly preloadFailure: E | ER | undefined;
  read<A>(read: () => A): A;
  bindEffect<A, E2, R>(effect: Effect.Effect<A, E2, R>): Effect.Effect<A, E2 | ER>;
}

export interface ReactDbReactiveBindingOptions<E, R = never, ER = never> {
  readonly runtime?: AnySunfallArcRuntime<ER> | undefined;
  readonly sources: ReadonlyArray<AnyCollection> | (() => ReadonlyArray<AnyCollection>);
  readonly preload?: boolean | undefined;
  readonly preloadEffect?: Effect.Effect<void, E, R> | undefined;
  /**
   * Observer for automatic preload failures.
   *
   * Return a plain value or an Effect. Promise-shaped observers are rejected at
   * the EffectInput seam; observer failures are ignored after state is updated.
   */
  readonly onPreloadFailure?: ((error: E | ER) => EffectInput<void, unknown>) | undefined;
}

const useStableSources = (sources: ReadonlyArray<AnyCollection>): ReadonlyArray<AnyCollection> => {
  const stableSources = useRef<ReadonlyArray<AnyCollection>>(sources);
  if (!sameCollectionReactiveSources(stableSources.current, sources)) {
    stableSources.current = sources;
  }
  return stableSources.current;
};

const useReactiveTick = (
  runtime: AnySunfallArcRuntime<unknown>,
  sources: ReadonlyArray<AnyCollection> | (() => ReadonlyArray<AnyCollection>),
): number => {
  const version = useRef(0);
  const listeners = useRef(new Set<() => void>());
  const currentSources = useStableSources(typeof sources === "function" ? sources() : sources);
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const getSnapshot = useCallback(() => version.current, []);
  const notify = useCallback(() => {
    version.current++;
    for (const listener of Array.from(listeners.current)) {
      listener();
    }
  }, []);

  useEffect(() => {
    const cleanups = currentSources.map((source) =>
      subscribeCollectionReactiveSource(runtime, source, notify),
    );
    notify();
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [runtime, currentSources, notify]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/**
 * Shared React binding for collection-backed reads.
 *
 * It owns the runtime seam, source subscriptions, component cleanup,
 * mount-time preloading, and runtime-bound Effects so React DB hooks only
 * describe their domain-specific accessors.
 */
export const useReactDbReactiveBinding = <E, R = never, ER = never>(
  options: ReactDbReactiveBindingOptions<E, R, ER>,
): ReactDbReactiveBinding<E, ER> => {
  const contextRuntime = useRuntime<ER>();
  const runtime = options.runtime ?? contextRuntime;
  const [preloadFailure, setPreloadFailure] = useState<E | ER | undefined>(undefined);
  const preloadFailureObserver = useRef(options.onPreloadFailure);
  preloadFailureObserver.current = options.onPreloadFailure;
  const preloadEffect = options.preloadEffect;

  const tick = useReactiveTick(runtime, options.sources);
  const preloadController = useMemo(
    () =>
      makeCollectionReactivePreloadController<E, ER>({
        runtime,
        onSuccess: () => setPreloadFailure(undefined),
        onFailure: (error) =>
          Effect.sync(() => setPreloadFailure(error)).pipe(
            Effect.andThen(
              preloadFailureObserver.current === undefined
                ? Effect.void
                : invokeEffectInput(
                    "ReactDbReactiveBinding.onPreloadFailure",
                    preloadFailureObserver.current,
                    error,
                  ).pipe(
                    Effect.catchCause(() => Effect.void),
                    Effect.asVoid,
                  ),
            ),
          ),
      }),
    [runtime],
  );

  useEffect(() => {
    preloadController.start(preloadEffect, options.preload !== false);
    return preloadController.interrupt;
  }, [preloadController, options.preload, preloadEffect]);

  return useMemo(
    () => ({
      runtime,
      preloadFailure,
      read: <A>(read: () => A): A => {
        void tick;
        return runWithRuntime(runtime, read);
      },
      bindEffect: <A, E2, Requirements>(
        effect: Effect.Effect<A, E2, Requirements>,
      ): Effect.Effect<A, E2 | ER> =>
        bindCollectionRuntimeEffect<A, E2, Requirements, ER>(runtime, effect),
    }),
    [runtime, preloadFailure, tick],
  );
};
