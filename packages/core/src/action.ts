import { Effect, Schema } from "effect";
import type { ActionResultInvalidationRequirements } from "./action-result.js";
import { ActionInterrupted, type ActionState } from "./action-submission.js";
import type { ActionOptimisticTransaction } from "./action-optimistic.js";
import { invalidationsForEffect } from "./action-execution-workflow.js";
import { makeActionInstance } from "./action-instance.js";
import { registerActionDefinition } from "./definition-registry.js";
import type {
  EffectInput,
  EffectInputError,
  EffectInputRequirements,
  EffectInputValue,
  EnsureEffectInput,
} from "./effect-like.js";
import {
  Resource,
  type ResourceInvalidation,
  type ResourceInvalidationPlan,
  type RetrySchedule,
} from "./resource.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";
import type { AnySunfallArcRuntime, SunfallArcRuntime } from "./runtime.js";
import type { ServerClientError } from "./server.js";
import type { ReadableSignal } from "./signal.js";

/** Expert-public structural marker used to recognize Action Definitions. */
export const ActionTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/Action",
) as typeof ActionTypeId;

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
  readonly retry?: RetrySchedule<E>;
}

/**
 * Registered action definition used by core actions and Start action transport.
 *
 * Schema metadata is shared with clients for input/output/error validation.
 * `run` stays Effect-first; Promise-shaped callbacks are rejected by the
 * public types. `optimistic` patches Signals and Collection rows through its
 * transaction before `run`; the patches fold in on success and roll back on
 * failure or interruption.
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
  /**
   * Patches Signals and Collection rows before `run`. The transaction owns
   * every patch: success folds them in, failure or interruption rolls them back.
   */
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction,
  ) => Effect.Effect<void, never, R>;
  /** Computes resource invalidations after a successful action value. */
  readonly invalidates?: (value: A, input: I) => ReadonlyArray<ResourceInvalidation<R>>;
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
  /**
   * Patches Signals and Collection rows before `run`. The transaction owns
   * every patch: success folds them in, failure or interruption rolls them back.
   */
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction,
  ) => Effect.Effect<void, never, R>;
  /** Computes resource invalidations after a successful action value. */
  readonly invalidates?: (value: A, input: I) => ReadonlyArray<ResourceInvalidation<R>>;
}

/**
 * Live action controller returned by Action.use.
 *
 * Read state in UI code and submit through submit.
 */
export interface ActionInstance<
  I,
  A,
  E = never,
  R = never,
  DefinitionError = E,
  DefinitionRequirements = R,
  InvalidationRequirements = DefinitionRequirements | ActionResultInvalidationRequirements<A>,
> {
  readonly definition: ActionDefinition<I, A, DefinitionError, DefinitionRequirements>;
  /**
   * Submission state. Failures include `ServerClientError`: a runtime that
   * provides an `ActionTransport` serving this Action submits it remotely. A
   * callback that breaks its contract (throws synchronously) is a defect.
   */
  readonly state: ReadableSignal<ActionState<I, A, E | ServerClientError>>;
  readonly invalidationPlan: ReadableSignal<
    ResourceInvalidationPlan<InvalidationRequirements> | undefined
  >;
  /** Runs the action workflow as an Effect, preserving typed errors and requirements. */
  submit(input: I): Effect.Effect<A, E | ServerClientError | ActionInterrupted, R>;
  /** Resets visible action state as an Effect. */
  reset(): Effect.Effect<void>;
}

/** Runtime options for constructing an Action Instance from a definition. */
export interface ActionUseOptions<R = never, ER = never> {
  /** Runtime that provides action services, the Resource Store, and runtime errors. */
  readonly runtime: SunfallArcRuntime<R, ER>;
}

export {
  ActionOptimisticRowsTypeId,
  type ActionOptimisticRowChange,
  type ActionOptimisticRows,
  type ActionOptimisticRowsLayer,
  type ActionOptimisticRowUpdate,
  type ActionOptimisticTransaction,
} from "./action-optimistic.js";

type AnyActionDefinition = ActionDefinition<any, any, any, any>;
type ActionRuntimeProvidedRequirements<R> = R | ResourceStoreState;
type ActionRuntimeRemainingRequirements<RIn, RProvided> = Exclude<
  RIn,
  ActionRuntimeProvidedRequirements<RProvided>
>;
type CheckedActionRun<I, Definition> = Definition extends {
  readonly run: (input: I) => infer Out;
}
  ? { readonly run: (input: I) => EnsureEffectInput<Out> }
  : never;

type RejectPromiseEffectInput<Out> = EnsureEffectInput<Out> extends never ? never : unknown;
type IsAny<T> = 0 extends 1 & T ? true : false;
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

type ActionDefinitionCommonOptions<I, A, E, R, InvalidationRequirements = never> = Omit<
  ActionOptions<I, A, E, R>,
  "input" | "output" | "run" | "invalidates"
