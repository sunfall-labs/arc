#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  Console,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Ref,
  Stdio,
  Terminal
} from "effect";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  type StartAgentGraphQuery,
  type StartAgentGraphQueryKind
} from "./agent-graph.js";
import type {
  LoadedStartAppGraphDiagnostics,
  LoadStartAppGraphDiagnosticsOptions,
  StartAppGraphDiagnosticsLoadError
} from "./vite.js";
import {
  runStartDiagnosticsCliCommandEffect,
  startDiagnosticsCliErrorPayload,
  writeStartDiagnosticsCliLineEffect
} from "./start-diagnostics-cli-runner.js";

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

const graphQueryKinds = [
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
] as const satisfies ReadonlyArray<StartAgentGraphQueryKind>;

const graphQueryKindSet = new Set<StartAgentGraphQueryKind>(graphQueryKinds);

const isGraphQueryKind = (value: string): value is StartAgentGraphQueryKind =>
  graphQueryKindSet.has(value as StartAgentGraphQueryKind);

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

const startDiagnosticsCliCommandNames = new Set([
  "diagnostics",
  "graph",
  "impact"
]);

const isStartDiagnosticsCliCommandName = (value: string): boolean =>
  startDiagnosticsCliCommandNames.has(value);

const isHelpFlag = (value: string | undefined): boolean =>
  value === "-h" || value === "--help";

const isTopLevelHelpRequest = (args: readonly string[]): boolean =>
  args.length === 0 || isHelpFlag(args[0]);

const isNestedHelpRequest = (args: readonly string[]): boolean =>
  args[0] !== undefined &&
  isStartDiagnosticsCliCommandName(args[0]) &&
  args.slice(1).some(isHelpFlag);

const makeUsageError = (message: string): StartDiagnosticsCliUsageError =>
  new StartDiagnosticsCliUsageError({
    message,
    guidance: startDiagnosticsCliUsage
  });

const noopConsole: Console.Console = {
  assert: () => undefined,
  clear: () => undefined,
  count: () => undefined,
  countReset: () => undefined,
  debug: () => undefined,
  dir: () => undefined,
  dirxml: () => undefined,
  error: () => undefined,
  group: () => undefined,
  groupCollapsed: () => undefined,
  groupEnd: () => undefined,
  info: () => undefined,
  log: () => undefined,
  table: () => undefined,
  time: () => undefined,
  timeEnd: () => undefined,
  timeLog: () => undefined,
  trace: () => undefined,
  warn: () => undefined
};

const noopTerminal = Terminal.make({
  columns: Effect.succeed(80),
  readInput: Effect.die("effect-ui-start CLI parser does not read interactive input"),
  readLine: Effect.fail(new Terminal.QuitError()),
  display: () => Effect.void
});

const noopChildProcessSpawner = ChildProcessSpawner.make(() =>
  Effect.die("effect-ui-start CLI parser does not spawn child processes")
);

const startDiagnosticsCliCommandEnvironmentLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(Terminal.Terminal)(noopTerminal),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner)(noopChildProcessSpawner)
);

interface StartDiagnosticsCliCommonConfig {
  readonly root: Option.Option<string>;
  readonly configFile: Option.Option<string>;
  readonly mode: Option.Option<string>;
  readonly json: boolean;
  readonly pretty: boolean;
}

const commonStartDiagnosticsCliFlags = {
  root: Flag.string("root").pipe(
    Flag.withDescription("Vite project root. Defaults to the current directory."),
    Flag.optional
  ),
  configFile: Flag.string("config").pipe(
    Flag.withDescription("Vite config file. Use \"false\" to disable config loading."),
    Flag.optional
  ),
  mode: Flag.string("mode").pipe(
    Flag.withDescription("Vite mode to use while loading diagnostics."),
    Flag.optional
  ),
  json: Flag.boolean("json").pipe(
    Flag.withDescription("Print the resolved payload as JSON.")
  ),
  pretty: Flag.boolean("pretty").pipe(
    Flag.withDescription("Pretty-print JSON output.")
  )
} as const;

