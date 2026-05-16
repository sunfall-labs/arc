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
import {
  isStartAgentGraphQueryKind,
  startAgentGraphQueryKinds,
  startAgentGraphQueryKindsText
} from "./start-diagnostics-cli-contract.js";
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

/**
 * Last-resort usage fallback for embedding errors.
 *
 * The printable CLI help is generated from the Effect v4 `Command` tree so
 * flags, subcommands, descriptions, and examples cannot drift from parsing.
 */
export const startDiagnosticsCliUsage =
  "Run `effect-ui-start --help` for usage generated from the Effect CLI command tree.";

const startDiagnosticsCliVersion = "0.0.0-alpha.0";

const invalidGraphQueryKindError = (value: string): CliError.InvalidValue =>
  new CliError.InvalidValue({
    option: "query",
    value,
    expected: `one of: ${startAgentGraphQueryKindsText()}`,
    kind: "argument"
  });

const tooManyGraphQueryValuesError = (positionals: readonly string[]): CliError.InvalidValue =>
  new CliError.InvalidValue({
    option: "query",
    value: positionals.join(" "),
    expected: "at most a graph kind and one query",
    kind: "argument"
  });

const missingImpactQueryError = (value: string): CliError.InvalidValue =>
  new CliError.InvalidValue({
    option: "query",
    value,
    expected: "an impact query such as `impact route /projects/:id`",
    kind: "argument"
  });

const queryFlagConflictError = (
  positionals: readonly string[],
  queryText: string
): CliError.InvalidValue =>
  new CliError.InvalidValue({
    option: "query",
    value: [...positionals, queryText].join(" "),
    expected: "use either positional query text or --query text, not both",
    kind: "argument"
  });

const queryFromPositionalsEffect = (
  positionals: readonly string[]
): Effect.Effect<StartAgentGraphQuery | undefined, CliError.CliError> => {
  if (positionals.length === 0) {
    return Effect.succeed(undefined);
  }
  if (positionals.length > 2) {
    return Effect.fail(tooManyGraphQueryValuesError(positionals));
  }

  const [first, second] = positionals;
  if (first === undefined) {
    return Effect.succeed(undefined);
  }
  if (isStartAgentGraphQueryKind(first)) {
    return Effect.succeed({
      kind: first,
      ...(second === undefined ? {} : { text: second })
    });
  }
  if (second !== undefined) {
    return Effect.fail(invalidGraphQueryKindError(first));
  }
  return Effect.succeed({ text: first });
};

const queryFromCliInputEffect = (
  positionals: readonly string[],
  queryTextOption: Option.Option<string>
): Effect.Effect<StartAgentGraphQuery | undefined, CliError.CliError> => {
  const queryText = Option.getOrUndefined(queryTextOption);
  if (queryText === undefined) {
    return queryFromPositionalsEffect(positionals);
  }
  if (positionals.length === 0) {
    return Effect.succeed({ text: queryText });
  }
  if (positionals.length === 1) {
    const [kind] = positionals;
    if (kind !== undefined && isStartAgentGraphQueryKind(kind)) {
      return Effect.succeed({ kind, text: queryText });
    }
  }
  return Effect.fail(queryFlagConflictError(positionals, queryText));
};

const requiredQueryFromPositionalsEffect = (
  positionals: readonly string[]
): Effect.Effect<StartAgentGraphQuery, CliError.CliError> =>
  queryFromPositionalsEffect(positionals).pipe(
    Effect.flatMap((query) =>
      query?.text === undefined || query.text.trim().length === 0
        ? Effect.fail(missingImpactQueryError(positionals.join(" ")))
        : Effect.succeed(query)
    )
  );

