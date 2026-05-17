import { Effect } from "effect";
import type {
  StartAppGraphActionDiagnostics,
  StartAppGraphCollectionDiagnostics,
  StartAppGraphRouteDiagnostics,
  StartAppGraphResourceFamilyDiagnostics,
  StartAppGraphResourceTagDiagnostics,
  StartAppGraphServerFunctionDiagnostics,
} from "./app-graph.js";
import { createStartDiagnosticsReport } from "./diagnostics-report.js";
import type {
  StartAgentGraph,
  StartAgentGraphEdge,
  StartAgentGraphEdgeKind,
  StartAgentGraphInput,
  StartAgentGraphNode,
  StartAgentGraphNodeStatus,
} from "./start-agent-graph-contract.js";
export type {
  StartAgentGraph,
  StartAgentGraphEdge,
  StartAgentGraphEdgeKind,
  StartAgentGraphFormatOptions,
  StartAgentGraphImpact,
  StartAgentGraphImpactItem,
  StartAgentGraphImpactOptions,
  StartAgentGraphImpactRelation,
  StartAgentGraphImpactRelationKind,
  StartAgentGraphInput,
  StartAgentGraphNode,
  StartAgentGraphNodeKind,
  StartAgentGraphNodeStatus,
  StartAgentGraphQuery,
  StartAgentGraphQueryKind,
  StartAgentGraphQueryResult,
  StartAgentGraphSelfReview,
  StartAgentGraphSummary,
} from "./start-agent-graph-contract.js";
export {
  formatStartAgentGraph,
  formatStartAgentGraphImpact,
} from "./start-agent-graph-formatter.js";
export {
  createStartAgentGraphImpact,
  createStartAgentGraphImpactEffect,
} from "./start-agent-graph-impact.js";
export { queryStartAgentGraph, queryStartAgentGraphEffect } from "./start-agent-graph-query.js";

const nodeId = (kind: string, key: string): string => `${kind}:${key}`;

const edgeId = (kind: StartAgentGraphEdgeKind, from: string, to: string, ordinal: number): string =>
  `${kind}:${ordinal}:${from}->${to}`;

const addNode = (nodes: Map<string, StartAgentGraphNode>, node: StartAgentGraphNode): void => {
  nodes.set(node.id, node);
};

const addEdge = (edges: StartAgentGraphEdge[], edge: Omit<StartAgentGraphEdge, "id">): void => {
  edges.push({
    ...edge,
    id: edgeId(edge.kind, edge.from, edge.to, edges.length + 1),
  });
};

const statusFromBoolean = (needsAttention: boolean): StartAgentGraphNodeStatus =>
  needsAttention ? "needs-attention" : "known";

const actionNeedsAttention = (action: StartAppGraphActionDiagnostics): boolean =>
  !action.wire.complete ||
  action.behavior.invalidates === "unknown" ||
  action.behavior.optimistic === "unknown" ||
  action.behavior.retry === "unknown" ||
  action.behavior.concurrency === "unknown";

const routeNeedsAttention = (route: StartAppGraphRouteDiagnostics): boolean =>
  route.preload === "present" &&
  (route.preloadResources.status === "unknown" || route.preloadCollections.status === "unknown");

type StartAgentGraphFactRecord = Readonly<Record<string, unknown>>;

const detachFactValue = (
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap(),
): unknown => {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(detachFactValue(item, seen));
    }
    return clone;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, child] of Object.entries(value)) {
    clone[key] = detachFactValue(child, seen);
  }
  return clone;
};

const startAgentGraphFacts = (
  facts: Readonly<Record<string, unknown>>,
): StartAgentGraphFactRecord => detachFactValue(facts) as StartAgentGraphFactRecord;

const routeFacts = (route: StartAppGraphRouteDiagnostics): StartAgentGraphFactRecord =>
  startAgentGraphFacts({
    routeId: route.routeId,
    routePath: route.routePath,
    moduleId: route.moduleId,
    filePath: route.filePath,
    params: route.params,
    paramsSchema: route.paramsSchema,
    searchSchema: route.searchSchema,
    preload: route.preload,
    preloadResources: route.preloadResources,
    preloadCollections: route.preloadCollections,
    component: route.component,
  });

const serverFunctionFacts = (
  serverFunction: StartAppGraphServerFunctionDiagnostics,
): StartAgentGraphFactRecord =>
  startAgentGraphFacts({
    id: serverFunction.id,
    name: serverFunction.name,
    server: serverFunction.server,
    client: serverFunction.client,
    wire: serverFunction.wire,
  });

const actionFacts = (action: StartAppGraphActionDiagnostics): StartAgentGraphFactRecord =>
  startAgentGraphFacts({
    id: action.id,
    name: action.name,
    server: action.server,
    client: action.client,
    wire: action.wire,
    behavior: action.behavior,
  });

