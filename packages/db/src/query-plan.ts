import { stableStringify } from "@effect-ui/core";
import { Data } from "effect";
import type {
  AnyCollection,
  CollectionError,
  CollectionRuntimeError,
  CollectionRequirements,
  CollectionRow,
  CollectionRowValue
} from "./collection-contract.js";
import {
  makeQuerySourceAdapter,
  makeQuerySourceAdapters,
  type QueryCollectionSourceAdapter
} from "./query-source-adapter.js";

/**
 * Error raised when the query builder cannot be represented as a live query.
 */
export class UnsupportedLiveQuery extends Data.TaggedError("UnsupportedLiveQuery")<{
  readonly reason: string;
}> {}

export type QueryEvaluationOperation =
  | "source"
  | "filter"
  | "join"
  | "aggregate"
  | "order"
  | "projection"
  | "evaluate";

/**
 * Error raised when user-provided synchronous query callbacks throw during
 * evaluation.
 */
export class QueryEvaluationError extends Data.TaggedError("QueryEvaluationError")<{
  readonly operation: QueryEvaluationOperation;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type QuerySortDirection = "asc" | "desc";
export type QuerySortValue = string | number | boolean | Date | null | undefined;
export type QueryJoinKey = string | number | boolean | Date | null | undefined;
export type QueryJoinStrategy = "collection-scan" | "collection-index";

export type SourceRecord = Record<string, AnyCollection>;
export type AnyQueryContext = Record<string, any>;
export type AnyCollectionRow = CollectionRow<any, any>;

export type QuerySourcesError<Sources extends SourceRecord> =
  CollectionRuntimeError<CollectionError<Sources[keyof Sources]>>;

export type QuerySourcesRequirements<Sources extends SourceRecord> =
  CollectionRequirements<Sources[keyof Sources]>;

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

const isQueryEvaluationError = (cause: unknown): cause is QueryEvaluationError =>
  cause instanceof QueryEvaluationError ||
  (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { readonly _tag?: unknown })._tag === "QueryEvaluationError" &&
    "operation" in cause &&
    "cause" in cause &&
    "message" in cause
  );

export const toQueryEvaluationError = (
  operation: QueryEvaluationOperation,
  cause: unknown
): QueryEvaluationError =>
  isQueryEvaluationError(cause)
    ? cause
    : new QueryEvaluationError({
      operation,
      cause,
      message: cause instanceof Error ? cause.message : String(cause)
    });

export const evaluateQueryOperation = <A>(
  operation: QueryEvaluationOperation,
  evaluate: () => A
): A => {
  try {
    return evaluate();
  } catch (cause) {
    throw toQueryEvaluationError(operation, cause);
  }
};

export const joinKey = (value: QueryJoinKey): string =>
  value instanceof Date ? `Date:${value.toISOString()}` : stableStringify(value);

export const evaluateQueryJoinKey = (value: QueryJoinKey): string =>
  evaluateQueryOperation("join", () => joinKey(value));

export const evaluateQueryGroupKey = (value: Record<string, unknown>): string =>
  evaluateQueryOperation("aggregate", () => stableStringify(value));