const requiredQueryFromCliInputEffect = (
  positionals: readonly string[],
  queryTextOption: Option.Option<string>
): Effect.Effect<StartAgentGraphQuery, CliError.CliError> =>
  queryFromCliInputEffect(positionals, queryTextOption).pipe(
    Effect.flatMap((query) =>
      query?.text === undefined || query.text.trim().length === 0
        ? Effect.fail(missingImpactQueryError(positionals.join(" ")))
        : Effect.succeed(query)
    )
  );

const optionalKindQueryFromPositionalsEffect = (
  kind: StartAgentGraphQueryKind,
  positionals: readonly string[]
): Effect.Effect<StartAgentGraphQuery, CliError.CliError> => {
  if (positionals.length > 1) {
    return Effect.fail(tooManyGraphQueryValuesError([kind, ...positionals]));
  }

  const [text] = positionals;
  return Effect.succeed({
    kind,
    ...(text === undefined ? {} : { text })
  });
};

const optionalKindQueryFromCliInputEffect = (
  kind: StartAgentGraphQueryKind,
  positionals: readonly string[],
  queryTextOption: Option.Option<string>
): Effect.Effect<StartAgentGraphQuery, CliError.CliError> => {
  const queryText = Option.getOrUndefined(queryTextOption);
  if (queryText === undefined) {
    return optionalKindQueryFromPositionalsEffect(kind, positionals);
  }
  if (positionals.length > 0) {
    return Effect.fail(queryFlagConflictError([kind, ...positionals], queryText));
  }
  return Effect.succeed({ kind, text: queryText });
};

const requiredKindQueryFromPositionalsEffect = (
  kind: StartAgentGraphQueryKind,
  positionals: readonly string[]
): Effect.Effect<StartAgentGraphQuery, CliError.CliError> => {
  if (positionals.length > 1) {
    return Effect.fail(tooManyGraphQueryValuesError([kind, ...positionals]));
  }

  const [text] = positionals;
  return text === undefined || text.trim().length === 0
    ? Effect.fail(missingImpactQueryError(kind))
    : Effect.succeed({ kind, text });
};

const requiredKindQueryFromCliInputEffect = (
  kind: StartAgentGraphQueryKind,
  positionals: readonly string[],
  queryTextOption: Option.Option<string>
): Effect.Effect<StartAgentGraphQuery, CliError.CliError> => {
  const queryText = Option.getOrUndefined(queryTextOption);
  if (queryText === undefined) {
    return requiredKindQueryFromPositionalsEffect(kind, positionals);
  }
  if (positionals.length > 0) {
    return Effect.fail(queryFlagConflictError([kind, ...positionals], queryText));
  }
  return queryText.trim().length === 0
    ? Effect.fail(missingImpactQueryError(kind))
    : Effect.succeed({ kind, text: queryText });
};

