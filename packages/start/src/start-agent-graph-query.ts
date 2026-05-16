import { Effect } from "effect";
import type {
  StartAgentGraph,
  StartAgentGraphNode,
  StartAgentGraphQuery,
  StartAgentGraphQueryResult
} from "./start-agent-graph-contract.js";
import { startAgentGraphNodeKindForQuery } from "./start-agent-graph-vocabulary.js";

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
  const kind = startAgentGraphNodeKindForQuery(query.kind);
  if (kind !== undefined && node.kind !== kind) {
    return false;
  }

  const text = query.text?.trim().toLowerCase();
  return text === undefined || text.length === 0 || searchableText(node).includes(text);
};

/**
 * Filters a Start agent graph by semantic node kind and optional text.
 *
 * Returned edges include any edge touching a matched node, which keeps the
 * result useful for diagnostics CLI output and impact planning.
 */
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

/** Effect wrapper for `queryStartAgentGraph(...)`, useful in CLI pipelines. */
export const queryStartAgentGraphEffect = (
  graph: StartAgentGraph,
  query: StartAgentGraphQuery = {}
): Effect.Effect<StartAgentGraphQueryResult> =>
  Effect.succeed(queryStartAgentGraph(graph, query));
