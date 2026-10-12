import type { Route } from "@sunfall/arc-core";
import { Timeline, type Action, type Resource } from "@sunfall/arc-core";
import { Effect, Layer, Option, Tracer } from "effect";
import { DevtoolsActionInvalidationPlanConflict } from "./devtools-contract.js";
import type {
  DevtoolsInvalidationPlan,
  DevtoolsRecordActionStateOptions,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSnapshot,
  DevtoolsStore,
  DevtoolsStoreOptions,
} from "./devtools-contract.js";
import {
  findMatchingDevtoolsFactIndex,
  rebaseRuntimeEventInvalidations,
  rebaseRuntimeEventRoutePlans,
  rebaseSnapshotActionInvalidations,
} from "./fact-identity.js";
import {
  copyDevtoolsRoutePlan,
  copyDevtoolsRuntimeEvent,
  copyDevtoolsSnapshot,
  copyDevtoolsSpan,
  copyInvalidationPlan,
  describeInvalidationPlan,
  describeRoutePlan,
  describeSpan,
} from "./serialization.js";
import { describeDevtoolsPanels } from "./panels.js";
import { describeDevtoolsCausalGraph, describeDevtoolsSummary } from "./summary.js";

const actionStateFacts = <I, A, E>(
  state: Action.State<I, A, E>,
): { readonly tag: string; readonly waiting: boolean; readonly input: I | undefined } => ({
  tag: state.result._tag,
  waiting: state.result.waiting,
  input: Option.getOrUndefined(state.input),
});

const normalizeHistoryLimit = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) || value <= 0
    ? fallback
    : Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);

const boundedHistory = <A>(entries: ReadonlyArray<A>, limit: number): ReadonlyArray<A> =>
  entries.length <= limit ? entries : entries.slice(entries.length - limit);

