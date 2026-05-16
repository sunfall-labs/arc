import { Effect } from "effect";
import type {
  StartAppGraph,
  StartAppGraphActionDiagnostics,
  StartAppGraphDiagnostics,
  StartAppGraphDiagnosticsPolicyViolation,
  StartAppGraphRouteDiagnostics,
  StartAppGraphServerFunctionDiagnostics
} from "./app-graph.js";
import {
  createStartDiagnosticsReport,
  type StartDiagnosticsReport,
  type StartDiagnosticsReportFinding
} from "./diagnostics-report.js";
import { startDiagnosticsCliVerifyCommandsForQuery } from "./start-diagnostics-cli-contract.js";

export type StartAgentGraphNodeKind =
  | "Action"
  | "Collection"
  | "Endpoint"
  | "Finding"
  | "Module"
  | "ResourceFamily"
  | "ResourceTag"
  | "Route"
  | "ServerFunction";

export type StartAgentGraphNodeStatus = "known" | "needs-attention";

export interface StartAgentGraphNode {
  readonly id: string;
  readonly kind: StartAgentGraphNodeKind;
  readonly label: string;
  readonly status: StartAgentGraphNodeStatus;
  readonly owner?: string;
  readonly facts: Readonly<Record<string, unknown>>;
}

export type StartAgentGraphEdgeKind =
  | "ClientImports"
  | "ExposesEndpoint"
  | "ImplementedBy"
  | "PreloadsCollection"
  | "PreloadsResourceFamily"
  | "ReportsOn"
  | "ServerImports";

