import { Signal, SignalTypeId, type ReadableSignal } from "@effect-ui/core";
import { Effect } from "effect";
import {
  makeLiveQueryRuntime,
  type LiveQueryRuntime
} from "./live-query-runtime.js";
import {
  currentCollectionStore,
  runWithCollectionStore,
  type RuntimeCollectionStore
} from "./runtime-collection-store.js";
import type {
  AnyQueryBuilder,
  LiveQuery,
  LiveQueryState
} from "./query-builder.js";
import {
  compileQueryStagePlan,
  toQueryEvaluationError,
  type QueryEvaluationError,
  type QueryStagePlan
} from "./query-plan.js";
import {
  preloadQueryExecutionPlanEffect
} from "./query-execution-plan.js";

/**
 * Builds the signal-backed state handle returned by `Query.live(...)`.
 *
 * Query Builder owns immutable query descriptions. This Module owns the
 * reactive state Adapter around a Live Query Runtime: last-good data retention,
 * evaluation failures, source collection load-state folding, and source
 * preload/refetch effects.
 */
export const makeLiveQueryState = <T, E = never, R = never>(
  builder: AnyQueryBuilder<T, E, R>
): LiveQuery<T, E, R> => {
  const initialStagePlan = (() => {
    try {
      return { stagePlan: compileQueryStagePlan(builder) };
    } catch (cause) {
      return { error: toQueryEvaluationError("evaluate", cause) };
    }
  })();
  const stagePlan = initialStagePlan.stagePlan as QueryStagePlan<any> | undefined;
  const stagePlanError = initialStagePlan.error;
  const sourceAdapters = stagePlan?.sourceAdapters ?? [];
  const sources = sourceAdapters.map((source) => source.collection);
  interface StoreEvaluationState {
    engine: LiveQueryRuntime<T> | undefined;
    latestData: ReadonlyArray<T>;
    latestEvaluationVersion: ReadonlyArray<number> | undefined;
    latestEvaluation: {
      readonly data: ReadonlyArray<T>;
      readonly error: QueryEvaluationError | undefined;
    } | undefined;
    signals:
      | {
        readonly evaluation: ReadableSignal<{
          readonly data: ReadonlyArray<T>;
          readonly error: QueryEvaluationError | undefined;
        }>;
        readonly data: ReadableSignal<ReadonlyArray<T>>;
        readonly state: ReadableSignal<LiveQueryState<T, E | QueryEvaluationError>>;
      }
      | undefined;
  }
  const storeStates = new WeakMap<RuntimeCollectionStore, StoreEvaluationState>();
  const currentRuntimeCollectionStore = (): RuntimeCollectionStore =>
    currentCollectionStore() as RuntimeCollectionStore;
  const storeState = (store: RuntimeCollectionStore): StoreEvaluationState => {
    const existing = storeStates.get(store);
    if (existing) {
      return existing;
    }

    const state: StoreEvaluationState = {
      engine: undefined,
      latestData: [],
      latestEvaluationVersion: undefined,
      latestEvaluation: undefined,
      signals: undefined
    };
    storeStates.set(store, state);
    return state;
  };

  const sourceVersions = (): ReadonlyArray<number> =>
    sourceAdapters.map((source) => source.version().get());
  const sameVersions = (
    left: ReadonlyArray<number>,
    right: ReadonlyArray<number>
  ): boolean =>
    left.length === right.length && left.every((version, index) => Object.is(version, right[index]));

  const withStore = <A>(store: RuntimeCollectionStore, evaluate: () => A): A =>
    runWithCollectionStore(store, evaluate);

  const storeSignals = (store: RuntimeCollectionStore): NonNullable<StoreEvaluationState["signals"]> => {
    const storeEvaluation = storeState(store);
    if (storeEvaluation.signals) {
      return storeEvaluation.signals;
    }

    const evaluation = Signal.derive<{
      readonly data: ReadonlyArray<T>;
      readonly error: QueryEvaluationError | undefined;
    }>(() =>
      withStore(store, () => {
        const versions = sourceVersions();
        if (
          storeEvaluation.latestEvaluation !== undefined &&
          storeEvaluation.latestEvaluationVersion !== undefined &&
          sameVersions(storeEvaluation.latestEvaluationVersion, versions)
        ) {
          return storeEvaluation.latestEvaluation;
        }

        try {
          if (stagePlanError !== undefined) {
            throw stagePlanError;
          }
          storeEvaluation.engine ??= makeLiveQueryRuntime(builder, stagePlan);
          storeEvaluation.latestData = storeEvaluation.engine.evaluate();
          storeEvaluation.latestEvaluationVersion = versions;
          storeEvaluation.latestEvaluation = { data: storeEvaluation.latestData, error: undefined };
          return storeEvaluation.latestEvaluation;
        } catch (cause) {
          storeEvaluation.latestEvaluationVersion = versions;
          storeEvaluation.latestEvaluation = {
            data: storeEvaluation.latestData,
            error: toQueryEvaluationError("evaluate", cause)
          };
          return storeEvaluation.latestEvaluation;
        }
      })
    );

    const data = Signal.derive(() => evaluation.get().data);
    const state = Signal.derive<LiveQueryState<T, E | QueryEvaluationError>>(() =>
      withStore(store, () => {
        const current = evaluation.get();
        if (current.error) {
          return {
            _tag: "Failure",
            waiting: false,
            error: current.error,
            data: current.data
          };
        }

        const currentData = current.data;
        for (const source of sourceAdapters) {
          const sourceState = source.state().get();
          if (sourceState._tag === "Failure") {
            return {
              _tag: "Failure",
              waiting: false,
              error: sourceState.error as E,
              data: currentData
            };
          }
        }

        const waiting = sourceAdapters.some((source) => {
          const sourceState = source.state().get();
          return sourceState._tag === "Initial" || sourceState._tag === "Pending";
        });

        return waiting
          ? { _tag: "Pending", waiting: true, data: currentData }
          : { _tag: "Success", waiting: false, data: currentData };
      })
    );

    storeEvaluation.signals = { evaluation, data, state };
    return storeEvaluation.signals;
  };

  const currentStoreSignal = <A>(
    select: (signals: NonNullable<StoreEvaluationState["signals"]>) => ReadableSignal<A>
  ): ReadableSignal<A> => ({
    [SignalTypeId]: SignalTypeId,
    get: () => select(storeSignals(currentRuntimeCollectionStore())).get(),
    subscribe: (listener) =>
      select(storeSignals(currentRuntimeCollectionStore())).subscribe(listener)
  });

  const data = currentStoreSignal((signals) => signals.data);
  const state = currentStoreSignal((signals) => signals.state);

  return {
    data,
    state,
    sources,
    evaluate: () => data.get(),
    preloadEffect: (): Effect.Effect<void, E | QueryEvaluationError, R> => preloadQueryExecutionPlanEffect(builder, false),
    refetchEffect: (): Effect.Effect<void, E | QueryEvaluationError, R> => preloadQueryExecutionPlanEffect(builder, true)
  };
};
