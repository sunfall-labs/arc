import { Effect, Scope, type Fiber } from "effect";
import type { ResourceInvalidationPlan, TimelineEntry } from "@sunfall/arc-core";
import {
  DevtoolsActionInvalidationPlanConflict,
  DevtoolsPanelContractError,
  DevtoolsUnknownInvalidationTarget,
  bootDevtoolsPanels,
  describeDevtoolsCausalGraph,
  describeInvalidationPlan,
  describeRoutePlan,
  describeDevtoolsPanels,
  describeDevtoolsSummary,
  devtoolsPanelIds,
  devtoolsPanelSeverities,
  sunfallArcDevtoolsBridgeGlobal,
  installDevtoolsBridge,
  isDevtoolsSerializableValue,
  makeDevtoolsStore,
  mountDevtoolsPanels,
  resolveSunfallArcDevtoolsBridgePayload,
  renderDevtoolsPanelsHtml,
  toDevtoolsSerializableValue,
  type DevtoolsBridgePayload,
  type DevtoolsBridgePayloadContractResolution,
  type DevtoolsBridgeInstall,
  type DevtoolsBridgeTarget,
  type DevtoolsCausalEdgeKind,
  type DevtoolsCausalGraph,
  type DevtoolsCausalNodeKind,
  type DevtoolsCollectionStoreEvent,
  type DevtoolsInvalidationPlan,
  type DevtoolsPanel,
  type DevtoolsPanelBoot,
  type DevtoolsPanelBootOptions,
  type DevtoolsPanelContractErrorReason,
  type DevtoolsPanelId,
  type DevtoolsPanelItem,
  type DevtoolsPanelMetric,
  type DevtoolsPanelMount,
  type DevtoolsPanelMountOptions,
  type DevtoolsPanels,
  type DevtoolsPanelsInput,
  type DevtoolsPanelSeverity,
  type DevtoolsPanelUiInput,
  type DevtoolsTimelineCommit,
  type DevtoolsRecordActionStateOptions,
  type DevtoolsRequestTrace,
  type DevtoolsRoutePlan,
  type DevtoolsRuntimeEvent,
  type DevtoolsSerializationPolicy,
  type DevtoolsSerializableValue,
  type DevtoolsSnapshot,
  type DevtoolsStartAppGraphDiagnostics,
  type DevtoolsStartAppGraphSchemaCoverage,
  type DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry,
  type DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry,
  type DevtoolsStore,
  type DevtoolsStoreOptions,
  type DevtoolsSummary,
  type DevtoolsSummaryInput,
  type DevtoolsSummaryRuntimeEvent,
} from "@sunfall/arc-devtools";

const devtoolsStoreOptions: DevtoolsStoreOptions = {
  invalidationLimit: 4,
  routePlanLimit: 4,
  requestTraceLimit: 4,
  eventLimit: 16,
  serializationPolicy: {
    maxDepth: 4,
    maxEntries: 20,
    maxStringLength: 200,
    redactKeys: ["tenantSecret", /private/i],
  },
};
const devtoolsStore: DevtoolsStore = makeDevtoolsStore(devtoolsStoreOptions);
const devtoolsSnapshot: DevtoolsSnapshot = Effect.runSync(devtoolsStore.getSnapshot());
const devtoolsSnapshotEffect: Effect.Effect<DevtoolsSnapshot> = devtoolsStore.getSnapshot();
Effect.runSync(devtoolsStore.setSnapshot(devtoolsSnapshot));
const devtoolsSetSnapshotEffect: Effect.Effect<void> = devtoolsStore.setSnapshot(devtoolsSnapshot);
const devtoolsSummary: DevtoolsSummary = Effect.runSync(devtoolsStore.getSummary());
const devtoolsSummaryEffect: Effect.Effect<DevtoolsSummary> = devtoolsStore.getSummary();
const devtoolsPanels: DevtoolsPanels = Effect.runSync(devtoolsStore.getPanels());
const devtoolsPanelsEffect: Effect.Effect<DevtoolsPanels> = devtoolsStore.getPanels();
const devtoolsCausalGraph: DevtoolsCausalGraph = Effect.runSync(devtoolsStore.getCausalGraph());
const devtoolsCausalGraphEffect: Effect.Effect<DevtoolsCausalGraph> =
  devtoolsStore.getCausalGraph();
