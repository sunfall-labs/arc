import { Cause, Context, Data, Effect, Exit, Fiber, FiberSet, PubSub, Scope } from "effect";

/** Runtime marker for the Resource Store service. */
export const ResourceStoreTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ResourceStore",
) as typeof ResourceStoreTypeId;
const ResourceStoreImplementationTypeId: unique symbol = Symbol(
  "@sunfall/arc-core/ResourceStoreImplementation",
) as typeof ResourceStoreImplementationTypeId;

/** Serializable reason a Resource Store invalidated a resource ref. */
export type ResourceStoreInvalidationCause =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

/**
 * Runtime event emitted by the Resource Store.
 *
 * Devtools, server traces, and adapters consume these events to understand
 * resource loads, hydration, invalidation, deletion, and garbage collection.
 */
export type ResourceStoreEvent =
  | {
      /** A resource load or refresh started. */
      readonly _tag: "ResourcePending";
      readonly name: string;
      readonly key: string;
      readonly force: boolean;
      readonly previous: boolean;
    }
  | {
      /** A resource load completed successfully. */
      readonly _tag: "ResourceSuccess";
      readonly name: string;
      readonly key: string;
      readonly timestamp: number;
    }
  | {
      /** A resource load failed with a typed error, defect, or mixed cause. */
      readonly _tag: "ResourceFailure";
      readonly name: string;
      readonly key: string;
      readonly cause: Cause.Cause<unknown>;
      readonly previous: boolean;
    }
  | {
      /** A resource load was interrupted; the entry returned to its prior settled result. */
      readonly _tag: "ResourceInterrupted";
      readonly name: string;
      readonly key: string;
    }
  | {
      /** A `rows.changes` batch was applied to the entry's synced rows. */
      readonly _tag: "ResourceRowsChanged";
      readonly name: string;
      readonly key: string;
      readonly changes: number;
    }
  | {
      /** The entry's `rows.changes` feed failed and stopped; the rows keep their value. */
      readonly _tag: "ResourceRowsChangesFailure";
      readonly name: string;
      readonly key: string;
      readonly cause: Cause.Cause<unknown>;
    }
  | {
      /** A successful resource snapshot was applied during hydration. */
      readonly _tag: "ResourceHydrated";
      readonly name: string;
      readonly key: string;
      readonly timestamp: number;
    }
  | {
      /** A resource was selected by one or more invalidation targets. */
      readonly _tag: "ResourceInvalidated";
      readonly name: string;
      readonly key: string;
      readonly causes: ReadonlyArray<ResourceStoreInvalidationCause>;
    }
  | {
      /** A resource cache entry was explicitly deleted. */
      readonly _tag: "ResourceDeleted";
      readonly name: string;
      readonly key: string;
    }
  | {
      /** Garbage collection was scheduled for a cached resource entry. */
      readonly _tag: "ResourceGcScheduled";
      readonly name: string;
      readonly key: string;
      readonly gcFor: number;
    }
  | {
      /** A scheduled resource garbage collection fiber was interrupted. */
      readonly _tag: "ResourceGcInterrupted";
      readonly name: string;
      readonly key: string;
    };

/** Effect-first event seam for adapters and diagnostics. */
export interface ResourceStoreEventBus {
  /** Publishes a runtime event without exposing the backing PubSub. */
  publish(event: ResourceStoreEvent): Effect.Effect<void>;
  /** Subscribes to runtime events with the subscription bound to the caller's Scope. */
  readonly subscribe: Effect.Effect<PubSub.Subscription<ResourceStoreEvent>, never, Scope.Scope>;
  /** Shuts down the backing event queue. */
  readonly shutdown: Effect.Effect<void>;
  /** Effect-first shutdown diagnostic for tests and adapters. */
  readonly isShutdown: Effect.Effect<boolean>;
}

/** Named module seam for store-local adapter state and cleanup. */
export interface ResourceStoreModuleRegistry {
  get(key: symbol): ResourceStoreModule | undefined;
  register(key: symbol, module: ResourceStoreModule): void;
  values(): ReadonlyArray<ResourceStoreModule>;
  clear(): void;
  readonly size: Effect.Effect<number>;
}

/** Named fiber seam for background work owned by a Resource Store. */
export interface ResourceStoreFiberRegistry {
  /**
   * Forks `effect` (detached from the caller) into the store's `FiberSet`. The
   * fiber leaves the set when it completes and is interrupted when the store is
   * disposed; after disposal it starts already interrupted.
   */
  run<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Fiber.Fiber<A, E>, never, R>;
  readonly size: Effect.Effect<number>;
}

/** Stable Resource Store count snapshot that does not expose private maps. */
export interface ResourceStoreDiagnosticsSnapshot {
  readonly fiberCount: number;
  readonly familyCount: number;
  readonly moduleCount: number;
  readonly tagCount: number;
}

