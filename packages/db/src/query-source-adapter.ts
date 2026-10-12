import { Resource, type Signal } from "@sunfall/arc-core";
import {
  currentResourceStore,
  resourceEntry,
  resourceRowIndexBucket,
  resourceRowKey,
  resourceRowsIndex,
  type MutableResourceStore,
} from "@sunfall/arc-core/internal";
import { Effect, Option } from "effect";
import { recordQueryRowKey } from "./query-context-identity.js";
import { AsyncResult } from "effect/reactivity";
import { UnsupportedLiveQuery } from "./query-plan.js";

/** A Resource ref whose family declares `rows`: what queries read. */
export type QuerySource = Resource.RowsRef;

/** One source row with the key its Resource's `rows.key` gives it. */
export interface QueryKeyedRow {
  readonly key: Resource.RowKey;
  readonly row: unknown;
}

let storeOverride: MutableResourceStore | undefined;

/** The Resource Store queries read rows from: an explicit one, else the current runtime's. */
export const currentQueryStore = (): MutableResourceStore =>
  storeOverride ?? currentResourceStore();

/** Runs `evaluate` reading query sources from `store`. */
export const runWithQueryStore = <A>(store: MutableResourceStore, evaluate: () => A): A => {
  const previous = storeOverride;
  storeOverride = store;
  try {
    return evaluate();
  } finally {
    storeOverride = previous;
  }
};

const keyedRows = new WeakMap<ReadonlyArray<unknown>, ReadonlyArray<QueryKeyedRow>>();
const emptyRows: ReadonlyArray<never> = Object.freeze([]);

/**
 * Internal Adapter from a rows Resource ref to a query-readable source.
 *
 * The Query Builder and Live Query Runtime depend on this Interface instead
 * of knowing how a Resource entry stores its rows, indexes, and load state.
 * Rows are the entry's visible value: optimistic row patches included.
 */
export interface QuerySourceAdapter {
  readonly source: QuerySource;
  readonly name: string;
  /** The entry's load result (tracked). */
  result(): AsyncResult.AsyncResult<unknown, unknown>;
  /** The current rows array (tracked); its identity changes whenever a row does. */
  rows(): ReadonlyArray<unknown>;
  /** The current rows with their keys, cached per rows array. */
  entries(): ReadonlyArray<QueryKeyedRow>;
  rowCount(): number;
  hasIndex(index: string): boolean;
  indexRows(index: string, value: unknown): ReadonlyArray<unknown>;
  /** Bucket values a row has in `index`, for indexed joins. */
  indexJoinKeys(index: string, row: unknown): ReadonlyArray<unknown>;
  preload(force: boolean): Effect.Effect<void, any, any>;
}

const rowsOptions = (source: QuerySource): NonNullable<Resource.AnyFamily["options"]["rows"]> => {
  const rows = source.family.options.rows;
  if (rows === undefined) {
    throw new UnsupportedLiveQuery({
      reason: `Query source "${source.family.options.name}" is a Resource without \`rows\`.`,
    });
  }
  return rows;
};

export const makeQuerySourceAdapter = (source: QuerySource): QuerySourceAdapter => {
  const name = source.family.options.name;
  const options = rowsOptions(source);
  const signal = (): Signal.Readable<AsyncResult.AsyncResult<unknown, unknown>> =>
    resourceEntry(source, currentQueryStore()).state;
  const rows = (): ReadonlyArray<unknown> => {
    const value = AsyncResult.value(signal().get());
    return Option.isSome(value) && Array.isArray(value.value)
      ? (value.value as ReadonlyArray<unknown>)
      : emptyRows;
  };
  return {
    source,
    name,
    result: () => signal().get(),
    rows,
    entries: () => {
      const current = rows();
      let entries = keyedRows.get(current);
      if (entries === undefined) {
        entries = current.map((row) => {
          const key = resourceRowKey(name, options, row);
          recordQueryRowKey(row, key);
          return { key, row };
        });
        keyedRows.set(current, entries);
      }
      return entries;
    },
    rowCount: () => rows().length,
    hasIndex: (index) =>
      (options.indexes as Record<string, unknown> | undefined)?.[index] !== undefined,
    indexRows: (index, value) => resourceRowsIndex(name, options, rows(), index, value),
    indexJoinKeys: (index, row) => {
      const select = (options.indexes as Record<string, (row: unknown) => unknown>)[index]!;
      const result = select(row);
      const values = Array.isArray(result) ? result : [result];
      for (const value of values) {
        resourceRowIndexBucket(value, `Query.joinIndexed(${name}).${index}`);
      }
      return values;
    },
    preload: (force) => Effect.asVoid(force ? Resource.refresh(source) : Resource.preload(source)),
  };
};
