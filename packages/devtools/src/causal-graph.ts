import {
  devtoolsActionNodeId as actionNodeId,
  devtoolsCausalEdgeId as causalEdgeId,
  devtoolsEndpointNodeId as endpointNodeId,
  devtoolsInvalidationNodeId as invalidationNodeId,
  devtoolsInvalidationTargetNodeId as targetNodeId,
  devtoolsRequestTraceNodeId as requestTraceNodeId,
  devtoolsResourceNodeId as resourceNodeId,
  devtoolsRuntimeEventNodeId as runtimeEventNodeId,
  devtoolsRuntimeTargetLabel as runtimeTargetLabel,
  devtoolsServerFunctionNodeId as serverFunctionNodeId,
} from "./graph-ids.js";
import { stableFactFingerprint } from "./fact-identity.js";
import { toDevtoolsSerializableValue } from "./serialization.js";
import { projectDevtoolsRoutePlanFacts } from "./route-plan-facts.js";
import {
  normalizeDevtoolsSummaryInput,
  summarizeRequestTrace,
  summarizeRoutePlan,
} from "./summary-facts.js";
import type {
  DevtoolsCausalEdge,
  DevtoolsCausalGraph,
  DevtoolsCausalNode,
  DevtoolsSnapshot,
  DevtoolsSummaryInput,
  DevtoolsSummaryInvalidationPlan,
  DevtoolsSummaryRequestTrace,
  DevtoolsSummaryResource,
  DevtoolsSummaryRoutePlan,
  DevtoolsSummaryRuntimeEvent,
  DevtoolsRequestTrace,
} from "./devtools-contract.js";

const addNode = (nodes: Map<string, DevtoolsCausalNode>, node: DevtoolsCausalNode): void => {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
};

const addEdge = (
  edges: Array<DevtoolsCausalEdge>,
  edge: Omit<DevtoolsCausalEdge, "id">,
  ordinals: Map<string, number>,
): void => {
  const ordinalKey = `${edge.kind}\u0000${edge.source}\u0000${edge.target}\u0000${edge.label ?? ""}`;
  const ordinal = ordinals.get(ordinalKey) ?? 0;
  ordinals.set(ordinalKey, ordinal + 1);
  edges.push({
    id: causalEdgeId(edge.kind, edge.source, edge.target, edge.label, ordinal),
    ...edge,
  });
};

const routePlanSummaryFingerprint = (plan: DevtoolsSummaryRoutePlan): string =>
  stableFactFingerprint([
    plan._tag,
    plan.href,
    plan.path,
    plan.params,
    plan.search,
    plan.resourceCount,
    plan.hydrationResourceCount,
    plan.hydratedResourceKeys,
    plan.resources,
  ]) ?? "";

const requestRoutePlanSummary = (
  routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>,
  trace: DevtoolsRequestTrace,
  fallbackIndex: number,
): DevtoolsSummaryRoutePlan | undefined => {
  if (trace.routePlan === undefined) {
    return undefined;
  }

  const fallback = summarizeRoutePlan(trace.routePlan, fallbackIndex);
  const fingerprint = routePlanSummaryFingerprint(fallback);
  return routePlans.find((plan) => routePlanSummaryFingerprint(plan) === fingerprint) ?? fallback;
};

interface DevtoolsCausalGraphInput {
  readonly snapshot: DevtoolsSnapshot;
  readonly invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>;
  readonly requestTraces: ReadonlyArray<DevtoolsRequestTrace>;
  readonly requestTraceSummaries: ReadonlyArray<DevtoolsSummaryRequestTrace>;
  readonly resources: ReadonlyArray<DevtoolsSummaryResource>;
  readonly runtimeEvents: ReadonlyArray<DevtoolsSummaryRuntimeEvent>;
}