declare const devtoolsActionInstance: Parameters<DevtoolsStore["recordAction"]>[0];
declare const devtoolsRoutePlanInput: Parameters<DevtoolsStore["recordRoutePlan"]>[0];
declare const devtoolsTimelineRecording: Parameters<DevtoolsStore["trackTimeline"]>[0];
declare const devtoolsTimelineEntry: TimelineEntry;
const devtoolsRecordActionEffect: Effect.Effect<void> =
  devtoolsStore.recordAction(devtoolsActionInstance);
const devtoolsTrackActionEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackAction(devtoolsActionInstance);
const devtoolsRecordRoutePlanEffect: Effect.Effect<number> =
  devtoolsStore.recordRoutePlan(devtoolsRoutePlanInput);
const devtoolsTrackTimelineEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackTimeline(devtoolsTimelineRecording);
const devtoolsCustomRuntimeEvent: DevtoolsRuntimeEvent = {
  _tag: "Custom",
  name: "type-test",
  payload: { ok: true },
};
const devtoolsRecordCustomRuntimeEventEffect: Effect.Effect<void> =
  devtoolsStore.recordRuntimeEvent(devtoolsCustomRuntimeEvent);

const devtoolsSummaryInput: DevtoolsSummaryInput = {
  snapshot: devtoolsSnapshot,
  runtimeEvents: [],
};
const describedDevtoolsSummary: DevtoolsSummary = describeDevtoolsSummary(devtoolsSummaryInput);
const describedDevtoolsPanels: DevtoolsPanels = describeDevtoolsPanels({
  summary: describedDevtoolsSummary,
});
const describedDevtoolsCausalGraph: DevtoolsCausalGraph =
  describeDevtoolsCausalGraph(devtoolsSummaryInput);
void devtoolsRecordActionEffect;
void devtoolsTrackActionEffect;
void devtoolsRecordRoutePlanEffect;
void devtoolsTrackTimelineEffect;
void devtoolsRecordCustomRuntimeEventEffect;

const devtoolsPanelId: DevtoolsPanelId = devtoolsPanelIds[0]!;
const devtoolsPanelSeverity: DevtoolsPanelSeverity = devtoolsPanelSeverities[0]!;
const devtoolsPanelMetric: DevtoolsPanelMetric = {
  label: "Requests",
  value: 1,
  unit: "count",
};
const devtoolsPanelItem: DevtoolsPanelItem = {
  id: "request:1",
  label: "GET /projects/atlas",
  severity: devtoolsPanelSeverity,
  metrics: [devtoolsPanelMetric],
  data: { route: "/projects/:id" },
};
const devtoolsPanel: DevtoolsPanel = {
  id: devtoolsPanelId,
  title: "Requests",
  summary: "1 request",
  severity: devtoolsPanelSeverity,
  metrics: [devtoolsPanelMetric],
  items: [devtoolsPanelItem],
};
const explicitDevtoolsPanels: DevtoolsPanels = {
  version: 1,
  panels: [devtoolsPanel],
};
const devtoolsPanelsInput: DevtoolsPanelsInput = {
  summary: describedDevtoolsSummary,
};
const devtoolsPanelUiInput: DevtoolsPanelUiInput = {
  panels: explicitDevtoolsPanels,
  selectedPanelId: "requests",
  maxItemsPerPanel: 4,
};
if (isDevtoolsSerializableValue(devtoolsPanelItem.data)) {
  devtoolsPanel.items.map((item) => item.label);
}

