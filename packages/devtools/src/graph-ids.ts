import type {
  DevtoolsCausalEdgeKind,
  DevtoolsSummaryInvalidationCause,
  DevtoolsSummaryInvalidationTarget,
  DevtoolsSummaryRequest,
  DevtoolsSummaryRuntimeEvent,
} from "./devtools-contract.js";

export const devtoolsActionNodeId = (name: string): string => `action:${name}`;

export const devtoolsStateNodeId = (name: string): string => `state:${name}`;

export const devtoolsStatePanelItemId = (eventId: string): string => `state-event:${eventId}`;

export const devtoolsInvalidationNodeId = (index: number): string => `invalidation:${index}`;

export const devtoolsResourceNodeId = (key: string): string => `resource:${key}`;

export const devtoolsRequestPanelItemId = (request: Pick<DevtoolsSummaryRequest, "id">): string =>
  `request:${request.id}`;

export const devtoolsRouteNodeId = (path: string): string => `route:${path}`;

export const devtoolsRoutePlanNodeId = (index: number, href: string): string =>
  `route-plan:${index}:${href}`;

export const devtoolsRoutePlanPanelItemId = (index: number): string => `route-plan:${index}`;

export const devtoolsResourceTagNodeId = (key: string): string => `resource-tag:${key}`;

export const devtoolsRuntimeEventNodeId = (
  event: Pick<DevtoolsSummaryRuntimeEvent, "sequence" | "_tag">,
): string => `runtime-event:${event.sequence}:${event._tag}`;

export const devtoolsRuntimeEventSummaryId = (
  sequence: number,
  tag: DevtoolsSummaryRuntimeEvent["_tag"],
): string => `runtime-event:${sequence}:${tag}`;

export const devtoolsInvalidationTargetNodeId = (
  target: DevtoolsSummaryInvalidationTarget | DevtoolsSummaryInvalidationCause,
): string =>
  target._tag === "Tag"
    ? devtoolsResourceTagNodeId(target.key)
    : devtoolsResourceNodeId(target.key);

export const devtoolsRuntimeTargetLabel = (
  target: NonNullable<DevtoolsSummaryRuntimeEvent["target"]>,
): string =>
  target.kind === "State" && target.id.startsWith("state:")
    ? target.id.slice("state:".length)
    : target.id;

const framedGraphId = (tag: string, parts: ReadonlyArray<string>): string =>
  `${tag}[${parts.map((part) => `${part.length}:${part}`).join("|")}]`;

export const devtoolsCausalEdgeId = (
  kind: DevtoolsCausalEdgeKind,
  source: string,
  target: string,
  label: string | null,
  ordinal: number,
): string => framedGraphId("edge", [kind, source, target, label ?? "", String(ordinal)]);
