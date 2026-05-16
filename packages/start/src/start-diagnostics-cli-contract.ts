import type {
  StartAgentGraphImpactOptions,
  StartAgentGraphQuery
} from "./start-agent-graph-contract.js";
export {
  isStartAgentGraphQueryKind,
  startAgentGraphQueryKinds,
  startAgentGraphQueryKindsText
} from "./start-agent-graph-vocabulary.js";

const shellSafePattern = /^[A-Za-z0-9_./:@=-]+$/;

const shellArg = (
  value: string
): string =>
  shellSafePattern.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;

const shellFlag = (
  name: string,
  value: string | false | undefined
): string =>
  value === undefined
    ? ""
    : ` --${name}=${shellArg(value === false ? "false" : value)}`;

const diagnosticsLoadCommandOptions = (
  options: StartAgentGraphImpactOptions
): string =>
  [
    shellFlag("root", options.root),
    shellFlag("config", options.configFile),
    shellFlag("mode", options.mode)
  ].join("");

const queryCommandArgs = (
  query: StartAgentGraphQuery
): string => {
  const args = [
    ...(query.kind === undefined ? [] : [query.kind]),
    ...(query.text === undefined ? [] : [query.text])
  ];
  if (args.length === 0) {
    return "";
  }
  const rendered = args.map(shellArg).join(" ");
  return args.some((arg) => arg.startsWith("-"))
    ? ` -- ${rendered}`
    : ` ${rendered}`;
};

/**
 * Effect CLI commands agents should run after editing nodes matched by an
 * impact query.
 *
 * Arguments are shell-escaped so impact reports can be pasted directly into
 * repair checklists.
 */
export const startDiagnosticsCliVerifyCommandsForQuery = (
  query: StartAgentGraphQuery,
  options: StartAgentGraphImpactOptions
): readonly string[] => {
  const loadOptions = diagnosticsLoadCommandOptions(options);
  return [
    `effect-ui-start diagnostics${loadOptions}`,
    `effect-ui-start graph${loadOptions}${queryCommandArgs(query)}`
  ];
};
