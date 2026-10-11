import { Signal, SignalTypeId, type ReadableSignal } from "@sunfall/arc-core";
import { Cause, Effect, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { makeLiveQueryRuntime, type LiveQueryRuntime } from "./live-query-runtime.js";
import {
  currentCollectionStore,
  runWithCollectionStore,
  type RuntimeCollectionStore,
} from "./runtime-collection-store.js";
import type { AnyQueryBuilder, LiveQuery } from "./query-builder.js";
import {
  compileQueryStagePlan,
  toQueryEvaluationError,
  type QueryEvaluationError,
  type QueryStagePlan,
} from "./query-plan.js";
import { preloadQueryExecutionPlanEffect } from "./query-execution-plan.js";

type LiveQueryResult<T, E> = AsyncResult.AsyncResult<ReadonlyArray<T>, E | QueryEvaluationError>;

/**
 * Builds the signal-backed state handle returned by `Query.live(...)`.
 *
 * Query Builder owns immutable query descriptions. This Module owns the
 * reactive state Adapter around a Live Query Runtime: last-good data retention,
 * evaluation failures, source collection load-state folding, and source
 * preload/refetch effects.
 */
export const makeLiveQueryState = <T, E = never, R = never>(
  builder: AnyQueryBuilder<T, E, R>,
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
    latestEvaluation:
      | {
          readonly data: ReadonlyArray<T>;
          readonly error: QueryEvaluationError | undefined;
        }
      | undefined;
    signals:
      | {
          readonly evaluation: ReadableSignal<{
            readonly data: ReadonlyArray<T>;
            readonly error: QueryEvaluationError | undefined;
          }>;
          readonly data: ReadableSignal<ReadonlyArray<T>>;
          readonly state: ReadableSignal<LiveQueryResult<T, E>>;
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
      signals: undefined,
    };
    storeStates.set(store, state);
    return state;
  };

  const sourceVersions = (): ReadonlyArray<number> =>
    sourceAdapters.map((source) => source.version().get());
  const sameVersions = (left: ReadonlyArray<number>, right: ReadonlyArray<number>): boolean =>
    left.length === right.length &&
    left.every((version, index) => Object.is(version, right[index]));

  const withStore = <A>(store: RuntimeCollectionStore, evaluate: () => A): A =>
    runWithCollectionStore(store, evaluate);

  const storeSignals = (
    store: RuntimeCollectionStore,
  ): NonNullable<StoreEvaluationState["signals"]> => {
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
            error: toQueryEvaluationError("evaluate", cause),
          };
          return storeEvaluation.latestEvaluation;
        }
      }),
    );

    const data = Signal.derive(() => evaluation.get().data);
    const state = Signal.derive<LiveQueryResult<T, E>>(() =>
      withStore(store, () => {
        const current = evaluation.get();
        let waiting = false;
        let initial = false;
        let loaded = false;
        let timestamp = 0;
        let sourceFailure: Cause.Cause<E> | undefined;
        for (const source of sourceAdapters) {
          const sourceState = source.state().get();
          waiting ||= sourceState.waiting;
          const lastSuccess =
            sourceState._tag === "Success"
              ? Option.some(sourceState)
              : sourceState._tag === "Failure"
                ? sourceState.previousSuccess
                : Option.none();
          if (Option.isSome(lastSuccess)) {
            loaded = true;
            timestamp = Math.max(timestamp, lastSuccess.value.timestamp);
          }
          if (sourceState._tag === "Initial") {
            initial = true;
          } else if (sourceState._tag === "Failure") {
            sourceFailure ??= sourceState.cause as Cause.Cause<E>;
          }
        }

        const failureCause: Cause.Cause<E | QueryEvaluationError> | undefined =
          current.error === undefined ? sourceFailure : Cause.fail(current.error);
        if (failureCause !== undefined) {
          return AsyncResult.failure(failureCause, {
            previousSuccess: loaded
              ? Option.some(AsyncResult.success(current.data, { timestamp }))
              : Option.none(),
            waiting,
          });
        }
        return initial
          ? AsyncResult.initial(waiting)
          : AsyncResult.success(current.data, { timestamp, waiting });
      }),
    );

    storeEvaluation.signals = { evaluation, data, state };
    return storeEvaluation.signals;
  };

  const currentStoreSignal = <A>(
    select: (signals: NonNullable<StoreEvaluationState["signals"]>) => ReadableSignal<A>,
  ): ReadableSignal<A> => ({
    [SignalTypeId]: SignalTypeId,
    get: () => select(storeSignals(currentRuntimeCollectionStore())).get(),
    subscribe: (listener) =>
      select(storeSignals(currentRuntimeCollectionStore())).subscribe(listener),
  });

  const data = currentStoreSignal((signals) => signals.data);
  const state = currentStoreSignal((signals) => signals.state);

  return {
    data,
    state,
    sources,
    evaluate: () => data.get(),
    preloadEffect: (): Effect.Effect<void, E | QueryEvaluationError, R> =>
      preloadQueryExecutionPlanEffect(builder, false),
    refetchEffect: (): Effect.Effect<void, E | QueryEvaluationError, R> =>
      preloadQueryExecutionPlanEffect(builder, true),
  };
};
