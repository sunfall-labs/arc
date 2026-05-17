import {
  devtoolsActionNodeId,
  devtoolsCollectionNodeId,
  devtoolsMissingSchemaPanelItemId,
  devtoolsProgramPanelItemId,
  devtoolsRequestPanelItemId,
  devtoolsResourceNodeId,
  devtoolsRoutePanelItemId,
  devtoolsRoutePlanPanelItemId,
  devtoolsUnknownActionPanelItemId,
  devtoolsUnknownRoutePreloadCollectionsPanelItemId,
  devtoolsUnknownRoutePreloadResourcesPanelItemId,
} from "./graph-ids.js";
import { toDevtoolsSerializableValue } from "./serialization.js";
import { describeDevtoolsSummary } from "./summary.js";
import type {
  DevtoolsPanel,
  DevtoolsPanelId,
  DevtoolsPanelItem,
  DevtoolsPanelMetric,
  DevtoolsPanelSeverity,
  DevtoolsPanels,
  DevtoolsPanelsInput,
  DevtoolsSerializableValue,
  DevtoolsSummary,
  DevtoolsSummaryRequestTrace,
} from "./devtools-contract.js";
import { devtoolsPanelIds } from "./panel-contract.js";
import { routeModulePreloadCollections } from "./summary-app-graph.js";

const panelMetric = (
  label: string,
  value: string | number,
  unit?: string,
): DevtoolsPanelMetric => ({
  label,
  value,
  ...(unit === undefined ? {} : { unit }),
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
  ...(options.data === undefined ? {} : { data: options.data }),
});

const severityRank: Record<DevtoolsPanelSeverity, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  error: 3,
};

const maxSeverity = (
  severities: ReadonlyArray<DevtoolsPanelSeverity>,
  fallback: DevtoolsPanelSeverity = "ok",
): DevtoolsPanelSeverity =>
  severities.reduce(
    (current, next) => (severityRank[next] > severityRank[current] ? next : current),
    fallback,
  );

const requestTraceSeverity = (trace: DevtoolsSummaryRequestTrace): DevtoolsPanelSeverity => {
  if (trace.status === "failure") {
    return "error";
  }
  if (trace.status === "cancelled" || trace.runtimeDisposed === false) {
    return "warning";
  }
  return "ok";
};

const requestTraceFailureOwners = (trace: DevtoolsSummaryRequestTrace): ReadonlyArray<string> => [
  ...trace.serverFunctions.flatMap((entry) =>
    entry.failureKind === null ? [] : [`server:${entry.name}:${entry.failureKind}`],
  ),
  ...trace.actions.flatMap((entry) =>
    entry.failureKind === null ? [] : [`action:${entry.name}:${entry.failureKind}`],
  ),
];

const requestTraceDetail = (trace: DevtoolsSummaryRequestTrace): string => {
  const status = `${trace.transport} ${trace.status}${trace.failureKind === null ? "" : ` (${trace.failureKind})`}`;
  const failureOwners = requestTraceFailureOwners(trace);
  return failureOwners.length === 0 ? status : `${status} ${failureOwners.join(", ")}`;
};

const programEventSeverity = (tag: string): DevtoolsPanelSeverity =>
  tag.endsWith("Failed") ? "error" : tag === "Disposed" ? "info" : "ok";