export const makeDevtoolsStore = (options: DevtoolsStoreOptions = {}): DevtoolsStore => {
  const invalidationLimit = normalizeHistoryLimit(options.invalidationLimit, 50);
  const routePlanLimit = normalizeHistoryLimit(options.routePlanLimit, 50);
  const spanLimit = normalizeHistoryLimit(options.spanLimit, 200);
  const eventLimit = normalizeHistoryLimit(options.eventLimit, 500);
  const serializationPolicy = options.serializationPolicy;
  let nextEventSequence = 0;
  let snapshot: DevtoolsSnapshot = {
    resources: [],
    actions: [],
    invalidations: [],
    routePlans: [],
  };

  const boundedEvents = (
    events: ReadonlyArray<DevtoolsRuntimeEvent>,
  ): ReadonlyArray<DevtoolsRuntimeEvent> => boundedHistory(events, eventLimit);

  const normalizeImportedSnapshot = (next: DevtoolsSnapshot): DevtoolsSnapshot => {
    const invalidationDropped = Math.max(0, next.invalidations.length - invalidationLimit);
    const routePlanDropped = Math.max(0, next.routePlans.length - routePlanLimit);
    const boundedInput: DevtoolsSnapshot = {
      ...next,
      invalidations: boundedHistory(next.invalidations, invalidationLimit),
      routePlans: boundedHistory(next.routePlans, routePlanLimit),
      ...(next.spans === undefined ? {} : { spans: boundedHistory(next.spans, spanLimit) }),
      ...(next.events === undefined ? {} : { events: boundedEvents(next.events) }),
    };
    const importedSnapshot = copyDevtoolsSnapshot(boundedInput, serializationPolicy);
    const actions =
      invalidationDropped === 0
        ? importedSnapshot.actions
        : rebaseSnapshotActionInvalidations(importedSnapshot.actions, invalidationDropped);
    const eventsAfterInvalidation =
      invalidationDropped === 0
        ? importedSnapshot.events
        : rebaseRuntimeEventInvalidations(importedSnapshot.events, invalidationDropped);

    const eventsAfterRoutePlans =
      routePlanDropped === 0
        ? eventsAfterInvalidation
        : rebaseRuntimeEventRoutePlans(eventsAfterInvalidation, routePlanDropped);
    const normalizedEvents = normalizeRuntimeEventSequences(eventsAfterRoutePlans);
    const events = normalizedEvents === undefined ? undefined : boundedEvents(normalizedEvents);

    return {
      resources: importedSnapshot.resources,
      actions,
      invalidations: importedSnapshot.invalidations,
      routePlans: importedSnapshot.routePlans,
      ...(importedSnapshot.spans === undefined ? {} : { spans: importedSnapshot.spans }),
      ...(events === undefined ? {} : { events }),
    };
  };

  const nextRuntimeEventSequence = (
    events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined,
  ): number =>
    events?.reduce((next, event, index) => Math.max(next, (event.sequence ?? index) + 1), 0) ?? 0;

  const normalizeRuntimeEventSequences = (
    events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined,
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
      !existing.some(
        (candidate, index) =>
          candidate._tag === event._tag && (candidate.sequence ?? index) === requested,
      )
    ) {
      nextEventSequence = Math.max(nextEventSequence, requested + 1);
      return event;
    }

    const sequence = nextEventSequence;
    nextEventSequence += 1;
    return {
      ...event,
      sequence,
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
              invalidationIndex,
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
              routePlanIndex,
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
        copyDevtoolsRuntimeEvent(withSequence(withFactIndexes(event)), serializationPolicy),
      ]),
    };
  };

  const recordInvalidationPlan = (plan: Resource.InvalidationPlan<any>): number =>
    recordSerializedInvalidationPlan(describeInvalidationPlan(plan));

  const recordSerializedInvalidationPlan = (plan: DevtoolsInvalidationPlan): number => {
    const existing = findMatchingDevtoolsFactIndex(snapshot.invalidations, plan);
    if (existing !== undefined) {
      return existing;
    }

    const nextInvalidations = [
      ...snapshot.invalidations,
      copyInvalidationPlan(plan, serializationPolicy),
    ];
    const dropped = Math.max(0, nextInvalidations.length - invalidationLimit);
    const invalidations = boundedHistory(nextInvalidations, invalidationLimit);
    if (dropped === 0) {
      snapshot = {
        ...snapshot,
        invalidations,
      };
      return invalidations.length - 1;
    }

    const rebasedEvents = rebaseRuntimeEventInvalidations(snapshot.events, dropped);
    snapshot = {
      ...snapshot,
      invalidations,
      actions: rebaseSnapshotActionInvalidations(snapshot.actions, dropped),
      ...(rebasedEvents === undefined ? {} : { events: rebasedEvents }),
    };
    return invalidations.length - 1;
  };

  const recordSerializedRoutePlan = (plan: DevtoolsRoutePlan): number => {
    const nextRoutePlans = [
      ...snapshot.routePlans,
      copyDevtoolsRoutePlan(plan, serializationPolicy),
    ];
    const dropped = Math.max(0, nextRoutePlans.length - routePlanLimit);
    const routePlans = boundedHistory(nextRoutePlans, routePlanLimit);
    const rebasedEvents =
      dropped === 0 ? snapshot.events : rebaseRuntimeEventRoutePlans(snapshot.events, dropped);
    snapshot = {
      ...snapshot,
      routePlans,
      ...(rebasedEvents === undefined ? {} : { events: rebasedEvents }),
    };
    return routePlans.length - 1;
  };

  const recordActionInvalidations = (
    actionOptions: DevtoolsRecordActionStateOptions,
  ): ReadonlyArray<number> | undefined => {
    if (
      actionOptions.invalidationPlan !== undefined &&
      actionOptions.serializedInvalidationPlan !== undefined
    ) {
      throw new DevtoolsActionInvalidationPlanConflict({
        guidance:
          "Pass invalidationPlan for local refs or serializedInvalidationPlan for transport-provided snapshots.",
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

  const validateActionInvalidationOptionsEffect = (
    actionOptions: DevtoolsRecordActionStateOptions,
  ): Effect.Effect<void, DevtoolsActionInvalidationPlanConflict> =>
    actionOptions.invalidationPlan !== undefined &&
    actionOptions.serializedInvalidationPlan !== undefined
      ? Effect.fail(
          new DevtoolsActionInvalidationPlanConflict({
            guidance:
              "Pass invalidationPlan for local refs or serializedInvalidationPlan for transport-provided snapshots.",
          }),
        )
      : Effect.void;

  const recordActionState = (
    action: string,
    state: string,
    actionOptions: DevtoolsRecordActionStateOptions = {},
  ): void => {
    const invalidationIndexes = recordActionInvalidations(actionOptions);
    snapshot = {
      ...snapshot,
      actions: [
        ...snapshot.actions.filter((entry) => entry.name !== action),
        {
          name: action,
          state,
          ...(actionOptions.waiting === undefined ? {} : { waiting: actionOptions.waiting }),
          ...(invalidationIndexes === undefined ? {} : { invalidationIndexes }),
        },
      ],
    };
    recordRuntimeEvent({
      _tag: "ActionState",
      action,
      state,
      ...(actionOptions.waiting === undefined ? {} : { waiting: actionOptions.waiting }),
      ...(actionOptions.input === undefined ? {} : { input: actionOptions.input }),
      ...(invalidationIndexes === undefined ? {} : { invalidationIndexes }),
    });
  };

  const recordAction = <I, A, E, R>(action: Action.Instance<I, A, E, R>): void => {
    const { tag, waiting, input } = actionStateFacts(action.state.get());
    const invalidationPlan = action.invalidationPlan.get();
    recordActionState(action.definition.name, tag, {
      waiting,
      ...(input === undefined ? {} : { input }),
      ...(invalidationPlan === undefined ? {} : { invalidationPlan }),
    });
  };

  const recordTimelineEntry = (entry: Timeline.Entry): void => {
    recordRuntimeEvent({
      _tag: "TimelineCommit",
      at: entry.at,
      commit: {
        sequence: entry.sequence,
        label: Timeline.describe(entry.cause),
        cause: entry.cause,
        changes: entry.changes.map((change) => ({
          signal: change.name,
          previous: change.previous,
          next: change.next,
        })),
      },
    });
  };

  const getSnapshotEffect = () =>
    Effect.sync(() => copyDevtoolsSnapshot(snapshot, serializationPolicy));
  const setSnapshotEffect = (next: DevtoolsSnapshot) =>
    Effect.sync(() => {
      snapshot = normalizeImportedSnapshot(next);
      nextEventSequence = nextRuntimeEventSequence(snapshot.events);
    });
  const recordInvalidationEffect = (plan: Resource.InvalidationPlan) =>
    Effect.sync(() => recordInvalidationPlan(plan));
  const recordSerializedInvalidationEffect = (plan: DevtoolsInvalidationPlan) =>
    Effect.sync(() => recordSerializedInvalidationPlan(plan));
  const recordActionStateEffect = (
    action: string,
    state: string,
    actionOptions: DevtoolsRecordActionStateOptions = {},
  ) =>
    Effect.gen(function* () {
      yield* validateActionInvalidationOptionsEffect(actionOptions);
      yield* Effect.sync(() => {
        recordActionState(action, state, actionOptions);
      });
    });
  const recordActionEffect = <I, A, E, R>(action: Action.Instance<I, A, E, R>) =>
    Effect.sync(() => {
      recordAction(action);
    });
  const trackActionEffect = <I, A, E, R>(action: Action.Instance<I, A, E, R>) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        recordAction(action);
        return action.state.subscribe(() => recordAction(action));
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    ).pipe(Effect.asVoid);
  const recordRoutePlanEffect = (plan: Route.NavigationPlan) =>
    Effect.sync(() => recordSerializedRoutePlan(describeRoutePlan(plan)));
  const recordSerializedRoutePlanEffect = (plan: DevtoolsRoutePlan) =>
    Effect.sync(() => recordSerializedRoutePlan(plan));
  const recordResourceEventEffect = (event: Resource.StoreEvent) =>
    Effect.sync(() => {
      recordRuntimeEvent({
        _tag: "ResourceStoreEvent",
        event,
      });
    });
  const recordTimelineEntryEffect = (entry: Timeline.Entry) =>
    Effect.sync(() => {
      recordTimelineEntry(entry);
    });
  const trackTimelineEffect = (recording: Timeline.Recording) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let observedSequence = 0;
        const recordNewEntries = () => {
          for (const entry of recording.entries.get()) {
            if (entry.sequence > observedSequence) {
              observedSequence = entry.sequence;
              recordTimelineEntry(entry);
            }
          }
        };
        recordNewEntries();
        return recording.entries.subscribe(recordNewEntries);
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    ).pipe(Effect.asVoid);
  const recordRuntimeEventEffect = (event: DevtoolsRuntimeEvent) =>
    Effect.sync(() => {
      recordRuntimeEvent(event);
    });
  const recordSpanEffect = (span: Tracer.Span) =>
    Effect.sync(() => {
      snapshot = {
        ...snapshot,
        spans: boundedHistory(
          [...(snapshot.spans ?? []), copyDevtoolsSpan(describeSpan(span), serializationPolicy)],
          spanLimit,
        ),
      };
    });
  const summaryInput = (): { readonly snapshot: DevtoolsSnapshot } => ({
    snapshot: copyDevtoolsSnapshot(snapshot, serializationPolicy),
  });
  const getSummaryEffect = () => Effect.sync(() => describeDevtoolsSummary(summaryInput()));
  const getPanelsEffect = () => Effect.sync(() => describeDevtoolsPanels(summaryInput()));
  const getCausalGraphEffect = () => Effect.sync(() => describeDevtoolsCausalGraph(summaryInput()));

  const store = {
    getSnapshot: getSnapshotEffect,
    setSnapshot: setSnapshotEffect,
    recordInvalidation: recordInvalidationEffect,
    recordSerializedInvalidation: recordSerializedInvalidationEffect,
    recordActionState: recordActionStateEffect,
    recordAction: recordActionEffect,
    trackAction: trackActionEffect,
    recordRoutePlan: recordRoutePlanEffect,
    recordSerializedRoutePlan: recordSerializedRoutePlanEffect,
    recordResourceEvent: recordResourceEventEffect,
    recordTimelineEntry: recordTimelineEntryEffect,
    trackTimeline: trackTimelineEffect,
    recordRuntimeEvent: recordRuntimeEventEffect,
    recordSpan: recordSpanEffect,
    getSummary: getSummaryEffect,
    getPanels: getPanelsEffect,
    getCausalGraph: getCausalGraphEffect,
  } satisfies DevtoolsStore;

  return store;
};

/**
 * Wraps the current Effect `Tracer` so every span that ends is also recorded
 * into the store. Spans still reach the wrapped tracer (OpenTelemetry etc.).
 */
export const devtoolsTracerLayer = (store: DevtoolsStore): Layer.Layer<never> =>
  Layer.effect(
    Tracer.Tracer,
    Effect.map(Effect.tracer, (inner) =>
      Tracer.make({
        ...inner,
        span(options) {
          const span = inner.span(options);
          const end = span.end;
          span.end = (endTime, exit) => {
            end.call(span, endTime, exit);
            Effect.runSync(store.recordSpan(span));
          };
          return span;
        },
      }),
    ),
  );
