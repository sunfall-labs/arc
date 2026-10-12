import {
  isEffectLike,
  isPromiseLikeValue,
  type PlainValue,
  type Resource,
} from "@sunfall/arc-core";
import { stableStringify } from "@sunfall/arc-core/internal";
import { Data } from "effect";
import {
  makeQuerySourceAdapter,
  type QuerySource,
  type QuerySourceAdapter,
} from "./query-source-adapter.js";

/**
 * Error raised when the query builder cannot be represented as a live query.
 */
export class UnsupportedLiveQuery extends Data.TaggedError("UnsupportedLiveQuery")<{
  readonly reason: string;
}> {}

/** Query pipeline phase where a synchronous callback failure occurred. */
export type QueryEvaluationOperation =
  | "source"
  | "filter"
  | "join"
  | "aggregate"
  | "order"
  | "projection"
  | "evaluate";

/**
 * Error raised when query factories, plan validation, or user-provided
 * synchronous query callbacks fail during evaluation.
 *
 * Query factory throws are normalized with operation `"evaluate"`. One-shot
 * query Effects report this value in their error channel, while synchronous
 * diagnostics/live-query constructors throw the typed error directly.
 */
export class QueryEvaluationError extends Data.TaggedError("QueryEvaluationError")<{
  readonly operation: QueryEvaluationOperation;
  readonly message: string;
  readonly cause: unknown;
}> {}

class QueryCallbackPromiseRejected extends Data.TaggedError("QueryCallbackPromiseRejected")<{
  readonly guidance: string;
}> {}

class QueryCallbackEffectRejected extends Data.TaggedError("QueryCallbackEffectRejected")<{
  readonly guidance: string;
}> {}

/** Sort direction accepted by Query order clauses. */
export type QuerySortDirection = "asc" | "desc";
/** Comparable scalar value accepted by Query ordering; numbers must not be NaN and Dates must be valid. */
export type QuerySortValue = string | number | boolean | Date | null | undefined;
type NormalizedQuerySortValue = string | number | boolean | null | undefined;
/** Scalar join key before stable string normalization. */
export type QueryJoinKey = string | number | boolean | Date | null | undefined;
/** Execution strategy selected for one Query join. */
export type QueryJoinStrategy = "scan" | "index";

/** Named sources supplied to Query execution: refs of Resources with `rows`. */
export type SourceRecord = Record<string, QuerySource>;
/** Erased row context carried through query filter/join/project stages. */
export type AnyQueryContext = Record<string, any>;
/** Erased source row used by query joins. */
export type AnyQueryRow = any;

/** The row type of a rows Resource ref. */
export type QuerySourceRow<S> = S extends Resource.RowsRef<infer Row, any> ? Row : never;
/** The declared load error of a rows Resource ref. */
export type QuerySourceError<S> = S extends Resource.Ref<any, any, infer E, any> ? E : never;
/** The load services of a rows Resource ref. */
export type QuerySourceRequirements<S> = S extends Resource.Ref<any, any, any, infer R> ? R : never;
/** The index names a rows Resource ref declares. */
export type QuerySourceIndex<S> = {
  readonly [K in keyof S]: S[K] extends Resource.RowsSpec<any, any, infer Indexes>
    ? keyof Indexes & string
    : never;
}[keyof S];

/**
 * Union of the sources' declared load errors for a query source map (their
 * contract violations are defects).
 */
export type QuerySourcesError<Sources extends SourceRecord> = QuerySourceError<
  Sources[keyof Sources]
>;

/** Union of source service requirements for a query source map. */
export type QuerySourcesRequirements<Sources extends SourceRecord> = QuerySourceRequirements<
  Sources[keyof Sources]
>;

/** Row context produced from the source alias map. */
export type QueryContext<Sources extends SourceRecord> = {
  readonly [Key in keyof Sources]: QuerySourceRow<Sources[Key]>;
};

