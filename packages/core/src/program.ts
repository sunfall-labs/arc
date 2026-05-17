import {
  type ProgramCommand,
  type ProgramCommandCompletedEvent,
  type ProgramCommandFailedEvent,
  type ProgramCommandInput,
  type ProgramCommandStartedEvent,
  type ProgramDefinition,
  type ProgramDispatchError,
  type ProgramDisposedEvent,
  type ProgramEvent,
  type ProgramEventBase,
  type ProgramFailure,
  type ProgramInstance,
  type ProgramMessageEvent,
  type ProgramPhase,
  ProgramDisposed,
  type ProgramRuntimeError,
  type ProgramStep,
  type ProgramStory,
  type ProgramStoryEntry,
  type ProgramStoryOptions,
  type ProgramSubscription,
  type ProgramSubscriptionEmittedEvent,
  type ProgramSubscriptionFailedEvent,
  type ProgramSubscriptionInput,
  type ProgramSubscriptionStartedEvent,
  type ProgramTimelineOptions,
  type ProgramUpdate,
  type ProgramUpdateFailedEvent,
  ProgramCommandTypeId,
  ProgramStepTypeId,
  ProgramSubscriptionTypeId
} from "./program-contract.js";
export {
  ProgramDisposed,
  ProgramCommandTypeId,
  ProgramStepTypeId,
  ProgramSubscriptionTypeId,
  type ProgramCommand,
  type ProgramCommandCompletedEvent,
  type ProgramCommandFailedEvent,
  type ProgramCommandInput,
  type ProgramCommandStartedEvent,
  type ProgramDefinition,
  type ProgramDispatchError,
  type ProgramDisposedEvent,
  type ProgramEvent,
  type ProgramEventBase,
  type ProgramFailure,
  type ProgramInstance,
  type ProgramMessageEvent,
  type ProgramPhase,
  type ProgramRuntimeError,
  type ProgramStep,
  type ProgramStory,
  type ProgramStoryEntry,
  type ProgramStoryOptions,
  type ProgramSubscription,
  type ProgramSubscriptionEmittedEvent,
  type ProgramSubscriptionFailedEvent,
  type ProgramSubscriptionInput,
  type ProgramSubscriptionStartedEvent,
  type ProgramTimelineOptions,
  type ProgramUpdate,
  type ProgramUpdateError,
  type ProgramUpdateRequirements,
  type ProgramSubscriptionError,
  type ProgramSubscriptionRequirements,
  type ProgramUpdateFailedEvent
} from "./program-contract.js";
import {
  defineProgram,
  programCommand,
  programCommands,
  programDispatch,
  programEffect,
  programNext,
  programStepEffect,
  programSubscription
} from "./program-primitives.js";
export {
  defineProgram,
  programCommand,
  programCommands,
  programDispatch,
  programEffect,
  programNext,
  programStepEffect,
  programSubscription
} from "./program-primitives.js";
import { makeProgramRuntimeInstance } from "./program-runtime.js";
import { makeProgramStory } from "./program-story.js";
export { makeProgramStory } from "./program-story.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";
import { currentOrDefaultRuntime, type AnyEffectUiRuntime, type EffectUiRuntime } from "./runtime.js";
import { getCurrentScope } from "./scope.js";

type ProgramRuntimeProvidedRequirements<R> = R | ResourceStoreState;
type ProgramRuntimeRemainingRequirements<RIn, RProvided> =
  Exclude<RIn, ProgramRuntimeProvidedRequirements<RProvided>>;
type ProgramRuntimeSatisfied<RIn, RProvided> =
  [ProgramRuntimeRemainingRequirements<RIn, RProvided>] extends [never] ? unknown : never;

/** Options for starting a Program on an explicit typed Runtime Spine. */
export interface ProgramStartOptions<RRuntime = never, ER = never> {
  /** Runtime whose services satisfy the Program's update, command, and subscription requirements. */
  readonly runtime: EffectUiRuntime<RRuntime, ER>;
}

