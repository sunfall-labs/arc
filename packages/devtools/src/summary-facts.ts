import type { Resource } from "@sunfall/arc-core";
import {
  devtoolsActionNodeId as actionNodeId,
  devtoolsInvalidationNodeId as invalidationNodeId,
  devtoolsProgramNodeId as programNodeId,
  devtoolsResourceNodeId as resourceNodeId,
  devtoolsRoutePlanNodeId as routePlanNodeId,
  devtoolsRuntimeEventSummaryId as runtimeEventSummaryId,
} from "./graph-ids.js";
import { firstDevtoolsFactIndexes, matchingDevtoolsFactIndex } from "./fact-identity.js";
import { toDevtoolsSerializableValue } from "./serialization.js";
import type {
  DevtoolsInvalidationPlan,
  DevtoolsInvalidationTarget,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSerializableValue,
  DevtoolsSnapshot,
  DevtoolsSummaryInput,
  DevtoolsSummaryInvalidationPlan,
  DevtoolsSummaryInvalidationTarget,
  DevtoolsSpan,
  DevtoolsSummaryRequest,
  DevtoolsSummaryResource,
  DevtoolsSummaryResourceRef,
  DevtoolsSummaryRoutePlan,
  DevtoolsSummaryRuntimeEvent,
  DevtoolsTimelineCommit,
} from "./devtools-contract.js";

export const emptySnapshot = (): DevtoolsSnapshot => ({
  resources: [],
  actions: [],
  invalidations: [],
  routePlans: [],
});

export interface NormalizedDevtoolsSummaryInput {
  readonly snapshot: DevtoolsSnapshot;
  readonly invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>;
  readonly spans: ReadonlyArray<DevtoolsSpan>;
  readonly requests: ReadonlyArray<DevtoolsSummaryRequest>;
  readonly runtimeEvents: ReadonlyArray<DevtoolsSummaryRuntimeEvent>;
  readonly resources: ReadonlyArray<DevtoolsSummaryResource>;
}

export const summarizeResourceRef = (ref: {
  readonly key: string;
  readonly family: string;
  readonly input: unknown;
}): DevtoolsSummaryResourceRef => ({
  key: ref.key,
  family: ref.family,
  input: toDevtoolsSerializableValue(ref.input),
});

export const summarizeTarget = (
  target: DevtoolsInvalidationTarget,
): DevtoolsSummaryInvalidationTarget =>
  target._tag === "Ref"
    ? {
        _tag: "Ref",
        ...summarizeResourceRef(target),
      }
    : { ...target };

export const summarizeInvalidationPlan = (
  plan: DevtoolsInvalidationPlan,
  index: number,
): DevtoolsSummaryInvalidationPlan => ({
  index,
  targetCount: plan.targets.length,
  matchedResourceCount: plan.entries.length,
  causeCount: plan.entries.reduce((sum, entry) => sum + entry.causes.length, 0),
  targets: plan.targets.map(summarizeTarget),
  entries: plan.entries.map((entry) => ({
    ref: summarizeResourceRef(entry.ref),
    causes: entry.causes.map((cause) => ({ ...cause })),
  })),
});

const hydratedResourceKeys = (plan: DevtoolsRoutePlan): ReadonlyArray<string> => {
  if (plan.hydration.resourceKeys !== undefined) {
    return [...plan.hydration.resourceKeys];
  }

  return [];
};

export const summarizeRoutePlan = (
  plan: DevtoolsRoutePlan,
  index: number,
): DevtoolsSummaryRoutePlan => {
  const hydratedKeys = hydratedResourceKeys(plan);
  return {
    index,
    _tag: plan._tag,
    href: plan.href,
    path: plan.match?.path ?? null,
    params: plan.match ? toDevtoolsSerializableValue(plan.match.params) : null,
    search: plan.match ? toDevtoolsSerializableValue(plan.match.search) : null,
    resourceCount: plan.resources.length,
    hydrationResourceCount: plan.hydration.resourceCount,
    hydratedResourceKeys: hydratedKeys,
    resources: plan.resources.map(summarizeResourceRef),
  };
};

/** The span name Start gives each handled request. */
export const startRequestSpanName = "sunfall-arc.start.request";

const stringAttribute = (span: DevtoolsSpan, key: string): string | null => {
  const value = span.attributes[key];
  return typeof value === "string" ? value : null;
};

