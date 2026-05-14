import { Signal, type ReadableSignal } from "@effect-ui/core";
import { Effect } from "effect";
import {
  makeLiveQueryRuntime,
  preloadLiveQuerySourcesEffect
} from "./live-query-runtime.js";
import {
  buildQueryContexts,
  buildQueryExecution,
  compareRows,
  projectCurrentContext,
  querySources,
  type AnyCollectionRow,
  type AnyQueryAggregateRecord,
  type AnyQueryContext,
  type AnyQueryGrouping,
  type QueryAggregate,
  type QueryAggregateRecord,
  type QueryAggregateResult,
  type QueryContext,
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
  type QueryProjectOptions,
  type QuerySourcesError,
  type QuerySourcesRequirements,
  type QuerySortDirection,
  type QuerySortValue,
  type SourceRecord,
  evaluateQueryOperation,
  toQueryEvaluationError
} from "./query-plan.js";
import { indexJoinKeys } from "./collection-runtime.js";
import type {
  AnyCollection,
  CollectionError,
  CollectionRequirements,
  CollectionRowValue
} from "./collection-contract.js";
import type { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";

/**
 * Immutable builder for collection-backed queries.
 *
 * Builders are cheap descriptions. `execute` reads current collection state
 * synchronously; `Query.onceEffect` and `Query.live` preload sources first.
 */
export class QueryBuilder<TContext extends AnyQueryContext, TResult, E = never, R = never> {
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

  select<Next>(projector: (row: TContext) => Next): QueryBuilder<TContext, Next, E, R> {
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

  join<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionError<C> | CollectionSnapshotCodecError,
    R | CollectionRequirements<C>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, C>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    return new QueryBuilder<NextContext, NextResult, E | CollectionError<C> | CollectionSnapshotCodecError, R | CollectionRequirements<C>>(
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

  joinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionError<C> | CollectionSnapshotCodecError,
    R | CollectionRequirements<C>
  > {
    type NextContext = QueryJoinedContext<TContext, Alias, C>;
    type NextResult = QueryJoinResult<TContext, TResult, NextContext>;
    return new QueryBuilder<NextContext, NextResult, E | CollectionError<C> | CollectionSnapshotCodecError, R | CollectionRequirements<C>>(
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
          rightKeys: (row: AnyCollectionRow) => indexJoinKeys(collection, index, row),
          rightIndex: index
        }
      ],
      this.grouping
    );
  }

  innerJoin<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    rightKey: (row: CollectionRowValue<C>) => QueryJoinKey
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionError<C> | CollectionSnapshotCodecError,
    R | CollectionRequirements<C>
  > {
    return this.join(alias, collection, leftKey, rightKey);
  }

  innerJoinIndexed<const Alias extends string, C extends AnyCollection>(
    alias: Alias,
    collection: C,
    leftKey: (row: TContext) => QueryJoinKey,
    index: string
  ): QueryBuilder<
    QueryJoinedContext<TContext, Alias, C>,
    QueryJoinResult<TContext, TResult, QueryJoinedContext<TContext, Alias, C>>,
    E | CollectionError<C> | CollectionSnapshotCodecError,
    R | CollectionRequirements<C>
  > {
    return this.joinIndexed(alias, collection, leftKey, index);
  }

  groupBy<
    TKey extends Record<string, unknown>,
    Aggregates extends QueryAggregateRecord<TContext>
  >(
    key: (row: TContext) => TKey,
    aggregates: Aggregates
  ): QueryBuilder<
    QueryAggregateResult<TKey, Aggregates>,
    QueryAggregateResult<TKey, Aggregates>,
    E,
    R
  > {
    type Grouped = QueryAggregateResult<TKey, Aggregates>;
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

  offset(count: number): QueryBuilder<TContext, TResult, E, R> {
    return new QueryBuilder<TContext, TResult, E, R>(
      this.sources,
      this.filters,
      this.projector,
      this.orders,
      Math.max(0, count),
      this.limitCount,
      this.joins,
      this.grouping
    );
  }

  limit(count: number): QueryBuilder<TContext, TResult, E, R> {
    return new QueryBuilder<TContext, TResult, E, R>(
      this.sources,
      this.filters,
      this.projector,
      this.orders,
      this.offsetCount,
      Math.max(0, count),
      this.joins,
      this.grouping
    );
  }

  execute(): ReadonlyArray<TResult> {
    const contexts = buildQueryContexts(this);
    return this.projectContexts(contexts);
  }

  projectContexts(contexts: ReadonlyArray<TContext>, options: QueryProjectOptions = {}): ReadonlyArray<TResult> {
    const shouldFilter = options.filter ?? true;
    const shouldOrder = options.order ?? true;
    const shouldWindow = options.window ?? true;
    let filtered = shouldFilter
      ? contexts.filter((row) => this.filters.every((filter) =>
        evaluateQueryOperation("filter", () => filter(row))
      ))
      : [...contexts];

    if (shouldOrder && this.orders.length > 0) {
      filtered = filtered
        .map((row, index) => ({ row, index }))
        .sort((left, right) => compareRows(left.row, right.row, left.index, right.index, this.orders))
        .map(({ row }) => row);
    }

    if (shouldWindow && this.offsetCount > 0) {
      filtered = filtered.slice(this.offsetCount);
    }

    if (shouldWindow && this.limitCount !== undefined) {
      filtered = filtered.slice(0, this.limitCount);
    }

    const projector = this.projector ?? projectCurrentContext<TContext, TResult>;
    return filtered.map((row) =>
      evaluateQueryOperation("projection", () => projector(row))
    );
  }
}

export type AnyQueryBuilder<TResult = any, E = any, R = any> = QueryBuilder<any, TResult, E, R>;

export type QueryFactory<TResult, E = any, R = any> = (query: QueryRoot) => AnyQueryBuilder<TResult, E, R>;

/**
 * Root query DSL entrypoint passed to query factories.
 */
export interface QueryRoot {
  from<const Sources extends SourceRecord>(
    sources: Sources
  ): QueryBuilder<
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
  readonly builder: AnyQueryBuilder<T, E, R>;
  readonly data: ReadableSignal<ReadonlyArray<T>>;
  readonly state: ReadableSignal<LiveQueryState<T, E | QueryEvaluationError>>;
  readonly sources: ReadonlyArray<AnyCollection>;
  evaluate(): ReadonlyArray<T>;
  preloadEffect(): Effect.Effect<void, E, R>;
  refetchEffect(): Effect.Effect<void, E, R>;
}

const queryRoot: QueryRoot = {
  from: <const Sources extends SourceRecord>(
    sources: Sources
  ): QueryBuilder<
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
  )
};

export const eq = <A>(left: A, right: A): boolean => Object.is(left, right);
export const neq = <A>(left: A, right: A): boolean => !Object.is(left, right);
export const gt = <A extends number | string | Date>(left: A, right: A): boolean => left > right;
export const gte = <A extends number | string | Date>(left: A, right: A): boolean => left >= right;
export const lt = <A extends number | string | Date>(left: A, right: A): boolean => left < right;
export const lte = <A extends number | string | Date>(left: A, right: A): boolean => left <= right;
export const and = (...values: ReadonlyArray<boolean>): boolean => values.every(Boolean);
export const or = (...values: ReadonlyArray<boolean>): boolean => values.some(Boolean);
export const not = (value: boolean): boolean => !value;
export const includes = <A>(values: ReadonlyArray<A>, value: A): boolean => values.includes(value);

const aggregateCount = <TContext>(
  value: (row: TContext) => unknown = (row) => row
): QueryAggregate<TContext, number, number> => ({
  preMap: (row) => value(row) == null ? 0 : 1,
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
  preMap: value,
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
  preMap: (row) => ({ sum: value(row), count: 1 }),
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
  preMap: value,
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
    return min;
  }
});