export interface StartAgentGraphEdge {
  readonly id: string;
  readonly kind: StartAgentGraphEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface StartAgentGraphSelfReview {
  readonly status: StartDiagnosticsReport["status"];
  readonly policyClean: boolean;
  readonly wireComplete: boolean;
  readonly actionBehaviorKnown: boolean;
  readonly routePreloadsDeclared: boolean;
  readonly findingCount: number;
}

export interface StartAgentGraphSummary {
  readonly nodes: number;
  readonly edges: number;
  readonly routes: number;
  readonly serverFunctions: number;
  readonly actions: number;
  readonly resourceFamilies: number;
  readonly resourceTags: number;
  readonly collections: number;
  readonly findings: number;
}

export interface StartAgentGraph {
  readonly version: 1;
  readonly summary: StartAgentGraphSummary;
  readonly selfReview: StartAgentGraphSelfReview;
  readonly nodes: readonly StartAgentGraphNode[];
  readonly edges: readonly StartAgentGraphEdge[];
  readonly findings: readonly StartDiagnosticsReportFinding[];
}

export interface StartAgentGraphInput {
  readonly graph?: StartAppGraph;
  readonly diagnostics: StartAppGraphDiagnostics;
  readonly diagnosticsPolicyViolations?: readonly StartAppGraphDiagnosticsPolicyViolation[];
}

export type StartAgentGraphQueryKind =
  | "action"
  | "collection"
  | "endpoint"
  | "finding"
  | "module"
  | "node"
  | "resource"
  | "resource-tag"
  | "route"
  | "server-function";

export interface StartAgentGraphQuery {
  readonly kind?: StartAgentGraphQueryKind;
  readonly text?: string;
}

export interface StartAgentGraphFormatOptions {
  readonly query?: StartAgentGraphQuery;
  readonly verbose?: boolean;
}

export interface StartAgentGraphQueryResult {
  readonly query: StartAgentGraphQuery;
  readonly nodes: readonly StartAgentGraphNode[];
  readonly edges: readonly StartAgentGraphEdge[];
}

export type StartAgentGraphImpactRelationKind =
  | "action"
  | "collection"
  | "endpoint"
  | "finding"
  | "module"
  | "resource"
  | "resource-tag"
  | "route"
  | "server-function";

export interface StartAgentGraphImpactRelation {
  readonly kind: StartAgentGraphImpactRelationKind;
  readonly label: string;
  readonly reason: string;
  readonly owner?: string;
}

export interface StartAgentGraphImpactItem {
  readonly node: StartAgentGraphNode;
  readonly editTarget?: string;
  readonly contracts: readonly string[];
  readonly dependencies: readonly StartAgentGraphImpactRelation[];
  readonly mayAffect: readonly StartAgentGraphImpactRelation[];
  readonly warnings: readonly string[];
  readonly verify: readonly string[];
}

export interface StartAgentGraphImpact {
  readonly query: StartAgentGraphQuery;
  readonly matches: number;
  readonly items: readonly StartAgentGraphImpactItem[];
}

export interface StartAgentGraphImpactOptions {
  readonly root?: string;
}

const nodeId = (kind: string, key: string): string => `${kind}:${key}`;

const edgeId = (
  kind: StartAgentGraphEdgeKind,
  from: string,
  to: string,
  ordinal: number
): string => `${kind}:${ordinal}:${from}->${to}`;

const addNode = (
  nodes: Map<string, StartAgentGraphNode>,
  node: StartAgentGraphNode
): void => {
  nodes.set(node.id, node);
};

const addEdge = (
  edges: StartAgentGraphEdge[],
  edge: Omit<StartAgentGraphEdge, "id">
): void => {
  edges.push({
    ...edge,
    id: edgeId(edge.kind, edge.from, edge.to, edges.length + 1)
  });
};

const statusFromBoolean = (
  needsAttention: boolean
): StartAgentGraphNodeStatus =>
  needsAttention ? "needs-attention" : "known";

const actionNeedsAttention = (
  action: StartAppGraphActionDiagnostics
): boolean =>
  !action.wire.complete ||
  action.behavior.invalidates === "unknown" ||
  action.behavior.optimistic === "unknown" ||
  action.behavior.retry === "unknown" ||
  action.behavior.concurrency === "unknown";

const routeNeedsAttention = (
  route: StartAppGraphRouteDiagnostics
): boolean =>
  route.preload === "present" &&
  (
    route.preloadResources.status === "unknown" ||
    route.preloadCollections.status === "unknown"
  );

const routeFacts = (
  route: StartAppGraphRouteDiagnostics
): Readonly<Record<string, unknown>> => ({
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
  component: route.component
});

const serverFunctionFacts = (
  serverFunction: StartAppGraphServerFunctionDiagnostics
): Readonly<Record<string, unknown>> => ({
  id: serverFunction.id,
  name: serverFunction.name,
  server: serverFunction.server,
  client: serverFunction.client,
  wire: serverFunction.wire
});

const actionFacts = (
  action: StartAppGraphActionDiagnostics
): Readonly<Record<string, unknown>> => ({
  id: action.id,
  name: action.name,
  server: action.server,
  client: action.client,
  wire: action.wire,
  behavior: action.behavior
});

const moduleNode = (
  module: string
): StartAgentGraphNode => ({
  id: nodeId("module", module),
  kind: "Module",
  label: module,
  status: "known",
  facts: { module }
});

const endpointNode = (
  kind: "rpc" | "action",
  path: string
): StartAgentGraphNode => ({
  id: nodeId("endpoint", kind),
  kind: "Endpoint",
  label: `${kind} ${path}`,
  status: "known",
  facts: { kind, path }
});

const ownerModule = (owner: string): string =>
  owner.split("#", 1)[0] ?? owner;

const nodeKindForQuery = (
  kind: StartAgentGraphQueryKind | undefined
): StartAgentGraphNodeKind | undefined => {
  switch (kind) {
    case "action":
      return "Action";
    case "collection":
      return "Collection";
    case "endpoint":
      return "Endpoint";
    case "finding":
      return "Finding";
    case "module":
      return "Module";
    case "resource":
      return "ResourceFamily";
    case "resource-tag":
      return "ResourceTag";
    case "route":
      return "Route";
    case "server-function":
      return "ServerFunction";
    case "node":
    case undefined:
      return undefined;
  }
};

const searchableText = (node: StartAgentGraphNode): string =>
  [
    node.id,
    node.kind,
    node.label,
    node.owner ?? "",
    JSON.stringify(node.facts)
  ].join("\n").toLowerCase();

const matchesQuery = (
  node: StartAgentGraphNode,
  query: StartAgentGraphQuery
): boolean => {
  const kind = nodeKindForQuery(query.kind);
  if (kind !== undefined && node.kind !== kind) {
    return false;
  }

  const text = query.text?.trim().toLowerCase();
  return text === undefined || text.length === 0 || searchableText(node).includes(text);
};

const compactJson = (value: unknown): string =>
  JSON.stringify(value);

const asFacts = (value: unknown): Readonly<Record<string, unknown>> =>
  value as Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const factString = (
  node: StartAgentGraphNode,
  key: string
): string | undefined => {
  const value = node.facts[key];
  return typeof value === "string" ? value : undefined;
};

const factRecord = (
  node: StartAgentGraphNode,
  key: string
): Readonly<Record<string, unknown>> | undefined => {
  const value = node.facts[key];
  return isRecord(value) ? value : undefined;
};

const recordString = (
  record: Readonly<Record<string, unknown>> | undefined,
  key: string
): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};