const requestStatus = (span: DevtoolsSpan): DevtoolsSummaryRequest["status"] => {
  const status = span.attributes["sunfall-arc.request.status"];
  return status === "success" || status === "failure" || status === "cancelled"
    ? status
    : span.status === "interrupted"
      ? "cancelled"
      : span.status;
};

/** Projects Start request spans (and their child spans) into request rows. */
export const summarizeRequests = (
  spans: ReadonlyArray<DevtoolsSpan>,
): ReadonlyArray<DevtoolsSummaryRequest> =>
  spans
    .filter((span) => span.name === startRequestSpanName)
    .map((span, index) => {
      const responseStatus = span.attributes["http.response.status_code"];
      const runtimeDisposed = span.attributes["sunfall-arc.teardown.runtime_disposed"];
      const fibers = span.attributes["sunfall-arc.teardown.fibers"];
      const resources = span.attributes["sunfall-arc.route.resources"];
      return {
        index,
        id: span.spanId,
        traceId: span.traceId,
        requestId: stringAttribute(span, "sunfall-arc.request.id"),
        method: stringAttribute(span, "http.request.method") ?? "GET",
        path: stringAttribute(span, "url.path") ?? "/",
        route: stringAttribute(span, "http.route"),
        resources: Array.isArray(resources)
          ? resources.filter((key): key is string => typeof key === "string")
          : [],
        transport: stringAttribute(span, "sunfall-arc.request.transport") ?? "ssr",
        status: requestStatus(span),
        failureKind: stringAttribute(span, "sunfall-arc.failure.kind"),
        responseStatus: typeof responseStatus === "number" ? responseStatus : null,
        durationMillis: span.durationMillis,
        runtimeDisposed: typeof runtimeDisposed === "boolean" ? runtimeDisposed : null,
        fibersAfterDispose: typeof fibers === "number" ? fibers : null,
        children: spans
          .filter((child) => child.parentSpanId === span.spanId)
          .map((child) => ({
            name:
              stringAttribute(child, "sunfall-arc.rpc.name") ??
              stringAttribute(child, "sunfall-arc.action.name") ??
              child.name,
            status: child.status,
          })),
      };
    });

const resourceEventTarget = (
  event: Resource.StoreEvent,
): { readonly id: string; readonly label: string } => ({
  id: resourceNodeId(event.key),
  label: event.name,
});

interface RuntimeEventFactIndexes {
  readonly invalidations: ReadonlyMap<string, number>;
  readonly invalidationCount: number;
  readonly routePlans: ReadonlyMap<string, number>;
  readonly routePlanCount: number;
}

const emptyRuntimeEventFactIndexes = (): RuntimeEventFactIndexes => ({
  invalidations: new Map(),
  invalidationCount: 0,
  routePlans: new Map(),
  routePlanCount: 0,
});

/** Links a Timeline commit to the fact its cause names, when it names one. */
const timelineCommitTarget = (
  commit: DevtoolsTimelineCommit,
): DevtoolsSummaryRuntimeEvent["target"] => {
  switch (commit.cause._tag) {
    case "Program":
      return { kind: "Program", id: programNodeId(commit.cause.program ?? "Program") };
    case "Action":
      return { kind: "Action", id: actionNodeId(commit.cause.action) };
    case "Resource":
      return { kind: "Resource", id: resourceNodeId(commit.cause.key) };
    default:
      return null;
  }
};

