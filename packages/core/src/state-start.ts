import { Effect } from "effect";
import type {
  StateDefinition,
  StateDispatchError,
  StateInstance,
  StateRuntimeError,
  StateTaggedMessage,
} from "./state-contract.js";
import { makeStateRuntimeInstance } from "./state-runtime.js";
import type { ResourceStoreModule } from "./resource-store.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { getCurrentScope } from "./scope.js";

type RunningState<Model, Message, E, ER> = StateInstance<
  Model,
  Message,
  StateRuntimeError<E, ER>,
  StateDispatchError<E, ER>
>;

/**
 * Internal: starts a State on an erased runtime, registered with the current
 * UI scope when there is one. `State.start` checks the runtime's services at
 * its typed facade; renderer adapters pass a runtime whose services they check
 * elsewhere.
 */
export const startStateOnRuntime = <
  Model,
  Message extends StateTaggedMessage,
  E = never,
  R = never,
  ER = never,
>(
  definition: StateDefinition<Model, Message, E, R>,
  runtime: AnySunfallArcRuntime<ER>,
): RunningState<Model, Message, E, ER> =>
  makeStateRuntimeInstance<Model, Message, E, never, ER>({
    definition: definition as unknown as StateDefinition<Model, Message, E, never>,
    runtime,
    scope: getCurrentScope(),
  });

const AppStatesKey: unique symbol = Symbol.for("@sunfall/arc-core/AppStates");

/** The runtime's app States, one per definition; disposed with its Resource Store. */
interface AppStatesModule extends ResourceStoreModule {
  readonly instances: Map<StateDefinition<any, any, any, any>, RunningState<any, any, any, any>>;
}

const appStates = (runtime: AnySunfallArcRuntime<unknown>): AppStatesModule => {
  const registry = runtime.resourceStore.moduleRegistry;
  const existing = registry.get(AppStatesKey) as AppStatesModule | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const instances: AppStatesModule["instances"] = new Map();
  const module: AppStatesModule = {
    instances,
    dispose: Effect.suspend(() =>
      Effect.forEach(Array.from(instances.values()), (instance) => instance.dispose, {
        discard: true,
      }),
    ),
  };
  registry.register(AppStatesKey, module);
  return module;
};

/**
 * Internal: the runtime's one instance of an app State (`scope: "app"`),
 * started on first use with `runtime`'s services and owned by the runtime's
 * Resource Store, so it stops when the runtime is disposed and never outlives
 * a server request's runtime. Renderer bindings never dispose it.
 */
export const appStateOnRuntime = <
  Model,
  Message extends StateTaggedMessage,
  E = never,
  R = never,
  ER = never,
>(
  definition: StateDefinition<Model, Message, E, R>,
  runtime: AnySunfallArcRuntime<ER>,
): RunningState<Model, Message, E, ER> => {
  const { instances } = appStates(runtime as AnySunfallArcRuntime<unknown>);
  const existing = instances.get(definition);
  if (existing !== undefined) {
    return existing as RunningState<Model, Message, E, ER>;
  }
  const started = makeStateRuntimeInstance<Model, Message, E, never, ER>({
    definition: definition as unknown as StateDefinition<Model, Message, E, never>,
    runtime,
    scope: undefined,
  });
  instances.set(definition, started);
  return started;
};
