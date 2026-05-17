import { isEffectLike, isPromiseLikeValue, type PlainValue, type ReadableSignal } from "@effect-ui/core";
import { Data, Effect } from "effect";
import { makeLiveQueryState } from "./live-query-state.js";
import {
  type AnyCollectionRow,
  type AnyQueryAggregateRecord,
  type AnyQueryContext,
  type AnyQueryGrouping,
  type QueryAggregate,
  type QueryAggregateRecord,
  type QueryAggregateResult,
  type QueryContext,
  type QueryGroupKey,
  type QueryJoin,
  type QueryJoinKey,
  type QueryJoinResult,
  type QueryJoinedContext,
  type QueryJoinStrategy,
  type QueryOrder,
  type QueryEvaluationError,
  type QueryPlanDiagnostics,
  type QueryPlanJoinDiagnostics,
  type QueryPlanSourceDiagnostics,
  type RejectPlainQueryRecord,
  type QuerySourcesError,
  type QuerySourcesRequirements,
  type QuerySortDirection,
  type QuerySortValue,
  type SourceRecord,
  evaluateQueryOperation,
  toQueryEvaluationError
} from "./query-plan.js";
import {
  executeQueryPlan,
  preloadQueryExecutionPlanEffect,
  queryExecutionPlanDiagnostics
} from "./query-execution-plan.js";
import { makeQuerySourceAdapter } from "./query-source-adapter.js";
import { collectionStoreEffect, runWithCollectionStore } from "./runtime-collection-store.js";
import type {
  AnyCollection,
  CollectionError,
  CollectionRuntimeError,
  CollectionRequirements,
  CollectionRowValue
} from "./collection-contract.js";

/**
 * Immutable builder for collection-backed queries.
 *
 * Builders are cheap descriptions. `execute` reads current collection state
 * synchronously; `Query.onceEffect` and `Query.live` preload sources first.
 */
export interface QueryBuilderInterface<TContext extends AnyQueryContext, TResult, E = never, R = never> {
  readonly Type?: {
    readonly Error: E;
    readonly Requirements: R;
  };
  /** Returns a new query with an additional boolean filter. */
  where(predicate: (row: TContext) => boolean): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Returns a new query that projects each matching context to a result value. */
  select<Next>(
    projector: (row: TContext) => Next & RejectPlainQueryRecord<Next>
  ): QueryBuilderInterface<TContext, Next, E, R>;
  /** Inner-joins another collection by comparing keys from the left context and right rows. */
  join<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilderInterface<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  >;
  /** Inner-joins another collection through one of its declared secondary indexes. */
  joinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilderInterface<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  >;
  /** Alias for `join`. */
  innerJoin<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilderInterface<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  >;
  /** Alias for `joinIndexed`. */
  innerJoinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilderInterface<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  >;
  /** Groups filtered source rows by a key object and evaluates aggregate selectors. */
  groupBy<
    TKey extends Record<string, unknown>,
    Aggregates extends QueryAggregateRecord<TContext>
  >(
    key: (row: TContext) => QueryGroupKey<TKey>,
    aggregates: Aggregates
  ): QueryBuilderInterface<
    QueryAggregateResult<QueryGroupKey<TKey>, Aggregates>,
    QueryAggregateResult<QueryGroupKey<TKey>, Aggregates>,
    E,
    R
  >;
  /** Adds a stable sort. Multiple `orderBy` calls are evaluated in order. */
  orderBy(selector: (row: TContext) => QuerySortValue, direction?: QuerySortDirection): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Skips the first `count` results after filtering and sorting. */
  offset(count: number): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Limits the number of results after filtering, sorting, and offset. */
  limit(count: number): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Synchronously evaluates the query against the current collection state. */
  execute(): ReadonlyArray<TResult>;
}

export class QueryBuilder<TContext extends AnyQueryContext, TResult, E = never, R = never> {
  declare readonly Type?: {
    readonly Error: E;
    readonly Requirements: R;
  };