const recordBoolean = (
  record: Readonly<Record<string, unknown>> | undefined,
  key: string
): boolean | undefined => {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
};

const recordStringArray = (
  record: Readonly<Record<string, unknown>> | undefined,
  key: string
): readonly string[] => {
  const value = record?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
};

const routeParamNames = (
  node: StartAgentGraphNode
): readonly string[] => {
  const params = node.facts.params;
  if (!Array.isArray(params)) {
    return [];
  }
  return params.flatMap((param) =>
    isRecord(param) && typeof param.name === "string"
      ? [param.name]
      : []
  );
};

const inlineList = (
  values: readonly string[],
  empty = "none"
): string => values.length === 0 ? empty : values.join(", ");

const formatWire = (
  wire: Readonly<Record<string, unknown>> | undefined
): string => [
  `input ${recordBoolean(wire, "inputSchema") === true ? "present" : "missing"}`,
  `output ${recordBoolean(wire, "outputSchema") === true ? "present" : "missing"}`,
  `error ${recordBoolean(wire, "errorSchema") === true ? "present" : "missing"}`
].join(", ");

const formatBehavior = (
  behavior: Readonly<Record<string, unknown>> | undefined
): string => [
  `invalidates ${recordString(behavior, "invalidates") ?? "unknown"}`,
  `optimistic ${recordString(behavior, "optimistic") ?? "unknown"}`,
  `retry ${recordString(behavior, "retry") ?? "unknown"}`,
  `concurrency ${recordString(behavior, "concurrency") ?? "unknown"}`
].join(", ");

const formatFacts = (
  facts: Readonly<Record<string, unknown>>,
  indent: string
): readonly string[] =>
  Object.entries(facts).flatMap(([key, value]) =>
    value === undefined ? [] : [`${indent}${key}: ${compactJson(value)}`]
  );

const formatNode = (
  node: StartAgentGraphNode,
  edges: readonly StartAgentGraphEdge[]
): readonly string[] => {
  const relatedEdges = edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  return [
    `- [${node.kind}] ${node.label}`,
    `  id: ${node.id}`,
    `  status: ${node.status}`,
    ...(node.owner === undefined ? [] : [`  owner: ${node.owner}`]),
    ...formatFacts(node.facts, "  "),
    ...(relatedEdges.length === 0
      ? []
      : [
          "  edges:",
          ...relatedEdges.map((edge) =>
            edge.from === node.id
              ? `  - ${edge.kind} -> ${edge.to}`
              : `  - ${edge.kind} <- ${edge.from}`
          )
        ])
  ];
};

const nodeLabel = (
  graph: StartAgentGraph,
  id: string
): string => graph.nodes.find((node) => node.id === id)?.label ?? id;

const relatedLines = (
  graph: StartAgentGraph,
  node: StartAgentGraphNode,
  edges: readonly StartAgentGraphEdge[]
): readonly string[] => {
  const lines: string[] = [];
  for (const edge of edges) {
    if (edge.from !== node.id) {
      continue;
    }
    if (edge.kind === "ImplementedBy") {
      lines.push(`- module: ${nodeLabel(graph, edge.to)}`);
    } else if (edge.kind === "ServerImports") {
      lines.push(`- server module: ${nodeLabel(graph, edge.to)}`);
    } else if (edge.kind === "ClientImports") {
      lines.push(`- client module: ${nodeLabel(graph, edge.to)}`);
    } else if (edge.kind === "ExposesEndpoint") {
      lines.push(`- endpoint: ${nodeLabel(graph, edge.to)}`);
    }
  }
  return lines;
};

const titleForNode = (
  node: StartAgentGraphNode
): string => {
  switch (node.kind) {
    case "ServerFunction":
      return `Server function ${node.label}`;
    case "ResourceFamily":
      return `Resource family ${node.label}`;
    case "ResourceTag":
      return `Resource tag ${node.label}`;
    default:
      return `${node.kind} ${node.label}`;
  }
};

