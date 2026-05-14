import { Effect, Fiber, type Schedule } from "effect";
import { ActionResult, type AnyActionResult } from "./action-result.js";
import {
  ActionInterrupted,
  makeActionSubmissionController,
  type ActionSubmissionFiber,
  type ActionSubmissionRun,
  type ActionSubmissionState
} from "./action-submission.js";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { Resource, type ResourceInvalidation, type ResourceInvalidationPlan } from "./resource.js";
import { currentOrDefaultRuntime, getCurrentRuntime, type EffectUiRuntime } from "./runtime.js";
import { Signal, type ReadableSignal, type WritableSignal } from "./signal.js";

export const ActionTypeId: unique symbol = Symbol.for("@effect-ui/core/Action") as typeof ActionTypeId;

/** State machine for one action instance. */
export type ActionState<I, A, E = unknown> = ActionSubmissionState<I, A, E>;

export type ActionConcurrency = "latest" | "parallel" | "exhaust";

/** Runtime policy for submissions, including concurrency and retry behavior. */
export interface ActionPolicy<E = unknown> {
  readonly concurrency?: ActionConcurrency;
  readonly retry?: Schedule.Schedule<unknown, E>;
}

export type ActionRollback<R = never> = Effect.Effect<void, never, R>;

export interface ActionOptimisticTransaction {
  readonly signal: <A>(
    signal: WritableSignal<A>,
    update: A | ((current: A) => A)
  ) => Effect.Effect<void>;
}

export interface ActionDefinition<I, A, E = unknown, R = never> {
  readonly [ActionTypeId]: typeof ActionTypeId;
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly policy?: ActionPolicy<E>;
  readonly run: (input: I) => EffectInput<A, E, R>;
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction
  ) => Effect.Effect<ActionRollback<R>, never, R>;
  readonly invalidates?: (
    value: A,
    input: I
  ) => ReadonlyArray<ResourceInvalidation>;
}

/**
 * Configuration for a mutation-like workflow.
 *
 * `run` may return a value or an Effect, but the action executes it through Effect
 * so retries, interruption, optimistic rollback, and resource invalidation compose.
 */
export interface ActionOptions<I, A, E = unknown, R = never> {
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly policy?: ActionPolicy<E>;
  readonly run: (input: I) => EffectInput<A, E, R>;
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction
  ) => Effect.Effect<ActionRollback<R>, never, R>;
  readonly invalidates?: (
    value: A,
    input: I
  ) => ReadonlyArray<ResourceInvalidation>;
}

/**
 * Live action controller returned by Action.use.
 *
 * Read state in UI code and submit through submitEffect.
 */
export interface ActionInstance<I, A, E = unknown, R = never> {
  readonly definition: ActionDefinition<I, A, E, R>;
  readonly state: ReadableSignal<ActionState<I, A, E>>;
  readonly invalidationPlan: ReadableSignal<ResourceInvalidationPlan | undefined>;
  /** Runs the action workflow as an Effect, preserving typed errors and requirements. */
  submitEffect(input: I): Effect.Effect<A, E | ActionInterrupted, R>;
  resetEffect(): Effect.Effect<void>;
  reset(): void;
}

export interface ActionUseOptions<R = never, ER = unknown> {
  readonly runtime?: EffectUiRuntime<R, ER>;
}

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

const actionRegistry = new Map<string, AnyActionDefinition>();

export const isActionDefinition = (value: unknown): value is ActionDefinition<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ActionTypeId]?: unknown })[ActionTypeId] === ActionTypeId;

const resultInvalidations = (value: unknown): ReadonlyArray<ResourceInvalidation> =>
  ActionResult.is(value)
    ? ActionResult.invalidations(value as AnyActionResult)
    : [];

const invalidationsFor = <I, A, E, R>(
  definition: ActionDefinition<I, A, E, R>,
  value: A,
  input: I
): ReadonlyArray<ResourceInvalidation> => [
  ...(definition.invalidates?.(value, input) ?? []),
  ...resultInvalidations(value)
];

interface SignalPatch<A> {
  readonly transaction: symbol;
  readonly apply: (value: A) => A;
}

interface SignalPatchState<A> {
  base: A;
  patches: Array<SignalPatch<A>>;
}

type AnyWritableSignal = WritableSignal<any>;
type AnySignalPatchState = SignalPatchState<any>;

