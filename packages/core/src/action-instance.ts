import { Effect } from "effect";
import type { ActionInstance, ActionDefinition } from "./action.js";
import type { ActionResultInvalidationRequirements } from "./action-result.js";
import {
  makeActionSubmissionController,
  type ActionInterrupted,
  type ActionState,
} from "./action-submission.js";
import {
  makeActionExecutionWorkflow,
  type ActionExecutionSite,
} from "./action-execution-workflow.js";
import type { ResourceInvalidationPlan } from "./resource.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import type { ActionClientError } from "./action-transport.js";

/**
 * Internal: creates an Action instance on an erased runtime. `Action.use`
 * checks the runtime's services at its typed facade; renderer adapters pass a
 * runtime whose services they check elsewhere. Start's action endpoint passes
 * `site: "endpoint"`. `initial` starts the instance in a settled state (a
 * submission the server already ran: see `PostedActions`).
 */
export const makeActionInstance = <I, A, E, R, ER>(
  definition: ActionDefinition<I, A, E, R>,
  runtime: AnySunfallArcRuntime<ER>,
  site: ActionExecutionSite = "client",
  initial?: ActionState<I, A, E | ER | ActionClientError>,
): ActionInstance<I, A, E | ER, never, E, R, R | ActionResultInvalidationRequirements<A>> => {
  const submissions = makeActionSubmissionController<
    I,
    A,
    E | ER | ActionClientError,
    ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>>
  >(
    definition.policy?.concurrency === undefined
      ? { actionName: definition.name }
      : { actionName: definition.name, concurrency: definition.policy.concurrency },
    initial,
  );

  const workflow = makeActionExecutionWorkflow({
    definition,
    submissions,
    runAtActionBoundary: (effect) => runtime.provide(effect),
    site,
  });

  return {
    definition,
    state: submissions.state,
    invalidationPlan: submissions.invalidationPlan,
    submit: workflow.submit as (
      input: I,
    ) => Effect.Effect<A, E | ER | ActionClientError | ActionInterrupted>,
    reset: workflow.reset,
  };
};