/** Row context after joining source `S` under alias `Alias`. */
export type QueryJoinedContext<
  TContext extends AnyQueryContext,
  Alias extends string,
  S extends QuerySource,
> = TContext & {
  readonly [Key in Alias]: QuerySourceRow<S>;
};

/** Result context chosen after a join projection. */
export type QueryJoinResult<TContext, TResult, TNextContext> = [TResult] extends [TContext]
  ? [TContext] extends [TResult]
    ? TNextContext
    : TResult
  : TResult;

/** Compiled order clause used by the query execution plan. */
export interface QueryOrder<TContext> {
  readonly direction: QuerySortDirection;
  readonly selector: (row: TContext) => QuerySortValue;
}

/** Compiled join clause used by the query execution plan. */
export interface QueryJoin {
  readonly alias: string;
  readonly source: QuerySource;
  readonly leftKey: (row: AnyQueryContext) => QueryJoinKey;
  readonly rightKeys: (row: AnyQueryRow) => ReadonlyArray<QueryJoinKey>;
  readonly rightIndex?: string;
}

/** Runtime diagnostics for one source in a query plan. */
export interface QueryPlanSourceDiagnostics {
  readonly alias: string;
  /** The source Resource's name. */
  readonly resource: string;
  readonly rows: number;
}

/** Runtime diagnostics for one join stage in a query plan. */
export interface QueryPlanJoinDiagnostics {
  readonly alias: string;
  /** The joined Resource's name. */
  readonly resource: string;
  readonly strategy: QueryJoinStrategy;
  readonly index?: string;
  readonly leftRows: number;
  readonly rightRows: number;
  readonly outputRows: number;
  readonly estimatedComparisons: number;
}

/** Query plan execution summary exposed to diagnostics and LSP hovers. */
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

/** Query execution result plus diagnostics for the evaluated context rows. */
export interface QueryExecution<TContext> {
  readonly contexts: Array<TContext>;
  readonly diagnostics: QueryPlanDiagnostics;
}

/** Source role selected by the compiled Query Stage Plan. */
export type QueryStageSourceRole = "base" | "join";

/** Source and adapter facts used by snapshot and live query stages. */
export interface QueryStageSource {
  readonly alias: string;
  readonly source: QuerySource;
  readonly adapter: QuerySourceAdapter;
  readonly role: QueryStageSourceRole;
}

/** Window stage selected by the compiled Query Stage Plan. */
export interface QueryStageWindow {
  readonly offset: number;
  readonly limit?: number;
}

/**
 * Compiled Query stage facts shared by snapshot execution and Live Query Runtime.
 *
 * The builder remains the fluent public Interface. This internal plan owns the
 * stage ordering facts so one-shot and live execution do not independently
 * decide which sources are base sources, which sources are joins, and where
 * filtering, ordering, grouping, and windowing belong.
 */
export interface QueryStagePlan<TContext extends AnyQueryContext> {
  readonly sources: ReadonlyArray<QueryStageSource>;
  readonly baseSources: ReadonlyArray<QueryStageSource>;
  readonly sourceAdapters: ReadonlyArray<QuerySourceAdapter>;
  readonly sourceByAlias: ReadonlyMap<string, QueryStageSource>;
  readonly identityAliases: ReadonlyArray<string>;
  readonly joins: ReadonlyArray<QueryJoin>;
  readonly grouping: AnyQueryGrouping | undefined;
  readonly filters: ReadonlyArray<(row: TContext) => boolean>;
  readonly orders: ReadonlyArray<QueryOrder<TContext>>;
  readonly window: QueryStageWindow;
}

/**
 * Aggregate definition used by `Query.groupBy`.
 */
export interface QueryAggregate<TContext, R, V = unknown> {
  readonly preMap: (row: TContext) => V & RejectPlainQueryRecord<V>;
  readonly reduce: (values: Array<[V, number]>) => V & RejectPlainQueryRecord<V>;
  readonly postMap?: (value: V) => R & RejectPlainQueryRecord<R>;
}

