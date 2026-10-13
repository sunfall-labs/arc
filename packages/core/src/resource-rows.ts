import type { Stream } from "effect";
import { EffectInputCallbackError } from "./effect-like.js";
import { stableStringify } from "./stable-stringify.js";

/** Stable identity of one row: what `rows.key` returns. */
export type ResourceRowKey = string | number;

/** Scalar a rows index maps a row to; Dates must be valid. */
export type ResourceRowIndexValue = string | number | boolean | Date | null | undefined;

/** One bucket value, or several when a row belongs to more than one bucket. */
export type ResourceRowIndexResult = ResourceRowIndexValue | ReadonlyArray<ResourceRowIndexValue>;

/** Named secondary indexes over a Resource's rows. */
export type ResourceRowIndexes<Row> = Record<string, (row: Row) => ResourceRowIndexResult>;

/** One row change from a remote feed (`rows.changes`), applied to the synced rows. */
export type ResourceRowChange<Row, Key extends ResourceRowKey = ResourceRowKey> =
  | { readonly _tag: "Upsert"; readonly value: Row }
  | { readonly _tag: "Update"; readonly key: Key; readonly changes: Partial<Row> }
  | { readonly _tag: "Delete"; readonly key: Key };

/**
 * The `rows` option of `Resource.define`, for a family whose output is an
 * array: how to key its rows and which indexes to look them up by.
 *
 * Rows are derived from the loaded value, never stored twice: the value stays
 * the one cached, hydrated, and persisted copy. A reload replaces the rows,
 * and the reload shares structure with the previous rows by key: a row equal
 * to its previous version keeps its object identity.
 */
export interface ResourceRowsOptions<
  I,
  Row,
  Key extends ResourceRowKey = ResourceRowKey,
  Indexes extends ResourceRowIndexes<Row> = ResourceRowIndexes<Row>,
  ChangesR = never,
> {
  /** Stable row identity; it must not change across loads of the same row. */
  readonly key: (row: Row) => Key;
  /**
   * Named indexes: each maps a row to the bucket value (or values) the
   * reader's `index(input, name, value)` looks it up by.
   */
  readonly indexes?: Indexes;
  /**
   * Remote change feed for one input. The first successful load of an entry
   * starts it on the runtime's Resource Store, and each batch applies to the
   * synced rows (optimistic patches stay on top). A typed failure restarts
   * the feed with backoff from the rows the entry holds, until it recovers; a
   * defect stops it, and the rows keep their last value. The entry's
   * `ResourceFeedStatus` reports which.
   *
   * `rows` are the synced rows the feed starts from (the loaded or hydrated
   * value), so a feed can resume from what they already hold: a cursor such
   * as the newest version or timestamp among them.
   */
  readonly changes?: (
    input: I,
    rows: ReadonlyArray<Row>,
  ) => Stream.Stream<ReadonlyArray<ResourceRowChange<Row, Key>>, unknown, ChangesR>;
}

/**
 * Type-level record of a family's rows: row type, key type, indexes, and
 * whether it declares a `rows.changes` feed.
 */
export interface ResourceRowsSpec<
  Row,
  Key extends ResourceRowKey,
  Indexes,
  Feed extends boolean = boolean,
> {
  readonly row: Row;
  readonly key: Key;
  readonly indexes: Indexes;
  readonly feed: Feed;
}

/**
 * Where one entry's `rows.changes` feed is. `Idle`: not running (no value
 * yet, or a server render, which never follows feeds). `Following`: running.
 * `Retrying`: failed with a typed failure and restarts after a backoff, until
 * it recovers; `attempt` counts restarts from 1. `Stopped`: a defect ended
 * it; the rows keep their last value until the entry is evicted and loaded
 * again.
 */
export type ResourceFeedStatus =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Following" }
  | { readonly _tag: "Retrying"; readonly attempt: number }
  | { readonly _tag: "Stopped"; readonly reason: "Defect" };

