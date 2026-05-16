import type {
  StartAgentGraphImpactOptions,
  StartAgentGraphQuery,
  StartAgentGraphQueryKind
} from "./agent-graph.js";

/**
 * Query kinds exposed by the `effect-ui-start graph` and `effect-ui-start impact`
 * Effect CLI command trees.
 */
export const startAgentGraphQueryKinds = [
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

const startAgentGraphQueryKindSet = new Set<StartAgentGraphQueryKind>(
  startAgentGraphQueryKinds
);

/** Checks whether an argv value is one of the Start agent graph query subcommands. */
export const isStartAgentGraphQueryKind = (
  value: string
): value is StartAgentGraphQueryKind =>
  startAgentGraphQueryKindSet.has(value as StartAgentGraphQueryKind);

/** Human-readable query-kind list for usage and CLI validation messages. */
export const startAgentGraphQueryKindsText = (): string =>
  startAgentGraphQueryKinds.join(", ");

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

/** Effect CLI commands agents should run to verify an impact query. */
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
