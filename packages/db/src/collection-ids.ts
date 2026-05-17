/** Runtime marker for Collection Definitions. */
export const CollectionTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-db/Collection",
) as typeof CollectionTypeId;

/** Runtime marker for Collection Store instances. */
export const CollectionStoreTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-db/CollectionStore",
) as typeof CollectionStoreTypeId;

export const CollectionDefinitionSnapshotTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-db/CollectionDefinitionSnapshot",
) as typeof CollectionDefinitionSnapshotTypeId;
