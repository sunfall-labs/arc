import { Effect } from "effect";
import {
  buildQueryExecutionFromStagePlan,
  compareRows,
  compareValue,
  compileQueryStagePlan,
  evaluateQueryOperation,
  evaluateQueryStructuredOperation,
  projectCurrentContext,
  toQueryEvaluationError,
  type AnyQueryContext,
  type QueryEvaluationError,
  type QueryPlanBuilder,
  type QueryPlanDiagnostics,
  type QueryProjectOptions,
  type QueryStagePlan,
} from "./query-plan.js";
import { queryContextOrderIdentity, type QueryContextIdentity } from "./query-context-identity.js";
export {
  mergeQueryContextIdentities,
  queryCollectionRowIdentity,
  queryContextIdentityOf,
  queryContextIdentitySymbol,
  queryContextOrderIdentity,
  querySourceContextIdentity,
} from "./query-context-identity.js";
import type { QueryCollectionSourceAdapter } from "./query-source-adapter.js";

export interface QueryExecutionPlanBuilder<
  TContext extends AnyQueryContext,
  TResult,
> extends QueryPlanBuilder<TContext> {
  readonly projector: ((row: TContext) => TResult) | undefined;
}

export interface QueryOrderedContext<TContext extends AnyQueryContext> {
  readonly row: TContext;
  readonly index: number;
  readonly identity?: QueryContextIdentity;
}

export const compareQueryOrderedContexts = <TContext extends AnyQueryContext>(
  left: QueryOrderedContext<TContext>,
  right: QueryOrderedContext<TContext>,
  orders: ReadonlyArray<QueryPlanBuilder<TContext>["orders"][number]>,
): number => {
  const ordered = compareRows(left.row, right.row, 0, 0, orders);
  if (ordered !== 0) {
    return ordered;
  }

  if (left.identity !== undefined && right.identity !== undefined) {
    const identity = compareValue(left.identity, right.identity);
    if (identity !== 0) {
      return identity;
    }
  }

  return left.index - right.index;
};

interface ProjectQueryContextsOptions<
  TContext extends AnyQueryContext,
> extends QueryProjectOptions {
  readonly stagePlan?: QueryStagePlan<TContext>;
}

/** Projects already-built query contexts through the plan's remaining stages. */
export const projectQueryContexts = <TContext extends AnyQueryContext, TResult>(
  builder: QueryExecutionPlanBuilder<TContext, TResult>,
  contexts: ReadonlyArray<TContext>,
  options: ProjectQueryContextsOptions<TContext> = {},
): ReadonlyArray<TResult> => {
  const stagePlan = options.stagePlan ?? compileQueryStagePlan(builder);
  const shouldFilter = options.filter ?? true;
  const shouldOrder = options.order ?? true;
  const shouldWindow = options.window ?? true;
  let filtered = shouldFilter
    ? contexts.filter((row) =>
        stagePlan.filters.every((filter) => evaluateQueryOperation("filter", () => filter(row))),
      )
    : [...contexts];

  if (shouldOrder && stagePlan.orders.length > 0) {
    filtered = filtered
      .map((row, index) => {
        const identity = queryContextOrderIdentity(stagePlan.identityAliases, row);
        return identity === undefined ? { row, index } : { row, index, identity };
      })
      .sort((left, right) => compareQueryOrderedContexts(left, right, stagePlan.orders))
      .map(({ row }) => row);
  }

  if (shouldWindow && stagePlan.window.offset > 0) {
    filtered = filtered.slice(stagePlan.window.offset);
  }

  if (shouldWindow && stagePlan.window.limit !== undefined) {
    filtered = filtered.slice(0, stagePlan.window.limit);
  }

  const projector = builder.projector ?? projectCurrentContext<TContext, TResult>;
  return filtered.map((row) =>
    evaluateQueryStructuredOperation("projection", () => projector(row)),
  );
};

/** Executes a query snapshot through the full execution plan. */
export const executeQueryPlan = <TContext extends AnyQueryContext, TResult>(
  builder: QueryExecutionPlanBuilder<TContext, TResult>,
): ReadonlyArray<TResult> => {
  const stagePlan = compileQueryStagePlan(builder);
  return projectQueryContexts(builder, buildQueryExecutionFromStagePlan(stagePlan).contexts, {
    stagePlan,
  });
};

/** Builds diagnostics for the query execution plan. */
export const queryExecutionPlanDiagnostics = (
  builder: QueryPlanBuilder<any>,
): QueryPlanDiagnostics => {
  return buildQueryExecutionFromStagePlan(compileQueryStagePlan(builder)).diagnostics;
};

export const preloadQueryExecutionPlanSourcesEffect = <E, R>(
  sources: ReadonlyArray<QueryCollectionSourceAdapter>,
  force: boolean,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    for (const source of sources) {
      yield* source.preloadEffect(force);
    }
  });

/** Validates and preloads the source collections for a query execution plan. */
export const preloadQueryExecutionPlanEffect = <E, R>(
  builder: QueryPlanBuilder<any>,
  force: boolean,
): Effect.Effect<void, E | QueryEvaluationError, R> =>
  Effect.gen(function* () {
    const stagePlan = yield* Effect.try({
      try: () => compileQueryStagePlan(builder),
      catch: (cause) => toQueryEvaluationError("evaluate", cause),
    });
    yield* preloadQueryExecutionPlanSourcesEffect<E, R>(stagePlan.sourceAdapters, force);
  });
