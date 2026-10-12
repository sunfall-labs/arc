import { isEffectLike, isPromiseLikeValue, type PlainValue, type Signal } from "@sunfall/arc-core";
import { Data, Effect } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { makeLiveQueryState } from "./live-query-state.js";
import {
  type AnyQueryRow,
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
  type QueryEvaluationOperation,
  type QueryPlanDiagnostics,
  type QueryPlanJoinDiagnostics,
  type QueryPlanSourceDiagnostics,
  type RejectPlainQueryRecord,
  type QuerySourceError,
  type QuerySourceIndex,
  type QuerySourceRequirements,
  type QuerySourceRow,
  type QuerySourcesError,
  type QuerySourcesRequirements,
  type QuerySortDirection,
  type QuerySortValue,
  type SourceRecord,
  evaluateQueryOperation,
  toQueryEvaluationError,
} from "./query-plan.js";
import {
  executeQueryPlan,
  preloadQueryExecutionPlan,
  queryExecutionPlanDiagnostics,
} from "./query-execution-plan.js";
import { activeResourceStore } from "@sunfall/arc-core/internal";
import {
  makeQuerySourceAdapter,
  runWithQueryStore,
  type QuerySource,
} from "./query-source-adapter.js";

const QueryBuilderTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-db/QueryBuilder",
) as typeof QueryBuilderTypeId;

/**
 * Immutable builder for queries over the rows of Resources.
 *
 * Builders are cheap descriptions. `execute` reads the sources' current rows
 * synchronously; `Query.once` and `Query.live` preload sources first.
 */
export interface QueryBuilderInterface<
  TContext extends AnyQueryContext,
  TResult,
  E = never,
  R = never,
> {
  readonly [QueryBuilderTypeId]: typeof QueryBuilderTypeId;
  readonly Type?: {
    readonly Error: E;
    readonly Requirements: R;
  };
  /** Returns a new query with an additional boolean filter. */
  where(predicate: (row: TContext) => boolean): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Returns a new query that projects each matching context to a result value. */
  select<Next>(
    projector: (row: TContext) => Next & RejectPlainQueryRecord<Next>,
  ): QueryBuilderInterface<TContext, Next, E, R>;
  /** Inner-joins another rows Resource by comparing keys from the left context and right rows. */
  join<const Alias extends string, S extends QuerySource>(
    alias: Alias,
    source: S,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: QuerySourceRow<S>) => QueryJoinKey,
  ): QueryBuilderInterface<
    QueryJoinedContext<TContext, Alias, S>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, S>>,
    E | QuerySourceError<S>,
    R | QuerySourceRequirements<S>
  >;
  /** Inner-joins another rows Resource through one of its declared `rows.indexes`. */
  joinIndexed<const Alias extends string, S extends QuerySource>(
    alias: Alias,
    source: S,
    leftKey: (row: TContext) => QueryJoinKey,
    index: QuerySourceIndex<S>,
  ): QueryBuilderInterface<
    QueryJoinedContext<TContext, Alias, S>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, S>>,
    E | QuerySourceError<S>,
    R | QuerySourceRequirements<S>
  >;
  /** Groups filtered source rows by a key object and evaluates aggregate selectors. */
  groupBy<TKey extends Record<string, unknown>, Aggregates extends QueryAggregateRecord<TContext>>(
    key: (row: TContext) => QueryGroupKey<TKey>,
    aggregates: Aggregates,
  ): QueryBuilderInterface<
    QueryAggregateResult<QueryGroupKey<TKey>, Aggregates>,
    QueryAggregateResult<QueryGroupKey<TKey>, Aggregates>,
    E,
    R
  >;
  /** Adds a stable sort. Multiple `orderBy` calls are evaluated in order. */
  orderBy(
    selector: (row: TContext) => QuerySortValue,
    direction?: QuerySortDirection,
  ): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Skips the first `count` results after filtering and sorting. */
  offset(count: number): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Limits the number of results after filtering, sorting, and offset. */
  limit(count: number): QueryBuilderInterface<TContext, TResult, E, R>;
  /** Synchronously evaluates the query against the sources' current rows. */
  execute(): ReadonlyArray<TResult>;
}

export class QueryBuilder<TContext extends AnyQueryContext, TResult, E = never, R = never> {
  declare readonly [QueryBuilderTypeId]: typeof QueryBuilderTypeId;
  declare readonly Type?: {
    readonly Error: E;
    readonly Requirements: R;
  };

  constructor(
    readonly sources: ReadonlyArray<readonly [string, QuerySource]>,
    readonly filters: ReadonlyArray<(row: TContext) => boolean> = [],
    readonly projector: ((row: TContext) => TResult) | undefined = undefined,
    readonly orders: ReadonlyArray<QueryOrder<TContext>> = [],
    readonly offsetCount = 0,
    readonly limitCount: number | undefined = undefined,
    readonly joins: ReadonlyArray<QueryJoin> = [],
    readonly grouping: AnyQueryGrouping | undefined = undefined,
  ) {}

