import { Effect } from "effect";
import {
  createStartAgentGraph,
  createStartAgentGraphImpact,
  formatStartAgentGraph,
  formatStartAgentGraphImpact,
  queryStartAgentGraph
} from "./agent-graph.js";
import { decodeStartAppGraphDiagnosticsDtoEffect } from "./app-graph.js";
import {
  createStartDiagnosticsReport,
  formatStartDiagnosticsReport,
  type StartDiagnosticsReport
} from "./diagnostics-report.js";
import {
  loadStartAppGraphDiagnosticsEffect,
  type LoadedStartAppGraphDiagnostics,
  type LoadStartAppGraphDiagnosticsOptions,
  type StartAppGraphDiagnosticsLoadError
} from "./vite.js";
import type {
  StartCliCommand,
  StartDiagnosticsCliIo,
  StartDiagnosticsCliOptions,
  StartDiagnosticsCliResult
} from "./cli.js";

const diagnosticOptions = (
  options: StartDiagnosticsCliOptions
): LoadStartAppGraphDiagnosticsOptions => ({
  ...(options.root === undefined ? {} : { root: options.root }),
  ...(options.configFile === undefined ? {} : { configFile: options.configFile }),
  ...(options.mode === undefined ? {} : { mode: options.mode })
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const startDiagnosticsCliErrorPayload = (cause: unknown): Record<string, unknown> => {
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

export const writeStartDiagnosticsCliLineEffect = (
  write: (text: string) => void,
  text: string
): Effect.Effect<void> =>
  Effect.sync(() => {
    write(text);
  });

/**
 * Executes a parsed Start diagnostics CLI command.
 *
 * Argument parsing and bin process wiring stay in `cli.ts`; this Module owns
 * diagnostics loading, graph/impact projection, output formatting, and
 * load-failure reporting.
 */
export const runStartDiagnosticsCliCommandEffect = (
  command: Exclude<StartCliCommand, { readonly _tag: "Help" }>,
  io: StartDiagnosticsCliIo = {}
): Effect.Effect<StartDiagnosticsCliResult> =>
  Effect.gen(function* () {
    const stdout = io.stdout ?? ((text) => process.stdout.write(`${text}\n`));
    const stderr = io.stderr ?? ((text) => process.stderr.write(`${text}\n`));
    const load = loadDiagnosticsFromIo(io);

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
            yield* writeStartDiagnosticsCliLineEffect(
              stdout,
              JSON.stringify(impact, null, command.options.pretty ? 2 : 0)
            );
          } else {
            yield* writeStartDiagnosticsCliLineEffect(stdout, formatStartAgentGraphImpact(impact));
          }
          return { exitCode: 0 };
        }

        if (command.options.json) {
          yield* writeStartDiagnosticsCliLineEffect(
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
          yield* writeStartDiagnosticsCliLineEffect(
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
        yield* writeStartDiagnosticsCliLineEffect(
          stdout,
          JSON.stringify(result, null, command.options.pretty ? 2 : 0)
        );
      } else {
        yield* writeStartDiagnosticsCliLineEffect(
          stdout,
          formatStartDiagnosticsReport(createStartDiagnosticsReport(result))
        );
      }
      return { exitCode: 0 };
    }

    const cause = loaded.cause;
    const payload = startDiagnosticsCliErrorPayload(cause);
    const report = yield* diagnosticsReportFromErrorEffect(cause);
    if (command.options.json) {
      yield* writeStartDiagnosticsCliLineEffect(
        stderr,
        JSON.stringify(
          { ok: false, error: payload, ...(report === undefined ? {} : { report }) },
          null,
          command.options.pretty ? 2 : 0
        )
      );
    } else {
      yield* writeStartDiagnosticsCliLineEffect(
        stderr,
        report === undefined
          ? `Effect UI Start diagnostics failed: ${payload.message}`
          : `Effect UI Start diagnostics failed: ${payload.message}\n\n${formatStartDiagnosticsReport(report)}`
      );
    }
    return { exitCode: 1 };
  });