  constructor(
    readonly sources: ReadonlyArray<readonly [string, AnyCollection]>,
    readonly filters: ReadonlyArray<(row: TContext) => boolean> = [],
    readonly projector: ((row: TContext) => TResult) | undefined = undefined,
    readonly orders: ReadonlyArray<QueryOrder<TContext>> = [],
    readonly offsetCount = 0,
    readonly limitCount: number | undefined = undefined,
    readonly joins: ReadonlyArray<QueryJoin> = [],
    readonly grouping: AnyQueryGrouping | undefined = undefined
  ) {}

  private filtersFor<NextContext extends TContext>(): ReadonlyArray<(row: NextContext) => boolean> {
    return this.filters;
  }

  private projectorFor<NextContext extends AnyQueryContext, NextResult>(): ((row: NextContext) => NextResult) | undefined {
    return this.projector as ((row: NextContext) => NextResult) | undefined;
  }

  private ordersFor<NextContext extends TContext>(): ReadonlyArray<QueryOrder<NextContext>> {
    return this.orders;
  }

  /** Returns a new query with an additional boolean filter. */
  where(predicate: (row: TContext) => boolean): QueryBuilder<TContext, TResult, E, R> {
    return new QueryBuilder<TContext, TResult, E, R>(
      this.sources,
      [...this.filters, predicate],
      this.projector,
      this.orders,
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  /** Returns a new query that projects each matching context to a result value. */
  select<Next>(
    projector: (row: TContext) => Next & RejectPlainQueryRecord<Next>
  ): QueryBuilder<TContext, Next, E, R> {
    return new QueryBuilder<TContext, Next, E, R>(
      this.sources,
      this.filters,
      projector,
      this.orders,
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  /** Inner-joins another collection by comparing keys from the left context and right rows. */
  join<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, C>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    return new QueryBuilder<NextContext, NextResult, E | CollectionRuntimeError<CollectionError<C>>, R | CollectionRequirements<C>>(
      [...this.sources, [alias, collection] as const],
      this.filtersFor<NextContext>(),
      this.projectorFor<NextContext, NextResult>(),
      this.ordersFor<NextContext>(),
      this.offsetCount,
      this.limitCount,
      [
        ...this.joins,
        {
          alias,
          collection,
          leftKey: leftKey as (row: AnyQueryContext) => QueryJoinKey,
          rightKeys: (row: AnyCollectionRow) => [
            (rightKey as (row: AnyCollectionRow) => QueryJoinKey)(row)
          ]
        }
      ],
      this.grouping
    );
  }

  /** Inner-joins another collection through one of its declared secondary indexes. */
  joinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, C>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    const source = makeQuerySourceAdapter(collection);
    return new QueryBuilder<NextContext, NextResult, E | CollectionRuntimeError<CollectionError<C>>, R | CollectionRequirements<C>>(
      [...this.sources, [alias, collection] as const],
      this.filtersFor<NextContext>(),
      this.projectorFor<NextContext, NextResult>(),
      this.ordersFor<NextContext>(),
      this.offsetCount,
      this.limitCount,
      [
        ...this.joins,
        {
          alias,
          collection,
          leftKey: leftKey as (row: AnyQueryContext) => QueryJoinKey,
          rightKeys: (row: AnyCollectionRow) => source.indexJoinKeys(index, row),
          rightIndex: index
        }
      ],
      this.grouping
    );
  }

  /** Alias for `join`. */
  innerJoin<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  > {
    return this.join(alias, collection, leftKey, rightKey);
  }

  /** Alias for `joinIndexed`. */
  innerJoinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionRuntimeError<CollectionError<C>>,
    R | CollectionRequirements<C>
  > {
    return this.joinIndexed(alias, collection, leftKey, index);
  }

  /** Groups filtered source rows by a key object and evaluates aggregate selectors. */
  groupBy<
    TKey extends Record<string, unknown>,
    Aggregates extends QueryAggregateRecord<TContext>
  >(
    key: (row: TContext) => QueryGroupKey<TKey>,
    aggregates: Aggregates
  ): QueryBuilder<
    QueryAggregateResult<QueryGroupKey<TKey>, Aggregates>,
    QueryAggregateResult<QueryGroupKey<TKey>, Aggregates>,
    E,
    R
  > {
    type Grouped = QueryAggregateResult<QueryGroupKey<TKey>, Aggregates>;
    return new QueryBuilder<Grouped, Grouped, E, R>(
      this.sources,
      [],
      undefined,
      [],
      0,
      undefined,
      this.joins,
      {
        key: key as (row: AnyQueryContext) => Record<string, unknown>,
        aggregates: aggregates as AnyQueryAggregateRecord,
        sourceFilters: this.filters as ReadonlyArray<(row: AnyQueryContext) => boolean>
      }
    );
  }

  /**
   * Adds a stable sort. Multiple `orderBy` calls are evaluated in order.
   *
   * Selectors must return comparable scalar values. Invalid Dates and `NaN`
   * fail as `QueryEvaluationError` with operation `"order"`.
   */
  orderBy(selector: (row: TContext) => QuerySortValue, direction: QuerySortDirection = "asc"): QueryBuilder<TContext, TResult, E, R> {
    return new QueryBuilder<TContext, TResult, E, R>(
      this.sources,
      this.filters,
      this.projector,
      [...this.orders, { selector, direction }],
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  /**
   * Skips the first `count` results after filtering and sorting.
   *
   * `count` must be a finite, non-negative safe integer. Invalid windows are
   * rejected when the query is executed or inspected with diagnostics.
   */
  offset(count: number): QueryBuilder<TContext, TResult, E, R> {
    return new QueryBuilder<TContext, TResult, E, R>(
      this.sources,
      this.filters,
      this.projector,
      this.orders,
      count,
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  /**
   * Limits the number of results after filtering, sorting, and offset.
   *
   * `count` must be a finite, non-negative safe integer. Invalid windows are
   * rejected when the query is executed or inspected with diagnostics.
   */
  limit(count: number): QueryBuilder<TContext, TResult, E, R> {
    return new QueryBuilder<TContext, TResult, E, R>(
      this.sources,
      this.filters,
      this.projector,
      this.orders,
      this.offsetCount,
      count,
      this.joins,
      this.grouping
    );
  }

  /**
   * Synchronously evaluates the query against the current collection state.
   *
   * Plan-validation and callback failures are thrown as `QueryEvaluationError`.
   */
  execute(): ReadonlyArray<TResult> {
    try {
      return executeQueryPlan(this);
    } catch (cause) {
      throw toQueryEvaluationError("evaluate", cause);
    }
  }
}

export type AnyQueryBuilder<TResult = any, E = any, R = any> = QueryBuilder<any, TResult, E, R>;

export type QueryFactory<TResult, E = never, R = never> = (query: QueryRoot) => QueryBuilderInterface<any, TResult, E, R>;

class QueryFactoryResultRejected extends Data.TaggedError("QueryFactoryResultRejected")<{
  readonly reason: "promise" | "effect" | "builder";
  readonly guidance: string;
}> {}

const queryFactoryResultRejected = (
  reason: "promise" | "effect" | "builder"
): QueryFactoryResultRejected =>
  new QueryFactoryResultRejected({
    reason,
    guidance:
      reason === "promise"
        ? "Query factories must return a QueryBuilder synchronously. Move async work into collection Effects before building the query."
        : reason === "effect"
          ? "Query factories must return a QueryBuilder, not an Effect. Move Effect work into collection sources and keep the factory synchronous."
          : "Query factories must return the QueryBuilder produced by Query.from(...)."
  });

const validateQueryFactoryResult = <T, E, R>(value: unknown): AnyQueryBuilder<T, E, R> => {
  if (value instanceof QueryBuilder) {
    return value as AnyQueryBuilder<T, E, R>;
  }
  if (isPromiseLikeValue(value)) {
    throw queryFactoryResultRejected("promise");
  }
  if (!(value instanceof Error) && isEffectLike(value)) {
    throw queryFactoryResultRejected("effect");
  }
  throw queryFactoryResultRejected("builder");
};

/**
 * Root query DSL entrypoint passed to query factories.
 */
export interface QueryRoot {
  /**
   * Starts a query from named collection sources.
   *
   * Source names become row context properties, so prototype-reserved keys such
   * as `__proto__`, `constructor`, and `prototype` are rejected during query
   * validation.
   */
  from<const Sources extends SourceRecord>(
    sources: Sources
  ): QueryBuilderInterface<
    QueryContext<Sources>,
    QueryContext<Sources>,
    QuerySourcesError<Sources>,
    QuerySourcesRequirements<Sources>
  >;
}

/**
 * Reactive query state derived from source collection load states.
 */
export type LiveQueryState<T, E = never> =
  | { readonly _tag: "Pending"; readonly waiting: true; readonly data: ReadonlyArray<T> }
  | { readonly _tag: "Success"; readonly waiting: false; readonly data: ReadonlyArray<T> }
  | { readonly _tag: "Failure"; readonly waiting: false; readonly error: E; readonly data: ReadonlyArray<T> };

/**
 * Incrementally evaluated query over one or more collections.
 *
 * `data` updates when source collection versions change. Preload/refetch effects
 * expose the union of source collection error and requirement channels.
 */
export interface LiveQuery<T, E = never, R = never> {
  readonly data: ReadableSignal<ReadonlyArray<T>>;
  readonly state: ReadableSignal<LiveQueryState<T, E | QueryEvaluationError>>;
  readonly sources: ReadonlyArray<AnyCollection>;
  evaluate(): ReadonlyArray<T>;
  preloadEffect(): Effect.Effect<void, E | QueryEvaluationError, R>;
  refetchEffect(): Effect.Effect<void, E | QueryEvaluationError, R>;
}

const queryRoot: QueryRoot = {
  from: <const Sources extends SourceRecord>(
    sources: Sources
  ): QueryBuilderInterface<
    QueryContext<Sources>,
    QueryContext<Sources>,
    QuerySourcesError<Sources>,
    QuerySourcesRequirements<Sources>
  > => new QueryBuilder<
    QueryContext<Sources>,
    QueryContext<Sources>,
    QuerySourcesError<Sources>,
    QuerySourcesRequirements<Sources>
  >(
    Object.entries(sources) as ReadonlyArray<readonly [string, AnyCollection]>
  ) as unknown as QueryBuilderInterface<
    QueryContext<Sources>,
    QueryContext<Sources>,
    QuerySourcesError<Sources>,
    QuerySourcesRequirements<Sources>
  >
};

/** Equality predicate using `Object.is`, matching signal and collection change checks. */
export const eq = <A>(left: A, right: A): boolean => Object.is(left, right);
/** Negated `Object.is` equality predicate. */
export const neq = <A>(left: A, right: A): boolean => !Object.is(left, right);
/** Greater-than predicate for sortable scalar values. */
export const gt = <A extends number | string | Date>(left: A, right: A): boolean => left > right;
/** Greater-than-or-equal predicate for sortable scalar values. */
export const gte = <A extends number | string | Date>(left: A, right: A): boolean => left >= right;
/** Less-than predicate for sortable scalar values. */
export const lt = <A extends number | string | Date>(left: A, right: A): boolean => left < right;
/** Less-than-or-equal predicate for sortable scalar values. */
export const lte = <A extends number | string | Date>(left: A, right: A): boolean => left <= right;
/** Boolean conjunction helper for composing filters. */
export const and = (...values: ReadonlyArray<boolean>): boolean => values.every(Boolean);
/** Boolean disjunction helper for composing filters. */
export const or = (...values: ReadonlyArray<boolean>): boolean => values.some(Boolean);
/** Boolean negation helper for composing filters. */
export const not = (value: boolean): boolean => !value;
/** Array membership predicate using JavaScript `includes` semantics. */
export const includes = <A>(values: ReadonlyArray<A>, value: A): boolean => values.includes(value);

const aggregateCount = <TContext, A = unknown>(
  value: (row: TContext) => A & PlainValue<A> =
    (row) => row as A & PlainValue<A>
): QueryAggregate<TContext, number, number> => ({
  preMap: (row) =>
    evaluateQueryOperation("aggregate", () => value(row)) == null ? 0 : 1,
  reduce: (values) => {
    let total = 0;
    for (const [present, multiplicity] of values) {
      total += present * multiplicity;
    }
    return total;
  }
});

const aggregateSum = <TContext>(
  value: (row: TContext) => number
): QueryAggregate<TContext, number, number> => ({
  preMap: (row) => evaluateQueryOperation("aggregate", () => value(row)),
  reduce: (values) => {
    let total = 0;
    for (const [amount, multiplicity] of values) {
      total += amount * multiplicity;
    }
    return total;
  }
});

const aggregateAvg = <TContext>(
  value: (row: TContext) => number
): QueryAggregate<TContext, number, { readonly sum: number; readonly count: number }> => ({
  preMap: (row) => ({
    sum: evaluateQueryOperation("aggregate", () => value(row)),
    count: 1
  }),
  reduce: (values) => {
    let sum = 0;
    let count = 0;
    for (const [entry, multiplicity] of values) {
      sum += entry.sum * multiplicity;
      count += entry.count * multiplicity;
    }
    return { sum, count };
  },
  postMap: ({ sum, count }) => count === 0 ? 0 : sum / count
});

const aggregateMin = <TContext, V extends number | string | Date | bigint>(
  value: (row: TContext) => V
): QueryAggregate<TContext, V | undefined, V | undefined> => ({
  preMap: (row) =>
    evaluateQueryOperation("aggregate", () => value(row)) as (V | undefined) & RejectPlainQueryRecord<V | undefined>,
  reduce: (values) => {
    let min: V | undefined;
    for (const [candidate, multiplicity] of values) {
      if (multiplicity <= 0 || candidate === undefined) {
        continue;
      }
      if (min === undefined || candidate < min) {
        min = candidate;
      }
    }
    return min as (V | undefined) & RejectPlainQueryRecord<V | undefined>;
  }
});

const aggregateMax = <TContext, V extends number | string | Date | bigint>(
  value: (row: TContext) => V
): QueryAggregate<TContext, V | undefined, V | undefined> => ({
  preMap: (row) =>
    evaluateQueryOperation("aggregate", () => value(row)) as (V | undefined) & RejectPlainQueryRecord<V | undefined>,
  reduce: (values) => {
    let max: V | undefined;
    for (const [candidate, multiplicity] of values) {
      if (multiplicity <= 0 || candidate === undefined) {
        continue;
      }
      if (max === undefined || candidate > max) {
        max = candidate;
      }
    }
    return max as (V | undefined) & RejectPlainQueryRecord<V | undefined>;
  }
});

/**
 * Query API for composing derived views over collections.
 *
 * Query factories receive `Query.from`/`query.from` and return an immutable
 * builder. Use `onceEffect` for one-shot reads and `live` for reactive data.
 */
export namespace Query {
  /** Immutable query builder DSL carrying context, result, error, and requirement types without exposing plan internals. */
  export type Builder<TContext extends AnyQueryContext, TResult, E = never, R = never> =
    QueryBuilderInterface<TContext, TResult, E, R>;
  /** Function that receives the query root DSL and returns a builder. */
  export type Factory<TResult, E = never, R = never> = QueryFactory<TResult, E, R>;
  /** Reactive query handle backed by source collection state. */
  export type Live<T, E = never, R = never> = LiveQuery<T, E, R>;
  /** Load state emitted by a live query. */
  export type LiveState<T, E = never> = LiveQueryState<T, E>;
  /** Error raised when query factory, callback, plan, or order comparable evaluation fails. */
  export type EvaluationError = QueryEvaluationError;
  /** Execution strategy selected for one query join. */
  export type JoinStrategy = QueryJoinStrategy;
  /** Source row-count diagnostics for a query plan. */
  export type PlanSourceDiagnostics = QueryPlanSourceDiagnostics;
  /** Join cost and strategy diagnostics for a query plan. */
  export type PlanJoinDiagnostics = QueryPlanJoinDiagnostics;
  /** Full diagnostics summary for a compiled query plan. */
  export type PlanDiagnostics = QueryPlanDiagnostics;
  /** Root DSL object passed to query factories. */
  export type Root = QueryRoot;
  /** Group key object accepted by `groupBy(...)`; nested Promise-shaped values are rejected. */
  export type GroupKey<TKey extends Record<string, unknown> = Record<string, unknown>> =
    QueryGroupKey<TKey>;
  /** Aggregate definition consumed by `groupBy(...)`. */
  export type Aggregate<TContext, R, V = unknown> = QueryAggregate<TContext, R, V>;
  /** Named aggregate map consumed by `groupBy(...)`. */
  export type Aggregates<TContext> = QueryAggregateRecord<TContext>;
  /** Result type for a grouped query key plus aggregate map. */
  export type AggregateResult<
    TKey extends Record<string, unknown>,
    Aggregates extends AnyQueryAggregateRecord
  > = QueryAggregateResult<TKey, Aggregates>;

  /** Start a query from one or more named collection sources. */
  export const from = queryRoot.from;
  /** Count non-null aggregate values in `groupBy`. */
  export const count = aggregateCount;
  /** Sum numeric aggregate values in `groupBy`. */
  export const sum = aggregateSum;
  /** Average numeric aggregate values in `groupBy`. */
  export const avg = aggregateAvg;
  /** Minimum aggregate value in `groupBy`. */
  export const min = aggregateMin;
  /** Maximum aggregate value in `groupBy`. */
  export const max = aggregateMax;

  /**
   * Build a query without executing or preloading it.
   *
   * Synchronous factory throws, Promise-shaped factory results, Effect-shaped
   * factory results, and other non-builder factory results are normalized and
   * thrown as `QueryEvaluationError` with operation `"evaluate"`.
   */
  export const build = <T, E = never, R = never>(factory: QueryFactory<T, E, R>): QueryBuilderInterface<any, T, E, R> => {
    try {
      return validateQueryFactoryResult<T, E, R>(factory(queryRoot)) as unknown as QueryBuilderInterface<any, T, E, R>;
    } catch (cause) {
      throw toQueryEvaluationError("evaluate", cause);
    }
  };

  const buildOrThrowQueryEvaluationError = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>
  ): AnyQueryBuilder<T, E, R> => {
    try {
      return validateQueryFactoryResult<T, E, R>(factory(queryRoot));
    } catch (cause) {
      throw toQueryEvaluationError("evaluate", cause);
    }
  };

  /**
   * Return query plan diagnostics for joins, filters, ordering, and row counts.
   *
   * Synchronous factory failures, Promise-shaped factory results, Effect-shaped
   * factory results, other non-builder factory results, and plan-validation
   * throws are normalized and thrown as `QueryEvaluationError` with operation
   * `"evaluate"`.
   */
  export const diagnostics = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>
  ): QueryPlanDiagnostics => {
    const builder = buildOrThrowQueryEvaluationError(factory);
    try {
      return queryExecutionPlanDiagnostics(builder);
    } catch (cause) {
      throw toQueryEvaluationError("evaluate", cause);
    }
  };

  /**
   * Preload source collections once, then execute the query.
   *
   * Source collection errors and requirements are preserved in the returned
   * Effect. Synchronous factory failures, Promise-shaped factory results,
   * Effect-shaped factory results, and other non-builder factory results are
   * normalized as `QueryEvaluationError` with operation `"evaluate"` in the
   * Effect error channel.
   */
  export const onceEffect = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>
  ): Effect.Effect<ReadonlyArray<T>, E | QueryEvaluationError, R> =>
    Effect.gen(function* () {
      const builder = yield* Effect.try({
        try: () => buildOrThrowQueryEvaluationError(factory),
        catch: (cause) => toQueryEvaluationError("evaluate", cause)
      });
      yield* preloadQueryExecutionPlanEffect<E, R>(builder, false);
      const store = yield* collectionStoreEffect;
      return yield* Effect.try({
        try: () => runWithCollectionStore(store, () => builder.execute()),
        catch: (cause) => toQueryEvaluationError("evaluate", cause)
      });
    });

  /**
   * Create a reactive live query over collection rows.
   *
   * The returned signals update when source collection versions change.
   * Synchronous factory failures, Promise-shaped factory results, Effect-shaped
   * factory results, and other non-builder factory results are normalized and
   * thrown as `QueryEvaluationError` with operation `"evaluate"`.
   *
   * @example
   * const openTodos = Query.live((query) =>
   *   query.from({ todo: todos })
   *     .where(({ todo }) => !todo.done)
   *     .select(({ todo }) => todo)
   * )
   */
  export const live = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>
  ): LiveQuery<T, E, R> =>
    makeLiveQueryState(buildOrThrowQueryEvaluationError(factory));
}
