import type {
  StartAppGraph,
  StartAppGraphDiagnostics,
  StartAppGraphDiagnosticsPolicyViolation
} from "./app-graph.js";
import type {
  StartDiagnosticsReport,
  StartDiagnosticsReportFinding
} from "./diagnostics-report.js";

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
