import {
  type StateDefinition,
  type StateDispatchError,
  type StateError,
  type StateFailure,
  type StateHistory,
  type StateInstance,
  type StateMachine,
  type StatePersistOptions,
  type StatePhase,
  type StateScope,
  type StateRef,
  StateDefect,
  StateDisposed,
  type StateTagged,
} from "./state-contract.js";
export {
  StateDefect,
  StateDisposed,
  StateRefTypeId,
  type StateDefinition,
  type StateDispatchError,
  type StateError,
  type StateFailure,
  type StateHistory,
  type StateInstance,
  type StateMachine,
  type StatePersistOptions,
  type StatePhase,
  type StateScope,
  type StateRef,
  type StateTagged,
} from "./state-contract.js";
import { defineState, stateHistory } from "./state-primitives.js";
import { startStateOnRuntime } from "./state-start.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";
import type { AnySunfallArcRuntime, SunfallArcRuntime } from "./runtime.js";

type StateRuntimeProvidedRequirements<R> = R | ResourceStoreState;
type StateRuntimeRemainingRequirements<RIn, RProvided> = Exclude<
  RIn,
  StateRuntimeProvidedRequirements<RProvided>
>;
type StateRuntimeSatisfied<RIn, RProvided> = [
  StateRuntimeRemainingRequirements<RIn, RProvided>,
] extends [never]
  ? unknown
  : never;

/** Options for starting a State on an explicit typed Runtime Spine. */
export interface StateStartOptions<RRuntime = never, ER = never> {
  /** Runtime whose services satisfy the machine's transition, work, and persistence requirements. */
  readonly runtime: SunfallArcRuntime<RRuntime, ER>;
}

type StateRuntimeBoundStartOptions<R, RRuntime, ER> = {
  readonly runtime: SunfallArcRuntime<RRuntime, ER> & StateRuntimeSatisfied<R, RRuntime>;
};

/**
 * Starts a State on an explicit typed Runtime Spine.
 *
 * Runtime startup/provision errors are added to the State failure channel,
 * and only services supplied by the runtime are discharged from the State
 * definition requirements. UI code binds States with its renderer adapter
 * (Solid's `Component.state(...)`), which supplies the runtime.
 */
function startState<
  Model extends StateTagged,
  Message extends StateTagged,
  R = never,
  ER = never,
  RRuntime = R,
>(
  definition: StateDefinition<Model, Message, R>,
  options: StateRuntimeBoundStartOptions<R, RRuntime, ER>,
): StateInstance<Model, Message, ER> {
  return startStateOnRuntime(definition, options.runtime as AnySunfallArcRuntime<ER>);
}

/**
 * Arc's binding for client state machines. A State is a named
 * effect-machine `Machine` (re-exported as `Machine`, `Model`, and `Message`):
 * Arc runs it as an actor on the runtime, commits each message it processes
 * on the Timeline, hydrates app States from the server render, persists
 * models, lets Actions overlay them optimistically, and binds them to
 * Components.
 */
