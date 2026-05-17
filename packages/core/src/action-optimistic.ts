import { Effect } from "effect";
import { EffectInputCallbackError, type RejectPromiseLikeValue } from "./effect-like.js";
import { rejectPromiseLikeSyncCallbackValue } from "./effect-input-sync.js";
import { Signal, type WritableSignal } from "./signal.js";

export type ActionRollback<R = never> = Effect.Effect<void, EffectInputCallbackError, R>;

type ActionOptimisticSignalValue<A> = A &
  RejectPromiseLikeValue<A> & {
    readonly call?: never;
    readonly apply?: never;
    readonly bind?: never;
  };

type ActionOptimisticSignalUpdate<A> =
  | ActionOptimisticSignalValue<A>
  | ((current: A) => ActionOptimisticSignalValue<A>);

/**
 * Optimistic patch transaction passed to `Action.define({ optimistic })`.
 *
 * Signal patches must be plain synchronous values or pure synchronous updater
 * functions. Promise-shaped patch values are rejected as
 * `EffectInputCallbackError`; move host Promise work into the action `run`
 * Effect with `Effect.tryPromise(...)` before patching local signal state.
 */
export interface ActionOptimisticTransaction {
  /**
   * Patches a writable signal for the lifetime of the optimistic submission.
   *
   * The update may be a plain value or a synchronous updater. It must not
   * return a Promise-shaped value.
   */
  readonly signal: <A>(
    signal: WritableSignal<A>,
    update: ActionOptimisticSignalUpdate<A>,
  ) => Effect.Effect<void, EffectInputCallbackError>;
}

export interface ActionOptimisticTransactionRuntime<R> {
  readonly api: ActionOptimisticTransaction;
  readonly commit: ActionRollback<R>;
  readonly rollback: ActionRollback<R>;
}

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

interface PlannedSignalPatchFinish<A> {
  readonly signal: WritableSignal<A>;
  readonly value: A;
  readonly state: SignalPatchState<A>;
}

const signalPatchStates = new WeakMap<AnyWritableSignal, AnySignalPatchState>();

const optimisticSignalPatchError = (actionName: string, cause: unknown): EffectInputCallbackError =>
  cause instanceof EffectInputCallbackError
    ? cause
    : new EffectInputCallbackError({
        operation: `Action.optimistic(${actionName}).signal`,
        cause,
        guidance:
          "Optimistic signal update functions must be pure and total. Synchronous throws are reported in the Effect error channel.",
      });

const optimisticSignalPromiseGuidance =
  "Optimistic signal updates must return plain values. Move host Promise work into the action run Effect with Effect.tryPromise(...) before patching local signal state.";

const rejectOptimisticSignalPatchValue = <A>(actionName: string, value: A): A =>
  rejectPromiseLikeSyncCallbackValue(
    `Action.optimistic(${actionName}).signal`,
    value,
    optimisticSignalPromiseGuidance,
  );

const applySignalPatchEffect = <A>(
  actionName: string,
  patch: SignalPatch<A>,
  value: A,
): Effect.Effect<A, EffectInputCallbackError> =>
  Effect.try({
    try: () => rejectOptimisticSignalPatchValue(actionName, patch.apply(value)),
    catch: (cause) => optimisticSignalPatchError(actionName, cause),
  });

const recomputeSignalValueEffect = <A>(
  actionName: string,
  state: SignalPatchState<A>,
): Effect.Effect<A, EffectInputCallbackError> =>
  Effect.gen(function* () {
    let value = state.base;
    for (const patch of state.patches) {
      value = yield* applySignalPatchEffect(actionName, patch, value);
    }
    return value;
  });

const planSignalPatches = <A>(
  actionName: string,
  signal: WritableSignal<A>,
  transaction: symbol,
  onPatch: (
    base: A,
    patch: SignalPatch<A>,
  ) => Effect.Effect<SignalPatchDecision<A>, EffectInputCallbackError>,
): Effect.Effect<PlannedSignalPatchFinish<A> | undefined, EffectInputCallbackError> =>
  Effect.gen(function* () {
    const state = signalPatchStates.get(signal) as SignalPatchState<A> | undefined;
    if (!state) {
      return;
    }

    const patches: Array<SignalPatch<A>> = [];
    let base = state.base;

    for (const patch of state.patches) {
      if (patch.transaction === transaction) {
        const decision = yield* onPatch(base, patch);
        if (decision._tag === "Commit") {
          base = decision.base;
        }
      } else {
        patches.push(patch);
      }
    }

    const nextState: SignalPatchState<A> = { base, patches };
    const value = yield* recomputeSignalValueEffect(actionName, nextState);
    return { signal, value, state: nextState };
  });

const applySignalPatchPlan = <A>(plan: PlannedSignalPatchFinish<A>): void => {
  plan.signal.set(plan.value);
  if (plan.state.patches.length === 0) {
    signalPatchStates.delete(plan.signal);
  } else {
    signalPatchStates.set(plan.signal, plan.state);
  }
};

/**
 * Creates one optimistic signal transaction for an Action submission.
 *
 * The transaction owns every signal patch it touches. Commit folds those
 * patches into the signal base value, while rollback removes them and
 * recomputes any later optimistic patches from other submissions.
 */
export const makeActionOptimisticTransactionRuntime = <R>(
  actionName: string,
): ActionOptimisticTransactionRuntime<R> => {
  const transaction = Symbol("Action.optimistic");
  const touched = new Set<AnyWritableSignal>();

  const api: ActionOptimisticTransaction = {
    signal: <A>(
      signal: WritableSignal<A>,
      update: ActionOptimisticSignalUpdate<A>,
    ): Effect.Effect<void, EffectInputCallbackError> =>
      Effect.gen(function* () {
        const existing = signalPatchStates.get(signal) as SignalPatchState<A> | undefined;
        const state = existing ?? {
          base: Signal.peek(signal),
          patches: [],
        };
        const apply = typeof update === "function" ? (update as (current: A) => A) : () => update;

        const nextState = {
          base: state.base,
          patches: [...state.patches, { transaction, apply }],
        };
        const value = yield* recomputeSignalValueEffect(actionName, nextState);
        signal.set(value);
        signalPatchStates.set(signal, nextState);
        touched.add(signal);
      }),
  };

  const finish = (
    onPatch: <A>(
      base: A,
      patch: SignalPatch<A>,
    ) => Effect.Effect<SignalPatchDecision<A>, EffectInputCallbackError>,
  ): ActionRollback<R> =>
    Effect.gen(function* () {
      const plans: Array<PlannedSignalPatchFinish<any>> = [];
      for (const signal of touched) {
        const plan = yield* planSignalPatches(actionName, signal, transaction, onPatch);
        if (plan) {
          plans.push(plan);
        }
      }
      for (const plan of plans) {
        applySignalPatchPlan(plan);
      }
      touched.clear();
    }) as ActionRollback<R>;

  return {
    api,
    commit: finish((base, patch) =>
      Effect.map(applySignalPatchEffect(actionName, patch, base), (nextBase) => ({
        _tag: "Commit",
        base: nextBase,
      })),
    ),
    rollback: finish(() => Effect.succeed({ _tag: "Rollback" })),
  };
};