declare const devtoolsPanelRoot: HTMLElement;
const devtoolsPanelMountOptions: DevtoolsPanelMountOptions = {
  root: devtoolsPanelRoot,
  panels: explicitDevtoolsPanels,
};
const devtoolsPanelMountEffect: Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> =
  mountDevtoolsPanels(devtoolsPanelMountOptions).pipe(
    Effect.tap((mount) =>
      Effect.sync(() =>
        mount.update({ panels: explicitDevtoolsPanels, selectedPanelId: "actions" }),
      ),
    ),
  );
const renderedDevtoolsHtml: string = renderDevtoolsPanelsHtml(devtoolsPanelUiInput);
const devtoolsPanelBootOptions: DevtoolsPanelBootOptions = {
  ...devtoolsPanelMountOptions,
  afterMount: (mount) => Effect.sync(() => mount.update({ selectedPanelId: "diagnostics" })),
};
const devtoolsPanelBoot: DevtoolsPanelBoot = bootDevtoolsPanels(devtoolsPanelBootOptions);
const devtoolsBootFiber: Fiber.Fiber<void, never> = devtoolsPanelBoot.fiber;
devtoolsPanelBoot.interrupt();

const devtoolsSerializationPolicy: DevtoolsSerializationPolicy = {
  maxDepth: 2,
  maxEntries: 4,
  maxStringLength: 16,
};
const devtoolsSerializedWithPolicy: DevtoolsSerializableValue = toDevtoolsSerializableValue(
  { nested: { value: "atlas" } },
  devtoolsSerializationPolicy,
);
const invalidDevtoolsSerializationPolicy: DevtoolsSerializationPolicy = {
  // @ts-expect-error serialization policy limits are numeric
  maxDepth: "deep",
};
// @ts-expect-error panel ids are a fixed public union
const invalidDevtoolsPanelId: DevtoolsPanelId = "network";
// @ts-expect-error panel severities are a fixed public union
const invalidDevtoolsPanelSeverity: DevtoolsPanelSeverity = "critical";
// @ts-expect-error invalidation targets are Resource or ResourceTag nodes, not their own public node kind
const invalidDevtoolsCausalNodeKind: DevtoolsCausalNodeKind = "InvalidationTarget";
const devtoolsCausalNodeKind: DevtoolsCausalNodeKind = "RoutePlan";
const devtoolsCausalEdgeKind: DevtoolsCausalEdgeKind = "Records";

const serializedInvalidationPlan: DevtoolsInvalidationPlan = {
  targets: [
    {
      _tag: "Tag",
      key: "Project:atlas",
      name: "Project",
    },
  ],
  entries: [
    {
      ref: {
        key: "Project.byId:atlas",
        family: "Project.byId",
        input: "atlas",
      },
      causes: [
        {
          _tag: "Tag",
          key: "Project:atlas",
          name: "Project",
        },
      ],
    },
  ],
};
const serializedRoutePlan: DevtoolsRoutePlan = {
  _tag: "Matched",
  href: "/projects/atlas",
  match: {
    path: "/projects/:id",
    href: "/projects/atlas",
    params: { id: "atlas" },
    search: {},
  },
  resources: [],
  hydration: {
    resourceCount: 0,
  },
};
const devtoolsRequestTrace: DevtoolsRequestTrace = {
  request: {
    id: "request-1",
    method: "GET",
    url: "https://example.test/projects/atlas",
    path: "/projects/atlas",
    transport: "ssr",
  },
  services: [],
  resources: [],
  collections: [],
  serverFunctions: [],
  actions: [],
  fibers: [],
  streams: [],
  status: "success",
  teardown: {
    runtimeDisposed: true,
    reason: "response-end",
    startedAt: 10,
    completedAt: 17,
    durationMillis: 7,
    beforeDispose: {
      fiberCount: 2,
      familyCount: 1,
      moduleCount: 1,
      tagCount: 1,
    },
    afterDispose: {
      fiberCount: 0,
      familyCount: 1,
      moduleCount: 0,
      tagCount: 1,
    },
  },
};
const devtoolsTimelineCommit: DevtoolsTimelineCommit = {
  sequence: 1,
  label: 'Program "ProjectProgram" message Refresh',
  cause: { _tag: "Program", program: "ProjectProgram", event: "message", message: "Refresh" },
  changes: [{ signal: "ProjectProgram.model", previous: { loading: true }, next: {} }],
};
const devtoolsTimelineCommitWithSignal: DevtoolsTimelineCommit = {
  sequence: 1,
  label: "commit",
  // @ts-expect-error Timeline commits label changed signals by name, not by signal reference.
  changes: [{ signal: devtoolsTimelineEntry.changes[0]!.signal, previous: 0, next: 1 }],
};
const devtoolsCollectionStoreEvent: DevtoolsCollectionStoreEvent = {
  _tag: "CollectionWritten",
  collection: "Projects",
  mutations: 1,
};
Effect.runSync(devtoolsStore.recordTimelineEntry(devtoolsTimelineEntry));
const devtoolsRecordTimelineEntryEffect: Effect.Effect<void> =
  devtoolsStore.recordTimelineEntry(devtoolsTimelineEntry);
