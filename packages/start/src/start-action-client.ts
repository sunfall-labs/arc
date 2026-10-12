import type { Action } from "@sunfall/arc-core";
import {
  decodeStartActionFormData,
  startActionForm,
  type StartActionDefinition,
  type StartActionForm,
  type StartActionFormOptions,
} from "./start-action-request-codec.js";
import type { StartActionInvalidationPlan } from "./start-action-response-codec.js";

/**
 * Progressive (no-JS) HTML form helpers for Start actions.
 *
 * Scripted UI submits every Action the same way, through its renderer binding
 * (Solid's `Component.action(...)`); `makeActionTransportLayer(...)` routes
 * served Actions to the server. These helpers make the same Action work as a
 * plain `<form method="post">` before (or without) JavaScript.
 */
export namespace StartAction {
  /** Progressive POST form description for a Start action definition. */
  export type Form<_D extends StartActionDefinition> = StartActionForm;
  /** Options for `StartAction.form(...)`. */
  export type FormOptions<I> = StartActionFormOptions<I>;
  /** Resource invalidation plan returned by an action response. */
  export type InvalidationPlan = StartActionInvalidationPlan;

  /**
   * Creates the hidden POST fields needed to submit a Start action from HTML.
   */
  export const form = <I, A, E, R>(
    definition: Action.Definition<I, A, E, R>,
    options: StartActionFormOptions<I> = {},
  ): StartActionForm => startActionForm(definition, options);

  /**
   * Decode a Start action form's FormData exactly as the server decodes the
   * same form posted without JavaScript: the visible fields merged over the
   * default input `StartAction.form(action, { input })` encoded, without the
   * hidden transport fields themselves.
   */
  export const decodeFormData = decodeStartActionFormData;
}