export type QueryAggregateRecord<TContext> = Record<string, QueryAggregate<TContext, any, any>>;
export type AnyQueryAggregateRecord = QueryAggregateRecord<any>;
/** Recursively rejects executable-shaped values inside query result data structures. */
export type RejectPlainQueryRecord<Value> = [PlainValue<Value>] extends [never]
  ? never
  : Value extends (...args: any) => unknown
    ? Value
    : Value extends Date | URL | ArrayBuffer | DataView
      ? Value
      : Value extends readonly (infer Item)[]
        ? readonly RejectPlainQueryRecord<Item>[]
        : Value extends ReadonlyMap<infer Key, infer Item>
          ? ReadonlyMap<RejectPlainQueryRecord<Key>, RejectPlainQueryRecord<Item>>
          : Value extends ReadonlySet<infer Item>
            ? ReadonlySet<RejectPlainQueryRecord<Item>>
            : Value extends object
              ? { readonly [Key in keyof Value]: RejectPlainQueryRecord<Value[Key]> }
              : Value;
/** Public grouped-query key shape accepted by `Query.groupBy(...)`. */
export type QueryGroupKey<TKey extends Record<string, unknown> = Record<string, unknown>> = TKey &
  RejectPlainQueryRecord<TKey>;
export type QueryAggregateResult<
  TKey extends Record<string, unknown>,
  Aggregates extends AnyQueryAggregateRecord,
> = TKey & {
  readonly [Key in keyof Aggregates]: Aggregates[Key] extends QueryAggregate<
    infer _Context,
    infer R,
    infer _Value
  >
    ? R
    : never;
};

export interface QueryGrouping<
  TSource extends AnyQueryContext,
  _TResult extends Record<string, unknown>,
