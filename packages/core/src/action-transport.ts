import { Context, Data, Effect, Schema, type Exit, type Option } from "effect";
import type { ActionDefinition } from "./action.js";
import type { EffectInputCallbackError } from "./effect-like.js";

/** The Action transport could not deliver a submission or read its response. */
export class ActionTransportError extends Data.TaggedError("ActionTransportError")<{
  readonly reason: "Network" | "BadStatus" | "InvalidResponse" | "Defect" | "Interrupted";
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
  readonly payload?: unknown;
  /** The server's request id (`x-sunfall-arc-request-id`), for support and logs. */
  readonly requestId?: string;
}> {}

/** The Action endpoint rejected a submission as malformed. */
export class ActionProtocolError extends Data.TaggedError("ActionProtocolError")<{
  readonly message: string;
  readonly payload?: unknown;
}> {}

/** The Action endpoint does not serve the submitted Action. */
export class ActionNotFound extends Data.TaggedError("ActionNotFound")<{
  readonly actionName: string;
}> {}

/**
 * Failures a submission reports beside the Action's own: transport,
 * protocol, unknown-Action, wire-schema, and callback failures.
 */
export type ActionClientError =
  | ActionTransportError
  | ActionProtocolError
  | ActionNotFound
  | Schema.SchemaError
  | EffectInputCallbackError;

/** Decodes Action wire data through an Action's optional schema. */
export const decodeActionWire = <A = unknown>(
  schema: unknown,
  input: unknown,
): Effect.Effect<A, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(input)
    : Effect.succeed(input as A);

/** Encodes Action wire data through an Action's optional schema. */
export const encodeActionWire = (
  schema: unknown,
  input: unknown,
): Effect.Effect<unknown, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.encodeUnknownEffect(schema as Schema.Encoder<unknown>)(input)
    : Effect.succeed(input);

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
  readonly apply: (current: boolean) => Effect.Effect<void, ActionClientError>;
}

/** Identity of one durable submission, sent with every attempt. */
export interface ActionTransportSubmission {
  /**
   * The submission id. Servers deduplicate by it (with the Action name), so a
   * replayed attempt returns the original outcome instead of running again.
   */
  readonly id: string;
}

/**
 * Transport seam for Action submissions.
 *
 * Every Action instance looks this service up when it submits. Actions the
 * transport serves (`submit` returns `Option.some`) run remotely; every other
 * Action runs its `run` locally. UI code submits the same way either way; a
 * host (Start's `App.launch`) decides by providing this service in the
 * runtime layer.
 */
export interface ActionTransport {
  readonly submit: <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    input: I,
    /** Present for durable submissions: the idempotency key to send. */
    submission?: ActionTransportSubmission,
  ) => Option.Option<Effect.Effect<ActionTransportResponse<A, E>, ActionClientError>>;
}

export const ActionTransport = Context.Service<ActionTransport>(
  "@sunfall/arc-core/ActionTransport",
);
