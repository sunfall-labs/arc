import type {
  StartAppGraphActionDiagnostics,
  StartAppGraphDiagnostics,
  StartAppGraphServerFunctionDiagnostics,
  StartAppGraphWireSchemaField
} from "./app-graph.js";
import type {
  StartAppGraphDiagnosticsPolicyViolation
} from "./start-app-graph-diagnostics-policy.js";

/** Overall Start diagnostics status used by CI, CLI, and agent repair reports. */
export type StartDiagnosticsReportStatus = "pass" | "needs-attention";

/** Finding families emitted from app graph diagnostics and build policy checks. */
export type StartDiagnosticsReportFindingKind =
  | "route-preload-resources"
  | "route-preload-collections"
  | "wire-schema"
  | "action-behavior"
  | "policy-violation";

/** One actionable repair item grouped by the file, module, or policy owner. */
export interface StartDiagnosticsReportFinding {
  /** Finding family used by graph nodes and CLI filters. */
  readonly kind: StartDiagnosticsReportFindingKind;
  /** File, module export, or policy area that should own the edit. */
  readonly owner: string;
  /** Route, action, server function, or policy subject being reported. */
  readonly subject: string;
  /** Human-readable problem statement. */
  readonly issue: string;
  /** Suggested edit for agents or developers. */
  readonly edit: string;
  /** Extra stable facts for CLI output and devtools panels. */
  readonly details: readonly string[];
}

/** All findings owned by one edit target. */
export interface StartDiagnosticsReportOwnerGroup {
  readonly owner: string;
  readonly findings: readonly StartDiagnosticsReportFinding[];
}

/** Count summary for the diagnostics report and graph self-review. */
export interface StartDiagnosticsReportSummary {
  readonly routes: number;
  readonly serverFunctions: number;
  readonly actions: number;
  readonly resourceFamilies: number;
  readonly resourceTags: number;
  readonly collections: number;
  readonly missingSchemas: number;
  readonly unknownActionBehavior: number;
  readonly unknownRoutePreloadResources: number;
  readonly unknownRoutePreloadCollections: number;
  readonly policyViolations: number;
  readonly findingCount: number;
}

/** Grouped repair report produced from Start app graph diagnostics. */
export interface StartDiagnosticsReport {
  /** `pass` when no findings exist; `needs-attention` otherwise. */
  readonly status: StartDiagnosticsReportStatus;
  readonly summary: StartDiagnosticsReportSummary;
  readonly findings: readonly StartDiagnosticsReportFinding[];
  readonly groups: readonly StartDiagnosticsReportOwnerGroup[];
}

/** Input accepted by the diagnostics report builder. */
export interface StartDiagnosticsReportInput {
  readonly diagnostics: StartAppGraphDiagnostics;
  readonly diagnosticsPolicyViolations?: readonly StartAppGraphDiagnosticsPolicyViolation[];
}

const ownerForServerFunction = (
  entry: StartAppGraphServerFunctionDiagnostics | undefined,
  fallback: string
): string =>
  entry === undefined
    ? fallback
    : `${entry.server.module}#${entry.server.exportName}`;

const ownerForAction = (
  entry: StartAppGraphActionDiagnostics | undefined,
  fallback: string
): string =>
  entry === undefined
    ? fallback
    : `${entry.server.module}#${entry.server.exportName}`;

const missingWireFields = (
  entry: {
    readonly input: boolean;
    readonly output: boolean;
    readonly error: boolean;
  }
): readonly StartAppGraphWireSchemaField[] => [
  ...(entry.input ? [] : ["input" as const]),
  ...(entry.output ? [] : ["output" as const]),
  ...(entry.error ? [] : ["error" as const])
];

const inlineList = (values: readonly string[]): string => {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return values[0]!;
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
};

const quotedList = (values: readonly string[]): string =>
  inlineList(values.map((value) => `\`${value}\``));

const schemaEdit = (
  kind: "serverFunction" | "action",
  fields: readonly StartAppGraphWireSchemaField[]
): string =>
  kind === "serverFunction"
    ? `Add ${quotedList(fields)} schema${fields.length === 1 ? "" : "s"} to this Server function contract or manifest entry.`
    : `Add ${quotedList(fields)} schema${fields.length === 1 ? "" : "s"} to \`Action.define(...)\` or this action manifest entry.`;

const unknownBehaviorFields = (
  entry: StartAppGraphDiagnostics["unknownActionBehavior"][number]
): readonly string[] => [
  ...(entry.invalidates === "unknown" ? ["invalidates"] : []),
  ...(entry.optimistic === "unknown" ? ["optimistic"] : []),
  ...(entry.retry === "unknown" ? ["retry"] : []),
  ...(entry.concurrency === "unknown" ? ["concurrency"] : [])
];

const actionBehaviorEdit = (fields: readonly string[]): string =>
  `Declare action behavior metadata for ${quotedList(fields)} by generating the manifest from \`Action.define(...)\`, or set the matching fields on the hand-written action manifest entry.`;

