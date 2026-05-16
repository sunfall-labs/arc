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

const rootCommandOption = (
  root: string | undefined
): string =>
  root === undefined ? "" : ` --root ${shellArg(root)}`;

const queryCommandArgs = (
  query: StartAgentGraphQuery
): string => {
  const args = [
    ...(query.kind === undefined ? [] : [query.kind]),
    ...(query.text === undefined ? [] : [query.text])
  ];
  return args.length === 0 ? "" : ` ${args.map(shellArg).join(" ")}`;
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
  const root = rootCommandOption(options.root);
  return [
    `effect-ui-start diagnostics${root}`,
    `effect-ui-start graph${queryCommandArgs(query)}${root}`
  ];
};
