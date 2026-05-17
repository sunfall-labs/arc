/** Runtime marker for Collection Definitions. */
export const CollectionTypeId: unique symbol = Symbol.for("@effect-ui/db/Collection") as typeof CollectionTypeId;

/** Runtime marker for Collection Store instances. */
export const CollectionStoreTypeId: unique symbol = Symbol.for("@effect-ui/db/CollectionStore") as typeof CollectionStoreTypeId;

export const CollectionDefinitionSnapshotTypeId: unique symbol = Symbol.for("@effect-ui/db/CollectionDefinitionSnapshot") as typeof CollectionDefinitionSnapshotTypeId;
