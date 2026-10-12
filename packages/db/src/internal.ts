/**
 * Internal plumbing shared by Sunfall Arc adapter packages
 * (`@sunfall/arc-solid-db`, `@sunfall/arc-start`, devtools, and tests).
 *
 * Not public API: no stability guarantees, and application code should not
 * import from `@sunfall/arc-db/internal`.
 */
import { Effect, Option } from "effect";
import type { AnyCollection } from "./collection-contract.js";
import { CollectionTypeId } from "./collection-ids.js";
import {
  CollectionPreloadCollector,
  type CollectionPreloadCollected,
  type CollectionPreloadCollector as CollectionPreloadCollectorState,
} from "./collection-preload.js";

export {
  bindCollectionRuntime,
  makeCollectionReactivePreloadController,
  type CollectionReactivePreloadController,
  type CollectionReactivePreloadControllerOptions,
} from "./collection-reactive-binding.js";
export { CollectionStoreTypeId, CollectionTypeId } from "./collection-ids.js";
export {
  CollectionPreloadCollector,
  type CollectionPreloadCollected,
} from "./collection-preload.js";
export {
  defaultCollectionDefinitionRegistry,
  makeCollectionDefinitionRegistry,
  type CollectionDefinitionRegistryAdapter,
} from "./collection-registry.js";
export {
  activeCollectionStore,
  currentCollectionStore,
  defineCollection,
  dehydrateCollectionsSync,
  dehydrateCollections,
  forgetFailedCollectionLoads,
  hydrateCollections,
  subscribeCollectionEvents,
  validateCollectionsHydration,
} from "./collection-runtime.js";
export { buildQuery } from "./query-builder.js";
export type {
  CollectionDefinitionDiagnostics,
  CollectionDiagnostics,
  CollectionStore,
  CollectionStoreDiagnostics,
  CollectionStoreDiagnosticsSnapshot,
  CollectionStoreEvent,
  CollectionSyncDiagnostics,
} from "./collection-contract.js";

/** Type guard for runtime collection definitions. */
export const isCollection = (value: unknown): value is AnyCollection =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [CollectionTypeId]?: unknown })[CollectionTypeId] === CollectionTypeId;

/**
 * Run an Effect and collect the collections it preloads.
 *
 * Start uses this for SSR and route loaders that need data plus a hydration
 * payload. The returned definitions are ordered preload facts. Nested
 * collectors propagate their facts to the parent collector; dehydration dedupes
 * identical definitions and rejects distinct same-name definitions.
 */
export const collectCollections = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<CollectionPreloadCollected<A>, E, R> =>
  Effect.gen(function* () {
    const parentCollector = yield* Effect.serviceOption(CollectionPreloadCollector);
    const collector: CollectionPreloadCollectorState = { definitions: [] };
    const value = yield* Effect.provideService(effect, CollectionPreloadCollector, collector);
    if (Option.isSome(parentCollector)) {
      parentCollector.value.definitions.push(...collector.definitions);
    }
    return {
      value,
      definitions: collector.definitions.slice(),
    };
  });