const isSerializableRecord = (
  value: DevtoolsSerializableValue,
): value is { readonly [key: string]: DevtoolsSerializableValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const programEventMetricValue = (
  value: DevtoolsSerializableValue | undefined,
): string | number | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined;

const programEventMetrics = (
  event: DevtoolsSummary["runtime"]["events"][number],
): ReadonlyArray<DevtoolsPanelMetric> => {
  if (!isSerializableRecord(event.data)) {
    return [panelMetric("sequence", event.sequence)];
  }

  const commandCount = programEventMetricValue(event.data.commandCount);
  const commandId = programEventMetricValue(event.data.commandId);
  const subscriptionCount = programEventMetricValue(event.data.count);
  return [
    panelMetric("sequence", programEventMetricValue(event.data.sequence) ?? event.sequence),
    ...(commandCount === undefined ? [] : [panelMetric("commands", commandCount)]),
    ...(commandId === undefined ? [] : [panelMetric("command", commandId)]),
    ...(subscriptionCount === undefined ? [] : [panelMetric("subscriptions", subscriptionCount)]),
  ];
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

export const describeDevtoolsPanels = (input: DevtoolsPanelsInput = {}): DevtoolsPanels => {
  const summary = input.summary ?? describeDevtoolsSummary(input);
  const graphAvailable = summary.graph._tag === "Available";
  const diagnosticsPanelSeverity = diagnosticsSeverity(summary);
  const requestDurations = summary.requests.traces.flatMap((trace) =>
    trace.durationMillis === null ? [] : [trace.durationMillis],
  );
  const requestAverageDuration =
    requestDurations.length === 0
      ? 0
      : Number(
          (
            requestDurations.reduce((total, duration) => total + duration, 0) /
            requestDurations.length
          ).toFixed(2),
        );
  const failedRequestCount = summary.requests.traces.filter(
    (trace) => trace.status === "failure",
  ).length;
  const cancelledRequestCount = summary.requests.traces.filter(
    (trace) => trace.status === "cancelled",
  ).length;
  const collectionRuntimeEvents = new Map<
    string,
    {
      count: number;
      latest: string;
      severity: DevtoolsPanelSeverity;
    }
  >();
  for (const event of summary.runtime.events) {
    if (event.target?.kind !== "Collection") {
      continue;
    }
    const data = event.data as { readonly collection?: unknown };
    const name =
      typeof data.collection === "string"
        ? data.collection
        : event.target.id.replace(/^collection:/, "");
    const severity: DevtoolsPanelSeverity =
      event.label.includes("Failure") || event.label.includes("RolledBack") ? "error" : "ok";
    const existing = collectionRuntimeEvents.get(name);
    collectionRuntimeEvents.set(name, {
      count: (existing?.count ?? 0) + 1,
      latest: event.label,
      severity: existing === undefined ? severity : maxSeverity([existing.severity, severity]),
    });
  }
  const graphCollectionNames = new Set(
    graphAvailable
      ? summary.graph.collections.definitions.map((collection) => collection.name)
      : [],
  );
  const collectionItems = [
    ...(graphAvailable
      ? summary.graph.collections.definitions.map((collection) => {
          const runtimeEvents = collectionRuntimeEvents.get(collection.name);
          return panelItem({
            id: devtoolsCollectionNodeId(collection.name),
            label: collection.name,
            severity: runtimeEvents?.severity ?? "ok",
            ...(runtimeEvents === undefined
              ? {}
              : {
                  detail: runtimeEvents.latest,
                  metrics: [panelMetric("events", runtimeEvents.count)],
                }),
          });
        })
      : []),
    ...Array.from(collectionRuntimeEvents.entries())
      .filter(([name]) => !graphCollectionNames.has(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, runtimeEvents]) =>
        panelItem({
          id: devtoolsCollectionNodeId(name),
          label: name,
          detail: runtimeEvents.latest,
          severity: runtimeEvents.severity,
          metrics: [panelMetric("events", runtimeEvents.count)],
        }),
      ),
  ];
  const programRuntimeEvents = new Map<
    string,
    {
      count: number;
      failures: number;
      latest: string;
      messages: number;
      severity: DevtoolsPanelSeverity;
      tags: Set<string>;
    }
  >();
  for (const event of summary.runtime.events) {
    if (event.target?.kind !== "Program") {
      continue;
    }
    const name = event.target.id.startsWith("program:")
      ? event.target.id.slice("program:".length)
      : event.target.id;
    const data = event.data as { readonly _tag?: unknown };
    const tag = typeof data._tag === "string" ? data._tag : "ProgramEvent";
    const severity = programEventSeverity(tag);
    const existing = programRuntimeEvents.get(name);
    const tags = existing?.tags ?? new Set<string>();
    tags.add(tag);
    programRuntimeEvents.set(name, {
      count: (existing?.count ?? 0) + 1,
      failures: (existing?.failures ?? 0) + (severity === "error" ? 1 : 0),
      latest: event.label,
      messages: (existing?.messages ?? 0) + (tag === "Message" ? 1 : 0),
      severity: existing === undefined ? severity : maxSeverity([existing.severity, severity]),
      tags,
    });
  }
  const programEventItems = summary.runtime.events
    .filter((event) => event.target?.kind === "Program")
    .map((event) => {
      const data = isSerializableRecord(event.data) ? event.data : {};
      const tag = typeof data._tag === "string" ? data._tag : "ProgramEvent";
      const programName = event.target?.id.startsWith("program:")
        ? event.target.id.slice("program:".length)
        : (event.target?.id ?? "Program");
      return panelItem({
        id: devtoolsProgramPanelItemId(event.id),
        label: event.label,
        detail: `${programName} ${tag}`,
        severity: programEventSeverity(tag),
        metrics: programEventMetrics(event),
        data: event.data,
      });
    });
  const programSummaryItems = Array.from(programRuntimeEvents.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, runtimeEvents]) =>
      panelItem({
        id: `program-summary:${name}`,
        label: name,
        detail: runtimeEvents.latest,
        severity: runtimeEvents.severity,
        metrics: [
          panelMetric("events", runtimeEvents.count),
          panelMetric("messages", runtimeEvents.messages),
          panelMetric("failures", runtimeEvents.failures),
        ],
        data: toDevtoolsSerializableValue({
          tags: Array.from(runtimeEvents.tags).sort(),
        }),
      }),
    );
  const programItems = [...programEventItems, ...programSummaryItems];
  const programEventCount = Array.from(programRuntimeEvents.values()).reduce(
    (count, entry) => count + entry.count,
    0,
  );
  const programFailureCount = Array.from(programRuntimeEvents.values()).reduce(
    (count, entry) => count + entry.failures,
    0,
  );

  const panelsById = {
    "app-graph": {
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
        panelMetric("collections", summary.overview.collectionDefinitionCount),
      ],
      items: graphAvailable
        ? summary.graph.routes.modules.map((routeModule) => {
            const preloadCollections = routeModulePreloadCollections(routeModule);
            return panelItem({
              id: devtoolsRoutePanelItemId(routeModule.routeId),
              label: routeModule.routePath,
              detail: routeModule.moduleId,
              severity:
                routeModule.preload === "present" &&
                (routeModule.preloadResources.status === "unknown" ||
                  preloadCollections.status === "unknown")
                  ? "warning"
                  : "ok",
              metrics: [
                panelMetric("params", routeModule.pathParamCount),
                panelMetric("preload resources", routeModule.preloadResources.status),
                panelMetric("preload collections", preloadCollections.status),
              ],
            });
          })
        : [],
    },
    routes: {
      id: "routes",
      title: "Routes",
      summary: `${summary.overview.routePlanCount} route plans, ${summary.overview.notFoundRoutePlanCount} not found`,
      severity:
        summary.overview.notFoundRoutePlanCount > 0
          ? "warning"
          : summary.overview.routePlanCount === 0
            ? "info"
            : "ok",
      metrics: [
        panelMetric("plans", summary.overview.routePlanCount),
        panelMetric("not found", summary.overview.notFoundRoutePlanCount),
      ],
      items: summary.routes.plans.map((plan) =>
        panelItem({
          id: devtoolsRoutePlanPanelItemId(plan.index),
          label: plan.href,
          detail: plan.path ?? "not found",
          severity: plan._tag === "NotFound" ? "warning" : "ok",
          metrics: [
            panelMetric("resources", plan.resourceCount),
            panelMetric("hydrated", plan.hydrationResourceCount),
          ],
          data: {
            params: plan.params,
            search: plan.search,
          },
        }),
      ),
    },
    resources: {
      id: "resources",
      title: "Resources",
      summary: `${summary.resources.length} indexed resources, ${summary.overview.runtimeResourceCount} runtime resources`,
      severity: summary.resources.length === 0 ? "info" : "ok",
      metrics: [
        panelMetric("indexed", summary.resources.length),
        panelMetric("runtime", summary.overview.runtimeResourceCount),
        panelMetric("families", summary.overview.resourceFamilyCount),
        panelMetric("tags", summary.overview.resourceTagCount),
      ],
      items: summary.resources.map((resource) =>
        panelItem({
          id: devtoolsResourceNodeId(resource.key),
          label: resource.family ?? resource.key,
          detail: resource.state ?? "unknown",
          severity: resource.state === "Failure" ? "error" : "ok",
          metrics: [
            panelMetric("routes", resource.routeHrefs.length),
            panelMetric("invalidations", resource.invalidationIndexes.length),
          ],
          data: {
            key: resource.key,
            input: resource.input,
            sources: resource.sources,
          },
        }),
      ),
    },
    actions: {
      id: "actions",
      title: "Actions",
      summary: `${summary.overview.actionCount} graph actions, ${summary.overview.runtimeActionCount} runtime actions`,
      severity: summary.runtime.actions.some((action) => action.state === "Failure")
        ? "error"
        : "ok",
      metrics: [
        panelMetric("graph", summary.overview.actionCount),
        panelMetric("runtime", summary.overview.runtimeActionCount),
        panelMetric("invalidation plans", summary.overview.invalidationPlanCount),
      ],
      items: summary.runtime.actions.map((action) =>
        panelItem({
          id: devtoolsActionNodeId(action.name),
          label: action.name,
          detail: action.state,
          severity: action.state === "Failure" ? "error" : "ok",
          metrics: [panelMetric("invalidations", action.invalidationIndexes.length)],
        }),
      ),
    },
    programs: {
      id: "programs",
      title: "Programs",
      summary: `${programRuntimeEvents.size} programs, ${programEventCount} events`,
      severity: maxSeverity(
        programItems.map((item) => item.severity),
        programItems.length === 0 ? "info" : "ok",
      ),
      metrics: [
        panelMetric("programs", programRuntimeEvents.size),
        panelMetric("events", programEventCount),
        panelMetric("failures", programFailureCount),
      ],
      items: programItems,
    },
    collections: {
      id: "collections",
      title: "Collections",
      summary: `${summary.overview.collectionDefinitionCount} graph collections, ${collectionRuntimeEvents.size} runtime collections`,
      severity: maxSeverity(
        collectionItems.map((item) => item.severity),
        collectionItems.length === 0 ? "info" : "ok",
      ),
      metrics: [
        panelMetric("definitions", summary.overview.collectionDefinitionCount),
        panelMetric("runtime", collectionRuntimeEvents.size),
        panelMetric(
          "traced",
          summary.requests.traces.reduce((count, trace) => count + trace.collectionCount, 0),
        ),
      ],
      items: collectionItems,
    },
    requests: {
      id: "requests",
      title: "Requests",
      summary: `${summary.overview.requestTraceCount} traces, ${failedRequestCount} failures, ${cancelledRequestCount} cancelled`,
      severity: maxSeverity(
        summary.requests.traces.map(requestTraceSeverity),
        summary.overview.requestTraceCount === 0 ? "info" : "ok",
      ),
      metrics: [
        panelMetric("traces", summary.overview.requestTraceCount),
        panelMetric("failures", failedRequestCount),
        panelMetric("cancelled", cancelledRequestCount),
        panelMetric("average duration", requestAverageDuration, "ms"),
      ],
      items: summary.requests.traces.map((trace) =>
        panelItem({
          id: devtoolsRequestPanelItemId(trace),
          label: `${trace.method} ${trace.path}`,
          detail: requestTraceDetail(trace),
          severity: requestTraceSeverity(trace),
          metrics: [
            panelMetric("resources", trace.resourceCount),
            panelMetric("collections", trace.collectionCount),
            panelMetric(
              "server failures",
              trace.serverFunctions.filter((entry) => entry.failureKind !== null).length,
            ),
            panelMetric(
              "action failures",
              trace.actions.filter((entry) => entry.failureKind !== null).length,
            ),
            panelMetric("actions", trace.actionCount),
            panelMetric(
              "duration",
              trace.durationMillis ?? "unknown",
              trace.durationMillis === null ? undefined : "ms",
            ),
            panelMetric("before fibers", trace.beforeDisposeFiberCount ?? "unknown"),
            panelMetric("after fibers", trace.afterDisposeFiberCount ?? "unknown"),
            panelMetric("before families", trace.beforeDispose?.familyCount ?? "unknown"),
            panelMetric("after families", trace.afterDispose?.familyCount ?? "unknown"),
            panelMetric("before modules", trace.beforeDispose?.moduleCount ?? "unknown"),
            panelMetric("after modules", trace.afterDispose?.moduleCount ?? "unknown"),
            panelMetric("before tags", trace.beforeDispose?.tagCount ?? "unknown"),
            panelMetric("after tags", trace.afterDispose?.tagCount ?? "unknown"),
          ],
          data: toDevtoolsSerializableValue({
            id: trace.id,
            failureKind: trace.failureKind,
            routeHref: trace.routeHref,
            teardownReason: trace.teardownReason,
            runtimeDisposed: trace.runtimeDisposed,
            teardownAt: trace.teardownAt,
            teardownStartedAt: trace.teardownStartedAt,
            teardownCompletedAt: trace.teardownCompletedAt,
            durationMillis: trace.durationMillis,
            beforeDispose: trace.beforeDispose,
            afterDispose: trace.afterDispose,
            cleanupFailure: trace.cleanupFailure,
            serverFunctions: trace.serverFunctions,
            actions: trace.actions,
          }),
        }),
      ),
    },
    diagnostics: {
      id: "diagnostics",
      title: "Diagnostics",
      summary: `${summary.overview.missingSchemaCount} missing schemas, ${summary.overview.unknownActionBehaviorCount} unknown action behaviors`,
      severity: diagnosticsPanelSeverity,
      metrics: [
        panelMetric("missing schemas", summary.overview.missingSchemaCount),
        panelMetric("unknown action behavior", summary.overview.unknownActionBehaviorCount),
        panelMetric(
          "unknown preload resources",
          summary.overview.unknownRoutePreloadResourcesCount,
        ),
        panelMetric(
          "unknown preload collections",
          summary.overview.unknownRoutePreloadCollectionsCount,
        ),
      ],
      items: graphAvailable
        ? [
            ...summary.graph.missingSchemas.map((schema) =>
              panelItem({
                id: devtoolsMissingSchemaPanelItemId(schema),
                label: schema.name,
                detail: schema.kind,
                severity: "error",
                data: toDevtoolsSerializableValue(schema),
              }),
            ),
            ...summary.graph.actions.unknownBehavior.map((entry) =>
              panelItem({
                id: devtoolsUnknownActionPanelItemId(entry.name),
                label: entry.name,
                detail: "unknown action behavior",
                severity: "warning",
                data: toDevtoolsSerializableValue(entry),
              }),
            ),
            ...summary.graph.routes.unknownPreloadResources.map((entry) =>
              panelItem({
                id: devtoolsUnknownRoutePreloadResourcesPanelItemId(entry.routeId),
                label: entry.routePath,
                detail: "unknown preload resources",
                severity: "warning",
                data: toDevtoolsSerializableValue(entry),
              }),
            ),
            ...summary.graph.routes.unknownPreloadCollections.map((entry) =>
              panelItem({
                id: devtoolsUnknownRoutePreloadCollectionsPanelItemId(entry.routeId),
                label: entry.routePath,
                detail: "unknown preload collections",
                severity: "warning",
                data: toDevtoolsSerializableValue(entry),
              }),
            ),
          ]
        : [],
    },
    "causal-graph": {
      id: "causal-graph",
      title: "Causal Graph",
      summary: `${summary.overview.causalNodeCount} nodes, ${summary.overview.causalEdgeCount} edges`,
      severity: summary.overview.causalNodeCount === 0 ? "info" : "ok",
      metrics: [
        panelMetric("nodes", summary.overview.causalNodeCount),
        panelMetric("edges", summary.overview.causalEdgeCount),
      ],
      items: summary.causalGraph.nodes.map((node) =>
        panelItem({
          id: node.id,
          label: node.label,
          detail: node.kind,
          severity: "ok",
          data: node.data,
        }),
      ),
    },
  } satisfies Record<DevtoolsPanelId, DevtoolsPanel>;

  return {
    version: 1,
    panels: devtoolsPanelIds.map((id) => panelsById[id]),
  };
};
