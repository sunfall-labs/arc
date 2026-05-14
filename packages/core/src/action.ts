import { Data, Effect, Fiber, type Schedule } from "effect";
import { ActionResult, type AnyActionResult } from "./action-result.js";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { Resource, type ResourceInvalidation, type ResourceInvalidationPlan } from "./resource.js";
import { currentOrDefaultRuntime, getCurrentRuntime, type EffectUiRuntime } from "./runtime.js";
import { Signal, type ReadableSignal, type WritableSignal } from "./signal.js";

export const ActionTypeId: unique symbol = Symbol.for("@effect-ui/core/Action") as typeof ActionTypeId;

export type ActionState<I, A, E = unknown> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Pending"; readonly input: I; readonly previous?: A }
  | { readonly _tag: "Success"; readonly value: A; readonly input: I; readonly invalidationPlan?: ResourceInvalidationPlan }
  | { readonly _tag: "Failure"; readonly error: E; readonly input: I; readonly previous?: A };

export type ActionConcurrency = "latest" | "parallel" | "exhaust";

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

export interface ActionInstance<I, A, E = unknown, R = never> {
  readonly definition: ActionDefinition<I, A, E, R>;
  readonly state: ReadableSignal<ActionState<I, A, E>>;
  readonly invalidationPlan: ReadableSignal<ResourceInvalidationPlan | undefined>;
  submitEffect(input: I): Effect.Effect<A, E | ActionInterrupted, R>;
  submit(input: I): Promise<A>;
  resetEffect(): Effect.Effect<void>;
  reset(): void;
}

export interface ActionUseOptions<R = never, ER = unknown> {
  readonly runtime?: EffectUiRuntime<R, ER>;
}

export class ActionInterrupted extends Data.TaggedError("ActionInterrupted")<{
  readonly actionName: string;
}> {}

type AnyActionDefinition = ActionDefinition<any, any, any, any>;

const actionRegistry = new Map<string, AnyActionDefinition>();

export const isActionDefinition = (value: unknown): value is ActionDefinition<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ActionTypeId]?: unknown })[ActionTypeId] === ActionTypeId;