  private filtersFor<NextContext extends TContext>(): ReadonlyArray<(row: NextContext) => boolean> {
    return this.filters;
  }

  private projectorFor<NextContext extends AnyQueryContext, NextResult>():
    | ((row: NextContext) => NextResult)
    | undefined {
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
      this.grouping,
    );
  }

  /** Returns a new query that projects each matching context to a result value. */
  select<Next>(
    projector: (row: TContext) => Next & RejectPlainQueryRecord<Next>,
  ): QueryBuilder<TContext, Next, E, R> {
    return new QueryBuilder<TContext, Next, E, R>(
      this.sources,
      this.filters,
      projector,
      this.orders,
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping,
    );
  }

  /** Inner-joins another rows Resource by comparing keys from the left context and right rows. */
  join<const Alias extends string, S extends QuerySource>(
    alias: Alias,
    source: S,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: QuerySourceRow<S>) => QueryJoinKey,
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, S>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, S>>,
    E | QuerySourceError<S>,
    R | QuerySourceRequirements<S>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, S>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    return new QueryBuilder<
      NextContext,
      NextResult,
      E | QuerySourceError<S>,
      R | QuerySourceRequirements<S>
    >(
      [...this.sources, [alias, source] as const],
      this.filtersFor<NextContext>(),
      this.projectorFor<NextContext, NextResult>(),
      this.ordersFor<NextContext>(),
      this.offsetCount,
      this.limitCount,
      [
        ...this.joins,
        {
          alias,
          source,
          leftKey: leftKey as (row: AnyQueryContext) => QueryJoinKey,
          rightKeys: (row: AnyQueryRow) => [(rightKey as (row: AnyQueryRow) => QueryJoinKey)(row)],
        },
      ],
      this.grouping,
    );
  }

  /** Inner-joins another rows Resource through one of its declared `rows.indexes`. */
  joinIndexed<const Alias extends string, S extends QuerySource>(
    alias: Alias,
    source: S,
    leftKey: (row: TContext) => QueryJoinKey,
    index: QuerySourceIndex<S>,
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, S>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, S>>,
    E | QuerySourceError<S>,
    R | QuerySourceRequirements<S>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, S>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    const adapter = makeQuerySourceAdapter(source);
    return new QueryBuilder<
      NextContext,
      NextResult,
      E | QuerySourceError<S>,
      R | QuerySourceRequirements<S>
    >(
      [...this.sources, [alias, source] as const],
      this.filtersFor<NextContext>(),
      this.projectorFor<NextContext, NextResult>(),
      this.ordersFor<NextContext>(),
      this.offsetCount,
      this.limitCount,
      [
        ...this.joins,
        {
          alias,
          source,
          leftKey: leftKey as (row: AnyQueryContext) => QueryJoinKey,
          rightKeys: (row: AnyQueryRow) => adapter.indexJoinKeys(index, row) as never,
          rightIndex: index,
        },
      ],
      this.grouping,
    );
  }

  /** Groups filtered source rows by a key object and evaluates aggregate selectors. */
  groupBy<TKey extends Record<string, unknown>, Aggregates extends QueryAggregateRecord<TContext>>(
    key: (row: TContext) => QueryGroupKey<TKey>,
    aggregates: Aggregates,
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
        sourceFilters: this.filters as ReadonlyArray<(row: AnyQueryContext) => boolean>,
      },
    );
  }

  /**
   * Adds a stable sort. Multiple `orderBy` calls are evaluated in order.
   *
   * Selectors must return comparable scalar values. Invalid Dates and `NaN`
   * fail as `QueryEvaluationError` with operation `"order"`.
   */
  orderBy(
    selector: (row: TContext) => QuerySortValue,
    direction: QuerySortDirection = "asc",
  ): QueryBuilder<TContext, TResult, E, R> {
    return new QueryBuilder<TContext, TResult, E, R>(
      this.sources,
      this.filters,
      this.projector,
      [...this.orders, { selector, direction }],
      this.offsetCount,
      this.limitCount,
      this.joins,
      this.grouping,
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
      this.grouping,
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
      this.grouping,
    );
  }

  /**
   * Synchronously evaluates the query against the sources' current rows.
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

export type QueryFactory<TResult, E = never, R = never> = (
  query: QueryRoot,
) => QueryBuilderInterface<any, TResult, E, R>;

class QueryFactoryResultRejected extends Data.TaggedError("QueryFactoryResultRejected")<{
  readonly reason: "promise" | "effect" | "builder";
  readonly guidance: string;
}> {}

const queryFactoryResultRejected = (
  reason: "promise" | "effect" | "builder",
): QueryFactoryResultRejected =>
  new QueryFactoryResultRejected({
    reason,
    guidance:
      reason === "promise"
        ? "Query factories must return a QueryBuilder synchronously. Move async work into the source Resources' loads before building the query."
        : reason === "effect"
          ? "Query factories must return a QueryBuilder, not an Effect. Move Effect work into the source Resources and keep the factory synchronous."
          : "Query factories must return the QueryBuilder produced by query.from(...).",
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
   * Starts a query from named sources: refs of Resources that declare `rows`.
   *
   * Source names become row context properties, so prototype-reserved keys such
   * as `__proto__`, `constructor`, and `prototype` are rejected during query
   * validation.
   */
  from<const Sources extends SourceRecord>(
    sources: Sources,
  ): QueryBuilderInterface<
    QueryContext<Sources>,
    QueryContext<Sources>,
    QuerySourcesError<Sources>,
    QuerySourcesRequirements<Sources>
  >;
}

