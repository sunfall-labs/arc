import type { StartAgentGraphNode } from "./start-agent-graph-contract.js";

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export const factString = (
  node: StartAgentGraphNode,
  key: string
): string | undefined => {
  const value = node.facts[key];
  return typeof value === "string" ? value : undefined;
};

export const factRecord = (
  node: StartAgentGraphNode,
  key: string
): Readonly<Record<string, unknown>> | undefined => {
  const value = node.facts[key];
  return isRecord(value) ? value : undefined;
};

export const recordString = (
  record: Readonly<Record<string, unknown>> | undefined,
  key: string
): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};

export const recordBoolean = (
  record: Readonly<Record<string, unknown>> | undefined,
  key: string
): boolean | undefined => {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
};

export const recordStringArray = (
  record: Readonly<Record<string, unknown>> | undefined,
  key: string
): readonly string[] => {
  const value = record?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
};

export const routeParamNames = (
  node: StartAgentGraphNode
): readonly string[] => {
  const params = node.facts.params;
  if (!Array.isArray(params)) {
    return [];
  }
  return params.flatMap((param) =>
    isRecord(param) && typeof param.name === "string"
      ? [param.name]
      : []
  );
};

export const inlineList = (
  values: readonly string[],
  empty = "none"
): string => values.length === 0 ? empty : values.join(", ");

export const formatWire = (
  wire: Readonly<Record<string, unknown>> | undefined
): string => [
  `input ${recordBoolean(wire, "inputSchema") === true ? "present" : "missing"}`,
  `output ${recordBoolean(wire, "outputSchema") === true ? "present" : "missing"}`,
  `error ${recordBoolean(wire, "errorSchema") === true ? "present" : "missing"}`
].join(", ");

export const formatBehavior = (
  behavior: Readonly<Record<string, unknown>> | undefined
): string => [
  `invalidates ${recordString(behavior, "invalidates") ?? "unknown"}`,
  `optimistic ${recordString(behavior, "optimistic") ?? "unknown"}`,
  `retry ${recordString(behavior, "retry") ?? "unknown"}`,
  `concurrency ${recordString(behavior, "concurrency") ?? "unknown"}`
].join(", ");

export const titleForNode = (
  node: StartAgentGraphNode
): string => {
  switch (node.kind) {
    case "ServerFunction":
      return `Server function ${node.label}`;
    case "ResourceFamily":
      return `Resource family ${node.label}`;
    case "ResourceTag":
      return `Resource tag ${node.label}`;
    default:
      return `${node.kind} ${node.label}`;
  }
};

export const formatRouteSummary = (
  node: StartAgentGraphNode
): readonly string[] => {
  const preloadResources = factRecord(node, "preloadResources");
  const preloadCollections = factRecord(node, "preloadCollections");
  return [
    `Params: ${inlineList(routeParamNames(node))}`,
    `Schemas: params ${factString(node, "paramsSchema") ?? "unknown"}, search ${factString(node, "searchSchema") ?? "unknown"}`,
    `Preloads: resources ${inlineList(recordStringArray(preloadResources, "families"))}; collections ${inlineList(recordStringArray(preloadCollections, "collections"))}`
  ];
};

export const formatActionSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Wire schemas: ${formatWire(factRecord(node, "wire"))}`,
  `Behavior: ${formatBehavior(factRecord(node, "behavior"))}`
];

export const formatServerFunctionSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Wire schemas: ${formatWire(factRecord(node, "wire"))}`
];

export const formatFindingSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Issue: ${factString(node, "issue") ?? "unknown"}`,
  `Fix: ${factString(node, "edit") ?? "unknown"}`
];

export const formatGenericSummary = (
  node: StartAgentGraphNode
): readonly string[] => [
  `Kind: ${node.kind}`,
  `Name: ${node.label}`
];

export const publicStatus = (
  node: StartAgentGraphNode
): string => node.status === "known" ? "pass" : "needs attention";