const aggregateMax = <TContext, V extends number | string | Date | bigint>(
  value: (row: TContext) => V
): QueryAggregate<TContext, V | undefined, V | undefined> => ({
  preMap: value,
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
    return max;
  }
});

/**
 * Query API for composing derived views over collections.
 *
 * Query factories receive `Query.from`/`query.from` and return an immutable
 * builder. Use `onceEffect` for one-shot reads and `live` for reactive data.
 */
export namespace Query {
  export type Builder<TContext extends AnyQueryContext, TResult, E = never, R = never> =
    QueryBuilder<TContext, TResult, E, R>;
  export type Factory<TResult, E = any, R = any> = QueryFactory<TResult, E, R>;
  export type Live<T, E = never, R = never> = LiveQuery<T, E, R>;
  export type LiveState<T, E = never> = LiveQueryState<T, E>;
  export type EvaluationError = QueryEvaluationError;
  export type JoinStrategy = QueryJoinStrategy;
  export type PlanSourceDiagnostics = QueryPlanSourceDiagnostics;
  export type PlanJoinDiagnostics = QueryPlanJoinDiagnostics;
  export type PlanDiagnostics = QueryPlanDiagnostics;
  export type Root = QueryRoot;
  export type Aggregate<TContext, R, V = unknown> = QueryAggregate<TContext, R, V>;
  export type Aggregates<TContext> = QueryAggregateRecord<TContext>;
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

