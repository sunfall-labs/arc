import { Context, type Effect } from "effect";
import type { ActionDefinition } from "./action.js";
import type { ActionState } from "./action-submission.js";
import type { ActionClientError } from "./action-transport.js";

/** Form fields as a browser posts them: strings, a repeated name as an array. */
export type PostedFormValues = Readonly<Record<string, string | ReadonlyArray<string>>>;

/**
 * A submission the server already ran for the page being rendered: a form
 * posted without JavaScript whose Action answered with a validation failure
 * or a failure, so the server renders the page again with that outcome.
 */
export interface PostedActionSubmission {
  /** The submitted Action's name. */
  readonly action: string;
  /** The form's fields as posted (without the hidden transport fields). */
  readonly values: PostedFormValues;
  /** The submission's settled state, decoded with `definition`'s schemas. */
  readonly state: <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
  ) => Effect.Effect<ActionState<I, A, E | ActionClientError>>;
}

/**
 * The posted submission a runtime renders, if any. A renderer binding of the
 * submitted Action starts in its settled state and exposes its posted
 * fields, so the server render and the hydrating client show the form's
 * errors and values alike. Start provides it: the request runtime of a
 * no-JavaScript form post, and the browser runtime until hydration ends.
 */
export interface PostedActions {
  current: PostedActionSubmission | undefined;
}

export const PostedActions = Context.Service<PostedActions>("@sunfall/arc-core/PostedActions");