> & {
  readonly invalidates?: (
    value: A,
    input: I,
  ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
};

/** Returns true when a value is an Sunfall Arc Action Definition. */
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
    DefinitionRequirements = R,
  > = ActionInstance<I, A, E, R, DefinitionError, DefinitionRequirements>;
  /** Public namespace alias for Action submission state. */
  export type State<I, A, E = never> = ActionState<I, A, E>;
  /** Public namespace alias for Action concurrency modes. */
  export type Concurrency = ActionConcurrency;
  /** Public namespace alias for Action retry and concurrency policy. */
  export type Policy<E = never> = ActionPolicy<E>;
  /** Public namespace alias for the optimistic Action transaction object. */
  export type OptimisticTransaction = ActionOptimisticTransaction;

  /** Plans the invalidations a successful value triggers; a throwing `invalidates` is a defect. */
  export const planInvalidation = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    value: A,
    input: I,
  ): Effect.Effect<ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>>> =>
    Effect.flatMap(invalidationsForEffect(definition, value, input), Resource.planInvalidation);

  /**
   * Defines and registers a reusable action without binding it to UI state.
   *
   * Registered actions are available through the default `App.define(...)`
   * registry snapshot. Use
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
    InvalidationRequirements = never,
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
    } & RejectPromiseEffectInput<Out>,
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
  >;
  export function define<
    const Input extends Schema.Top,
    Run extends (input: Schema.Schema.Type<Input>) => unknown,
    InvalidationRequirements = never,
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
      readonly run: Run &
        ((input: Schema.Schema.Type<Input>) => EnsureEffectInput<ReturnType<Run>>);
      readonly invalidates?: (
        value: EffectInputValue<ReturnType<Run>>,
        input: Schema.Schema.Type<Input>,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<ReturnType<Run>>,
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
    InvalidationRequirements = never,
  >(
    definition: Omit<
      ActionOptions<I, EffectInputValue<Out>, EffectInputError<Out>, EffectInputRequirements<Out>>,
      "input" | "output" | "run" | "invalidates"
    > & {
      readonly input?: never;
      readonly output: Output;
      readonly run: (input: I) => EnsureEffectInput<Out>;
      readonly invalidates?: (
        value: EffectInputValue<Out>,
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<Out>,
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
        transaction: ActionOptimisticTransaction,
      ) => Effect.Effect<void, never, R>;
      readonly invalidates?: (
        value: A,
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } = Omit<ActionOptions<I, A, E, R>, "run" | "optimistic" | "invalidates"> & {
      readonly run: (input: I) => EffectInput<A, E, R>;
      readonly optimistic?: (
        input: I,
        transaction: ActionOptimisticTransaction,
      ) => Effect.Effect<void, never, R>;
      readonly invalidates?: (
        value: A,
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    },
  >(
    definition: Definition & CheckedActionRun<I, Definition>,
  ): ActionDefinition<
    I,
    A,
    E,
    R | NormalizeRequirements<InvalidationRequirements> | ActionResultInvalidationRequirements<A>
  >;
  export function define<I, Run extends (input: I) => unknown, InvalidationRequirements = never>(
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
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<ReturnType<Run>>,
  ): ActionDefinition<
    I,
    EffectInputValue<ReturnType<Run>>,
    EffectInputError<ReturnType<Run>>,
    ActionInferredRequirements<ReturnType<Run>, never, InvalidationRequirements>
  >;
  export function define(definition: unknown): any {
    const options = definition as Omit<ActionOptions<any, any, any, any>, "run" | "optimistic"> & {
      readonly run: (input: any) => EffectInput<any, any, any>;
      readonly optimistic?: (
        input: any,
        transaction: ActionOptimisticTransaction,
      ) => Effect.Effect<void, never, any>;
    };
    const { run, optimistic, ...rest } = options;

    const action: AnyActionDefinition = {
      ...rest,
      run,
      ...(optimistic === undefined
        ? {}
        : {
            optimistic,
          }),
      [ActionTypeId]: ActionTypeId,
    };

    registerActionDefinition(action);
    return action;
  }

  /**
   * Creates a live action instance with state, optimistic updates, and invalidation.
   *
   * The instance runs on `runtime`: its services discharge the definition's
   * requirements, and a runtime-provided `ActionTransport` that serves the
   * definition submits it remotely. UI code binds Actions with its renderer
   * adapter (Solid's `Component.action(...)`), which supplies the runtime.
   */
  export function use<I, A, E = never, R = never, RRuntime = never, ER = never>(
    definition: ActionDefinition<I, A, E, R>,
    options: ActionUseOptions<RRuntime, ER>,
  ): ActionInstance<
    I,
    A,
    E | ER,
    ActionRuntimeRemainingRequirements<R | ActionResultInvalidationRequirements<A>, RRuntime>,
    E,
    R,
    R | ActionResultInvalidationRequirements<A>
  > {
    return makeActionInstance(definition, options.runtime as AnySunfallArcRuntime<ER>) as never;
  }
}