type ProgramRuntimeBoundStartOptions<R, RRuntime, ER> = {
  readonly runtime: EffectUiRuntime<RRuntime, ER> & ProgramRuntimeSatisfied<R, RRuntime>;
};
type ProgramStartImplementationOptions<ER> = {
  readonly runtime?: AnyEffectUiRuntime<ER>;
};

const startProgramImplementation = <Model, Message, E = never, ER = never>(
  definition: ProgramDefinition<Model, Message, E, never>,
  options?: ProgramStartImplementationOptions<ER>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>> => {
  const runtime = (options?.runtime ?? currentOrDefaultRuntime()) as AnyEffectUiRuntime<ER>;
  const scope = getCurrentScope();
  return makeProgramRuntimeInstance<Model, Message, E, never, ER>({
    definition,
    runtime,
    scope
  });
};

/**
 * Starts a service-free Program against the current Effect UI runtime and optional UI scope.
 *
 * Programs whose update, command, or subscription Effects require services must
 * use `Program.start(definition, { runtime })` so TypeScript can verify the
 * Runtime Spine provides those services.
 */
export function startProgram<Model, Message, E = never>(
  definition: ProgramDefinition<Model, Message, E, never>
): ProgramInstance<Model, Message, ProgramRuntimeError<E>, ProgramDispatchError<E>>;
/**
 * Starts a Program on an explicit typed Runtime Spine.
 *
 * Runtime startup/provision errors are added to the Program failure channel,
 * and only services supplied by the runtime are discharged from the Program
 * definition requirements.
 */
export function startProgram<
  Model,
  Message,
  E = never,
  R = never,
  ER = never,
  RRuntime = R
>(
  definition: ProgramDefinition<Model, Message, E, R>,
  options: ProgramRuntimeBoundStartOptions<R, RRuntime, ER>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>>;
export function startProgram<
  Model,
  Message,
  E = never,
  ER = never
>(
  definition: unknown,
  options?: ProgramStartImplementationOptions<ER>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>> {
  return startProgramImplementation(
    definition as ProgramDefinition<Model, Message, E, never>,
    options
  );
}

/**
 * Starts a Program while preserving Runtime Spine startup/provision errors in
 * the returned failure channel.
 */
export function startProgramWithRuntimeError<Model, Message, E = never>(
  definition: ProgramDefinition<Model, Message, E, never>
): ProgramInstance<Model, Message, ProgramRuntimeError<E>, ProgramDispatchError<E>>;
export function startProgramWithRuntimeError<
  Model,
  Message,
  E = never,
  R = never,
  ER = never,
  RRuntime = R
>(
  definition: ProgramDefinition<Model, Message, E, R>,
  options: ProgramRuntimeBoundStartOptions<R, RRuntime, ER>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>>;
export function startProgramWithRuntimeError<
  Model,
  Message,
  E = never,
  ER = never
>(
  definition: unknown,
  options?: ProgramStartImplementationOptions<ER>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>, ProgramDispatchError<E, ER>> {
  return startProgramImplementation(
    definition as ProgramDefinition<Model, Message, E, never>,
    options
  );
}

/** Public namespace facade for defining, starting, testing, and typing Programs. */
export namespace Program {
  /** Definition for a headless model/message loop with Effect-owned work. */
  export type Definition<Model, Message, E = never, R = never> = ProgramDefinition<Model, Message, E, R>;
  /** Running Program handle with model, dispatch, timeline, and disposal state. */
  export type Instance<Model, Message, E = never, DispatchE = E> = ProgramInstance<Model, Message, E, DispatchE>;
  /** Captured update, command, or subscription failure with triggering message context. */
  export type Failure<Message, E> = ProgramFailure<Message, E>;
  /** Program failure channel plus Runtime Spine provision/startup failures. */
  export type RuntimeError<E, ER = never> = ProgramRuntimeError<E, ER>;
  /** Live dispatch failure channel, including disposal drops. */
  export type DispatchError<E, ER = never> = ProgramDispatchError<E, ER>;
  /** Error reported when an Effect dispatch cannot apply because the Program was disposed. */
  export type Disposed = ProgramDisposed;
  /** Options for starting a Program on an explicit typed Runtime Spine. */
  export type StartOptions<RRuntime = never, ER = never> = ProgramStartOptions<RRuntime, ER>;
  /** Services still required after applying a typed Runtime Spine to a Program. */
  export type RuntimeRemainingRequirements<RIn, RProvided> = ProgramRuntimeRemainingRequirements<RIn, RProvided>;
  /** Timeline retention settings for Program runtime events. */
  export type TimelineOptions = ProgramTimelineOptions;
  /** Union of message, command, subscription, failure, and disposal timeline events. */
  export type Event<Model, Message, E = never> = ProgramEvent<Model, Message, E>;
  /** Shared metadata carried by every Program timeline event. */
  export type EventBase = ProgramEventBase;
  /** Timeline event recorded when a message is committed. */
  export type MessageEvent<Model, Message> = ProgramMessageEvent<Model, Message>;
  /** Timeline event recorded before a command fiber starts. */
  export type CommandStartedEvent<Message> = ProgramCommandStartedEvent<Message>;
  /** Timeline event recorded when a command emits a follow-up message or completes empty. */
  export type CommandCompletedEvent<Message> = ProgramCommandCompletedEvent<Message>;
  /** Timeline event recorded when a command fails through the Program error channel. */
  export type CommandFailedEvent<Message, E> = ProgramCommandFailedEvent<Message, E>;
  /** Timeline event recorded when an update callback fails. */
  export type UpdateFailedEvent<Message, E> = ProgramUpdateFailedEvent<Message, E>;
  /** Timeline event recorded when a model-dependent subscription starts. */
  export type SubscriptionStartedEvent<Model> = ProgramSubscriptionStartedEvent<Model>;
  /** Timeline event recorded when a subscription emits a message. */
  export type SubscriptionEmittedEvent<Message> = ProgramSubscriptionEmittedEvent<Message>;
  /** Timeline event recorded when a subscription fails through the Program error channel. */
  export type SubscriptionFailedEvent<Message, E> = ProgramSubscriptionFailedEvent<Message, E>;
  /** Timeline event recorded when a running Program is disposed. */
  export type DisposedEvent = ProgramDisposedEvent;
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
  export type SubscriptionInput<Message, E = never, R = never> = ProgramSubscriptionInput<Message, E, R>;
  /** One deterministic story assertion step for Program tests and docs. */
  export type StoryEntry<Model, Message, E = never, R = never> = ProgramStoryEntry<Model, Message, E, R>;
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
   * Promise work into `Program.command(Effect.tryPromise(...))` and dispatch a
   * follow-up message with the resolved value.
   */
  export const next = programNext;
  /**
   * Creates a command that can emit a follow-up message through Effect.
   *
   * Emitted messages must be plain values. Use `Effect.tryPromise(...)` inside
   * the command for host Promise work before mapping to a resolved message.
   */
  export const command = programCommand;
  /** Creates a command from an Effect that may fail through the Program error channel. */
  export const effect = programEffect;
  /**
   * Creates a command that immediately dispatches another message.
   *
   * The message must be a plain value; Promise-shaped messages are rejected.
   */
  export const dispatch = programDispatch;
  /** Creates a step that emits several commands after a model update. */
  export const commands = programCommands;
  /**
   * Creates a Stream-backed subscription for model-driven external input.
   *
   * Stream emissions must be plain messages. Adapt host Promise sources with
   * `Effect.tryPromise(...)` before emitting into the Program loop.
   */
  export const subscription = programSubscription;
}
