import type {
  ActionInstance,
  ActionState,
  ResourceInvalidationPlan,
  ResourceStoreEvent,
  Route
} from "@effect-ui/core";
import { Effect } from "effect";
import type {
  DevtoolsCausalGraph,
  DevtoolsCollectionStoreEvent,
  DevtoolsInvalidationPlan,
  DevtoolsPanels,
  DevtoolsRecordActionStateOptions,
  DevtoolsRequestTrace,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSnapshot,
  DevtoolsStartActionInstance,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStoreOptions,
  DevtoolsSummary
} from "./index.js";

export interface DevtoolsStoreRuntime {
  readonly describeInvalidationPlan: (plan: ResourceInvalidationPlan) => DevtoolsInvalidationPlan;
  readonly copyInvalidationPlan: (plan: DevtoolsInvalidationPlan) => DevtoolsInvalidationPlan;
  readonly copyRequestTrace: (trace: DevtoolsRequestTrace) => DevtoolsRequestTrace;
  readonly describeRoutePlan: (plan: Route.NavigationPlan) => DevtoolsRoutePlan;
  readonly throwActionInvalidationPlanConflict: (guidance: string) => never;
  readonly describeSummary: (input: { readonly snapshot: DevtoolsSnapshot }) => DevtoolsSummary;
  readonly describePanels: (input: { readonly snapshot: DevtoolsSnapshot }) => DevtoolsPanels;
  readonly describeCausalGraph: (input: { readonly snapshot: DevtoolsSnapshot }) => DevtoolsCausalGraph;
}

const actionStateTag = <I, A, E>(state: ActionState<I, A, E>): string =>
  state._tag;

const actionStateInput = <I, A, E>(state: ActionState<I, A, E>): I | undefined =>
  "input" in state ? state.input : undefined;

