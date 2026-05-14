import { type ResourceStoreEvent } from "@effect-ui/core";
import { toDevtoolsSerializableValue } from "./serialization.js";
import type {
  DevtoolsCollectionStoreEvent,
  DevtoolsInvalidationPlan,
  DevtoolsInvalidationTarget,
  DevtoolsRequestTrace,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSerializableValue,
  DevtoolsSnapshot,
  DevtoolsSummaryInvalidationCause,
  DevtoolsSummaryInvalidationPlan,
  DevtoolsSummaryInvalidationTarget,
  DevtoolsSummaryRequestTrace,
  DevtoolsSummaryResource,
  DevtoolsSummaryResourceRef,
  DevtoolsSummaryRoutePlan,
  DevtoolsSummaryRuntimeEvent
} from "./index.js";

export const emptySnapshot = (): DevtoolsSnapshot => ({
  resources: [],
  actions: [],
  invalidations: [],
  routePlans: []
});

const stateCounts = (
  entries: Iterable<{ readonly state: string }>
): ReadonlyArray<{ readonly state: string; readonly count: number }> => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => ({ state, count }));
};

const actionNodeId = (name: string): string => `action:${name}`;

const collectionNodeId = (collection: string): string => `collection:${collection}`;

const invalidationNodeId = (index: number): string => `invalidation:${index}`;

const requestTraceNodeId = (trace: DevtoolsSummaryRequestTrace): string =>
  `request-trace:${trace.id}`;

const resourceNodeId = (key: string): string => `resource:${key}`;

const routePlanNodeId = (index: number, href: string): string => `route-plan:${index}:${href}`;

export const summarizeResourceRef = (ref: {
  readonly key: string;
  readonly family: string;
  readonly input: unknown;
}): DevtoolsSummaryResourceRef => ({
  key: ref.key,
  family: ref.family,
  input: toDevtoolsSerializableValue(ref.input)
});

export const summarizeTarget = (
  target: DevtoolsInvalidationTarget
): DevtoolsSummaryInvalidationTarget =>
  target._tag === "Ref"
    ? {
        _tag: "Ref",
        ...summarizeResourceRef(target)
      }
    : { ...target };

export const summarizeInvalidationPlan = (
  plan: DevtoolsInvalidationPlan,
  index: number
): DevtoolsSummaryInvalidationPlan => ({
  index,
  targetCount: plan.targets.length,
  matchedResourceCount: plan.entries.length,
  causeCount: plan.entries.reduce((sum, entry) => sum + entry.causes.length, 0),
  targets: plan.targets.map(summarizeTarget),
  entries: plan.entries.map((entry) => ({
    ref: summarizeResourceRef(entry.ref),
    causes: entry.causes.map((cause) => ({ ...cause }))
  }))
});

export const summarizeRoutePlan = (
  plan: DevtoolsRoutePlan,
  index: number
): DevtoolsSummaryRoutePlan => ({
  index,
  _tag: plan._tag,
  href: plan.href,
  path: plan.match?.path ?? null,
  params: plan.match ? toDevtoolsSerializableValue(plan.match.params) : null,
  search: plan.match ? toDevtoolsSerializableValue(plan.match.search) : null,
  resourceCount: plan.resources.length,
  hydrationResourceCount: plan.hydration.resourceCount,
  resources: plan.resources.map(summarizeResourceRef)
});

export const summarizeRequestTrace = (
  trace: DevtoolsRequestTrace,
  index: number
): DevtoolsSummaryRequestTrace => ({
  index,
  id: trace.request.id ?? `${trace.request.method}:${trace.request.path}:${index}`,
  method: trace.request.method,
  path: trace.request.path,
  url: trace.request.url,
  transport: trace.request.transport,
  status: trace.status,
  failureKind: trace.failureKind ?? null,
  responseStatus: trace.response?.status ?? null,
  serviceCount: trace.services.length,
  resourceCount: trace.resources.length,
  collectionCount: trace.collections.length,
  serverFunctionCount: trace.serverFunctions.length,
  actionCount: trace.actions.length,
  fiberCount: trace.fibers.length,
  streamCount: trace.streams.length,
  runtimeDisposed: trace.teardown?.runtimeDisposed ?? null,
  teardownReason: trace.teardown?.reason ?? null,
  durationMillis: trace.teardown?.durationMillis ?? null,
  beforeDisposeFiberCount: trace.teardown?.beforeDispose?.fiberCount ?? null,
  afterDisposeFiberCount: trace.teardown?.afterDispose?.fiberCount ?? null,
  routeHref: trace.routePlan?.href ?? null
});

const resourceEventTarget = (event: ResourceStoreEvent): { readonly id: string; readonly label: string } => ({
  id: resourceNodeId(event.key),
  label: event.name
});

const collectionEventTarget = (event: DevtoolsCollectionStoreEvent): { readonly id: string; readonly label: string } => ({
  id: collectionNodeId(event.collection),
  label: event.collection
});

const runtimeTargetLabel = (target: NonNullable<DevtoolsSummaryRuntimeEvent["target"]>): string =>
  target.kind === "Collection" && target.id.startsWith("collection:")
    ? target.id.slice("collection:".length)
    : target.kind === "RequestTrace" && target.id.startsWith("request-trace:")
      ? target.id.slice("request-trace:".length)
    : target.id;

