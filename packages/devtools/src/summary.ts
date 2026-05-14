import { Effect } from "effect";
import {
  describeDevtoolsCausalGraph,
  describeDevtoolsCausalGraphEffect,
  makeDevtoolsCausalGraph
} from "./causal-graph.js";
import {
  appGraphCollectionDefinitions,
  appGraphUnknownRoutePreloadCollections,
  graphSummary
} from "./summary-app-graph.js";
import {
  emptySnapshot,
  resourceIndex,
  summarizeInvalidationPlan,
  summarizeRequestTrace,
  summarizeRoutePlan,
  summarizeRuntimeEvents
} from "./summary-facts.js";
import type {
  DevtoolsSummary,
  DevtoolsSummaryInput
} from "./index.js";

export {
  describeDevtoolsCausalGraph,
  describeDevtoolsCausalGraphEffect
} from "./causal-graph.js";

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

export const describeDevtoolsSummary = (
  input: DevtoolsSummaryInput = {}
): DevtoolsSummary => {
  const snapshot = input.snapshot ?? emptySnapshot();
  const appGraph = input.appGraph ?? snapshot.appGraph;
  const invalidationPlans = input.invalidations ?? snapshot.invalidations;
  const routePlans = input.routePlans ?? snapshot.routePlans;
  const requestTraces = input.requestTraces ?? snapshot.requestTraces ?? [];
  const runtimeEvents = input.runtimeEvents ?? snapshot.events ?? [];
  const invalidations = invalidationPlans.map(summarizeInvalidationPlan);
  const routes = routePlans.map(summarizeRoutePlan);
  const requests = requestTraces.map(summarizeRequestTrace);
  const events = summarizeRuntimeEvents(runtimeEvents);
  const resources = resourceIndex(snapshot, invalidations, routes, requestTraces);
  const causalGraph = makeDevtoolsCausalGraph({
    appGraph,
    snapshot,
    invalidations,
    routePlans: routes,
    requestTraces,
    requestTraceSummaries: requests,
    resources,
    runtimeEvents: events
  });

  return {
    version: 1,
    overview: {
      routeCount: appGraph?.routeCount ?? 0,
      serverFunctionCount: appGraph?.serverFunctionCount ?? 0,
      actionCount: appGraph?.actionCount ?? 0,
      resourceFamilyCount: appGraph?.resourceFamilies.length ?? 0,
      resourceTagCount: appGraph?.resourceTags.length ?? 0,
      collectionDefinitionCount: appGraph ? appGraphCollectionDefinitions(appGraph).length : 0,
      runtimeResourceCount: snapshot.resources.length,
      runtimeActionCount: snapshot.actions.length,
      invalidationPlanCount: invalidations.length,
      routePlanCount: routes.length,
      requestTraceCount: requests.length,
      runtimeEventCount: events.length,
      missingSchemaCount: appGraph?.missingSchemas.length ?? 0,
      unknownActionBehaviorCount: appGraph?.unknownActionBehavior.length ?? 0,
      unknownRoutePreloadResourcesCount: appGraph?.unknownRoutePreloadResources.length ?? 0,
      unknownRoutePreloadCollectionsCount: appGraph ? appGraphUnknownRoutePreloadCollections(appGraph).length : 0,
      notFoundRoutePlanCount: routes.filter((plan) => plan._tag === "NotFound").length,
      causalNodeCount: causalGraph.nodes.length,
      causalEdgeCount: causalGraph.edges.length
    },
    graph: graphSummary(appGraph),
    runtime: {
      resources: snapshot.resources.map((resource) => ({ ...resource })),
      actions: snapshot.actions.map((action) => ({
        name: action.name,
        state: action.state,
        invalidationIndexes: [...(action.invalidationIndexes ?? [])]
      })),
      events,
      resourceStates: stateCounts(snapshot.resources),
      actionStates: stateCounts(snapshot.actions)
    },
    invalidations: {
      plans: invalidations
    },
    routes: {
      plans: routes,
      notFoundHrefs: routes.flatMap((plan) => plan._tag === "NotFound" ? [plan.href] : [])
    },
    requests: {
      traces: requests
    },
    resources,
    causalGraph
  };
};

export const describeDevtoolsSummaryEffect = (
  input: DevtoolsSummaryInput = {}
): Effect.Effect<DevtoolsSummary> =>
  Effect.succeed(describeDevtoolsSummary(input));