const formatRouteSummary = (
  node: StartAgentGraphNode
): readonly string[] => {
  const preloadResources = factRecord(node, "preloadResources");
  const preloadCollections = factRecord(node, "preloadCollections");
  return [
    `Params: ${inlineList(routeParamNames(node))}`,
    `Schemas: params ${factString(node, "paramsSchema") ?? "unknown"}, search ${factString(node, "searchSchema") ?? "unknown"}`,
    `Preloads: resources ${inlineList(recordStringArray(preloadResources, "families"))}; collections ${inlineList(recordStringArray(preloadCollections, "collections"))}`
  ];
};

const formatActionSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Wire schemas: ${formatWire(factRecord(node, "wire"))}`,
  `Behavior: ${formatBehavior(factRecord(node, "behavior"))}`
];

const formatServerFunctionSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Wire schemas: ${formatWire(factRecord(node, "wire"))}`
];

const formatFindingSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Issue: ${factString(node, "issue") ?? "unknown"}`,
  `Fix: ${factString(node, "edit") ?? "unknown"}`
];

const formatGenericSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Kind: ${node.kind}`,
  `Name: ${node.label}`
];

const publicStatus = (
  node: StartAgentGraphNode
): string => node.status === "known" ? "pass" : "needs attention";

const formatConciseNode = (
  graph: StartAgentGraph,
  node: StartAgentGraphNode,
  edges: readonly StartAgentGraphEdge[]
): readonly string[] => {
  const summary = node.kind === "Route"
    ? formatRouteSummary(node)
    : node.kind === "Action"
      ? formatActionSummary(node)
      : node.kind === "ServerFunction"
        ? formatServerFunctionSummary(node)
        : node.kind === "Finding"
          ? formatFindingSummary(node)
          : formatGenericSummary(node);
  const related = relatedLines(graph, node, edges);
  return [
    titleForNode(node),
    `Status: ${publicStatus(node)}`,
    ...(node.owner === undefined ? [] : [`Edit: ${node.owner}`]),
    "",
    ...summary,
    ...(related.length === 0
      ? []
      : [
          `Related: ${related
            .map((line) => line.replace(/^- /, ""))
            .join("; ")}`
        ])
  ];
};

const selfReviewText = (
  selfReview: StartAgentGraphSelfReview
): string =>
  [
    `policy ${selfReview.policyClean ? "clean" : "needs-attention"}`,
    `wire ${selfReview.wireComplete ? "complete" : "needs-attention"}`,
    `action behavior ${selfReview.actionBehaviorKnown ? "known" : "needs-attention"}`,
    `route preloads ${selfReview.routePreloadsDeclared ? "declared" : "needs-attention"}`
  ].join("; ");

const formatOverview = (
  graph: StartAgentGraph
): string => {
  const routes = graph.nodes
    .filter((node) => node.kind === "Route")
    .map((node) => node.label);
  const actions = graph.nodes
    .filter((node) => node.kind === "Action")
    .map((node) => node.label);
  const resources = graph.nodes
    .filter((node) => node.kind === "ResourceFamily")
    .map((node) => node.label);
  const collections = graph.nodes
    .filter((node) => node.kind === "Collection")
    .map((node) => node.label);
  const lines = [
    "Effect UI Start Agent Graph",
    `Status: ${graph.selfReview.status}`,
    `Scope: ${graph.summary.routes} routes, ${graph.summary.serverFunctions} server functions, ${graph.summary.actions} actions, ${graph.summary.resourceFamilies} resource families, ${graph.summary.collections} collections`,
    `Self review: ${selfReviewText(graph.selfReview)}`,
    "",
    "Affordances",
    `- routes: ${inlineList(routes)}`,
    `- actions: ${inlineList(actions)}`,
    `- resource families: ${inlineList(resources)}`,
    `- collections: ${inlineList(collections)}`
  ];

  if (graph.findings.length > 0) {
    lines.push(
      "",
      "Findings",
      ...graph.findings.map((finding) =>
        `- ${finding.kind}: ${finding.subject} (${finding.owner})`
      )
    );
  }

  return lines.join("\n");
};

