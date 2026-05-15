#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Data, Effect } from "effect";
import {
  loadStartAppGraphDiagnosticsEffect,
  type StartAppGraphDiagnosticsLoadError,
  type LoadedStartAppGraphDiagnostics,
  type LoadStartAppGraphDiagnosticsOptions
} from "./vite.js";
import {
  createStartDiagnosticsReport,
  formatStartDiagnosticsReport,
  type StartDiagnosticsReport
} from "./diagnostics-report.js";
import { decodeStartAppGraphDiagnosticsDtoEffect } from "./app-graph.js";
import {
  createStartAgentGraphImpact,
  createStartAgentGraph,
  formatStartAgentGraphImpact,
  formatStartAgentGraph,
  queryStartAgentGraph,
  type StartAgentGraphQuery,
  type StartAgentGraphQueryKind
} from "./agent-graph.js";

/** Parsed command supported by the `effect-ui-start` CLI. */
export type StartCliCommand =
  | {
      readonly _tag: "Diagnostics";
      readonly options: StartDiagnosticsCliOptions;
    }
  | {
      readonly _tag: "Graph";
      readonly options: StartGraphCliOptions;
    }
  | {
      readonly _tag: "Impact";
      readonly options: StartImpactCliOptions;
    }
  | {
      readonly _tag: "Help";
    };

/** Options for the `effect-ui-start diagnostics` command. */
export interface StartDiagnosticsCliOptions {
  readonly root?: string;
  readonly configFile?: string | false;
  readonly mode?: string;
  readonly json: boolean;
  readonly pretty: boolean;
}

/** Options for the `effect-ui-start graph` command. */
export interface StartGraphCliOptions extends StartDiagnosticsCliOptions {
  readonly query?: StartAgentGraphQuery;
  readonly verbose: boolean;
}

/** Options for the `effect-ui-start impact` command. */
export interface StartImpactCliOptions extends StartDiagnosticsCliOptions {
  readonly query: StartAgentGraphQuery;
}

/**
 * Injectable IO for diagnostics CLI tests or embedding.
 *
 * The diagnostics loader is Effect-first so callers can provide services and
 * control failure handling without a Promise wrapper.
 */
export interface StartDiagnosticsCliIo {
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly loadDiagnosticsEffect?: (
    options: LoadStartAppGraphDiagnosticsOptions
  ) => Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError>;
}

/** Result returned by CLI runners after printing output. */
export interface StartDiagnosticsCliResult {
  readonly exitCode: number;
}

/** Usage error with a printable help message. */
export class StartDiagnosticsCliUsageError extends Data.TaggedError(
  "StartDiagnosticsCliUsageError"
)<{
  readonly message: string;
  readonly guidance: string;
}> {}