const commonOptionsFromCliConfig = (
  config: StartDiagnosticsCliCommonConfig
): StartDiagnosticsCliOptions => {
  const root = Option.getOrUndefined(config.root);
  const configFile = Option.getOrUndefined(config.configFile);
  const mode = Option.getOrUndefined(config.mode);

  return {
    ...(root === undefined ? {} : { root }),
    ...(configFile === undefined ? {} : { configFile: configFile === "false" ? false : configFile }),
    ...(mode === undefined ? {} : { mode }),
    json: config.json || config.pretty,
    pretty: config.pretty
  };
};

const commandFromCliConfigEffect = (
  command: () => Exclude<StartCliCommand, { readonly _tag: "Help" }>
): Effect.Effect<Exclude<StartCliCommand, { readonly _tag: "Help" }>, unknown> =>
  Effect.try({
    try: command,
    catch: (cause) => cause
  });

const makeStartDiagnosticsCliCommand = (
  handleCommand: (
    command: Exclude<StartCliCommand, { readonly _tag: "Help" }>
  ) => Effect.Effect<void, unknown>
) => {
  const emitCommand = (
    command: () => Exclude<StartCliCommand, { readonly _tag: "Help" }>
  ): Effect.Effect<void, unknown> =>
    commandFromCliConfigEffect(command).pipe(Effect.flatMap(handleCommand));

  const diagnostics = Command.make(
    "diagnostics",
    commonStartDiagnosticsCliFlags,
    (config) =>
      emitCommand(() => ({
        _tag: "Diagnostics",
        options: commonOptionsFromCliConfig(config)
      }))
  ).pipe(
    Command.withDescription("Print app graph diagnostics and repair findings.")
  );

  const graph = Command.make(
    "graph",
    {
      ...commonStartDiagnosticsCliFlags,
      positionals: Argument.string("query").pipe(
        Argument.variadic(),
        Argument.withDescription("Optional graph kind and query text.")
      ),
      verbose: Flag.boolean("verbose").pipe(
        Flag.withDescription("Print raw graph ids, facts, and edges for graph output.")
      )
    },
    (config) =>
      emitCommand(() => {
        const positionals = config.positionals as ReadonlyArray<string>;
        const query = queryFromPositionals(positionals);
        return {
          _tag: "Graph",
          options: {
            ...commonOptionsFromCliConfig(config),
            verbose: config.verbose,
            ...(query === undefined ? {} : { query })
          }
        };
      })
  ).pipe(
    Command.withDescription("Print the agent-readable semantic app graph.")
  );

  const impact = Command.make(
    "impact",
    {
      ...commonStartDiagnosticsCliFlags,
      positionals: Argument.string("query").pipe(
        Argument.variadic(),
        Argument.withDescription("Required impact kind and query text.")
      )
    },
    (config) =>
      emitCommand(() => {
        const positionals = config.positionals as ReadonlyArray<string>;
        const query = queryFromPositionals(positionals);
        if (query?.text === undefined || query.text.trim().length === 0) {
          throw makeUsageError("Expected an impact query such as `impact route /projects/:id`.");
        }
        return {
          _tag: "Impact",
          options: {
            ...commonOptionsFromCliConfig(config),
            query
          }
        };
      })
  ).pipe(
    Command.withDescription("Print edit impact for one route/action/resource/module.")
  );

  return Command.make("effect-ui-start").pipe(
    Command.withDescription("Inspect Effect UI Start app graph diagnostics."),
    Command.withExamples([
      {
        command: "effect-ui-start diagnostics --root examples/project-console",
        description: "Print diagnostics for a Vite project."
      },
      {
        command: "effect-ui-start graph route /projects/:id",
        description: "Inspect a route in the semantic app graph."
      },
      {
        command: "effect-ui-start impact action Project.rename --json",
        description: "Print machine-readable impact for an action."
      }
    ]),
    Command.withSubcommands([diagnostics, graph, impact])
  );
};

