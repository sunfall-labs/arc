export {
  createStartDiagnosticsReport,
  type StartDiagnosticsReport,
  type StartDiagnosticsReportFinding,
  type StartDiagnosticsReportFindingKind,
  type StartDiagnosticsReportInput,
  type StartDiagnosticsReportOwnerGroup,
  type StartDiagnosticsReportStatus,
  type StartDiagnosticsReportSummary,
} from "./start-diagnostics-contract.js";
import type {
  StartDiagnosticsReport,
  StartDiagnosticsReportSummary,
} from "./start-diagnostics-contract.js";

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
  `findings: ${summary.findingCount}`,
];

/**
 * Formats a diagnostics report as deterministic CLI text.
 *
 * Output is grouped by owner and includes issue/edit/detail lines so agents can
 * turn the report into a concrete repair checklist.
 */
export const formatStartDiagnosticsReport = (report: StartDiagnosticsReport): string => {
  const lines = [
    "Sunfall Arc Start Diagnostics Report",
    `status: ${report.status}`,
    ...summaryLines(report.summary),
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
