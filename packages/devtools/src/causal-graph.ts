import {
  devtoolsActionNodeId as actionNodeId,
  devtoolsCausalEdgeId as causalEdgeId,
  devtoolsInvalidationNodeId as invalidationNodeId,
  devtoolsInvalidationTargetNodeId as targetNodeId,
  devtoolsResourceNodeId as resourceNodeId,
  devtoolsRuntimeEventNodeId as runtimeEventNodeId,
  devtoolsRuntimeTargetLabel as runtimeTargetLabel,
} from "./graph-ids.js";
import { toDevtoolsSerializableValue } from "./serialization.js";
import { projectDevtoolsRoutePlanFacts } from "./route-plan-facts.js";
import { normalizeDevtoolsSummaryInput } from "./summary-facts.js";
import type {
  DevtoolsCausalEdge,
  DevtoolsCausalGraph,
  DevtoolsCausalNode,
  DevtoolsSnapshot,
  DevtoolsSummaryInput,
  DevtoolsSummaryInvalidationPlan,
  DevtoolsSummaryResource,
  DevtoolsSummaryRoutePlan,
  DevtoolsSummaryRuntimeEvent,
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

interface DevtoolsCausalGraphInput {
  readonly snapshot: DevtoolsSnapshot;
  readonly invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>;
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
    resources: normalized.resources,
    runtimeEvents: normalized.runtimeEvents,
  });
};