/**
 * Incrementally evaluated query over the rows of one or more Resources.
 *
 * `rows` updates when a source's rows change (a reload, a change feed, an
 * optimistic patch) and always holds the last good rows. `state` folds the
 * source Resources' load results
 * and evaluation failures into one `AsyncResult`: `Initial` until every source
 * has loaded, `Success` with the current rows (timestamped by the latest source
 * load), `Failure` carrying the source or evaluation `Cause` with the last good
 * rows as `previousSuccess`, and `waiting` while any source is loading. Preload/
 * refresh effects expose the union of the sources' error and requirement
 * channels.
 */
export interface LiveQuery<T, E = never, R = never> {
  readonly rows: Signal.Readable<ReadonlyArray<T>>;
  readonly state: Signal.Readable<
    AsyncResult.AsyncResult<ReadonlyArray<T>, E | QueryEvaluationError>
  >;
  readonly sources: ReadonlyArray<QuerySource>;
  evaluate(): ReadonlyArray<T>;
  preload(): Effect.Effect<void, E | QueryEvaluationError, R>;
  refresh(): Effect.Effect<void, E | QueryEvaluationError, R>;
}

const queryRoot: QueryRoot = {
  from: <const Sources extends SourceRecord>(
    sources: Sources,
  ): QueryBuilderInterface<
    QueryContext<Sources>,
    QueryContext<Sources>,
    QuerySourcesError<Sources>,
    QuerySourcesRequirements<Sources>
  > =>
    new QueryBuilder<
      QueryContext<Sources>,
      QueryContext<Sources>,
      QuerySourcesError<Sources>,
      QuerySourcesRequirements<Sources>
    >(
      Object.entries(sources) as ReadonlyArray<readonly [string, QuerySource]>,
    ) as unknown as QueryBuilderInterface<
      QueryContext<Sources>,
      QueryContext<Sources>,
      QuerySourcesError<Sources>,
      QuerySourcesRequirements<Sources>
    >,
};

const aggregateCount = <TContext, A = unknown>(
  value: (row: TContext) => A & PlainValue<A> = (row) => row as A & PlainValue<A>,
): QueryAggregate<TContext, number, number> => ({
  preMap: (row) => (evaluateQueryOperation("aggregate", () => value(row)) == null ? 0 : 1),
  reduce: (values) => {
    let total = 0;
    for (const [present, multiplicity] of values) {
      total += present * multiplicity;
    }
    return total;
  },
});

const aggregateSum = <TContext>(
  value: (row: TContext) => number,
): QueryAggregate<TContext, number, number> => ({
  preMap: (row) => evaluateQueryOperation("aggregate", () => value(row)),
  reduce: (values) => {
    let total = 0;
    for (const [amount, multiplicity] of values) {
      total += amount * multiplicity;
    }
    return total;
  },
});

const aggregateAvg = <TContext>(
  value: (row: TContext) => number,
): QueryAggregate<TContext, number, { readonly sum: number; readonly count: number }> => ({
  preMap: (row) => ({
    sum: evaluateQueryOperation("aggregate", () => value(row)),
    count: 1,
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
  postMap: ({ sum, count }) => (count === 0 ? 0 : sum / count),
});

const aggregateMin = <TContext, V extends number | string | Date | bigint>(
  value: (row: TContext) => V,
): QueryAggregate<TContext, V | undefined, V | undefined> => ({
  preMap: (row) =>
    evaluateQueryOperation("aggregate", () => value(row)) as (V | undefined) &
      RejectPlainQueryRecord<V | undefined>,
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
  },
});

const aggregateMax = <TContext, V extends number | string | Date | bigint>(
  value: (row: TContext) => V,
): QueryAggregate<TContext, V | undefined, V | undefined> => ({
  preMap: (row) =>
    evaluateQueryOperation("aggregate", () => value(row)) as (V | undefined) &
      RejectPlainQueryRecord<V | undefined>,
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
  },
});