const formatStartAgentGraphVerbose = (
  graph: StartAgentGraph,
  options: StartAgentGraphFormatOptions = {}
): string => {
  const lines = [
    "Effect UI Start Agent Graph",
    `status: ${graph.selfReview.status}`,
    `nodes: ${graph.summary.nodes}`,
    `edges: ${graph.summary.edges}`,
    `routes: ${graph.summary.routes}`,
    `server functions: ${graph.summary.serverFunctions}`,
    `actions: ${graph.summary.actions}`,
    `resource families: ${graph.summary.resourceFamilies}`,
    `resource tags: ${graph.summary.resourceTags}`,
    `collections: ${graph.summary.collections}`,
    `findings: ${graph.summary.findings}`,
    `self review: policy ${graph.selfReview.policyClean ? "clean" : "needs-attention"}, wire ${graph.selfReview.wireComplete ? "complete" : "needs-attention"}, action behavior ${graph.selfReview.actionBehaviorKnown ? "known" : "needs-attention"}, route preloads ${graph.selfReview.routePreloadsDeclared ? "declared" : "needs-attention"}`
  ];
  const query = options.query;
  const result = query === undefined ? undefined : queryStartAgentGraph(graph, query);
  const displayedNodes = result?.nodes ?? graph.nodes.filter((node) =>
    node.kind !== "Module" && node.kind !== "Endpoint"
  );
  const displayedEdges = result?.edges ?? graph.edges;

  if (query !== undefined) {
    lines.push(
      "",
      `Query: ${query.kind ?? "node"}${query.text === undefined ? "" : ` ${query.text}`}`,
      `matches: ${displayedNodes.length}`
    );
  }

  if (displayedNodes.length === 0) {
    lines.push("", "No matching nodes.");
    return lines.join("\n");
  }

  lines.push("", query === undefined ? "Affordances" : "Matches");
  for (const node of displayedNodes) {
    lines.push(...formatNode(node, displayedEdges));
  }

  return lines.join("\n");
};

export const createStartAgentGraph = (
  input: StartAgentGraphInput
): StartAgentGraph => {
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
      facts: routeFacts(route)
    });
    const moduleId = nodeId("module", route.moduleId);
    addNode(nodes, moduleNode(route.moduleId));
    addEdge(edges, {
      kind: "ImplementedBy",
      from: routeNodeId,
      to: moduleId,
      label: "implemented by route module"
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
            facts: { name: family, source: "route preload declaration" }
          });
        }
        addEdge(edges, {
          kind: "PreloadsResourceFamily",
          from: routeNodeId,
          to: familyId,
          label: "preloads resource family"
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
            facts: { name: collection, source: "route preload declaration" }
          });
        }
        addEdge(edges, {
          kind: "PreloadsCollection",
          from: routeNodeId,
          to: collectionId,
          label: "preloads collection"
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
      facts: serverFunctionFacts(serverFunction)
    });
    const serverModuleId = nodeId("module", serverFunction.server.module);
    addNode(nodes, moduleNode(serverFunction.server.module));
    addEdge(edges, {
      kind: "ServerImports",
      from: serverFunctionNodeId,
      to: serverModuleId,
      label: "server implementation module"
    });
    addEdge(edges, {
      kind: "ExposesEndpoint",
      from: serverFunctionNodeId,
      to: rpcEndpoint.id,
      label: "exposes RPC endpoint"
    });
    if (serverFunction.client._tag === "Import") {
      const clientModuleId = nodeId("module", serverFunction.client.module);
      addNode(nodes, moduleNode(serverFunction.client.module));
      addEdge(edges, {
        kind: "ClientImports",
        from: serverFunctionNodeId,
        to: clientModuleId,
        label: "client contract module"
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
      facts: actionFacts(action)
    });
    const serverModuleId = nodeId("module", action.server.module);
    addNode(nodes, moduleNode(action.server.module));
    addEdge(edges, {
      kind: "ServerImports",
      from: actionNodeId,
      to: serverModuleId,
      label: "server action module"
    });
    addEdge(edges, {
      kind: "ExposesEndpoint",
      from: actionNodeId,
      to: actionEndpoint.id,
      label: "exposes action endpoint"
    });
    if (action.client._tag === "Import") {
      const clientModuleId = nodeId("module", action.client.module);
      addNode(nodes, moduleNode(action.client.module));
      addEdge(edges, {
        kind: "ClientImports",
        from: actionNodeId,
        to: clientModuleId,
        label: "client action module"
      });
    }
  }

  for (const family of diagnostics.resourceFamilies) {
    addNode(nodes, {
      id: nodeId("resource-family", family.name),
      kind: "ResourceFamily",
      label: family.name,
      status: "known",
      facts: asFacts(family)
    });
  }

  for (const tag of diagnostics.resourceTags) {
    addNode(nodes, {
      id: nodeId("resource-tag", tag.name),
      kind: "ResourceTag",
      label: tag.name,
      status: "known",
      facts: asFacts(tag)
    });
  }

  for (const collection of diagnostics.collectionDefinitions) {
    addNode(nodes, {
      id: nodeId("collection", collection.name),
      kind: "Collection",
      label: collection.name,
      status: "known",
      facts: asFacts(collection)
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
      facts: finding as unknown as Readonly<Record<string, unknown>>
    });
    const moduleId = nodeId("module", ownerModule(finding.owner));
    if (!nodes.has(moduleId)) {
      addNode(nodes, moduleNode(ownerModule(finding.owner)));
    }
    addEdge(edges, {
      kind: "ReportsOn",
      from: findingNodeId,
      to: moduleId,
      label: "reports on owner"
    });
  });

  const nodeList = Array.from(nodes.values())
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.label.localeCompare(right.label) ||
      left.id.localeCompare(right.id)
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
      findings: findings.length
    },
    selfReview: {
      status: report.status,
      policyClean: (input.diagnosticsPolicyViolations?.length ?? 0) === 0,
      wireComplete: diagnostics.missingSchemas.length === 0,
      actionBehaviorKnown: diagnostics.unknownActionBehavior.length === 0,
      routePreloadsDeclared:
        diagnostics.unknownRoutePreloadResources.length === 0 &&
        diagnostics.unknownRoutePreloadCollections.length === 0,
      findingCount: findings.length
    },
    nodes: nodeList,
    edges,
    findings
  };
};

