import { isEffectLike } from "@effect-ui/core";
import { Data } from "effect";
import type {
  CollectionKey,
  CollectionMutation,
  CollectionOrigin,
  CollectionRow,
  CollectionTransaction,
  CollectionUpdate
} from "./collection-contract.js";

export interface CollectionExecutableValuePath {
  readonly path: string;
  readonly reason: "PromiseLikeValue" | "EffectLikeValue";
}

export class CollectionValueReadError extends Data.TaggedError("CollectionValueReadError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

const collectionValuePathSegment = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;

const readCollectionValue = <A>(
  path: string,
  evaluate: () => A
): A => {
  try {
    return evaluate();
  } catch (cause) {
    throw new CollectionValueReadError({ path, cause });
  }
};

const isPromiseLikeCollectionValue = (value: unknown, path: string): boolean => {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }

  return typeof readCollectionValue(path, () => Reflect.get(value as object, "then")) === "function";
};

const isEffectLikeCollectionValue = (value: unknown): boolean =>
  value instanceof Error ? false : isEffectLike(value);

export const collectionExecutableValuePath = (
  value: unknown,
  path = "$",
  active = new WeakSet<object>()
): CollectionExecutableValuePath | undefined => {
  if (isPromiseLikeCollectionValue(value, path)) {
    return { path, reason: "PromiseLikeValue" };
  }
  if (isEffectLikeCollectionValue(value)) {
    return { path, reason: "EffectLikeValue" };
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
        const entryPath = `${path}[${index}]`;
        const found = collectionExecutableValuePath(
          readCollectionValue(entryPath, () => value[index]),
          entryPath,
          active
        );
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    if (value instanceof Map) {
      let index = 0;
      for (const [key, entry] of readCollectionValue(path, () => Array.from(value.entries()))) {
        const keyPath = collectionExecutableValuePath(key, `${path}.<key:${index}>`, active);
        if (keyPath !== undefined) {
          return keyPath;
        }
        const valuePath = collectionExecutableValuePath(entry, `${path}.<value:${index}>`, active);
        if (valuePath !== undefined) {
          return valuePath;
        }
        index++;
      }
      return undefined;
    }
    if (value instanceof Set) {
      let index = 0;
      for (const entry of readCollectionValue(path, () => Array.from(value.values()))) {
        const found = collectionExecutableValuePath(entry, `${path}.<value:${index}>`, active);
        if (found !== undefined) {
          return found;
        }
        index++;
      }
      return undefined;
    }
    for (const [key, entry] of readCollectionValue(path, () => Object.entries(value))) {
      const found = collectionExecutableValuePath(entry, `${path}${collectionValuePathSegment(key)}`, active);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  } finally {
    active.delete(value);
  }
};

export const cloneCollectionValue = <A>(
  value: A,
  seen = new WeakMap<object, unknown>(),
  path = "$"
): A => {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as A;
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0) as A;
  }

  const existing = seen.get(value);
  if (existing) {
    return existing as A;
  }

  if (Array.isArray(value)) {
    const output: Array<unknown> = [];
    seen.set(value, output);
    for (let index = 0; index < value.length; index++) {
      const entryPath = `${path}[${index}]`;
      output.push(cloneCollectionValue(
        readCollectionValue(entryPath, () => value[index]),
        seen,
        entryPath
      ));
    }
    return output as A;
  }

  if (value instanceof Map) {
    const output = new Map();
    seen.set(value, output);
    let index = 0;
    for (const [key, entry] of readCollectionValue(path, () => Array.from(value))) {
      output.set(
        cloneCollectionValue(key, seen, `${path}.<key:${index}>`),
        cloneCollectionValue(entry, seen, `${path}.<value:${index}>`)
      );
      index++;
    }
    return output as A;
  }

  if (value instanceof Set) {
    const output = new Set();
    seen.set(value, output);
    let index = 0;
    for (const entry of readCollectionValue(path, () => Array.from(value))) {
      output.add(cloneCollectionValue(entry, seen, `${path}.<value:${index}>`));
      index++;
    }
    return output as A;
  }

  if (value instanceof DataView) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new DataView(new Uint8Array(bytes).buffer) as A;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const copiedBytes = new Uint8Array(bytes);
    const buffer = copiedBytes.buffer.slice(
      copiedBytes.byteOffset,
      copiedBytes.byteOffset + copiedBytes.byteLength
    );
    const constructor = value.constructor as { new(buffer: ArrayBuffer): A };
    return new constructor(buffer);
  }

  const prototype = readCollectionValue(path, () => Object.getPrototypeOf(value));
  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, entry] of readCollectionValue(path, () => Object.entries(value))) {
    output[key] = cloneCollectionValue(entry, seen, `${path}${collectionValuePathSegment(key)}`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return Object.assign(Object.create(prototype), output) as A;
  }
  return output as A;
};

