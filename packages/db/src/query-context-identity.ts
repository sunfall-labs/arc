import type { Resource } from "@sunfall/arc-core";
import { stableStringify } from "@sunfall/arc-core/internal";
import type { AnyQueryContext, AnyQueryRow } from "./query-plan.js";

declare const QueryContextIdentityBrand: unique symbol;

export type QueryContextIdentity = string & {
  readonly [QueryContextIdentityBrand]: typeof QueryContextIdentityBrand;
};

export interface QueryContextIdentityRecord {
  readonly [queryContextIdentitySymbol]: QueryContextIdentity;
}

export const queryContextIdentitySymbol: unique symbol = Symbol.for(
  "@sunfall/arc-db/QueryContextKey",
) as typeof queryContextIdentitySymbol;

const makeQueryContextIdentity = (value: unknown): QueryContextIdentity =>
  stableStringify(value) as QueryContextIdentity;

export const querySourceContextIdentity = (
  alias: string,
  key: Resource.RowKey,
): QueryContextIdentity => makeQueryContextIdentity([alias, typeof key, key]);

export const queryRowIdentity = (key: Resource.RowKey): QueryContextIdentity =>
  makeQueryContextIdentity([typeof key, key]);

export const mergeQueryContextIdentities = (
  left: QueryContextIdentity | string,
  right: QueryContextIdentity | string,
): QueryContextIdentity => makeQueryContextIdentity([left, right]);

/** Keys of source row objects, recorded as sources are read. */
const rowKeys = new WeakMap<object, Resource.RowKey>();

/** Records the key `rows.key` gave a source row, for stable order tie-breaks. */
export const recordQueryRowKey = (row: unknown, key: Resource.RowKey): void => {
  if (typeof row === "object" && row !== null) {
    rowKeys.set(row, key);
  }
};

const rowKey = (value: unknown): Resource.RowKey | undefined =>
  typeof value === "object" && value !== null ? rowKeys.get(value) : undefined;

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
  row: AnyQueryRow,
  key: Resource.RowKey,
): AnyQueryContext & QueryContextIdentityRecord => ({
  [alias]: row,
  [queryContextIdentitySymbol]: querySourceContextIdentity(alias, key),
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
