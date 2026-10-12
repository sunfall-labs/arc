import { makeDevtoolsCausalGraph } from "./causal-graph.js";
import { normalizeDevtoolsSummaryInput } from "./summary-facts.js";
import type { DevtoolsSummary, DevtoolsSummaryInput } from "./devtools-contract.js";

export { describeDevtoolsCausalGraph } from "./causal-graph.js";

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

/** Projects snapshots, traces, and events into a stable Devtools summary. */
export const describeDevtoolsSummary = (input: DevtoolsSummaryInput = {}): DevtoolsSummary => {
  const normalized = normalizeDevtoolsSummaryInput(input);
  const causalGraph = makeDevtoolsCausalGraph({
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
      runtimeResourceCount: normalized.snapshot.resources.length,
      runtimeActionCount: normalized.snapshot.actions.length,
      invalidationPlanCount: normalized.invalidations.length,
      routePlanCount: normalized.routePlans.length,
      requestTraceCount: normalized.requestTraceSummaries.length,
      runtimeEventCount: normalized.runtimeEvents.length,
      notFoundRoutePlanCount: normalized.routePlans.filter((plan) => plan._tag === "NotFound")
        .length,
      causalNodeCount: causalGraph.nodes.length,
      causalEdgeCount: causalGraph.edges.length,
    },
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
