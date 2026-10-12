import { Effect } from "effect";
import { Signal, SignalWrites, type ReadableSignal } from "./signal.js";
import type { ResourceStore, ResourceStoreModule } from "./resource-store.js";
import { unsafeMutableResourceStore } from "./resource-store.js";
import { readResourceValue } from "./resource-runtime.js";
import type { RouteHead, RouteHeadContext, RouteHeadStatus, RouteMatch } from "./route.js";

const RouteHeadSourceKey: unique symbol = Symbol.for("@sunfall/arc-core/RouteHeadSource");

/**
 * What a router on a store last settled on: a ready route with its match, a
 * not-found page, or a failed preload. `undefined` before any router settled.
 * Store-local, so each server request and each browser runtime has its own.
 */
export type SettledRoute =
  | { readonly status: "Ready"; readonly match: RouteMatch }
  | { readonly status: "NotFound" | "Failure" };

/** A settled page's head: its route's `head` (empty unless `Ready`) and its status. */
export interface SettledRouteHead {
  readonly head: RouteHead;
  readonly status: RouteHeadStatus;
}

class RouteHeadSource implements ResourceStoreModule {
  readonly settled = SignalWrites.make<SettledRoute | undefined>(undefined, {
    name: "Router.settledRoute",
  });
  readonly dispose: Effect.Effect<void> = Effect.void;
}

const routeHeadSource = (store: ResourceStore): RouteHeadSource => {
  const existing = store.moduleRegistry.get(RouteHeadSourceKey);
  if (existing instanceof RouteHeadSource) {
    return existing;
  }
  const source = new RouteHeadSource();
  store.moduleRegistry.register(RouteHeadSourceKey, source);
  return source;
};

/**
 * Records what a router settled on. The router calls it inside its own state
 * write, so the head changes in the same commit as the page.
 */
export const publishSettledRoute = (store: ResourceStore, settled: SettledRoute): void => {
  routeHeadSource(store).settled.set(settled);
};

/**
 * Evaluates `match`'s route `head` against `store`: `read(ref)` is the
 * Resource's loaded value (tracked inside `Signal.derive`), or `undefined`.
 * A route without `head` has an empty head.
 */
export const routeHeadOf = (match: RouteMatch | undefined, store: ResourceStore): RouteHead => {
  const head = match?.route.options.head;
  if (match === undefined || head === undefined) {
    return {};
  }
  const state = unsafeMutableResourceStore(store);
  const context: RouteHeadContext = {
    ...match,
    read: (ref) => readResourceValue(ref, state),
  };
  return head(context);
};

/**
 * The head of the page the store's router settled on, following the Resource
 * reads of the route's `head`; `undefined` until a router settles.
 */
export const settledRouteHead = (
  store: ResourceStore,
): ReadableSignal<SettledRouteHead | undefined> => {
  const source = routeHeadSource(store);
  return Signal.derive(() => {
    const settled = source.settled.get();
    return settled === undefined
      ? undefined
      : {
          head: settled.status === "Ready" ? routeHeadOf(settled.match, store) : {},
          status: settled.status,
        };
  });
};