/** Effect-first Resource Store diagnostics that do not expose private maps. */
export interface ResourceStoreDiagnostics {
  readonly eventBusShutdown: Effect.Effect<boolean>;
  readonly moduleCount: Effect.Effect<number>;
  readonly fiberCount: Effect.Effect<number>;
  readonly familyCount: Effect.Effect<number>;
  readonly tagCount: Effect.Effect<number>;
  readonly snapshot: Effect.Effect<ResourceStoreDiagnosticsSnapshot>;
}

/**
 * Public Resource Store seams exposed by an Sunfall Arc runtime.
 *
 * Most applications interact with resource state through `Resource.*` helpers.
 * Adapters and diagnostics can use these supported seams without depending on
 * the store's mutable cache internals.
 */
export interface ResourceStore {
  readonly [ResourceStoreTypeId]: typeof ResourceStoreTypeId;
  readonly [ResourceStoreImplementationTypeId]: typeof ResourceStoreImplementationTypeId;
  /** Effect-first event API for adapters and diagnostics. */
  readonly eventBus: ResourceStoreEventBus;
  /** Effect-first module API for adapter-owned store-local state. */
  readonly moduleRegistry: ResourceStoreModuleRegistry;
  /** Effect-first fiber API for background work tracked by the store. */
  readonly fiberRegistry: ResourceStoreFiberRegistry;
  /** Public diagnostics that avoid direct access to store internals. */
  readonly diagnostics: ResourceStoreDiagnostics;
}

class InvalidResourceStore extends Data.TaggedError("InvalidResourceStore")<{
  readonly message: string;
  readonly received: unknown;
}> {}

/** @internal Mutable runtime state shared by Resources inside one Sunfall Arc runtime. */
export interface MutableResourceStore extends ResourceStore {
  /** @internal Resource family definitions available in this runtime. */
  readonly families: Map<string, unknown>;
  /** @internal Cache entries keyed by family object and resource key. */
  readonly entries: WeakMap<object, Map<string, unknown>>;
  /** @internal Original inputs keyed by family object and resource key. */
  readonly inputs: WeakMap<object, Map<string, unknown>>;
  /** @internal Internal per-family caches used by Resource runtime modules. */
  readonly caches: WeakMap<object, unknown>;
  /** @internal Use `moduleRegistry` for adapter-owned store-local state. */
  readonly modules: Map<symbol, ResourceStoreModule>;
  /** Reverse index from resource tags to refs. */
  readonly tagIndex: Map<string, Map<string, unknown>>;
  /** Tags currently provided by each resource ref key. */
  readonly refTags: Map<string, Set<string>>;
  /** Mounted UI/resource bindings retaining a resource ref from gc collection. */
  readonly retainedRefs: Map<string, number>;
  /** @internal Scope owning store background work; closed by `disposeResourceStore`. */
  readonly scope: Scope.Closeable;
  /**
   * Whether entries follow their `rows.changes` feeds. A server request's
   * store renders one response and never follows them; the browser runtime
   * starts them when it hydrates.
   */
  readonly followsChanges: boolean;
}

/** Error raised when Resource Store disposal observes a module finalizer failure. */
export class ResourceStoreDisposeError extends Data.TaggedError("ResourceStoreDisposeError")<{
  /** Structured Effect cause reported by the failing module finalizer. */
  readonly cause: Cause.Cause<unknown>;
  /** Human-readable repair hint suitable for diagnostics and adapter hooks. */
  readonly guidance: string;
}> {}

/** Store-local module state registered by Resource runtime helpers. */
export interface ResourceStoreModule {
  /** Optional module-local cleanup work run when the Resource Store is disposed. */
  readonly dispose?: Effect.Effect<void, unknown>;
}