/** Help text for the Start diagnostics CLI. */
export const startDiagnosticsCliUsage = [
  "Usage: effect-ui-start diagnostics [options]",
  "       effect-ui-start graph [kind] [query] [options]",
  "       effect-ui-start impact [kind] [query] [options]",
  "",
  "Commands:",
  "  diagnostics       Print app graph diagnostics and repair findings.",
  "  graph             Print the agent-readable semantic app graph.",
  "  impact            Print edit impact for one route/action/resource/module.",
  "",
  "Graph and impact query kinds:",
  "  route, action, server-function, resource, resource-tag, collection, module, endpoint, finding, node",
  "",
  "Options:",
  "  --root <dir>       Vite project root. Defaults to the current directory.",
  "  --config <file>    Vite config file. Use \"false\" to disable config loading.",
  "  --mode <mode>      Vite mode to use while loading diagnostics.",
  "  --json             Print the resolved payload as JSON.",
  "  --pretty           Pretty-print JSON output.",
  "  --verbose          Print raw graph ids, facts, and edges for graph output.",
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

const graphQueryKinds = new Set<StartAgentGraphQueryKind>([
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
]);

const isGraphQueryKind = (value: string): value is StartAgentGraphQueryKind =>
  graphQueryKinds.has(value as StartAgentGraphQueryKind);

const queryFromPositionals = (
  positionals: readonly string[]
): StartAgentGraphQuery | undefined => {
  if (positionals.length === 0) {
    return undefined;
  }
  if (positionals.length > 2) {
    throw new StartDiagnosticsCliUsageError({
      message: `Expected at most a graph kind and one query, received ${positionals.length} positional values.`,
      guidance: startDiagnosticsCliUsage
    });
  }

  const [first, second] = positionals;
  if (first === undefined) {
    return undefined;
  }
  if (isGraphQueryKind(first)) {
    return {
      kind: first,
      ...(second === undefined ? {} : { text: second })
    };
  }
  if (second !== undefined) {
    throw new StartDiagnosticsCliUsageError({
      message: `Unknown graph query kind "${first}".`,
      guidance: startDiagnosticsCliUsage
    });
  }
  return { text: first };
};

/** Parses CLI argv into a diagnostics command or help request. */
export const parseStartDiagnosticsCliArgs = (
  args: readonly string[]
): StartCliCommand => {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    return { _tag: "Help" };
  }

  const command = args[0];
  if (
    command !== "diagnostics" &&
    command !== "graph" &&
    command !== "impact"
  ) {
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
  let verbose = false;
  const positionals: string[] = [];

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
    if (arg === "--verbose" && command === "graph") {
      verbose = true;
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
    if (!arg.startsWith("-") && (command === "graph" || command === "impact")) {
      positionals.push(arg);
      continue;
    }

    throw new StartDiagnosticsCliUsageError({
      message: `Unknown option "${arg}".`,
      guidance: startDiagnosticsCliUsage
    });
  }

  const baseOptions = {
    ...(root === undefined ? {} : { root }),
    ...(configFile === undefined ? {} : { configFile }),
    ...(mode === undefined ? {} : { mode }),
    json,
    pretty
  };

  if (command === "graph") {
    const query = queryFromPositionals(positionals);
    return {
      _tag: "Graph",
      options: {
        ...baseOptions,
        verbose,
        ...(query === undefined ? {} : { query })
      }
    };
  }

  if (command === "impact") {
    const query = queryFromPositionals(positionals);
    if (query?.text === undefined || query.text.trim().length === 0) {
      throw new StartDiagnosticsCliUsageError({
        message: "Expected an impact query such as `impact route /projects/:id`.",
        guidance: startDiagnosticsCliUsage
      });
    }
    return {
      _tag: "Impact",
      options: {
        ...baseOptions,
        query
      }
    };
  }

  return {
    _tag: "Diagnostics",
    options: baseOptions
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

const diagnosticsReportFromErrorEffect = (
  cause: unknown
): Effect.Effect<StartDiagnosticsReport | undefined> =>
  isRecord(cause)
    ? decodeStartAppGraphDiagnosticsDtoEffect({
        diagnostics: cause.diagnostics,
        diagnosticsPolicyViolations: "violations" in cause ? cause.violations : []
      }).pipe(
        Effect.map(createStartDiagnosticsReport),
        Effect.catch(() => Effect.succeed(undefined))
      )
    : Effect.succeed(undefined);

const loadDiagnosticsFromIo = (
  io: StartDiagnosticsCliIo
): ((
  options: LoadStartAppGraphDiagnosticsOptions
) => Effect.Effect<LoadedStartAppGraphDiagnostics, StartAppGraphDiagnosticsLoadError>) => {
  if (io.loadDiagnosticsEffect) {
    return io.loadDiagnosticsEffect;
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

/**
 * Runs the Start diagnostics CLI as an Effect.
 *
 * It loads the resolved app graph through Vite, prints either a formatted
 * report or JSON, and returns the intended process exit code.
 */
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
      if (command._tag === "Graph" || command._tag === "Impact") {
        const agentGraph = createStartAgentGraph(loaded.result);
        if (command._tag === "Impact") {
          const impact = createStartAgentGraphImpact(
            agentGraph,
            command.options.query,
            command.options.root === undefined
              ? {}
              : { root: command.options.root }
          );
          if (command.options.json) {
            yield* writeLineEffect(
              stdout,
              JSON.stringify(impact, null, command.options.pretty ? 2 : 0)
            );
          } else {
            yield* writeLineEffect(stdout, formatStartAgentGraphImpact(impact));
          }
          return { exitCode: 0 };
        }

        if (command.options.json) {
          yield* writeLineEffect(
            stdout,
            JSON.stringify(
              command.options.query === undefined
                ? agentGraph
                : {
                    graph: agentGraph,
                    result: queryStartAgentGraph(agentGraph, command.options.query)
                  },
              null,
              command.options.pretty ? 2 : 0
            )
          );
        } else {
          yield* writeLineEffect(
            stdout,
            formatStartAgentGraph(
              agentGraph,
              command.options.query === undefined
                ? { verbose: command.options.verbose }
                : { query: command.options.query, verbose: command.options.verbose }
            )
          );
        }
        return { exitCode: 0 };
      }

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
    const report = yield* diagnosticsReportFromErrorEffect(cause);
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

/** Alias for `runStartDiagnosticsCliEffect` on the current CLI surface. */
export const runStartDiagnosticsCli = (
  args: readonly string[],
  io: StartDiagnosticsCliIo = {}
): Effect.Effect<StartDiagnosticsCliResult> =>
  runStartDiagnosticsCliEffect(args, io);

/** Runs the diagnostics CLI and assigns `process.exitCode`. */
export const runStartDiagnosticsCliMainEffect = (
  args: readonly string[] = process.argv.slice(2)
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const result = yield* runStartDiagnosticsCliEffect(args);
    yield* Effect.sync(() => {
      process.exitCode = result.exitCode;
    });
  });

/** Alias for `runStartDiagnosticsCliMainEffect`. */
export const runStartDiagnosticsCliMain = (
  args: readonly string[] = process.argv.slice(2)
): Effect.Effect<void> =>
  runStartDiagnosticsCliMainEffect(args);

const isMain = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  void Effect.runPromise(runStartDiagnosticsCliMainEffect());
}
