import { Effect } from "effect";
import {
  factRecord,
  factString,
  formatBehavior,
  formatFindingSummary,
  formatRouteSummary,
  formatWire,
  inlineList,
  recordString,
  recordStringArray,
} from "./start-agent-graph-display.js";
import { queryStartAgentGraph } from "./start-agent-graph-query.js";
import { startAgentGraphRelationKindForNode } from "./start-agent-graph-vocabulary.js";
import { startDiagnosticsCliVerifyCommandsForQuery } from "./start-diagnostics-cli-contract.js";
import type {
  StartAgentGraph,
  StartAgentGraphEdge,
  StartAgentGraphImpact,
  StartAgentGraphImpactOptions,
  StartAgentGraphImpactRelation,
  StartAgentGraphNode,
  StartAgentGraphQuery,
} from "./start-agent-graph-contract.js";

const relationFromNode = (
  node: StartAgentGraphNode,
  reason: string,
): StartAgentGraphImpactRelation => ({
  kind: startAgentGraphRelationKindForNode(node.kind),
  label: node.label,
  reason,
  ...(node.owner === undefined ? {} : { owner: node.owner }),
});

const relationKey = (relation: StartAgentGraphImpactRelation): string =>
  `${relation.kind}:${relation.label}:${relation.owner ?? ""}`;

const dedupeRelations = (
  relations: readonly StartAgentGraphImpactRelation[],
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
        reasons: [relation.reason],
      });
    } else if (!existing.reasons.includes(relation.reason)) {
      existing.reasons.push(relation.reason);
    }
  }

  return Array.from(merged.values()).map(({ relation, reasons }) => ({
    ...relation,
    reason: reasons.join(", "),
  }));
};

const dependencyReasonForEdge = (edge: StartAgentGraphEdge): string => {
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

const incomingReasonForEdge = (edge: StartAgentGraphEdge): string => {
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

const graphNodeMap = (graph: StartAgentGraph): ReadonlyMap<string, StartAgentGraphNode> =>
  new Map(graph.nodes.map((node) => [node.id, node]));

const dependenciesForNode = (
  graph: StartAgentGraph,
  node: StartAgentGraphNode,
): readonly StartAgentGraphImpactRelation[] => {
  const nodes = graphNodeMap(graph);
  return dedupeRelations(
    graph.edges.flatMap((edge) => {
      if (edge.from !== node.id) {
        return [];
      }
      const target = nodes.get(edge.to);
      return target === undefined ? [] : [relationFromNode(target, dependencyReasonForEdge(edge))];
    }),
  );
};

const routesWithDeclaredPreloads = (graph: StartAgentGraph): readonly StartAgentGraphNode[] =>
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
  node: StartAgentGraphNode,
): readonly StartAgentGraphImpactRelation[] => {
  const nodes = graphNodeMap(graph);
  const incoming = graph.edges.flatMap((edge) => {
    if (edge.to !== node.id || edge.from === node.id) {
      return [];
    }
    const source = nodes.get(edge.from);
    return source === undefined ? [] : [relationFromNode(source, incomingReasonForEdge(edge))];
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
      relationFromNode(route, "review invalidation against route preloads"),
    ),
  ]);
};

const contractsForNode = (node: StartAgentGraphNode): readonly string[] => {
  switch (node.kind) {
    case "Route":
      return formatRouteSummary(node).map((line) =>
        line.replace(/^([A-Z])/, (letter) => letter.toLowerCase()),
      );
    case "Action":
      return [
        `wire schemas: ${formatWire(factRecord(node, "wire"))}`,
        `behavior: ${formatBehavior(factRecord(node, "behavior"))}`,
      ];
    case "ServerFunction":
      return [`wire schemas: ${formatWire(factRecord(node, "wire"))}`];
    case "Finding":
      return formatFindingSummary(node).map((line) =>
        line.replace(/^([A-Z])/, (letter) => letter.toLowerCase()),
      );
    case "ResourceFamily":
    case "ResourceTag":
    case "Collection": {
      const source = factString(node, "source");
      return [`name: ${node.label}`, ...(source === undefined ? [] : [`source: ${source}`])];
    }
    default:
      return [`name: ${node.label}`];
  }
};

const missingWireFields = (node: StartAgentGraphNode): readonly string[] => {
  const wire = factRecord(node, "wire");
  return recordStringArray(wire, "missing");
};

const unknownBehaviorFields = (node: StartAgentGraphNode): readonly string[] => {
  const behavior = factRecord(node, "behavior");
  return ["invalidates", "optimistic", "retry", "concurrency"].filter(
    (field) => recordString(behavior, field) === "unknown",
  );
};

const warningLinesForNode = (node: StartAgentGraphNode): readonly string[] => {
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

const editTargetForNode = (node: StartAgentGraphNode): string | undefined =>
  node.owner ?? (node.kind === "Module" ? node.label : undefined);

/**
 * Builds an agent-readable impact brief for the nodes matched by a graph query.
 *
 * The result names edit targets, direct dependencies, likely affected callers,
 * warnings, and shell-safe verification commands.
 */
export const createStartAgentGraphImpact = (
  graph: StartAgentGraph,
  query: StartAgentGraphQuery,
  options: StartAgentGraphImpactOptions = {},
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
        verify: startDiagnosticsCliVerifyCommandsForQuery(query, options),
      };
    }),
  };
};

/** Effect wrapper for `createStartAgentGraphImpact(...)`. */
export const createStartAgentGraphImpactEffect = (
  graph: StartAgentGraph,
  query: StartAgentGraphQuery,
  options: StartAgentGraphImpactOptions = {},
): Effect.Effect<StartAgentGraphImpact> =>
  Effect.succeed(createStartAgentGraphImpact(graph, query, options));