Effect.runSync(devtoolsStore.recordCollectionEvent(devtoolsCollectionStoreEvent));
const devtoolsRecordCollectionEventEffect: Effect.Effect<void> =
  devtoolsStore.recordCollectionEvent(devtoolsCollectionStoreEvent);
const devtoolsRuntimeEvents: ReadonlyArray<DevtoolsRuntimeEvent> = [
  {
    _tag: "ResourceStoreEvent",
    sequence: 1,
    event: {
      _tag: "ResourcePending",
      name: "Project.byId",
      key: "atlas",
      force: false,
      previous: false,
    },
  },
  {
    _tag: "CollectionStoreEvent",
    event: devtoolsCollectionStoreEvent,
  },
  {
    _tag: "TimelineCommit",
    at: 1,
    commit: devtoolsTimelineCommit,
  },
  {
    _tag: "ActionState",
    action: "Project.touch",
    state: "Success",
    input: { id: "atlas" },
  },
  {
    _tag: "Invalidation",
    action: "Project.touch",
    plan: serializedInvalidationPlan,
  },
  {
    _tag: "RoutePlan",
    plan: serializedRoutePlan,
  },
  {
    _tag: "RequestTrace",
    trace: devtoolsRequestTrace,
  },
  {
    _tag: "Custom",
    name: "host:ready",
    payload: { ready: true },
  },
];
const devtoolsRuntimeSnapshot: DevtoolsSnapshot = {
  resources: [],
  actions: [],
  invalidations: [serializedInvalidationPlan],
  routePlans: [serializedRoutePlan],
  requestTraces: [devtoolsRequestTrace],
  events: devtoolsRuntimeEvents,
};
const devtoolsSummaryRuntimeEvent: DevtoolsSummaryRuntimeEvent = {
  index: 0,
  id: "runtime:0",
  _tag: "Custom",
  sequence: 1,
  at: null,
  label: "host:ready",
  target: null,
  data: { ready: true },
};
const invalidDevtoolsRuntimeEvent: DevtoolsRuntimeEvent = {
  // @ts-expect-error runtime event tags are a fixed public union
  _tag: "Network",
  sequence: 1,
};

declare const devtoolsLiveInvalidationPlan: ResourceInvalidationPlan;
declare const devtoolsLiveRoutePlan: Parameters<typeof describeRoutePlan>[0];
const describedLiveInvalidationPlan: DevtoolsInvalidationPlan = describeInvalidationPlan(
  devtoolsLiveInvalidationPlan,
);
const describedLiveRoutePlan: DevtoolsRoutePlan = describeRoutePlan(devtoolsLiveRoutePlan);
const devtoolsUnknownInvalidationTarget: DevtoolsUnknownInvalidationTarget =
  new DevtoolsUnknownInvalidationTarget({
    target: "not-a-resource",
    guidance: "Use Resource refs or tags.",
  });
