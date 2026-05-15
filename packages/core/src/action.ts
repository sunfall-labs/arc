import { Effect, Fiber, Schema, type Schedule } from "effect";
import { ActionResult, type ActionResultInvalidationRequirements, type AnyActionResult } from "./action-result.js";
import {
  ActionInterrupted,
  makeActionSubmissionController,
  type ActionSubmissionFiber,
  type ActionSubmissionRun,
  type ActionSubmissionState
} from "./action-submission.js";
import {
  makeActionOptimisticTransactionRuntime,
  type ActionOptimisticTransaction,
  type ActionOptimisticTransactionRuntime,
  type ActionRollback
} from "./action-optimistic.js";
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
import { EffectInputCallbackError, invokeEffectInput, toEffect } from "./effect-like.js";
import { Resource, type ResourceInvalidation, type ResourceInvalidationPlan } from "./resource.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";
import { currentOrDefaultRuntime, getCurrentRuntime, type AnyEffectUiRuntime, type EffectUiRuntime } from "./runtime.js";
import type { ReadableSignal } from "./signal.js";

export const ActionTypeId: unique symbol = Symbol.for("@effect-ui/core/Action") as typeof ActionTypeId;

/** State machine for one action instance. */
export type ActionState<
  I,
  A,
  E = never,
  P = ResourceInvalidationPlan
> = ActionSubmissionState<I, A, E, P>;

export type ActionConcurrency = "latest" | "parallel" | "exhaust";

/** Runtime policy for submissions, including concurrency and retry behavior. */
export interface ActionPolicy<E = never> {
  /**
   * Submission policy for one action instance.
   *
   * `latest` interrupts older submissions, `parallel` allows all submissions,
   * and `exhaust` ignores new submissions while one is pending.
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
  /** Effect-first action implementation. */
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
  /** Effect-first action implementation. */
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
  resetEffect(): Effect.Effect<void>;
  reset(): void;
}

export interface ActionUseOptions<R = never, ER = never> {
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

export const isActionDefinition = (value: unknown): value is ActionDefinition<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ActionTypeId]?: unknown })[ActionTypeId] === ActionTypeId;

const resultInvalidations = <A>(
  value: A
): ReadonlyArray<ResourceInvalidation<ActionResultInvalidationRequirements<A>>> =>
  ActionResult.is(value)
    ? ActionResult.invalidations(value as AnyActionResult)
    : [];

const invalidationsFor = <I, A, E, R>(
  definition: ActionDefinition<I, A, E, R>,
  value: A,
  input: I
): ReadonlyArray<ResourceInvalidation<R | ActionResultInvalidationRequirements<A>>> => {
  try {
    return [
      ...(definition.invalidates?.(value, input) ?? []),
      ...resultInvalidations(value)
    ] as ReadonlyArray<ResourceInvalidation<R | ActionResultInvalidationRequirements<A>>>;
  } catch (cause) {
    throw actionCallbackError(`Action.invalidates(${definition.name})`, cause);
  }
};

const actionCallbackError = (
  operation: string,
  cause: unknown
): EffectInputCallbackError =>
  new EffectInputCallbackError({
    operation,
    cause,
    guidance: "Action callbacks must return values or Effects. Synchronous callback throws are reported in the Effect error channel."
  });

const invalidationsForEffect = <I, A, E, R>(
  definition: ActionDefinition<I, A, E, R>,
  value: A,
  input: I
): Effect.Effect<
  ReadonlyArray<ResourceInvalidation<R | ActionResultInvalidationRequirements<A>>>,
  EffectInputCallbackError
> =>
  Effect.map(
    Effect.try({
      try: () => definition.invalidates?.(value, input) ?? [],
      catch: (cause) => actionCallbackError(`Action.invalidates(${definition.name})`, cause)
    }),
    (invalidations) => [
      ...invalidations,
      ...resultInvalidations(value)
    ] as ReadonlyArray<ResourceInvalidation<R | ActionResultInvalidationRequirements<A>>>
  );

