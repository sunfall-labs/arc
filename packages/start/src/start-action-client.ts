import { type ActionDefinition } from "@sunfall/arc-core";
import {
  decodeStartActionFormDataEffect,
  startActionForm,
  type StartActionDefinition,
  type StartActionForm,
  type StartActionFormOptions,
} from "./start-action-request-codec.js";

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

  /**
   * Creates the hidden POST fields needed to submit a Start action from HTML.
   */
  export const form = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    options: StartActionFormOptions<I> = {},
  ): StartActionForm => startActionForm(definition, options);

  /**
   * Decode user-authored fields from a Start action FormData payload.
   *
   * Hidden Start transport fields emitted by `StartAction.form(...)` are omitted
   * automatically before the schema decoder runs.
   */
  export const decodeFormDataEffect = decodeStartActionFormDataEffect;
}
