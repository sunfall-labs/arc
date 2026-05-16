import type {
  ActionInstance,
  ProgramEvent,
  ProgramInstance,
  ResourceInvalidationPlan,
  ResourceStoreEvent,
  Route
} from "@effect-ui/core";
import { Effect } from "effect";
import { DevtoolsActionInvalidationPlanConflict } from "./devtools-contract.js";
import type {
  DevtoolsCollectionStoreEvent,
  DevtoolsInvalidationPlan,
  DevtoolsRecordActionStateOptions,
  DevtoolsRequestTrace,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSerializationPolicy,
  DevtoolsSnapshot,
  DevtoolsStartActionInstance,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStore,
  DevtoolsStoreOptions
} from "./devtools-contract.js";
import {
  ensureRequestTraceId,
  findMatchingDevtoolsFactIndex,
  normalizeRequestTraceFacts,
  rebaseRequestTraceInvalidations,
  rebaseRuntimeEventInvalidations,
  rebaseRuntimeEventRoutePlans,
  rebaseSnapshotActionInvalidations,
  requestTraceSequence
} from "./fact-identity.js";
import {
  copyAppGraphDiagnostics,
  copyDevtoolsRoutePlan,
  copyDevtoolsRuntimeEvent,
  copyDevtoolsSnapshot,
  copyInvalidationPlan,
  copyRequestTrace,
  describeInvalidationPlan,
  describeRoutePlan
} from "./serialization.js";
import { describeDevtoolsPanels } from "./panels.js";
import {
  describeDevtoolsCausalGraph,
  describeDevtoolsSummary
} from "./summary.js";

const actionStateTag = (state: { readonly _tag: string }): string =>
  state._tag;

const actionStateInput = <I>(state: { readonly _tag: string }): I | undefined =>
  "input" in state ? (state as { readonly input: I }).input : undefined;

type AnyActionInstance = ActionInstance<any, any, any, any>;
type AnyStartActionInstance = DevtoolsStartActionInstance<any, any, any, any>;

const normalizeHistoryLimit = (
  value: number | undefined,
  fallback: number
): number =>
  value === undefined || !Number.isFinite(value) || value <= 0
    ? fallback
    : Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);

const boundedHistory = <A>(
  entries: ReadonlyArray<A>,
  limit: number
): ReadonlyArray<A> =>
  entries.length <= limit ? entries : entries.slice(entries.length - limit);

