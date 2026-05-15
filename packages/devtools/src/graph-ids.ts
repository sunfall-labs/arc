import type {
  DevtoolsCausalEdgeKind,
  DevtoolsStartAppGraphMissingSchema,
  DevtoolsStartAppGraphModuleKind,
  DevtoolsSummaryInvalidationCause,
  DevtoolsSummaryInvalidationTarget,
  DevtoolsSummaryRequestTrace,
  DevtoolsSummaryRuntimeEvent
} from "./index.js";

export const devtoolsActionNodeId = (name: string): string => `action:${name}`;

export const devtoolsCollectionNodeId = (collection: string): string => `collection:${collection}`;

export const devtoolsEndpointNodeId = (name: string): string => `endpoint:${name}`;

export const devtoolsProgramNodeId = (name: string): string => `program:${name}`;

export const devtoolsProgramPanelItemId = (eventId: string): string => `program-event:${eventId}`;

export const devtoolsInvalidationNodeId = (index: number): string => `invalidation:${index}`;

export const devtoolsMissingSchemaNodeId = (schema: DevtoolsStartAppGraphMissingSchema): string =>
  `missing-schema:${schema.kind}:${schema.name}:${schema.input ? "input" : "no-input"}:${schema.output ? "output" : "no-output"}:${schema.error ? "error" : "no-error"}`;

export const devtoolsMissingSchemaPanelItemId = (
  schema: Pick<DevtoolsStartAppGraphMissingSchema, "kind" | "name">
): string => `missing-schema:${schema.kind}:${schema.name}`;

export const devtoolsModuleNodeId = (
  kind: "server-only" | "browser-client" | "route" | DevtoolsStartAppGraphModuleKind,
  path: string
): string => `module:${kind}:${path}`;

export const devtoolsResourceFamilyNodeId = (name: string): string => `resource-family:${name}`;

export const devtoolsResourceNodeId = (key: string): string => `resource:${key}`;

export const devtoolsRequestTraceNodeId = (
  trace: Pick<DevtoolsSummaryRequestTrace, "id">
): string => `request-trace:${trace.id}`;

export const devtoolsRequestPanelItemId = (
  trace: Pick<DevtoolsSummaryRequestTrace, "id">
): string => `request:${trace.id}`;

export const devtoolsRouteNodeId = (path: string): string => `route:${path}`;

export const devtoolsRoutePanelItemId = (routeId: string): string => `route:${routeId}`;

export const devtoolsRoutePlanNodeId = (index: number, href: string): string =>
  `route-plan:${index}:${href}`;

export const devtoolsRoutePlanPanelItemId = (index: number): string => `route-plan:${index}`;

export const devtoolsSchemaCoverageNodeId = (kind: "serverFunctions" | "actions"): string =>
  `schema-coverage:${kind}`;

export const devtoolsServerFunctionNodeId = (name: string): string => `server-function:${name}`;

export const devtoolsResourceTagNodeId = (key: string): string => `resource-tag:${key}`;

export const devtoolsUnknownActionPanelItemId = (name: string): string => `unknown-action:${name}`;

export const devtoolsUnknownRoutePreloadCollectionsPanelItemId = (routeId: string): string =>
  `unknown-preload-collections:${routeId}`;

export const devtoolsUnknownRoutePreloadResourcesPanelItemId = (routeId: string): string =>
  `unknown-preload-resources:${routeId}`;

export const devtoolsRuntimeEventNodeId = (
  event: Pick<DevtoolsSummaryRuntimeEvent, "sequence" | "_tag">
): string => `runtime-event:${event.sequence}:${event._tag}`;

export const devtoolsRuntimeEventSummaryId = (
  sequence: number,
  tag: DevtoolsSummaryRuntimeEvent["_tag"]
): string => `runtime-event:${sequence}:${tag}`;

export const devtoolsInvalidationTargetNodeId = (
  target: DevtoolsSummaryInvalidationTarget | DevtoolsSummaryInvalidationCause
): string => target._tag === "Tag"
  ? devtoolsResourceTagNodeId(target.key)
  : devtoolsResourceNodeId(target.key);

export const devtoolsRuntimeTargetLabel = (
  target: NonNullable<DevtoolsSummaryRuntimeEvent["target"]>
): string =>
  target.kind === "Collection" && target.id.startsWith("collection:")
    ? target.id.slice("collection:".length)
    : target.kind === "Program" && target.id.startsWith("program:")
      ? target.id.slice("program:".length)
    : target.kind === "RequestTrace" && target.id.startsWith("request-trace:")
      ? target.id.slice("request-trace:".length)
      : target.id;

const framedGraphId = (
  tag: string,
  parts: ReadonlyArray<string>
): string =>
  `${tag}[${parts.map((part) => `${part.length}:${part}`).join("|")}]`;

export const devtoolsCausalEdgeId = (
  kind: DevtoolsCausalEdgeKind,
  source: string,
  target: string,
  label: string | null,
  ordinal: number
): string =>
  framedGraphId("edge", [kind, source, target, label ?? "", String(ordinal)]);
