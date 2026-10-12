import type {
  StateDefinition,
  StateDispatchError,
  StateInstance,
  StateRuntimeError,
  StateTaggedMessage,
} from "./state-contract.js";
import { makeStateRuntimeInstance } from "./state-runtime.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { getCurrentScope } from "./scope.js";

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
): StateInstance<Model, Message, StateRuntimeError<E, ER>, StateDispatchError<E, ER>> =>
  makeStateRuntimeInstance<Model, Message, E, never, ER>({
    definition: definition as unknown as StateDefinition<Model, Message, E, never>,
    runtime,
    scope: getCurrentScope(),
  });