const buildOrThrowQueryEvaluationError = <T, E = never, R = never>(
  factory: QueryFactory<T, E, R>,
): AnyQueryBuilder<T, E, R> => {
  try {
    return validateQueryFactoryResult<T, E, R>(factory(queryRoot));
  } catch (cause) {
    throw toQueryEvaluationError("evaluate", cause);
  }
};

/**
 * Build a query without executing or preloading it.
 *
 * Synchronous factory throws, Promise-shaped factory results, Effect-shaped
 * factory results, and other non-builder factory results are normalized and
 * thrown as `QueryEvaluationError` with operation `"evaluate"`.
 */
export const buildQuery = <T, E = never, R = never>(
  factory: QueryFactory<T, E, R>,
): QueryBuilderInterface<any, T, E, R> =>
  buildOrThrowQueryEvaluationError(factory) as unknown as QueryBuilderInterface<any, T, E, R>;

/**
 * Query API for composing derived views over the rows of Resources.
 *
 * Query factories receive the query root and start with `query.from(...)`, returning an immutable
 * builder. Use `once` for one-shot reads and `live` for reactive data.
 */
export namespace Query {
  /** Immutable query builder DSL carrying context, result, error, and requirement types without exposing plan internals. */
  export type Builder<
    TContext extends AnyQueryContext,
    TResult,
    E = never,
    R = never,
  > = QueryBuilderInterface<TContext, TResult, E, R>;
  /** Function that receives the query root DSL and returns a builder. */
  export type Factory<TResult, E = never, R = never> = QueryFactory<TResult, E, R>;
  /** Reactive query handle over source Resource rows. */
  export type Live<T, E = never, R = never> = LiveQuery<T, E, R>;
  /** Query operation named by a `QueryEvaluationError`. */
  export type EvaluationOperation = QueryEvaluationOperation;
  /** Execution strategy selected for one query join. */
  export type JoinStrategy = QueryJoinStrategy;
  /** Scalar join key before stable string normalization. */
  export type JoinKey = QueryJoinKey;
  /** Sort direction accepted by `orderBy(...)`. */
  export type SortDirection = QuerySortDirection;
  /** Comparable scalar value accepted by Query ordering. */
  export type SortValue = QuerySortValue;
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
    Aggregates extends AnyQueryAggregateRecord,
  > = QueryAggregateResult<TKey, Aggregates>;

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
   * Return query plan diagnostics for joins, filters, ordering, and row counts.
   *
   * Synchronous factory failures, Promise-shaped factory results, Effect-shaped
   * factory results, other non-builder factory results, and plan-validation
   * throws are normalized and thrown as `QueryEvaluationError` with operation
   * `"evaluate"`.
   */
  export const diagnostics = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>,
  ): QueryPlanDiagnostics => {
    const builder = buildOrThrowQueryEvaluationError(factory);
    try {
      return queryExecutionPlanDiagnostics(builder);
    } catch (cause) {
      throw toQueryEvaluationError("evaluate", cause);
    }
  };

  /**
   * Preload the source Resources once, then execute the query.
   *
   * Source errors and requirements are preserved in the returned
   * Effect. Synchronous factory failures, Promise-shaped factory results,
   * Effect-shaped factory results, and other non-builder factory results are
   * normalized as `QueryEvaluationError` with operation `"evaluate"` in the
   * Effect error channel.
   */
  export const once = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>,
  ): Effect.Effect<ReadonlyArray<T>, E | QueryEvaluationError, R> =>
    Effect.gen(function* () {
      const builder = yield* Effect.try({
        try: () => buildOrThrowQueryEvaluationError(factory),
        catch: (cause) => toQueryEvaluationError("evaluate", cause),
      });
      yield* preloadQueryExecutionPlan<E, R>(builder, false);
      const store = yield* activeResourceStore;
      return yield* Effect.try({
        try: () => runWithQueryStore(store, () => builder.execute()),
        catch: (cause) => toQueryEvaluationError("evaluate", cause),
      });
    });

  /**
   * Create a reactive live query over the rows of Resources.
   *
   * The returned signals update when a source's rows change.
   * Synchronous factory failures, Promise-shaped factory results, Effect-shaped
   * factory results, and other non-builder factory results are normalized and
   * thrown as `QueryEvaluationError` with operation `"evaluate"`.
   *
   * @example
   * const openTodos = Query.live((query) =>
   *   query.from({ todo: Todos("me") })
   *     .where(({ todo }) => !todo.done)
   *     .select(({ todo }) => todo)
   * )
   */
  export const live = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>,
  ): LiveQuery<T, E, R> => makeLiveQueryState(buildOrThrowQueryEvaluationError(factory));
}
