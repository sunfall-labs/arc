import { Data } from "effect";
import type { CollectionKey } from "./collection-contract.js";

/**
 * Error raised when an update/delete targets a missing row.
 */
export class CollectionRowNotFound extends Data.TaggedError("CollectionRowNotFound")<{
  readonly collection: string;
  readonly key: CollectionKey;
}> {}

/**
 * Error raised when an update would move a row to a different collection key.
 */
export class CollectionRowKeyChanged extends Data.TaggedError("CollectionRowKeyChanged")<{
  readonly collection: string;
  readonly key: CollectionKey;
  readonly nextKey: CollectionKey;
  readonly guidance: string;
}> {}

/**
 * Error raised when a mutation is attempted on a read-only live-query collection.
 */
export class ReadonlyCollectionMutation extends Data.TaggedError("ReadonlyCollectionMutation")<{
  readonly collection: string;
  readonly operation: string;
}> {}
