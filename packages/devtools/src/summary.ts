import { type ResourceStoreEvent } from "@effect-ui/core";
import { Effect } from "effect";
import { toDevtoolsSerializableValue } from "./serialization.js";
import type {
  DevtoolsCausalEdge,
  DevtoolsCausalGraph,
  DevtoolsCausalNode,
  DevtoolsCollectionStoreEvent,
  DevtoolsInvalidationPlan,
  DevtoolsInvalidationTarget,
  DevtoolsRequestTrace,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSerializableValue,
  DevtoolsSnapshot,
  DevtoolsStartAppGraphActionBehaviorPresence,
  DevtoolsStartAppGraphActionConcurrency,
  DevtoolsStartAppGraphActionDiagnostics,
  DevtoolsStartAppGraphCollectionDiagnostics,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStartAppGraphMissingSchema,
  DevtoolsStartAppGraphModuleKind,
  DevtoolsStartAppGraphRouteModuleDiagnostics,
  DevtoolsStartAppGraphRoutePreloadCollections,
  DevtoolsStartAppGraphSchemaCoverage,
  DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry,
  DevtoolsSummary,
  DevtoolsSummaryInput,
  DevtoolsSummaryInvalidationCause,
  DevtoolsSummaryInvalidationPlan,
  DevtoolsSummaryInvalidationTarget,
  DevtoolsSummaryRequestTrace,
  DevtoolsSummaryResource,
  DevtoolsSummaryResourceRef,
  DevtoolsSummaryRoutePlan,
  DevtoolsSummaryRuntimeEvent
} from "./index.js";

const emptySnapshot = (): DevtoolsSnapshot => ({
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

const valueCounts = <Value extends string>(
  values: Iterable<Value>
): ReadonlyArray<{ readonly state: Value; readonly count: number }> => {
  const counts = new Map<Value, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => ({ state, count }));
};

const actionBehaviorSummary = (
  actions: readonly DevtoolsStartAppGraphActionDiagnostics[]
): {
  readonly invalidates: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly optimistic: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly retry: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly concurrency: readonly {
    readonly state: DevtoolsStartAppGraphActionConcurrency;
    readonly count: number;
  }[];
} => ({
    invalidates: valueCounts(actions.map((action) => action.behavior.invalidates)),
    optimistic: valueCounts(actions.map((action) => action.behavior.optimistic)),
    retry: valueCounts(actions.map((action) => action.behavior.retry)),
    concurrency: valueCounts(actions.map((action) => action.behavior.concurrency))
  });

const appGraphCollectionDefinitions = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphCollectionDiagnostics[] =>
  (appGraph as { readonly collectionDefinitions?: readonly DevtoolsStartAppGraphCollectionDiagnostics[] })
    .collectionDefinitions ?? [];

const appGraphUnknownRoutePreloadCollections = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] =>
  (appGraph as { readonly unknownRoutePreloadCollections?: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] })
    .unknownRoutePreloadCollections ?? [];

const routeModulePreloadCollections = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics
): DevtoolsStartAppGraphRoutePreloadCollections =>
  (routeModule as { readonly preloadCollections?: DevtoolsStartAppGraphRoutePreloadCollections })
    .preloadCollections ?? {
      status: "unknown",
      collections: []
    };