> {
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
  readonly sources: ReadonlyArray<readonly [string, QuerySource]>;
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
  (typeof cause === "object" &&
    cause !== null &&
    (cause as { readonly _tag?: unknown })._tag === "QueryEvaluationError" &&
    "operation" in cause &&
    "cause" in cause &&
    "message" in cause);

export const toQueryEvaluationError = (
  operation: QueryEvaluationOperation,
  cause: unknown,
): QueryEvaluationError =>
  isQueryEvaluationError(cause)
    ? cause
    : new QueryEvaluationError({
        operation,
        cause,
        message: cause instanceof Error ? cause.message : String(cause),
      });

const isEffectShapedQueryValue = (value: unknown): boolean =>
  value instanceof Error ? false : isEffectLike(value);

const queryGroupKeyPathSegment = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;

const promiseShapedQueryValuePath = (
  value: unknown,
  path = "$",
  active = new WeakSet<object>(),
): string | undefined => {
  if (isPromiseLikeValue(value)) {
    return path;
  }
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (
    value instanceof Date ||
    value instanceof URL ||
    value instanceof ArrayBuffer ||
    value instanceof DataView ||
    ArrayBuffer.isView(value)
  ) {
    return undefined;
  }
  if (active.has(value)) {
    return undefined;
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const found = promiseShapedQueryValuePath(value[index], `${path}[${index}]`, active);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    if (value instanceof Map) {
      let index = 0;
      for (const [key, entryValue] of value.entries()) {
        const keyPath = promiseShapedQueryValuePath(key, `${path}.<key:${index}>`, active);
        if (keyPath !== undefined) {
          return keyPath;
        }
        const valuePath = promiseShapedQueryValuePath(
          entryValue,
          `${path}.<value:${index}>`,
          active,
        );
        if (valuePath !== undefined) {
          return valuePath;
        }
        index++;
      }
      return undefined;
    }
    if (value instanceof Set) {
      let index = 0;
      for (const entryValue of value.values()) {
        const found = promiseShapedQueryValuePath(entryValue, `${path}.<value:${index}>`, active);
        if (found !== undefined) {
          return found;
        }
        index++;
      }
      return undefined;
    }

    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      const propertyPath = `${path}${queryGroupKeyPathSegment(key)}`;
      const found = promiseShapedQueryValuePath(Reflect.get(object, key), propertyPath, active);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  } finally {
    active.delete(value);
  }
};

const effectShapedQueryValuePath = (
  value: unknown,
  path = "$",
  active = new WeakSet<object>(),
): string | undefined => {
  if (isEffectShapedQueryValue(value)) {
    return path;
  }
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (
    value instanceof Date ||
    value instanceof URL ||
    value instanceof ArrayBuffer ||
    value instanceof DataView ||
    ArrayBuffer.isView(value)
  ) {
    return undefined;
  }
  if (active.has(value)) {
    return undefined;
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const found = effectShapedQueryValuePath(value[index], `${path}[${index}]`, active);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    if (value instanceof Map) {
      let index = 0;
      for (const [key, entryValue] of value.entries()) {
        const keyPath = effectShapedQueryValuePath(key, `${path}.<key:${index}>`, active);
        if (keyPath !== undefined) {
          return keyPath;
        }
        const valuePath = effectShapedQueryValuePath(
          entryValue,
          `${path}.<value:${index}>`,
          active,
        );
        if (valuePath !== undefined) {
          return valuePath;
        }
        index++;
      }
      return undefined;
    }
    if (value instanceof Set) {
      let index = 0;
      for (const entryValue of value.values()) {
        const found = effectShapedQueryValuePath(entryValue, `${path}.<value:${index}>`, active);
        if (found !== undefined) {
          return found;
        }
        index++;
      }
      return undefined;
    }

    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      const propertyPath = `${path}${queryGroupKeyPathSegment(key)}`;
      const found = effectShapedQueryValuePath(Reflect.get(object, key), propertyPath, active);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  } finally {
    active.delete(value);
  }
};

const promiseShapedQueryCallbackError = (
  operation: QueryEvaluationOperation,
  path = "$",
): QueryEvaluationError =>
  new QueryEvaluationError({
    operation,
    cause: new QueryCallbackPromiseRejected({
      guidance:
        "Query callbacks are synchronous. Move async work into the source Resource's load, or wrap host Promise work in an Effect before it reaches Query evaluation.",
    }),
    message: `Query ${operation} callbacks must return synchronous values, not Promise-shaped values at ${path}.`,
  });

const effectShapedQueryCallbackError = (
  operation: QueryEvaluationOperation,
  path = "$",
): QueryEvaluationError =>
  new QueryEvaluationError({
    operation,
    cause: new QueryCallbackEffectRejected({
      guidance:
        "Query callbacks are synchronous data projections. Return Effect work from the source Resource's load before it reaches Query evaluation.",
    }),
    message: `Query ${operation} callbacks must return plain data, not Effect-shaped values at ${path}.`,
  });

export const evaluateQueryOperation = <A>(
  operation: QueryEvaluationOperation,
  evaluate: () => A,
): A => {
  try {
    const value = evaluate();
    if (isPromiseLikeValue(value)) {
      throw promiseShapedQueryCallbackError(operation);
    }
    if (isEffectShapedQueryValue(value)) {
      throw effectShapedQueryCallbackError(operation);
    }
    return value;
  } catch (cause) {
    throw toQueryEvaluationError(operation, cause);
  }
};

export const evaluateQueryStructuredOperation = <A>(
  operation: QueryEvaluationOperation,
  evaluate: () => A,
): A =>
  evaluateQueryOperation(operation, () => {
    const value = evaluate();
    const promisePath = promiseShapedQueryValuePath(value);
    if (promisePath !== undefined) {
      throw promiseShapedQueryCallbackError(operation, promisePath);
    }
    const effectPath = effectShapedQueryValuePath(value);
    if (effectPath !== undefined) {
      throw effectShapedQueryCallbackError(operation, effectPath);
    }
    return value;
  });

export const joinKey = (value: QueryJoinKey): string =>
  value instanceof Date ? `Date:${value.toISOString()}` : stableStringify(value);

export const evaluateQueryJoinKey = (value: QueryJoinKey): string =>
  evaluateQueryOperation("join", () => joinKey(value));

export const evaluateQueryGroupKey = (value: Record<string, unknown>): string =>
  evaluateQueryOperation("aggregate", () => {
    const promisePath = promiseShapedQueryValuePath(value);
    if (promisePath !== undefined) {
      throw promiseShapedQueryCallbackError("aggregate", promisePath);
    }
    const effectPath = effectShapedQueryValuePath(value);
    if (effectPath !== undefined) {
      throw effectShapedQueryCallbackError("aggregate", effectPath);
    }
    return stableStringify(value);
  });

const isQuerySortScalar = (value: unknown): value is QuerySortValue =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  value instanceof Date;

const querySortValueError = (path: string, reason: string): QueryEvaluationError =>
  new QueryEvaluationError({
    operation: "order",
    cause: new TypeError(reason),
    message: `Query order value at ${path} must be a comparable scalar value.`,
  });

const normalizeQuerySortValue = (value: unknown, path: string): NormalizedQuerySortValue => {
  if (!isQuerySortScalar(value)) {
    throw querySortValueError(
      path,
      "Query order values must be string, number, boolean, Date, null, or undefined.",
    );
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) {
      throw querySortValueError(path, "Query order Date values must be valid.");
    }
    return millis;
  }
  if (typeof value === "number" && Number.isNaN(value)) {
    throw querySortValueError(path, "Query order number values cannot be NaN.");
  }
  return value;
};

