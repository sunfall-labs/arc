import { Effect } from "effect";
import { makeDevtoolsCausalGraph } from "./causal-graph.js";
import {
  appGraphCollectionDefinitions,
  appGraphUnknownRoutePreloadCollections,
  graphSummary,
} from "./summary-app-graph.js";
import { normalizeDevtoolsSummaryInput } from "./summary-facts.js";
import type { DevtoolsSummary, DevtoolsSummaryInput } from "./devtools-contract.js";

export { describeDevtoolsCausalGraph, describeDevtoolsCausalGraphEffect } from "./causal-graph.js";

const stateCounts = (
  entries: Iterable<{ readonly state: string }>,
): ReadonlyArray<{ readonly state: string; readonly count: number }> => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => ({ state, count }));
};

/** Projects snapshots, app graph facts, traces, and events into a stable Devtools summary. */
export const describeDevtoolsSummary = (input: DevtoolsSummaryInput = {}): DevtoolsSummary => {
  const normalized = normalizeDevtoolsSummaryInput(input);
  const causalGraph = makeDevtoolsCausalGraph({
    appGraph: normalized.appGraph,
    snapshot: normalized.snapshot,
    invalidations: normalized.invalidations,
    routePlans: normalized.routePlans,
    requestTraces: normalized.requestTraces,
    requestTraceSummaries: normalized.requestTraceSummaries,
    resources: normalized.resources,
    runtimeEvents: normalized.runtimeEvents,
  });

  return {
    version: 1,
    overview: {
      routeCount: normalized.appGraph?.routeCount ?? 0,
      serverFunctionCount: normalized.appGraph?.serverFunctionCount ?? 0,
      actionCount: normalized.appGraph?.actionCount ?? 0,
      resourceFamilyCount: normalized.appGraph?.resourceFamilies.length ?? 0,
      resourceTagCount: normalized.appGraph?.resourceTags.length ?? 0,
      collectionDefinitionCount: normalized.appGraph
        ? appGraphCollectionDefinitions(normalized.appGraph).length
        : 0,
      runtimeResourceCount: normalized.snapshot.resources.length,
      runtimeActionCount: normalized.snapshot.actions.length,
      invalidationPlanCount: normalized.invalidations.length,
      routePlanCount: normalized.routePlans.length,
      requestTraceCount: normalized.requestTraceSummaries.length,
      runtimeEventCount: normalized.runtimeEvents.length,
      missingSchemaCount: normalized.appGraph?.missingSchemas.length ?? 0,
      unknownActionBehaviorCount: normalized.appGraph?.unknownActionBehavior.length ?? 0,
      unknownRoutePreloadResourcesCount:
        normalized.appGraph?.unknownRoutePreloadResources.length ?? 0,
      unknownRoutePreloadCollectionsCount: normalized.appGraph
        ? appGraphUnknownRoutePreloadCollections(normalized.appGraph).length
        : 0,
      notFoundRoutePlanCount: normalized.routePlans.filter((plan) => plan._tag === "NotFound")
        .length,
      causalNodeCount: causalGraph.nodes.length,
      causalEdgeCount: causalGraph.edges.length,
    },
    graph: graphSummary(normalized.appGraph, { preserveDerivedPreloadFacts: true }),
    runtime: {
      resources: normalized.snapshot.resources.map((resource) => ({ ...resource })),
      actions: normalized.snapshot.actions.map((action) => ({
        name: action.name,
        state: action.state,
        invalidationIndexes: [...(action.invalidationIndexes ?? [])],
      })),
      events: normalized.runtimeEvents,
      resourceStates: stateCounts(normalized.snapshot.resources),
      actionStates: stateCounts(normalized.snapshot.actions),
    },
    invalidations: {
      plans: normalized.invalidations,
    },
    routes: {
      plans: normalized.routePlans,
      notFoundHrefs: normalized.routePlans.flatMap((plan) =>
        plan._tag === "NotFound" ? [plan.href] : [],
      ),
    },
    requests: {
      traces: normalized.requestTraceSummaries,
    },
    resources: normalized.resources,
    causalGraph,
  };
};

/** Effect wrapper for `describeDevtoolsSummary(...)`. */
export const describeDevtoolsSummaryEffect = (
  input: DevtoolsSummaryInput = {},
): Effect.Effect<DevtoolsSummary> => Effect.sync(() => describeDevtoolsSummary(input));
