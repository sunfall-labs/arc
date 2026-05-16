import { Effect } from "effect";
import type {
  StartAgentGraph,
  StartAgentGraphNode,
  StartAgentGraphNodeKind,
  StartAgentGraphQuery,
  StartAgentGraphQueryKind,
  StartAgentGraphQueryResult
} from "./start-agent-graph-contract.js";

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
