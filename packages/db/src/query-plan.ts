import { stableStringify } from "@effect-ui/core";
import { Data } from "effect";
import type {
  AnyCollection,
  CollectionIndexValue,
  CollectionRow,
  CollectionRowValue
} from "./collection-contract.js";

/**
 * Error raised when the query builder cannot be represented as a live query.
 */
export class UnsupportedLiveQuery extends Data.TaggedError("UnsupportedLiveQuery")<{
  readonly reason: string;
}> {}

export type QuerySortDirection = "asc" | "desc";
export type QuerySortValue = string | number | boolean | Date | null | undefined;
export type QueryJoinKey = string | number | boolean | Date | null | undefined;
export type QueryJoinStrategy = "collection-scan" | "collection-index";

export type SourceRecord = Record<string, AnyCollection>;
export type AnyQueryContext = Record<string, any>;
export type AnyCollectionRow = CollectionRow<any, any>;

export type QueryContext<Sources extends SourceRecord> = {
  readonly [Key in keyof Sources]: CollectionRowValue<Sources[Key]>;
};

export type QueryJoinedContext<
  TContext extends AnyQueryContext,
  Alias extends string,
  C extends AnyCollection
> = TContext & {
  readonly [Key in Alias]: CollectionRowValue<C>;
};

export type QueryJoinResult<TContext, TResult, TNextContext> =
  [TResult] extends [TContext]
    ? [TContext] extends [TResult]
      ? TNextContext
      : TResult
    : TResult;

export interface QueryOrder<TContext> {
  readonly direction: QuerySortDirection;
  readonly selector: (row: TContext) => QuerySortValue;
}

export interface QueryJoin {
  readonly alias: string;
  readonly collection: AnyCollection;
  readonly leftKey: (row: AnyQueryContext) => QueryJoinKey;
  readonly rightKeys: (row: AnyCollectionRow) => ReadonlyArray<QueryJoinKey>;
  readonly rightIndex?: string;
}

export interface QueryPlanSourceDiagnostics {
  readonly alias: string;
  readonly collection: string;
  readonly rows: number;
}

export interface QueryPlanJoinDiagnostics {
  readonly alias: string;
  readonly collection: string;
  readonly strategy: QueryJoinStrategy;
  readonly index?: string;
  readonly leftRows: number;
  readonly rightRows: number;
  readonly outputRows: number;
  readonly estimatedComparisons: number;
}

export interface QueryPlanDiagnostics {
  readonly sources: ReadonlyArray<QueryPlanSourceDiagnostics>;
  readonly joins: ReadonlyArray<QueryPlanJoinDiagnostics>;
  readonly filters: number;
  readonly orders: number;
  readonly grouped: boolean;
  readonly offset: number;
  readonly limit?: number;
  readonly contextRows: number;
}

export interface QueryExecution<TContext> {
  readonly contexts: Array<TContext>;
  readonly diagnostics: QueryPlanDiagnostics;
}

/**
 * Aggregate definition used by `Query.groupBy`.
 */
export interface QueryAggregate<TContext, R, V = unknown> {
  readonly preMap: (row: TContext) => V;
  readonly reduce: (values: Array<[V, number]>) => V;
  readonly postMap?: (value: V) => R;
}

export type QueryAggregateRecord<TContext> = Record<string, QueryAggregate<TContext, any, any>>;
export type AnyQueryAggregateRecord = QueryAggregateRecord<any>;
export type QueryAggregateResult<
  TKey extends Record<string, unknown>,
  Aggregates extends AnyQueryAggregateRecord
> = TKey & {
  readonly [Key in keyof Aggregates]: Aggregates[Key] extends QueryAggregate<infer _Context, infer R, infer _Value> ? R : never;
};

export interface QueryGrouping<TSource extends AnyQueryContext, TResult extends Record<string, unknown>> {
  readonly key: (row: TSource) => Record<string, unknown>;
  readonly aggregates: QueryAggregateRecord<TSource>;
  readonly sourceFilters: ReadonlyArray<(row: TSource) => boolean>;
}

export type AnyQueryGrouping = QueryGrouping<AnyQueryContext, Record<string, unknown>>;

export interface QueryProjectOptions {
  readonly filter?: boolean;
  readonly order?: boolean;
  readonly window?: boolean;
}

export interface QueryPlanBuilder<TContext extends AnyQueryContext> {
  readonly sources: ReadonlyArray<readonly [string, AnyCollection]>;
  readonly filters: ReadonlyArray<(row: TContext) => boolean>;
  readonly orders: ReadonlyArray<QueryOrder<TContext>>;
  readonly offsetCount: number;
  readonly limitCount: number | undefined;
  readonly joins: ReadonlyArray<QueryJoin>;
  readonly grouping: AnyQueryGrouping | undefined;
}

export const projectCurrentContext = <TContext, TResult>(row: TContext): TResult => {
  const value: unknown = row;
  return value as TResult;
};

export const joinKey = (value: QueryJoinKey): string =>
  value instanceof Date ? `Date:${value.toISOString()}` : stableStringify(value);