const validateQueryOrderValues = (
  contexts: ReadonlyArray<AnyQueryContext>,
  orders: ReadonlyArray<QueryOrder<any>>,
): void => {
  for (const context of contexts) {
    for (const order of orders) {
      const value = evaluateQueryOperation("order", () => order.selector(context));
      normalizeQuerySortValue(value, "$.order");
    }
  }
};

const reservedQuerySourceAliases = new Set(["__proto__", "constructor", "prototype"]);

/** Builds the diagnostic message for a source alias that cannot safely key a row context. */
export const reservedQuerySourceAliasReason = (alias: string): string =>
  `Query source alias "${alias}" is reserved. Use a domain alias that can be represented as an own object property.`;

/** Rejects source aliases that would collide with object prototype mechanics. */
export const validateQuerySourceAlias = (alias: string): void => {
  if (reservedQuerySourceAliases.has(alias)) {
    throw new UnsupportedLiveQuery({
      reason: reservedQuerySourceAliasReason(alias),
    });
  }
};

/** Validates alias and join invariants before a Query plan reads source rows. */
export const validateQueryPlan = <TContext extends AnyQueryContext>(
  builder: QueryPlanBuilder<TContext>,
): void => {
  if (builder.sources.length === 0) {
    throw new UnsupportedLiveQuery({
      reason: "Queries require at least one source.",
    });
  }
  if (!Number.isSafeInteger(builder.offsetCount) || builder.offsetCount < 0) {
    throw new UnsupportedLiveQuery({
      reason: "Query offset must be a finite non-negative safe integer.",
    });
  }
  if (
    builder.limitCount !== undefined &&
    (!Number.isSafeInteger(builder.limitCount) || builder.limitCount < 0)
  ) {
    throw new UnsupportedLiveQuery({
      reason: "Query limit must be a finite non-negative safe integer.",
    });
  }

  const aliases = new Map<string, QuerySource>();
  for (const [alias, source] of builder.sources) {
    validateQuerySourceAlias(alias);
    const existing = aliases.get(alias);
    if (existing) {
      throw new UnsupportedLiveQuery({
        reason: `Query source alias "${alias}" is registered more than once.`,
      });
    }
    aliases.set(alias, source);
  }

  for (const join of builder.joins) {
    const source = aliases.get(join.alias);
    if (!source) {
      throw new UnsupportedLiveQuery({
        reason: `Join source "${join.alias}" is not registered.`,
      });
    }
    if (source !== join.source) {
      throw new UnsupportedLiveQuery({
        reason: `Join source "${join.alias}" is registered for Resource "${source.family.options.name}" but the join uses "${join.source.family.options.name}".`,
      });
    }
    if (
      join.rightIndex !== undefined &&
      !makeQuerySourceAdapter(join.source).hasIndex(join.rightIndex)
    ) {
      throw new UnsupportedLiveQuery({
        reason: `Join source "${join.alias}" uses unknown index "${join.rightIndex}" on Resource "${join.source.family.options.name}".`,
      });
    }
  }

  if (builder.joins.length > 0) {
    const joinAliases = new Set(builder.joins.map((join) => join.alias));
    const hasBaseSource = builder.sources.some(([alias]) => !joinAliases.has(alias));
    if (!hasBaseSource) {
      throw new UnsupportedLiveQuery({
        reason: "Queries with joins require at least one non-join source.",
      });
    }
  }
};

