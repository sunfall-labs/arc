import {
  devtoolsActionNodeId,
  devtoolsCollectionNodeId,
  devtoolsMissingSchemaPanelItemId,
  devtoolsRequestPanelItemId,
  devtoolsResourceNodeId,
  devtoolsRoutePanelItemId,
  devtoolsRoutePlanPanelItemId,
  devtoolsUnknownActionPanelItemId,
  devtoolsUnknownRoutePreloadCollectionsPanelItemId,
  devtoolsUnknownRoutePreloadResourcesPanelItemId
} from "./graph-ids.js";
import type {
  DevtoolsPanelItem,
  DevtoolsPanelMetric,
  DevtoolsPanelSeverity,
  DevtoolsPanels,
  DevtoolsPanelsInput,
  DevtoolsSerializableValue,
  DevtoolsSummary,
  DevtoolsSummaryInput,
  DevtoolsSummaryRequestTrace
} from "./index.js";

export interface DevtoolsPanelsRuntime {
  readonly describeSummary: (input: DevtoolsSummaryInput) => DevtoolsSummary;
  readonly toSerializableValue: (value: unknown) => DevtoolsSerializableValue;
}

const panelMetric = (
  label: string,
  value: string | number,
  unit?: string
): DevtoolsPanelMetric => ({
  label,
  value,
  ...(unit === undefined ? {} : { unit })
});

const panelItem = (options: {
  readonly id: string;
  readonly label: string;
  readonly severity?: DevtoolsPanelSeverity;
  readonly detail?: string;
  readonly metrics?: ReadonlyArray<DevtoolsPanelMetric>;
  readonly data?: DevtoolsSerializableValue;
}): DevtoolsPanelItem => ({
  id: options.id,
  label: options.label,
  severity: options.severity ?? "ok",
  ...(options.detail === undefined ? {} : { detail: options.detail }),
  ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
  ...(options.data === undefined ? {} : { data: options.data })
});

const severityRank: Record<DevtoolsPanelSeverity, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  error: 3
};

const maxSeverity = (
  severities: ReadonlyArray<DevtoolsPanelSeverity>,
  fallback: DevtoolsPanelSeverity = "ok"
): DevtoolsPanelSeverity =>
  severities.reduce(
    (current, next) => severityRank[next] > severityRank[current] ? next : current,
    fallback
  );

const requestTraceSeverity = (
  trace: DevtoolsSummaryRequestTrace
): DevtoolsPanelSeverity => {
  if (trace.status === "failure") {
    return "error";
  }
  if (trace.status === "cancelled" || trace.runtimeDisposed === false) {
    return "warning";
  }
  return "ok";
};

const diagnosticsSeverity = (summary: DevtoolsSummary): DevtoolsPanelSeverity => {
  if (summary.overview.missingSchemaCount > 0) {
    return "error";
  }
  return summary.overview.unknownActionBehaviorCount > 0 ||
    summary.overview.unknownRoutePreloadResourcesCount > 0 ||
    summary.overview.unknownRoutePreloadCollectionsCount > 0
    ? "warning"
    : "ok";
};

