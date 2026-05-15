import { type AnyCollection } from "@effect-ui/db";
import { Effect } from "effect";

/** Registry shape Start can use to resolve collection names emitted by routes or hydration payloads. */
export interface StartCollectionDefinitionRegistry {
  /** Current definitions keyed by Collection name. */
  definitions(): ReadonlyMap<string, AnyCollection>;
}

/** App-local resolver used when collections are declared by stable name instead of direct definition. */
export type StartCollectionDefinitionResolver = (name: string) => AnyCollection | undefined;

/**
 * Collection resolution inputs shared by request preload and browser hydration.
 *
 * Direct `collections` win first, then `resolveCollection`, then an explicit
 * registry. Start intentionally does not consult the process-wide DB registry
 * unless callers pass it, so request and client hydration stay app-local.
 */
export interface StartCollectionResolutionOptions {
  /** Concrete collection definitions already available to the request or client. */
  readonly collections?: Iterable<AnyCollection>;
  /** Explicit registry used to resolve route-declared or payload collection names. */
  readonly collectionRegistry?: StartCollectionDefinitionRegistry | ReadonlyMap<string, AnyCollection>;
  /** Explicit resolver used before the registry when callers need custom lookup policy. */
  readonly resolveCollection?: StartCollectionDefinitionResolver;
}

/** Prepared collection resolver plus the direct collection definitions it was built from. */
export interface StartCollectionResolution {
  /** Direct collection definitions supplied in `collections`, in iteration order. */
  readonly registeredCollections: ReadonlyArray<AnyCollection>;
  /** Resolve one stable collection name using Start's request/hydration precedence. */
  resolve(name: string): AnyCollection | undefined;
}

/** Convert optional collection iterables into a readonly array without changing definition identity. */
export const startCollectionArray = (
  collections: Iterable<AnyCollection> | undefined
): ReadonlyArray<AnyCollection> =>
  collections ? Array.from(collections) : [];

/** De-duplicate collection definitions by stable Collection name while preserving first occurrence. */
export const uniqueStartCollections = (
  collections: Iterable<AnyCollection>
): ReadonlyArray<AnyCollection> => {
  const names = new Set<string>();
  const out: Array<AnyCollection> = [];
  for (const collection of collections) {
    if (!names.has(collection.name)) {
      names.add(collection.name);
      out.push(collection);
    }
  }
  return out;
};

const isCollectionLookup = (
  value: unknown
): value is Pick<ReadonlyMap<string, AnyCollection>, "get"> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly get?: unknown }).get === "function";

const collectionRegistryDefinitions = (
  registry: StartCollectionResolutionOptions["collectionRegistry"]
): ReadonlyMap<string, AnyCollection> | undefined => {
  if (registry === undefined) {
    return undefined;
  }

  if (isCollectionLookup(registry)) {
    return registry;
  }

  return registry.definitions();
};

/** Build the shared Start collection-name resolver used by request preload and hydration. */
export const makeStartCollectionResolution = (
  options: StartCollectionResolutionOptions = {}
): StartCollectionResolution => {
  const registeredCollections = startCollectionArray(options.collections);
  const registeredDefinitions = new Map(
    registeredCollections.map((collection) => [collection.name, collection] as const)
  );
  const registryDefinitions = collectionRegistryDefinitions(options.collectionRegistry);

  return {
    registeredCollections,
    resolve: (name) =>
      registeredDefinitions.get(name) ??
      options.resolveCollection?.(name) ??
      registryDefinitions?.get(name)
  };
};

/** Resolve several collection names inside Effect, failing through the caller's typed error constructor. */
export const resolveStartCollectionsEffect = <E>(
  names: Iterable<string>,
  options: StartCollectionResolutionOptions,
  toFailure: (name: string) => E
): Effect.Effect<ReadonlyArray<AnyCollection>, E> =>
  Effect.gen(function* () {
    const resolution = makeStartCollectionResolution(options);
    const resolved: Array<AnyCollection> = [];
    for (const name of names) {
      const collection = resolution.resolve(name);
      if (collection === undefined) {
        return yield* Effect.fail(toFailure(name));
      }
      resolved.push(collection);
    }
    return uniqueStartCollections(resolved);
  });