/** Helpers for defining and running Effect-first actions. */
export namespace Action {
  export type Definition<I, A, E = never, R = never> = ActionDefinition<I, A, E, R>;
  export type Instance<
    I,
    A,
    E = never,
    R = never,
    DefinitionError = E,
    DefinitionRequirements = R
  > = ActionInstance<I, A, E, R, DefinitionError, DefinitionRequirements>;
  export type State<I, A, E = never> = ActionState<I, A, E>;
  export type Concurrency = ActionConcurrency;
  export type Policy<E = never> = ActionPolicy<E>;
  export type Rollback<R = never> = ActionRollback<R>;
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
      readonly run: (input: Schema.Schema.Type<Input>) => Out;
    } & RejectPromiseEffectInput<Out>
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
  >;
  export function define<
    const Input extends Schema.Top,
    Out,
    InvalidationRequirements = never
  >(
    definition: Omit<
      ActionOptions<
        Schema.Schema.Type<Input>,
        EffectInputValue<Out>,
        EffectInputError<Out>,
        EffectInputRequirements<Out>
      >,
      "input" | "output" | "run" | "invalidates"
    > & {
      readonly input: Input;
      readonly output?: never;
      readonly run: (input: Schema.Schema.Type<Input>) => Out;
      readonly invalidates?: (
        value: EffectInputValue<Out>,
        input: Schema.Schema.Type<Input>
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<Out>
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
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
      readonly run: (input: I) => Out;
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
    Out,
    InvalidationRequirements = never
  >(
    definition: Omit<
      ActionOptions<
        I,
        EffectInputValue<Out>,
        EffectInputError<Out>,
        EffectInputRequirements<Out>
      >,
      "output" | "run" | "invalidates"
    > & {
      readonly output?: never;
      readonly run: (input: I) => Out;
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
  export function define(
    definition: ActionOptions<any, any, any, any>
  ): ActionDefinition<unknown, unknown, unknown, unknown> {
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

    const runEffect = (input: I): Effect.Effect<A, E | EffectInputCallbackError, R> => {
      const operation = `Action.run(${definition.name})`;
      return Effect.flatMap(
        Effect.try({
          try: () => definition.run(input),
          catch: (cause) =>
            new EffectInputCallbackError({
              operation,
              cause,
              guidance: "EffectInput callbacks must return values or Effects. Synchronous callback throws are reported in the Effect error channel."
            })
        }),
        (result) => {
          const effect = toEffect(result as never) as Effect.Effect<A, E, R>;
          const retry = definition.policy?.retry;
          return retry ? Effect.retry(effect, retry) : effect;
        }
      );
    };

    const applyOptimistic = (
      input: I,
      transaction: ActionOptimisticTransactionRuntime<R>
    ): Effect.Effect<ActionRollback<R>, EffectInputCallbackError, R> => {
      if (!definition.optimistic) {
        return Effect.succeed(transaction.rollback);
      }

      return Effect.flatMap(
        Effect.try({
          try: () => definition.optimistic!(input, transaction.api),
          catch: (cause) => actionCallbackError(`Action.optimistic(${definition.name})`, cause)
        }),
        (optimisticEffect) =>
          optimisticEffect.pipe(
            Effect.map((extraRollback) =>
              Effect.ensuring(extraRollback, transaction.rollback.pipe(Effect.catch(() => Effect.void)))
            )
          )
      );
    };

    const runWorkflow = (
      input: I,
      submission: ActionSubmissionRun<A, E | ER | EffectInputCallbackError>
    ): Effect.Effect<
      A,
      E | ER | EffectInputCallbackError | ActionInterrupted,
      R | ActionResultInvalidationRequirements<A>
    > =>
      Effect.suspend(() => {
        let rollback: ActionRollback<R> = Effect.void as ActionRollback<R>;

        return Effect.ensuring(
          Effect.gen(function* () {
            yield* submissions.pendingEffect(submission, input);

            const transaction = makeActionOptimisticTransactionRuntime<R>(definition.name);
            rollback = transaction.rollback;
            rollback = yield* applyOptimistic(input, transaction);

            const value = yield* runEffect(input);
            yield* submissions.interruptStaleEffect(submission);

            const invalidations = yield* invalidationsForEffect(definition, value, input);
            const plan = yield* Resource.planInvalidationEffect(invalidations);
            yield* transaction.commit;
            rollback = Effect.void as ActionRollback<R>;

            if (invalidations.length > 0) {
              yield* Resource.runInvalidationPlanEffect(plan);
            }

            yield* submissions.successEffect(
              submission,
              input,
              value,
              invalidations.length === 0 ? undefined : plan
            );

            return value;
          }),
          Effect.suspend(() => rollback.pipe(Effect.catch(() => Effect.void)))
        );
      }).pipe(
        Effect.catch((
          error: E | ER | EffectInputCallbackError | ActionInterrupted
        ): Effect.Effect<never, E | ER | EffectInputCallbackError | ActionInterrupted> => {
          if (error instanceof ActionInterrupted) {
            return Effect.fail(error);
          }

          return submissions.failureEffect(submission, input, error).pipe(
            Effect.andThen(Effect.fail(error))
          );
        })
      );

    const resetEffect = (): Effect.Effect<void> =>
      submissions.resetEffect();

    const submitEffect = (input: I): Effect.Effect<
      A,
      E | ER | EffectInputCallbackError | ActionInterrupted,
      ActionRuntimeRemainingRequirements<R | ActionResultInvalidationRequirements<A>, RRuntime>
    > =>
      runAtActionBoundary(Effect.suspend(() => {
        return Effect.withFiber((fiber) => {
          const submissionFiber = fiber as ActionSubmissionFiber<A, E | ER | EffectInputCallbackError>;

          return submissions.beginEffect(submissionFiber).pipe(
            Effect.flatMap((submission) => {
              if (submission._tag === "Join") {
                return Fiber.join(submission.fiber);
              }

              return Effect.gen(function* () {
                if (submission.previousFiber && submission.previousFiber !== submissionFiber) {
                  yield* Fiber.interrupt(submission.previousFiber);
                }

                return yield* runWorkflow(input, submission);
              }).pipe(Effect.ensuring(submissions.clearCurrentEffect(submission.clearToken)));
            })
          );
        });
      })) as Effect.Effect<
        A,
        E | ER | EffectInputCallbackError | ActionInterrupted,
        ActionRuntimeRemainingRequirements<R | ActionResultInvalidationRequirements<A>, RRuntime>
      >;

    return {
      definition,
      state: submissions.state,
      invalidationPlan: submissions.invalidationPlan,
      submitEffect,
      resetEffect,
      reset: () => {
        submissions.reset();
      }
    };
  }
}
