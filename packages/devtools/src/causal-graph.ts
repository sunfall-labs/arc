import { Effect } from "effect";
import {
  devtoolsActionNodeId as actionNodeId,
  devtoolsCausalEdgeId as causalEdgeId,
  devtoolsCollectionNodeId as collectionNodeId,
  devtoolsEndpointNodeId as endpointNodeId,
  devtoolsInvalidationNodeId as invalidationNodeId,
  devtoolsInvalidationTargetNodeId as targetNodeId,
  devtoolsMissingSchemaNodeId as missingSchemaNodeId,
  devtoolsModuleNodeId as moduleNodeId,
  devtoolsRequestTraceNodeId as requestTraceNodeId,
  devtoolsResourceFamilyNodeId as resourceFamilyNodeId,
  devtoolsResourceNodeId as resourceNodeId,
  devtoolsResourceTagNodeId as tagNodeId,
  devtoolsRouteNodeId as routeNodeId,
  devtoolsRuntimeEventNodeId as runtimeEventNodeId,
  devtoolsRuntimeTargetLabel as runtimeTargetLabel,
  devtoolsSchemaCoverageNodeId as schemaCoverageNodeId,
  devtoolsServerFunctionNodeId as serverFunctionNodeId
} from "./graph-ids.js";
import { stableFactFingerprint } from "./fact-identity.js";
import { normalizeDevtoolsAppGraphDiagnostics } from "./app-graph-normalizer.js";
import { toDevtoolsSerializableValue } from "./serialization.js";
import {
  appGraphCollectionDefinitions,
  routeModulePreloadCollections
} from "./summary-app-graph.js";
import { projectDevtoolsRoutePlanFacts } from "./route-plan-facts.js";
import {
  normalizeDevtoolsSummaryInput,
  summarizeRequestTrace,
  summarizeRoutePlan
} from "./summary-facts.js";
import type {
  DevtoolsCausalEdge,
  DevtoolsCausalGraph,
  DevtoolsCausalNode,
  DevtoolsSerializableValue,
  DevtoolsSnapshot,
  DevtoolsStartAppGraphDiagnostics,
  DevtoolsStartAppGraphModuleKind,
  DevtoolsStartAppGraphSchemaCoverage,
  DevtoolsSummaryInput,
  DevtoolsSummaryInvalidationPlan,
  DevtoolsSummaryRequestTrace,
  DevtoolsSummaryResource,
  DevtoolsSummaryRoutePlan,
  DevtoolsSummaryRuntimeEvent,
  DevtoolsRequestTrace
} from "./devtools-contract.js";

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
  ordinals: Map<string, number>
): void => {
  const ordinalKey = `${edge.kind}\u0000${edge.source}\u0000${edge.target}\u0000${edge.label ?? ""}`;
  const ordinal = ordinals.get(ordinalKey) ?? 0;
  ordinals.set(ordinalKey, ordinal + 1);
  edges.push({
    id: causalEdgeId(edge.kind, edge.source, edge.target, edge.label, ordinal),
    ...edge
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
    plan.resources
  ]) ?? "";

const requestRoutePlanSummary = (
  routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>,
  trace: DevtoolsRequestTrace,
  fallbackIndex: number
): DevtoolsSummaryRoutePlan | undefined => {
  if (trace.routePlan === undefined) {
    return undefined;
  }

  const fallback = summarizeRoutePlan(trace.routePlan, fallbackIndex);
  const fingerprint = routePlanSummaryFingerprint(fallback);
  return routePlans.find((plan) => routePlanSummaryFingerprint(plan) === fingerprint) ?? fallback;
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

export const makeDevtoolsCausalGraph = (
  input: DevtoolsCausalGraphInput
): DevtoolsCausalGraph => {
  const nodes = new Map<string, DevtoolsCausalNode>();
  const edges: Array<DevtoolsCausalEdge> = [];
  const edgeOrdinals = new Map<string, number>();
  const appGraph = input.appGraph === undefined
    ? undefined
    : normalizeDevtoolsAppGraphDiagnostics(input.appGraph);

  const connect = (edge: Omit<DevtoolsCausalEdge, "id">): void => {
    addEdge(edges, edge, edgeOrdinals);
  };
  const routePlanSink = {
    addNode: (node: DevtoolsCausalNode) => addNode(nodes, node),
    connect
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
        targetCount: plan.targetCount
      }
    });

    for (const target of plan.targets) {
      const targetId = targetNodeId(target);
      addNode(nodes, {
        id: targetId,
        kind: target._tag === "Tag" ? "ResourceTag" : "Resource",
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

  if (appGraph) {
    const collectionDefinitionsByName = new Map(
      appGraphCollectionDefinitions(appGraph).map((collection) => [collection.name, collection] as const)
    );
    const resourceFamiliesByName = new Map(
      appGraph.resourceFamilies.map((family) => [family.name, family] as const)
    );

    addNode(nodes, {
      id: endpointNodeId("rpc"),
      kind: "Endpoint",
      label: appGraph.rpcPath,
      data: {
        path: appGraph.rpcPath,
        transport: "rpc"
      }
    });
    addNode(nodes, {
      id: endpointNodeId("action"),
      kind: "Endpoint",
      label: appGraph.actionPath,
      data: {
        path: appGraph.actionPath,
        transport: "action"
      }
    });

    for (const routeModule of appGraph.routeModules) {
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
        const definition = resourceFamiliesByName.get(family);
        addNode(nodes, {
          id: familyId,
          kind: "ResourceFamily",
          label: family,
          data: toDevtoolsSerializableValue(
            definition === undefined
              ? {
                  name: family,
                  source: "RoutePreloadResources",
                  status: routeModule.preloadResources.status
                }
              : definition
          )
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

    for (const path of appGraph.routePaths) {
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
      data: schemaCoverageData(appGraph.schemaCoverage.serverFunctions)
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
      data: schemaCoverageData(appGraph.schemaCoverage.actions)
    });
    connect({
      kind: "UsesEndpoint",
      source: actionCoverageId,
      target: endpointNodeId("action"),
      label: "served by",
      data: null
    });

    for (const serverFunction of appGraph.serverFunctionModules) {
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

    for (const action of appGraph.actionModules) {
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

    for (const family of appGraph.resourceFamilies) {
      addNode(nodes, {
        id: resourceFamilyNodeId(family.name),
        kind: "ResourceFamily",
        label: family.name,
        data: toDevtoolsSerializableValue(family)
      });
    }

    for (const tag of appGraph.resourceTags) {
      addNode(nodes, {
        id: tagNodeId(tag.name),
        kind: "ResourceTag",
        label: tag.name,
        data: toDevtoolsSerializableValue(tag)
      });
    }

    for (const collection of appGraphCollectionDefinitions(appGraph)) {
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

    for (const modulePath of appGraph.serverOnlyModules) {
      const moduleId = addModuleNode("server-only", modulePath);
      connect({
        kind: "UsesModule",
        source: serverFunctionCoverageId,
        target: moduleId,
        label: "discovers",
        data: null
      });
    }

    for (const modulePath of appGraph.browserClientModules) {
      const moduleId = addModuleNode("browser-client", modulePath);
      connect({
        kind: "UsesModule",
        source: actionCoverageId,
        target: moduleId,
        label: "discovers",
        data: null
      });
    }

    for (const missingSchema of appGraph.missingSchemas) {
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

    const plan = requestRoutePlanSummary(input.routePlans, trace, input.routePlans.length + index);
    if (plan) {
      const { routePlanId } = projectDevtoolsRoutePlanFacts(plan, routePlanSink);
      connect({
        kind: "Records",
        source: traceId,
        target: routePlanId,
        label: "records",
        data: null
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
        tag: event._tag
      }
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
  const normalized = normalizeDevtoolsSummaryInput(input);

  return makeDevtoolsCausalGraph({
    appGraph: normalized.appGraph,
    snapshot: normalized.snapshot,
    invalidations: normalized.invalidations,
    routePlans: normalized.routePlans,
    requestTraces: normalized.requestTraces,
    requestTraceSummaries: normalized.requestTraceSummaries,
    resources: normalized.resources,
    runtimeEvents: normalized.runtimeEvents
  });
};

export const describeDevtoolsCausalGraphEffect = (
  input: DevtoolsSummaryInput = {}
): Effect.Effect<DevtoolsCausalGraph> =>
  Effect.sync(() => describeDevtoolsCausalGraph(input));
