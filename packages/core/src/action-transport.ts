import { Context, type Effect, type Exit, type Option } from "effect";
import type { ActionDefinition } from "./action.js";
import type { ServerClientError } from "./server.js";

/**
 * A remote Action submission's response: the outcome the server's `run`
 * produced, plus the work that applies the response's side effects (hydrated
 * values, resource invalidations) to the submitting runtime.
 */
export interface ActionTransportResponse<A, E> {
  /** The decoded value or typed failure, as a local `run` would produce it. */
  readonly exit: Exit.Exit<A, E>;
  /**
   * Applies the response in the submitting runtime. `current` is false when a
   * newer submission of the same instance superseded this one: only its
   * invalidations apply then, so hydrated values stay latest-only.
   */
  readonly apply: (current: boolean) => Effect.Effect<void, ServerClientError>;
}

/**
 * Transport seam for Action submissions, the Action counterpart of
 * `ServerClient`.
 *
 * Every Action instance looks this service up when it submits. Actions the
 * transport serves (`submit` returns `Option.some`) run remotely; every other
 * Action runs its `run` locally. UI code submits the same way either way; a
 * host (Start's `makeActionTransportLayer(...)`) decides by providing this
 * service in the runtime layer.
 */
export interface ActionTransport {
  readonly submit: <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    input: I,
  ) => Option.Option<Effect.Effect<ActionTransportResponse<A, E>, ServerClientError>>;
}

export const ActionTransport = Context.Service<ActionTransport>(
  "@sunfall/arc-core/ActionTransport",
);
