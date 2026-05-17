import { Effect, Schema, type Schedule } from "effect";
import type { ActionResultInvalidationRequirements } from "./action-result.js";
import {
  ActionInterrupted,
  makeActionSubmissionController,
  type ActionSubmissionState
} from "./action-submission.js";
import {
  type ActionOptimisticTransaction,
  type ActionRollback
} from "./action-optimistic.js";
import {
  invalidationsFor,
  invalidationsForEffect,
  makeActionExecutionWorkflow
} from "./action-execution-workflow.js";
import {
  actionDefinitionRegistry,
  clearActionDefinitionRegistryUnsafe,
  coreDefinitionRegistryDiagnostics,
  getActionDefinition,
  registerActionDefinition
} from "./definition-registry.js";
import type {
  EffectInput,
  EffectInputError,
  EffectInputRequirements,
  EffectInputValue,
  EnsureEffectInput
} from "./effect-like.js";
import { EffectInputCallbackError, invokeEffectInput } from "./effect-like.js";
import { Resource, type ResourceInvalidation, type ResourceInvalidationPlan } from "./resource.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";
import { currentOrDefaultRuntime, getCurrentRuntime, type AnyEffectUiRuntime, type EffectUiRuntime } from "./runtime.js";
import type { ReadableSignal } from "./signal.js";

/** Expert-public structural marker used to recognize Action Definitions. */
export const ActionTypeId: unique symbol = Symbol.for("@effect-ui/core/Action") as typeof ActionTypeId;

/** State machine for one action instance. */
export type ActionState<
  I,
  A,
  E = never,
  P = ResourceInvalidationPlan
> = ActionSubmissionState<I, A, E, P>;

/**
 * Submission concurrency mode for one stateful Action Instance.
 *
 * `latest` interrupts the previous submission, `parallel` allows every
 * submission to run, and `exhaust` reuses the current in-flight submission
 * until it completes.
 */
export type ActionConcurrency = "latest" | "parallel" | "exhaust";

/** Runtime policy for submissions, including concurrency and retry behavior. */
export interface ActionPolicy<E = never> {
  /**
   * Submission policy for one action instance.
   *
   * `latest` interrupts older submissions, `parallel` allows all submissions,
   * and `exhaust` joins the in-flight submission while one is pending.
   */
  readonly concurrency?: ActionConcurrency;
  /** Effect retry schedule applied around the action `run` Effect. */
  readonly retry?: Schedule.Schedule<unknown, E>;
}

/**
 * Registered action definition used by core actions and Start action transport.
 *
 * Schema metadata is shared with clients for input/output/error validation.
 * `run` stays Effect-first; Promise-shaped callbacks are rejected by the
 * public types. Optimistic work runs before `run` and returns a rollback Effect
 * that is used if the submission is interrupted or fails.
 */
export interface ActionDefinition<I, A, E = never, R = never> {
  readonly [ActionTypeId]: typeof ActionTypeId;
  /** Stable registry and transport name for this action. */
  readonly name: string;
  /** Optional schema used to decode submitted input. */
  readonly input?: unknown;
  /** Optional schema used to encode successful output. */
  readonly output?: unknown;
  /** Optional schema used to encode typed failures. */
  readonly error?: unknown;
  /** Concurrency and retry policy for stateful submissions. */
  readonly policy?: ActionPolicy<E>;
  /**
   * Effect-first action implementation.
   *
   * Direct Effect values are interpreted as work. If the domain value itself is
   * an Effect, wrap it with `Effect.succeed(effectValue)` so it crosses this
   * Interface as data.
   */
  readonly run: (input: I) => EffectInput<A, E, R>;
  /** Applies an optimistic patch and returns the rollback Effect. */
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction
  ) => Effect.Effect<ActionRollback<R>, EffectInputCallbackError, R>;
  /** Computes resource invalidations after a successful action value. */
  readonly invalidates?: (
    value: A,
    input: I
  ) => ReadonlyArray<ResourceInvalidation<R>>;
}

