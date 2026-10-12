import { Resource, ResourceTypeId, type EffectInput } from "@sunfall/arc-core";
import type { Effect, Stream } from "effect";
import type {
  AnyCollection,
  CollectionChange,
  CollectionKey,
  CollectionSync,
  CollectionSyncAdapter,
  CollectionSyncDiagnostics,
} from "./collection-contract.js";

/**
 * Runtime view of a collection's backing source.
 *
 * The Collection Runtime reads loads and streams from this
 * normalized shape so inline adapters and `Resource.Ref` sources share one
 * code path.
 */
export interface CollectionSyncHandlers<A extends object, K extends CollectionKey, E, R> {
  readonly diagnostics: CollectionSyncDiagnostics | undefined;
  readonly load: (() => EffectInput<ReadonlyArray<A>, E, R>) | undefined;
  readonly refresh: (() => EffectInput<ReadonlyArray<A>, E, R>) | undefined;
  readonly follow: (() => Stream.Stream<ReadonlyArray<A>, E, R>) | undefined;
  readonly changes: (() => Stream.Stream<ReadonlyArray<CollectionChange<A, K>>, E, R>) | undefined;
}

const emptyHandlers: CollectionSyncHandlers<any, any, any, any> = {
  diagnostics: undefined,
  load: undefined,
  refresh: undefined,
  follow: undefined,
  changes: undefined,
};

const isResourceRefSync = <A extends object, K extends CollectionKey, E, R>(
  sync: CollectionSync<A, K, E, R>,
): sync is Resource.Ref<any, ReadonlyArray<A>, any, any> =>
  typeof sync === "object" &&
  sync !== null &&
  (sync as { readonly [ResourceTypeId]?: unknown })[ResourceTypeId] === ResourceTypeId;

const resourceHandlers = <A extends object, K extends CollectionKey, E, R>(
  ref: Resource.Ref<any, ReadonlyArray<A>, any, any>,
): CollectionSyncHandlers<A, K, E, R> => ({
  ...(emptyHandlers as CollectionSyncHandlers<A, K, E, R>),
  diagnostics: { adapter: `resource:${ref.family.options.name}` },
  load: () => Resource.preload(ref) as Effect.Effect<ReadonlyArray<A>, E, R>,
  refresh: () => Resource.refresh(ref) as Effect.Effect<ReadonlyArray<A>, E, R>,
  follow: () => Resource.changes(ref) as Stream.Stream<ReadonlyArray<A>, E, R>,
});

const adapterHandlers = <A extends object, K extends CollectionKey, E, R>(
  sync: CollectionSyncAdapter<A, K, E, R>,
): CollectionSyncHandlers<A, K, E, R> => {
  // Operations are invoked as methods so adapter objects keep their receiver.
  return {
    diagnostics: sync.name === undefined ? undefined : { adapter: sync.name },
    load:
      sync.load !== undefined
        ? () => sync.load!()
        : sync.refresh !== undefined
          ? () => sync.refresh!()
          : undefined,
    refresh: sync.refresh === undefined ? undefined : () => sync.refresh!(),
    follow: sync.follow === undefined ? undefined : () => sync.follow!(),
    changes: sync.changes === undefined ? undefined : () => sync.changes!(),
  };
};

const handlersByDefinition = new WeakMap<object, CollectionSyncHandlers<any, any, any, any>>();

/**
 * Normalized backing-source handlers for a collection definition.
 *
 * Computed once per definition from `options.sync`.
 */
export const collectionSyncHandlers = <
  A extends object,
  K extends CollectionKey,
  E,
  R,
>(definition: {
  readonly options: { readonly sync?: CollectionSync<A, K, E, R> | undefined };
}): CollectionSyncHandlers<A, K, E, R> => {
  const cached = handlersByDefinition.get(definition);
  if (cached !== undefined) {
    return cached;
  }
  const sync = definition.options.sync;
  const handlers =
    sync === undefined
      ? (emptyHandlers as CollectionSyncHandlers<A, K, E, R>)
      : isResourceRefSync(sync)
        ? resourceHandlers<A, K, E, R>(sync)
        : adapterHandlers(sync);
  handlersByDefinition.set(definition, handlers);
  return handlers;
};

/** Erased form used by diagnostics over heterogeneous collection lists. */
export const anyCollectionSyncHandlers = (
  definition: AnyCollection,
): CollectionSyncHandlers<any, any, unknown, unknown> =>
  collectionSyncHandlers(definition as { readonly options: { readonly sync?: any } });