export const summarizeRuntimeEvent = (
  event: DevtoolsRuntimeEvent,
  index: number
): DevtoolsSummaryRuntimeEvent => {
  const sequence = event.sequence ?? index;
  const at = event.at ?? null;

  switch (event._tag) {
    case "ResourceStoreEvent": {
      const target = resourceEventTarget(event.event);
      return {
        index,
        id: `runtime-event:${sequence}:ResourceStoreEvent`,
        _tag: event._tag,
        sequence,
        at,
        label: event.event._tag,
        target: {
          kind: "Resource",
          id: target.id
        },
        data: toDevtoolsSerializableValue(event.event)
      };
    }
    case "CollectionStoreEvent": {
      const target = collectionEventTarget(event.event);
      return {
        index,
        id: `runtime-event:${sequence}:CollectionStoreEvent`,
        _tag: event._tag,
        sequence,
        at,
        label: event.event._tag,
        target: {
          kind: "Collection",
          id: target.id
        },
        data: toDevtoolsSerializableValue(event.event)
      };
    }
    case "ActionState":
      return {
        index,
        id: `runtime-event:${sequence}:ActionState`,
        _tag: event._tag,
        sequence,
        at,
        label: `${event.action} ${event.state}`,
        target: {
          kind: "Action",
          id: actionNodeId(event.action)
        },
        data: toDevtoolsSerializableValue({
          action: event.action,
          state: event.state,
          input: event.input,
          invalidationIndexes: event.invalidationIndexes ?? []
        })
      };
    case "Invalidation":
      return {
        index,
        id: `runtime-event:${sequence}:Invalidation`,
        _tag: event._tag,
        sequence,
        at,
        label: event.action === undefined ? "Invalidation" : `${event.action} invalidation`,
        target: {
          kind: "InvalidationPlan",
          id: invalidationNodeId(index)
        },
        data: toDevtoolsSerializableValue({
          action: event.action ?? null,
          plan: event.plan
        })
      };
    case "RoutePlan":
      return {
        index,
        id: `runtime-event:${sequence}:RoutePlan`,
        _tag: event._tag,
        sequence,
        at,
        label: event.plan.href,
        target: {
          kind: "RoutePlan",
          id: routePlanNodeId(index, event.plan.href)
        },
        data: toDevtoolsSerializableValue(event.plan)
      };
    case "RequestTrace": {
      const trace = summarizeRequestTrace(event.trace, index);
      return {
        index,
        id: `runtime-event:${sequence}:RequestTrace`,
        _tag: event._tag,
        sequence,
        at,
        label: `${trace.method} ${trace.path}`,
        target: {
          kind: "RequestTrace",
          id: requestTraceNodeId(trace)
        },
        data: toDevtoolsSerializableValue(event.trace)
      };
    }
    case "Custom":
      return {
        index,
        id: `runtime-event:${sequence}:Custom`,
        _tag: event._tag,
        sequence,
        at,
        label: event.name,
        target: null,
        data: toDevtoolsSerializableValue({
          name: event.name,
          payload: event.payload
        })
      };
  }
};

const sortedStrings = (values: Iterable<string>): readonly string[] =>
  Array.from(new Set(values)).sort();

export const resourceIndex = (
  snapshot: DevtoolsSnapshot,
  invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>,
  routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>,
  requestTraces: ReadonlyArray<DevtoolsRequestTrace>
): ReadonlyArray<DevtoolsSummaryResource> => {
  const resources = new Map<string, {
    key: string;
    family: string | null;
    input: DevtoolsSerializableValue | null;
    state: string | null;
    sources: Set<"Invalidation" | "RequestTrace" | "RoutePlan" | "Snapshot">;
    routeHrefs: Set<string>;
    invalidationIndexes: Set<number>;
  }>();

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
      sources: new Set<"Invalidation" | "RequestTrace" | "RoutePlan" | "Snapshot">(),
      routeHrefs: new Set<string>(),
      invalidationIndexes: new Set<number>()
    };
    resources.set(key, next);
    return next;
  };

  for (const resource of snapshot.resources) {
    const entry = entryFor(resource.key);
    entry.state = resource.state;
    entry.sources.add("Snapshot");
  }

  for (const plan of routePlans) {
    for (const resource of plan.resources) {
      const entry = entryFor(resource.key);
      entry.family = resource.family;
      entry.input = resource.input;
      entry.sources.add("RoutePlan");
      entry.routeHrefs.add(plan.href);
    }
  }

  for (const plan of invalidations) {
    for (const entryPlan of plan.entries) {
      const entry = entryFor(entryPlan.ref.key);
      entry.family = entryPlan.ref.family;
      entry.input = entryPlan.ref.input;
      entry.sources.add("Invalidation");
      entry.invalidationIndexes.add(plan.index);
    }
  }

  for (const trace of requestTraces) {
    for (const resource of trace.resources) {
      const entry = entryFor(resource.key);
      entry.family = resource.family;
      if (resource.input !== undefined) {
        entry.input = toDevtoolsSerializableValue(resource.input);
      }
      if (resource.state !== undefined) {
        entry.state = resource.state;
      }
      entry.sources.add("RequestTrace");
      if (trace.routePlan) {
        entry.routeHrefs.add(trace.routePlan.href);
      }
    }
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
      invalidationIndexes: Array.from(resource.invalidationIndexes).sort((left, right) => left - right)
    }));
};

export const summarizeRuntimeEvents = (
  events: ReadonlyArray<DevtoolsRuntimeEvent>
): ReadonlyArray<DevtoolsSummaryRuntimeEvent> =>
  events.map(summarizeRuntimeEvent).sort((left, right) => {
    const bySequence = left.sequence - right.sequence;
    return bySequence === 0 ? left.id.localeCompare(right.id) : bySequence;
  });
