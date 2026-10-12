import { Effect } from "effect";
import type { ResourceStore, ResourceStoreModule } from "./resource-store.js";
import type { RoutePreloadFailureSnapshot } from "./route.js";

const RoutePreloadFailureHydrationKey: unique symbol = Symbol.for(
  "@sunfall/arc-core/RoutePreloadFailureHydration",
);

/**
 * Store-local route outcomes a server render showed, waiting for the router
 * that hydrates that output: preload failures by href, and a not-found render.
 */
class RoutePreloadFailureHydration implements ResourceStoreModule {
  readonly failures = new Map<string, RoutePreloadFailureSnapshot>();
  notFound = false;
  readonly dispose: Effect.Effect<void> = Effect.sync(() => {
    this.failures.clear();
    this.notFound = false;
  });
}

const hydrationFor = (store: ResourceStore): RoutePreloadFailureHydration => {
  const hydration = existingHydration(store) ?? new RoutePreloadFailureHydration();
  store.moduleRegistry.register(RoutePreloadFailureHydrationKey, hydration);
  return hydration;
};

const existingHydration = (store: ResourceStore): RoutePreloadFailureHydration | undefined => {
  const module = store.moduleRegistry.get(RoutePreloadFailureHydrationKey);
  return module instanceof RoutePreloadFailureHydration ? module : undefined;
};

/** Records a server-rendered route preload failure for the first router on `store`. */
export const hydrateRoutePreloadFailure = (
  store: ResourceStore,
  snapshot: RoutePreloadFailureSnapshot,
): void => {
  hydrationFor(store).failures.set(snapshot.href, snapshot);
};

/** Records that the server rendered the not-found state, for the first router on `store`. */
export const hydrateRouteNotFound = (store: ResourceStore): void => {
  hydrationFor(store).notFound = true;
};

/**
 * Takes the hydrated not-found record. It holds whatever href the router
 * starts at: a static host serves one not-found document at every missing
 * URL, and that document must hydrate as the not-found state it shows.
 */
export const takeHydratedRouteNotFound = (store: ResourceStore): boolean => {
  const hydration = existingHydration(store);
  const notFound = hydration?.notFound ?? false;
  if (hydration !== undefined) {
    hydration.notFound = false;
  }
  return notFound;
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