/**
 * Configuration for a mutation-like workflow.
 *
 * `run` may return a value or an Effect, but the action executes it through Effect
 * so retries, interruption, optimistic rollback, and resource invalidation compose.
 */
export interface ActionOptions<I, A, E = never, R = never> {
  /** Stable registry and transport name for this action. */
  readonly name: string;
  /** Optional schema used to decode submitted input. */
  readonly input?: unknown;
  /** Optional schema used to encode successful output. */
  readonly output?: unknown;
  /** Optional schema used to encode typed failures. */
  readonly error?: unknown;
  /** Concurrency and retry policy for stateful submissions. */
  readonly policy?: ActionPolicy<E>;
  /**
   * Effect-first action implementation.
   *
   * Direct Effect values are interpreted as work. If the domain value itself is
   * an Effect, wrap it with `Effect.succeed(effectValue)` so it crosses this
   * Interface as data.
   */
  readonly run: (input: I) => EffectInput<A, E, R>;
  /** Applies an optimistic patch and returns the rollback Effect. */
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction
  ) => Effect.Effect<ActionRollback<R>, EffectInputCallbackError, R>;
  /** Computes resource invalidations after a successful action value. */
  readonly invalidates?: (
    value: A,
    input: I
  ) => ReadonlyArray<ResourceInvalidation<R>>;
}

/**
 * Live action controller returned by Action.use.
 *
 * Read state in UI code and submit through submitEffect.
 */
export interface ActionInstance<
  I,
  A,
  E = never,
  R = never,
  DefinitionError = E,
  DefinitionRequirements = R,
  InvalidationRequirements = DefinitionRequirements | ActionResultInvalidationRequirements<A>
> {
  readonly definition: ActionDefinition<I, A, DefinitionError, DefinitionRequirements>;
  readonly state: ReadableSignal<
    ActionState<I, A, E | EffectInputCallbackError, ResourceInvalidationPlan<InvalidationRequirements>>
  >;
  readonly invalidationPlan: ReadableSignal<ResourceInvalidationPlan<InvalidationRequirements> | undefined>;
  /** Runs the action workflow as an Effect, preserving typed errors and requirements. */
  submitEffect(input: I): Effect.Effect<A, E | EffectInputCallbackError | ActionInterrupted, R>;
  /** Resets visible action state as an Effect. */
  resetEffect(): Effect.Effect<void>;
  /** Runtime-owned synchronous convenience for UI event handlers. */
  reset(): void;
}

/** Runtime options for constructing an Action Instance from a definition. */
export interface ActionUseOptions<R = never, ER = never> {
  /** Runtime that provides action services, the Resource Store, and runtime errors. */
  readonly runtime?: EffectUiRuntime<R, ER>;
}

export type {
  ActionOptimisticTransaction,
  ActionRollback
} from "./action-optimistic.js";

export {
  ActionInterrupted,
  makeActionSubmissionController,
  type ActionSubmissionController,
  type ActionSubmissionControllerOptions,
  type ActionSubmissionDecision,
  type ActionSubmissionFiber,
  type ActionSubmissionRun,
  type ActionSubmissionState
} from "./action-submission.js";

type AnyActionDefinition = ActionDefinition<any, any, any, any>;
type ActionRuntimeProvidedRequirements<R> = R | ResourceStoreState;
type ActionRuntimeRemainingRequirements<RIn, RProvided> =
  Exclude<RIn, ActionRuntimeProvidedRequirements<RProvided>>;
type CheckedActionRun<I, Definition> = Definition extends {
  readonly run: (input: I) => infer Out;
}
  ? { readonly run: (input: I) => EnsureEffectInput<Out> }
  : never;

type RejectPromiseEffectInput<Out> = EnsureEffectInput<Out> extends never ? never : unknown;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type NormalizeRequirements<R> = IsAny<R> extends true ? never : R;