export const describeDevtoolsPanelsWithRuntime = (
  input: DevtoolsPanelsInput,
  runtime: DevtoolsPanelsRuntime
): DevtoolsPanels => {
  const summary = input.summary ?? runtime.describeSummary(input);
  const graphAvailable = summary.graph._tag === "Available";
  const diagnosticsPanelSeverity = diagnosticsSeverity(summary);
  const requestDurations = summary.requests.traces.flatMap((trace) =>
    trace.durationMillis === null ? [] : [trace.durationMillis]
  );
  const requestAverageDuration = requestDurations.length === 0
    ? 0
    : Number((requestDurations.reduce((total, duration) => total + duration, 0) / requestDurations.length).toFixed(2));
  const failedRequestCount = summary.requests.traces.filter((trace) => trace.status === "failure").length;
  const cancelledRequestCount = summary.requests.traces.filter((trace) => trace.status === "cancelled").length;

  return {
    version: 1,
    panels: [
      {
        id: "app-graph",
        title: "App Graph",
        summary: graphAvailable
          ? `${summary.overview.routeCount} routes, ${summary.overview.serverFunctionCount} server functions, ${summary.overview.actionCount} actions`
          : "No app graph diagnostics recorded",
        severity: graphAvailable ? diagnosticsPanelSeverity : "info",
        metrics: [
          panelMetric("routes", summary.overview.routeCount),
          panelMetric("server functions", summary.overview.serverFunctionCount),
          panelMetric("actions", summary.overview.actionCount),
          panelMetric("resource families", summary.overview.resourceFamilyCount),
          panelMetric("collections", summary.overview.collectionDefinitionCount)
        ],
        items: graphAvailable
          ? summary.graph.routes.modules.map((routeModule) =>
              panelItem({
                id: devtoolsRoutePanelItemId(routeModule.routeId),
                label: routeModule.routePath,
                detail: routeModule.moduleId,
                severity: routeModule.preloadResources.status === "unknown" ||
                  routeModule.preloadCollections.status === "unknown"
                  ? "warning"
                  : "ok",
                metrics: [
                  panelMetric("params", routeModule.pathParamCount),
                  panelMetric("preload resources", routeModule.preloadResources.status),
                  panelMetric("preload collections", routeModule.preloadCollections.status)
                ]
              })
            )
          : []
      },
      {
        id: "routes",
        title: "Routes",
        summary: `${summary.overview.routePlanCount} route plans, ${summary.overview.notFoundRoutePlanCount} not found`,
        severity: summary.overview.notFoundRoutePlanCount > 0 ? "warning" : summary.overview.routePlanCount === 0 ? "info" : "ok",
        metrics: [
          panelMetric("plans", summary.overview.routePlanCount),
          panelMetric("not found", summary.overview.notFoundRoutePlanCount)
        ],
        items: summary.routes.plans.map((plan) =>
          panelItem({
            id: devtoolsRoutePlanPanelItemId(plan.index),
            label: plan.href,
            detail: plan.path ?? "not found",
            severity: plan._tag === "NotFound" ? "warning" : "ok",
            metrics: [
              panelMetric("resources", plan.resourceCount),
              panelMetric("hydrated", plan.hydrationResourceCount)
            ],
            data: {
              params: plan.params,
              search: plan.search
            }
          })
        )
      },
      {
        id: "resources",
        title: "Resources",
        summary: `${summary.resources.length} indexed resources, ${summary.overview.runtimeResourceCount} runtime resources`,
        severity: summary.resources.length === 0 ? "info" : "ok",
        metrics: [
          panelMetric("indexed", summary.resources.length),
          panelMetric("runtime", summary.overview.runtimeResourceCount),
          panelMetric("families", summary.overview.resourceFamilyCount),
          panelMetric("tags", summary.overview.resourceTagCount)
        ],
        items: summary.resources.map((resource) =>
          panelItem({
            id: devtoolsResourceNodeId(resource.key),
            label: resource.family ?? resource.key,
            detail: resource.state ?? "unknown",
            severity: resource.state === "Failure" ? "error" : "ok",
            metrics: [
              panelMetric("routes", resource.routeHrefs.length),
              panelMetric("invalidations", resource.invalidationIndexes.length)
            ],
            data: {
              key: resource.key,
              input: resource.input,
              sources: resource.sources
            }
          })
        )
      },
      {
        id: "actions",
        title: "Actions",
        summary: `${summary.overview.actionCount} graph actions, ${summary.overview.runtimeActionCount} runtime actions`,
        severity: summary.runtime.actions.some((action) => action.state === "Failure") ? "error" : "ok",
        metrics: [
          panelMetric("graph", summary.overview.actionCount),
          panelMetric("runtime", summary.overview.runtimeActionCount),
          panelMetric("invalidation plans", summary.overview.invalidationPlanCount)
        ],
        items: summary.runtime.actions.map((action) =>
          panelItem({
            id: devtoolsActionNodeId(action.name),
            label: action.name,
            detail: action.state,
            severity: action.state === "Failure" ? "error" : "ok",
            metrics: [
              panelMetric("invalidations", action.invalidationIndexes.length)
            ]
          })
        )
      },
      {
        id: "collections",
        title: "Collections",
        summary: `${summary.overview.collectionDefinitionCount} graph collections`,
        severity: summary.overview.collectionDefinitionCount === 0 ? "info" : "ok",
        metrics: [
          panelMetric("definitions", summary.overview.collectionDefinitionCount),
          panelMetric(
            "traced",
            summary.requests.traces.reduce((count, trace) => count + trace.collectionCount, 0)
          )
        ],
        items: graphAvailable
          ? summary.graph.collections.definitions.map((collection) =>
              panelItem({
                id: devtoolsCollectionNodeId(collection.name),
                label: collection.name,
                severity: "ok"
              })
            )
          : []
      },
      {
        id: "requests",
        title: "Requests",
        summary: `${summary.overview.requestTraceCount} traces, ${failedRequestCount} failures, ${cancelledRequestCount} cancelled`,
        severity: maxSeverity(summary.requests.traces.map(requestTraceSeverity), summary.overview.requestTraceCount === 0 ? "info" : "ok"),
        metrics: [
          panelMetric("traces", summary.overview.requestTraceCount),
          panelMetric("failures", failedRequestCount),
          panelMetric("cancelled", cancelledRequestCount),
          panelMetric("average duration", requestAverageDuration, "ms")
        ],
        items: summary.requests.traces.map((trace) =>
          panelItem({
            id: devtoolsRequestPanelItemId(trace),
            label: `${trace.method} ${trace.path}`,
            detail: `${trace.transport} ${trace.status}${trace.failureKind === null ? "" : ` (${trace.failureKind})`}`,
            severity: requestTraceSeverity(trace),
            metrics: [
              panelMetric("resources", trace.resourceCount),
              panelMetric("collections", trace.collectionCount),
              panelMetric("actions", trace.actionCount),
              panelMetric("duration", trace.durationMillis ?? "unknown", trace.durationMillis === null ? undefined : "ms"),
              panelMetric("before fibers", trace.beforeDisposeFiberCount ?? "unknown"),
              panelMetric("after fibers", trace.afterDisposeFiberCount ?? "unknown")
            ],
            data: {
              id: trace.id,
              failureKind: trace.failureKind,
              routeHref: trace.routeHref,
              teardownReason: trace.teardownReason,
              runtimeDisposed: trace.runtimeDisposed
            }
          })
        )
      },
      {
        id: "diagnostics",
        title: "Diagnostics",
        summary: `${summary.overview.missingSchemaCount} missing schemas, ${summary.overview.unknownActionBehaviorCount} unknown action behaviors`,
        severity: diagnosticsPanelSeverity,
        metrics: [
          panelMetric("missing schemas", summary.overview.missingSchemaCount),
          panelMetric("unknown action behavior", summary.overview.unknownActionBehaviorCount),
          panelMetric("unknown preload resources", summary.overview.unknownRoutePreloadResourcesCount),
          panelMetric("unknown preload collections", summary.overview.unknownRoutePreloadCollectionsCount)
        ],
        items: graphAvailable
          ? [
              ...summary.graph.missingSchemas.map((schema) =>
                panelItem({
                  id: devtoolsMissingSchemaPanelItemId(schema),
                  label: schema.name,
                  detail: schema.kind,
                  severity: "error",
                  data: runtime.toSerializableValue(schema)
                })
              ),
              ...summary.graph.actions.unknownBehavior.map((entry) =>
                panelItem({
                  id: devtoolsUnknownActionPanelItemId(entry.name),
                  label: entry.name,
                  detail: "unknown action behavior",
                  severity: "warning",
                  data: runtime.toSerializableValue(entry)
                })
              ),
              ...summary.graph.routes.unknownPreloadResources.map((entry) =>
                panelItem({
                  id: devtoolsUnknownRoutePreloadResourcesPanelItemId(entry.routeId),
                  label: entry.routePath,
                  detail: "unknown preload resources",
                  severity: "warning",
                  data: runtime.toSerializableValue(entry)
                })
              ),
              ...summary.graph.routes.unknownPreloadCollections.map((entry) =>
                panelItem({
                  id: devtoolsUnknownRoutePreloadCollectionsPanelItemId(entry.routeId),
                  label: entry.routePath,
                  detail: "unknown preload collections",
                  severity: "warning",
                  data: runtime.toSerializableValue(entry)
                })
              )
            ]
          : []
      },
      {
        id: "causal-graph",
        title: "Causal Graph",
        summary: `${summary.overview.causalNodeCount} nodes, ${summary.overview.causalEdgeCount} edges`,
        severity: summary.overview.causalNodeCount === 0 ? "info" : "ok",
        metrics: [
          panelMetric("nodes", summary.overview.causalNodeCount),
          panelMetric("edges", summary.overview.causalEdgeCount)
        ],
        items: summary.causalGraph.nodes.map((node) =>
          panelItem({
            id: node.id,
            label: node.label,
            detail: node.kind,
            severity: "ok",
            data: node.data
          })
        )
      }
    ]
  };
};
