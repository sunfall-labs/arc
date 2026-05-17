import { Cause, Context, Data, Effect, Exit, Fiber, PubSub, Scope } from "effect";

/** Runtime marker for the Resource Store service. */
export const ResourceStoreTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ResourceStore",
) as typeof ResourceStoreTypeId;
const ResourceStoreImplementationTypeId: unique symbol = Symbol(
  "@sunfall/arc-core/ResourceStoreImplementation",
) as typeof ResourceStoreImplementationTypeId;

/** Erased fiber tracked by a Resource Store for interruption on disposal. */
export type ResourceStoreFiber = Fiber.Fiber<unknown, never>;

/** Erases a typed fiber so the Resource Store can track all resource work. */
export const resourceStoreFiber = <A, E>(fiber: Fiber.Fiber<A, E>): ResourceStoreFiber =>
  fiber as ResourceStoreFiber;

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
      readonly updatedAt: number;
    }
  | {
      /** A resource load failed. */
      readonly _tag: "ResourceFailure";
      readonly name: string;
      readonly key: string;
      readonly error: unknown;
      readonly previous: boolean;
    }
  | {
      /** A successful resource snapshot was applied during hydration. */
      readonly _tag: "ResourceHydrated";
      readonly name: string;
      readonly key: string;
      readonly updatedAt: number;
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
  publishEffect(event: ResourceStoreEvent): Effect.Effect<void>;
  /** Subscribes to runtime events with the subscription bound to the caller's Scope. */
  readonly subscribeEffect: Effect.Effect<
    PubSub.Subscription<ResourceStoreEvent>,
    never,
    Scope.Scope
  >;
  /** Shuts down the backing event queue. */
  readonly shutdownEffect: Effect.Effect<void>;
  /** Effect-first shutdown diagnostic for tests and adapters. */
  readonly isShutdownEffect: Effect.Effect<boolean>;
  /** Synchronous shutdown diagnostic for assertions at host boundaries. */
  isShutdownUnsafe(): boolean;
}

/** Named module seam for store-local adapter state and cleanup. */
export interface ResourceStoreModuleRegistry {
  get(key: symbol): ResourceStoreModule | undefined;
  register(key: symbol, module: ResourceStoreModule): void;
  values(): ReadonlyArray<ResourceStoreModule>;
  clear(): void;
  size(): number;
  readonly sizeEffect: Effect.Effect<number>;
}

/** Named fiber seam for background work owned by a Resource Store. */
export interface ResourceStoreFiberRegistry {
  track(fiber: ResourceStoreFiber): void;
  untrack(fiber: ResourceStoreFiber): void;
  drain(): ReadonlyArray<ResourceStoreFiber>;
  size(): number;
  readonly sizeEffect: Effect.Effect<number>;
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
  readonly eventBusShutdownEffect: Effect.Effect<boolean>;
  readonly moduleCountEffect: Effect.Effect<number>;
  readonly fiberCountEffect: Effect.Effect<number>;
  readonly familyCountEffect: Effect.Effect<number>;
  readonly tagCountEffect: Effect.Effect<number>;
  readonly snapshotEffect: Effect.Effect<ResourceStoreDiagnosticsSnapshot>;
  /** Synchronous host-boundary snapshot for traces and adapters. */
  snapshotUnsafe(): ResourceStoreDiagnosticsSnapshot;
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
  /** @internal Use `eventBus` or `Resource.subscribeEventsEffect`. */
  readonly events: PubSub.PubSub<ResourceStoreEvent>;
  /** @internal Use `fiberRegistry` for tracked background work. */
  readonly fibers: Set<ResourceStoreFiber>;
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
  readonly disposeEffect?: Effect.Effect<void, unknown>;
}

/** @internal Creates an empty mutable Resource Store implementation. */
export const makeMutableResourceStore = (): MutableResourceStore => {
  const families = new Map<string, unknown>();
  const tagIndex = new Map<string, Map<string, unknown>>();
  const refTags = new Map<string, Set<string>>();
  const retainedRefs = new Map<string, number>();
  const modules = new Map<symbol, ResourceStoreModule>();
  const events = Effect.runSync(PubSub.sliding<ResourceStoreEvent>(1024));
  const fibers = new Set<ResourceStoreFiber>();
  const snapshot = (): ResourceStoreDiagnosticsSnapshot => ({
    fiberCount: fibers.size,
    familyCount: families.size,
    moduleCount: modules.size,
    tagCount: tagIndex.size,
  });

  const eventBus: ResourceStoreEventBus = {
    publishEffect: (event) => PubSub.publish(events, event).pipe(Effect.asVoid),
    subscribeEffect: PubSub.subscribe(events),
    shutdownEffect: PubSub.shutdown(events),
    isShutdownEffect: Effect.sync(() => PubSub.isShutdownUnsafe(events)),
    isShutdownUnsafe: () => PubSub.isShutdownUnsafe(events),
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
    size: () => modules.size,
    sizeEffect: Effect.sync(() => modules.size),
  };
  const fiberRegistry: ResourceStoreFiberRegistry = {
    track: (fiber) => {
      fibers.add(fiber);
    },
    untrack: (fiber) => {
      fibers.delete(fiber);
    },
    drain: () => {
      const current = Array.from(fibers);
      fibers.clear();
      return current;
    },
    size: () => fibers.size,
    sizeEffect: Effect.sync(() => fibers.size),
  };
  const diagnostics: ResourceStoreDiagnostics = {
    eventBusShutdownEffect: eventBus.isShutdownEffect,
    moduleCountEffect: moduleRegistry.sizeEffect,
    fiberCountEffect: fiberRegistry.sizeEffect,
    familyCountEffect: Effect.sync(() => families.size),
    tagCountEffect: Effect.sync(() => tagIndex.size),
    snapshotEffect: Effect.sync(snapshot),
    snapshotUnsafe: snapshot,
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
    events,
    fibers,
  };
};

/** Creates an empty Resource Store with event buffering and tracked fibers. */
export const makeResourceStore = (): ResourceStore => makeMutableResourceStore();

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

/** Interrupts tracked fibers, runs module finalizers, and shuts down store events. */
export const disposeResourceStoreEffect = (
  store: ResourceStore,
): Effect.Effect<void, ResourceStoreDisposeError> =>
  Effect.gen(function* () {
    const fibers = store.fiberRegistry.drain();
    if (fibers.length > 0) {
      yield* Effect.forEach(fibers, Fiber.interrupt, { discard: true });
    }
    const modules = store.moduleRegistry.values();
    store.moduleRegistry.clear();
    const exits = yield* Effect.forEach(modules, (module) =>
      Effect.exit(module.disposeEffect ?? Effect.void),
    );
    const failure = exits.find(Exit.isFailure);
    if (failure) {
      return yield* Effect.fail(resourceStoreDisposeError(failure.cause as Cause.Cause<unknown>));
    }
  }).pipe(Effect.ensuring(store.eventBus.shutdownEffect));

/** Effect Context service used to provide the active Resource Store. */
export const ResourceStore = Context.Service<ResourceStore>("@sunfall/arc-core/ResourceStore");
