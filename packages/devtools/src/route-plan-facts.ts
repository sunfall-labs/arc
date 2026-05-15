import {
  devtoolsResourceNodeId as resourceNodeId,
  devtoolsRouteNodeId as routeNodeId,
  devtoolsRoutePlanNodeId as routePlanNodeId
} from "./graph-ids.js";
import type {
  DevtoolsCausalEdge,
  DevtoolsCausalNode,
  DevtoolsSummaryRoutePlan
} from "./index.js";

export interface DevtoolsRoutePlanFactSink {
  addNode(node: DevtoolsCausalNode): void;
  connect(edge: Omit<DevtoolsCausalEdge, "id">): void;
}

export interface DevtoolsRoutePlanFacts {
  readonly routePlanId: string;
}

/**
 * Projects a summarized route plan into causal graph facts.
 *
 * Standalone route plans and request-embedded route plans share the same route,
 * preload, and hydration semantics; callers only add source-specific edges.
 */
export const projectDevtoolsRoutePlanFacts = (
  plan: DevtoolsSummaryRoutePlan,
  sink: DevtoolsRoutePlanFactSink
): DevtoolsRoutePlanFacts => {
  const routePlanId = routePlanNodeId(plan.index, plan.href);
  sink.addNode({
    id: routePlanId,
    kind: "RoutePlan",
    label: plan.href,
    data: {
      href: plan.href,
      hydrationResourceCount: plan.hydrationResourceCount,
      hydratedResourceKeys: plan.hydratedResourceKeys,
      params: plan.params,
      path: plan.path,
      resourceCount: plan.resourceCount,
      search: plan.search,
      tag: plan._tag
    }
  });

  if (plan.path !== null) {
    const routeId = routeNodeId(plan.path);
    sink.addNode({
      id: routeId,
      kind: "Route",
      label: plan.path,
      data: { path: plan.path }
    });
    sink.connect({
      kind: "Matches",
      source: routePlanId,
      target: routeId,
      label: "matches",
      data: {
        href: plan.href
      }
    });
  }

  const hydratedKeys = new Set(plan.hydratedResourceKeys);
  for (const resource of plan.resources) {
    const targetId = resourceNodeId(resource.key);
    sink.addNode({
      id: targetId,
      kind: "Resource",
      label: resource.family,
      data: {
        family: resource.family,
        input: resource.input,
        key: resource.key,
        state: null
      }
    });
    sink.connect({
      kind: "Preloads",
      source: routePlanId,
      target: targetId,
      label: "preloads",
      data: {
        href: plan.href
      }
    });
    if (hydratedKeys.has(resource.key)) {
      sink.connect({
        kind: "Hydrates",
        source: routePlanId,
        target: targetId,
        label: "hydrates",
        data: {
          href: plan.href
        }
      });
    }
  }

  return { routePlanId };
};