const previousFromState = <I, A, E>(state: ActionState<I, A, E>): A | undefined => {
  switch (state._tag) {
    case "Success":
      return state.value;
    case "Failure":
    case "Pending":
      return state.previous;
    case "Idle":
      return undefined;
  }
};

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

  export const use = <I, A, E = unknown, R = never>(
    definition: ActionDefinition<I, A, E, R>,
    options: ActionUseOptions<R> = {}
  ): ActionInstance<I, A, E, R> => {
    const state = Signal.make<ActionState<I, A, E>>({ _tag: "Idle" });
    const invalidationPlan = Signal.make<ResourceInvalidationPlan | undefined>(undefined);
    const runtime = options.runtime ?? getCurrentRuntime() ?? currentOrDefaultRuntime();
    let version = 0;
    let currentSubmission:
      | {
          readonly token: object;
          fiber?: Fiber.Fiber<A, E | ActionInterrupted>;
          promise?: Promise<A>;
        }
      | undefined;

    const runEffect = (input: I): Effect.Effect<A, E, R> => {
      const effect = toEffect(definition.run(input));
      const retry = definition.policy?.retry;
      return retry ? Effect.retry(effect, retry) : effect;
    };

    const applyOptimistic = (input: I): Effect.Effect<ActionTransactionRuntime<R>, never, R> => {
      const transaction = makeTransactionRuntime<R>();

      if (!definition.optimistic) {
        return Effect.succeed(transaction);
      }

      return Effect.gen(function* () {
        const extraRollback = yield* definition.optimistic!(input, transaction.api);
        return {
          api: transaction.api,
          commit: transaction.commit,
          rollback: Effect.ensuring(extraRollback, transaction.rollback)
        };
      });
    };

    const runWorkflow = (
      input: I,
      token: number,
      options: {
        readonly interruptStale: boolean;
        readonly updateOnlyLatest: boolean;
      }
    ): Effect.Effect<A, E | ActionInterrupted, R> =>
      Effect.suspend(() => {
        let rollback: ActionRollback<R> = Effect.void as ActionRollback<R>;

        return Effect.ensuring(
          Effect.gen(function* () {
            const previous = previousFromState(state.get());
            invalidationPlan.set(undefined);
            state.set({
              _tag: "Pending",
              input,
              ...(previous === undefined ? {} : { previous })
            });

            const transaction = yield* applyOptimistic(input);
            rollback = transaction.rollback;

            const value = yield* runEffect(input);
            const isLatest = token === version;
            if (options.interruptStale && !isLatest) {
              return yield* new ActionInterrupted({ actionName: definition.name });
            }

            const invalidations = invalidationsFor(definition, value, input);
            const plan = yield* Resource.planInvalidationEffect(invalidations);
            invalidationPlan.set(invalidations.length === 0 ? undefined : plan);
            if (invalidations.length > 0) {
              yield* Resource.runInvalidationPlanEffect(plan);
            }

            yield* transaction.commit;
            rollback = Effect.void as ActionRollback<R>;

            if (!options.updateOnlyLatest || isLatest) {
              state.set({
                _tag: "Success",
                value,
                input,
                ...(invalidations.length === 0 ? {} : { invalidationPlan: plan })
              });
            }

            return value;
          }),
          Effect.suspend(() => rollback)
        );
      }).pipe(
        Effect.catch((error: E | ActionInterrupted): Effect.Effect<never, E | ActionInterrupted> => {
          if (error instanceof ActionInterrupted) {
            return Effect.fail(error);
          }

          const previous = previousFromState(state.get());
          if (!options.updateOnlyLatest || token === version) {
            state.set({
              _tag: "Failure",
              error: error as E,
              input,
              ...(previous === undefined ? {} : { previous })
            });
          }
          return Effect.fail(error as E);
        })
      );

    const submitEffect = (input: I): Effect.Effect<A, E | ActionInterrupted, R> =>
      Effect.suspend(() => {
        const concurrency = definition.policy?.concurrency ?? "latest";
        const current = currentSubmission;
        if (concurrency === "exhaust" && current?.fiber) {
          return Fiber.join(current.fiber);
        }

        const previousFiber = concurrency === "latest" ? current?.fiber : undefined;
        const token = ++version;
        const submissionToken = {};
        return Effect.withFiber((fiber) => {
          if (concurrency !== "parallel") {
            currentSubmission = {
              token: submissionToken,
              fiber: fiber as Fiber.Fiber<A, E | ActionInterrupted>
            };
          }

          return Effect.gen(function* () {
            if (previousFiber && previousFiber !== fiber) {
              yield* Fiber.interrupt(previousFiber);
            }

            return yield* runWorkflow(input, token, {
              interruptStale: concurrency === "latest",
              updateOnlyLatest: true
            });
          }).pipe(Effect.ensuring(clearCurrentEffect(submissionToken)));
        });
      });

    const resetEffect = (): Effect.Effect<void> =>
      Effect.sync(() => {
        version++;
        invalidationPlan.set(undefined);
        state.set({ _tag: "Idle" });
      });

    const clearCurrentEffect = (token: object): Effect.Effect<void> =>
      Effect.sync(() => {
        if (currentSubmission?.token === token) {
          currentSubmission = undefined;
        }
      });

    const submit = (input: I): Promise<A> => {
      const concurrency = definition.policy?.concurrency ?? "latest";

      if (concurrency === "exhaust") {
        const current = currentSubmission;
        if (current?.promise) {
          return current.promise;
        }
        if (current?.fiber) {
          return runtime.runPromise(Fiber.join(current.fiber));
        }
      }

      const previousFiber = concurrency === "latest" ? currentSubmission?.fiber : undefined;

      const token = ++version;
      const submissionToken = {};
      if (concurrency !== "parallel") {
        currentSubmission = { token: submissionToken };
      }

      const fiber = runtime.runFork(
        Effect.gen(function* () {
          if (previousFiber) {
            yield* Fiber.interrupt(previousFiber);
          }

          return yield* runWorkflow(input, token, {
            interruptStale: concurrency === "latest",
            updateOnlyLatest: true
          });
        })
      );

      const promise = runtime.runPromise(
        Fiber.join(fiber).pipe(
          Effect.ensuring(clearCurrentEffect(submissionToken))
        )
      );

      if (concurrency !== "parallel" && currentSubmission?.token === submissionToken) {
        currentSubmission.fiber = fiber;
        currentSubmission.promise = promise;
      }

      return promise;
    };

    return {
      definition,
      state,
      invalidationPlan,
      submitEffect,
      submit,
      resetEffect,
      reset: () => {
        const submission = currentSubmission;
        if (submission?.fiber) {
          void runtime.runFork(Fiber.interrupt(submission.fiber));
        }
        currentSubmission = undefined;
        runtime.runSync(resetEffect());
      }
    };
  };
}
