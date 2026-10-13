import { Effect, Exit, Result, Schema } from "effect";
import {
  StateRefTypeId,
  type StateDefinition,
  type StateInstance,
  type StateSnapshot,
  type StateTagged,
} from "./state-contract.js";
import { makeStateRuntimeInstance, type StateStartModel } from "./state-runtime.js";
export { beginState } from "./state-runtime.js";
import type { ResourceStoreModule } from "./resource-store.js";
import { activeResourceStore } from "./resource-runtime.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { getCurrentScope } from "./scope.js";
import { readSignalOptimisticBase } from "./signal-optimistic-layer.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";

/**
 * Internal: starts a State on an erased runtime, registered with the current
 * UI scope when there is one. `State.start` checks the runtime's services at
 * its typed facade; renderer adapters pass a runtime whose services they check
 * elsewhere.
 */
export const startStateOnRuntime = <
  Model extends StateTagged,
  Message extends StateTagged,
  R = never,
  ER = never,
>(
  definition: StateDefinition<Model, Message, R>,
  runtime: AnySunfallArcRuntime<ER>,
  options: StateStartOnRuntimeOptions = {},
): StateInstance<Model, Message, ER> =>
  makeStateRuntimeInstance<Model, Message, R, ER>({
    definition,
    runtime,
    scope: getCurrentScope(),
    ...(options.deferred === true ? { deferred: true } : {}),
  });

/** Internal options for renderer adapters starting a State. */
export interface StateStartOnRuntimeOptions {
  /** Leave the machine unstarted until `beginState(instance)` (a hydrating client). */
  readonly deferred?: boolean;
}

const AppStatesKey: unique symbol = Symbol.for("@sunfall/arc-core/AppStates");

/**
 * The runtime's app States, one per definition, plus the server snapshots
 * waiting for theirs to start; disposed with its Resource Store.
 */
interface AppStatesModule extends ResourceStoreModule {
  readonly instances: Map<StateDefinition<any, any, any>, StateInstance<any, any, any>>;
  /** Encoded models from a server render, by State name, consumed when that State starts. */
  readonly snapshots: Map<string, unknown>;
}

const appStatesOf = (store: ResourceStoreState): AppStatesModule => {
  const registry = store.moduleRegistry;
  const existing = registry.get(AppStatesKey) as AppStatesModule | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const instances: AppStatesModule["instances"] = new Map();
  const module: AppStatesModule = {
    instances,
    snapshots: new Map(),
    dispose: Effect.suspend(() =>
      Effect.forEach(Array.from(instances.values()), (instance) => instance.dispose, {
        discard: true,
      }),
    ),
  };
  registry.register(AppStatesKey, module);
  return module;
};

/** Decodes the server's model for `definition`, if the render sent one. */
const startModel = <Model extends StateTagged>(
  definition: StateDefinition<Model, any, any>,
  snapshots: Map<string, unknown>,
): StateStartModel<Model> => {
  if (!snapshots.has(definition.name)) {
    return { _tag: "Initial" };
  }
  const encoded = snapshots.get(definition.name);
  snapshots.delete(definition.name);
  const decoded = Schema.decodeUnknownResult(definition.machine.stateSchema)(encoded);
  return Result.isSuccess(decoded)
    ? { _tag: "Hydrated", model: decoded.success as Model }
    : { _tag: "Rejected", error: decoded.failure };
};

/**
 * Internal: the runtime's one instance of an app State (`scope: "app"`),
 * started on first use with `runtime`'s services and owned by the runtime's
 * Resource Store, so it stops when the runtime is disposed and never outlives
 * a server request's runtime. It starts from the server's model when the
 * page's hydration payload carried one, decoded through the model schema; a
 * snapshot the schema rejects is reported as a `Hydrate` failure and the
 * State starts from `initial`. Renderer bindings never dispose it.
 */
export const appStateOnRuntime = <
  Model extends StateTagged,
  Message extends StateTagged,
  R = never,
  ER = never,
>(
  definition: StateDefinition<Model, Message, R>,
  runtime: AnySunfallArcRuntime<ER>,
  options: StateStartOnRuntimeOptions = {},
): StateInstance<Model, Message, ER> => {
  const module = appStatesOf(runtime.resourceStore);
  const existing = module.instances.get(definition);
  if (existing !== undefined) {
    return existing as StateInstance<Model, Message, ER>;
  }
  const started = makeStateRuntimeInstance<Model, Message, R, ER>({
    definition,
    runtime,
    scope: undefined,
    start: startModel(definition, module.snapshots),
    ...(options.deferred === true ? { deferred: true } : {}),
  });
  module.instances.set(definition, started);
  return started;
};

/**
 * Internal (Start): the encoded models of the runtime's app States that
 * moved away from `initial`, for the page's hydration payload. A model that
 * does not encode is left out: the browser starts that State from `initial`.
 */
export const dehydrateAppStates: Effect.Effect<ReadonlyArray<StateSnapshot>> = Effect.gen(
  function* () {
    const store = yield* activeResourceStore;
    const snapshots: Array<StateSnapshot> = [];
    for (const [definition, instance] of appStatesOf(store).instances) {
      const model = readSignalOptimisticBase(instance[StateRefTypeId]);
      if (Object.is(model, definition.machine.initial)) {
        continue;
      }
      const encoded = Schema.encodeUnknownExit(definition.machine.stateSchema)(model);
      if (Exit.isSuccess(encoded)) {
        snapshots.push({ name: definition.name, model: encoded.value });
      }
    }
    return snapshots;
  },
);

/**
 * Internal (Start): keeps the server's app State models for the runtime's
 * app States, each decoded by its State's schema when it starts.
 */
export const hydrateAppStates = (snapshots: ReadonlyArray<StateSnapshot>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const store = yield* activeResourceStore;
    const module = appStatesOf(store);
    for (const snapshot of snapshots) {
      module.snapshots.set(snapshot.name, snapshot.model);
    }
  });

/** True for a valid `StateSnapshot` list (the hydration payload's shape check). */
export const isStateSnapshots = (value: unknown): value is ReadonlyArray<StateSnapshot> =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { readonly name?: unknown }).name === "string" &&
      "model" in entry,
  );
