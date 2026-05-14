import { Context, Effect, Fiber, PubSub } from "effect";

export const ResourceStoreTypeId: unique symbol = Symbol.for("@effect-ui/core/ResourceStore") as never;

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

export type ResourceStoreEvent =
  | {
      readonly _tag: "ResourcePending";
      readonly name: string;
      readonly key: string;
      readonly force: boolean;
      readonly previous: boolean;
    }
  | {
      readonly _tag: "ResourceSuccess";
      readonly name: string;
      readonly key: string;
      readonly updatedAt: number;
    }
  | {
      readonly _tag: "ResourceFailure";
      readonly name: string;
      readonly key: string;
      readonly error: unknown;
      readonly previous: boolean;
    }
  | {
      readonly _tag: "ResourceHydrated";
      readonly name: string;
      readonly key: string;
      readonly updatedAt: number;
    }
  | {
      readonly _tag: "ResourceInvalidated";
      readonly name: string;
      readonly key: string;
      readonly causes: ReadonlyArray<ResourceStoreInvalidationCause>;
    }
  | {
      readonly _tag: "ResourceDeleted";
      readonly name: string;
      readonly key: string;
    }
  | {
      readonly _tag: "ResourceGcScheduled";
      readonly name: string;
      readonly key: string;
      readonly gcFor: number;
    }
  | {
      readonly _tag: "ResourceGcInterrupted";
      readonly name: string;
      readonly key: string;
    };

export interface ResourceStore {
  readonly [ResourceStoreTypeId]: typeof ResourceStoreTypeId;
  readonly families: Map<string, unknown>;
  readonly entries: WeakMap<object, Map<string, unknown>>;
  readonly inputs: WeakMap<object, Map<string, unknown>>;
  readonly caches: WeakMap<object, unknown>;
  readonly modules: Map<symbol, ResourceStoreModule>;
  readonly tagIndex: Map<string, Map<string, unknown>>;
  readonly refTags: Map<string, Set<string>>;
  readonly events: PubSub.PubSub<ResourceStoreEvent>;
  readonly fibers: Set<Fiber.Fiber<unknown, unknown>>;
}

export interface ResourceStoreModule {
  readonly disposeEffect?: Effect.Effect<void>;
}

export const makeResourceStore = (): ResourceStore => ({
  [ResourceStoreTypeId]: ResourceStoreTypeId,
  families: new Map(),
  entries: new WeakMap(),
  inputs: new WeakMap(),
  caches: new WeakMap(),
  modules: new Map(),
  tagIndex: new Map(),
  refTags: new Map(),
  events: Effect.runSync(PubSub.sliding<ResourceStoreEvent>(1024)),
  fibers: new Set()
});

export const disposeResourceStoreEffect = (store: ResourceStore): Effect.Effect<void> =>
  Effect.gen(function* () {
    const fibers = Array.from(store.fibers);
    if (fibers.length > 0) {
      store.fibers.clear();
      yield* Effect.forEach(fibers, Fiber.interrupt, { discard: true });
    }
    const modules = Array.from(store.modules.values());
    store.modules.clear();
    yield* Effect.forEach(modules, (module) => module.disposeEffect ?? Effect.void, { discard: true });
  }).pipe(Effect.ensuring(PubSub.shutdown(store.events)));

export const ResourceStore = Context.Service<ResourceStore>("@effect-ui/core/ResourceStore");