export const summarizeRuntimeEvent = (
  event: DevtoolsRuntimeEvent,
  index: number,
  factIndexes: RuntimeEventFactIndexes = emptyRuntimeEventFactIndexes(),
): DevtoolsSummaryRuntimeEvent => {
  const sequence = event.sequence ?? index;
  const at = event.at ?? null;

  switch (event._tag) {
    case "ResourceStoreEvent": {
      const target = resourceEventTarget(event.event);
      return {
        index,
        id: runtimeEventSummaryId(sequence, "ResourceStoreEvent"),
        _tag: event._tag,
        sequence,
        at,
        label: event.event._tag,
        target: {
          kind: "Resource",
          id: target.id,
        },
        data: toDevtoolsSerializableValue(event.event),
      };
    }
    case "TimelineCommit":
      return {
        index,
        id: runtimeEventSummaryId(sequence, "TimelineCommit"),
        _tag: event._tag,
        sequence,
        at,
        label: event.commit.label,
        target: timelineCommitTarget(event.commit),
        data: toDevtoolsSerializableValue(event.commit),
      };
    case "ActionState":
      return {
        index,
        id: runtimeEventSummaryId(sequence, "ActionState"),
        _tag: event._tag,
        sequence,
        at,
        label: `${event.action} ${event.state}`,
        target: {
          kind: "Action",
          id: actionNodeId(event.action),
        },
        data: toDevtoolsSerializableValue({
          action: event.action,
          state: event.state,
          input: event.input,
          invalidationIndexes: event.invalidationIndexes ?? [],
        }),
      };
    case "Invalidation":
      const invalidationIndex =
        event.invalidationIndex ?? matchingDevtoolsFactIndex(factIndexes.invalidations, event.plan);
      const invalidationTargetIndex = invalidationIndex ?? factIndexes.invalidationCount + index;
      const invalidationPlan = summarizeInvalidationPlan(event.plan, invalidationTargetIndex);
      return {
        index,
        id: runtimeEventSummaryId(sequence, "Invalidation"),
        _tag: event._tag,
        sequence,
        at,
        label: event.action === undefined ? "Invalidation" : `${event.action} invalidation`,
        target: {
          kind: "InvalidationPlan",
          id: invalidationNodeId(invalidationTargetIndex),
        },
        invalidationPlan,
        data: toDevtoolsSerializableValue({
          action: event.action ?? null,
          invalidationIndex: invalidationIndex ?? null,
          plan: event.plan,
        }),
      };
    case "RoutePlan":
      const routePlanIndex =
        event.routePlanIndex ?? matchingDevtoolsFactIndex(factIndexes.routePlans, event.plan);
      const routePlanTargetIndex = routePlanIndex ?? factIndexes.routePlanCount + index;
      const routePlan = summarizeRoutePlan(event.plan, routePlanTargetIndex);
      return {
        index,
        id: runtimeEventSummaryId(sequence, "RoutePlan"),
        _tag: event._tag,
        sequence,
        at,
        label: event.plan.href,
        target: {
          kind: "RoutePlan",
          id: routePlanNodeId(routePlanTargetIndex, event.plan.href),
        },
        routePlan,
        data: toDevtoolsSerializableValue(event.plan),
      };
    case "Custom":
      return {
        index,
        id: runtimeEventSummaryId(sequence, "Custom"),
        _tag: event._tag,
        sequence,
        at,
        label: event.name,
        target: null,
        data: toDevtoolsSerializableValue({
          name: event.name,
          payload: event.payload,
        }),
      };
  }
};

const sortedStrings = (values: Iterable<string>): readonly string[] =>
  Array.from(new Set(values)).sort();

type ResourceIndexSource = DevtoolsSummaryResource["sources"][number];

