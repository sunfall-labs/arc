import type {
  ProgramDefinition,
  ProgramDispatchError,
  ProgramInstance,
  ProgramRuntimeError,
} from "./program-contract.js";
import { makeProgramRuntimeInstance } from "./program-runtime.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { getCurrentScope } from "./scope.js";

/**
 * Internal: starts a Program on an erased runtime, registered with the current
 * UI scope when there is one. `Program.start` checks the runtime's services at
 * its typed facade; renderer adapters pass a runtime whose services they check
 * elsewhere.
 */
export const startProgramOnRuntime = <Model, Message, E = never, R = never, ER = never>(
  definition: ProgramDefinition<Model, Message, E, R>,
  runtime: AnySunfallArcRuntime<ER>,
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>> =>
  makeProgramRuntimeInstance<Model, Message, E, never, ER>({
    definition: definition as unknown as ProgramDefinition<Model, Message, E, never>,
    runtime,
    scope: getCurrentScope(),
  });