type ActionInvalidatesRequirements<Definition> = Definition extends {
  readonly invalidates?: (...args: any) => infer Invalidations;
}
  ? Invalidations extends ReadonlyArray<infer Invalidation>
    ? Invalidation extends ResourceInvalidation<infer Requirements>
      ? NormalizeRequirements<Requirements>
      : never
    : never
  : never;

type ActionInferredRequirements<Out, Definition, InvalidationRequirements = never> =
  | EffectInputRequirements<Out>
  | NormalizeRequirements<InvalidationRequirements>
  | ActionInvalidatesRequirements<Definition>
  | ActionResultInvalidationRequirements<EffectInputValue<Out>>;

type ActionDefinitionCommonOptions<I, A, E, R, InvalidationRequirements = never> =
  Omit<ActionOptions<I, A, E, R>, "input" | "output" | "run" | "invalidates"> & {
    readonly invalidates?: (
      value: A,
      input: I
    ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
  };

/** Returns true when a value is an Effect UI Action Definition. */
export const isActionDefinition = (value: unknown): value is ActionDefinition<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ActionTypeId]?: unknown })[ActionTypeId] === ActionTypeId;

/** Helpers for defining and running Effect-first actions. */
export namespace Action {
  /** Public namespace alias for an Action Definition. */
  export type Definition<I, A, E = never, R = never> = ActionDefinition<I, A, E, R>;
  /** Public namespace alias for a live Action Instance. */
  export type Instance<
    I,
    A,
    E = never,
    R = never,
    DefinitionError = E,
    DefinitionRequirements = R
  > = ActionInstance<I, A, E, R, DefinitionError, DefinitionRequirements>;
  /** Public namespace alias for Action submission state. */
  export type State<I, A, E = never> = ActionState<I, A, E>;
  /** Public namespace alias for Action concurrency modes. */
  export type Concurrency = ActionConcurrency;
  /** Public namespace alias for Action retry and concurrency policy. */
  export type Policy<E = never> = ActionPolicy<E>;
  /** Public namespace alias for an optimistic Action rollback Effect. */
  export type Rollback<R = never> = ActionRollback<R>;
  /** Public namespace alias for the optimistic Action transaction object. */
  export type OptimisticTransaction = ActionOptimisticTransaction;