export const createStartAgentGraphEffect = (
  input: StartAgentGraphInput
): Effect.Effect<StartAgentGraph> =>
  Effect.succeed(createStartAgentGraph(input));

export const queryStartAgentGraph = (
  graph: StartAgentGraph,
  query: StartAgentGraphQuery = {}
): StartAgentGraphQueryResult => {
  const nodes = graph.nodes.filter((node) => matchesQuery(node, query));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    query,
    nodes,
    edges: graph.edges.filter((edge) => nodeIds.has(edge.from) || nodeIds.has(edge.to))
  };
};

export const queryStartAgentGraphEffect = (
  graph: StartAgentGraph,
  query: StartAgentGraphQuery = {}
): Effect.Effect<StartAgentGraphQueryResult> =>
  Effect.succeed(queryStartAgentGraph(graph, query));

const relationKindForNode = (
  node: StartAgentGraphNode
): StartAgentGraphImpactRelationKind => {
  switch (node.kind) {
    case "Action":
      return "action";
    case "Collection":
      return "collection";
    case "Endpoint":
      return "endpoint";
    case "Finding":
      return "finding";
    case "Module":
      return "module";
    case "ResourceFamily":
      return "resource";
    case "ResourceTag":
      return "resource-tag";
    case "Route":
      return "route";
    case "ServerFunction":
      return "server-function";
  }
};

const relationFromNode = (
  node: StartAgentGraphNode,
  reason: string
): StartAgentGraphImpactRelation => ({
  kind: relationKindForNode(node),
  label: node.label,
  reason,
  ...(node.owner === undefined ? {} : { owner: node.owner })
});

const relationKey = (
  relation: StartAgentGraphImpactRelation
): string =>
  `${relation.kind}:${relation.label}:${relation.owner ?? ""}`;

const dedupeRelations = (
  relations: readonly StartAgentGraphImpactRelation[]
): readonly StartAgentGraphImpactRelation[] => {
  const merged = new Map<
    string,
    {
      readonly relation: StartAgentGraphImpactRelation;
      readonly reasons: string[];
    }
  >();

  for (const relation of relations) {
    const key = relationKey(relation);
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        relation,
        reasons: [relation.reason]
      });
    } else if (!existing.reasons.includes(relation.reason)) {
      existing.reasons.push(relation.reason);
    }
  }

  return Array.from(merged.values()).map(({ relation, reasons }) => ({
    ...relation,
    reason: reasons.join(", ")
  }));
};

const dependencyReasonForEdge = (
  edge: StartAgentGraphEdge
): string => {
  switch (edge.kind) {
    case "ClientImports":
      return "client contract";
    case "ExposesEndpoint":
      return "transport endpoint";
    case "ImplementedBy":
      return "source module";
    case "PreloadsCollection":
      return "preloaded collection";
    case "PreloadsResourceFamily":
      return "preloaded resource";
    case "ReportsOn":
      return "reported owner";
    case "ServerImports":
      return "server implementation";
  }
};