type SignalPatchDecision<A> =
  | { readonly _tag: "Commit"; readonly base: A }
  | { readonly _tag: "Rollback" };

interface ActionTransactionRuntime<R> {
  readonly api: ActionOptimisticTransaction;
  readonly commit: ActionRollback<R>;
  readonly rollback: ActionRollback<R>;
}

const signalPatchStates = new WeakMap<AnyWritableSignal, AnySignalPatchState>();

const recomputeSignal = <A>(
  signal: WritableSignal<A>,
  state: SignalPatchState<A>
): void => {
  let value = state.base;
  for (const patch of state.patches) {
    value = patch.apply(value);
  }
  signal.set(value);
};

const updateSignalPatches = <A>(
  signal: WritableSignal<A>,
  transaction: symbol,
  onPatch: (base: A, patch: SignalPatch<A>) => SignalPatchDecision<A>
): void => {
  const state = signalPatchStates.get(signal) as SignalPatchState<A> | undefined;
  if (!state) {
    return;
  }

  const patches: Array<SignalPatch<A>> = [];
  let base = state.base;

  for (const patch of state.patches) {
    if (patch.transaction === transaction) {
      const decision = onPatch(base, patch);
      if (decision._tag === "Commit") {
        base = decision.base;
      }
    } else {
      patches.push(patch);
    }
  }

  state.base = base;
  state.patches = patches;

  if (state.patches.length === 0) {
    signalPatchStates.delete(signal);
  }

  recomputeSignal(signal, state);
};

const makeTransactionRuntime = <R>(): ActionTransactionRuntime<R> => {
  const transaction = Symbol("Action.optimistic");
  const touched = new Set<AnyWritableSignal>();

  const api: ActionOptimisticTransaction = {
    signal: <A>(
      signal: WritableSignal<A>,
      update: A | ((current: A) => A)
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        const existing = signalPatchStates.get(signal) as SignalPatchState<A> | undefined;
        const state = existing ?? {
          base: Signal.peek(signal),
          patches: []
        };
        const apply =
          typeof update === "function" ? update as (current: A) => A : () => update;

        state.patches.push({ transaction, apply });
        signalPatchStates.set(signal, state);
        touched.add(signal);
        recomputeSignal(signal, state);
      })
  };

  const finish = (
    onPatch: <A>(base: A, patch: SignalPatch<A>) => SignalPatchDecision<A>
  ): ActionRollback<R> =>
    Effect.sync(() => {
      for (const signal of touched) {
        updateSignalPatches(signal, transaction, onPatch);
      }
      touched.clear();
    }) as ActionRollback<R>;

  return {
    api,
    commit: finish((base, patch) => ({ _tag: "Commit", base: patch.apply(base) })),
    rollback: finish(() => ({ _tag: "Rollback" }))
  };
};

/** Helpers for defining and running Effect-first actions. */
export namespace Action {
  export type Definition<I, A, E = unknown, R = never> = ActionDefinition<I, A, E, R>;
  export type Instance<I, A, E = unknown, R = never> = ActionInstance<I, A, E, R>;
  export type State<I, A, E = unknown> = ActionState<I, A, E>;
  export type Concurrency = ActionConcurrency;
  export type Policy<E = unknown> = ActionPolicy<E>;
  export type Rollback<R = never> = ActionRollback<R>;
  export type OptimisticTransaction = ActionOptimisticTransaction;