export namespace State {
  /** A State definition: a named machine Arc runs, records, hydrates, and binds. */
  export type Definition<Model, Message, R = never> = StateDefinition<Model, Message, R>;
  /** Tagged shape every model variant and message has. */
  export type Tagged = StateTagged;
  /**
   * The fields of the message tagged `Tag`, as a sender takes them: without
   * its tag and the machine's type brands.
   */
  export type MessageFields<Message, Tag> = {
    readonly [K in keyof Extract<Message, { readonly _tag: Tag }> as K extends
      | "_tag"
      | "~effect/Brand"
      | "_ReplyType"
      ? never
      : K]: Extract<Message, { readonly _tag: Tag }>[K];
  };
  /** The machine a State runs. */
  export type Machine<Model, Message, R = never> = StateMachine<Model, Message, R>;
  /** A definition's model type. */
  export type Model<D> = D extends StateDefinition<infer Model, any, any> ? Model : never;
  /** A definition's message union. */
  export type Message<D> = D extends StateDefinition<any, infer Message, any> ? Message : never;
  /**
   * A running State's model as an Action's `optimistic` transaction patches it:
   * a `State.Instance` or a `Component.state` handle.
   */
  export type Ref<Model> = StateRef<Model>;
  /** Running State handle with model, dispatch, failures, and disposal state. */
  export type Instance<Model, Message, ER = never> = StateInstance<Model, Message, ER>;
  /** Captured failure with the phase and triggering message. */
  export type Failure<Message, E> = StateFailure<Message, E>;
  /**
   * What a State can fail with: a message its schema rejects, a defect in a
   * transition or in work, a server snapshot its schema rejects, or a runtime
   * startup failure (`ER`). Expected failures are messages, never errors.
   */
  export type Error<ER = never> = StateError<ER>;
  /** Live dispatch failure channel, including disposal drops. */
  export type DispatchError<ER = never> = StateDispatchError<ER>;
  /** A defect in a transition or in state-owned work. */
  export type Defect = StateDefect;
  /** A defect in a transition or in state-owned work. */
  export const Defect = StateDefect;
  /** Error reported when an Effect dispatch cannot apply because the State was disposed. */
  export type Disposed = StateDisposed;
  /** Error reported when an Effect dispatch cannot apply because the State was disposed. */
  export const Disposed = StateDisposed;
  /** Options for starting a State on an explicit typed Runtime Spine. */
  export type StartOptions<RRuntime = never, ER = never> = StateStartOptions<RRuntime, ER>;
  /** Services still required after applying a typed Runtime Spine to a State. */
  export type RuntimeRemainingRequirements<RIn, RProvided> = StateRuntimeRemainingRequirements<
    RIn,
    RProvided
  >;
  /** Runtime phase that produced a failure. */
  export type Phase = StatePhase;
  /**
   * Who owns the instance `Component.state` binds: each Component instance
   * (`"component"`, the default) or the runtime (`"app"`, one shared instance
   * per runtime, so one per request during a server render).
   */
  export type Scope = StateScope;
  /** Where a persisted State's model is kept in the runtime's `KeyValueStore`. */
  export type PersistOptions = StatePersistOptions;
  /** One instance's recorded messages, from `State.history`. */
  export type History<Model, Message> = StateHistory<Model, Message>;

  /**
   * Defines a State: a name for a machine, and who owns its instance.
   *
   * The machine is schema-first: `Model({...})` lists the model's variants
   * and `Event({...})` its messages, each an Effect Schema, so a model is
   * validated, serializable data. Transitions are keyed by (variant,
   * message): a message the current variant does not handle is ignored and
   * recorded as such. Work a variant owns (`task`, `spawn`) starts on entry
   * and is interrupted on exit, and its failures become messages: its error
   * channel is `never`. Name messages for what happened (`ClickedSave`,
   * `ReceivedProject`, `TypedQuery`).
   *
   * `scope: "app"` makes every `Component.state` binding share the runtime's
   * one instance (a toast); a server render gets one per request and the
   * browser starts it from the server's model. `persist` keeps the model in
   * the runtime's `KeyValueStore` and restores it when the State starts.
   *
   * @example
   * ```ts
   * const MenuModel = Model({ Closed: {}, Open: {} });
   * const MenuEvent = Event({ ClickedMenu: {} });
   *
   * const Menu = State.define({
   *   name: "Menu",
   *   machine: Machine.make({ state: MenuModel, event: MenuEvent, initial: MenuModel.Closed })
   *     .on(MenuModel.Closed, MenuEvent.ClickedMenu, () => MenuModel.Open)
   *     .on(MenuModel.Open, MenuEvent.ClickedMenu, () => MenuModel.Closed),
   * });
   * ```
   */
  export const define = defineState;
  /**
   * Reads each instance of a State from Timeline entries: the model it
   * started from (initial, the server's, or a restored one) and every message
   * it processed. `Machine.replay(definition.machine, messages, { from })`
   * re-applies them without a runtime.
   */
  export const history = stateHistory;
  /**
   * Starts a new State instance on an explicit Runtime Spine (and the current
   * UI scope, when there is one) for headless code and tests, whatever the
   * definition's `scope`: the caller owns it.
   */
  export const start = startState;
}