const incomingReasonForEdge = (
  edge: StartAgentGraphEdge
): string => {
  switch (edge.kind) {
    case "ClientImports":
      return "imports this client contract";
    case "ExposesEndpoint":
      return "uses this endpoint";
    case "ImplementedBy":
      return "implemented here";
    case "PreloadsCollection":
      return "preloads this collection";
    case "PreloadsResourceFamily":
      return "preloads this resource";
    case "ReportsOn":
      return "reported finding";
    case "ServerImports":
      return "uses this server module";
  }
};

const graphNodeMap = (
  graph: StartAgentGraph
): ReadonlyMap<string, StartAgentGraphNode> =>
  new Map(graph.nodes.map((node) => [node.id, node]));

const dependenciesForNode = (
  graph: StartAgentGraph,
  node: StartAgentGraphNode
): readonly StartAgentGraphImpactRelation[] => {
  const nodes = graphNodeMap(graph);
  return dedupeRelations(
    graph.edges.flatMap((edge) => {
      if (edge.from !== node.id) {
        return [];
      }
      const target = nodes.get(edge.to);
      return target === undefined
        ? []
        : [relationFromNode(target, dependencyReasonForEdge(edge))];
    })
  );
};

const routesWithDeclaredPreloads = (
  graph: StartAgentGraph
): readonly StartAgentGraphNode[] =>
  graph.nodes.filter((candidate) => {
    if (candidate.kind !== "Route") {
      return false;
    }
    const preloadResources = factRecord(candidate, "preloadResources");
    const preloadCollections = factRecord(candidate, "preloadCollections");
    return (
      recordStringArray(preloadResources, "families").length > 0 ||
      recordStringArray(preloadCollections, "collections").length > 0
    );
  });

const mayAffectForNode = (
  graph: StartAgentGraph,
  node: StartAgentGraphNode
): readonly StartAgentGraphImpactRelation[] => {
  const nodes = graphNodeMap(graph);
  const incoming = graph.edges.flatMap((edge) => {
    if (edge.to !== node.id || edge.from === node.id) {
      return [];
    }
    const source = nodes.get(edge.from);
    return source === undefined
      ? []
      : [relationFromNode(source, incomingReasonForEdge(edge))];
  });

  if (
    node.kind !== "Action" ||
    recordString(factRecord(node, "behavior"), "invalidates") !== "present"
  ) {
    return dedupeRelations(incoming);
  }

  return dedupeRelations([
    ...incoming,
    ...routesWithDeclaredPreloads(graph).map((route) =>
      relationFromNode(route, "review invalidation against route preloads")
    )
  ]);
};

const contractsForNode = (
  node: StartAgentGraphNode
): readonly string[] => {
  switch (node.kind) {
    case "Route":
      return formatRouteSummary(node).map((line) => line.replace(/^([A-Z])/, (letter) =>
        letter.toLowerCase()
      ));
    case "Action":
      return [
        `wire schemas: ${formatWire(factRecord(node, "wire"))}`,
        `behavior: ${formatBehavior(factRecord(node, "behavior"))}`
      ];
    case "ServerFunction":
      return [`wire schemas: ${formatWire(factRecord(node, "wire"))}`];
    case "Finding":
      return formatFindingSummary(node).map((line) => line.replace(/^([A-Z])/, (letter) =>
        letter.toLowerCase()
      ));
    case "ResourceFamily":
    case "ResourceTag":
    case "Collection": {
      const source = factString(node, "source");
      return [
        `name: ${node.label}`,
        ...(source === undefined ? [] : [`source: ${source}`])
      ];
    }
    default:
      return [`name: ${node.label}`];
  }
};

const missingWireFields = (
  node: StartAgentGraphNode
): readonly string[] => {
  const wire = factRecord(node, "wire");
  return recordStringArray(wire, "missing");
};

const unknownBehaviorFields = (
  node: StartAgentGraphNode
): readonly string[] => {
  const behavior = factRecord(node, "behavior");
  return ["invalidates", "optimistic", "retry", "concurrency"].filter((field) =>
    recordString(behavior, field) === "unknown"
  );
};

const warningLinesForNode = (
  node: StartAgentGraphNode
): readonly string[] => {
  const warnings: string[] = [];
  const missing = missingWireFields(node);
  if (missing.length > 0) {
    warnings.push(`missing wire schema: ${inlineList(missing)}`);
  }

  const unknownBehavior = unknownBehaviorFields(node);
  if (unknownBehavior.length > 0) {
    warnings.push(`unknown action behavior: ${inlineList(unknownBehavior)}`);
  }

  if (node.kind === "Route" && factString(node, "preload") === "present") {
    const preloadResources = factRecord(node, "preloadResources");
    const preloadCollections = factRecord(node, "preloadCollections");
    if (recordString(preloadResources, "status") === "unknown") {
      warnings.push("preloadResources unknown");
    }
    if (recordString(preloadCollections, "status") === "unknown") {
      warnings.push("preloadCollections unknown");
    }
  }

  if (node.kind === "Finding") {
    const issue = factString(node, "issue");
    if (issue !== undefined) {
      warnings.push(issue);
    }
  }

  return warnings.length === 0 && node.status === "needs-attention"
    ? ["status needs attention"]
    : warnings;
};

