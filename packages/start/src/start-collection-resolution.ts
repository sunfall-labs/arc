import { type AnyCollection } from "@effect-ui/db";
import { Data, Effect } from "effect";

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
  readonly collectionRegistry?:
    | StartCollectionDefinitionRegistry
    | ReadonlyMap<string, AnyCollection>;
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

/** Error raised when one Start collection lookup scope contains two different definitions with the same stable name. */
export class StartCollectionDuplicateName extends Data.TaggedError("StartCollectionDuplicateName")<{
  readonly name: string;
  readonly source: "collections" | "route-preload" | "hydration";
  readonly guidance: string;
}> {}

const duplicateCollectionName = (
  name: string,
  source: StartCollectionDuplicateName["source"],
): StartCollectionDuplicateName =>
  new StartCollectionDuplicateName({
    name,
    source,
    guidance:
      "Collection names are stable hydration identities. Provide only one definition for each name in a Start request or hydration scope.",
  });

/** Convert optional collection iterables into a readonly array without changing definition identity. */
export const startCollectionArray = (
  collections: Iterable<AnyCollection> | undefined,
): ReadonlyArray<AnyCollection> => (collections ? Array.from(collections) : []);

/**
 * De-duplicate collection definitions by stable Collection name while preserving first occurrence.
 *
 * This helper is intentionally pure for diagnostics and display paths. Request
 * preload and hydration should use `uniqueStartCollectionsEffect(...)` so
 * different definitions with the same name fail before any payload is built.
 */
export const uniqueStartCollections = (
  collections: Iterable<AnyCollection>,
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

/** De-duplicate Start collections, failing when a stable name maps to more than one definition. */
export const uniqueStartCollectionsEffect = (
  collections: Iterable<AnyCollection>,
  source: StartCollectionDuplicateName["source"] = "collections",
): Effect.Effect<ReadonlyArray<AnyCollection>, StartCollectionDuplicateName> =>
  Effect.gen(function* () {
    const definitions = new Map<string, AnyCollection>();
    const out: Array<AnyCollection> = [];
    for (const collection of collections) {
      const existing = definitions.get(collection.name);
      if (existing === collection) {
        continue;
      }
      if (existing !== undefined) {
        return yield* Effect.fail(duplicateCollectionName(collection.name, source));
      }
      definitions.set(collection.name, collection);
      out.push(collection);
    }
    return out;
  });

/** Validate direct collection resolution inputs before resolving names. */
export const validateStartCollectionResolutionOptionsEffect = (
  options: StartCollectionResolutionOptions = {},
): Effect.Effect<void, StartCollectionDuplicateName> =>
  Effect.asVoid(
    uniqueStartCollectionsEffect(startCollectionArray(options.collections), "collections"),
  );

const isCollectionLookup = (
  value: unknown,
): value is Pick<ReadonlyMap<string, AnyCollection>, "get"> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly get?: unknown }).get === "function";

const collectionRegistryDefinitions = (
  registry: StartCollectionResolutionOptions["collectionRegistry"],
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
  options: StartCollectionResolutionOptions = {},
): StartCollectionResolution => {
  const registeredCollections = startCollectionArray(options.collections);
  const registeredDefinitions = new Map<string, AnyCollection>();
  for (const collection of registeredCollections) {
    if (!registeredDefinitions.has(collection.name)) {
      registeredDefinitions.set(collection.name, collection);
    }
  }
  const registryDefinitions = collectionRegistryDefinitions(options.collectionRegistry);

  return {
    registeredCollections,
    resolve: (name) =>
      registeredDefinitions.get(name) ??
      options.resolveCollection?.(name) ??
      registryDefinitions?.get(name),
  };
};

/** Resolve several collection names inside Effect, failing through the caller's typed error constructor. */
export const resolveStartCollectionsEffect = <E>(
  names: Iterable<string>,
  options: StartCollectionResolutionOptions,
  toFailure: (name: string) => E,
): Effect.Effect<ReadonlyArray<AnyCollection>, E> =>
  Effect.gen(function* () {
    yield* validateStartCollectionResolutionOptionsEffect(options).pipe(
      Effect.mapError((cause) => toFailure(cause.name)),
    );
    const resolution = makeStartCollectionResolution(options);
    const resolved: Array<AnyCollection> = [];
    for (const name of names) {
      const collection = resolution.resolve(name);
      if (collection === undefined) {
        return yield* Effect.fail(toFailure(name));
      }
      resolved.push(collection);
    }
    return yield* uniqueStartCollectionsEffect(resolved, "route-preload").pipe(
      Effect.mapError((cause) => toFailure(cause.name)),
    );
  });
