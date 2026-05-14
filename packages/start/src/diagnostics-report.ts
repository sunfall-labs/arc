import type {
  StartAppGraphActionDiagnostics,
  StartAppGraphDiagnostics,
  StartAppGraphServerFunctionDiagnostics,
  StartAppGraphWireSchemaField
} from "./app-graph.js";

export type StartDiagnosticsReportStatus = "pass" | "needs-attention";

export type StartDiagnosticsReportFindingKind =
  | "route-preload-resources"
  | "route-preload-collections"
  | "wire-schema"
  | "action-behavior"
  | "policy-violation";

export interface StartDiagnosticsReportFinding {
  readonly kind: StartDiagnosticsReportFindingKind;
  readonly owner: string;
  readonly subject: string;
  readonly issue: string;
  readonly edit: string;
  readonly details: readonly string[];
}

export interface StartDiagnosticsReportOwnerGroup {
  readonly owner: string;
  readonly findings: readonly StartDiagnosticsReportFinding[];
}

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

export interface StartDiagnosticsReport {
  readonly status: StartDiagnosticsReportStatus;
  readonly summary: StartDiagnosticsReportSummary;
  readonly findings: readonly StartDiagnosticsReportFinding[];
  readonly groups: readonly StartDiagnosticsReportOwnerGroup[];
}

export interface StartDiagnosticsReportInput {
  readonly diagnostics: StartAppGraphDiagnostics;
  readonly diagnosticsPolicyViolations?: readonly unknown[];
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (
  value: Record<string, unknown>,
  field: string
): string | undefined =>
  typeof value[field] === "string" ? value[field] : undefined;

const policyViolationFinding = (
  violation: unknown,
  index: number
): StartDiagnosticsReportFinding => {
  const record = isRecord(violation) ? violation : undefined;
  const tag = record ? stringField(record, "_tag") : undefined;
  const message = record ? stringField(record, "message") : undefined;

  return {
    kind: "policy-violation",
    owner: "StartBuildPolicy.diagnostics",
    subject: tag ?? `policy violation ${index + 1}`,
    issue: message ?? "Resolved app graph diagnostics violated the configured build policy.",
    edit: "Fix the underlying diagnostic finding, or relax `StartBuildPolicy.diagnostics` if this route policy is intentionally not required.",
    details: tag === undefined ? [] : [`tag: ${tag}`]
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

const summaryLines = (summary: StartDiagnosticsReportSummary): readonly string[] => [
  `routes: ${summary.routes}`,
  `server functions: ${summary.serverFunctions}`,
  `actions: ${summary.actions}`,
  `resource families: ${summary.resourceFamilies}`,
  `resource tags: ${summary.resourceTags}`,
  `collections: ${summary.collections}`,
  `missing schemas: ${summary.missingSchemas}`,
  `unknown action behavior: ${summary.unknownActionBehavior}`,
  `unknown route preload resources: ${summary.unknownRoutePreloadResources}`,
  `unknown route preload collections: ${summary.unknownRoutePreloadCollections}`,
  `policy violations: ${summary.policyViolations}`,
  `findings: ${summary.findingCount}`
];

export const formatStartDiagnosticsReport = (
  report: StartDiagnosticsReport
): string => {
  const lines = [
    "Effect UI Start Diagnostics Report",
    `status: ${report.status}`,
    ...summaryLines(report.summary)
  ];

  if (report.findings.length === 0) {
    lines.push("", "No findings. The resolved app graph is agent-readable and policy-clean.");
    return lines.join("\n");
  }

  lines.push("", "Findings");
  for (const group of report.groups) {
    lines.push("", `Owner: ${group.owner}`);
    for (const finding of group.findings) {
      lines.push(`- [${finding.kind}] ${finding.subject}`);
      lines.push(`  Issue: ${finding.issue}`);
      lines.push(`  Edit: ${finding.edit}`);
      for (const detail of finding.details) {
        lines.push(`  Detail: ${detail}`);
      }
    }
  }

  return lines.join("\n");
};
