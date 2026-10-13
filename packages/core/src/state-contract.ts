import { Data, type Effect, type Schema } from "effect";
import type { Machine } from "effect-machine";
import type { EffectInputCallbackError } from "./effect-like.js";
import type { ReadableSignal, WritableSignal } from "./signal.js";

/** Runtime marker carrying a running State's model cell (`State.Ref`). */
export const StateRefTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/StateRef",
) as typeof StateRefTypeId;

/**
 * Runtime phase that produced a State failure: a message the event schema
 * rejects or a defect in a transition (`Update`), a defect in state-owned
 * work (`Work`), or a server snapshot the state schema rejects (`Hydrate`).
 */
export type StatePhase = "Update" | "Work" | "Hydrate";

/** Tagged shape every model variant and message has. */
export interface StateTagged {
  readonly _tag: string;
}

/**
 * An effect-machine `Machine` a State runs: schema-first model variants and
 * messages (`Model({...})`, `Event({...})`), transitions keyed by (variant,
 * message), and state-owned work. Arc runs machines built without `Input`.
 */
export type StateMachine<Model, Message, R = never> = Machine.Machine<
  Model,
  Message,
  R,
  any,
  any,
  void,
  any
>;

/** Failure reported by a running State without tearing down its loop. */
export interface StateFailure<Message, E> {
  readonly _tag: "StateFailure";
  readonly phase: StatePhase;
  readonly message?: Message;
  readonly error: E;
}

/**
 * A defect in a transition or in state-owned work, as the machine's
 * inspector reported it. Expected failures are messages (`task`'s
 * `onFailure`), so this is always a bug. The defect stops the State:
 * later `dispatch`es fail with `phase: "stopped"` and `can()` answers false.
 */
export class StateDefect extends Data.TaggedError("StateDefect")<{
  readonly phase: "transition" | "spawn" | "stopped";
  readonly description: string;
}> {}

/**
 * Who owns the instance a renderer binding (`Component.state`) returns:
 * `"component"` (the default) gives each binding Component instance its own;
 * `"app"` gives the runtime one, shared by every binding (one per request
 * during a server render, hydrated in the browser from the server's model).
 */
export type StateScope = "component" | "app";

/**
 * Where a State's model persists in the runtime's `KeyValueStore`
 * (`effect/persistence`): `arc/states/v<version>/<key>`.
 */
export interface StatePersistOptions {
  /** Store key for the model. */
  readonly key: string;
  /**
   * Format version folded into the key; defaults to `1`. Bump it when the
   * model changes shape: a model under the old key is never read.
   */
  readonly version?: number;
}

/** A State definition: a named machine Arc runs, records, hydrates, and binds. */
export interface StateDefinition<Model, Message, R = never> {
  /** Stable name: labels the model on the `Timeline` and names its `State` causes. */
  readonly name: string;
  /** Who owns the instance `Component.state` returns. */
  readonly scope: StateScope;
  /**
   * The machine: its model and message schemas, transitions, and work. `R`
   * is what its transitions and work need, plus the `KeyValueStore` a
   * persisted State needs.
   */
  readonly machine: StateMachine<Model, Message, R>;
  readonly persist: StatePersistOptions | undefined;
}

/** State failures: a rejected value, a defect, or a runtime startup failure. */
export type StateError<ER = never> =
  | EffectInputCallbackError
  | Schema.SchemaError
  | StateDefect
  | ER;

/** Error channel for live `dispatch(...)`, including disposal drops. */
export type StateDispatchError<ER = never> = StateError<ER> | StateDisposed;

/**
 * Error reported when `dispatch(...)` cannot apply because the State
 * was disposed before the message was processed.
 */
export class StateDisposed extends Data.TaggedError("StateDisposed")<{
  readonly reason: string;
}> {}

/**
 * A running State's model, as an Action's `optimistic` transaction patches it
 * (`transaction.set(state, update)`). Every `State.Instance` and
 * `Component.state` handle is one.
 */
export interface StateRef<Model> {
  /** The model cell; written only by the State's machine and optimistic layers. */
  readonly [StateRefTypeId]: WritableSignal<Model>;
}

/** Running State handle with model state, dispatch, failure, and disposal APIs. */
export interface StateInstance<Model, Message, ER = never> extends StateRef<Model> {
  /** The model: the machine's state, committed on Arc's Timeline. */
  readonly model: ReadableSignal<Model>;
  /** Accumulated failures: rejected values, defects, startup failures. */
  readonly failures: ReadableSignal<ReadonlyArray<StateFailure<Message, StateError<ER>>>>;
  /**
   * Effect dispatch that completes once the machine has processed the
   * message: applied (one Timeline entry with the model change) or ignored
   * (no transition for it in the current variant; one `ignored` entry).
   *
   * If disposal happens first, the Effect fails with a `StateFailure` whose
   * error is `StateDisposed`.
   */
  dispatch(message: Message): Effect.Effect<void, StateFailure<Message, StateDispatchError<ER>>>;
  /**
   * True when the current variant has a transition for `message` whose guard
   * passes. Reads the model, so it is reactive.
   */
  can(message: Message): boolean;
  /** Clears accumulated failures. */
  clearFailures(): void;
  /** Stops the machine, interrupting its work. */
  dispose: Effect.Effect<void>;
}

/** One instance's recorded messages, as `State.history` reads them from a Timeline. */
export interface StateHistory<Model, Message> {
  /** The instance's Timeline id (`Timeline.StateCause["instance"]`). */
  readonly instance: number;
  /** The model the instance started from: initial, hydrated, or restored. */
  readonly from: Model;
  /** Every message it processed, oldest first: replay them with `Machine.replay`. */
  readonly messages: ReadonlyArray<{
    readonly sequence: number;
    readonly message: Message;
    readonly ignored: boolean;
  }>;
}

/** Encoded model of an app State, carried from a server render to the browser. */
export interface StateSnapshot {
  readonly name: string;
  /** The model encoded through the machine's state schema. */
  readonly model: unknown;
}