const resourceFamilyFacts = (
  family: StartAppGraphResourceFamilyDiagnostics,
): StartAgentGraphFactRecord =>
  startAgentGraphFacts({
    name: family.name,
    inputSchema: family.inputSchema,
    outputSchema: family.outputSchema,
    errorSchema: family.errorSchema,
    providesTags: family.providesTags,
    policy: family.policy,
  });

const resourceTagFacts = (tag: StartAppGraphResourceTagDiagnostics): StartAgentGraphFactRecord =>
  startAgentGraphFacts({
    name: tag.name,
    keyed: tag.keyed,
  });

const collectionFacts = (
  collection: StartAppGraphCollectionDiagnostics,
): StartAgentGraphFactRecord =>
  startAgentGraphFacts({
    name: collection.name,
    readOnly: collection.readOnly,
    inputSchema: collection.inputSchema,
    outputSchema: collection.outputSchema,
    initialData: collection.initialData,
    indexes: collection.indexes,
    load: collection.load,
    handlers: collection.handlers,
    policy: collection.policy,
    ...(collection.sync === undefined ? {} : { sync: collection.sync }),
    persistence: collection.persistence,
  });

const findingFacts = (
  finding: ReturnType<typeof createStartDiagnosticsReport>["findings"][number],
): StartAgentGraphFactRecord =>
  startAgentGraphFacts({
    kind: finding.kind,
    owner: finding.owner,
    subject: finding.subject,
    issue: finding.issue,
    edit: finding.edit,
    details: finding.details,
  });

const moduleNode = (module: string): StartAgentGraphNode => ({
  id: nodeId("module", module),
  kind: "Module",
  label: module,
  status: "known",
  facts: startAgentGraphFacts({ module }),
});

const endpointNode = (kind: "rpc" | "action", path: string): StartAgentGraphNode => ({
  id: nodeId("endpoint", kind),
  kind: "Endpoint",
  label: `${kind} ${path}`,
  status: "known",
  facts: startAgentGraphFacts({ kind, path }),
});

const ownerModule = (owner: string): string => owner.split("#", 1)[0] ?? owner;

/**
 * Projects Start app graph diagnostics into an agent-readable graph.
 *
 * The graph connects routes, endpoints, server functions, actions, resources,
 * collections, modules, and diagnostics findings so CLI and repair agents can
 * query ownership and impact without parsing raw manifests.
 */
