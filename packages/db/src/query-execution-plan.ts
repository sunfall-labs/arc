import { Effect } from "effect";
import {
  buildQueryContexts,
  buildQueryExecution,
  compareRows,
  evaluateQueryOperation,
  projectCurrentContext,
  querySourceAdapters,
  toQueryEvaluationError,
  validateQueryPlan,
  type AnyQueryContext,
  type QueryEvaluationError,
  type QueryPlanBuilder,
  type QueryPlanDiagnostics,
  type QueryProjectOptions
} from "./query-plan.js";
import type { QueryCollectionSourceAdapter } from "./query-source-adapter.js";

export interface QueryExecutionPlanBuilder<TContext extends AnyQueryContext, TResult>
  extends QueryPlanBuilder<TContext> {
  readonly projector: ((row: TContext) => TResult) | undefined;
}

/** Source adapters used by a query execution plan, de-duped by collection identity. */
export const queryExecutionPlanSourceAdapters = (
  builder: QueryPlanBuilder<any>
): ReadonlyArray<QueryCollectionSourceAdapter> =>
  querySourceAdapters(builder);

/** Projects already-built query contexts through the plan's remaining stages. */
export const projectQueryContexts = <TContext extends AnyQueryContext, TResult>(
  builder: QueryExecutionPlanBuilder<TContext, TResult>,
  contexts: ReadonlyArray<TContext>,
  options: QueryProjectOptions = {}
): ReadonlyArray<TResult> => {
  const shouldFilter = options.filter ?? true;
  const shouldOrder = options.order ?? true;
  const shouldWindow = options.window ?? true;
  let filtered = shouldFilter
    ? contexts.filter((row) => builder.filters.every((filter) =>
      evaluateQueryOperation("filter", () => filter(row))
    ))
    : [...contexts];

  if (shouldOrder && builder.orders.length > 0) {
    filtered = filtered
      .map((row, index) => ({ row, index }))
      .sort((left, right) => compareRows(left.row, right.row, left.index, right.index, builder.orders))
      .map(({ row }) => row);
  }

  if (shouldWindow && builder.offsetCount > 0) {
    filtered = filtered.slice(builder.offsetCount);
  }

  if (shouldWindow && builder.limitCount !== undefined) {
    filtered = filtered.slice(0, builder.limitCount);
  }

  const projector = builder.projector ?? projectCurrentContext<TContext, TResult>;
  return filtered.map((row) =>
    evaluateQueryOperation("projection", () => projector(row))
  );
};

/** Executes a query snapshot through the full execution plan. */
export const executeQueryPlan = <TContext extends AnyQueryContext, TResult>(
  builder: QueryExecutionPlanBuilder<TContext, TResult>
): ReadonlyArray<TResult> =>
  projectQueryContexts(builder, buildQueryContexts(builder));

/** Builds diagnostics for the query execution plan. */
export const queryExecutionPlanDiagnostics = (
  builder: QueryPlanBuilder<any>
): QueryPlanDiagnostics => {
  validateQueryPlan(builder);
  return buildQueryExecution(builder).diagnostics;
};

export const preloadQueryExecutionPlanSourcesEffect = <E, R>(
  sources: ReadonlyArray<QueryCollectionSourceAdapter>,
  force: boolean
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    for (const source of sources) {
      yield* source.preloadEffect(force);
    }
  });

/** Validates and preloads the source collections for a query execution plan. */
export const preloadQueryExecutionPlanEffect = <E, R>(
  builder: QueryPlanBuilder<any>,
  force: boolean
): Effect.Effect<void, E | QueryEvaluationError, R> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => validateQueryPlan(builder),
      catch: (cause) => toQueryEvaluationError("evaluate", cause)
    });
    yield* preloadQueryExecutionPlanSourcesEffect<E, R>(
      queryExecutionPlanSourceAdapters(builder),
      force
    );
  });