export const buildContexts = <TContext extends AnyQueryContext>(
  sources: ReadonlyArray<readonly [string, AnyCollection]>
): Array<TContext> => {
  if (sources.length === 0) {
    throw new UnsupportedLiveQuery({ reason: "Live queries require at least one source collection." });
  }

  const contexts: Array<TContext> = [];
  const visit = (index: number, current: Record<string, unknown>): void => {
    if (index >= sources.length) {
      contexts.push({ ...current } as TContext);
      return;
    }

    const source = sources[index];
    if (!source) {
      return;
    }

    const [alias, collection] = source;
    for (const row of collection.rows()) {
      current[alias] = row;
      visit(index + 1, current);
    }
    delete current[alias];
  };

  visit(0, {});
  return contexts;
};

export const buildQueryContexts = <TContext extends AnyQueryContext>(
  builder: QueryPlanBuilder<TContext>
): Array<TContext> =>
  buildQueryExecution(builder).contexts;

export const buildQueryExecution = <TContext extends AnyQueryContext>(
  builder: QueryPlanBuilder<TContext>
): QueryExecution<TContext> => {
  const joinAliases = new Set(builder.joins.map((join) => join.alias));
  const baseSources = builder.sources.filter(([alias]) => !joinAliases.has(alias));
  const sourceDiagnostics = builder.sources.map(([alias, collection]): QueryPlanSourceDiagnostics => ({
    alias,
    collection: collection.name,
    rows: collection.rows().length
  }));
  const joins: Array<QueryPlanJoinDiagnostics> = [];
  let contexts = buildContexts<AnyQueryContext>(baseSources);

  for (const join of builder.joins) {
    const joined: Array<AnyQueryContext> = [];
    const leftRows = contexts.length;
    const rightRows = join.collection.rows().length;
    for (const context of contexts) {
      const leftValue = join.leftKey(context);
      const left = joinKey(leftValue);
      const rows = join.rightIndex
        ? join.collection.index(join.rightIndex, leftValue as CollectionIndexValue)
        : join.collection.rows();
      for (const row of rows) {
        if (join.rightKeys(row).some((rightValue) => left === joinKey(rightValue))) {
          joined.push({
            ...context,
            [join.alias]: row
          });
        }
      }
    }
    joins.push({
      alias: join.alias,
      collection: join.collection.name,
      strategy: join.rightIndex ? "collection-index" : "collection-scan",
      ...(join.rightIndex === undefined ? {} : { index: join.rightIndex }),
      leftRows,
      rightRows,
      outputRows: joined.length,
      estimatedComparisons: join.rightIndex ? leftRows : leftRows * rightRows
    });
    contexts = joined;
  }

  let resultContexts: Array<AnyQueryContext>;
  if (builder.grouping) {
    resultContexts = groupContexts(contexts, builder.grouping);
  } else {
    resultContexts = contexts;
  }

  return {
    contexts: resultContexts as Array<TContext>,
    diagnostics: {
      sources: sourceDiagnostics,
      joins,
      filters: builder.filters.length,
      orders: builder.orders.length,
      grouped: builder.grouping !== undefined,
      offset: builder.offsetCount,
      ...(builder.limitCount === undefined ? {} : { limit: builder.limitCount }),
      contextRows: resultContexts.length
    }
  };
};

export const groupContexts = (
  contexts: ReadonlyArray<AnyQueryContext>,
  grouping: AnyQueryGrouping
): Array<Record<string, unknown>> => {
  const groups = new Map<string, {
    readonly key: Record<string, unknown>;
    readonly values: Array<AnyQueryContext>;
  }>();

  for (const context of contexts) {
    if (!grouping.sourceFilters.every((filter) => filter(context))) {
      continue;
    }

    const key = grouping.key(context);
    const keyString = stableStringify(key);
    const existing = groups.get(keyString);
    if (existing) {
      existing.values.push(context);
    } else {
      groups.set(keyString, { key, values: [context] });
    }
  }

  return Array.from(groups.values(), (group) => {
    const result: Record<string, unknown> = { ...group.key };
    for (const [name, aggregate] of Object.entries(grouping.aggregates)) {
      const values = group.values.map((value) => [aggregate.preMap(value), 1] as [unknown, number]);
      const reduced = aggregate.reduce(values);
      result[name] = aggregate.postMap ? aggregate.postMap(reduced) : reduced;
    }
    return result;
  });
};

export const compareValue = (left: QuerySortValue, right: QuerySortValue): number => {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;

  if (leftValue === rightValue) return 0;
  if (leftValue === null || leftValue === undefined) return 1;
  if (rightValue === null || rightValue === undefined) return -1;
  return leftValue < rightValue ? -1 : 1;
};

export const compareRows = <TContext>(
  left: TContext,
  right: TContext,
  leftIndex: number,
  rightIndex: number,
  orders: ReadonlyArray<QueryOrder<TContext>>
): number => {
  for (const order of orders) {
    const direction = order.direction === "asc" ? 1 : -1;
    const comparison = compareValue(order.selector(left), order.selector(right));
    if (comparison !== 0) {
      return comparison * direction;
    }
  }

  return leftIndex - rightIndex;
};

export const querySources = (builder: QueryPlanBuilder<any>): ReadonlyArray<AnyCollection> =>
  builder.sources.map(([, collection]) => collection);