export const createStartAgentGraph = (input: StartAgentGraphInput): StartAgentGraph => {
  const diagnostics = input.diagnostics;
  const report = createStartDiagnosticsReport(input);
  const nodes = new Map<string, StartAgentGraphNode>();
  const edges: StartAgentGraphEdge[] = [];
  const rpcEndpoint = endpointNode("rpc", diagnostics.rpcPath);
  const actionEndpoint = endpointNode("action", diagnostics.actionPath);

  addNode(nodes, rpcEndpoint);
  addNode(nodes, actionEndpoint);

  for (const route of diagnostics.routeModules) {
    const routeNodeId = nodeId("route", route.routeId);
    addNode(nodes, {
      id: routeNodeId,
      kind: "Route",
      label: route.routePath,
      status: statusFromBoolean(routeNeedsAttention(route)),
      owner: route.filePath,
      facts: routeFacts(route),
    });
    const moduleId = nodeId("module", route.moduleId);
    addNode(nodes, moduleNode(route.moduleId));
    addEdge(edges, {
      kind: "ImplementedBy",
      from: routeNodeId,
      to: moduleId,
      label: "implemented by route module",
    });

    if (route.preloadResources.status === "declared") {
      for (const family of route.preloadResources.families) {
        const familyId = nodeId("resource-family", family);
        if (!nodes.has(familyId)) {
          addNode(nodes, {
            id: familyId,
            kind: "ResourceFamily",
            label: family,
            status: "known",
            facts: startAgentGraphFacts({
              name: family,
              source: "route preload declaration",
            }),
          });
        }
        addEdge(edges, {
          kind: "PreloadsResourceFamily",
          from: routeNodeId,
          to: familyId,
          label: "preloads resource family",
        });
      }
    }

    if (route.preloadCollections.status === "declared") {
      for (const collection of route.preloadCollections.collections) {
        const collectionId = nodeId("collection", collection);
        if (!nodes.has(collectionId)) {
          addNode(nodes, {
            id: collectionId,
            kind: "Collection",
            label: collection,
            status: "known",
            facts: startAgentGraphFacts({
              name: collection,
              source: "route preload declaration",
            }),
          });
        }
        addEdge(edges, {
          kind: "PreloadsCollection",
          from: routeNodeId,
          to: collectionId,
          label: "preloads collection",
        });
      }
    }
  }

  for (const serverFunction of diagnostics.serverFunctionModules) {
    const serverFunctionNodeId = nodeId("server-function", serverFunction.name);
    addNode(nodes, {
      id: serverFunctionNodeId,
      kind: "ServerFunction",
      label: serverFunction.name,
      status: statusFromBoolean(!serverFunction.wire.complete),
      owner: `${serverFunction.server.module}#${serverFunction.server.exportName}`,
      facts: serverFunctionFacts(serverFunction),
    });
    const serverModuleId = nodeId("module", serverFunction.server.module);
    addNode(nodes, moduleNode(serverFunction.server.module));
    addEdge(edges, {
      kind: "ServerImports",
      from: serverFunctionNodeId,
      to: serverModuleId,
      label: "server implementation module",
    });
    addEdge(edges, {
      kind: "ExposesEndpoint",
      from: serverFunctionNodeId,
      to: rpcEndpoint.id,
      label: "exposes RPC endpoint",
    });
    if (serverFunction.client._tag === "Import") {
      const clientModuleId = nodeId("module", serverFunction.client.module);
      addNode(nodes, moduleNode(serverFunction.client.module));
      addEdge(edges, {
        kind: "ClientImports",
        from: serverFunctionNodeId,
        to: clientModuleId,
        label: "client contract module",
      });
    }
  }

  for (const action of diagnostics.actionModules) {
    const actionNodeId = nodeId("action", action.name);
    addNode(nodes, {
      id: actionNodeId,
      kind: "Action",
      label: action.name,
      status: statusFromBoolean(actionNeedsAttention(action)),
      owner: `${action.server.module}#${action.server.exportName}`,
      facts: actionFacts(action),
    });
    const serverModuleId = nodeId("module", action.server.module);
    addNode(nodes, moduleNode(action.server.module));
    addEdge(edges, {
      kind: "ServerImports",
      from: actionNodeId,
      to: serverModuleId,
      label: "server action module",
    });
    addEdge(edges, {
      kind: "ExposesEndpoint",
      from: actionNodeId,
      to: actionEndpoint.id,
      label: "exposes action endpoint",
    });
    if (action.client._tag === "Import") {
      const clientModuleId = nodeId("module", action.client.module);
      addNode(nodes, moduleNode(action.client.module));
      addEdge(edges, {
        kind: "ClientImports",
        from: actionNodeId,
        to: clientModuleId,
        label: "client action module",
      });
    }
  }

  for (const family of diagnostics.resourceFamilies) {
    addNode(nodes, {
      id: nodeId("resource-family", family.name),
      kind: "ResourceFamily",
      label: family.name,
      status: "known",
      facts: resourceFamilyFacts(family),
    });
  }

  for (const tag of diagnostics.resourceTags) {
    addNode(nodes, {
      id: nodeId("resource-tag", tag.name),
      kind: "ResourceTag",
      label: tag.name,
      status: "known",
      facts: resourceTagFacts(tag),
    });
  }

  for (const collection of diagnostics.collectionDefinitions) {
    addNode(nodes, {
      id: nodeId("collection", collection.name),
      kind: "Collection",
      label: collection.name,
      status: "known",
      facts: collectionFacts(collection),
    });
  }

  report.findings.forEach((finding, index) => {
    const findingNodeId = nodeId("finding", `${index + 1}`);
    addNode(nodes, {
      id: findingNodeId,
      kind: "Finding",
      label: `${finding.kind}: ${finding.subject}`,
      status: "needs-attention",
      owner: finding.owner,
      facts: findingFacts(finding),
    });
    const moduleId = nodeId("module", ownerModule(finding.owner));
    if (!nodes.has(moduleId)) {
      addNode(nodes, moduleNode(ownerModule(finding.owner)));
    }
    addEdge(edges, {
      kind: "ReportsOn",
      from: findingNodeId,
      to: moduleId,
      label: "reports on owner",
    });
  });

  const nodeList = Array.from(nodes.values()).sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.label.localeCompare(right.label) ||
      left.id.localeCompare(right.id),
  );
  const findings = report.findings;

  return {
    version: 1,
    summary: {
      nodes: nodeList.length,
      edges: edges.length,
      routes: diagnostics.routeCount,
      serverFunctions: diagnostics.serverFunctionCount,
      actions: diagnostics.actionCount,
      resourceFamilies: diagnostics.resourceFamilies.length,
      resourceTags: diagnostics.resourceTags.length,
      collections: diagnostics.collectionDefinitions.length,
      findings: findings.length,
    },
    selfReview: {
      status: report.status,
      policyClean: (input.diagnosticsPolicyViolations?.length ?? 0) === 0,
      wireComplete: diagnostics.missingSchemas.length === 0,
      actionBehaviorKnown: diagnostics.unknownActionBehavior.length === 0,
      routePreloadsDeclared:
        diagnostics.unknownRoutePreloadResources.length === 0 &&
        diagnostics.unknownRoutePreloadCollections.length === 0,
      findingCount: findings.length,
    },
    nodes: nodeList,
    edges,
    findings,
  };
};

/** Effect wrapper for `createStartAgentGraph(...)`. */
export const createStartAgentGraphEffect = (
  input: StartAgentGraphInput,
): Effect.Effect<StartAgentGraph> => Effect.succeed(createStartAgentGraph(input));