const makeUsageError = (
  message: string,
  guidance: string = startDiagnosticsCliUsage
): StartDiagnosticsCliUsageError =>
  new StartDiagnosticsCliUsageError({
    message,
    guidance
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

const formatConsoleArgs = (args: ReadonlyArray<unknown>): string =>
  args.map((arg) => typeof arg === "string" ? arg : String(arg)).join(" ");

const makeStartDiagnosticsCliConsole = (
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Console.Console => ({
  ...noopConsole,
  error: (...args: ReadonlyArray<unknown>) => {
    stderr(formatConsoleArgs(args));
  },
  log: (...args: ReadonlyArray<unknown>) => {
    stdout(formatConsoleArgs(args));
  }
});

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

const queryTextFlag = Flag.string("query").pipe(
  Flag.withDescription("Graph or impact query text. Use this when the query text starts with '-'."),
  Flag.optional
);

const graphQueryArgument = Argument.string("query").pipe(
  Argument.variadic(),
  Argument.withDescription("Optional graph kind and query text.")
);

const impactQueryArgument = Argument.string("query").pipe(
  Argument.variadic(),
  Argument.withDescription("Required impact kind and query text.")
);

const graphKindQueryArgument = (kind: StartAgentGraphQueryKind) =>
  Argument.string("query").pipe(
    Argument.variadic(),
    Argument.withDescription("Optional graph query text.")
  );

const impactKindQueryArgument = (kind: StartAgentGraphQueryKind) =>
  Argument.string("query").pipe(
    Argument.variadic(),
    Argument.withDescription("Required impact query text.")
  );

const graphSharedFlags = {
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("Print raw graph ids, facts, and edges for graph output.")
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

const makeStartDiagnosticsCliCommand = (
  handleCommand: (
    command: Exclude<StartCliCommand, { readonly _tag: "Help" }>
  ) => Effect.Effect<void, unknown>
) => {
  const root = Command.make("effect-ui-start").pipe(
    Command.withSharedFlags(commonStartDiagnosticsCliFlags)
  );

  const diagnostics = Command.make(
    "diagnostics",
    {},
    () =>
      Effect.gen(function* () {
        const common = yield* root;
        yield* handleCommand({
          _tag: "Diagnostics",
          options: commonOptionsFromCliConfig(common)
        });
      })
  ).pipe(
    Command.withDescription("Print app graph diagnostics and repair findings.")
  );

  const graphBase = Command.make(
    "graph",
    {
      query: graphQueryArgument,
      queryText: queryTextFlag
    }
  ).pipe(
    Command.withSharedFlags(graphSharedFlags),
    Command.withDescription("Print the agent-readable semantic app graph.")
  );

  let graph: Command.Command.Any = graphBase;

  graph = graphBase.pipe(
    Command.withHandler((config) =>
      Effect.gen(function* () {
        const common = yield* root;
        const query = yield* queryFromCliInputEffect(config.query, config.queryText);
        yield* handleCommand({
          _tag: "Graph",
          options: {
            ...commonOptionsFromCliConfig(common),
            verbose: config.verbose,
            ...(query === undefined ? {} : { query })
          }
        });
      })
    ),
    Command.withSubcommands(
      startAgentGraphQueryKinds.map((kind) =>
        Command.make(
          kind,
          {
            query: graphKindQueryArgument(kind),
            queryText: queryTextFlag
          },
          (config) =>
            Effect.gen(function* () {
              const common = yield* root;
              const graphCommon = yield* graph;
              const query = yield* optionalKindQueryFromCliInputEffect(
                kind,
                config.query,
                config.queryText
              );
              yield* handleCommand({
                _tag: "Graph",
                options: {
                  ...commonOptionsFromCliConfig(common),
                  verbose: graphCommon.verbose,
                  query
                }
              });
            })
        ).pipe(
          Command.withDescription(`Print ${kind} entries from the semantic app graph.`)
        )
      )
    )
  );

  const impactBase = Command.make(
    "impact",
    {
      query: impactQueryArgument,
      queryText: queryTextFlag
    },
    (config) =>
      Effect.gen(function* () {
        const common = yield* root;
        const query = yield* requiredQueryFromCliInputEffect(config.query, config.queryText);
        yield* handleCommand({
          _tag: "Impact",
          options: {
            ...commonOptionsFromCliConfig(common),
            query
          }
        });
      })
  ).pipe(
    Command.withDescription("Print edit impact for one route/action/resource/module.")
  );

  const impact = impactBase.pipe(
    Command.withSubcommands(
      startAgentGraphQueryKinds.map((kind) =>
        Command.make(
          kind,
          {
            query: impactKindQueryArgument(kind),
            queryText: queryTextFlag
          },
          (config) =>
            Effect.gen(function* () {
              const common = yield* root;
              const query = yield* requiredKindQueryFromCliInputEffect(
                kind,
                config.query,
                config.queryText
              );
              yield* handleCommand({
                _tag: "Impact",
                options: {
                  ...commonOptionsFromCliConfig(common),
                  query
                }
              });
            })
        ).pipe(
          Command.withDescription(`Print edit impact for a ${kind}.`)
        )
      )
    )
  );

  return root.pipe(
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
  args: readonly string[],
  console: Console.Console = noopConsole
): Effect.Effect<void, unknown> =>
  Command.runWith(command, { version: startDiagnosticsCliVersion })(args).pipe(
    Effect.provideService(Console.Console, console),
    Effect.provide(startDiagnosticsCliCommandEnvironmentLayer)
  );

const usageErrorFromCliCause = (
  cause: unknown,
  guidance: string = startDiagnosticsCliUsage
): StartDiagnosticsCliUsageError => {
  if (cause instanceof StartDiagnosticsCliUsageError) {
    return cause;
  }

  if (CliError.isCliError(cause)) {
    if (cause._tag === "ShowHelp" && cause.errors.length > 0) {
      return makeUsageError(cause.errors.map((error) => error.message).join("\n"), guidance);
    }
    return makeUsageError(cause.message, guidance);
  }

  if (cause instanceof Error) {
    return makeUsageError(cause.message, guidance);
  }

  return makeUsageError(String(cause), guidance);
};

/** Parses CLI argv into a diagnostics command or help request as an Effect. */
export const parseStartDiagnosticsCliArgsEffect = (
  args: readonly string[]
): Effect.Effect<StartCliCommand, StartDiagnosticsCliUsageError> => {
  return Effect.gen(function* () {
    const parsedCommandRef = yield* Ref.make<
      Exclude<StartCliCommand, { readonly _tag: "Help" }> | undefined
    >(undefined);
    const command = makeStartDiagnosticsCliCommand((parsedCommand) =>
      Ref.set(parsedCommandRef, parsedCommand)
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

    const grammarResult = yield* runStartDiagnosticsCliCommandGrammarEffect(
      command,
      args,
      makeStartDiagnosticsCliConsole(
        (text) => stdout.push(text),
        (text) => stderr.push(text)
      )
    ).pipe(
      Effect.map(() => ({ _tag: "Success" as const })),
      Effect.catch((cause) => Effect.succeed({ _tag: "Failure" as const, cause }))
    );

    if (grammarResult._tag === "Failure") {
      if (CliError.isCliError(grammarResult.cause) && grammarResult.cause._tag === "ShowHelp" && grammarResult.cause.errors.length === 0) {
        return { _tag: "Help" };
      }

      const guidance = stdout.join("\n") || stderr.join("\n") || startDiagnosticsCliUsage;
      return yield* Effect.fail(usageErrorFromCliCause(grammarResult.cause, guidance));
    }

    const parsedCommand = yield* Ref.get(parsedCommandRef);
    if (parsedCommand === undefined) {
      return { _tag: "Help" };
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

    const cliResultRef = yield* Ref.make<StartDiagnosticsCliResult | undefined>(undefined);
    const command = makeStartDiagnosticsCliCommand((parsedCommand) =>
      runStartDiagnosticsCliCommandEffect(parsedCommand, io).pipe(
        Effect.tap((result) => Ref.set(cliResultRef, result)),
        Effect.asVoid
      )
    );

    const grammarResult = yield* runStartDiagnosticsCliCommandGrammarEffect(
      command,
      args,
      makeStartDiagnosticsCliConsole(stdout, stderr)
    ).pipe(
      Effect.map(() => ({ _tag: "Success" as const })),
      Effect.catch((cause) => Effect.succeed({ _tag: "Failure" as const, cause }))
    );

    if (grammarResult._tag === "Failure") {
      if (CliError.isCliError(grammarResult.cause) && grammarResult.cause._tag === "ShowHelp") {
        return { exitCode: grammarResult.cause.errors.length === 0 ? 0 : 1 };
      }

      const payload = startDiagnosticsCliErrorPayload(grammarResult.cause);
      yield* writeStartDiagnosticsCliLineEffect(stderr, String(payload.message));
      return { exitCode: 1 };
    }

    return (yield* Ref.get(cliResultRef)) ?? { exitCode: 0 };
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
