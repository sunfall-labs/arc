import type {
  StartAppGraph,
  StartAppGraphDiagnostics
} from "./app-graph.js";
import type {
  StartAppGraphDiagnosticsPolicyViolation
} from "./start-app-graph-diagnostics-policy.js";
import type {
  StartDiagnosticsReport,
  StartDiagnosticsReportFinding
} from "./diagnostics-report.js";
import type {
  StartAgentGraphQueryKind
} from "./start-agent-graph-vocabulary.js";
export type {
  StartAgentGraphQueryKind
} from "./start-agent-graph-vocabulary.js";

/** Semantic node families shown in Start diagnostics graphs and impact briefs. */
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

/** Whether a graph node is complete enough for the configured diagnostics policy. */
export type StartAgentGraphNodeStatus = "known" | "needs-attention";

/** One agent-readable fact node in the Start app graph projection. */
export interface StartAgentGraphNode {
  /** Stable graph-local id such as `route:/projects/:id` or `action:Project.rename`. */
  readonly id: string;
  /** Semantic family used by query filters and impact relation mapping. */
  readonly kind: StartAgentGraphNodeKind;
  /** Human-readable name displayed by CLI and devtools surfaces. */
  readonly label: string;
  /** Completion status derived from app graph diagnostics and policy findings. */
  readonly status: StartAgentGraphNodeStatus;
  /** Source module, file, or owner string to edit when this node needs attention. */
  readonly owner?: string;
  /** Detached diagnostic data for agents that need details beyond the label. */
  readonly facts: Readonly<Record<string, unknown>>;
}

/** Relationship labels used between Start agent graph nodes. */
export type StartAgentGraphEdgeKind =
  | "ClientImports"
  | "ExposesEndpoint"
  | "ImplementedBy"
  | "PreloadsCollection"
  | "PreloadsResourceFamily"
  | "ReportsOn"
  | "ServerImports";

/** Directed relation between two Start agent graph nodes. */
export interface StartAgentGraphEdge {
  /** Stable graph-local relation id. */
  readonly id: string;
  /** Semantic relation family used by formatters and impact planning. */
  readonly kind: StartAgentGraphEdgeKind;
  /** Source node id. */
  readonly from: string;
  /** Target node id. */
  readonly to: string;
  /** Human-readable relation label. */
  readonly label: string;
}

/** Summary of whether the graph can describe itself well enough for agents. */
export interface StartAgentGraphSelfReview {
  readonly status: StartDiagnosticsReport["status"];
  readonly policyClean: boolean;
  readonly wireComplete: boolean;
  readonly actionBehaviorKnown: boolean;
  readonly routePreloadsDeclared: boolean;
  readonly findingCount: number;
}

/** Count summary for the graph's major node families. */
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

/**
 * Agent-readable projection of Start routes, endpoints, resources, collections,
 * diagnostics findings, and repair relations.
 */
export interface StartAgentGraph {
  /** Graph schema version. */
  readonly version: 1;
  /** Family counts for quick CLI summaries. */
  readonly summary: StartAgentGraphSummary;
  /** High-level completeness flags for build-policy and graph health. */
  readonly selfReview: StartAgentGraphSelfReview;
  /** All known nodes in deterministic order. */
  readonly nodes: readonly StartAgentGraphNode[];
  /** Directed relations between nodes. */
  readonly edges: readonly StartAgentGraphEdge[];
  /** Grouped diagnostics findings used by graph and impact output. */
  readonly findings: readonly StartDiagnosticsReportFinding[];
}

/** Inputs needed to derive the agent graph from Start app graph diagnostics. */
export interface StartAgentGraphInput {
  readonly graph?: StartAppGraph;
  readonly diagnostics: StartAppGraphDiagnostics;
  readonly diagnosticsPolicyViolations?: readonly StartAppGraphDiagnosticsPolicyViolation[];
}

/** Query used by graph search, CLI subcommands, and impact planning. */
export interface StartAgentGraphQuery {
  /** Optional semantic node family to match. Omit or use `node` to search all nodes. */
  readonly kind?: StartAgentGraphQueryKind;
  /** Optional case-insensitive text matched against labels, owners, ids, and facts. */
  readonly text?: string;
}

/** Formatting options for concise or verbose Start agent graph output. */
export interface StartAgentGraphFormatOptions {
  readonly query?: StartAgentGraphQuery;
  readonly verbose?: boolean;
}

/** Result of filtering a graph; edges include any relation touching a match. */
export interface StartAgentGraphQueryResult {
  readonly query: StartAgentGraphQuery;
  readonly nodes: readonly StartAgentGraphNode[];
  readonly edges: readonly StartAgentGraphEdge[];
}

/** Relation families used in impact dependency and may-affect lists. */
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

/** One dependency or possible affected owner in an impact report. */
export interface StartAgentGraphImpactRelation {
  readonly kind: StartAgentGraphImpactRelationKind;
  readonly label: string;
  readonly reason: string;
  readonly owner?: string;
}

/** Impact details for one matched graph node. */
export interface StartAgentGraphImpactItem {
  readonly node: StartAgentGraphNode;
  readonly editTarget?: string;
  readonly contracts: readonly string[];
  readonly dependencies: readonly StartAgentGraphImpactRelation[];
  readonly mayAffect: readonly StartAgentGraphImpactRelation[];
  readonly warnings: readonly string[];
  readonly verify: readonly string[];
}

/** Agent-facing impact report for a Start graph query. */
export interface StartAgentGraphImpact {
  readonly query: StartAgentGraphQuery;
  readonly matches: number;
  readonly items: readonly StartAgentGraphImpactItem[];
}

/** Options for impact reports that need root-aware verification commands. */
export interface StartAgentGraphImpactOptions {
  readonly root?: string;
  readonly configFile?: string | false;
  readonly mode?: string;
}
