import { Context, Data, Effect, type Cause, type Duration, type Schedule } from "effect";
import type { ActionDefinition } from "./action.js";
import type { ServerClientError } from "./server.js";
import { ServerTransportError } from "./server-wire-codec.js";
import { Signal, type ReadableSignal } from "./signal.js";

/**
 * Durability policy for `Action.define({ durable })`.
 *
 * A durable Action persists each submission (its schema-encoded input) in the
 * runtime's Action Outbox before sending it, keeps its optimistic patch applied
 * while it is pending (across reloads), and replays it in order until it
 * settles.
 */
export interface ActionDurablePolicy {
  /**
   * How long a pending submission may wait before replaying it is no longer
   * safe. A submission older than this settles as `ActionSubmissionExpired`
   * instead of being sent.
   */
  readonly maxAge: Duration.Input;
}

/**
 * A durable submission that could not settle while its caller waited: it is
 * persisted in the Action Outbox, its optimistic patch stays applied, and the
 * outbox replays it when connectivity returns. Its final outcome lands in the
 * outbox (`Action.outbox`): `pending` drops it, and a final failure appears
 * in `failures`.
 */
export class ActionQueued extends Data.TaggedError("ActionQueued")<{
  readonly actionName: string;
  /** The submission id, also its idempotency key. */
  readonly id: string;
}> {}

/** A pending durable submission that outlived its Action's `durable.maxAge`. */
export class ActionSubmissionExpired extends Data.TaggedError("ActionSubmissionExpired")<{
  readonly actionName: string;
  readonly id: string;
  readonly createdAt: number;
}> {}

/**
 * A persisted submission the outbox cannot replay: its Action is not defined
 * (or no longer durable) in this build, or its stored input no longer decodes
 * through the Action's input schema.
 */
export class ActionSubmissionUnrestorable extends Data.TaggedError("ActionSubmissionUnrestorable")<{
  readonly actionName: string;
  readonly id: string;
  readonly reason: "UnknownAction" | "InvalidInput";
  readonly cause?: unknown;
}> {}

/** Options for `Action.outboxLayer`. */
export interface ActionOutboxOptions {
  /**
   * Backoff between replay passes while the head submission keeps failing
   * retryably. Once it is exhausted the outbox waits for the next trigger (an
   * `online` event, a new durable submission, or a relaunch). Defaults to
   * exponential from 1 second, up to 10 retries.
   */
  readonly retry?: Schedule.Schedule<unknown, unknown>;
}

/**
 * Whether a durable submission's failure leaves it pending for replay:
 * transport failures that say nothing about the Action itself (offline,
 * aborted, timeouts, rate limits, unavailable servers). Typed domain
 * failures, protocol failures, and defects are final.
 */
export const isRetryableActionFailure = (error: unknown): boolean => {
  if (!(error instanceof ServerTransportError)) {
    return false;
  }
  if (error.reason === "Network" || error.reason === "Interrupted") {
    return true;
  }
  const status = error.status;
  return (
    error.reason !== "Defect" &&
    status !== undefined &&
    (status === 408 || status === 429 || status >= 500)
  );
};

/** One pending durable submission, as the outbox reports it. */
export interface ActionOutboxEntry {
  /** Submission id, sent with every attempt as its idempotency key. */
  readonly id: string;
  readonly action: string;
  /** Decoded submission input. */
  readonly input: unknown;
  /** `Clock` time the submission was made. */
  readonly createdAt: number;
  /** Send attempts so far. */
  readonly attempts: number;
}

/**
 * A durable submission that settled with a failure after its caller stopped
 * waiting (it was queued, or restored on launch). Its optimistic patch was
 * rolled back. Failures that settle while the caller waits go to the caller.
 */
export interface ActionOutboxFailure extends ActionOutboxEntry {
  /**
   * Why it failed: the Action's typed failure or a non-retryable transport
   * failure, `ActionSubmissionExpired`, `ActionSubmissionUnrestorable`, or a
   * defect.
   */
  readonly cause: Cause.Cause<unknown>;
}

/** Read side of the Action Outbox, for UI such as "3 changes waiting to sync". */
export interface ActionOutboxView {
  /** Pending durable submissions in replay order. */
  readonly pending: ReadableSignal<ReadonlyArray<ActionOutboxEntry>>;
  /** Final failures of submissions nobody was waiting on, oldest first. */
  readonly failures: ReadableSignal<ReadonlyArray<ActionOutboxFailure>>;
  /** Removes one failure from `failures` once the UI has shown it. */
  readonly dismiss: (id: string) => Effect.Effect<void>;
}

/**
 * The runtime's Action Outbox: persists durable Action submissions in the
 * runtime's `KeyValueStore` (`effect/persistence`), under the key
 * `arc/actions/v1/queue`, and replays them in global FIFO order. Provided by `Action.outboxLayer(...)`
 * (Start's `App.launch` provides one); UI reads it through `Action.outbox`.
 */
export interface ActionOutbox extends ActionOutboxView {
  /**
   * Persists and sends one durable submission. Succeeds or fails with the
   * submission's outcome when it settles while the caller waits, or fails with
   * `ActionQueued` once a retryable failure leaves it pending.
   */
  readonly submit: <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    input: I,
  ) => Effect.Effect<A, E | ServerClientError | ActionQueued>;
  /**
   * Restores persisted submissions once: re-applies their optimistic patches
   * in order on top of the current (hydrated) state and starts replaying them.
   */
  readonly restore: Effect.Effect<void>;
}

export const ActionOutbox = Context.Service<ActionOutbox>("@sunfall/arc-core/ActionOutbox");

const emptyPending = Signal.make<ReadonlyArray<ActionOutboxEntry>>([], {
  name: "ActionOutbox.pending",
});
const emptyFailures = Signal.make<ReadonlyArray<ActionOutboxFailure>>([], {
  name: "ActionOutbox.failures",
});

/** The view a runtime without an outbox (a server render) reports: nothing pending. */
export const emptyActionOutboxView: ActionOutboxView = {
  pending: emptyPending,
  failures: emptyFailures,
  dismiss: () => Effect.void,
};
