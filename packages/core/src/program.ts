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
  export type Definition<Model, Message, E = never, R = never> = ProgramDefinition<Model, Message, E, R>;
  export type Instance<Model, Message, E = never> = ProgramInstance<Model, Message, E>;
  export type Failure<Message, E> = ProgramFailure<Message, E>;
  export type RuntimeError<E, ER = never> = ProgramRuntimeError<E, ER>;
  export type TimelineOptions = ProgramTimelineOptions;
  export type Event<Model, Message, E = never> = ProgramEvent<Model, Message, E>;
  export type EventBase = ProgramEventBase;
  export type MessageEvent<Model, Message> = ProgramMessageEvent<Model, Message>;
  export type CommandStartedEvent<Message> = ProgramCommandStartedEvent<Message>;
  export type CommandCompletedEvent<Message> = ProgramCommandCompletedEvent<Message>;
  export type CommandFailedEvent<Message, E> = ProgramCommandFailedEvent<Message, E>;
  export type UpdateFailedEvent<Message, E> = ProgramUpdateFailedEvent<Message, E>;
  export type SubscriptionStartedEvent<Model> = ProgramSubscriptionStartedEvent<Model>;
  export type SubscriptionEmittedEvent<Message> = ProgramSubscriptionEmittedEvent<Message>;
  export type SubscriptionFailedEvent<Message, E> = ProgramSubscriptionFailedEvent<Message, E>;
  export type DisposedEvent = ProgramDisposedEvent;
  export type Phase = ProgramPhase;
  export type Update<Model, Message, E = never, R = never> = ProgramUpdate<Model, Message, E, R>;
  export type Step<Model, Message, E = never, R = never> = ProgramStep<Model, Message, E, R>;
  export type Command<Message, E = never, R = never> = ProgramCommand<Message, E, R>;
  export type CommandInput<Message, E = never, R = never> = ProgramCommandInput<Message, E, R>;
  export type Subscription<Message, E = never, R = never> = ProgramSubscription<Message, E, R>;
  export type SubscriptionInput<Message, E = never, R = never> = ProgramSubscriptionInput<Message, E, R>;
  export type StoryEntry<Model, Message, E = never, R = never> = ProgramStoryEntry<Model, Message, E, R>;
  export type Story<Model, Message, E = never, R = never> = ProgramStory<Model, Message, E, R>;
  export type StoryOptions<Model> = ProgramStoryOptions<Model>;

  export const define = defineProgram;
  export const step = programStepEffect;
  export const story = makeProgramStory;
  export const start = startProgramWithRuntimeError;
  export const next = programNext;
  export const command = programCommand;
  export const effect = programEffect;
  export const dispatch = programDispatch;
  export const commands = programCommands;
  export const subscription = programSubscription;
}
