import {
  type ProgramCommand,
  type ProgramCommandCompletedEvent,
  type ProgramCommandFailedEvent,
  type ProgramCommandInput,
  type ProgramCommandStartedEvent,
  type ProgramDefinition,
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
  type ProgramUpdateFailedEvent,
  ProgramCommandTypeId,
  ProgramStepTypeId,
  ProgramSubscriptionTypeId
} from "./program-contract.js";
export {
  ProgramCommandTypeId,
  ProgramStepTypeId,
  ProgramSubscriptionTypeId,
  type ProgramCommand,
  type ProgramCommandCompletedEvent,
  type ProgramCommandFailedEvent,
  type ProgramCommandInput,
  type ProgramCommandStartedEvent,
  type ProgramDefinition,
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
import { currentOrDefaultRuntime, type AnyEffectUiRuntime } from "./runtime.js";
import { getCurrentScope } from "./scope.js";

/** Starts a Program against the current Effect UI runtime and optional UI scope. */
export const startProgram = <Model, Message, E = never, R = never>(
  definition: ProgramDefinition<Model, Message, E, R>
): ProgramInstance<Model, Message, ProgramRuntimeError<E>> =>
  startProgramWithRuntimeError<Model, Message, E, R, never>(definition);

/**
 * Starts a Program while preserving Runtime Spine startup/provision errors in
 * the returned failure channel.
 */
export const startProgramWithRuntimeError = <Model, Message, E = never, R = never, ER = never>(
  definition: ProgramDefinition<Model, Message, E, R>
): ProgramInstance<Model, Message, ProgramRuntimeError<E, ER>> => {
  const runtime = currentOrDefaultRuntime() as AnyEffectUiRuntime<ER>;
  const scope = getCurrentScope();
  return makeProgramRuntimeInstance<Model, Message, E, R, ER>({
    definition,
    runtime,
    scope
  });
};

export namespace Program {
  /** Definition for a headless model/message loop with Effect-owned work. */
  export type Definition<Model, Message, E = never, R = never> = ProgramDefinition<Model, Message, E, R>;
  /** Running Program handle with model, dispatch, timeline, and disposal state. */
  export type Instance<Model, Message, E = never> = ProgramInstance<Model, Message, E>;
  /** Captured update, command, or subscription failure with triggering message context. */
  export type Failure<Message, E> = ProgramFailure<Message, E>;
  /** Program failure channel plus Runtime Spine provision/startup failures. */
  export type RuntimeError<E, ER = never> = ProgramRuntimeError<E, ER>;
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
   * The update callback returns an Effect or pure step; Promise-shaped updates
   * are rejected so async work stays in the Effect runtime.
   */
  export const define = defineProgram;
  /** Runs one Program update deterministically without starting subscriptions. */
  export const step = programStepEffect;
  /** Creates a deterministic Program story for tests and examples. */
  export const story = makeProgramStory;
  /** Starts a Program on the current Runtime Spine and UI scope. */
  export const start = startProgramWithRuntimeError;
  /** Returns a pure model update step with no commands. */
  export const next = programNext;
  /** Creates a command that can emit a follow-up message through Effect. */
  export const command = programCommand;
  /** Creates a command from an Effect that may fail through the Program error channel. */
  export const effect = programEffect;
  /** Creates a command that immediately dispatches another message. */
  export const dispatch = programDispatch;
  /** Creates a step that emits several commands after a model update. */
  export const commands = programCommands;
  /** Creates a Stream-backed subscription for model-driven external input. */
  export const subscription = programSubscription;
}
