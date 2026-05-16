import { stableStringify } from "@effect-ui/core";
import {
  D2,
  MultiSet,
  filter as ivmFilter,
  groupBy as ivmGroupBy,
  innerJoin as ivmInnerJoin,
  map as ivmMap,
  orderByWithFractionalIndex as ivmOrderByWithFractionalIndex,
  output as ivmOutput,
  type IOperator,
  type IStreamBuilder,
  type KeyValue,
  type PipedOperator,
  type RootStreamBuilder
} from "@tanstack/db-ivm";
import type { AnyCollection } from "./collection-contract.js";
import {
  UnsupportedLiveQuery,
  compareValue,
  evaluateQueryOperation,
  joinKey,
  type AnyCollectionRow,
  type AnyQueryAggregateRecord,
  type AnyQueryContext,
  type AnyQueryGrouping,
  type QueryJoin,
  type QueryOrder,
  type QueryProjectOptions
} from "./query-plan.js";
import {
  compareQueryOrderedContexts,
  projectQueryContexts,
  validateQueryExecutionPlan,
  type QueryExecutionPlanBuilder
} from "./query-execution-plan.js";
import {
  mergeQueryContextRecords,
  queryCollectionRowIdentity,
  queryContextIdentityOf,
  querySourceContext,
  type QueryContextIdentityRecord
} from "./query-context-identity.js";
import {
  makeQuerySourceAdapter,
  type QueryCollectionSourceAdapter
} from "./query-source-adapter.js";

export type LiveQueryRuntimeBuilder<TContext extends AnyQueryContext, TResult> =
  QueryExecutionPlanBuilder<TContext, TResult>;

export interface LiveQueryRuntime<TResult> {
  evaluate(): ReadonlyArray<TResult>;
}

const compareIvmContexts = <TContext extends AnyQueryContext>(
  orders: ReadonlyArray<QueryOrder<TContext>>
) => (left: TContext, right: TContext): number => {
  const leftIdentity = queryContextIdentityOf(left);
  const rightIdentity = queryContextIdentityOf(right);
  return compareQueryOrderedContexts(
    leftIdentity === undefined
      ? { row: left, index: 0 }
      : { row: left, index: 0, identity: leftIdentity },
    rightIdentity === undefined
      ? { row: right, index: 0 }
      : { row: right, index: 0, identity: rightIdentity },
    orders
  );
};

const crossJoinKey = "__effect_ui_db_all__";

type IvmRuntimeOperator = IOperator<unknown>;

const wrapIvmGrouping = (grouping: AnyQueryGrouping): AnyQueryGrouping => ({
  key: (row) => evaluateQueryOperation("aggregate", () => grouping.key(row)),
  sourceFilters: grouping.sourceFilters.map((filter) =>
    (row) => evaluateQueryOperation("filter", () => filter(row))
  ),
  aggregates: Object.fromEntries(
    Object.entries(grouping.aggregates).map(([name, aggregate]) => [
      name,
      {
        preMap: (row: AnyQueryContext) =>
          evaluateQueryOperation("aggregate", () => aggregate.preMap(row)),
        reduce: (values: Array<[unknown, number]>) =>
          evaluateQueryOperation("aggregate", () => aggregate.reduce(values)),
        ...(aggregate.postMap
          ? {
            postMap: (value: unknown) =>
              evaluateQueryOperation("aggregate", () => aggregate.postMap!(value))
          }
          : {})
      }
    ])
  ) as AnyQueryAggregateRecord
});

const addIvmRuntimeOperator = (
  graph: IStreamBuilder<unknown>["graph"],
  operator: IvmRuntimeOperator
): void => {
  // @tanstack/db-ivm dispatches through IOperator at runtime, but addOperator is typed to internal classes.
  (graph.addOperator as (operator: IvmRuntimeOperator) => void)(operator);
};

const ivmFlatMap = <T, U>(
  mapInput: (input: T) => ReadonlyArray<U>
): PipedOperator<T, U> =>
  (stream): IStreamBuilder<U> => {
    const reader = stream.connectReader();
    const output = stream.graph.newInput<U>();
    addIvmRuntimeOperator(stream.graph, {
      run: () => {
        for (const message of reader.drain()) {
          const mapped: Array<[U, number]> = [];
          for (const [input, multiplicity] of message.getInner()) {
            for (const outputValue of mapInput(input)) {
              mapped.push([outputValue, multiplicity]);
            }
          }
          if (mapped.length > 0) {
            output.writer.sendData(new MultiSet(mapped));
          }
        }
      },
      hasPendingWork: () => !reader.isEmpty()
    });
    return output;
  };