const editTargetForNode = (
  node: StartAgentGraphNode
): string | undefined =>
  node.owner ?? (node.kind === "Module" ? node.label : undefined);

export const createStartAgentGraphImpact = (
  graph: StartAgentGraph,
  query: StartAgentGraphQuery,
  options: StartAgentGraphImpactOptions = {}
): StartAgentGraphImpact => {
  const result = queryStartAgentGraph(graph, query);
  return {
    query,
    matches: result.nodes.length,
    items: result.nodes.map((node) => {
      const editTarget = editTargetForNode(node);
      return {
        node,
        ...(editTarget === undefined ? {} : { editTarget }),
        contracts: contractsForNode(node),
        dependencies: dependenciesForNode(graph, node),
        mayAffect: mayAffectForNode(graph, node),
        warnings: warningLinesForNode(node),
        verify: startDiagnosticsCliVerifyCommandsForQuery(query, options)
      };
    })
  };
};

export const createStartAgentGraphImpactEffect = (
  graph: StartAgentGraph,
  query: StartAgentGraphQuery,
  options: StartAgentGraphImpactOptions = {}
): Effect.Effect<StartAgentGraphImpact> =>
  Effect.succeed(createStartAgentGraphImpact(graph, query, options));

const impactRelationLimit = 6;

const formatRelations = (
  title: string,
  relations: readonly StartAgentGraphImpactRelation[]
): readonly string[] => {
  if (relations.length === 0) {
    return [];
  }

  const displayed = relations.slice(0, impactRelationLimit);
  return [
    "",
    title,
    ...displayed.map((relation) =>
      `- ${relation.kind} ${relation.label} (${relation.reason})`
    ),
    ...(relations.length > displayed.length
      ? [`- +${relations.length - displayed.length} more`]
      : [])
  ];
};

const formatImpactItem = (
  item: StartAgentGraphImpactItem
): readonly string[] => [
  titleForNode(item.node),
  `Status: ${publicStatus(item.node)}`,
  ...(item.editTarget === undefined ? [] : [`Edit: ${item.editTarget}`]),
  "",
  "Contracts",
  ...item.contracts.map((contract) => `- ${contract}`),
  ...formatRelations("Depends on", item.dependencies),
  ...formatRelations("May affect", item.mayAffect),
  ...(item.warnings.length === 0
    ? []
    : [
        "",
        "Warnings",
        ...item.warnings.map((warning) => `- ${warning}`)
      ]),
  "",
  "Verify",
  ...item.verify.map((command) => `- ${command}`)
];

export const formatStartAgentGraphImpact = (
  impact: StartAgentGraphImpact
): string => {
  const query = impact.query;
  const lines = [
    `Impact: ${query.kind ?? "node"}${query.text === undefined ? "" : ` ${query.text}`}`,
    `Matches: ${impact.matches}`
  ];

  if (impact.items.length === 0) {
    lines.push("", "No matching nodes.");
    return lines.join("\n");
  }

  for (const [index, item] of impact.items.entries()) {
    lines.push("", ...formatImpactItem(item));
    if (index < impact.items.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
};

export const formatStartAgentGraph = (
  graph: StartAgentGraph,
  options: StartAgentGraphFormatOptions = {}
): string => {
  if (options.verbose === true) {
    return formatStartAgentGraphVerbose(graph, options);
  }

  const query = options.query;
  if (query === undefined) {
    return formatOverview(graph);
  }

  const result = queryStartAgentGraph(graph, query);
  const lines = [
    `Query: ${query.kind ?? "node"}${query.text === undefined ? "" : ` ${query.text}`}`,
    `Matches: ${result.nodes.length}`
  ];

  if (result.nodes.length === 0) {
    lines.push("", "No matching nodes.");
    return lines.join("\n");
  }

  for (const [index, node] of result.nodes.entries()) {
    lines.push("", ...formatConciseNode(graph, node, result.edges));
    if (index < result.nodes.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
};
