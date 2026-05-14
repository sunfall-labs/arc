#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Data, Effect } from "effect";
import {
  loadStartAppGraphDiagnosticsEffect,
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
  readonly loadDiagnosticsEffect?: (
    options: LoadStartAppGraphDiagnosticsOptions
  ) => Effect.Effect<LoadedStartAppGraphDiagnostics, unknown>;
  readonly loadDiagnostics?: (
    options: LoadStartAppGraphDiagnosticsOptions
  ) => Promise<LoadedStartAppGraphDiagnostics>;
}

export interface StartDiagnosticsCliResult {
  readonly exitCode: number;
}

export class StartDiagnosticsCliUsageError extends Data.TaggedError(
  "StartDiagnosticsCliUsageError"
)<{
  readonly message: string;
  readonly guidance: string;
}> {}

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
    throw new StartDiagnosticsCliUsageError({
      message: `Expected a value after ${flag}.`,
      guidance: startDiagnosticsCliUsage
    });
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
    throw new StartDiagnosticsCliUsageError({
      message: `Unknown command "${command}".`,
      guidance: startDiagnosticsCliUsage
    });
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

    throw new StartDiagnosticsCliUsageError({
      message: `Unknown option "${arg}".`,
      guidance: startDiagnosticsCliUsage
    });
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const errorPayload = (cause: unknown): Record<string, unknown> => {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...("violations" in cause ? { violations: (cause as { readonly violations: unknown }).violations } : {})
    };
  }

  if (isRecord(cause) && typeof cause.message === "string") {
    return {
      name: typeof cause.name === "string"
        ? cause.name
        : typeof cause._tag === "string"
          ? cause._tag
          : "Error",
      message: cause.message,
      ...("violations" in cause ? { violations: cause.violations } : {})
    };
  }

  return {
    name: "UnknownError",
    message: String(cause)
  };
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isStartAppGraphDiagnostics = (
  value: unknown
): value is LoadedStartAppGraphDiagnostics["diagnostics"] =>
  isRecord(value) &&
  value.version === 1 &&
  typeof value.routeCount === "number" &&
  typeof value.serverFunctionCount === "number" &&
  typeof value.actionCount === "number" &&
  isStringArray(value.routePaths) &&
  Array.isArray(value.routeModules) &&
  Array.isArray(value.serverFunctionModules) &&
  Array.isArray(value.actionModules) &&
  Array.isArray(value.resourceFamilies) &&
  Array.isArray(value.resourceTags) &&
  Array.isArray(value.collectionDefinitions) &&
  isStringArray(value.serverOnlyModules) &&
  isStringArray(value.browserClientModules) &&
  typeof value.rpcPath === "string" &&
  typeof value.actionPath === "string" &&
  isRecord(value.schemaCoverage) &&
  Array.isArray(value.missingSchemas) &&
  Array.isArray(value.unknownActionBehavior) &&
  Array.isArray(value.unknownRoutePreloadResources) &&
  Array.isArray(value.unknownRoutePreloadCollections);

const diagnosticsReportFromError = (cause: unknown): StartDiagnosticsReport | undefined => {
  if (!isRecord(cause) || !isStartAppGraphDiagnostics(cause.diagnostics)) {
    return undefined;
  }

  const diagnosticsPolicyViolations = Array.isArray(cause.violations)
    ? cause.violations
    : [];

  return createStartDiagnosticsReport({
    diagnostics: cause.diagnostics,
    diagnosticsPolicyViolations
  });
};

const loadDiagnosticsFromIo = (
  io: StartDiagnosticsCliIo
): ((
  options: LoadStartAppGraphDiagnosticsOptions
) => Effect.Effect<LoadedStartAppGraphDiagnostics, unknown>) => {
  if (io.loadDiagnosticsEffect) {
    return io.loadDiagnosticsEffect;
  }

  const loadDiagnostics = io.loadDiagnostics;
  if (loadDiagnostics) {
    return (options) =>
      Effect.tryPromise({
        try: () => loadDiagnostics(options),
        catch: (cause) => cause
      });
  }

  return loadStartAppGraphDiagnosticsEffect;
};

const writeLineEffect = (
  write: (text: string) => void,
  text: string
): Effect.Effect<void> =>
  Effect.sync(() => {
    write(text);
  });

export const runStartDiagnosticsCliEffect = (
  args: readonly string[],
  io: StartDiagnosticsCliIo = {}
): Effect.Effect<StartDiagnosticsCliResult> =>
  Effect.gen(function* () {
    const stdout = io.stdout ?? ((text) => process.stdout.write(`${text}\n`));
    const stderr = io.stderr ?? ((text) => process.stderr.write(`${text}\n`));
    const load = loadDiagnosticsFromIo(io);

    const parsed = yield* Effect.try({
      try: () => parseStartDiagnosticsCliArgs(args),
      catch: (cause) => cause
    }).pipe(
      Effect.map((command) => ({ _tag: "Success" as const, command })),
      Effect.catch((cause) => Effect.succeed({ _tag: "Failure" as const, cause }))
    );

    if (parsed._tag === "Failure") {
      const payload = errorPayload(parsed.cause);
      yield* writeLineEffect(stderr, `${payload.message}\n\n${startDiagnosticsCliUsage}`);
      return { exitCode: 1 };
    }

    const command = parsed.command;

    if (command._tag === "Help") {
      yield* writeLineEffect(stdout, startDiagnosticsCliUsage);
      return { exitCode: 0 };
    }

    const loaded = yield* load(diagnosticOptions(command.options)).pipe(
      Effect.map((result) => ({ _tag: "Success" as const, result })),
      Effect.catch((cause) => Effect.succeed({ _tag: "Failure" as const, cause }))
    );

    if (loaded._tag === "Success") {
      const result = loaded.result;
      if (command.options.json) {
        yield* writeLineEffect(
          stdout,
          JSON.stringify(result, null, command.options.pretty ? 2 : 0)
        );
      } else {
        yield* writeLineEffect(
          stdout,
          formatStartDiagnosticsReport(createStartDiagnosticsReport(result))
        );
      }
      return { exitCode: 0 };
    }

    const cause = loaded.cause;
    const payload = errorPayload(cause);
    const report = diagnosticsReportFromError(cause);
    if (command.options.json) {
      yield* writeLineEffect(
        stderr,
        JSON.stringify(
          { ok: false, error: payload, ...(report === undefined ? {} : { report }) },
          null,
          command.options.pretty ? 2 : 0
        )
      );
    } else {
      yield* writeLineEffect(
        stderr,
        report === undefined
          ? `Effect UI Start diagnostics failed: ${payload.message}`
          : `Effect UI Start diagnostics failed: ${payload.message}\n\n${formatStartDiagnosticsReport(report)}`
      );
    }
    return { exitCode: 1 };
  });

export const runStartDiagnosticsCli = (
  args: readonly string[],
  io: StartDiagnosticsCliIo = {}
): Promise<StartDiagnosticsCliResult> =>
  Effect.runPromise(runStartDiagnosticsCliEffect(args, io));

export const runStartDiagnosticsCliMainEffect = (
  args: readonly string[] = process.argv.slice(2)
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const result = yield* runStartDiagnosticsCliEffect(args);
    yield* Effect.sync(() => {
      process.exitCode = result.exitCode;
    });
  });

export const runStartDiagnosticsCliMain = (
  args: readonly string[] = process.argv.slice(2)
): Promise<void> =>
  Effect.runPromise(runStartDiagnosticsCliMainEffect(args));

const isMain = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  void runStartDiagnosticsCliMain();
}
