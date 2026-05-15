import { runWithRuntime, type AnyEffectUiRuntime } from "@effect-ui/core";
import {
  bindCollectionRuntimeEffect,
  collectionStateError,
  liveQueryStateError,
  makeCollectionReactivePreloadController,
  sameCollectionReactiveSources,
  subscribeCollectionReactiveSource,
  type AnyCollection
} from "@effect-ui/db";
import { useRuntime } from "@effect-ui/solid";
import { Effect } from "effect";
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

export { collectionStateError, liveQueryStateError };

export interface SolidDbReactiveBinding<E, ER = never> {
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly tick: Accessor<number>;
  readonly preloadFailure: Accessor<E | ER | undefined>;
  read<A>(read: () => A): A;
  bindEffect<A, Error, R>(effect: Effect.Effect<A, Error, R>): Effect.Effect<A, Error | ER>;
  refreshSources(): void;
}

export interface SolidDbReactiveBindingOptions<E, R = never, ER = never> {
  readonly runtime?: AnyEffectUiRuntime<ER> | undefined;
  readonly sources: ReadonlyArray<AnyCollection> | Accessor<ReadonlyArray<AnyCollection>>;
  readonly preload?: boolean | undefined;
  readonly preloadEffect?: Effect.Effect<void, E, R> | undefined;
  /** Observer for automatic preload failures. Throws are ignored after the signal is updated. */
  readonly onPreloadFailure?: ((error: E | ER) => void) | undefined;
}

/**
 * Shared Solid binding for collection-backed reads.
 *
 * It owns the runtime seam, source subscriptions, owner cleanup, mount-time
 * preloading, and runtime-bound Effects so Solid DB hooks only describe their
 * domain-specific accessors.
 */
export const makeSolidDbReactiveBinding = <E, R = never, ER = never>(
  options: SolidDbReactiveBindingOptions<E, R, ER>
): SolidDbReactiveBinding<E, ER> => {
  const runtime = options.runtime ?? useRuntime<ER>();
  const [tick, setTick] = createSignal(0);
  const [preloadFailure, setPreloadFailure] = createSignal<E | ER | undefined>(undefined);
  const notify = () => setTick((value) => value + 1);
  let cleanups: Array<() => void> = [];
  const readSources = (): ReadonlyArray<AnyCollection> =>
    typeof options.sources === "function" ? options.sources() : options.sources;
  const subscribeSources = (sources: ReadonlyArray<AnyCollection>): Array<() => void> =>
    sources.map((source) => subscribeCollectionReactiveSource(runtime, source, notify));
  const preloadController = makeCollectionReactivePreloadController<E, ER>({
    runtime,
    onSuccess: () => setPreloadFailure(() => undefined),
    onFailure: (error) => {
      setPreloadFailure(() => error);
      if (options.onPreloadFailure) {
        try {
          options.onPreloadFailure(error);
        } catch {
          // Observer callbacks must not fail the fire-and-forget preload fiber.
        }
      }
    }
  });
  const startPreload = (): void => {
    preloadController.start(options.preloadEffect, options.preload !== false);
  };

  let currentSources = readSources();
  cleanups = subscribeSources(currentSources);
  startPreload();

  if (typeof options.sources === "function") {
    createEffect(() => {
      refreshSources();
    });
  }

  function refreshSources(): void {
    const sources = readSources();
    if (sameCollectionReactiveSources(sources, currentSources)) {
      return;
    }
    currentSources = sources;
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups = subscribeSources(sources);
    startPreload();
    notify();
  }

  onCleanup(() => {
    preloadController.interrupt();
    for (const cleanup of cleanups) {
      cleanup();
    }
  });

  return {
    runtime,
    tick,
    preloadFailure,
    read: (read) => {
      tick();
      return runWithRuntime(runtime, read);
    },
    bindEffect: (effect) => bindCollectionRuntimeEffect(runtime, effect),
    refreshSources
  };
};