export const makeDevtoolsCausalGraph = (input: DevtoolsCausalGraphInput): DevtoolsCausalGraph => {
  const nodes = new Map<string, DevtoolsCausalNode>();
  const edges: Array<DevtoolsCausalEdge> = [];
  const edgeOrdinals = new Map<string, number>();

  const connect = (edge: Omit<DevtoolsCausalEdge, "id">): void => {
    addEdge(edges, edge, edgeOrdinals);
  };
  const routePlanSink = {
    addNode: (node: DevtoolsCausalNode) => addNode(nodes, node),
    connect,
  };
  const projectInvalidationFacts = (plan: DevtoolsSummaryInvalidationPlan): void => {
    const planId = invalidationNodeId(plan.index);
    addNode(nodes, {
      id: planId,
      kind: "InvalidationPlan",
      label: `Invalidation ${plan.index}`,
      data: {
        causeCount: plan.causeCount,
        index: plan.index,
        matchedResourceCount: plan.matchedResourceCount,
        targetCount: plan.targetCount,
      },
    });

    for (const target of plan.targets) {
      const targetId = targetNodeId(target);
      addNode(nodes, {
        id: targetId,
        kind: target._tag === "Tag" ? "ResourceTag" : "Resource",
        label: target._tag === "Tag" ? target.name : target.family,
        data: toDevtoolsSerializableValue(target),
      });
      connect({
        kind: "Targets",
        source: planId,
        target: targetId,
        label: "targets",
        data: null,
      });
    }

    for (const entry of plan.entries) {
      const affectedResourceId = resourceNodeId(entry.ref.key);
      addNode(nodes, {
        id: affectedResourceId,
        kind: "Resource",
        label: entry.ref.family,
        data: {
          family: entry.ref.family,
          input: entry.ref.input,
          key: entry.ref.key,
          state: null,
        },
      });
      connect({
        kind: "Invalidates",
        source: planId,
        target: affectedResourceId,
        label: "invalidates",
        data: {
          causeCount: entry.causes.length,
        },
      });

      for (const cause of entry.causes) {
        const causeId = targetNodeId(cause);
        addNode(nodes, {
          id: causeId,
          kind: cause._tag === "Tag" ? "ResourceTag" : "Resource",
          label: cause._tag === "Tag" ? cause.name : cause.family,
          data: toDevtoolsSerializableValue(cause),
        });
        connect({
          kind: "Causes",
          source: causeId,
          target: affectedResourceId,
          label: "causes",
          data: {
            invalidationIndex: plan.index,
          },
        });
      }
    }
  };
  for (const resource of input.resources) {
    addNode(nodes, {
      id: resourceNodeId(resource.key),
      kind: "Resource",
      label: resource.family ?? resource.key,
      data: {
        family: resource.family,
        input: resource.input,
        key: resource.key,
        sources: [...resource.sources],
        state: resource.state,
      },
    });
  }

  for (const action of input.snapshot.actions) {
    const actionId = actionNodeId(action.name);
    addNode(nodes, {
      id: actionId,
      kind: "Action",
      label: action.name,
      data: {
        name: action.name,
        state: action.state,
      },
    });

    for (const invalidationIndex of action.invalidationIndexes ?? []) {
      connect({
        kind: "Emits",
        source: actionId,
        target: invalidationNodeId(invalidationIndex),
        label: "emits",
        data: {
          invalidationIndex,
        },
      });
    }
  }

  for (const plan of input.routePlans) {
    projectDevtoolsRoutePlanFacts(plan, routePlanSink);
  }

  input.requestTraces.forEach((trace, index) => {
    const traceSummary = input.requestTraceSummaries[index] ?? summarizeRequestTrace(trace, index);
    const traceId = requestTraceNodeId(traceSummary);
    addNode(nodes, {
      id: traceId,
      kind: "RequestTrace",
      label: `${trace.request.method} ${trace.request.path}`,
      data: toDevtoolsSerializableValue({
        request: trace.request,
        response: trace.response ?? null,
        services: trace.services,
        status: trace.status,
        failureKind: trace.failureKind ?? null,
        teardown: trace.teardown ?? null,
        fibers: trace.fibers,
        streams: trace.streams,
      }),
    });

    if (trace.request.transport === "rpc" || trace.request.transport === "action") {
      const endpointId = endpointNodeId(trace.request.transport);
      addNode(nodes, {
        id: endpointId,
        kind: "Endpoint",
        label: trace.request.transport,
        data: {
          transport: trace.request.transport,
        },
      });
      connect({
        kind: "UsesEndpoint",
        source: traceId,
        target: endpointId,
        label: "uses",
        data: {
          transport: trace.request.transport,
        },
      });
    }

    const plan = requestRoutePlanSummary(input.routePlans, trace, input.routePlans.length + index);
    if (plan) {
      const { routePlanId } = projectDevtoolsRoutePlanFacts(plan, routePlanSink);
      connect({
        kind: "Records",
        source: traceId,
        target: routePlanId,
        label: "records",
        data: null,
      });
    }

    for (const resource of trace.resources) {
      const resourceId = resourceNodeId(resource.key);
      addNode(nodes, {
        id: resourceId,
        kind: "Resource",
        label: resource.family,
        data: {
          family: resource.family,
          input: resource.input === undefined ? null : toDevtoolsSerializableValue(resource.input),
          key: resource.key,
          state: resource.state ?? null,
        },
      });
      connect({
        kind: "Records",
        source: traceId,
        target: resourceId,
        label: "records",
        data: {
          targetKind: "Resource",
        },
      });
    }

    for (const action of trace.actions) {
      const actionId = actionNodeId(action.name);
      addNode(nodes, {
        id: actionId,
        kind: "Action",
        label: action.name,
        data: toDevtoolsSerializableValue(action),
      });
      connect({
        kind: "Records",
        source: traceId,
        target: actionId,
        label: "records",
        data: {
          targetKind: "Action",
        },
      });
    }

    for (const serverFunction of trace.serverFunctions) {
      const serverFunctionId = serverFunctionNodeId(serverFunction.name);
      addNode(nodes, {
        id: serverFunctionId,
        kind: "ServerFunction",
        label: serverFunction.name,
        data: toDevtoolsSerializableValue(serverFunction),
      });
      connect({
        kind: "Records",
        source: traceId,
        target: serverFunctionId,
        label: "records",
        data: {
          targetKind: "ServerFunction",
        },
      });
    }
  });

  for (const plan of input.invalidations) {
    projectInvalidationFacts(plan);
  }

  for (const event of input.runtimeEvents) {
    const eventId = runtimeEventNodeId(event);
    addNode(nodes, {
      id: eventId,
      kind: "RuntimeEvent",
      label: event.label,
      data: {
        at: event.at,
        event: event.data,
        index: event.index,
        sequence: event.sequence,
        tag: event._tag,
      },
    });
    if (event.target !== null) {
      if (!nodes.has(event.target.id)) {
        if (event._tag === "Invalidation" && event.invalidationPlan !== undefined) {
          projectInvalidationFacts(event.invalidationPlan);
        } else if (event._tag === "RoutePlan" && event.routePlan !== undefined) {
          projectDevtoolsRoutePlanFacts(event.routePlan, routePlanSink);
        }
      }
      addNode(nodes, {
        id: event.target.id,
        kind: event.target.kind,
        label: runtimeTargetLabel(event.target),
        data: {
          source: "RuntimeEvent",
          targetKind: event.target.kind,
        },
      });
      connect({
        kind: "Observes",
        source: eventId,
        target: event.target.id,
        label: "observes",
        data: {
          targetKind: event.target.kind,
        },
      });
    }
  }

  return {
    version: 1,
    nodes: Array.from(nodes.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
  };
};

export const describeDevtoolsCausalGraph = (
  input: DevtoolsSummaryInput = {},
): DevtoolsCausalGraph => {
  const normalized = normalizeDevtoolsSummaryInput(input);

  return makeDevtoolsCausalGraph({
    snapshot: normalized.snapshot,
    invalidations: normalized.invalidations,
    routePlans: normalized.routePlans,
    requestTraces: normalized.requestTraces,
    requestTraceSummaries: normalized.requestTraceSummaries,
    resources: normalized.resources,
    runtimeEvents: normalized.runtimeEvents,
  });
};