/** Type-only brand carrying a ref's `ResourceRowsSpec`. */
export declare const ResourceRowsTypeId: unique symbol;

/** A Resource ref whose family declares `rows`: Actions patch its rows by key. */
export interface ResourceRowsBrand<Spec> {
  readonly [ResourceRowsTypeId]: Spec;
}

/** Element type of an array output; a non-array output is its own (rejected) element. */
export type ResourceRowElement<A> = A extends ReadonlyArray<infer Row> ? Row : A;

/** The value an index bucket is looked up by, from the index's selector. */
export type ResourceRowIndexLookup<F> = F extends (row: any) => infer V
  ? V extends ReadonlyArray<infer Item>
    ? Item
    : V
  : never;

/**
 * Readable type error: `rows` needs a family whose `output` is an array.
 */
export interface ResourceRowsNeedArrayOutput<Output> {
  readonly "~resource-rows": "`rows` needs an `output` that is an array of rows";
  readonly output: Output;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

type AnyRowsOptions = ResourceRowsOptions<any, any, any, any, any>;
type AnyRow = any;

const keyGuidance =
  "`rows.key` must return a string or number synchronously, and the same key for the same row across loads.";
const indexGuidance =
  "`rows.indexes` selectors must return a string, number, boolean, valid Date, null, undefined, or an array of those.";

const rowsDefect = (
  operation: string,
  cause: unknown,
  guidance: string,
): EffectInputCallbackError =>
  cause instanceof EffectInputCallbackError
    ? cause
    : new EffectInputCallbackError({ operation, cause, guidance });

/** The key of `row`; a callback that throws or returns a non-key is a defect. */
export const resourceRowKey = (name: string, rows: AnyRowsOptions, row: AnyRow): ResourceRowKey => {
  let key: unknown;
  try {
    key = rows.key(row);
  } catch (cause) {
    throw rowsDefect(`Resource.rows.key(${name})`, cause, keyGuidance);
  }
  if (typeof key !== "string" && (typeof key !== "number" || !Number.isFinite(key))) {
    throw rowsDefect(
      `Resource.rows.key(${name})`,
      new TypeError(`rows.key returned ${typeof key}, not a string or finite number.`),
      keyGuidance,
    );
  }
  return key;
};

const isIndexScalar = (value: unknown): value is ResourceRowIndexValue =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (value instanceof Date && Number.isFinite(value.getTime()));

/** The bucket key an index value is stored under. */
export const resourceRowIndexBucket = (value: unknown, operation: string): string => {
  if (!isIndexScalar(value)) {
    throw rowsDefect(
      operation,
      new TypeError("An index value must be a scalar (or a valid Date)."),
      indexGuidance,
    );
  }
  return value instanceof Date ? `Date:${value.toISOString()}` : stableStringify(value);
};

const indexBuckets = (
  name: string,
  index: string,
  select: (row: AnyRow) => ResourceRowIndexResult,
  row: AnyRow,
): ReadonlyArray<string> => {
  const operation = `Resource.rows.indexes.${index}(${name})`;
  let result: ResourceRowIndexResult;
  try {
    result = select(row);
  } catch (cause) {
    throw rowsDefect(operation, cause, indexGuidance);
  }
  if (!Array.isArray(result)) {
    return [resourceRowIndexBucket(result, operation)];
  }
  const buckets: Array<string> = [];
  for (const value of result) {
    const bucket = resourceRowIndexBucket(value, operation);
    if (!buckets.includes(bucket)) {
      buckets.push(bucket);
    }
  }
  return buckets;
};

/**
 * Lookup structures for one rows array, built lazily and cached by array
 * identity. An array is never mutated after it is shown, so a view stays
 * valid for as long as its array lives.
 */
interface RowsView {
  /** Key to position in the array. */
  position: Map<ResourceRowKey, number> | undefined;
  /** Index name to bucket key to the bucket's rows, in array order. */
  readonly indexes: Map<string, Map<string, ReadonlyArray<AnyRow>>>;
}

const views = new WeakMap<ReadonlyArray<AnyRow>, RowsView>();

const viewOf = (rows: ReadonlyArray<AnyRow>): RowsView => {
  let view = views.get(rows);
  if (view === undefined) {
    view = { position: undefined, indexes: new Map() };
    views.set(rows, view);
  }
  return view;
};

/** Key to position in a rows array, cached by array identity. */
export const resourceRowPositions = (
  name: string,
  options: AnyRowsOptions,
  rows: ReadonlyArray<AnyRow>,
): Map<ResourceRowKey, number> => {
  const view = viewOf(rows);
  if (view.position === undefined) {
    const position = new Map<ResourceRowKey, number>();
    for (let index = 0; index < rows.length; index++) {
      position.set(resourceRowKey(name, options, rows[index]), index);
    }
    view.position = position;
  }
  return view.position;
};

/** The row with `key`, if the array has one. */
export const resourceRowsGet = (
  name: string,
  options: AnyRowsOptions,
  rows: ReadonlyArray<AnyRow>,
  key: ResourceRowKey,
): AnyRow | undefined => {
  const position = resourceRowPositions(name, options, rows).get(key);
  return position === undefined ? undefined : rows[position];
};

const indexSelector = (
  name: string,
  options: AnyRowsOptions,
  index: string,
): ((row: AnyRow) => ResourceRowIndexResult) => {
  const select = (options.indexes as ResourceRowIndexes<AnyRow> | undefined)?.[index];
  if (select === undefined) {
    throw new EffectInputCallbackError({
      operation: `Resource.rows.index(${name})`,
      cause: new TypeError(`Unknown rows index "${index}".`),
      guidance: "Read only the indexes the family declares in `rows.indexes`.",
    });
  }
  return select;
};

const bucketsOf = (
  name: string,
  options: AnyRowsOptions,
  rows: ReadonlyArray<AnyRow>,
  index: string,
): Map<string, ReadonlyArray<AnyRow>> => {
  const view = viewOf(rows);
  let buckets = view.indexes.get(index);
  if (buckets === undefined) {
    const select = indexSelector(name, options, index);
    const built = new Map<string, Array<AnyRow>>();
    for (const row of rows) {
      for (const bucket of indexBuckets(name, index, select, row)) {
        const current = built.get(bucket);
        if (current === undefined) {
          built.set(bucket, [row]);
        } else {
          current.push(row);
        }
      }
    }
    buckets = built;
    view.indexes.set(index, buckets);
  }
  return buckets;
};

const emptyRows: ReadonlyArray<never> = Object.freeze([]);

/** The rows of one index bucket, in array order. */
export const resourceRowsIndex = (
  name: string,
  options: AnyRowsOptions,
  rows: ReadonlyArray<AnyRow>,
  index: string,
  value: unknown,
): ReadonlyArray<AnyRow> =>
  bucketsOf(name, options, rows, index).get(
    resourceRowIndexBucket(value, `Resource.rows.index(${name})`),
  ) ?? emptyRows;

/**
 * Replaces the row at `position` with `next`, deriving the new array's view
 * from the old one: positions are shared (they did not change) and each
 * cached index moves only the buckets the row left or joined.
 */
const replaceRow = (
  name: string,
  options: AnyRowsOptions,
  rows: ReadonlyArray<AnyRow>,
  position: number,
  next: AnyRow,
): ReadonlyArray<AnyRow> => {
  const previous = rows[position];
  if (previous === next) {
    return rows;
  }
  const replaced = rows.slice();
  replaced[position] = next;
  const view = views.get(rows);
  if (view?.position !== undefined) {
    const derived: RowsView = { position: view.position, indexes: new Map() };
    const positions = view.position;
    const order = (left: AnyRow, right: AnyRow): number =>
      positions.get(resourceRowKey(name, options, left))! -
      positions.get(resourceRowKey(name, options, right))!;
    for (const [index, buckets] of view.indexes) {
      const select = indexSelector(name, options, index);
      const before = indexBuckets(name, index, select, previous);
      const after = indexBuckets(name, index, select, next);
      const nextBuckets = new Map(buckets);
      for (const bucket of before) {
        const current = nextBuckets.get(bucket) ?? emptyRows;
        nextBuckets.set(
          bucket,
          after.includes(bucket)
            ? current.map((row) => (row === previous ? next : row))
            : current.filter((row) => row !== previous),
        );
      }
      for (const bucket of after) {
        if (!before.includes(bucket)) {
          nextBuckets.set(bucket, [...(nextBuckets.get(bucket) ?? emptyRows), next].sort(order));
        }
      }
      derived.indexes.set(index, nextBuckets);
    }
    views.set(replaced, derived);
  }
  return replaced;
};

/** A row patch an Action layers over a Resource's rows. */
export type ResourceRowPatch<Row, Key> =
  | { readonly _tag: "Insert"; readonly values: ReadonlyArray<Row> }
  | {
      readonly _tag: "Update";
      readonly key: Key;
      readonly update: Partial<Row> | ((row: Row) => Row);
    }
  | { readonly _tag: "Delete"; readonly key: Key };

const updatedRow = (row: AnyRow, update: unknown): AnyRow =>
  typeof update === "function"
    ? (update as (row: AnyRow) => AnyRow)(row)
    : { ...row, ...(update as object) };

/**
 * Applies one row patch to a rows array, returning the array unchanged when
 * the patch touches nothing (an update or delete of a missing key). An
 * update keeps the row's position; an insert replaces a row with the same
 * key or appends.
 */
export const applyResourceRowPatch = (
  name: string,
  options: AnyRowsOptions,
  rows: ReadonlyArray<AnyRow>,
  patch: ResourceRowPatch<AnyRow, ResourceRowKey>,
): ReadonlyArray<AnyRow> => {
  switch (patch._tag) {
    case "Update": {
      const position = resourceRowPositions(name, options, rows).get(patch.key);
      if (position === undefined) {
        return rows;
      }
      const next = updatedRow(rows[position], patch.update);
      if (resourceRowKey(name, options, next) !== patch.key) {
        throw new EffectInputCallbackError({
          operation: `Resource.rows.update(${name})`,
          cause: new TypeError(`A row update changed the key of row ${String(patch.key)}.`),
          guidance: "Row updates must keep the row's key; insert a new row and delete the old one.",
        });
      }
      return replaceRow(name, options, rows, position, next);
    }
    case "Delete": {
      const position = resourceRowPositions(name, options, rows).get(patch.key);
      return position === undefined ? rows : rows.filter((_, index) => index !== position);
    }
    case "Insert": {
      let next = rows;
      for (const value of patch.values) {
        const key = resourceRowKey(name, options, value);
        const position = resourceRowPositions(name, options, next).get(key);
        next =
          position === undefined
            ? [...next, value]
            : replaceRow(name, options, next, position, value);
      }
      return next;
    }
  }
};

/** Applies a remote change batch to the synced rows. */
export const applyResourceRowChanges = (
  name: string,
  options: AnyRowsOptions,
  rows: ReadonlyArray<AnyRow>,
  changes: ReadonlyArray<ResourceRowChange<AnyRow, ResourceRowKey>>,
): ReadonlyArray<AnyRow> => {
  let next = rows;
  for (const change of changes) {
    next = applyResourceRowPatch(
      name,
      options,
      next,
      change._tag === "Upsert"
        ? { _tag: "Insert", values: [change.value] }
        : change._tag === "Update"
          ? { _tag: "Update", key: change.key, update: change.changes }
          : change,
    );
  }
  return next;
};
