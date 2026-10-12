import {
  type StateCommand,
  type StateCommandInput,
  type StateDefinition,
  type StateDispatchError,
  type StateFailure,
  type StateHandlerMap,
  type StateInstance,
  type StatePhase,
  type StateRef,
  StateDisposed,
  type StateRuntimeError,
  type StateStep,
  type StateSubscription,
  type StateSubscriptionInput,
  type StateTaggedMessage,
  type StateUpdate,
} from "./state-contract.js";
export {
  StateDisposed,
  StateCommandTypeId,
  StateStepTypeId,
  StateSubscriptionTypeId,
  StateRefTypeId,
  type StateCommand,
  type StateCommandInput,
  type StateDefinition,
  type StateDispatchError,
  type StateFailure,
  type StateHandlerMap,
  type StateInstance,
  type StatePhase,
  type StateRef,
  type StateRuntimeError,
  type StateStep,
  type StateSubscription,
  type StateSubscriptionInput,
  type StateTaggedMessage,
  type StateUpdate,
} from "./state-contract.js";
import {
  defineState,
  stateCommands,
  stateEmit,
  stateNext,
  stateStepSync,
  stateSubscription,
} from "./state-primitives.js";
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
  /** Runtime whose services satisfy the State's update, command, and subscription requirements. */
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
  Model,
  Message extends StateTaggedMessage,
  E = never,
  R = never,
  ER = never,
  RRuntime = R,
>(
  definition: StateDefinition<Model, Message, E, R>,
  options: StateRuntimeBoundStartOptions<R, RRuntime, ER>,
): StateInstance<Model, Message, StateRuntimeError<E, ER>, StateDispatchError<E, ER>> {
  return startStateOnRuntime(definition, options.runtime as AnySunfallArcRuntime<ER>);
}

/** Public namespace facade for defining, starting, testing, and typing States. */
export namespace State {
  /** Definition for a headless model/message loop with Effect-owned work. */
  export type Definition<
    Model,
    Message extends StateTaggedMessage,
    E = never,
    R = never,
  > = StateDefinition<Model, Message, E, R>;
  /**
   * A running State's model as an Action's `optimistic` transaction patches it:
   * a `State.Instance` or a `Component.state` handle.
   */
  export type Ref<Model> = StateRef<Model>;
  /** Running State handle with model, dispatch, failures, and disposal state. */
  export type Instance<Model, Message, E = never, DispatchE = E> = StateInstance<
    Model,
    Message,
    E,
    DispatchE
  >;
  /** Captured update, command, or subscription failure with triggering message context. */
  export type Failure<Message, E> = StateFailure<Message, E>;
  /** State failure channel plus Runtime Spine provision/startup failures. */
  export type RuntimeError<E, ER = never> = StateRuntimeError<E, ER>;
  /** Live dispatch failure channel, including disposal drops. */
  export type DispatchError<E, ER = never> = StateDispatchError<E, ER>;
  /** Error reported when an Effect dispatch cannot apply because the State was disposed. */
  export type Disposed = StateDisposed;
  /** Error reported when an Effect dispatch cannot apply because the State was disposed. */
  export const Disposed = StateDisposed;
  /** Tagged message shape every State message has. */
  export type TaggedMessage = StateTaggedMessage;
  /** Exhaustive pure handlers keyed by each message `_tag`. */
  export type HandlerMap<
    Model,
    Message extends StateTaggedMessage,
    E = never,
    R = never,
  > = StateHandlerMap<Model, Message, E, R>;
  /** Options for starting a State on an explicit typed Runtime Spine. */
  export type StartOptions<RRuntime = never, ER = never> = StateStartOptions<RRuntime, ER>;
  /** Services still required after applying a typed Runtime Spine to a State. */
  export type RuntimeRemainingRequirements<RIn, RProvided> = StateRuntimeRemainingRequirements<
    RIn,
    RProvided
  >;
  /** Visible runtime phase for a started State. */
  export type Phase = StatePhase;
  /** Value a message handler returns: the next model, or the next model plus commands. */
  export type Update<Model, Message, E = never, R = never> = StateUpdate<Model, Message, E, R>;
  /** Next model plus the commands a transition returned, unrun. */
  export type Step<Model, Message, E = never, R = never> = StateStep<Model, Message, E, R>;
  /** Effect-backed unit of State work that may emit a message. */
  export type Command<Message, E = never, R = never> = StateCommand<Message, E, R>;
  /** Accepted command input: no command, one command, many commands, or Effect command work. */
  export type CommandInput<Message, E = never, R = never> = StateCommandInput<Message, E, R>;
  /** Stream-backed external input attached to a State model generation. */
  export type Subscription<Message, E = never, R = never> = StateSubscription<Message, E, R>;
  /** Accepted subscription input: none, one subscription, or many subscriptions. */
  export type SubscriptionInput<Message, E = never, R = never> = StateSubscriptionInput<
    Message,
    E,
    R
  >;
  /**
   * Defines a State: a named model that changes only through its messages.
   *
   * `on` holds one pure handler per message `_tag`: it returns the next model,
   * or `State.next(model, commands)`. Effect work goes in commands, never in
   * handlers; Promise-shaped models and messages are rejected so async work
   * stays in the Effect runtime.
   *
   * The message union is inferred from `on`: each key is a tag, and a
   * handler's second parameter types that message's fields. When commands
   * emit the State's own messages, name the union up front with
   * `State.define<Model, Message>()({ ... })`.
   *
   * @example
   * ```ts
   * const MenuOpen = State.define({ name: "Menu.open", initial: false, on: { Toggle: (open) => !open } });
   * ```
   */
  export const define = defineState;
  /**
   * Applies one message to a model: a pure, synchronous call that returns the
   * next model and the commands the transition returned, without running
   * them. Run a command's `effect` to get the message it emits. This is how
   * State transitions are tested; no runtime, DOM, or timers are involved.
   *
   * @example
   * ```ts
   * const loading = State.step(Counter, Counter.initial, { _tag: "Load" });
   * expect(loading.commands).toHaveLength(1);
   * expect(Effect.runSync(loading.commands[0].effect)).toEqual({ _tag: "Loaded", count: 3 });
   * ```
   */
  export const step = stateStepSync;
  /** Starts a State on the current or explicit Runtime Spine and UI scope. */
  export const start = startState;
  /**
   * Returns a pure model update step, optionally with commands.
   *
   * The model must be plain. Promise-shaped models are rejected; move host
   * Promise work into `State.emit(Effect.tryPromise(...))` and emit a
   * follow-up message with the resolved value.
   */
  export const next = stateNext;
  /**
   * The one command constructor: emits a message, or runs an Effect after the
   * model commits and emits the message it produces. An Effect that completes
   * with `void` emits nothing, so background work is `State.emit(effect)`
   * too. Failures go to the State's error channel.
   *
   * Emitted messages must be plain values. Use `Effect.tryPromise(...)` inside
   * the Effect for host Promise work before mapping to a resolved message.
   */
  export const emit = stateEmit;
  /** Batches several commands (skipping `false`/`null`/`undefined`) for `State.next(model, ...)`. */
  export const commands = stateCommands;
  /**
   * Creates a Stream-backed subscription for model-driven external input.
   *
   * Stream emissions must be plain messages. Adapt host Promise sources with
   * `Effect.tryPromise(...)` before emitting into the State loop.
   */
  export const subscription = stateSubscription;
}
