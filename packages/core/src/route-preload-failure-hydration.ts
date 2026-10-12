import { Effect } from "effect";
import type { ResourceStore, ResourceStoreModule } from "./resource-store.js";
import type { RoutePreloadFailureSnapshot } from "./route.js";

const RoutePreloadFailureHydrationKey: unique symbol = Symbol.for(
  "@sunfall/arc-core/RoutePreloadFailureHydration",
);

/** Store-local route preload failures waiting for the router that renders their href. */
class RoutePreloadFailureHydration implements ResourceStoreModule {
  readonly failures = new Map<string, RoutePreloadFailureSnapshot>();
  readonly dispose: Effect.Effect<void> = Effect.sync(() => {
    this.failures.clear();
  });
}

const existingHydration = (store: ResourceStore): RoutePreloadFailureHydration | undefined => {
  const module = store.moduleRegistry.get(RoutePreloadFailureHydrationKey);
  return module instanceof RoutePreloadFailureHydration ? module : undefined;
};

/** Records a server-rendered route preload failure for the first router on `store`. */
export const hydrateRoutePreloadFailure = (
  store: ResourceStore,
  snapshot: RoutePreloadFailureSnapshot,
): void => {
  const hydration = existingHydration(store) ?? new RoutePreloadFailureHydration();
  store.moduleRegistry.register(RoutePreloadFailureHydrationKey, hydration);
  hydration.failures.set(snapshot.href, snapshot);
};

/**
 * Takes the hydrated preload failure for `href`, if any. Taking consumes it:
 * only the router that hydrates the server output starts from it; later
 * routers and navigations run the route preload again.
 */
export const takeHydratedRoutePreloadFailure = (
  store: ResourceStore,
  href: string,
): RoutePreloadFailureSnapshot | undefined => {
  const hydration = existingHydration(store);
  const snapshot = hydration?.failures.get(href);
  hydration?.failures.delete(href);
  return snapshot;
};