const runStartDiagnosticsCliCommandGrammarEffect = (
  command: ReturnType<typeof makeStartDiagnosticsCliCommand>,
  args: readonly string[]
): Effect.Effect<void, unknown> =>
  Command.runWith(command, { version: "0.0.0" })(args).pipe(
    Effect.provideService(Console.Console, noopConsole),
    Effect.provide(startDiagnosticsCliCommandEnvironmentLayer)
  );

const usageErrorFromCliCause = (cause: unknown): StartDiagnosticsCliUsageError => {
  if (cause instanceof StartDiagnosticsCliUsageError) {
    return cause;
  }

  if (CliError.isCliError(cause)) {
    if (cause._tag === "ShowHelp" && cause.errors.length > 0) {
      return makeUsageError(cause.errors.map((error) => error.message).join("\n"));
    }
    return makeUsageError(cause.message);
  }

  if (cause instanceof Error) {
    return makeUsageError(cause.message);
  }

  return makeUsageError(String(cause));
};

const rejectUnknownStartDiagnosticsCliCommandEffect = (
  args: readonly string[]
): Effect.Effect<void, StartDiagnosticsCliUsageError> => {
  const command = args[0];
  if (command !== undefined && !isStartDiagnosticsCliCommandName(command)) {
    return Effect.fail(makeUsageError(`Unknown command "${command}".`));
  }

  return Effect.void;
};

/** Parses CLI argv into a diagnostics command or help request as an Effect. */
export const parseStartDiagnosticsCliArgsEffect = (
  args: readonly string[]
): Effect.Effect<StartCliCommand, StartDiagnosticsCliUsageError> => {
  if (isTopLevelHelpRequest(args) || isNestedHelpRequest(args)) {
    return Effect.succeed({ _tag: "Help" });
  }

  return Effect.gen(function* () {
    yield* rejectUnknownStartDiagnosticsCliCommandEffect(args);

    const parsedCommandRef = yield* Ref.make<
      Exclude<StartCliCommand, { readonly _tag: "Help" }> | undefined
    >(undefined);
    const command = makeStartDiagnosticsCliCommand((parsedCommand) =>
      Ref.set(parsedCommandRef, parsedCommand)
    );

    yield* runStartDiagnosticsCliCommandGrammarEffect(command, args).pipe(
      Effect.mapError(usageErrorFromCliCause)
    );

    const parsedCommand = yield* Ref.get(parsedCommandRef);
    if (parsedCommand === undefined) {
      return yield* Effect.fail(makeUsageError("Expected a diagnostics command."));
    }

    return parsedCommand;
  });
};

/** Parses CLI argv into a diagnostics command or help request. */
export const parseStartDiagnosticsCliArgs = (
  args: readonly string[]
): StartCliCommand =>
  Effect.runSync(parseStartDiagnosticsCliArgsEffect(args));

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

    const parsed = yield* parseStartDiagnosticsCliArgsEffect(args).pipe(
      Effect.map((command) => ({ _tag: "Success" as const, command })),
      Effect.catch((cause) => Effect.succeed({ _tag: "Failure" as const, cause }))
    );

    if (parsed._tag === "Failure") {
      const payload = startDiagnosticsCliErrorPayload(parsed.cause);
      yield* writeStartDiagnosticsCliLineEffect(stderr, `${payload.message}\n\n${startDiagnosticsCliUsage}`);
      return { exitCode: 1 };
    }

    const command = parsed.command;

    if (command._tag === "Help") {
      yield* writeStartDiagnosticsCliLineEffect(stdout, startDiagnosticsCliUsage);
      return { exitCode: 0 };
    }

    return yield* runStartDiagnosticsCliCommandEffect(command, io);
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