export const makeDevtoolsStoreWithRuntime = (
  options: DevtoolsStoreOptions = {},
  runtime: DevtoolsStoreRuntime
) => {
  const invalidationLimit = options.invalidationLimit ?? 50;
  const routePlanLimit = options.routePlanLimit ?? 50;
  const requestTraceLimit = options.requestTraceLimit ?? 50;
  const eventLimit = options.eventLimit ?? 500;
  let nextEventSequence = 0;
  let snapshot: DevtoolsSnapshot = {
    resources: [],
    actions: [],
    invalidations: [],
    routePlans: []
  };

  const boundedEvents = (
    events: ReadonlyArray<DevtoolsRuntimeEvent>
  ): ReadonlyArray<DevtoolsRuntimeEvent> =>
    events.slice(-eventLimit);

  const withSequence = (event: DevtoolsRuntimeEvent): DevtoolsRuntimeEvent => {
    if (event.sequence !== undefined) {
      nextEventSequence = Math.max(nextEventSequence, event.sequence + 1);
      return event;
    }

    const sequence = nextEventSequence;
    nextEventSequence += 1;
    return {
      ...event,
      sequence
    };
  };

  const recordRuntimeEvent = (event: DevtoolsRuntimeEvent): void => {
    snapshot = {
      ...snapshot,
      events: boundedEvents([
        ...(snapshot.events ?? []),
        withSequence(event)
      ])
    };
  };

  const recordInvalidationPlan = (plan: ResourceInvalidationPlan): number =>
    recordSerializedInvalidationPlan(runtime.describeInvalidationPlan(plan));

  const recordSerializedInvalidationPlan = (plan: DevtoolsInvalidationPlan): number => {
    const invalidations = [
      ...snapshot.invalidations,
      runtime.copyInvalidationPlan(plan)
    ].slice(-invalidationLimit);
    snapshot = {
      ...snapshot,
      invalidations
    };
    return invalidations.length - 1;
  };

  const recordActionInvalidations = (
    actionOptions: DevtoolsRecordActionStateOptions
  ): ReadonlyArray<number> | undefined => {
    if (
      actionOptions.invalidationPlan !== undefined &&
      actionOptions.serializedInvalidationPlan !== undefined
    ) {
      runtime.throwActionInvalidationPlanConflict(
        "Pass invalidationPlan for local refs or serializedInvalidationPlan for transport-provided snapshots."
      );
    }

    if (actionOptions.invalidationPlan !== undefined) {
      return [recordInvalidationPlan(actionOptions.invalidationPlan)];
    }

    if (actionOptions.serializedInvalidationPlan !== undefined) {
      return [recordSerializedInvalidationPlan(actionOptions.serializedInvalidationPlan)];
    }

    return undefined;
  };

  const recordRequestTrace = (trace: DevtoolsRequestTrace): void => {
    snapshot = {
      ...snapshot,
      requestTraces: [
        ...(snapshot.requestTraces ?? []),
        runtime.copyRequestTrace(trace)
      ].slice(-requestTraceLimit)
    };
    recordRuntimeEvent({
      _tag: "RequestTrace",
      trace: runtime.copyRequestTrace(trace)
    });
  };

  const recordActionState = (
    action: string,
    state: string,
    actionOptions: DevtoolsRecordActionStateOptions = {}
  ): void => {
    const invalidationIndexes = recordActionInvalidations(actionOptions);
    snapshot = {
      ...snapshot,
      actions: [
        ...snapshot.actions.filter((entry) => entry.name !== action),
        {
          name: action,
          state,
          ...(invalidationIndexes === undefined ? {} : { invalidationIndexes })
        }
      ]
    };
    recordRuntimeEvent({
      _tag: "ActionState",
      action,
      state,
      ...(actionOptions.input === undefined ? {} : { input: actionOptions.input }),
      ...(invalidationIndexes === undefined ? {} : { invalidationIndexes })
    });
  };

  const recordAction = (
    action: ActionInstance<unknown, unknown, unknown, unknown>
  ): void => {
    const state = action.state.get();
    const input = actionStateInput(state);
    const invalidationPlan = action.invalidationPlan.get();
    recordActionState(
      action.definition.name,
      actionStateTag(state),
      {
        ...(input === undefined ? {} : { input }),
        ...(invalidationPlan === undefined ? {} : { invalidationPlan })
      }
    );
  };

  const recordStartAction = (
    action: DevtoolsStartActionInstance
  ): void => {
    const state = action.state.get();
    const input = actionStateInput(state);
    const serializedInvalidationPlan = action.invalidation.get();
    recordActionState(
      action.definition.name,
      actionStateTag(state),
      {
        ...(input === undefined ? {} : { input }),
        ...(serializedInvalidationPlan === undefined ? {} : { serializedInvalidationPlan })
      }
    );
  };

  const getSnapshotEffect = () => Effect.sync(() => snapshot);
  const setSnapshotEffect = (next: DevtoolsSnapshot) =>
    Effect.sync(() => {
      snapshot = next;
    });
  const setAppGraphDiagnosticsEffect = (appGraph: DevtoolsStartAppGraphDiagnostics) =>
    Effect.sync(() => {
      snapshot = {
        ...snapshot,
        appGraph
      };
    });
  const clearAppGraphDiagnosticsEffect = () =>
    Effect.sync(() => {
      const { appGraph: _appGraph, ...next } = snapshot;
      snapshot = next;
    });
  const recordInvalidationEffect = (plan: ResourceInvalidationPlan) =>
    Effect.sync(() => {
      recordInvalidationPlan(plan);
    });
  const recordSerializedInvalidationEffect = (plan: DevtoolsInvalidationPlan) =>
    Effect.sync(() => {
      recordSerializedInvalidationPlan(plan);
    });
  const recordActionStateEffect = (
    action: string,
    state: string,
    actionOptions: DevtoolsRecordActionStateOptions = {}
  ) =>
    Effect.sync(() => {
      recordActionState(action, state, actionOptions);
    });
  const recordActionEffect = (action: ActionInstance<unknown, unknown, unknown, unknown>) =>
    Effect.sync(() => {
      recordAction(action);
    });
  const trackActionEffect = (action: ActionInstance<unknown, unknown, unknown, unknown>) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        recordAction(action);
        return action.state.subscribe(() => recordAction(action));
      }),
      (unsubscribe) => Effect.sync(unsubscribe)
    ).pipe(Effect.asVoid);
  const recordStartActionEffect = (action: DevtoolsStartActionInstance) =>
    Effect.sync(() => {
      recordStartAction(action);
    });
  const trackStartActionEffect = (action: DevtoolsStartActionInstance) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        recordStartAction(action);
        return action.state.subscribe(() => recordStartAction(action));
      }),
      (unsubscribe) => Effect.sync(unsubscribe)
    ).pipe(Effect.asVoid);
  const recordRoutePlanEffect = (plan: Route.NavigationPlan) =>
    Effect.sync(() => {
      snapshot = {
        ...snapshot,
        routePlans: [
          ...snapshot.routePlans,
          runtime.describeRoutePlan(plan)
        ].slice(-routePlanLimit)
      };
    });
  const recordResourceEventEffect = (event: ResourceStoreEvent) =>
    Effect.sync(() => {
      recordRuntimeEvent({
        _tag: "ResourceStoreEvent",
        event
      });
    });
  const recordCollectionEventEffect = (event: DevtoolsCollectionStoreEvent) =>
    Effect.sync(() => {
      recordRuntimeEvent({
        _tag: "CollectionStoreEvent",
        event
      });
    });
  const recordRuntimeEventEffect = (event: DevtoolsRuntimeEvent) =>
    Effect.sync(() => {
      recordRuntimeEvent(event);
    });
  const recordRequestTraceEffect = (trace: DevtoolsRequestTrace) =>
    Effect.sync(() => {
      recordRequestTrace(trace);
    });
  const getSummaryEffect = () => Effect.sync(() => runtime.describeSummary({ snapshot }));
  const getPanelsEffect = () => Effect.sync(() => runtime.describePanels({ snapshot }));
  const getCausalGraphEffect = () => Effect.sync(() => runtime.describeCausalGraph({ snapshot }));

  return {
    getSnapshot: () => Effect.runSync(getSnapshotEffect()),
    getSnapshotEffect,
    setSnapshot: (next: DevtoolsSnapshot) => {
      Effect.runSync(setSnapshotEffect(next));
    },
    setSnapshotEffect,
    setAppGraphDiagnostics: (appGraph: DevtoolsStartAppGraphDiagnostics) => {
      Effect.runSync(setAppGraphDiagnosticsEffect(appGraph));
    },
    setAppGraphDiagnosticsEffect,
    clearAppGraphDiagnostics: () => {
      Effect.runSync(clearAppGraphDiagnosticsEffect());
    },
    clearAppGraphDiagnosticsEffect,
    recordInvalidation: (plan: ResourceInvalidationPlan) => {
      Effect.runSync(recordInvalidationEffect(plan));
    },
    recordInvalidationEffect,
    recordSerializedInvalidation: (plan: DevtoolsInvalidationPlan) => {
      Effect.runSync(recordSerializedInvalidationEffect(plan));
    },
    recordSerializedInvalidationEffect,
    recordActionState: (
      action: string,
      state: string,
      actionOptions: DevtoolsRecordActionStateOptions = {}
    ) => {
      Effect.runSync(recordActionStateEffect(action, state, actionOptions));
    },
    recordActionStateEffect,
    recordAction: (action: ActionInstance<unknown, unknown, unknown, unknown>) => {
      Effect.runSync(recordActionEffect(action));
    },
    recordActionEffect,
    trackActionEffect,
    recordStartAction: (action: DevtoolsStartActionInstance) => {
      Effect.runSync(recordStartActionEffect(action));
    },
    recordStartActionEffect,
    trackStartActionEffect,
    recordRoutePlan: (plan: Route.NavigationPlan) => {
      Effect.runSync(recordRoutePlanEffect(plan));
    },
    recordRoutePlanEffect,
    recordResourceEvent: (event: ResourceStoreEvent) => {
      Effect.runSync(recordResourceEventEffect(event));
    },
    recordResourceEventEffect,
    recordCollectionEvent: (event: DevtoolsCollectionStoreEvent) => {
      Effect.runSync(recordCollectionEventEffect(event));
    },
    recordCollectionEventEffect,
    recordRuntimeEvent: (event: DevtoolsRuntimeEvent) => {
      Effect.runSync(recordRuntimeEventEffect(event));
    },
    recordRuntimeEventEffect,
    recordRequestTrace: (trace: DevtoolsRequestTrace) => {
      Effect.runSync(recordRequestTraceEffect(trace));
    },
    recordRequestTraceEffect,
    getSummary: () => Effect.runSync(getSummaryEffect()),
    getSummaryEffect,
    getPanels: () => Effect.runSync(getPanelsEffect()),
    getPanelsEffect,
    getCausalGraph: () => Effect.runSync(getCausalGraphEffect()),
    getCausalGraphEffect
  };
};
