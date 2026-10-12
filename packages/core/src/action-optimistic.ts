import { Effect, Option } from "effect";
import { EffectInputCallbackError, type RejectPromiseLikeValue } from "./effect-like.js";
import { rejectPromiseLikeSyncCallbackValue } from "./effect-input-sync.js";
import { ResourceTypeId } from "./resource-identifiers.js";
import type { ResourceLifetimeEntry } from "./resource-lifetime.js";
import {
  applyResourceOptimisticSettle,
  cacheResourceOptimisticCommitEffect,
  patchResourceEffect,
  peekResourceValueEffect,
  planResourceOptimisticSettle,
  type ResourceOptimisticTarget,
} from "./resource-runtime.js";
import { resourceRefStoreKey } from "./resource-dependency-graph.js";
import type { AnyResourceRef, ResourceRef } from "./resource.js";
import { Signal, type WritableSignal } from "./signal.js";
import { batchSignalWrites } from "./signal-transaction.js";

/** Settles one optimistic transaction: commit or rollback. */
export type ActionOptimisticSettle = Effect.Effect<void>;

type Primitive = null | undefined | string | number | boolean | bigint | symbol;

// Applied per union member: the function guard (`call`/`apply`/`bind`) keeps
// updater functions from passing as values (including behind `unknown`), but
// intersecting it with a primitive such as `undefined` would yield `never`.
type ActionOptimisticValue<A> = A extends Primitive
  ? A & RejectPromiseLikeValue<A>
  : A &
      RejectPromiseLikeValue<A> & {
        readonly call?: never;
        readonly apply?: never;
        readonly bind?: never;
      };

/** A plain next value, or a pure updater of the current one, for `transaction.set`. */
export type ActionOptimisticSetUpdate<A> =
  | ActionOptimisticValue<A>
  | ((current: A) => ActionOptimisticValue<A>);

/**
 * What `transaction.set` patches: a writable Signal, or the entry a Resource
 * ref names (any Resource family; the patch applies to its output value).
 */
export type ActionOptimisticSetTarget<A> = WritableSignal<A> | ResourceRef<any, A, any, any>;

/** Expert-public marker for row stores an Action can patch optimistically. */
export const ActionOptimisticRowsTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ActionOptimisticRows",
) as typeof ActionOptimisticRowsTypeId;

/** Partial patch or draft updater for one optimistic row update. */
export type ActionOptimisticRowUpdate<A extends object> = Partial<A> | ((draft: A) => A | void);

/** One optimistic row change, as a row store receives it. */
export type ActionOptimisticRowChange<A extends object, K> =
  | { readonly _tag: "Insert"; readonly values: ReadonlyArray<A> }
  | { readonly _tag: "Update"; readonly key: K; readonly update: ActionOptimisticRowUpdate<A> }
  | { readonly _tag: "Delete"; readonly key: K };

/**
 * The optimistic layer one Action submission owns in a row store, bound to the
 * store of the runtime the submission runs on.
 */
export interface ActionOptimisticRowsLayer {
  /** Folds the layer into the store's synced base; the next sync replaces it. */
  readonly commit: Effect.Effect<void>;
  /** Removes the layer and rebases later layers from other submissions. */
  readonly rollback: Effect.Effect<void>;
}

/**
 * A keyed row store that Actions can patch optimistically. Collections
 * implement it; application code passes the store to
 * `transaction.insert/update/delete`.
 */
export interface ActionOptimisticRows<A extends object, K> {
  readonly [ActionOptimisticRowsTypeId]: {
    /**
     * Applies `change` to the layer `transaction` owns and returns that
     * layer. Rows that are not in the store make `Update` and `Delete` no-ops.
     * A change the store cannot accept (a row its schema rejects) is a defect.
     */
    readonly apply: (
      transaction: string,
      change: ActionOptimisticRowChange<A, K>,
    ) => Effect.Effect<ActionOptimisticRowsLayer>;
  };
}