/** @internal Creates an empty mutable Resource Store implementation. */
export const makeMutableResourceStore = (
  options: { readonly followsChanges?: boolean } = {},
): MutableResourceStore => {
  const families = new Map<string, unknown>();
  const tagIndex = new Map<string, Map<string, unknown>>();
  const refTags = new Map<string, Set<string>>();
  const retainedRefs = new Map<string, number>();
  const modules = new Map<symbol, ResourceStoreModule>();
  const scope = Effect.runSync(Scope.make());
  const fibers = Effect.runSync(Scope.provide(FiberSet.make(), scope));

  // The event PubSub is created by the first subscriber. Until then nobody
  // can receive an event (a PubSub drops what no subscriber takes), so
  // publishing is free and a store nobody watches, like an SSR request's,
  // never allocates the buffer.
  let events: PubSub.PubSub<ResourceStoreEvent> | undefined;
  let shutdown = false;
  const eventsPubSub = (): PubSub.PubSub<ResourceStoreEvent> => {
    if (events === undefined) {
      events = Effect.runSync(PubSub.sliding<ResourceStoreEvent>(1024));
      if (shutdown) {
        Effect.runSync(PubSub.shutdown(events));
      }
    }
    return events;
  };
  const eventBus: ResourceStoreEventBus = {
    publish: (event) =>
      Effect.suspend(() =>
        events === undefined ? Effect.void : PubSub.publish(events, event).pipe(Effect.asVoid),
      ),
    subscribe: Effect.suspend(() => PubSub.subscribe(eventsPubSub())),
    shutdown: Effect.suspend(() => {
      shutdown = true;
      return events === undefined ? Effect.void : PubSub.shutdown(events);
    }),
    isShutdown: Effect.sync(() => shutdown),
  };
  const moduleRegistry: ResourceStoreModuleRegistry = {
    get: (key) => modules.get(key),
    register: (key, module) => {
      modules.set(key, module);
    },
    values: () => Array.from(modules.values()),
    clear: () => {
      modules.clear();
    },
    size: Effect.sync(() => modules.size),
  };
  const fiberRegistry: ResourceStoreFiberRegistry = {
    run: (effect) => FiberSet.run(fibers, effect),
    size: FiberSet.size(fibers),
  };
  const diagnostics: ResourceStoreDiagnostics = {
    eventBusShutdown: eventBus.isShutdown,
    moduleCount: moduleRegistry.size,
    fiberCount: fiberRegistry.size,
    familyCount: Effect.sync(() => families.size),
    tagCount: Effect.sync(() => tagIndex.size),
    snapshot: Effect.map(fiberRegistry.size, (fiberCount) => ({
      fiberCount,
      familyCount: families.size,
      moduleCount: modules.size,
      tagCount: tagIndex.size,
    })),
  };

  return {
    [ResourceStoreTypeId]: ResourceStoreTypeId,
    [ResourceStoreImplementationTypeId]: ResourceStoreImplementationTypeId,
    eventBus,
    moduleRegistry,
    fiberRegistry,
    diagnostics,
    families,
    entries: new WeakMap(),
    inputs: new WeakMap(),
    caches: new WeakMap(),
    modules,
    tagIndex,
    refTags,
    retainedRefs,
    scope,
    followsChanges: options.followsChanges ?? true,
  };
};

/** Creates an empty Resource Store with event buffering and tracked fibers. */
export const makeResourceStore = (): ResourceStore => makeMutableResourceStore();

/**
 * @internal The Resource Store of one server request: its entries load,
 * render, and hydrate, but never follow `rows.changes` feeds (the browser
 * runtime does, from the hydrated rows).
 */
export const makeRequestResourceStore = (): ResourceStore =>
  makeMutableResourceStore({ followsChanges: false });

/** @internal Narrows a public Resource Store to the mutable implementation used by core internals. */
export const unsafeMutableResourceStore = (store: ResourceStore): MutableResourceStore => {
  if (
    typeof store !== "object" ||
    store === null ||
    (store as { [ResourceStoreImplementationTypeId]?: unknown })[
      ResourceStoreImplementationTypeId
    ] !== ResourceStoreImplementationTypeId
  ) {
    throw new InvalidResourceStore({
      message:
        "Resource Store values must come from makeResourceStore(). Custom ResourceStore adapters cannot provide the mutable runtime cache internals required by Resource operations.",
      received: store,
    });
  }
  return store as MutableResourceStore;
};

const resourceStoreDisposeError = (cause: Cause.Cause<unknown>): ResourceStoreDisposeError =>
  new ResourceStoreDisposeError({
    cause,
    guidance:
      "A Resource Store module finalizer failed during runtime disposal. Inspect `cause` to find the failing finalizer and keep module cleanup Effects typed.",
  });

/** Closes the store's Scope (interrupting its fibers), runs module finalizers, and shuts down store events. */
export const disposeResourceStore = (
  store: ResourceStore,
): Effect.Effect<void, ResourceStoreDisposeError> =>
  Effect.gen(function* () {
    yield* Scope.close(unsafeMutableResourceStore(store).scope, Exit.void);
    const modules = store.moduleRegistry.values();
    store.moduleRegistry.clear();
    const exits = yield* Effect.forEach(modules, (module) =>
      Effect.exit(module.dispose ?? Effect.void),
    );
    const failure = exits.find(Exit.isFailure);
    if (failure) {
      return yield* Effect.fail(resourceStoreDisposeError(failure.cause as Cause.Cause<unknown>));
    }
  }).pipe(Effect.ensuring(store.eventBus.shutdown));

/** Effect Context service used to provide the active Resource Store. */
export const ResourceStore = Context.Service<ResourceStore>("@sunfall/arc-core/ResourceStore");
