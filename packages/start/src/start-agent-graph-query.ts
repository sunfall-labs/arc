import { Effect } from "effect";
import type {
  StartAgentGraph,
  StartAgentGraphNode,
  StartAgentGraphQuery,
  StartAgentGraphQueryResult
} from "./start-agent-graph-contract.js";
import { startAgentGraphNodeKindForQuery } from "./start-agent-graph-vocabulary.js";

const maxFactTextDepth = 4;
const maxFactTextEntries = 64;
const maxFactTextLength = 4096;
const maxFactTextPartLength = 256;

interface FactTextState {
  readonly seen: WeakSet<object>;
  readonly parts: string[];
  entries: number;
  length: number;
  truncated: boolean;
}

const appendFactTextPart = (
  state: FactTextState,
  part: string
): void => {
  if (state.length >= maxFactTextLength) {
    state.truncated = true;
    return;
  }

  const boundedPart = part.length > maxFactTextPartLength
    ? part.slice(0, maxFactTextPartLength)
    : part;
  const remaining = maxFactTextLength - state.length;
  const text = boundedPart.length > remaining
    ? boundedPart.slice(0, remaining)
    : boundedPart;
  if (text.length < boundedPart.length) {
    state.truncated = true;
  }
  state.parts.push(text);
  state.length += text.length + 1;
};

const visitFactText = (
  state: FactTextState,
  value: unknown,
  depth: number
): void => {
  if (state.length >= maxFactTextLength) {
    state.truncated = true;
    return;
  }

  if (value === null || value === undefined) {
    appendFactTextPart(state, String(value));
    return;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
      appendFactTextPart(state, String(value));
      return;
    case "function":
      appendFactTextPart(state, value.name.length > 0 ? value.name : "[Function]");
      return;
    case "object":
      break;
  }

  if (state.seen.has(value)) {
    appendFactTextPart(state, "[Circular]");
    return;
  }
  if (depth >= maxFactTextDepth) {
    appendFactTextPart(state, "[Object]");
    return;
  }

  state.seen.add(value);

  if (Array.isArray(value)) {
    appendFactTextPart(state, "Array");
    for (let index = 0; index < value.length && index < maxFactTextEntries; index++) {
      if (state.entries >= maxFactTextEntries) {
        state.truncated = true;
        break;
      }
      state.entries++;
      visitFactText(state, value[index], depth + 1);
    }
    if (value.length > maxFactTextEntries) {
      state.truncated = true;
    }
    return;
  }

  appendFactTextPart(state, Object.prototype.toString.call(value));
  try {
    for (const key in value as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      if (state.entries >= maxFactTextEntries) {
        state.truncated = true;
        break;
      }
      state.entries++;
      appendFactTextPart(state, key);
      visitFactText(state, (value as Record<string, unknown>)[key], depth + 1);
    }
  } catch {
    appendFactTextPart(state, "[Uninspectable]");
  }
};

const safeBoundedFactText = (
  facts: Readonly<Record<string, unknown>>
): string => {
  const state: FactTextState = {
    seen: new WeakSet(),
    parts: [],
    entries: 0,
    length: 0,
    truncated: false
  };
  visitFactText(state, facts, 0);
  if (state.truncated) {
    state.parts.push("[Truncated]");
  }
  return state.parts.join(" ");
};

const searchableText = (node: StartAgentGraphNode): string =>
  [
    node.id,
    node.kind,
    node.label,
    node.owner ?? "",
    safeBoundedFactText(node.facts)
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