const devtoolsSerializedInvalidationIndex: number = Effect.runSync(
  devtoolsStore.recordSerializedInvalidation(serializedInvalidationPlan),
);
const devtoolsSerializedInvalidationIndexEffect: Effect.Effect<number> =
  devtoolsStore.recordSerializedInvalidation(serializedInvalidationPlan);
const devtoolsSerializedRoutePlanIndex: number = Effect.runSync(
  devtoolsStore.recordSerializedRoutePlan(serializedRoutePlan),
);
const devtoolsSerializedRoutePlanIndexEffect: Effect.Effect<number> =
  devtoolsStore.recordSerializedRoutePlan(serializedRoutePlan);
Effect.runSync(
  devtoolsStore.recordActionState("Project.touch", "Success", {
    serializedInvalidationPlan,
  }),
);
const devtoolsRecordActionStateEffect: Effect.Effect<void, DevtoolsActionInvalidationPlanConflict> =
  devtoolsStore.recordActionState("Project.touch", "Success", {
    serializedInvalidationPlan,
  });
const devtoolsLiveActionStateOptions: DevtoolsRecordActionStateOptions = {
  input: { id: "atlas" },
  invalidationPlan: devtoolsLiveInvalidationPlan,
};
Effect.runSync(
  devtoolsStore.recordActionState("Project.touch", "Success", devtoolsLiveActionStateOptions),
);
Effect.runSync(
  devtoolsStore.recordActionState("Project.touch", "Success", {
    invalidationPlan: devtoolsLiveInvalidationPlan,
    // @ts-expect-error devtools action state accepts either live or serialized invalidation plans, not both
    serializedInvalidationPlan,
  }),
);
const devtoolsRecordActionStateConflictEffect: Effect.Effect<
  void,
  DevtoolsActionInvalidationPlanConflict
> = devtoolsStore.recordActionState("Project.touch", "Success", {
  invalidationPlan: devtoolsLiveInvalidationPlan,
  serializedInvalidationPlan,
} as unknown as DevtoolsRecordActionStateOptions);
const devtoolsRecordRuntimeEventEffect: Effect.Effect<void> = devtoolsStore.recordRuntimeEvent(
  devtoolsRuntimeEvents[7]!,
);
Effect.runSync(devtoolsStore.recordRuntimeEvent(devtoolsRuntimeEvents[0]!));
Effect.runSync(devtoolsStore.recordRequestTrace(devtoolsRequestTrace));
const devtoolsRecordRequestTraceEffect: Effect.Effect<void> =
  devtoolsStore.recordRequestTrace(devtoolsRequestTrace);

const devtoolsBridgePayload: DevtoolsBridgePayload = {
  panels: explicitDevtoolsPanels,
  selectedPanelId: "requests",
  title: "Sunfall Arc Devtools",
};
const devtoolsBridgePayloadResolution: DevtoolsBridgePayloadContractResolution =
  resolveSunfallArcDevtoolsBridgePayload(devtoolsBridgePayload);