const graphSummary = (
  appGraph: DevtoolsStartAppGraphDiagnostics | undefined
): DevtoolsSummary["graph"] => {
  if (!appGraph) {
    return {
      _tag: "Unavailable"
    };
  }

  const collections = appGraphCollectionDefinitions(appGraph);

  return {
    _tag: "Available",
    routes: {
      count: appGraph.routeCount,
      paths: [...appGraph.routePaths],
      modules: appGraph.routeModules.map((routeModule) => ({ ...routeModule })),
      unknownPreloadResources: appGraph.unknownRoutePreloadResources.map((entry) => ({ ...entry })),
      unknownPreloadCollections: appGraphUnknownRoutePreloadCollections(appGraph).map((entry) => ({ ...entry }))
    },
    serverFunctions: {
      count: appGraph.serverFunctionCount,
      schemaCoverage: { ...appGraph.schemaCoverage.serverFunctions },
      modules: appGraph.serverFunctionModules.map((serverFunction) => ({ ...serverFunction }))
    },
    actions: {
      count: appGraph.actionCount,
      schemaCoverage: { ...appGraph.schemaCoverage.actions },
      modules: appGraph.actionModules.map((action) => ({ ...action })),
      behavior: actionBehaviorSummary(appGraph.actionModules),
      unknownBehavior: appGraph.unknownActionBehavior.map((entry) => ({ ...entry }))
    },
    resources: {
      familyCount: appGraph.resourceFamilies.length,
      tagCount: appGraph.resourceTags.length,
      families: appGraph.resourceFamilies.map((family) => ({ ...family, policy: { ...family.policy } })),
      tags: appGraph.resourceTags.map((tag) => ({ ...tag }))
    },
    collections: {
      definitionCount: collections.length,
      definitions: collections.map((collection) => ({
        ...collection,
        indexes: [...(collection.indexes ?? [])],
        handlers: { ...collection.handlers },
        policy: { ...collection.policy },
        ...(collection.sync === undefined ? {} : { sync: { ...collection.sync } }),
        persistence: { ...collection.persistence }
      }))
    },
    endpoints: {
      rpc: appGraph.rpcPath,
      action: appGraph.actionPath
    },
    modules: {
      serverOnly: [...appGraph.serverOnlyModules],
      browserClient: [...appGraph.browserClientModules]
    },
    missingSchemas: appGraph.missingSchemas.map((missingSchema) => ({ ...missingSchema }))
  };
};

const summarizeResourceRef = (ref: {
  readonly key: string;
  readonly family: string;
  readonly input: unknown;
}): DevtoolsSummaryResourceRef => ({
  key: ref.key,
  family: ref.family,
  input: toDevtoolsSerializableValue(ref.input)
});

const summarizeTarget = (
  target: DevtoolsInvalidationTarget
): DevtoolsSummaryInvalidationTarget =>
  target._tag === "Ref"
    ? {
        _tag: "Ref",
        ...summarizeResourceRef(target)
      }
    : { ...target };