export const freezeCollectionValue = <A>(value: A, seen = new WeakSet<object>()): A => {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return value;
  }

  if (value instanceof Map) {
    for (const [key, entry] of value) {
      freezeCollectionValue(key, seen);
      freezeCollectionValue(entry, seen);
    }
    return Object.freeze(value);
  }

  if (value instanceof Set) {
    for (const entry of value) {
      freezeCollectionValue(entry, seen);
    }
    return Object.freeze(value);
  }

  for (const entry of Object.values(value)) {
    freezeCollectionValue(entry, seen);
  }
  return Object.freeze(value);
};

export const cloneFrozenCollectionValue = <A>(value: A): A =>
  freezeCollectionValue(cloneCollectionValue(value));

export const cloneCollectionMutation = <A extends object, K extends CollectionKey>(
  mutation: CollectionMutation<A, K>
): CollectionMutation<A, K> => {
  switch (mutation._tag) {
    case "Insert":
      return mutation.previous === undefined
        ? {
            _tag: "Insert",
            key: mutation.key,
            value: cloneCollectionValue(mutation.value)
          }
        : {
            _tag: "Insert",
            key: mutation.key,
            value: cloneCollectionValue(mutation.value),
            previous: cloneCollectionValue(mutation.previous)
          };
    case "Update":
      return {
        _tag: "Update",
        key: mutation.key,
        previous: cloneCollectionValue(mutation.previous),
        value: cloneCollectionValue(mutation.value),
        changes: cloneCollectionValue(mutation.changes)
      };
    case "Delete":
      return {
        _tag: "Delete",
        key: mutation.key,
        previous: cloneCollectionValue(mutation.previous)
      };
  }
};

export const cloneCollectionTransaction = <A extends object, K extends CollectionKey>(
  transaction: CollectionTransaction<A, K>
): CollectionTransaction<A, K> => ({
  id: transaction.id,
  collection: transaction.collection,
  mutations: transaction.mutations.map(cloneCollectionMutation)
});

export const cloneFrozenCollectionTransaction = <A extends object, K extends CollectionKey>(
  transaction: CollectionTransaction<A, K>
): CollectionTransaction<A, K> =>
  cloneFrozenCollectionValue(cloneCollectionTransaction(transaction));

export const detachCollectionRow = <A extends object, K extends CollectionKey>(options: {
  readonly collection: string;
  readonly key: K;
  readonly value: A;
  readonly synced: boolean;
  readonly origin: CollectionOrigin;
}): CollectionRow<A, K> =>
  Object.assign(cloneCollectionValue(options.value), {
    $key: options.key,
    $collection: options.collection,
    $synced: options.synced,
    $origin: options.origin
  }) as CollectionRow<A, K>;

export const collectionValueChanges = <A extends object>(previous: A, value: A): Partial<A> => {
  const changes: Partial<A> = {};
  for (const key of Object.keys(value) as Array<keyof A>) {
    if (!Object.is(previous[key], value[key])) {
      changes[key] = value[key];
    }
  }
  return changes;
};

export const applyCollectionUpdate = <A extends object>(previous: A, update: CollectionUpdate<A>): {
  readonly value: A;
  readonly changes: Partial<A>;
} => {
  if (typeof update === "function") {
    const draft = cloneCollectionValue(previous);
    const result = update(draft);
    const value = cloneCollectionValue(result === undefined ? draft : result);
    return {
      value,
      changes: collectionValueChanges(previous, value)
    };
  }

  return {
    value: cloneCollectionValue({ ...previous, ...update }),
    changes: cloneCollectionValue(update)
  };
};
