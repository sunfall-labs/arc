import {
  type ProgramCommand,
  type ProgramCommandInput,
  type ProgramDefinition,
  type ProgramDispatchError,
  type ProgramFailure,
  type ProgramHandlerDefinition,
  type ProgramHandlerMap,
  type ProgramInstance,
  type ProgramPhase,
  ProgramDisposed,
  type ProgramRuntimeError,
  type ProgramStep,
  type ProgramStory,
  type ProgramStoryEntry,
  type ProgramStoryOptions,
  type ProgramSubscription,
  type ProgramSubscriptionInput,
  type ProgramTaggedMessage,
  type ProgramUpdate,
} from "./program-contract.js";
export {
  ProgramDisposed,
  ProgramCommandTypeId,
  ProgramStepTypeId,
  ProgramSubscriptionTypeId,
  type ProgramCommand,
  type ProgramCommandInput,
  type ProgramDefinition,
  type ProgramDispatchError,
  type ProgramFailure,
  type ProgramHandlerDefinition,
  type ProgramHandlerMap,
  type ProgramInstance,
  type ProgramPhase,
  type ProgramRuntimeError,
  type ProgramStep,
  type ProgramStory,
  type ProgramStoryEntry,
  type ProgramStoryOptions,
  type ProgramSubscription,
  type ProgramSubscriptionInput,
  type ProgramTaggedMessage,
  type ProgramUpdate,
  type ProgramUpdateError,
  type ProgramUpdateRequirements,
  type ProgramSubscriptionError,
  type ProgramSubscriptionRequirements,
} from "./program-contract.js";
import {
  defineProgram,
  programCommands,
  programEmit,
  programNext,
  programStepEffect,
  programSubscription,
  programUpdate,
} from "./program-primitives.js";
import { startProgramOnRuntime } from "./program-start.js";
import { makeProgramStory } from "./program-story.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";
import type { AnySunfallArcRuntime, SunfallArcRuntime } from "./runtime.js";

type ProgramRuntimeProvidedRequirements<R> = R | ResourceStoreState;
type ProgramRuntimeRemainingRequirements<RIn, RProvided> = Exclude<
  RIn,
  ProgramRuntimeProvidedRequirements<RProvided>
>;
type ProgramRuntimeSatisfied<RIn, RProvided> = [
  ProgramRuntimeRemainingRequirements<RIn, RProvided>,
] extends [never]
  ? unknown
  : never;

/** Options for starting a Program on an explicit typed Runtime Spine. */
export interface ProgramStartOptions<RRuntime = never, ER = never> {
  /** Runtime whose services satisfy the Program's update, command, and subscription requirements. */
  readonly runtime: SunfallArcRuntime<RRuntime, ER>;
}

type ProgramRuntimeBoundStartOptions<R, RRuntime, ER> = {
  readonly runtime: SunfallArcRuntime<RRuntime, ER> & ProgramRuntimeSatisfied<R, RRuntime>;
};
/**
 * Starts a Program on an explicit typed Runtime Spine.
 *
 * Runtime startup/provision errors are added to the Program failure channel,
 * and only services supplied by the runtime are discharged from the Program
 * definition requirements. UI code binds Programs with its renderer adapter
 * (Solid's `Component.program(...)`), which supplies the runtime.
 */
