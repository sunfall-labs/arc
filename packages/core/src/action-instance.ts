import { Effect } from "effect";
import type { ActionInstance, ActionDefinition } from "./action.js";
import type { ActionResultInvalidationRequirements } from "./action-result.js";
import { makeActionSubmissionController, type ActionInterrupted } from "./action-submission.js";
import { makeActionExecutionWorkflow } from "./action-execution-workflow.js";
import type { EffectInputCallbackError } from "./effect-like.js";
import type { ResourceInvalidationPlan } from "./resource.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import type { ServerClientError } from "./server.js";

/**
 * Internal: creates an Action instance on an erased runtime. `Action.use`
 * checks the runtime's services at its typed facade; renderer adapters pass a
 * runtime whose services they check elsewhere.
 */
export const makeActionInstance = <I, A, E, R, ER>(
  definition: ActionDefinition<I, A, E, R>,
  runtime: AnySunfallArcRuntime<ER>,
): ActionInstance<I, A, E | ER, never, E, R, R | ActionResultInvalidationRequirements<A>> => {
  const submissions = makeActionSubmissionController<
    I,
    A,
    E | ER | EffectInputCallbackError | ServerClientError,
    ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>>
  >(
    definition.policy?.concurrency === undefined
      ? { actionName: definition.name }
      : { actionName: definition.name, concurrency: definition.policy.concurrency },
  );

  const workflow = makeActionExecutionWorkflow({
    definition,
    submissions,
    runAtActionBoundary: (effect) => runtime.provide(effect),
  });

  return {
    definition,
    state: submissions.state,
    invalidationPlan: submissions.invalidationPlan,
    submitEffect: workflow.submitEffect as (
      input: I,
    ) => Effect.Effect<
      A,
      E | ER | EffectInputCallbackError | ServerClientError | ActionInterrupted
    >,
    resetEffect: workflow.resetEffect,
    reset: () => {
      void runtime.runFork(
        workflow.captureResetEffect().pipe(Effect.catchCause(() => Effect.void)),
      );
    },
  };
};
