import {
  createStartDiagnosticsReport,
  formatStartDiagnosticsReport,
  type StartDiagnosticsReport,
  type StartDiagnosticsReportInput,
} from "@sunfall/arc-start/diagnostics-report";

const diagnosticsExports: Array<unknown> = [
  createStartDiagnosticsReport,
  formatStartDiagnosticsReport,
];
type Diagnostics = StartDiagnosticsReport | StartDiagnosticsReportInput;
void diagnosticsExports;
type _Diagnostics = Diagnostics;