const summarizeInvalidationPlan = (
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

const summarizeRoutePlan = (
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

const summarizeRequestTrace = (
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

const actionNodeId = (name: string): string => `action:${name}`;

const collectionNodeId = (collection: string): string => `collection:${collection}`;

const endpointNodeId = (name: string): string => `endpoint:${name}`;

const invalidationNodeId = (index: number): string => `invalidation:${index}`;

const missingSchemaNodeId = (schema: DevtoolsStartAppGraphMissingSchema): string =>
  `missing-schema:${schema.kind}:${schema.name}:${schema.input ? "input" : "no-input"}:${schema.output ? "output" : "no-output"}:${schema.error ? "error" : "no-error"}`;

const moduleNodeId = (kind: "server-only" | "browser-client" | "route" | DevtoolsStartAppGraphModuleKind, path: string): string =>
  `module:${kind}:${path}`;

const resourceFamilyNodeId = (name: string): string => `resource-family:${name}`;

const resourceNodeId = (key: string): string => `resource:${key}`;

const requestTraceNodeId = (trace: DevtoolsSummaryRequestTrace): string =>
  `request-trace:${trace.id}`;

const routeNodeId = (path: string): string => `route:${path}`;

const routePlanNodeId = (index: number, href: string): string => `route-plan:${index}:${href}`;

const schemaCoverageNodeId = (kind: "serverFunctions" | "actions"): string =>
  `schema-coverage:${kind}`;

const serverFunctionNodeId = (name: string): string => `server-function:${name}`;

const tagNodeId = (key: string): string => `resource-tag:${key}`;

const targetNodeId = (target: DevtoolsSummaryInvalidationTarget | DevtoolsSummaryInvalidationCause): string =>
  target._tag === "Tag" ? tagNodeId(target.key) : resourceNodeId(target.key);

const runtimeEventNodeId = (event: DevtoolsSummaryRuntimeEvent): string =>
  `runtime-event:${event.sequence}:${event._tag}`;

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

const summarizeRuntimeEvent = (
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

const resourceIndex = (
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

const summarizeRuntimeEvents = (
  events: ReadonlyArray<DevtoolsRuntimeEvent>
): ReadonlyArray<DevtoolsSummaryRuntimeEvent> =>
  events.map(summarizeRuntimeEvent).sort((left, right) => {
    const bySequence = left.sequence - right.sequence;
    return bySequence === 0 ? left.id.localeCompare(right.id) : bySequence;
  });

const schemaCoverageData = (
  coverage: DevtoolsStartAppGraphSchemaCoverage
): DevtoolsSerializableValue => ({
  error: coverage.error,
  input: coverage.input,
  output: coverage.output,
  total: coverage.total
});

const addNode = (
  nodes: Map<string, DevtoolsCausalNode>,
  node: DevtoolsCausalNode
): void => {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
};

const addEdge = (
  edges: Array<DevtoolsCausalEdge>,
  edge: Omit<DevtoolsCausalEdge, "id">,
  index: number
): void => {
  edges.push({
    id: `edge:${index}:${edge.kind}:${edge.source}->${edge.target}`,
    ...edge
  });
};

interface DevtoolsCausalGraphInput {
  readonly appGraph: DevtoolsStartAppGraphDiagnostics | undefined;
  readonly snapshot: DevtoolsSnapshot;
  readonly invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>;
  readonly requestTraces: ReadonlyArray<DevtoolsRequestTrace>;
  readonly requestTraceSummaries: ReadonlyArray<DevtoolsSummaryRequestTrace>;
  readonly resources: ReadonlyArray<DevtoolsSummaryResource>;
  readonly runtimeEvents: ReadonlyArray<DevtoolsSummaryRuntimeEvent>;
}

const makeDevtoolsCausalGraph = (
  input: DevtoolsCausalGraphInput
): DevtoolsCausalGraph => {
  const nodes = new Map<string, DevtoolsCausalNode>();
  const edges: Array<DevtoolsCausalEdge> = [];
  let edgeIndex = 0;

  const connect = (edge: Omit<DevtoolsCausalEdge, "id">): void => {
    addEdge(edges, edge, edgeIndex);
    edgeIndex += 1;
  };
  const addModuleNode = (
    kind: "server-only" | "browser-client" | "route" | DevtoolsStartAppGraphModuleKind,
    path: string,
    data: DevtoolsSerializableValue = null
  ): string => {
    const id = moduleNodeId(kind, path);
    addNode(nodes, {
      id,
      kind: "Module",
      label: path,
      data: {
        boundary: kind,
        path,
        ...(typeof data === "object" && data !== null && !Array.isArray(data) ? data : {})
      }
    });
    return id;
  };

  if (input.appGraph) {
    const collectionDefinitionsByName = new Map(
      appGraphCollectionDefinitions(input.appGraph).map((collection) => [collection.name, collection] as const)
    );

    addNode(nodes, {
      id: endpointNodeId("rpc"),
      kind: "Endpoint",
      label: input.appGraph.rpcPath,
      data: {
        path: input.appGraph.rpcPath,
        transport: "rpc"
      }
    });
    addNode(nodes, {
      id: endpointNodeId("action"),
      kind: "Endpoint",
      label: input.appGraph.actionPath,
      data: {
        path: input.appGraph.actionPath,
        transport: "action"
      }
    });

    for (const routeModule of input.appGraph.routeModules) {
      const routeId = routeNodeId(routeModule.routePath);
      addNode(nodes, {
        id: routeId,
        kind: "Route",
        label: routeModule.routePath,
        data: toDevtoolsSerializableValue(routeModule)
      });
      const moduleId = addModuleNode("route", routeModule.filePath, {
        moduleId: routeModule.moduleId,
        routeId: routeModule.routeId
      });
      connect({
        kind: "UsesModule",
        source: routeId,
        target: moduleId,
        label: "declared in",
        data: {
          routeId: routeModule.routeId
        }
      });
      for (const family of routeModule.preloadResources.families) {
        const familyId = resourceFamilyNodeId(family);
        addNode(nodes, {
          id: familyId,
          kind: "ResourceFamily",
          label: family,
          data: {
            name: family,
            source: "RoutePreloadResources",
            status: routeModule.preloadResources.status
          }
        });
        connect({
          kind: "Preloads",
          source: routeId,
          target: familyId,
          label: "declares preload",
          data: {
            routeId: routeModule.routeId,
            status: routeModule.preloadResources.status
          }
        });
      }
      const preloadCollections = routeModulePreloadCollections(routeModule);
      for (const collection of preloadCollections.collections) {
        const collectionId = collectionNodeId(collection);
        const definition = collectionDefinitionsByName.get(collection);
        addNode(nodes, {
          id: collectionId,
          kind: "Collection",
          label: collection,
          data: toDevtoolsSerializableValue(
            definition === undefined
              ? {
                  name: collection,
                  source: "RoutePreloadCollections",
                  status: preloadCollections.status
                }
              : {
                  ...definition,
                  source: "AppGraph"
                }
          )
        });
        connect({
          kind: "Preloads",
          source: routeId,
          target: collectionId,
          label: "declares collection preload",
          data: {
            routeId: routeModule.routeId,
            status: preloadCollections.status
          }
        });
      }
    }

    for (const path of input.appGraph.routePaths) {
      addNode(nodes, {
        id: routeNodeId(path),
        kind: "Route",
        label: path,
        data: { path }
      });
    }

    const serverFunctionCoverageId = schemaCoverageNodeId("serverFunctions");
    addNode(nodes, {
      id: serverFunctionCoverageId,
      kind: "SchemaCoverage",
      label: "serverFunctions schemas",
      data: schemaCoverageData(input.appGraph.schemaCoverage.serverFunctions)
    });
    connect({
      kind: "UsesEndpoint",
      source: serverFunctionCoverageId,
      target: endpointNodeId("rpc"),
      label: "served by",
      data: null
    });

    const actionCoverageId = schemaCoverageNodeId("actions");
    addNode(nodes, {
      id: actionCoverageId,
      kind: "SchemaCoverage",
      label: "actions schemas",
      data: schemaCoverageData(input.appGraph.schemaCoverage.actions)
    });
    connect({
      kind: "UsesEndpoint",
      source: actionCoverageId,
      target: endpointNodeId("action"),
      label: "served by",
      data: null
    });

    for (const serverFunction of input.appGraph.serverFunctionModules) {
      const serverFunctionId = serverFunctionNodeId(serverFunction.name);
      addNode(nodes, {
        id: serverFunctionId,
        kind: "ServerFunction",
        label: serverFunction.name,
        data: toDevtoolsSerializableValue(serverFunction)
      });
      connect({
        kind: "UsesEndpoint",
        source: serverFunctionId,
        target: endpointNodeId("rpc"),
        label: "served by",
        data: {
          rpcPath: serverFunction.client.rpcPath
        }
      });
      connect({
        kind: "Covers",
        source: serverFunctionCoverageId,
        target: serverFunctionId,
        label: "covers",
        data: schemaCoverageData({
          total: 1,
          input: serverFunction.wire.inputSchema ? 1 : 0,
          output: serverFunction.wire.outputSchema ? 1 : 0,
          error: serverFunction.wire.errorSchema ? 1 : 0
        })
      });
      connect({
        kind: "UsesModule",
        source: serverFunctionId,
        target: addModuleNode(serverFunction.server.moduleKind, serverFunction.server.module, {
          exportName: serverFunction.server.exportName
        }),
        label: "server export",
        data: {
          exportName: serverFunction.server.exportName,
          moduleKind: serverFunction.server.moduleKind
        }
      });
      if (serverFunction.client._tag === "Import") {
        connect({
          kind: "UsesModule",
          source: serverFunctionId,
          target: addModuleNode(serverFunction.client.moduleKind, serverFunction.client.module, {
            exportName: serverFunction.client.exportName
          }),
          label: "client reference",
          data: {
            exportName: serverFunction.client.exportName,
            moduleKind: serverFunction.client.moduleKind
          }
        });
      }
    }

    for (const action of input.appGraph.actionModules) {
      const actionId = actionNodeId(action.name);
      addNode(nodes, {
        id: actionId,
        kind: "Action",
        label: action.name,
        data: toDevtoolsSerializableValue(action)
      });
      connect({
        kind: "UsesEndpoint",
        source: actionId,
        target: endpointNodeId("action"),
        label: "served by",
        data: {
          actionPath: action.client.actionPath
        }
      });
      connect({
        kind: "Covers",
        source: actionCoverageId,
        target: actionId,
        label: "covers",
        data: schemaCoverageData({
          total: 1,
          input: action.wire.inputSchema ? 1 : 0,
          output: action.wire.outputSchema ? 1 : 0,
          error: action.wire.errorSchema ? 1 : 0
        })
      });
      connect({
        kind: "UsesModule",
        source: actionId,
        target: addModuleNode(action.server.moduleKind, action.server.module, {
          exportName: action.server.exportName
        }),
        label: "server export",
        data: {
          exportName: action.server.exportName,
          moduleKind: action.server.moduleKind
        }
      });
      if (action.client._tag === "Import") {
        connect({
          kind: "UsesModule",
          source: actionId,
          target: addModuleNode(action.client.moduleKind, action.client.module, {
            exportName: action.client.exportName
          }),
          label: "client reference",
          data: {
            exportName: action.client.exportName,
            moduleKind: action.client.moduleKind
          }
        });
      }
    }

    for (const family of input.appGraph.resourceFamilies) {
      addNode(nodes, {
        id: resourceFamilyNodeId(family.name),
        kind: "ResourceFamily",
        label: family.name,
        data: toDevtoolsSerializableValue(family)
      });
    }

    for (const tag of input.appGraph.resourceTags) {
      addNode(nodes, {
        id: tagNodeId(tag.name),
        kind: "ResourceTag",
        label: tag.name,
        data: toDevtoolsSerializableValue(tag)
      });
    }

    for (const collection of appGraphCollectionDefinitions(input.appGraph)) {
      addNode(nodes, {
        id: collectionNodeId(collection.name),
        kind: "Collection",
        label: collection.name,
        data: toDevtoolsSerializableValue({
          ...collection,
          source: "AppGraph"
        })
      });
    }

    for (const modulePath of input.appGraph.serverOnlyModules) {
      const moduleId = addModuleNode("server-only", modulePath);
      connect({
        kind: "UsesModule",
        source: serverFunctionCoverageId,
        target: moduleId,
        label: "discovers",
        data: null
      });
    }

    for (const modulePath of input.appGraph.browserClientModules) {
      const moduleId = addModuleNode("browser-client", modulePath);
      connect({
        kind: "UsesModule",
        source: actionCoverageId,
        target: moduleId,
        label: "discovers",
        data: null
      });
    }

    for (const missingSchema of input.appGraph.missingSchemas) {
      const missingId = missingSchemaNodeId(missingSchema);
      const ownerId = missingSchema.kind === "action"
        ? actionNodeId(missingSchema.name)
        : serverFunctionNodeId(missingSchema.name);
      const coverageId = missingSchema.kind === "action" ? actionCoverageId : serverFunctionCoverageId;

      addNode(nodes, {
        id: ownerId,
        kind: missingSchema.kind === "action" ? "Action" : "ServerFunction",
        label: missingSchema.name,
        data: {
          name: missingSchema.name
        }
      });
      addNode(nodes, {
        id: missingId,
        kind: "MissingSchema",
        label: missingSchema.name,
        data: toDevtoolsSerializableValue(missingSchema)
      });
      connect({
        kind: "MissingSchema",
        source: ownerId,
        target: missingId,
        label: "missing schema",
        data: null
      });
      connect({
        kind: "Covers",
        source: coverageId,
        target: missingId,
        label: "reports",
        data: null
      });
    }
  }

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
        state: resource.state
      }
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
        state: action.state
      }
    });

    for (const invalidationIndex of action.invalidationIndexes ?? []) {
      connect({
        kind: "Emits",
        source: actionId,
        target: invalidationNodeId(invalidationIndex),
        label: "emits",
        data: {
          invalidationIndex
        }
      });
    }
  }

  for (const plan of input.routePlans) {
    const routePlanId = routePlanNodeId(plan.index, plan.href);
    addNode(nodes, {
      id: routePlanId,
      kind: "RoutePlan",
      label: plan.href,
      data: {
        href: plan.href,
        hydrationResourceCount: plan.hydrationResourceCount,
        params: plan.params,
        path: plan.path,
        resourceCount: plan.resourceCount,
        search: plan.search,
        tag: plan._tag
      }
    });

    if (plan.path !== null) {
      const routeId = routeNodeId(plan.path);
      addNode(nodes, {
        id: routeId,
        kind: "Route",
        label: plan.path,
        data: { path: plan.path }
      });
      connect({
        kind: "Matches",
        source: routePlanId,
        target: routeId,
        label: "matches",
        data: {
          href: plan.href
        }
      });
    }

    for (const resource of plan.resources) {
      const targetId = resourceNodeId(resource.key);
      addNode(nodes, {
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
      connect({
        kind: "Preloads",
        source: routePlanId,
        target: targetId,
        label: "preloads",
        data: {
          href: plan.href
        }
      });
      if (plan.hydrationResourceCount > 0) {
        connect({
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
        streams: trace.streams
      })
    });

    if (trace.request.transport === "rpc" || trace.request.transport === "action") {
      const endpointId = endpointNodeId(trace.request.transport);
      addNode(nodes, {
        id: endpointId,
        kind: "Endpoint",
        label: trace.request.transport,
        data: {
          transport: trace.request.transport
        }
      });
      connect({
        kind: "UsesEndpoint",
        source: traceId,
        target: endpointId,
        label: "uses",
        data: {
          transport: trace.request.transport
        }
      });
    }

    if (trace.routePlan) {
      const plan = summarizeRoutePlan(trace.routePlan, index);
      const traceRoutePlanId = routePlanNodeId(index, plan.href);
      addNode(nodes, {
        id: traceRoutePlanId,
        kind: "RoutePlan",
        label: plan.href,
        data: {
          href: plan.href,
          hydrationResourceCount: plan.hydrationResourceCount,
          params: plan.params,
          path: plan.path,
          resourceCount: plan.resourceCount,
          search: plan.search,
          tag: plan._tag
        }
      });
      connect({
        kind: "Records",
        source: traceId,
        target: traceRoutePlanId,
        label: "records",
        data: null
      });

      if (plan.path !== null) {
        const routeId = routeNodeId(plan.path);
        addNode(nodes, {
          id: routeId,
          kind: "Route",
          label: plan.path,
          data: { path: plan.path }
        });
        connect({
          kind: "Matches",
          source: traceRoutePlanId,
          target: routeId,
          label: "matches",
          data: {
            href: plan.href
          }
        });
      }
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
          state: resource.state ?? null
        }
      });
      connect({
        kind: "Records",
        source: traceId,
        target: resourceId,
        label: "records",
        data: {
          targetKind: "Resource"
        }
      });
    }

    for (const collection of trace.collections) {
      const collectionId = collectionNodeId(collection.name);
      addNode(nodes, {
        id: collectionId,
        kind: "Collection",
        label: collection.name,
        data: toDevtoolsSerializableValue({
          ...collection,
          source: "RequestTrace"
        })
      });
      connect({
        kind: "Records",
        source: traceId,
        target: collectionId,
        label: "records",
        data: {
          targetKind: "Collection"
        }
      });
    }

    for (const action of trace.actions) {
      const actionId = actionNodeId(action.name);
      addNode(nodes, {
        id: actionId,
        kind: "Action",
        label: action.name,
        data: toDevtoolsSerializableValue(action)
      });
      connect({
        kind: "Records",
        source: traceId,
        target: actionId,
        label: "records",
        data: {
          targetKind: "Action"
        }
      });
    }

    for (const serverFunction of trace.serverFunctions) {
      const serverFunctionId = serverFunctionNodeId(serverFunction.name);
      addNode(nodes, {
        id: serverFunctionId,
        kind: "ServerFunction",
        label: serverFunction.name,
        data: toDevtoolsSerializableValue(serverFunction)
      });
      connect({
        kind: "Records",
        source: traceId,
        target: serverFunctionId,
        label: "records",
        data: {
          targetKind: "ServerFunction"
        }
      });
    }
  });

  for (const plan of input.invalidations) {
    const planId = invalidationNodeId(plan.index);
    addNode(nodes, {
      id: planId,
      kind: "InvalidationPlan",
      label: `Invalidation ${plan.index}`,
      data: {
        causeCount: plan.causeCount,
        index: plan.index,
        matchedResourceCount: plan.matchedResourceCount,
        targetCount: plan.targetCount
      }
    });

    for (const target of plan.targets) {
      const targetId = targetNodeId(target);
      addNode(nodes, {
        id: targetId,
        kind: target._tag === "Tag" ? "ResourceTag" : "InvalidationTarget",
        label: target._tag === "Tag" ? target.name : target.family,
        data: toDevtoolsSerializableValue(target)
      });
      connect({
        kind: "Targets",
        source: planId,
        target: targetId,
        label: "targets",
        data: null
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
          state: null
        }
      });
      connect({
        kind: "Invalidates",
        source: planId,
        target: affectedResourceId,
        label: "invalidates",
        data: {
          causeCount: entry.causes.length
        }
      });

      for (const cause of entry.causes) {
        const causeId = targetNodeId(cause);
        addNode(nodes, {
          id: causeId,
          kind: cause._tag === "Tag" ? "ResourceTag" : "Resource",
          label: cause._tag === "Tag" ? cause.name : cause.family,
          data: toDevtoolsSerializableValue(cause)
        });
        connect({
          kind: "Causes",
          source: causeId,
          target: affectedResourceId,
          label: "causes",
          data: {
            invalidationIndex: plan.index
          }
        });
      }
    }
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
        tag: event._tag
      }
    });
    if (event.target !== null) {
      addNode(nodes, {
        id: event.target.id,
        kind: event.target.kind,
        label: runtimeTargetLabel(event.target),
        data: {
          source: "RuntimeEvent",
          targetKind: event.target.kind
        }
      });
      connect({
        kind: "Observes",
        source: eventId,
        target: event.target.id,
        label: "observes",
        data: {
          targetKind: event.target.kind
        }
      });
    }
  }

  return {
    version: 1,
    nodes: Array.from(nodes.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id))
  };
};

