import type { EffectInputCallbackError } from "@effect-ui/core";
import { Effect } from "effect";
import { CollectionDefinitionSnapshotTypeId } from "./collection-ids.js";
import type {
  AnyCollection,
  CollectionDefinition,
  CollectionHydrateOptions,
  CollectionKey,
  CollectionSnapshot,
  CollectionStoreEvent,
} from "./collection-contract.js";
import { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";
import { withCollectionDurableCommitPermit } from "./collection-write-commit.js";
import type { CollectionState } from "./collection-state.js";

/**
 * Store operations needed by persistence and store-explicit snapshot adapters.
 *
 * Implementations are runtime/request-local so dehydration, persistence, and
 * derived live-query collections never read another runtime's collection rows.
 */
export interface CollectionPersistenceStore {
  state(definition: AnyCollection): CollectionState<any, any, any>;
  state<A extends object, K extends CollectionKey, E, R>(
    definition: CollectionDefinition<A, K, E, R>,
  ): CollectionState<A, K, E>;
  publish(event: CollectionStoreEvent): Effect.Effect<void>;
}

/**
 * Collection Definition extension for snapshots that must use a supplied store.
 *
 * A marked definition must provide all store-explicit methods. Missing implementations
 * fail with `CollectionSnapshotCodecError` instead of falling back to the
 * ambient store.
 */
export interface StoreExplicitCollectionSnapshotDefinition<
  A extends object = object,
  K extends CollectionKey = CollectionKey,
> {
  readonly [CollectionDefinitionSnapshotTypeId]: typeof CollectionDefinitionSnapshotTypeId;
  readonly snapshotWithStore: (
    store: CollectionPersistenceStore,
    updatedAt: number,
  ) => CollectionSnapshot<A, K>;
  readonly snapshotWithStoreEffect: (
    store: CollectionPersistenceStore,
    updatedAt: number,
  ) => Effect.Effect<
    CollectionSnapshot<A, K>,
    CollectionSnapshotCodecError | EffectInputCallbackError
  >;
  readonly hydratePreflightEffect: (
    snapshot: CollectionSnapshot<A, K>,
    options: CollectionHydrateOptions,
  ) => Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
  readonly hydrateWithStoreEffect: (
    store: CollectionPersistenceStore,
    snapshot: CollectionSnapshot<A, K>,
    options: CollectionHydrateOptions,
  ) => Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError>;
  readonly durableSnapshotSources?: () => ReadonlyArray<AnyCollection>;
}

/** Implementation fields required before the non-enumerable marker is applied. */
export type StoreExplicitCollectionSnapshotImplementation<
  A extends object = object,
  K extends CollectionKey = CollectionKey,
> = Omit<
  StoreExplicitCollectionSnapshotDefinition<A, K>,
  typeof CollectionDefinitionSnapshotTypeId
>;

/** Marks a Collection Definition as requiring store-explicit snapshot dispatch. */
export function markStoreExplicitCollectionSnapshotDefinition<Definition extends object>(
  definition: Definition,
): asserts definition is Definition & {
  readonly [CollectionDefinitionSnapshotTypeId]: typeof CollectionDefinitionSnapshotTypeId;
} {
  Object.defineProperty(definition, CollectionDefinitionSnapshotTypeId, {
    value: CollectionDefinitionSnapshotTypeId,
    enumerable: false,
  });
}

/** Checks only for the marker; callers should still validate implementation fields. */
export const hasStoreExplicitCollectionSnapshotMarker = (definition: AnyCollection): boolean =>
  (
    definition as {
      readonly [CollectionDefinitionSnapshotTypeId]?: unknown;
    }
  )[CollectionDefinitionSnapshotTypeId] === CollectionDefinitionSnapshotTypeId;

/** Checks that a marked Collection Definition has the full store-explicit Interface. */
export const isStoreExplicitCollectionSnapshotDefinition = (
  definition: AnyCollection,
): definition is AnyCollection & StoreExplicitCollectionSnapshotDefinition =>
  hasStoreExplicitCollectionSnapshotMarker(definition) &&
  typeof (definition as Partial<StoreExplicitCollectionSnapshotImplementation>)
    .snapshotWithStore === "function" &&
  typeof (definition as Partial<StoreExplicitCollectionSnapshotImplementation>)
    .snapshotWithStoreEffect === "function" &&
  typeof (definition as Partial<StoreExplicitCollectionSnapshotImplementation>)
    .hydratePreflightEffect === "function" &&
  typeof (definition as Partial<StoreExplicitCollectionSnapshotImplementation>)
    .hydrateWithStoreEffect === "function";

const missingStoreExplicitSnapshotMethods = (definition: AnyCollection): readonly string[] => {
  const candidate = definition as Partial<StoreExplicitCollectionSnapshotImplementation>;
  return [
    ...(typeof candidate.snapshotWithStore === "function" ? [] : ["snapshotWithStore"]),
    ...(typeof candidate.snapshotWithStoreEffect === "function" ? [] : ["snapshotWithStoreEffect"]),
    ...(typeof candidate.hydratePreflightEffect === "function" ? [] : ["hydratePreflightEffect"]),
    ...(typeof candidate.hydrateWithStoreEffect === "function" ? [] : ["hydrateWithStoreEffect"]),
  ];
};

const incompleteStoreExplicitSnapshotError = (
  definition: AnyCollection,
  operation: "hydrate" | "snapshot",
): CollectionSnapshotCodecError =>
  new CollectionSnapshotCodecError({
    operation,
    path: "$",
    reason: `Collection "${definition.name}" is marked as owning store-explicit snapshots but is missing ${missingStoreExplicitSnapshotMethods(
      definition,
    ).join(", ")}.`,
  });

const requireStoreExplicitCollectionSnapshotDefinition = (
  definition: AnyCollection,
  operation: "hydrate" | "snapshot",
): AnyCollection & StoreExplicitCollectionSnapshotDefinition => {
  if (isStoreExplicitCollectionSnapshotDefinition(definition)) {
    return definition;
  }
  throw incompleteStoreExplicitSnapshotError(definition, operation);
};

const requireStoreExplicitCollectionSnapshotDefinitionEffect = (
  definition: AnyCollection,
  operation: "hydrate" | "snapshot",
): Effect.Effect<
  AnyCollection & StoreExplicitCollectionSnapshotDefinition,
  CollectionSnapshotCodecError
> =>
  isStoreExplicitCollectionSnapshotDefinition(definition)
    ? Effect.succeed(definition)
    : Effect.fail(incompleteStoreExplicitSnapshotError(definition, operation));

/** Runs the synchronous store-explicit snapshot implementation. */
export const snapshotStoreExplicitCollection = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number,
): CollectionSnapshot<any, any> =>
  requireStoreExplicitCollectionSnapshotDefinition(definition, "snapshot").snapshotWithStore(
    store,
    updatedAt,
  );