/** Validates alias and join invariants before a Query plan reads source rows. */
export const validateQueryPlan = <TContext extends AnyQueryContext>(
  builder: QueryPlanBuilder<TContext>
): void => {
  if (builder.sources.length === 0) {
    throw new UnsupportedLiveQuery({ reason: "Live queries require at least one source collection." });
  }
  if (!Number.isSafeInteger(builder.offsetCount) || builder.offsetCount < 0) {
    throw new UnsupportedLiveQuery({ reason: "Query offset must be a finite non-negative safe integer." });
  }
  if (
    builder.limitCount !== undefined &&
    (!Number.isSafeInteger(builder.limitCount) || builder.limitCount < 0)
  ) {
    throw new UnsupportedLiveQuery({ reason: "Query limit must be a finite non-negative safe integer." });
  }

  const aliases = new Map<string, AnyCollection>();
  for (const [alias, collection] of builder.sources) {
    const existing = aliases.get(alias);
    if (existing) {
      throw new UnsupportedLiveQuery({
        reason: `Query source alias "${alias}" is registered more than once.`
      });
    }
    aliases.set(alias, collection);
  }

  for (const join of builder.joins) {
    const source = aliases.get(join.alias);
    if (!source) {
      throw new UnsupportedLiveQuery({
        reason: `Join source "${join.alias}" is not registered.`
      });
    }
    if (source !== join.collection) {
      throw new UnsupportedLiveQuery({
        reason: `Join source "${join.alias}" is registered for collection "${source.name}" but the join uses "${join.collection.name}".`
      });
    }
    if (
      join.rightIndex !== undefined &&
      !makeQuerySourceAdapter(join.collection).hasIndex(join.rightIndex)
    ) {
      throw new UnsupportedLiveQuery({
        reason: `Join source "${join.alias}" uses unknown index "${join.rightIndex}" on collection "${join.collection.name}".`
      });
    }
  }

  if (builder.joins.length > 0) {
    const joinAliases = new Set(builder.joins.map((join) => join.alias));
    const hasBaseSource = builder.sources.some(([alias]) => !joinAliases.has(alias));
    if (!hasBaseSource) {
      throw new UnsupportedLiveQuery({
        reason: "Live queries with joins require at least one non-join source collection."
      });
    }
  }
};

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
    const adapter = makeQuerySourceAdapter(collection);
    for (const row of adapter.rows()) {
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
  validateQueryPlan(builder);
  const joinAliases = new Set(builder.joins.map((join) => join.alias));
  const baseSources = builder.sources.filter(([alias]) => !joinAliases.has(alias));
  const sourceDiagnostics = builder.sources.map(([alias, collection]): QueryPlanSourceDiagnostics => {
    const source = makeQuerySourceAdapter(collection);
    return {
      alias,
      collection: source.name,
      rows: source.rowCount()
    };
  });
  const joins: Array<QueryPlanJoinDiagnostics> = [];
  let contexts = buildContexts<AnyQueryContext>(baseSources);

  for (const join of builder.joins) {
    const joined: Array<AnyQueryContext> = [];
    const leftRows = contexts.length;
    const source = makeQuerySourceAdapter(join.collection);
    const rightRows = source.rowCount();
    for (const context of contexts) {
      const leftValue = evaluateQueryOperation("join", () => join.leftKey(context));
      const left = evaluateQueryJoinKey(leftValue);
      const rows = join.rightIndex
        ? evaluateQueryOperation("join", () => source.indexRows(join.rightIndex!, leftValue))
        : source.rows();
      for (const row of rows) {
        const rightKeys = evaluateQueryOperation("join", () => join.rightKeys(row));
        if (rightKeys.some((rightValue) => left === evaluateQueryJoinKey(rightValue))) {
          joined.push({
            ...context,
            [join.alias]: row
          });
        }
      }
    }
    joins.push({
      alias: join.alias,
      collection: source.name,
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
    if (!grouping.sourceFilters.every((filter) =>
      evaluateQueryOperation("filter", () => filter(context))
    )) {
      continue;
    }

    const key = evaluateQueryOperation("aggregate", () => grouping.key(context));
    const keyString = evaluateQueryGroupKey(key);
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
      const values = group.values.map((value) =>
        [evaluateQueryOperation("aggregate", () => aggregate.preMap(value)), 1] as [unknown, number]
      );
      const reduced = evaluateQueryOperation("aggregate", () => aggregate.reduce(values));
      result[name] = aggregate.postMap
        ? evaluateQueryOperation("aggregate", () => aggregate.postMap!(reduced))
        : reduced;
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
    const leftValue = evaluateQueryOperation("order", () => order.selector(left));
    const rightValue = evaluateQueryOperation("order", () => order.selector(right));
    const comparison = compareValue(leftValue, rightValue);
    if (comparison !== 0) {
      return comparison * direction;
    }
  }

  return leftIndex - rightIndex;
};

export const querySources = (builder: QueryPlanBuilder<any>): ReadonlyArray<AnyCollection> =>
  querySourceAdapters(builder).map((source) => source.collection);

export const querySourceAdapters = (builder: QueryPlanBuilder<any>): ReadonlyArray<QueryCollectionSourceAdapter> =>
  makeQuerySourceAdapters(builder.sources);