  export const planInvalidation = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    value: A,
    input: I
  ): ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>> =>
    Resource.planInvalidation(invalidationsFor(definition, value, input));

  /** Effect-first invalidation planning that reports action callback throws in the error channel. */
  export const planInvalidationEffect = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    value: A,
    input: I
  ): Effect.Effect<
    ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>>,
    EffectInputCallbackError
  > =>
    Effect.flatMap(
      invalidationsForEffect(definition, value, input),
      Resource.planInvalidationEffect
    );

  /**
   * Defines and registers a reusable action without binding it to UI state.
   *
   * Registered actions are available through `Action.definitions()`,
   * `Action.get(...)`, and the default `defineApp(...)` registry snapshot. Use
   * `Action.use(...)` to create an instance for a component or interaction
   * boundary.
   *
   * @example
   * ```ts
   * const saveUser = Action.define({
   *   name: "saveUser",
   *   run: (input: UserInput) => ServerSaveUser.effect(input)
   * });
   * ```
   */
  export function define<
    const Input extends Schema.Top,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>,
    InvalidationRequirements = never
  >(
    definition: ActionDefinitionCommonOptions<
      Schema.Schema.Type<Input>,
      EffectInputValue<Out>,
      EffectInputError<Out>,
      EffectInputRequirements<Out>,
      InvalidationRequirements
    > & {
      readonly input: Input;
      readonly output: Output;
      readonly run: (input: Schema.Schema.Type<Input>) => EnsureEffectInput<Out>;
    } & RejectPromiseEffectInput<Out>
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
  >;
  export function define<
    const Input extends Schema.Top,
    Run extends (input: Schema.Schema.Type<Input>) => unknown,
    InvalidationRequirements = never
  >(
    definition: Omit<
      ActionOptions<
        Schema.Schema.Type<Input>,
        EffectInputValue<ReturnType<Run>>,
        EffectInputError<ReturnType<Run>>,
        EffectInputRequirements<ReturnType<Run>>
      >,
      "input" | "output" | "run" | "invalidates"
    > & {
      readonly input: Input;
      readonly output?: never;
      readonly run: Run & ((input: Schema.Schema.Type<Input>) => EnsureEffectInput<ReturnType<Run>>);
      readonly invalidates?: (
        value: EffectInputValue<ReturnType<Run>>,
        input: Schema.Schema.Type<Input>
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<ReturnType<Run>>
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<ReturnType<Run>>,
    EffectInputError<ReturnType<Run>>,
    ActionInferredRequirements<ReturnType<Run>, never, InvalidationRequirements>
  >;
  export function define<
    I,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>,
    InvalidationRequirements = never
  >(
    definition: Omit<
      ActionOptions<
        I,
        EffectInputValue<Out>,
        EffectInputError<Out>,
        EffectInputRequirements<Out>
      >,
      "input" | "output" | "run" | "invalidates"
    > & {
      readonly input?: never;
      readonly output: Output;
      readonly run: (input: I) => EnsureEffectInput<Out>;
      readonly invalidates?: (
        value: EffectInputValue<Out>,
        input: I
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<Out>
  ): ActionDefinition<
    I,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
  >;
  export function define<
    I,
    A,
    E = never,
    R = never,
    InvalidationRequirements = never,
    Definition extends Omit<ActionOptions<I, A, E, R>, "run" | "optimistic" | "invalidates"> & {
      readonly run: (input: I) => EffectInput<A, E, R>;
      readonly optimistic?: (
        input: I,
        transaction: ActionOptimisticTransaction
      ) => Effect.Effect<ActionRollback<R>, EffectInputCallbackError, R>;
      readonly invalidates?: (
        value: A,
        input: I
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } = Omit<ActionOptions<I, A, E, R>, "run" | "optimistic" | "invalidates"> & {
      readonly run: (input: I) => EffectInput<A, E, R>;
      readonly optimistic?: (
        input: I,
        transaction: ActionOptimisticTransaction
      ) => Effect.Effect<ActionRollback<R>, EffectInputCallbackError, R>;
      readonly invalidates?: (
        value: A,
        input: I
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    }
  >(
    definition: Definition & CheckedActionRun<I, Definition>
  ): ActionDefinition<I, A, E, R | NormalizeRequirements<InvalidationRequirements> | ActionResultInvalidationRequirements<A>>;
  export function define<
    I,
    Run extends (input: I) => unknown,
    InvalidationRequirements = never
  >(
    definition: Omit<
      ActionOptions<
        I,
        EffectInputValue<ReturnType<Run>>,
        EffectInputError<ReturnType<Run>>,
        EffectInputRequirements<ReturnType<Run>>
      >,
      "output" | "run" | "invalidates"
    > & {
      readonly output?: never;
      readonly run: Run & ((input: I) => EnsureEffectInput<ReturnType<Run>>);
      readonly invalidates?: (
        value: EffectInputValue<ReturnType<Run>>,
        input: I
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<ReturnType<Run>>
  ): ActionDefinition<
    I,
    EffectInputValue<ReturnType<Run>>,
    EffectInputError<ReturnType<Run>>,
    ActionInferredRequirements<ReturnType<Run>, never, InvalidationRequirements>
  >;
  export function define(
    definition: unknown
  ): any {
    const options = definition as Omit<ActionOptions<any, any, any, any>, "run" | "optimistic"> & {
      readonly run: (input: any) => EffectInput<any, any, any>;
      readonly optimistic?: (
        input: any,
        transaction: ActionOptimisticTransaction
      ) => Effect.Effect<ActionRollback<any>, EffectInputCallbackError, any>;
    };
    const { run, optimistic, ...rest } = options;

    const action: AnyActionDefinition = {
      ...rest,
      run,
      ...(optimistic === undefined
        ? {}
        : {
            optimistic
          }),
      [ActionTypeId]: ActionTypeId
    };

    registerActionDefinition(action);
    return action;
  }

  /** Registered action definitions keyed by action name. */
  export const definitions = (): ReadonlyMap<string, AnyActionDefinition> =>
    actionDefinitionRegistry<AnyActionDefinition>();

  /** Looks up a registered action definition by action name. */
  export const get = (name: string): AnyActionDefinition | undefined =>
    getActionDefinition<AnyActionDefinition>(name);

  /** Registry diagnostics, including duplicate action/server registrations. */
  export const registryDiagnostics = coreDefinitionRegistryDiagnostics;

  /**
   * Test-only reset for registered action definitions.
   *
   * Unsafe because it mutates process-wide state observed by later
   * `defineApp(...)` calls.
   */
  export const clearRegistryUnsafe = (): void => {
    clearActionDefinitionRegistryUnsafe();
  };

  /**
   * Creates a live action instance with state, optimistic updates, and invalidation.
   *
   * The returned instance submits through submitEffect.
   */
  export function use<I, A, E = never, R = never>(
    definition: ActionDefinition<I, A, E, R>
  ): ActionInstance<I, A, E, R | ActionResultInvalidationRequirements<A>, E, R, R | ActionResultInvalidationRequirements<A>>;
  export function use<I, A, E = never, R = never, RRuntime = never, ER = never>(
    definition: ActionDefinition<I, A, E, R>,
    options: { readonly runtime: EffectUiRuntime<RRuntime, ER> }
  ): ActionInstance<
    I,
    A,
    E | ER,
    ActionRuntimeRemainingRequirements<R | ActionResultInvalidationRequirements<A>, RRuntime>,
    E,
    R,
    R | ActionResultInvalidationRequirements<A>
  >;
  export function use<I, A, E = never, R = never, RRuntime = never, ER = never>(
    definition: ActionDefinition<I, A, E, R>,
    options: ActionUseOptions<RRuntime, ER> = {}
  ): ActionInstance<
    I,
    A,
    E | ER,
    ActionRuntimeRemainingRequirements<R | ActionResultInvalidationRequirements<A>, RRuntime>,
    E,
    R,
    R | ActionResultInvalidationRequirements<A>
  > {
    const ambientRuntime = getCurrentRuntime();
    const runtime = options.runtime ?? ambientRuntime ?? currentOrDefaultRuntime();
    const shouldRunOnCapturedRuntime = options.runtime !== undefined || ambientRuntime !== undefined;
    const submissions = makeActionSubmissionController<
      I,
      A,
      E | ER | EffectInputCallbackError,
      ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>>
    >(
      definition.policy?.concurrency === undefined
        ? { actionName: definition.name }
        : { actionName: definition.name, concurrency: definition.policy.concurrency }
    );

    const runAtActionBoundary = <Value, Error, Requirements>(
      effect: Effect.Effect<Value, Error, Requirements>
    ): Effect.Effect<Value, Error | ER, Requirements> =>
      shouldRunOnCapturedRuntime
        ? (runtime as unknown as EffectUiRuntime<RRuntime, ER>).provide(effect) as Effect.Effect<Value, Error | ER, Requirements>
        : effect;

    const workflow = makeActionExecutionWorkflow({
      definition,
      submissions,
      runAtActionBoundary
    });
    const submitEffect = workflow.submitEffect as (input: I) => Effect.Effect<
      A,
      E | ER | EffectInputCallbackError | ActionInterrupted,
      ActionRuntimeRemainingRequirements<R | ActionResultInvalidationRequirements<A>, RRuntime>
    >;

    return {
      definition,
      state: submissions.state,
      invalidationPlan: submissions.invalidationPlan,
      submitEffect,
      resetEffect: workflow.resetEffect,
      reset: () => {
        void runtime.runFork(workflow.reset().pipe(Effect.catchCause(() => Effect.void)));
      }
    };
  }
}
