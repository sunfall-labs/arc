import { stableStringify } from "@effect-ui/core";
import type { CollectionKey } from "./collection-contract.js";
import type { AnyCollectionRow, AnyQueryContext } from "./query-plan.js";

declare const QueryContextIdentityBrand: unique symbol;

export type QueryContextIdentity = string & {
  readonly [QueryContextIdentityBrand]: typeof QueryContextIdentityBrand;
};

export interface QueryContextIdentityRecord {
  readonly [queryContextIdentitySymbol]: QueryContextIdentity;
}

export const queryContextIdentitySymbol: unique symbol = Symbol.for(
  "@effect-ui/db/QueryContextKey",
) as typeof queryContextIdentitySymbol;

const makeQueryContextIdentity = (value: unknown): QueryContextIdentity =>
  stableStringify(value) as QueryContextIdentity;

export const querySourceContextIdentity = (
  alias: string,
  key: CollectionKey,
): QueryContextIdentity => makeQueryContextIdentity([alias, typeof key, key]);

export const queryCollectionRowIdentity = (key: CollectionKey): QueryContextIdentity =>
  makeQueryContextIdentity([typeof key, key]);

export const mergeQueryContextIdentities = (
  left: QueryContextIdentity | string,
  right: QueryContextIdentity | string,
): QueryContextIdentity => makeQueryContextIdentity([left, right]);

const rowKey = (value: unknown): CollectionKey | undefined =>
  typeof value === "object" && value !== null && "$key" in value
    ? (value as { readonly $key: CollectionKey }).$key
    : undefined;

export const queryContextOrderIdentity = (
  aliases: ReadonlyArray<string>,
  context: AnyQueryContext,
): QueryContextIdentity | undefined => {
  let identity: QueryContextIdentity | undefined;
  for (const alias of aliases) {
    const key = rowKey(context[alias]);
    if (key === undefined) {
      continue;
    }

    const sourceIdentity = querySourceContextIdentity(alias, key);
    identity =
      identity === undefined
        ? sourceIdentity
        : mergeQueryContextIdentities(identity, sourceIdentity);
  }

  return identity;
};

export const queryContextIdentityOf = (context: unknown): QueryContextIdentity | undefined =>
  typeof context === "object" && context !== null && queryContextIdentitySymbol in context
    ? (context as QueryContextIdentityRecord)[queryContextIdentitySymbol]
    : undefined;

export const querySourceContext = (
  alias: string,
  row: AnyCollectionRow,
): AnyQueryContext & QueryContextIdentityRecord => ({
  [alias]: row,
  [queryContextIdentitySymbol]: querySourceContextIdentity(alias, row.$key),
});

export const mergeQueryContextRecords = (
  left: (AnyQueryContext & Partial<QueryContextIdentityRecord>) | null,
  right: (AnyQueryContext & Partial<QueryContextIdentityRecord>) | null,
): AnyQueryContext & QueryContextIdentityRecord => {
  const leftKey = queryContextIdentityOf(left) ?? "";
  const rightKey = queryContextIdentityOf(right) ?? "";
  return {
    ...left,
    ...right,
    [queryContextIdentitySymbol]: mergeQueryContextIdentities(leftKey, rightKey),
  };
};