/** Compiles validated Query builder facts into the shared snapshot/live stage plan. */
export const compileQueryStagePlan = <TContext extends AnyQueryContext>(
  builder: QueryPlanBuilder<TContext>,
): QueryStagePlan<TContext> => {
  validateQueryPlan(builder);
  const joinAliases = new Set(builder.joins.map((join) => join.alias));
  const adapterBySource = new Map<string, QuerySourceAdapter>();
  const sourceAdapter = (source: QuerySource): QuerySourceAdapter => {
    const existing = adapterBySource.get(source.key);
    if (existing !== undefined) {
      return existing;
    }

    const adapter = makeQuerySourceAdapter(source);
    adapterBySource.set(source.key, adapter);
    return adapter;
  };
  const sources = builder.sources.map(
    ([alias, source]): QueryStageSource => ({
      alias,
      source,
      adapter: sourceAdapter(source),
      role: joinAliases.has(alias) ? "join" : "base",
    }),
  );
  const baseSources = sources.filter((source) => source.role === "base");
  const sourceByAlias = new Map(sources.map((source) => [source.alias, source]));
  return {
    sources,
    baseSources,
    sourceAdapters: Array.from(adapterBySource.values()),
    sourceByAlias,
    identityAliases: [
      ...baseSources.map((source) => source.alias),
      ...builder.joins.map((join) => join.alias),
    ],
    joins: builder.joins,
    grouping: builder.grouping,
    filters: builder.filters,
    orders: builder.orders,
    window: {
      offset: builder.offsetCount,
      ...(builder.limitCount === undefined ? {} : { limit: builder.limitCount }),
    },
  };
};

const buildStageSourceContexts = <TContext extends AnyQueryContext>(
  sources: ReadonlyArray<QueryStageSource>,
): Array<TContext> => {
  if (sources.length === 0) {
    throw new UnsupportedLiveQuery({
      reason: "Queries require at least one source.",
    });
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

    for (const { row } of source.adapter.entries()) {
      current[source.alias] = row;
      visit(index + 1, current);
    }
    delete current[source.alias];
  };

  visit(0, {});
  return contexts;
};