export const resourceIndex = (
  snapshot: DevtoolsSnapshot,
  invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>,
  routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>,
  runtimeEvents: ReadonlyArray<DevtoolsRuntimeEvent> = [],
  runtimeEventSummaries: ReadonlyArray<DevtoolsSummaryRuntimeEvent> = [],
): ReadonlyArray<DevtoolsSummaryResource> => {
  const resources = new Map<
    string,
    {
      key: string;
      family: string | null;
      input: DevtoolsSerializableValue | null;
      state: string | null;
      sources: Set<ResourceIndexSource>;
      routeHrefs: Set<string>;
      invalidationIndexes: Set<number>;
    }
  >();

  const entryFor = (key: string) => {
    const existing = resources.get(key);
    if (existing) {
      return existing;
    }
    const next = {
      key,
      family: null,
      input: null,
      state: null,
      sources: new Set<ResourceIndexSource>(),
      routeHrefs: new Set<string>(),
      invalidationIndexes: new Set<number>(),
    };
    resources.set(key, next);
    return next;
  };

  for (const resource of snapshot.resources) {
    const entry = entryFor(resource.key);
    entry.state = resource.state;
    entry.sources.add("Snapshot");
  }

  const addRoutePlanResources = (plan: DevtoolsSummaryRoutePlan): void => {
    for (const resource of plan.resources) {
      const entry = entryFor(resource.key);
      entry.family = resource.family;
      entry.input = resource.input;
      entry.sources.add("RoutePlan");
      entry.routeHrefs.add(plan.href);
    }
  };

  const addInvalidationResources = (plan: DevtoolsSummaryInvalidationPlan): void => {
    for (const entryPlan of plan.entries) {
      const entry = entryFor(entryPlan.ref.key);
      entry.family = entryPlan.ref.family;
      entry.input = entryPlan.ref.input;
      entry.sources.add("Invalidation");
      entry.invalidationIndexes.add(plan.index);
    }
  };

  for (const plan of routePlans) {
    addRoutePlanResources(plan);
  }

  for (const plan of invalidations) {
    addInvalidationResources(plan);
  }

  const recordedFactNodeIds = new Set<string>([
    ...invalidations.map((plan) => invalidationNodeId(plan.index)),
    ...routePlans.map((plan) => routePlanNodeId(plan.index, plan.href)),
  ]);
  for (const event of runtimeEventSummaries) {
    if (
      event.routePlan !== undefined &&
      !recordedFactNodeIds.has(routePlanNodeId(event.routePlan.index, event.routePlan.href))
    ) {
      addRoutePlanResources(event.routePlan);
    }
    if (
      event.invalidationPlan !== undefined &&
      !recordedFactNodeIds.has(invalidationNodeId(event.invalidationPlan.index))
    ) {
      addInvalidationResources(event.invalidationPlan);
    }
  }

  const stateFromResourceEvent = (event: Resource.StoreEvent): string => {
    switch (event._tag) {
      case "ResourcePending":
        return "Pending";
      case "ResourceSuccess":
      case "ResourceHydrated":
        return "Success";
      case "ResourceFailure":
        return "Failure";
      case "ResourceInterrupted":
        return "Interrupted";
      case "ResourceDeleted":
        return "Deleted";
      case "ResourceInvalidated":
        return "Invalidated";
      case "ResourceGcScheduled":
      case "ResourceGcInterrupted":
      case "ResourceRowsChanged":
      case "ResourceRowsChangesFailure":
        return event._tag;
    }
  };

  for (const event of runtimeEvents) {
    if (event._tag !== "ResourceStoreEvent") {
      continue;
    }
    const entry = entryFor(event.event.key);
    entry.family = event.event.name;
    entry.state = stateFromResourceEvent(event.event);
    entry.sources.add("RuntimeEvent");
  }

  return Array.from(resources.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((resource) => ({
      key: resource.key,
      family: resource.family,
      input: resource.input,
      state: resource.state,
      sources: Array.from(resource.sources).sort(),
      routeHrefs: sortedStrings(resource.routeHrefs),
      invalidationIndexes: Array.from(resource.invalidationIndexes).sort(
        (left, right) => left - right,
      ),
    }));
};

export const summarizeRuntimeEvents = (
  events: ReadonlyArray<DevtoolsRuntimeEvent>,
  invalidations: ReadonlyArray<DevtoolsInvalidationPlan> = [],
  routePlans: ReadonlyArray<DevtoolsRoutePlan> = [],
): ReadonlyArray<DevtoolsSummaryRuntimeEvent> => {
  const factIndexes = {
    invalidations: firstDevtoolsFactIndexes(invalidations),
    invalidationCount: invalidations.length,
    routePlans: firstDevtoolsFactIndexes(routePlans),
    routePlanCount: routePlans.length,
  };
  return events
    .map((event, index) => summarizeRuntimeEvent(event, index, factIndexes))
    .sort((left, right) => {
      const bySequence = left.sequence - right.sequence;
      return bySequence === 0 ? left.id.localeCompare(right.id) : bySequence;
    });
};

/** Normalizes summary input overrides and raw snapshot facts into shared summary facts. */
export const normalizeDevtoolsSummaryInput = (
  input: DevtoolsSummaryInput = {},
): NormalizedDevtoolsSummaryInput => {
  const snapshot = input.snapshot ?? emptySnapshot();
  const invalidationPlans = input.invalidations ?? snapshot.invalidations;
  const routePlanInputs = input.routePlans ?? snapshot.routePlans;
  const spans = input.spans ?? snapshot.spans ?? [];
  const runtimeEventInputs = input.runtimeEvents ?? snapshot.events ?? [];
  const invalidations = invalidationPlans.map(summarizeInvalidationPlan);
  const routePlans = routePlanInputs.map(summarizeRoutePlan);
  const runtimeEvents = summarizeRuntimeEvents(
    runtimeEventInputs,
    invalidationPlans,
    routePlanInputs,
  );
  const resources = resourceIndex(
    snapshot,
    invalidations,
    routePlans,
    runtimeEventInputs,
    runtimeEvents,
  );

  return {
    snapshot,
    invalidations,
    routePlans,
    spans,
    requests: summarizeRequests(spans),
    runtimeEvents,
    resources,
  };
};