  /** Build a query without executing or preloading it. */
  export const build = <T, E = never, R = never>(factory: QueryFactory<T, E, R>): AnyQueryBuilder<T, E, R> =>
    factory(queryRoot);

  /** Return query plan diagnostics for joins, filters, ordering, and row counts. */
  export const diagnostics = <T>(factory: QueryFactory<T>): QueryPlanDiagnostics =>
    buildQueryExecution(build(factory)).diagnostics;

  /**
   * Preload source collections once, then execute the query.
   *
   * Source collection errors and requirements are preserved in the returned
   * Effect.
   */
  export const onceEffect = <T, E = never, R = never>(
    factory: QueryFactory<T, E, R>
  ): Effect.Effect<ReadonlyArray<T>, E | QueryEvaluationError, R> =>
    Effect.gen(function* () {
      const builder = build(factory);
      yield* preloadLiveQuerySourcesEffect<E, R>(querySources(builder), false);
      return yield* Effect.try({
        try: () => builder.execute(),
        catch: (cause) => toQueryEvaluationError("evaluate", cause)
      });
    });

  /**
   * Create a reactive live query over collection rows.
   *
   * The returned signals update when source collection versions change.
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
  ): LiveQuery<T, E, R> => {
    const builder = build(factory);
    const sources = querySources(builder);
    const engine = makeLiveQueryRuntime(builder);
    let latestData: ReadonlyArray<T> = [];
    const evaluation = Signal.derive<{
      readonly data: ReadonlyArray<T>;
      readonly error: QueryEvaluationError | undefined;
    }>(() => {
      try {
        latestData = engine.evaluate();
        return { data: latestData, error: undefined };
      } catch (cause) {
        return {
          data: latestData,
          error: toQueryEvaluationError("evaluate", cause)
        };
      }
    });
    const data = Signal.derive(() => evaluation.get().data);
    const state = Signal.derive<LiveQueryState<T, E | QueryEvaluationError>>(() => {
      const current = evaluation.get();
      if (current.error) {
        return {
          _tag: "Failure",
          waiting: false,
          error: current.error,
          data: current.data
        };
      }

      const currentData = current.data;
      for (const source of sources) {
        const sourceState = source.state().get();
        if (sourceState._tag === "Failure") {
          return {
            _tag: "Failure",
            waiting: false,
            error: sourceState.error as E,
            data: currentData
          };
        }
      }

      const waiting = sources.some((source) => {
        const sourceState = source.state().get();
        return sourceState._tag === "Initial" || sourceState._tag === "Pending";
      });

      return waiting
        ? { _tag: "Pending", waiting: true, data: currentData }
        : { _tag: "Success", waiting: false, data: currentData };
    });

    return {
      builder,
      data,
      state,
      sources,
      evaluate: () => data.get(),
      preloadEffect: () => preloadLiveQuerySourcesEffect<E, R>(sources, false),
      refetchEffect: () => preloadLiveQuerySourcesEffect<E, R>(sources, true)
    };
  };
}