function startProgram<Model, Message, E = never, R = never, ER = never, RRuntime = R>(
  definition: ProgramDefinition<Model, Message, E, R>,
  options: ProgramRuntimeBoundStartOptions<R, RRuntime, ER>,
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>> {
  return startProgramOnRuntime(definition, options.runtime as AnySunfallArcRuntime<ER>);
}

/** Public namespace facade for defining, starting, testing, and typing Programs. */
export namespace Program {
  /** Definition for a headless model/message loop with Effect-owned work. */
  export type Definition<Model, Message, E = never, R = never> = ProgramDefinition<
    Model,
    Message,
    E,
    R
  >;
  /** Running Program handle with model, dispatch, failures, and disposal state. */
  export type Instance<Model, Message, E = never, DispatchE = E> = ProgramInstance<
    Model,
    Message,
    E,
    DispatchE
  >;
  /** Captured update, command, or subscription failure with triggering message context. */
  export type Failure<Message, E> = ProgramFailure<Message, E>;
  /** Program failure channel plus Runtime Spine provision/startup failures. */
  export type RuntimeError<E, ER = never> = ProgramRuntimeError<E, ER>;
  /** Live dispatch failure channel, including disposal drops. */
  export type DispatchError<E, ER = never> = ProgramDispatchError<E, ER>;
  /** Error reported when an Effect dispatch cannot apply because the Program was disposed. */
  export type Disposed = ProgramDisposed;
  /** Plain message shape for tag-indexed Program handler maps. */
  export type TaggedMessage = ProgramTaggedMessage;
  /** Exhaustive handlers keyed by each tagged message `_tag`. */
  export type HandlerMap<
    Model,
    Message extends ProgramTaggedMessage,
    E = never,
    R = never,
  > = ProgramHandlerMap<Model, Message, E, R>;
  /** Definition shorthand that replaces `update` with an exhaustive `on` handler map. */
  export type HandlerDefinition<
    Model,
    Message extends ProgramTaggedMessage,
    E = never,
    R = never,
  > = ProgramHandlerDefinition<Model, Message, E, R>;
  /** Options for starting a Program on an explicit typed Runtime Spine. */
  export type StartOptions<RRuntime = never, ER = never> = ProgramStartOptions<RRuntime, ER>;
  /** Services still required after applying a typed Runtime Spine to a Program. */
  export type RuntimeRemainingRequirements<RIn, RProvided> = ProgramRuntimeRemainingRequirements<
    RIn,
    RProvided
  >;
  /** Visible runtime phase for a started Program. */
  export type Phase = ProgramPhase;
  /** User update callback shape for model/message transitions. */
  export type Update<Model, Message, E = never, R = never> = ProgramUpdate<Model, Message, E, R>;
  /** Pure model step plus commands returned by Program updates or stories. */
  export type Step<Model, Message, E = never, R = never> = ProgramStep<Model, Message, E, R>;
  /** Effect-backed unit of Program work that may emit a message. */
  export type Command<Message, E = never, R = never> = ProgramCommand<Message, E, R>;
  /** Accepted command input: no command, one command, many commands, or Effect command work. */
  export type CommandInput<Message, E = never, R = never> = ProgramCommandInput<Message, E, R>;
  /** Stream-backed external input attached to a Program model generation. */
  export type Subscription<Message, E = never, R = never> = ProgramSubscription<Message, E, R>;
  /** Accepted subscription input: none, one subscription, or many subscriptions. */
  export type SubscriptionInput<Message, E = never, R = never> = ProgramSubscriptionInput<
    Message,
    E,
    R
  >;
  /** One deterministic story assertion step for Program tests and docs. */
  export type StoryEntry<Model, Message, E = never, R = never> = ProgramStoryEntry<
    Model,
    Message,
    E,
    R
  >;
  /** Deterministic Program story runner that executes updates without live subscriptions. */
  export type Story<Model, Message, E = never, R = never> = ProgramStory<Model, Message, E, R>;
  /** Options for deterministic story execution. */
  export type StoryOptions<Model> = ProgramStoryOptions<Model>;

  /**
   * Defines a headless model/message Program.
   *
   * The update callback returns an Effect or pure step; Promise-shaped models
   * and messages are rejected so async work stays in the Effect runtime.
   */
  export const define = defineProgram;
  /** Builds an update callback from exhaustive tagged-message handlers. */
  export const update = programUpdate;
  /** Runs one Program update deterministically without starting subscriptions. */
  export const step = programStepEffect;
  /** Creates a deterministic Program story for tests and examples. */
  export const story = makeProgramStory;
  /** Starts a Program on the current or explicit Runtime Spine and UI scope. */
  export const start = startProgram;
  /**
   * Returns a pure model update step, optionally with commands.
   *
   * The model must be plain. Promise-shaped models are rejected; move host
   * Promise work into `Program.emit(Effect.tryPromise(...))` and emit a
   * follow-up message with the resolved value.
   */
  export const next = programNext;
  /**
   * The one command constructor: emits a message, or runs an Effect after the
   * model commits and emits the message it produces. An Effect that completes
   * with `void` emits nothing, so background work is `Program.emit(effect)`
   * too. Failures go to the Program's error channel.
   *
   * Emitted messages must be plain values. Use `Effect.tryPromise(...)` inside
   * the Effect for host Promise work before mapping to a resolved message.
   */
  export const emit = programEmit;
  /** Batches several commands (skipping `false`/`null`/`undefined`) for `Program.next(model, ...)`. */
  export const commands = programCommands;
  /**
   * Creates a Stream-backed subscription for model-driven external input.
   *
   * Stream emissions must be plain messages. Adapt host Promise sources with
   * `Effect.tryPromise(...)` before emitting into the Program loop.
   */
  export const subscription = programSubscription;
}