if (devtoolsBridgePayloadResolution._tag === "Valid") {
  const resolvedBridgePayload: DevtoolsBridgePayload = devtoolsBridgePayloadResolution.payload;
  void resolvedBridgePayload;
}
const invalidDevtoolsBridgePayloadResolution = resolveSunfallArcDevtoolsBridgePayload({
  panels: { version: 2, panels: [] },
});
if (invalidDevtoolsBridgePayloadResolution._tag === "Invalid") {
  const bridgeError: DevtoolsPanelContractError = invalidDevtoolsBridgePayloadResolution.error;
  const bridgeReason: DevtoolsPanelContractErrorReason = bridgeError.reason;
  const bridgeDiagnosticPanels: DevtoolsPanels = invalidDevtoolsBridgePayloadResolution.panels;
  void bridgeReason;
  void bridgeDiagnosticPanels;
}
const devtoolsBridgeTarget: DevtoolsBridgeTarget = {};
devtoolsBridgeTarget[sunfallArcDevtoolsBridgeGlobal] = () => devtoolsBridgePayload;
const devtoolsBridgeInstallEffect: Effect.Effect<DevtoolsBridgeInstall, never, Scope.Scope> =
  installDevtoolsBridge(devtoolsBridgePayload, devtoolsBridgeTarget);
const devtoolsBridgeUninstall: Effect.Effect<void, never, Scope.Scope> = Effect.map(
  devtoolsBridgeInstallEffect,
  (install) => install.uninstall(),
);

declare const devtoolsAppGraph: DevtoolsStartAppGraphDiagnostics;
const devtoolsStartSchemaCoverage: DevtoolsStartAppGraphSchemaCoverage =
  devtoolsAppGraph.schemaCoverage.actions;
type DevtoolsStartUnknowns =
  | DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry
  | DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry;
Effect.runSync(devtoolsStore.setAppGraphDiagnostics(devtoolsAppGraph));
const devtoolsSetAppGraphDiagnosticsEffect: Effect.Effect<void> =
  devtoolsStore.setAppGraphDiagnostics(devtoolsAppGraph);
Effect.runSync(devtoolsStore.clearAppGraphDiagnostics());
const devtoolsClearAppGraphDiagnosticsEffect: Effect.Effect<void> =
  devtoolsStore.clearAppGraphDiagnostics();
const devtoolsActionInvalidationPlanConflict: DevtoolsActionInvalidationPlanConflict =
  new DevtoolsActionInvalidationPlanConflict({ guidance: "Choose one invalidation plan source." });

void devtoolsSnapshotEffect;
void devtoolsSetSnapshotEffect;
void devtoolsSummaryEffect;
void devtoolsPanelsEffect;
void devtoolsCausalGraphEffect;
void devtoolsCausalGraph;
void describedDevtoolsCausalGraph;
void devtoolsPanelMountEffect;
void renderedDevtoolsHtml;
void devtoolsBootFiber;
void devtoolsSerializedWithPolicy;
void invalidDevtoolsSerializationPolicy;
void invalidDevtoolsPanelId;
void invalidDevtoolsPanelSeverity;
void invalidDevtoolsCausalNodeKind;
void devtoolsCausalNodeKind;
void devtoolsCausalEdgeKind;
void devtoolsRuntimeSnapshot;
void devtoolsSummaryRuntimeEvent;
void invalidDevtoolsRuntimeEvent;
void describedLiveInvalidationPlan;
void describedLiveRoutePlan;
void devtoolsUnknownInvalidationTarget;
void devtoolsSerializedInvalidationIndex;
void devtoolsSerializedInvalidationIndexEffect;
void devtoolsSerializedRoutePlanIndex;
void devtoolsSerializedRoutePlanIndexEffect;
void devtoolsRecordTimelineEntryEffect;
void devtoolsTimelineCommitWithSignal;
void devtoolsRecordCollectionEventEffect;
void devtoolsRecordActionStateEffect;
void devtoolsRecordActionStateConflictEffect;
void devtoolsRecordRuntimeEventEffect;
void devtoolsRecordRequestTraceEffect;
void devtoolsBridgeInstallEffect;
void devtoolsBridgeUninstall;
void devtoolsSetAppGraphDiagnosticsEffect;
void devtoolsClearAppGraphDiagnosticsEffect;
void devtoolsActionInvalidationPlanConflict;
void devtoolsStartSchemaCoverage;
type _DevtoolsStartUnknowns = DevtoolsStartUnknowns;