export const buildQueryExecutionFromStagePlan = <TContext extends AnyQueryContext>(
  stagePlan: QueryStagePlan<TContext>,
): QueryExecution<TContext> => {
  const sourceDiagnostics = stagePlan.sources.map((source): QueryPlanSourceDiagnostics => {
    return {
      alias: source.alias,
      resource: source.adapter.name,
      rows: source.adapter.rowCount(),
    };
  });
  const joins: Array<QueryPlanJoinDiagnostics> = [];
  let contexts = buildStageSourceContexts<AnyQueryContext>(stagePlan.baseSources);

  for (const join of stagePlan.joins) {
    const joined: Array<AnyQueryContext> = [];
    const leftRows = contexts.length;
    const source = stagePlan.sourceByAlias.get(join.alias)?.adapter;
    if (!source) {
      throw new UnsupportedLiveQuery({ reason: `Join source "${join.alias}" is not registered.` });
    }
    const rightRows = source.rowCount();
    for (const context of contexts) {
      const leftValue = evaluateQueryOperation("join", () => join.leftKey(context));
      const left = evaluateQueryJoinKey(leftValue);
      const rows = join.rightIndex
        ? evaluateQueryOperation("join", () => source.indexRows(join.rightIndex!, leftValue))
        : source.rows();
      for (const row of rows) {
        const rightKeys = evaluateQueryStructuredOperation("join", () => join.rightKeys(row));
        if (rightKeys.some((rightValue) => left === evaluateQueryJoinKey(rightValue))) {
          joined.push({
            ...context,
            [join.alias]: row,
          });
        }
      }
    }
    joins.push({
      alias: join.alias,
      resource: source.name,
      strategy: join.rightIndex ? "index" : "scan",
      ...(join.rightIndex === undefined ? {} : { index: join.rightIndex }),
      leftRows,
      rightRows,
      outputRows: joined.length,
      estimatedComparisons: join.rightIndex ? leftRows : leftRows * rightRows,
    });
    contexts = joined;
  }

  let resultContexts: Array<AnyQueryContext>;
  if (stagePlan.grouping !== undefined) {
    resultContexts = groupContexts(contexts, stagePlan.grouping);
  } else {
    resultContexts = contexts;
  }
  if (stagePlan.orders.length > 0) {
    validateQueryOrderValues(
      resultContexts.filter((context) =>
        stagePlan.filters.every((filter) =>
          evaluateQueryOperation("filter", () => filter(context as TContext)),
        ),
      ),
      stagePlan.orders,
    );
  }

  return {
    contexts: resultContexts as Array<TContext>,
    diagnostics: {
      sources: sourceDiagnostics,
      joins,
      filters: stagePlan.filters.length,
      orders: stagePlan.orders.length,
      grouped: stagePlan.grouping !== undefined,
      offset: stagePlan.window.offset,
      ...(stagePlan.window.limit === undefined ? {} : { limit: stagePlan.window.limit }),
      contextRows: resultContexts.length,
    },
  };
};

export const groupContexts = (
  contexts: ReadonlyArray<AnyQueryContext>,
  grouping: AnyQueryGrouping,
): Array<Record<string, unknown>> => {
  const groups = new Map<
    string,
    {
      readonly key: Record<string, unknown>;
      readonly values: Array<AnyQueryContext>;
    }
  >();

  for (const context of contexts) {
    if (
      !grouping.sourceFilters.every((filter) =>
        evaluateQueryOperation("filter", () => filter(context)),
      )
    ) {
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
      const values = group.values.map(
        (value) =>
          [evaluateQueryStructuredOperation("aggregate", () => aggregate.preMap(value)), 1] as [
            unknown,
            number,
          ],
      );
      const reduced = evaluateQueryStructuredOperation("aggregate", () => aggregate.reduce(values));
      result[name] = aggregate.postMap
        ? evaluateQueryStructuredOperation("aggregate", () => aggregate.postMap!(reduced))
        : reduced;
    }
    return result;
  });
};

export const compareValue = (left: QuerySortValue, right: QuerySortValue): number => {
  const leftValue = normalizeQuerySortValue(left, "$.left");
  const rightValue = normalizeQuerySortValue(right, "$.right");

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
  orders: ReadonlyArray<QueryOrder<TContext>>,
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
