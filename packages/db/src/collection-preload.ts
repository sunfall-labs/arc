import { Context } from "effect";
import type { AnyCollection } from "./collection-contract.js";

export interface CollectionPreloadCollector {
  /**
   * Ordered collection preload facts observed in the current collector.
   *
   * The list may contain duplicate definition identities. Nested
   * `Collection.collectEffect(...)` calls append their facts to the parent
   * collector; dehydration later dedupes identical definitions and rejects
   * distinct definitions that share a collection name.
   */
  readonly definitions: AnyCollection[];
}

export const CollectionPreloadCollector = Context.Service<CollectionPreloadCollector>(
  "@effect-ui/db/CollectionPreloadCollector"
);

export interface CollectionPreloadCollected<A> {
  readonly value: A;
  readonly definitions: ReadonlyArray<AnyCollection>;
}
