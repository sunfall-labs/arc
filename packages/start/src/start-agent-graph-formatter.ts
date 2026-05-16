import {
  formatActionSummary,
  formatFindingSummary,
  formatGenericSummary,
  formatRouteSummary,
  formatServerFunctionSummary,
  inlineList,
  publicStatus,
  titleForNode
} from "./start-agent-graph-display.js";
import {
  queryStartAgentGraph
} from "./start-agent-graph-query.js";
import type {
  StartAgentGraph,
  StartAgentGraphEdge,
  StartAgentGraphFormatOptions,
  StartAgentGraphImpact,
  StartAgentGraphImpactItem,
  StartAgentGraphImpactRelation,
  StartAgentGraphNode,
  StartAgentGraphSelfReview
} from "./start-agent-graph-contract.js";

const compactJson = (value: unknown): string =>
  JSON.stringify(value);

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