/**
 * Optimistic patch transaction passed to `Action.define({ optimistic })`.
 *
 * Every patch lives exactly as long as the submission: a success folds the
 * patches into their base values, and a failure or interruption removes them,
 * rebasing patches from other in-flight submissions. Patches must be plain
 * synchronous values or pure synchronous updaters: a throwing updater, a
 * Promise-shaped value, or a row the collection rejects is a defect.
 */
export interface ActionOptimisticTransaction {
  /**
   * Patches a writable Signal, or the loaded value of a Resource entry
   * (`ProjectById(id)`): readers see the patched value while a reload
   * replaces the value underneath. An entry that has not loaded is left alone.
   */
  readonly set: <A>(
    target: ActionOptimisticSetTarget<A>,
    // The target fixes `A`; the update is checked against it, never inferred from.
    update: ActionOptimisticSetUpdate<NoInfer<A>>,
  ) => Effect.Effect<void>;
  /** Inserts (or replaces) rows; they read `$synced: false` until the submission settles. */
  readonly insert: <A extends object, K>(
    rows: ActionOptimisticRows<A, K>,
    values: NoInfer<A> | ReadonlyArray<NoInfer<A>>,
  ) => Effect.Effect<void>;
  /** Patches one row; a row that is not loaded is left alone. */
  readonly update: <A extends object, K>(
    rows: ActionOptimisticRows<A, K>,
    key: NoInfer<K>,
    update: ActionOptimisticRowUpdate<NoInfer<A>>,
  ) => Effect.Effect<void>;
  /** Hides one row until the submission settles. */
  readonly delete: <A extends object, K>(
    rows: ActionOptimisticRows<A, K>,
    key: NoInfer<K>,
  ) => Effect.Effect<void>;
}