/** Runs the Effect-backed store-explicit snapshot implementation. */
export const snapshotStoreExplicitCollectionEffect = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  updatedAt: number,
): Effect.Effect<
  CollectionSnapshot<any, any>,
  CollectionSnapshotCodecError | EffectInputCallbackError
> =>
  Effect.gen(function* () {
    const snapshotDefinition = yield* requireStoreExplicitCollectionSnapshotDefinitionEffect(
      definition,
      "snapshot",
    );
    return yield* snapshotDefinition.snapshotWithStoreEffect(store, updatedAt);
  });

/** Runs hydrate preflight for a store-explicit snapshot definition. */
export const hydrateStoreExplicitCollectionSnapshotPreflightEffect = (
  definition: AnyCollection,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const snapshotDefinition = yield* requireStoreExplicitCollectionSnapshotDefinitionEffect(
      definition,
      "hydrate",
    );
    yield* snapshotDefinition.hydratePreflightEffect(snapshot, options);
  });

/** Runs hydrate application for a store-explicit snapshot definition. */
export const hydrateStoreExplicitCollectionSnapshotEffect = (
  definition: AnyCollection,
  store: CollectionPersistenceStore,
  snapshot: CollectionSnapshot<any, any>,
  options: CollectionHydrateOptions,
): Effect.Effect<void, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const snapshotDefinition = yield* requireStoreExplicitCollectionSnapshotDefinitionEffect(
      definition,
      "hydrate",
    );
    yield* snapshotDefinition.hydratePreflightEffect(snapshot, options);
    yield* snapshotDefinition.hydrateWithStoreEffect(store, snapshot, options);
  });

export const collectionDurableSnapshotSources = (
  definition: AnyCollection,
): ReadonlyArray<AnyCollection> => {
  const visited = new Set<AnyCollection>();
  const sources: AnyCollection[] = [];

  const visit = (current: AnyCollection): void => {
    if (visited.has(current)) {
      return;
    }
    visited.add(current);

    const explicit = current as Partial<StoreExplicitCollectionSnapshotDefinition>;
    if (
      hasStoreExplicitCollectionSnapshotMarker(current) &&
      typeof explicit.durableSnapshotSources === "function"
    ) {
      for (const source of explicit.durableSnapshotSources()) {
        visit(source);
      }
      return;
    }

    sources.push(current);
  };

  visit(definition);
  return sources;
};

const durableSnapshotSourceOrder = new WeakMap<AnyCollection, number>();
let nextDurableSnapshotSourceOrder = 0;

const durableSnapshotSourceOrderOf = (definition: AnyCollection): number => {
  const existing = durableSnapshotSourceOrder.get(definition);
  if (existing !== undefined) {
    return existing;
  }

  const order = nextDurableSnapshotSourceOrder++;
  durableSnapshotSourceOrder.set(definition, order);
  return order;
};

/**
 * Plans the concrete writable sources whose durable commit permits protect a
 * snapshot payload.
 *
 * Store-explicit definitions such as live-query collections can expand to
 * transitive source collections. The returned sources are deduped by
 * definition identity and sorted deterministically so unrelated callers cannot
 * acquire the same permits in opposite order.
 */
export const collectionDurableSnapshotPermitSources = (
  definitions: Iterable<AnyCollection>,
): ReadonlyArray<AnyCollection> => {
  const sources = new Set<AnyCollection>();
  for (const definition of definitions) {
    for (const source of collectionDurableSnapshotSources(definition)) {
      sources.add(source);
    }
  }

  return Array.from(sources).sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName === 0
      ? durableSnapshotSourceOrderOf(left) - durableSnapshotSourceOrderOf(right)
      : byName;
  });
};

/** Acquires all durable snapshot permits for a payload using the shared plan. */
export const withCollectionDurableSnapshotPermits = <A, E, R>(
  store: CollectionPersistenceStore,
  definitions: Iterable<AnyCollection>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  collectionDurableSnapshotPermitSources(definitions).reduceRight(
    (current, source) => withCollectionDurableCommitPermit(store.state(source), current),
    effect,
  );