type IvmContext = AnyQueryContext & QueryContextIdentityRecord;

interface IvmSource {
  readonly alias: string;
  readonly source: QueryCollectionSourceAdapter;
  readonly input: RootStreamBuilder<KeyValue<string, IvmContext>>;
  readonly previous: Map<string, { readonly row: AnyCollectionRow; readonly hash: string }>;
}

interface IvmOutputRow<TContext> {
  readonly context: TContext;
  readonly order: string | undefined;
}

class IvmLiveQueryRuntime<TContext extends AnyQueryContext, TResult> implements LiveQueryRuntime<TResult> {
  readonly #graph = new D2();
  readonly #sources: ReadonlyArray<IvmSource>;
  readonly #rows = new Map<string, { context: TContext; count: number; order: string | undefined }>();

  constructor(readonly builder: LiveQueryRuntimeBuilder<TContext, TResult>) {
    this.#sources = builder.sources.map(([alias, collection]) => ({
      alias,
      source: makeQuerySourceAdapter(collection),
      input: this.#graph.newInput<KeyValue<string, IvmContext>>(),
      previous: new Map()
    }));

    if (this.#sources.length > 0) {
      this.#compile();
    }

    this.#graph.finalize();
  }

  evaluate(): ReadonlyArray<TResult> {
    for (const source of this.#sources) {
      source.source.version().get();
      this.#syncSource(source);
    }

    this.#graph.run();
    const rows = Array.from(this.#rows.values());
    if (this.builder.orders.length > 0) {
      rows.sort((left, right) => compareValue(left.order, right.order));
    }

    return projectQueryContexts(
      this.builder,
      rows.map((row) => row.context),
      {
        filter: false,
        order: this.builder.orders.length === 0,
        window: this.builder.orders.length === 0
      }
    );
  }

  #compile(): void {
    const joinAliases = new Set(this.builder.joins.map((join) => join.alias));
    const sourceByAlias = new Map(this.#sources.map((source) => [source.alias, source]));
    const baseSources = this.builder.joins.length === 0
      ? this.#sources
      : this.#sources.filter((source) => !joinAliases.has(source.alias));
    const first = baseSources[0];
    if (!first) {
      return;
    }

    let stream: IStreamBuilder<KeyValue<string, IvmContext>> = first.input;
    for (const source of baseSources.slice(1)) {
      stream = stream.pipe(
        ivmInnerJoin(source.input),
        ivmMap(([_, pair]) => {
          const [left, right] = pair;
          return [crossJoinKey, mergeContexts(left, right)] satisfies KeyValue<string, IvmContext>;
        })
      ) as IStreamBuilder<KeyValue<string, IvmContext>>;
    }

    for (const join of this.builder.joins) {
      const source = sourceByAlias.get(join.alias);
      if (!source) {
        throw new UnsupportedLiveQuery({ reason: `Join source "${join.alias}" is not registered.` });
      }

      const keyedLeft = stream.pipe(
        ivmMap(([_, context]) =>
          [joinKey(evaluateQueryOperation("join", () => join.leftKey(context))), context] satisfies KeyValue<string, IvmContext>
        )
      );
      const keyedRight = source.input.pipe(
        ivmFlatMap(([_, context]) => {
          const row = context[join.alias] as AnyCollectionRow;
          return evaluateQueryOperation("join", () => join.rightKeys(row)).map((rightKey) =>
            [joinKey(rightKey), context] satisfies KeyValue<string, IvmContext>
          );
        })
      );

      stream = keyedLeft.pipe(
        ivmInnerJoin(keyedRight),
        ivmMap(([_, pair]) => {
          const [left, right] = pair;
          return [crossJoinKey, mergeContexts(left, right)] satisfies KeyValue<string, IvmContext>;
        })
      ) as IStreamBuilder<KeyValue<string, IvmContext>>;
    }

    let resultStream: IStreamBuilder<KeyValue<string, TContext>>;
    if (this.builder.grouping) {
      const grouping = wrapIvmGrouping(this.builder.grouping as AnyQueryGrouping);
      resultStream = stream.pipe(
        ivmFilter(([_, context]) =>
          grouping.sourceFilters.every((filter) => filter(context))
        ),
        ivmMap(([_, context]) => context as AnyQueryContext),
        ivmGroupBy(grouping.key, grouping.aggregates),
        ivmFilter(([_, group]) =>
          this.builder.filters.every((filter) =>
            evaluateQueryOperation("filter", () => filter(group as TContext))
          )
        ),
        ivmMap(([key, group]) =>
          [key, group as TContext] satisfies KeyValue<string, TContext>
        )
      );
    } else {
      resultStream = stream.pipe(
        ivmFilter(([_, context]) =>
          this.builder.filters.every((filter) =>
            evaluateQueryOperation("filter", () => filter(context as TContext))
          )
        ),
        ivmMap(([_, context]) =>
          [queryContextIdentityOf(context) ?? crossJoinKey, context as TContext] satisfies KeyValue<string, TContext>
        )
      );
    }

    let outputStream: IStreamBuilder<KeyValue<string, IvmOutputRow<TContext>>>;
    if (this.builder.orders.length > 0) {
      const orderOptions = {
        comparator: compareIvmContexts(this.builder.orders) as (left: unknown, right: unknown) => number,
        offset: this.builder.offsetCount,
        ...(this.builder.limitCount === undefined ? {} : { limit: this.builder.limitCount })
      };
      outputStream = resultStream.pipe(
        ivmOrderByWithFractionalIndex(
          (context) => context,
          orderOptions
        ),
        ivmMap(([key, [context, order]]) =>
          [key, { context, order }] satisfies KeyValue<string, IvmOutputRow<TContext>>
        )
      );
    } else {
      outputStream = resultStream.pipe(
        ivmMap(([key, context]) =>
          [key, { context, order: undefined }] satisfies KeyValue<string, IvmOutputRow<TContext>>
        )
      );
    }

    outputStream.pipe(ivmOutput((data) => this.#applyOutput(data)));
  }

  #applyOutput(data: MultiSet<KeyValue<string, IvmOutputRow<TContext>>>): void {
    const changes = new Map<string, {
      count: number;
      positive: IvmOutputRow<TContext> | undefined;
    }>();

    for (const [[key, row], multiplicity] of data.getInner()) {
      const existing = changes.get(key) ?? { count: 0, positive: undefined };
      changes.set(key, {
        count: existing.count + multiplicity,
        positive: multiplicity > 0 ? row : existing.positive
      });
    }

    for (const [key, change] of changes) {
      const existing = this.#rows.get(key);
      const nextCount = (existing?.count ?? 0) + change.count;
      if (nextCount <= 0) {
        this.#rows.delete(key);
      } else {
        const row = change.positive ?? existing;
        if (row) {
          this.#rows.set(key, {
            context: row.context,
            count: nextCount,
            order: row.order
          });
        }
      }
    }
  }

  #syncSource(source: IvmSource): void {
    const current = new Map<string, { readonly row: AnyCollectionRow; readonly hash: string }>();
    const deltas: Array<[KeyValue<string, IvmContext>, number]> = [];

    for (const row of source.source.rows()) {
      const key = queryCollectionRowIdentity(row.$key);
      const hash = stableStringify(row);
      const previous = source.previous.get(key);
      current.set(key, { row, hash });

      if (!previous) {
        deltas.push([sourceContext(source.alias, row), 1]);
        continue;
      }

      if (previous.hash !== hash) {
        deltas.push([sourceContext(source.alias, previous.row), -1]);
        deltas.push([sourceContext(source.alias, row), 1]);
      }
    }

    for (const [key, previous] of source.previous) {
      if (!current.has(key)) {
        deltas.push([sourceContext(source.alias, previous.row), -1]);
      }
    }

    source.previous.clear();
    for (const [key, row] of current) {
      source.previous.set(key, row);
    }

    if (deltas.length > 0) {
      source.input.sendData(new MultiSet(deltas));
    }
  }
}

const sourceContext = (
  alias: string,
  row: AnyCollectionRow
): KeyValue<string, IvmContext> => [
  crossJoinKey,
  querySourceContext(alias, row)
];

const mergeContexts = (left: IvmContext | null, right: IvmContext | null): IvmContext =>
  mergeQueryContextRecords(left, right);

export const makeLiveQueryRuntime = <TContext extends AnyQueryContext, TResult>(
  builder: LiveQueryRuntimeBuilder<TContext, TResult>
): LiveQueryRuntime<TResult> => {
  validateQueryExecutionPlan(builder);
  return new IvmLiveQueryRuntime(builder);
};
