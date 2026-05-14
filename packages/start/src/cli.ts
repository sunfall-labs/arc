#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  loadStartAppGraphDiagnostics,
  type LoadedStartAppGraphDiagnostics,
  type LoadStartAppGraphDiagnosticsOptions
} from "./vite.js";
import {
  createStartDiagnosticsReport,
  formatStartDiagnosticsReport,
  type StartDiagnosticsReport
} from "./diagnostics-report.js";

export type StartCliCommand =
  | {
      readonly _tag: "Diagnostics";
      readonly options: StartDiagnosticsCliOptions;
    }
  | {
      readonly _tag: "Help";
    };

export interface StartDiagnosticsCliOptions {
  readonly root?: string;
  readonly configFile?: string | false;
  readonly mode?: string;
  readonly json: boolean;
  readonly pretty: boolean;
}

export interface StartDiagnosticsCliIo {
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly loadDiagnostics?: (
    options: LoadStartAppGraphDiagnosticsOptions
  ) => Promise<LoadedStartAppGraphDiagnostics>;
}

export interface StartDiagnosticsCliResult {
  readonly exitCode: number;
}

export class StartDiagnosticsCliUsageError extends Error {
  override readonly name = "StartDiagnosticsCliUsageError";
}

export const startDiagnosticsCliUsage = [
  "Usage: effect-ui-start diagnostics [options]",
  "",
  "Options:",
  "  --root <dir>       Vite project root. Defaults to the current directory.",
  "  --config <file>    Vite config file. Use \"false\" to disable config loading.",
  "  --mode <mode>      Vite mode to use while loading diagnostics.",
  "  --json             Print the resolved graph, diagnostics, and policy violations as JSON.",
  "  --pretty           Pretty-print JSON output.",
  "  -h, --help         Show this help message."
].join("\n");

const readOptionValue = (
  args: readonly string[],
  index: number,
  flag: string
): readonly [string, number] => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new StartDiagnosticsCliUsageError(`Expected a value after ${flag}.`);
  }
  return [value, index + 1] as const;
};

export const parseStartDiagnosticsCliArgs = (
  args: readonly string[]
): StartCliCommand => {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    return { _tag: "Help" };
  }

  const command = args[0];
  if (command !== "diagnostics") {
    throw new StartDiagnosticsCliUsageError(`Unknown command "${command}".`);
  }

  let root: string | undefined;
  let configFile: string | false | undefined;
  let mode: string | undefined;
  let json = false;
  let pretty = false;

  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "-h" || arg === "--help") {
      return { _tag: "Help" };
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--pretty") {
      pretty = true;
      json = true;
      continue;
    }
    if (arg === "--root") {
      const [value, nextIndex] = readOptionValue(args, index, arg);
      root = value;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
      continue;
    }
    if (arg === "--config") {
      const [value, nextIndex] = readOptionValue(args, index, arg);
      configFile = value === "false" ? false : value;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      configFile = value === "false" ? false : value;
      continue;
    }
    if (arg === "--mode") {
      const [value, nextIndex] = readOptionValue(args, index, arg);
      mode = value;
      index = nextIndex;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }

    throw new StartDiagnosticsCliUsageError(`Unknown option "${arg}".`);
  }

  return {
    _tag: "Diagnostics",
    options: {
      ...(root === undefined ? {} : { root }),
      ...(configFile === undefined ? {} : { configFile }),
      ...(mode === undefined ? {} : { mode }),
      json,
      pretty
    }
  };
};

const diagnosticOptions = (
  options: StartDiagnosticsCliOptions
): LoadStartAppGraphDiagnosticsOptions => ({
  ...(options.root === undefined ? {} : { root: options.root }),
  ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
  ...(options.mode === undefined ? {} : { mode: options.mode })
});

const errorPayload = (cause: unknown): Record<string, unknown> => {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...("violations" in cause ? { violations: (cause as { readonly violations: unknown }).violations } : {})
    };
  }

  return {
    name: "UnknownError",
    message: String(cause)
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const diagnosticsReportFromError = (cause: unknown): StartDiagnosticsReport | undefined => {
  if (!isRecord(cause) || !isRecord(cause.diagnostics)) {
    return undefined;
  }

  const diagnosticsPolicyViolations = Array.isArray(cause.violations)
    ? cause.violations
    : [];

  return createStartDiagnosticsReport({
    diagnostics: cause.diagnostics as unknown as LoadedStartAppGraphDiagnostics["diagnostics"],
    diagnosticsPolicyViolations
  });
};

export const runStartDiagnosticsCli = async (
  args: readonly string[],
  io: StartDiagnosticsCliIo = {}
): Promise<StartDiagnosticsCliResult> => {
  const stdout = io.stdout ?? ((text) => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? ((text) => process.stderr.write(`${text}\n`));
  const load = io.loadDiagnostics ?? loadStartAppGraphDiagnostics;

  let command: StartCliCommand;
  try {
    command = parseStartDiagnosticsCliArgs(args);
  } catch (cause) {
    const payload = errorPayload(cause);
    stderr(`${payload.message}\n\n${startDiagnosticsCliUsage}`);
    return { exitCode: 1 };
  }

  if (command._tag === "Help") {
    stdout(startDiagnosticsCliUsage);
    return { exitCode: 0 };
  }

  try {
    const result = await load(diagnosticOptions(command.options));
    if (command.options.json) {
      stdout(JSON.stringify(result, null, command.options.pretty ? 2 : 0));
    } else {
      stdout(formatStartDiagnosticsReport(createStartDiagnosticsReport(result)));
    }
    return { exitCode: 0 };
  } catch (cause) {
    const payload = errorPayload(cause);
    const report = diagnosticsReportFromError(cause);
    if (command.options.json) {
      stderr(JSON.stringify({ ok: false, error: payload, ...(report === undefined ? {} : { report }) }, null, command.options.pretty ? 2 : 0));
    } else {
      stderr(
        report === undefined
          ? `Effect UI Start diagnostics failed: ${payload.message}`
          : `Effect UI Start diagnostics failed: ${payload.message}\n\n${formatStartDiagnosticsReport(report)}`
      );
    }
    return { exitCode: 1 };
  }
};

export const runStartDiagnosticsCliMain = async (
  args: readonly string[] = process.argv.slice(2)
): Promise<void> => {
  const result = await runStartDiagnosticsCli(args);
  process.exitCode = result.exitCode;
};

const isMain = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  void runStartDiagnosticsCliMain();
}
