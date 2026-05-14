import { Context } from "effect";
import type { AnyCollection } from "./index.js";

export interface CollectionPreloadCollector {
  readonly definitions: Map<string, AnyCollection>;
}

export const CollectionPreloadCollector = Context.Service<CollectionPreloadCollector>(
  "@effect-ui/db/CollectionPreloadCollector"
);

export interface CollectionPreloadCollected<A> {
  readonly value: A;
  readonly definitions: ReadonlyArray<AnyCollection>;
}