export const makeDevtoolsStore = (
  options: DevtoolsStoreOptions = {}
): DevtoolsStore => {
  const invalidationLimit = normalizeHistoryLimit(options.invalidationLimit, 50);
  const routePlanLimit = normalizeHistoryLimit(options.routePlanLimit, 50);
  const requestTraceLimit = normalizeHistoryLimit(options.requestTraceLimit, 50);
  const eventLimit = normalizeHistoryLimit(options.eventLimit, 500);
  const serializationPolicy = options.serializationPolicy;
  let nextEventSequence = 0;
  let nextRequestTraceSequence = 0;
  let nextProgramIdentity = 0;
  const programIdentities = new WeakMap<object, string>();
  let snapshot: DevtoolsSnapshot = {
    resources: [],
    actions: [],
    invalidations: [],
    routePlans: []
  };

  const boundedEvents = (
    events: ReadonlyArray<DevtoolsRuntimeEvent>
  ): ReadonlyArray<DevtoolsRuntimeEvent> =>
    boundedHistory(events, eventLimit);

  const normalizeImportedSnapshot = (
    next: DevtoolsSnapshot
  ): {
    readonly snapshot: DevtoolsSnapshot;
    readonly nextRequestTraceSequence: number;
  } => {
    const invalidationDropped = Math.max(0, next.invalidations.length - invalidationLimit);
    const routePlanDropped = Math.max(0, next.routePlans.length - routePlanLimit);
    const normalizedRequestFacts = normalizeRequestTraceFacts(next.requestTraces ?? [], next.events ?? []);
    const normalizedInput: DevtoolsSnapshot = {
      ...next,
      ...(next.requestTraces === undefined ? {} : { requestTraces: normalizedRequestFacts.requestTraces }),
      ...(next.events === undefined ? {} : { events: normalizedRequestFacts.events })
    };
    const boundedInput: DevtoolsSnapshot = {
      ...normalizedInput,
      invalidations: boundedHistory(normalizedInput.invalidations, invalidationLimit),
      routePlans: boundedHistory(normalizedInput.routePlans, routePlanLimit),
      ...(normalizedInput.requestTraces === undefined
        ? {}
        : { requestTraces: boundedHistory(normalizedInput.requestTraces, requestTraceLimit) }),
      ...(normalizedInput.events === undefined ? {} : { events: boundedEvents(normalizedInput.events) })
    };
    const importedSnapshot = copyDevtoolsSnapshot(boundedInput, serializationPolicy);
    const boundedRequestTraces = importedSnapshot.requestTraces;
    const actions = invalidationDropped === 0
      ? importedSnapshot.actions
      : rebaseSnapshotActionInvalidations(importedSnapshot.actions, invalidationDropped);
    const requestTracesAfterInvalidation = invalidationDropped === 0
      ? boundedRequestTraces
      : rebaseRequestTraceInvalidations(boundedRequestTraces, invalidationDropped);
    const eventsAfterInvalidation = invalidationDropped === 0
      ? importedSnapshot.events
      : rebaseRuntimeEventInvalidations(importedSnapshot.events, invalidationDropped);

    const eventsAfterRoutePlans = routePlanDropped === 0
      ? eventsAfterInvalidation
      : rebaseRuntimeEventRoutePlans(eventsAfterInvalidation, routePlanDropped);
    const normalizedEvents = normalizeRuntimeEventSequences(eventsAfterRoutePlans);
    const events = normalizedEvents === undefined
      ? undefined
      : boundedEvents(normalizedEvents);

    return {
      snapshot: {
        ...(importedSnapshot.appGraph === undefined ? {} : { appGraph: importedSnapshot.appGraph }),
        resources: importedSnapshot.resources,
        actions,
        invalidations: importedSnapshot.invalidations,
        routePlans: importedSnapshot.routePlans,
        ...(requestTracesAfterInvalidation === undefined ? {} : { requestTraces: requestTracesAfterInvalidation }),
        ...(events === undefined ? {} : { events })
      },
      nextRequestTraceSequence: normalizedRequestFacts.nextRequestTraceSequence
    };
  };

  const nextRuntimeEventSequence = (
    events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined
  ): number =>
    events?.reduce(
      (next, event, index) => Math.max(next, (event.sequence ?? index) + 1),
      0
    ) ?? 0;

  const normalizeRuntimeEventSequences = (
    events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined
  ): ReadonlyArray<DevtoolsRuntimeEvent> | undefined => {
    if (events === undefined) {
      return undefined;
    }

    const seen = new Set<string>();
    let nextSequence = 0;
    return events.map((event, index) => {
      let sequence = event.sequence ?? index;
      const key = (candidate: number) => `${event._tag}\u0000${candidate}`;
      if (seen.has(key(sequence))) {
        while (seen.has(key(nextSequence))) {
          nextSequence++;
        }
        sequence = nextSequence;
      }
      seen.add(key(sequence));
      nextSequence = Math.max(nextSequence, sequence + 1);
      return event.sequence === sequence ? event : { ...event, sequence };
    });
  };

  const withSequence = (event: DevtoolsRuntimeEvent): DevtoolsRuntimeEvent => {
    const existing = snapshot.events ?? [];
    const requested = event.sequence;
    if (
      requested !== undefined &&
      !existing.some((candidate, index) =>
        candidate._tag === event._tag &&
        (candidate.sequence ?? index) === requested
      )
    ) {
      nextEventSequence = Math.max(nextEventSequence, requested + 1);
      return event;
    }

    const sequence = nextEventSequence;
    nextEventSequence += 1;
    return {
      ...event,
      sequence
    };
  };

  const withFactIndexes = (event: DevtoolsRuntimeEvent): DevtoolsRuntimeEvent => {
    switch (event._tag) {
      case "Invalidation": {
        if (event.invalidationIndex !== undefined) {
          return event;
        }

        const invalidationIndex = findMatchingDevtoolsFactIndex(snapshot.invalidations, event.plan);
        return invalidationIndex === undefined
          ? event
          : {
              ...event,
              invalidationIndex
            };
      }
      case "RoutePlan": {
        if (event.routePlanIndex !== undefined) {
          return event;
        }

        const routePlanIndex = findMatchingDevtoolsFactIndex(snapshot.routePlans, event.plan);
        return routePlanIndex === undefined
          ? event
          : {
              ...event,
              routePlanIndex
            };
      }
      default:
        return event;
    }
  };

  const recordRuntimeEvent = (event: DevtoolsRuntimeEvent): void => {
    snapshot = {
      ...snapshot,
      events: boundedEvents([
        ...(snapshot.events ?? []),
        copyDevtoolsRuntimeEvent(withSequence(withFactIndexes(event)), serializationPolicy)
      ])
    };
  };

  const recordInvalidationPlan = (plan: ResourceInvalidationPlan<any>): number =>
    recordSerializedInvalidationPlan(describeInvalidationPlan(plan));

  const recordSerializedInvalidationPlan = (plan: DevtoolsInvalidationPlan): number => {
    const existing = findMatchingDevtoolsFactIndex(snapshot.invalidations, plan);
    if (existing !== undefined) {
      return existing;
    }

    const nextInvalidations = [
      ...snapshot.invalidations,
      copyInvalidationPlan(plan, serializationPolicy)
    ];
    const dropped = Math.max(0, nextInvalidations.length - invalidationLimit);
    const invalidations = boundedHistory(nextInvalidations, invalidationLimit);
    if (dropped === 0) {
      snapshot = {
        ...snapshot,
        invalidations
      };
      return invalidations.length - 1;
    }

    const rebasedEvents = rebaseRuntimeEventInvalidations(snapshot.events, dropped);
    const rebasedRequestTraces = rebaseRequestTraceInvalidations(snapshot.requestTraces, dropped);
    snapshot = {
      ...snapshot,
      invalidations,
      actions: rebaseSnapshotActionInvalidations(snapshot.actions, dropped),
      ...(rebasedRequestTraces === undefined ? {} : { requestTraces: rebasedRequestTraces }),
      ...(rebasedEvents === undefined ? {} : { events: rebasedEvents })
    };
    return invalidations.length - 1;
  };

  const recordSerializedRoutePlan = (plan: DevtoolsRoutePlan): number => {
    const nextRoutePlans = [
      ...snapshot.routePlans,
      copyDevtoolsRoutePlan(plan, serializationPolicy)
    ];
    const dropped = Math.max(0, nextRoutePlans.length - routePlanLimit);
    const routePlans = boundedHistory(nextRoutePlans, routePlanLimit);
    const rebasedEvents = dropped === 0
      ? snapshot.events
      : rebaseRuntimeEventRoutePlans(snapshot.events, dropped);
    snapshot = {
      ...snapshot,
      routePlans,
      ...(rebasedEvents === undefined ? {} : { events: rebasedEvents })
    };
    return routePlans.length - 1;
  };

  const recordActionInvalidations = (
    actionOptions: DevtoolsRecordActionStateOptions
  ): ReadonlyArray<number> | undefined => {
    if (
      actionOptions.invalidationPlan !== undefined &&
      actionOptions.serializedInvalidationPlan !== undefined
    ) {
      throw new DevtoolsActionInvalidationPlanConflict({
        guidance: "Pass invalidationPlan for local refs or serializedInvalidationPlan for transport-provided snapshots."
      });
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
    const copiedInput = copyRequestTrace(trace, serializationPolicy);
    const existingSequence = requestTraceSequence(copiedInput.request.id);
    if (existingSequence !== undefined) {
      nextRequestTraceSequence = Math.max(nextRequestTraceSequence, existingSequence + 1);
    }

    const fallbackId = `trace:${nextRequestTraceSequence}`;
    const copied = ensureRequestTraceId(copiedInput, fallbackId);
    if (copiedInput.request.id === undefined) {
      nextRequestTraceSequence += 1;
    }

    snapshot = {
      ...snapshot,
      requestTraces: boundedHistory([
        ...(snapshot.requestTraces ?? []),
        copied
      ], requestTraceLimit)
    };
    recordRuntimeEvent({
      _tag: "RequestTrace",
      trace: copied
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

  const recordAction = <I, A, E, R>(
    action: ActionInstance<I, A, E, R>
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

  const recordStartAction = <I, A, E, P>(
    action: DevtoolsStartActionInstance<I, A, E, P>
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

  const recordProgramEvent = <Model, Message, E>(
    event: ProgramEvent<Model, Message, E>
  ): void => {
    recordRuntimeEvent({
      _tag: "ProgramEvent",
      event
    });
  };
  const trackedProgramName = (program: ProgramInstance<any, any, any>): string => {
    const existing = programIdentities.get(program as object);
    if (existing !== undefined) {
      return existing;
    }

    const name = `Program#${++nextProgramIdentity}`;
    programIdentities.set(program as object, name);
    return name;
  };
  const withTrackedProgramName = <Model, Message, E>(
    event: ProgramEvent<Model, Message, E>,
    name: string
  ): ProgramEvent<Model, Message, E> =>
    event.program === undefined ? { ...event, program: name } : event;

  const getSnapshotEffect = () => Effect.sync(() => copyDevtoolsSnapshot(snapshot, serializationPolicy));
  const setSnapshotEffect = (next: DevtoolsSnapshot) =>
    Effect.sync(() => {
      const imported = normalizeImportedSnapshot(next);
      snapshot = imported.snapshot;
      nextRequestTraceSequence = imported.nextRequestTraceSequence;
      nextEventSequence = nextRuntimeEventSequence(snapshot.events);
    });
  const setAppGraphDiagnosticsEffect = (appGraph: DevtoolsStartAppGraphDiagnostics) =>
    Effect.sync(() => {
      snapshot = {
        ...snapshot,
        appGraph: copyAppGraphDiagnostics(appGraph)
      };
    });
  const clearAppGraphDiagnosticsEffect = () =>
    Effect.sync(() => {
      const { appGraph: _appGraph, ...next } = snapshot;
      snapshot = next;
    });
  const recordInvalidationEffect = (plan: ResourceInvalidationPlan) =>
    Effect.sync(() => recordInvalidationPlan(plan));
  const recordSerializedInvalidationEffect = (plan: DevtoolsInvalidationPlan) =>
    Effect.sync(() => recordSerializedInvalidationPlan(plan));
  const recordActionStateEffect = (
    action: string,
    state: string,
    actionOptions: DevtoolsRecordActionStateOptions = {}
  ) =>
    Effect.sync(() => {
      recordActionState(action, state, actionOptions);
    });
  const recordActionEffect = <I, A, E, R>(action: ActionInstance<I, A, E, R>) =>
    Effect.sync(() => {
      recordAction(action);
    });
  const trackActionEffect = <I, A, E, R>(action: ActionInstance<I, A, E, R>) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        recordAction(action);
        return action.state.subscribe(() => recordAction(action));
      }),
      (unsubscribe) => Effect.sync(unsubscribe)
    ).pipe(Effect.asVoid);
  const recordStartActionEffect = <I, A, E, P>(action: DevtoolsStartActionInstance<I, A, E, P>) =>
    Effect.sync(() => {
      recordStartAction(action);
    });
	  const trackStartActionEffect = <I, A, E, P>(action: DevtoolsStartActionInstance<I, A, E, P>) =>
	    Effect.acquireRelease(
	      Effect.sync(() => {
	        recordStartAction(action);
	        const unsubscribeState = action.state.subscribe(() => recordStartAction(action));
	        const unsubscribeInvalidation = action.invalidation.subscribe(() => recordStartAction(action));
	        return () => {
	          unsubscribeState();
	          unsubscribeInvalidation();
	        };
	      }),
	      (unsubscribe) => Effect.sync(unsubscribe)
	    ).pipe(Effect.asVoid);
  const recordRoutePlanEffect = (plan: Route.NavigationPlan) =>
    Effect.sync(() => recordSerializedRoutePlan(describeRoutePlan(plan)));
  const recordSerializedRoutePlanEffect = (plan: DevtoolsRoutePlan) =>
    Effect.sync(() => recordSerializedRoutePlan(plan));
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
  const recordProgramEventEffect = <Model, Message, E>(
    event: ProgramEvent<Model, Message, E>
  ) =>
    Effect.sync(() => {
      recordProgramEvent(event);
    });
  const trackProgramEffect = <Model, Message, E>(
    program: ProgramInstance<Model, Message, E>
  ) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const name = trackedProgramName(program);
        let observedSequence = 0;
        const recordNewEvents = () => {
          for (const event of program.timeline.get()) {
            if (event.sequence > observedSequence) {
              observedSequence = event.sequence;
              recordProgramEvent(withTrackedProgramName(event, name));
            }
          }
        };
        recordNewEvents();
        return program.timeline.subscribe(recordNewEvents);
      }),
      (unsubscribe) => Effect.sync(unsubscribe)
    ).pipe(Effect.asVoid);
  const recordRuntimeEventEffect = (event: DevtoolsRuntimeEvent) =>
    Effect.sync(() => {
      recordRuntimeEvent(event);
    });
  const recordRequestTraceEffect = (trace: DevtoolsRequestTrace) =>
    Effect.sync(() => {
      recordRequestTrace(trace);
    });
  const summaryInput = (): { readonly snapshot: DevtoolsSnapshot } => ({
    snapshot: copyDevtoolsSnapshot(snapshot, serializationPolicy)
  });
  const getSummaryEffect = () => Effect.sync(() => describeDevtoolsSummary(summaryInput()));
  const getPanelsEffect = () => Effect.sync(() => describeDevtoolsPanels(summaryInput()));
  const getCausalGraphEffect = () => Effect.sync(() => describeDevtoolsCausalGraph(summaryInput()));

  const store = {
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
      return Effect.runSync(recordInvalidationEffect(plan));
    },
    recordInvalidationEffect,
    recordSerializedInvalidation: (plan: DevtoolsInvalidationPlan) => {
      return Effect.runSync(recordSerializedInvalidationEffect(plan));
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
    recordAction: (action: AnyActionInstance) => {
      Effect.runSync(recordActionEffect(action));
    },
    recordActionEffect,
    trackActionEffect,
    recordStartAction: (action: AnyStartActionInstance) => {
      Effect.runSync(recordStartActionEffect(action));
    },
    recordStartActionEffect,
    trackStartActionEffect,
    recordRoutePlan: (plan: Route.NavigationPlan) => {
      return Effect.runSync(recordRoutePlanEffect(plan));
    },
    recordRoutePlanEffect,
    recordSerializedRoutePlan: (plan: DevtoolsRoutePlan) => {
      return Effect.runSync(recordSerializedRoutePlanEffect(plan));
    },
    recordSerializedRoutePlanEffect,
    recordResourceEvent: (event: ResourceStoreEvent) => {
      Effect.runSync(recordResourceEventEffect(event));
    },
    recordResourceEventEffect,
    recordCollectionEvent: (event: DevtoolsCollectionStoreEvent) => {
      Effect.runSync(recordCollectionEventEffect(event));
    },
    recordCollectionEventEffect,
    recordProgramEvent: (event) => {
      Effect.runSync(recordProgramEventEffect(event));
    },
    recordProgramEventEffect,
    trackProgramEffect,
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
  } satisfies DevtoolsStore;

  return store;
};
