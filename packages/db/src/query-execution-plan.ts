import { stableStringify } from "@effect-ui/core";
import { Effect } from "effect";
import {
  buildQueryContexts,
  buildQueryExecution,
  compareRows,
  compareValue,
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
import type { CollectionKey } from "./collection-contract.js";
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

export interface QueryOrderedContext<TContext extends AnyQueryContext> {
  readonly row: TContext;
  readonly index: number;
  readonly identity?: string;
}

export const querySourceContextIdentity = (alias: string, key: CollectionKey): string =>
  stableStringify([alias, typeof key, key]);

export const mergeQueryContextIdentities = (
  left: string,
  right: string
): string =>
  stableStringify([left, right]);

const queryContextOrderAliases = (
  builder: QueryPlanBuilder<any>
): ReadonlyArray<string> => {
  const joinAliases = new Set(builder.joins.map((join) => join.alias));
  return [
    ...builder.sources
      .filter(([alias]) => !joinAliases.has(alias))
      .map(([alias]) => alias),
    ...builder.joins.map((join) => join.alias)
  ];
};

const rowKey = (value: unknown): CollectionKey | undefined =>
  typeof value === "object" && value !== null && "$key" in value
    ? (value as { readonly $key: CollectionKey }).$key
    : undefined;

export const queryContextOrderIdentity = (
  builder: QueryPlanBuilder<any>,
  context: AnyQueryContext
): string | undefined => {
  let identity: string | undefined;
  for (const alias of queryContextOrderAliases(builder)) {
    const key = rowKey(context[alias]);
    if (key === undefined) {
      continue;
    }

    const sourceIdentity = querySourceContextIdentity(alias, key);
    identity = identity === undefined
      ? sourceIdentity
      : mergeQueryContextIdentities(identity, sourceIdentity);
  }

  return identity;
};

export const compareQueryOrderedContexts = <TContext extends AnyQueryContext>(
  left: QueryOrderedContext<TContext>,
  right: QueryOrderedContext<TContext>,
  orders: ReadonlyArray<QueryPlanBuilder<TContext>["orders"][number]>
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
      .map((row, index) => {
        const identity = queryContextOrderIdentity(builder, row);
        return identity === undefined
          ? { row, index }
          : { row, index, identity };
      })
      .sort((left, right) => compareQueryOrderedContexts(left, right, builder.orders))
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
