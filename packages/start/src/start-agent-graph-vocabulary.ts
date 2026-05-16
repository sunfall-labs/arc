import type {
  StartAgentGraphImpactRelationKind,
  StartAgentGraphNodeKind
} from "./start-agent-graph-contract.js";

/**
 * Query kinds exposed by the Start agent graph CLI, query helpers, and impact
 * planner.
 *
 * This catalog is the semantic source of truth for graph kind vocabulary. Add
 * new node families here before wiring CLI subcommands or impact relations.
 */
export const startAgentGraphQueryKinds = [
  "action",
  "collection",
  "endpoint",
  "finding",
  "module",
  "node",
  "resource",
  "resource-tag",
  "route",
  "server-function"
] as const;

/** Query filters accepted by Start graph and impact helpers. */
export type StartAgentGraphQueryKind = typeof startAgentGraphQueryKinds[number];

const startAgentGraphQueryKindSet = new Set<StartAgentGraphQueryKind>(
  startAgentGraphQueryKinds
);

/** Checks whether an argv value is one of the Start agent graph query kinds. */
export const isStartAgentGraphQueryKind = (
  value: string
): value is StartAgentGraphQueryKind =>
  startAgentGraphQueryKindSet.has(value as StartAgentGraphQueryKind);

/** Human-readable query-kind list for usage and validation messages. */
export const startAgentGraphQueryKindsText = (): string =>
  startAgentGraphQueryKinds.join(", ");

const nodeKindByQueryKind = {
  action: "Action",
  collection: "Collection",
  endpoint: "Endpoint",
  finding: "Finding",
  module: "Module",
  node: undefined,
  resource: "ResourceFamily",
  "resource-tag": "ResourceTag",
  route: "Route",
  "server-function": "ServerFunction"
} as const satisfies Record<StartAgentGraphQueryKind, StartAgentGraphNodeKind | undefined>;

/** Maps a query kind to the graph node kind it filters, if any. */
export const startAgentGraphNodeKindForQuery = (
  kind: StartAgentGraphQueryKind | undefined
): StartAgentGraphNodeKind | undefined =>
  kind === undefined ? undefined : nodeKindByQueryKind[kind];

const relationKindByNodeKind = {
  Action: "action",
  Collection: "collection",
  Endpoint: "endpoint",
  Finding: "finding",
  Module: "module",
  ResourceFamily: "resource",
  ResourceTag: "resource-tag",
  Route: "route",
  ServerFunction: "server-function"
} as const satisfies Record<StartAgentGraphNodeKind, StartAgentGraphImpactRelationKind>;

/** Maps a graph node kind to the relation kind used in impact reports. */
export const startAgentGraphRelationKindForNode = (
  kind: StartAgentGraphNodeKind
): StartAgentGraphImpactRelationKind =>
  relationKindByNodeKind[kind];