  export const planInvalidation = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    value: A,
    input: I
  ): ResourceInvalidationPlan =>
    Resource.planInvalidation(invalidationsFor(definition, value, input));

  /**
   * Defines a reusable action without binding it to UI state.
   *
   * Use Action.use to create an instance for a component or interaction boundary.
   *
   * @example
   * ```ts
   * const saveUser = Action.define({
   *   name: "saveUser",
   *   run: (input: UserInput) => ServerSaveUser.effect(input)
   * });
   * ```
   */
  export const define = <I, A, E = unknown, R = never>(
    definition: Omit<ActionOptions<I, A, E, R>, "run" | "optimistic"> & {
      readonly run: (input: I) => EffectInput<A, E, R>;
      readonly optimistic?: (
        input: I,
        transaction: ActionOptimisticTransaction
      ) => Effect.Effect<ActionRollback<R>, never, R>;
    }
  ): ActionDefinition<I, A, E, R> => {
    const { run, optimistic, ...rest } = definition;

    const action: ActionDefinition<I, A, E, R> = {
      ...rest,
      run: run as (input: I) => EffectInput<A, E, R>,
      ...(optimistic === undefined
        ? {}
        : {
            optimistic: optimistic as (
              input: I,
              transaction: ActionOptimisticTransaction
            ) => Effect.Effect<ActionRollback<R>, never, R>
          }),
      [ActionTypeId]: ActionTypeId
    };

    actionRegistry.set(action.name, action);
    return action;
  };

  export const definitions = (): ReadonlyMap<string, AnyActionDefinition> =>
    actionRegistry;

  export const get = (name: string): AnyActionDefinition | undefined =>
    actionRegistry.get(name);

  export const clearRegistryUnsafe = (): void => {
    actionRegistry.clear();
  };

  /**
   * Creates a live action instance with state, optimistic updates, and invalidation.
   *
   * The returned instance submits through submitEffect.
   */
  export const use = <I, A, E = unknown, R = never>(
    definition: ActionDefinition<I, A, E, R>,
    options: ActionUseOptions<R> = {}
  ): ActionInstance<I, A, E, R> => {
    const runtime = options.runtime ?? getCurrentRuntime() ?? currentOrDefaultRuntime();
    const submissions = makeActionSubmissionController<I, A, E>(
      definition.policy?.concurrency === undefined
        ? { actionName: definition.name }
        : { actionName: definition.name, concurrency: definition.policy.concurrency }
    );

    const runEffect = (input: I): Effect.Effect<A, E, R> => {
      const effect = toEffect(definition.run(input));
      const retry = definition.policy?.retry;
      return retry ? Effect.retry(effect, retry) : effect;
    };

    const applyOptimistic = (
      input: I,
      transaction: ActionTransactionRuntime<R>
    ): Effect.Effect<ActionRollback<R>, never, R> => {
      if (!definition.optimistic) {
        return Effect.succeed(transaction.rollback);
      }

      return definition.optimistic(input, transaction.api).pipe(
        Effect.map((extraRollback) =>
          Effect.ensuring(extraRollback, transaction.rollback)
        )
      );
    };

    const runWorkflow = (
      input: I,
      submission: ActionSubmissionRun<A, E>
    ): Effect.Effect<A, E | ActionInterrupted, R> =>
      Effect.suspend(() => {
        let rollback: ActionRollback<R> = Effect.void as ActionRollback<R>;

        return Effect.ensuring(
          Effect.gen(function* () {
            yield* submissions.pendingEffect(submission, input);

            const transaction = makeTransactionRuntime<R>();
            rollback = transaction.rollback;
            rollback = yield* applyOptimistic(input, transaction);

            const value = yield* runEffect(input);
            yield* submissions.interruptStaleEffect(submission);

            const invalidations = invalidationsFor(definition, value, input);
            const plan = yield* Resource.planInvalidationEffect(invalidations);
            if (invalidations.length > 0) {
              yield* Resource.runInvalidationPlanEffect(plan);
            }

            yield* transaction.commit;
            rollback = Effect.void as ActionRollback<R>;

            yield* submissions.successEffect(
              submission,
              input,
              value,
              invalidations.length === 0 ? undefined : plan
            );

            return value;
          }),
          Effect.suspend(() => rollback)
        );
      }).pipe(
        Effect.catch((error: E | ActionInterrupted): Effect.Effect<never, E | ActionInterrupted> => {
          if (error instanceof ActionInterrupted) {
            return Effect.fail(error);
          }

          return submissions.failureEffect(submission, input, error as E).pipe(
            Effect.andThen(Effect.fail(error as E))
          );
        })
      );

    const resetEffect = submissions.resetEffect;

    const submitEffect = (input: I): Effect.Effect<A, E | ActionInterrupted, R> =>
      Effect.suspend(() => {
        return Effect.withFiber((fiber) => {
          const submissionFiber = fiber as ActionSubmissionFiber<A, E>;

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
      });

    return {
      definition,
      state: submissions.state,
      invalidationPlan: submissions.invalidationPlan,
      submitEffect,
      resetEffect,
      reset: () => {
        submissions.reset(runtime);
      }
    };
  };
}
