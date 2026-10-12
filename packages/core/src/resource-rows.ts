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
 * and a row equal to its previous version keeps its object identity.
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
   * synced rows (optimistic patches stay on top). A failure stops the feed;
   * the rows keep their last value.
   */
  readonly changes?: (
    input: I,
  ) => Stream.Stream<ReadonlyArray<ResourceRowChange<Row, Key>>, unknown, ChangesR>;
}

/** Type-level record of a family's rows: row type, key type, and indexes. */
export interface ResourceRowsSpec<Row, Key extends ResourceRowKey, Indexes> {
  readonly row: Row;
  readonly key: Key;
  readonly indexes: Indexes;
}

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

const positionsOf = (
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
  const position = positionsOf(name, options, rows).get(key);
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
      const position = positionsOf(name, options, rows).get(patch.key);
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
      const position = positionsOf(name, options, rows).get(patch.key);
      return position === undefined ? rows : rows.filter((_, index) => index !== position);
    }
    case "Insert": {
      let next = rows;
      for (const value of patch.values) {
        const key = resourceRowKey(name, options, value);
        const position = positionsOf(name, options, next).get(key);
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

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Structural equality for row data: plain objects, arrays, Dates, and primitives. */
const sameRow = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameRow(item, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameRow((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
};

/**
 * Diffs a reloaded rows array against the previous one by key: a row equal
 * to its previous version is replaced by that previous object, so unchanged
 * rows keep their identity. When nothing changed at all the previous array
 * itself is returned.
 */
export const reconcileResourceRows = (
  name: string,
  options: AnyRowsOptions,
  previous: ReadonlyArray<AnyRow> | undefined,
  next: ReadonlyArray<AnyRow>,
): ReadonlyArray<AnyRow> => {
  if (previous === undefined || previous === next || !Array.isArray(previous)) {
    return next;
  }
  const positions = positionsOf(name, options, previous);
  let unchanged = previous.length === next.length;
  const reconciled = next.map((row, index) => {
    const position = positions.get(resourceRowKey(name, options, row));
    const before = position === undefined ? undefined : previous[position];
    if (before !== undefined && sameRow(before, row)) {
      unchanged &&= position === index;
      return before;
    }
    unchanged = false;
    return row;
  });
  return unchanged ? previous : reconciled;
};