export const describeDevtoolsCausalGraph = (
  input: DevtoolsSummaryInput = {}
): DevtoolsCausalGraph => {
  const snapshot = input.snapshot ?? emptySnapshot();
  const appGraph = input.appGraph ?? snapshot.appGraph;
  const invalidationPlans = input.invalidations ?? snapshot.invalidations;
  const routePlans = input.routePlans ?? snapshot.routePlans;
  const requestTraces = input.requestTraces ?? snapshot.requestTraces ?? [];
  const runtimeEvents = input.runtimeEvents ?? snapshot.events ?? [];
  const invalidations = invalidationPlans.map(summarizeInvalidationPlan);
  const routes = routePlans.map(summarizeRoutePlan);
  const requests = requestTraces.map(summarizeRequestTrace);
  const resources = resourceIndex(snapshot, invalidations, routes, requestTraces);
  const events = summarizeRuntimeEvents(runtimeEvents);

  return makeDevtoolsCausalGraph({
    appGraph,
    snapshot,
    invalidations,
    routePlans: routes,
    requestTraces,
    requestTraceSummaries: requests,
    resources,
    runtimeEvents: events
  });
};

export const describeDevtoolsCausalGraphEffect = (
  input: DevtoolsSummaryInput = {}
): Effect.Effect<DevtoolsCausalGraph> =>
  Effect.succeed(describeDevtoolsCausalGraph(input));

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