const policyViolationFinding = (
  violation: StartAppGraphDiagnosticsPolicyViolation
): StartDiagnosticsReportFinding => {
  return {
    kind: "policy-violation",
    owner: "StartBuildPolicy.diagnostics",
    subject: violation._tag,
    issue: violation.message,
    edit: "Fix the underlying diagnostic finding, or relax `StartBuildPolicy.diagnostics` if this route policy is intentionally not required.",
    details: [`tag: ${violation._tag}`]
  };
};

const groupFindings = (
  findings: readonly StartDiagnosticsReportFinding[]
): readonly StartDiagnosticsReportOwnerGroup[] => {
  const grouped = new Map<string, StartDiagnosticsReportFinding[]>();
  for (const finding of findings) {
    const group = grouped.get(finding.owner);
    if (group === undefined) {
      grouped.set(finding.owner, [finding]);
    } else {
      group.push(finding);
    }
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, ownerFindings]) => ({
      owner,
      findings: ownerFindings
    }));
};

/**
 * Converts Start app graph diagnostics into a grouped repair report.
 *
 * Findings include schema gaps, unknown action behavior, unknown route preload
 * declarations, and diagnostics policy violations.
 */
export const createStartDiagnosticsReport = (
  input: StartDiagnosticsReportInput
): StartDiagnosticsReport => {
  const diagnostics = input.diagnostics;
  const serverFunctions = new Map(
    diagnostics.serverFunctionModules.map((entry) => [entry.name, entry])
  );
  const actions = new Map(
    diagnostics.actionModules.map((entry) => [entry.name, entry])
  );
  const findings: StartDiagnosticsReportFinding[] = [
    ...diagnostics.unknownRoutePreloadResources.map((entry): StartDiagnosticsReportFinding => ({
      kind: "route-preload-resources",
      owner: entry.filePath,
      subject: `${entry.routePath} (${entry.routeId})`,
      issue: "Route preload is present, but the route does not declare which resource families it preloads.",
      edit: "Add `preloadResources: [...]` to this route definition; use an empty array when the preload intentionally touches no resources.",
      details: [
        `module: ${entry.moduleId}`,
        `current preloadResources status: ${entry.preloadResources.status}`
      ]
    })),
    ...diagnostics.unknownRoutePreloadCollections.map((entry): StartDiagnosticsReportFinding => ({
      kind: "route-preload-collections",
      owner: entry.filePath,
      subject: `${entry.routePath} (${entry.routeId})`,
      issue: "Route preload is present, but the route does not declare which DB collections it preloads.",
      edit: "Add `preloadCollections: [...]` to this route definition; use an empty array when the preload intentionally touches no collections.",
      details: [
        `module: ${entry.moduleId}`,
        `current preloadCollections status: ${entry.preloadCollections.status}`
      ]
    })),
    ...diagnostics.missingSchemas.map((entry): StartDiagnosticsReportFinding => {
      const fields = missingWireFields(entry);
      const subject = `${entry.kind}: ${entry.name}`;
      return {
        kind: "wire-schema",
        owner: entry.kind === "serverFunction"
          ? ownerForServerFunction(serverFunctions.get(entry.name), entry.name)
          : ownerForAction(actions.get(entry.name), entry.name),
        subject,
        issue: `${subject} is missing ${quotedList(fields)} wire schema${fields.length === 1 ? "" : "s"}.`,
        edit: schemaEdit(entry.kind, fields),
        details: [
          `input schema: ${entry.input ? "present" : "missing"}`,
          `output schema: ${entry.output ? "present" : "missing"}`,
          `error schema: ${entry.error ? "present" : "missing"}`
        ]
      };
    }),
    ...diagnostics.unknownActionBehavior.map((entry): StartDiagnosticsReportFinding => {
      const fields = unknownBehaviorFields(entry);
      return {
        kind: "action-behavior",
        owner: ownerForAction(actions.get(entry.name), entry.name),
        subject: `action: ${entry.name}`,
        issue: `Action behavior metadata is unknown for ${quotedList(fields)}.`,
        edit: actionBehaviorEdit(fields),
        details: [
          `invalidates: ${entry.invalidates}`,
          `optimistic: ${entry.optimistic}`,
          `retry: ${entry.retry}`,
          `concurrency: ${entry.concurrency}`
        ]
      };
    }),
    ...(input.diagnosticsPolicyViolations ?? []).map(policyViolationFinding)
  ];
  const summary: StartDiagnosticsReportSummary = {
    routes: diagnostics.routeCount,
    serverFunctions: diagnostics.serverFunctionCount,
    actions: diagnostics.actionCount,
    resourceFamilies: diagnostics.resourceFamilies.length,
    resourceTags: diagnostics.resourceTags.length,
    collections: diagnostics.collectionDefinitions.length,
    missingSchemas: diagnostics.missingSchemas.length,
    unknownActionBehavior: diagnostics.unknownActionBehavior.length,
    unknownRoutePreloadResources: diagnostics.unknownRoutePreloadResources.length,
    unknownRoutePreloadCollections: diagnostics.unknownRoutePreloadCollections.length,
    policyViolations: input.diagnosticsPolicyViolations?.length ?? 0,
    findingCount: findings.length
  };

  return {
    status: findings.length === 0 ? "pass" : "needs-attention",
    summary,
    findings,
    groups: groupFindings(findings)
  };
};
