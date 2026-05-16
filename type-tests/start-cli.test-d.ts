import { Effect } from "effect";
import {
  parseStartDiagnosticsCliArgs,
  parseStartDiagnosticsCliArgsEffect,
  runStartDiagnosticsCli,
  runStartDiagnosticsCliEffect,
  runStartDiagnosticsCliMain,
  runStartDiagnosticsCliMainEffect,
  startDiagnosticsCliUsage,
  StartDiagnosticsCliUsageError,
  StartDiagnosticsCliWriteError,
  type StartCliCommand,
  type StartDiagnosticsCliIo,
  type StartDiagnosticsCliOptions,
  type StartDiagnosticsCliResult,
  type StartGraphCliOptions,
  type StartImpactCliOptions
} from "@effect-ui/start/cli";

const cliIo: StartDiagnosticsCliIo = {
  stdout: (line) => {
    void line;
  },
  stderr: (line) => Effect.sync(() => {
    void line;
  })
};
const parsedStartCliCommand: StartCliCommand = parseStartDiagnosticsCliArgs(["--help"]);
const parsedStartCliCommandEffect: Effect.Effect<StartCliCommand, StartDiagnosticsCliUsageError> =
  parseStartDiagnosticsCliArgsEffect(["graph", "--query=/projects/:id"]);
const startDiagnosticsCliResultEffect: Effect.Effect<StartDiagnosticsCliResult, StartDiagnosticsCliWriteError> =
  runStartDiagnosticsCliEffect(["--help"], cliIo);
const startDiagnosticsCliResultAliasEffect: Effect.Effect<StartDiagnosticsCliResult, StartDiagnosticsCliWriteError> =
  runStartDiagnosticsCli(["--help"], cliIo);
const startDiagnosticsCliMainEffect: Effect.Effect<void, StartDiagnosticsCliWriteError> =
  runStartDiagnosticsCliMainEffect(["--help"]);
const startDiagnosticsCliMainAliasEffect: Effect.Effect<void, StartDiagnosticsCliWriteError> =
  runStartDiagnosticsCliMain(["--help"]);
const startDiagnosticsCliWriteError = new StartDiagnosticsCliWriteError({
  stream: "stdout",
  cause: "boom",
  guidance: "test"
});
const startDiagnosticsCliOptions: StartDiagnosticsCliOptions = {
  json: false,
  pretty: true
};
const startGraphCliOptions: StartGraphCliOptions = {
  ...startDiagnosticsCliOptions,
  verbose: true,
  query: { kind: "route", text: "/projects/:id" }
};
const startImpactCliOptions: StartImpactCliOptions = {
  ...startDiagnosticsCliOptions,
  query: { text: "--route=/projects/:id" }
};
const startDiagnosticsCliUsageText: string = startDiagnosticsCliUsage;

void parsedStartCliCommand;
void parsedStartCliCommandEffect;
void startDiagnosticsCliResultEffect;
void startDiagnosticsCliResultAliasEffect;
void startDiagnosticsCliMainEffect;
void startDiagnosticsCliMainAliasEffect;
void startDiagnosticsCliWriteError;
void startGraphCliOptions;
void startImpactCliOptions;
void startDiagnosticsCliUsageText;
