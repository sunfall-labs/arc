import { Equal } from "effect";
import { AsyncResult } from "effect/reactivity";
import { resourceRowKey, resourceRowPositions, type ResourceRowsOptions } from "./resource-rows.js";

/**
 * Structural sharing for Resource values: the one way a reloaded,
 * hydrated, or patched value replaces the one readers already hold.
 *
 * `share(previous, next)` returns a value equal to `next` that reuses every
 * part of `previous` it can: a subtree deep-equal to its previous version is
 * that previous object, and when nothing changed at all the result is
 * `previous` itself. A container whose parts are all fresh or all reused is
 * returned as-is, so `next` is copied only to splice reused parts into it.
 *
 * Plain objects and arrays are walked; anything else (Dates, Maps, Sets,
 * Schema and Data classes) is kept when it has the same prototype and
 * `Equal.equals` it, Effect's structural equality. A family with `rows`
 * matches its top-level rows by key instead of position, so a row keeps its
 * identity when rows are inserted, removed, or reordered around it.
 */
export type ResourceValueSharing = <A>(previous: A, next: A) => A;

type AnyRowsOptions = ResourceRowsOptions<any, any, any, any, any>;

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasOwn = Object.prototype.hasOwnProperty;

const shareValue = (previous: unknown, next: unknown): unknown => {
  if (Object.is(previous, next)) {
    return previous;
  }
  if (
    typeof previous !== "object" ||
    typeof next !== "object" ||
    previous === null ||
    next === null
  ) {
    return next;
  }
  if (Array.isArray(previous)) {
    return Array.isArray(next)
      ? shareItems(previous, next, (_, index) =>
          index < previous.length ? { found: true, value: previous[index] } : notFound,
        )
      : next;
  }
  if (Array.isArray(next)) {
    return next;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    return shareRecord(previous as Record<string, unknown>, next as Record<string, unknown>);
  }
  return Object.getPrototypeOf(previous) === Object.getPrototypeOf(next) &&
    Equal.equals(previous, next)
    ? previous
    : next;
};

const notFound = { found: false, value: undefined } as const;

type Match = { readonly found: boolean; readonly value: unknown };

/** Shares each item of `next` with the previous item `match` pairs it with. */
const shareItems = (
  previous: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
  match: (item: unknown, index: number) => Match,
): ReadonlyArray<unknown> => {
  let same = previous.length === next.length;
  let copy: Array<unknown> | undefined;
  for (let index = 0; index < next.length; index++) {
    const item = next[index];
    // An item already in place (an optimistic patch, a rows change) needs no match.
    let shared = item;
    if (index >= previous.length || item !== previous[index]) {
      const before = match(item, index);
      shared = before.found ? shareValue(before.value, item) : item;
    }
    if (shared !== previous[index]) {
      same = false;
    }
    if (copy === undefined && shared !== item) {
      copy = next.slice(0, index);
    }
    copy?.push(shared);
  }
  return same ? previous : (copy ?? next);
};

const shareRecord = (
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> => {
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(previous).length;
  let copy: Record<string, unknown> | undefined;
  for (const key of keys) {
    const item = next[key];
    const found = hasOwn.call(previous, key);
    const shared = found ? shareValue(previous[key], item) : item;
    if (!found || shared !== previous[key]) {
      same = false;
    }
    if (shared !== item) {
      copy ??= Object.assign(Object.create(Object.getPrototypeOf(next)), next);
      copy![key] = shared;
    }
  }
  return same ? previous : (copy ?? next);
};

/** Structural sharing for plain values: position matches array items. */
export const shareResourceValue: ResourceValueSharing = (previous, next) =>
  shareValue(previous, next) as typeof next;

/**
 * Structural sharing for a family's values: with `rows`, the top-level rows
 * array matches rows by key; anything else matches by position.
 */
export const resourceValueSharing = (
  name: string,
  rows: AnyRowsOptions | undefined,
): ResourceValueSharing =>
  rows === undefined
    ? shareResourceValue
    : <A>(previous: A, next: A): A => {
        if (Object.is(previous, next) || !Array.isArray(previous) || !Array.isArray(next)) {
          return shareResourceValue(previous, next);
        }
        return shareItems(previous, next, (row) => {
          // Cached by array identity, so only the first moved row builds it.
          const position = resourceRowPositions(name, rows, previous).get(
            resourceRowKey(name, rows, row),
          );
          return position === undefined ? notFound : { found: true, value: previous[position] };
        }) as A;
      };

/**
 * Shares a next result's value with the value `previous` shows. Only a
 * success carries a fresh value: a failure keeps its previous success and
 * an initial result has none.
 */
export const shareResourceResult = <A, E>(
  share: ResourceValueSharing,
  previous: AsyncResult.AsyncResult<A, E>,
  next: AsyncResult.AsyncResult<A, E>,
): AsyncResult.AsyncResult<A, E> => {
  if (next._tag !== "Success" || previous === next) {
    return next;
  }
  const before = AsyncResult.value(previous);
  if (before._tag === "None") {
    return next;
  }
  const value = share(before.value, next.value);
  return value === next.value
    ? next
    : AsyncResult.success(value, { timestamp: next.timestamp, waiting: next.waiting });
};