export interface ActionOptimisticTransactionRuntime {
  readonly api: ActionOptimisticTransaction;
  readonly commit: ActionOptimisticSettle;
  readonly rollback: ActionOptimisticSettle;
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

const isResourceRef = (target: ActionOptimisticSetTarget<any>): target is AnyResourceRef =>
  (target as { readonly [ResourceTypeId]?: unknown })[ResourceTypeId] === ResourceTypeId;

const optimisticPatchError = (actionName: string, cause: unknown): EffectInputCallbackError =>
  cause instanceof EffectInputCallbackError
    ? cause
    : new EffectInputCallbackError({
        operation: `Action.optimistic(${actionName}).set`,
        cause,
        guidance:
          "Optimistic update functions must be pure and total. A synchronous throw is a defect.",
      });

const optimisticPromiseGuidance =
  "Optimistic updates must return plain values. Move host Promise work into the action run Effect with Effect.tryPromise(...) before patching local state.";

/** The update as a pure function of the current value that rejects Promise-shaped results. */
const optimisticUpdater =
  <A>(actionName: string, update: ActionOptimisticSetUpdate<A>) =>
  (current: A): A =>
    rejectPromiseLikeSyncCallbackValue(
      `Action.optimistic(${actionName}).set`,
      typeof update === "function" ? (update as (current: A) => A)(current) : (update as A),
      optimisticPromiseGuidance,
    );

const applySignalPatchEffect = <A>(
  actionName: string,
  patch: SignalPatch<A>,
  value: A,
): Effect.Effect<A, EffectInputCallbackError> =>
  Effect.try({
    try: () => patch.apply(value),
    catch: (cause) => optimisticPatchError(actionName, cause),
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

let nextOptimisticTransaction = 0;

/**
 * Creates one optimistic transaction for an Action submission.
 *
 * The transaction owns every Signal patch, Resource entry patch, and row-store
 * layer it touches. Commit folds them into their base values, while rollback
 * removes them and recomputes any later optimistic patches from other
 * submissions.
 */
export const makeActionOptimisticTransactionRuntime = (
  actionName: string,
): ActionOptimisticTransactionRuntime => {
  const transaction = Symbol("Action.optimistic");
  const transactionId = `action:${actionName}:${++nextOptimisticTransaction}`;
  const touched = new Set<AnyWritableSignal>();
  // Every Resource entry this transaction patched, in first-touch order.
  const resources = new Map<ResourceLifetimeEntry<any, any>, ResourceOptimisticTarget>();
  // One layer per row store, in first-touch order.
  const rowLayers = new Map<ActionOptimisticRows<any, any>, ActionOptimisticRowsLayer>();

  const applyRows = <A extends object, K>(
    rows: ActionOptimisticRows<A, K>,
    change: ActionOptimisticRowChange<A, K>,
  ): Effect.Effect<void> =>
    Effect.map(rows[ActionOptimisticRowsTypeId].apply(transactionId, change), (layer) => {
      if (!rowLayers.has(rows)) {
        rowLayers.set(rows, layer);
      }
    });

  const setSignal = <A>(signal: WritableSignal<A>, apply: (current: A) => A): Effect.Effect<void> =>
    Effect.gen(function* () {
      const existing = signalPatchStates.get(signal) as SignalPatchState<A> | undefined;
      const state = existing ?? {
        base: Signal.peek(signal),
        patches: [],
      };
      const nextState = {
        base: state.base,
        patches: [...state.patches, { transaction, apply }],
      };
      const value = yield* recomputeSignalValueEffect(actionName, nextState);
      signal.set(value);
      signalPatchStates.set(signal, nextState);
      touched.add(signal);
    }).pipe(Effect.orDie);

  const setResource = <A>(ref: AnyResourceRef, apply: (current: A) => A): Effect.Effect<void> =>
    patchResourceEffect(ref, transaction, apply).pipe(
      Effect.mapError((cause) => optimisticPatchError(actionName, cause)),
      Effect.map((target) => {
        if (target !== undefined && !resources.has(target.entry)) {
          resources.set(target.entry, target);
        }
      }),
      Effect.orDie,
    );

  const api: ActionOptimisticTransaction = {
    set: (target, update) => {
      const apply = optimisticUpdater(actionName, update);
      return isResourceRef(target) ? setResource(target, apply) : setSignal(target, apply);
    },
    insert: (rows, values) =>
      applyRows(rows, {
        _tag: "Insert",
        values: Array.isArray(values) ? values : [values as never],
      }),
    update: (rows, key, update) => applyRows(rows, { _tag: "Update", key, update }),
    delete: (rows, key) => applyRows(rows, { _tag: "Delete", key }),
  };

  const finish = (
    onPatch: <A>(
      base: A,
      patch: SignalPatch<A>,
    ) => Effect.Effect<SignalPatchDecision<A>, EffectInputCallbackError>,
    settleRows: (layer: ActionOptimisticRowsLayer) => Effect.Effect<void>,
    event: "success" | "failure",
  ): ActionOptimisticSettle =>
    Effect.gen(function* () {
      // Row layers settle first: they cannot fail, so a failing updater never
      // strands a row layer.
      const layers = Array.from(rowLayers.values());
      rowLayers.clear();
      for (const layer of layers) {
        yield* settleRows(layer);
      }
      const plans: Array<PlannedSignalPatchFinish<any>> = [];
      for (const signal of touched) {
        const plan = yield* planSignalPatches(actionName, signal, transaction, onPatch);
        if (plan) {
          plans.push(plan);
        }
      }
      const targets = Array.from(resources.values());
      resources.clear();
      const resourcePlans = yield* Effect.try({
        try: () =>
          targets.flatMap((target) => {
            const plan = planResourceOptimisticSettle(target, transaction, event === "success");
            return plan === undefined ? [] : [plan];
          }),
        catch: (cause) => optimisticPatchError(actionName, cause),
      });
      // Signal and Resource patches settle in one commit named by the Action.
      batchSignalWrites(
        () => {
          for (const plan of plans) {
            applySignalPatchPlan(plan);
          }
          for (const plan of resourcePlans) {
            applyResourceOptimisticSettle(plan);
          }
        },
        { _tag: "Action", action: actionName, event },
      );
      touched.clear();
      yield* Effect.forEach(resourcePlans, cacheResourceOptimisticCommitEffect, { discard: true });
    }).pipe(Effect.orDie);

  return {
    api,
    commit: finish(
      (base, patch) =>
        Effect.map(applySignalPatchEffect(actionName, patch, base), (nextBase) => ({
          _tag: "Commit",
          base: nextBase,
        })),
      (layer) => layer.commit,
      "success",
    ),
    rollback: finish(
      () => Effect.succeed({ _tag: "Rollback" }),
      (layer) => layer.rollback,
      "failure",
    ),
  };
};

/**
 * One change an Action's `optimistic` patch makes, as `Action.planOptimistic`
 * reports it: the value a Signal or Resource entry would read, or a row change
 * for a row store.
 */
export type ActionOptimisticChange =
  | {
      readonly _tag: "Set";
      /** The patched Signal, or the Resource ref naming the patched entry. */
      readonly target: WritableSignal<any> | AnyResourceRef;
      /** The value the target would read with this patch applied. */
      readonly value: unknown;
    }
  | {
      readonly _tag: "Insert";
      readonly rows: ActionOptimisticRows<any, any>;
      readonly values: ReadonlyArray<object>;
    }
  | {
      readonly _tag: "Update";
      readonly rows: ActionOptimisticRows<any, any>;
      readonly key: unknown;
      readonly update: ActionOptimisticRowUpdate<any>;
    }
  | {
      readonly _tag: "Delete";
      readonly rows: ActionOptimisticRows<any, any>;
      readonly key: unknown;
    };

/** A transaction that records changes instead of applying them. */
export interface ActionOptimisticPlanRuntime {
  readonly api: ActionOptimisticTransaction;
  readonly changes: () => ReadonlyArray<ActionOptimisticChange>;
}

/**
 * Creates a transaction that records every patch as an `ActionOptimisticChange`
 * and writes nothing. A `set` is computed from the target's current value (and
 * the plan's earlier patches to it); a Resource entry that has not loaded is
 * left alone, so it plans no change. Row changes are recorded as given,
 * without touching the row store.
 */
export const makeActionOptimisticPlanRuntime = (
  actionName: string,
): ActionOptimisticPlanRuntime => {
  const changes: Array<ActionOptimisticChange> = [];
  const planned = new Map<unknown, unknown>();

  const current = (
    target: ActionOptimisticSetTarget<unknown>,
  ): Effect.Effect<Option.Option<unknown>> => {
    const key = isResourceRef(target) ? resourceRefStoreKey(target) : target;
    return planned.has(key)
      ? Effect.succeed(Option.some(planned.get(key)))
      : isResourceRef(target)
        ? peekResourceValueEffect(target)
        : Effect.sync(() => Option.some(Signal.peek(target)));
  };

  const api: ActionOptimisticTransaction = {
    set: (target, update) =>
      Effect.gen(function* () {
        const value = yield* current(target as ActionOptimisticSetTarget<unknown>);
        if (Option.isNone(value)) {
          return;
        }
        const apply = optimisticUpdater(actionName, update as ActionOptimisticSetUpdate<unknown>);
        const next = yield* Effect.try({
          try: () => apply(value.value),
          catch: (cause) => optimisticPatchError(actionName, cause),
        });
        planned.set(isResourceRef(target) ? resourceRefStoreKey(target) : target, next);
        changes.push({ _tag: "Set", target, value: next });
      }).pipe(Effect.orDie),
    insert: (rows, values) =>
      Effect.sync(() => {
        changes.push({
          _tag: "Insert",
          rows,
          values: Array.isArray(values) ? values : [values as never],
        });
      }),
    update: (rows, key, update) =>
      Effect.sync(() => {
        changes.push({ _tag: "Update", rows, key, update });
      }),
    delete: (rows, key) =>
      Effect.sync(() => {
        changes.push({ _tag: "Delete", rows, key });
      }),
  };

  return { api, changes: () => changes };
};
