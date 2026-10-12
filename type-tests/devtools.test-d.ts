import { Effect, Scope, type Fiber } from "effect";
import type { Resource, Timeline } from "@sunfall/arc-core";
import {
  Devtools,
  DevtoolsActionInvalidationPlanConflict,
  DevtoolsPanelContractError,
} from "@sunfall/arc-devtools";

type DevtoolsPanelId = Devtools.Panel["id"];
type DevtoolsPanelSeverity = Devtools.Panel["severity"];
type DevtoolsPanelMetric = Devtools.Panel["metrics"][number];
type DevtoolsPanelItem = Devtools.Panel["items"][number];
type DevtoolsCausalNodeKind = Devtools.CausalGraph["nodes"][number]["kind"];
type DevtoolsCausalEdgeKind = Devtools.CausalGraph["edges"][number]["kind"];
type DevtoolsSummaryRuntimeEvent = Devtools.Summary["runtime"]["events"][number];

const devtoolsStoreOptions: Devtools.StoreOptions = {
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
const devtoolsStore: Devtools.Store = Devtools.makeStore(devtoolsStoreOptions);
const devtoolsSnapshot: Devtools.Snapshot = Effect.runSync(devtoolsStore.getSnapshot());
const devtoolsSnapshotEffect: Effect.Effect<Devtools.Snapshot> = devtoolsStore.getSnapshot();
Effect.runSync(devtoolsStore.setSnapshot(devtoolsSnapshot));
const devtoolsSetSnapshotEffect: Effect.Effect<void> = devtoolsStore.setSnapshot(devtoolsSnapshot);
const devtoolsSummary: Devtools.Summary = Effect.runSync(devtoolsStore.getSummary());
const devtoolsSummaryEffect: Effect.Effect<Devtools.Summary> = devtoolsStore.getSummary();
const devtoolsPanels: Devtools.Panels = Effect.runSync(devtoolsStore.getPanels());
const devtoolsPanelsEffect: Effect.Effect<Devtools.Panels> = devtoolsStore.getPanels();
const devtoolsCausalGraph: Devtools.CausalGraph = Effect.runSync(devtoolsStore.getCausalGraph());
const devtoolsCausalGraphEffect: Effect.Effect<Devtools.CausalGraph> =
  devtoolsStore.getCausalGraph();
declare const devtoolsActionInstance: Parameters<Devtools.Store["recordAction"]>[0];
declare const devtoolsRoutePlanInput: Parameters<Devtools.Store["recordRoutePlan"]>[0];
declare const devtoolsTimelineRecording: Parameters<Devtools.Store["trackTimeline"]>[0];
declare const devtoolsTimelineEntry: Timeline.Entry;
const devtoolsRecordActionEffect: Effect.Effect<void> =
  devtoolsStore.recordAction(devtoolsActionInstance);
const devtoolsTrackActionEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackAction(devtoolsActionInstance);
const devtoolsRecordRoutePlanEffect: Effect.Effect<number> =
  devtoolsStore.recordRoutePlan(devtoolsRoutePlanInput);
const devtoolsTrackTimelineEffect: Effect.Effect<void, never, Scope.Scope> =
  devtoolsStore.trackTimeline(devtoolsTimelineRecording);
const devtoolsCustomRuntimeEvent: Devtools.RuntimeEvent = {
  _tag: "Custom",
  name: "type-test",
  payload: { ok: true },
};
const devtoolsRecordCustomRuntimeEventEffect: Effect.Effect<void> =
  devtoolsStore.recordRuntimeEvent(devtoolsCustomRuntimeEvent);

const devtoolsSummaryInput: Devtools.SummaryInput = {
  snapshot: devtoolsSnapshot,
  runtimeEvents: [],
};
const describedDevtoolsSummary: Devtools.Summary = Devtools.describeSummary(devtoolsSummaryInput);
const describedDevtoolsPanels: Devtools.Panels = Devtools.describePanels({
  summary: describedDevtoolsSummary,
});
const describedDevtoolsCausalGraph: Devtools.CausalGraph =
  Devtools.describeCausalGraph(devtoolsSummaryInput);
void devtoolsRecordActionEffect;
void devtoolsTrackActionEffect;
void devtoolsRecordRoutePlanEffect;
void devtoolsTrackTimelineEffect;
void devtoolsRecordCustomRuntimeEventEffect;

const devtoolsPanelId: DevtoolsPanelId = "requests";
const devtoolsPanelSeverity: DevtoolsPanelSeverity = "info";
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
const devtoolsPanel: Devtools.Panel = {
  id: devtoolsPanelId,
  title: "Requests",
  summary: "1 request",
  severity: devtoolsPanelSeverity,
  metrics: [devtoolsPanelMetric],
  items: [devtoolsPanelItem],
};
const explicitDevtoolsPanels: Devtools.Panels = {
  version: 1,
  panels: [devtoolsPanel],
};
const devtoolsPanelsInput: Devtools.PanelsInput = {
  summary: describedDevtoolsSummary,
};
const devtoolsPanelUiInput: Devtools.PanelUiInput = {
  panels: explicitDevtoolsPanels,
  selectedPanelId: "requests",
  maxItemsPerPanel: 4,
};

declare const devtoolsPanelRoot: HTMLElement;
const devtoolsPanelMountOptions: Devtools.PanelMountOptions = {
  root: devtoolsPanelRoot,
  panels: explicitDevtoolsPanels,
};
const devtoolsPanelMountEffect: Effect.Effect<Devtools.PanelMount, never, Scope.Scope> =
  Devtools.mountPanels(devtoolsPanelMountOptions).pipe(
    Effect.tap((mount) =>
      Effect.sync(() =>
        mount.update({ panels: explicitDevtoolsPanels, selectedPanelId: "actions" }),
      ),
    ),
  );
const renderedDevtoolsHtml: string = Devtools.renderPanelsHtml(devtoolsPanelUiInput);
const devtoolsPanelBootOptions: Devtools.PanelBootOptions = {
  ...devtoolsPanelMountOptions,
  afterMount: (mount) => Effect.sync(() => mount.update({ selectedPanelId: "diagnostics" })),
};
const devtoolsPanelBoot: Devtools.PanelBoot = Devtools.bootPanels(devtoolsPanelBootOptions);
const devtoolsBootFiber: Fiber.Fiber<void, never> = devtoolsPanelBoot.fiber;
devtoolsPanelBoot.interrupt();

const devtoolsSerializationPolicy: Devtools.SerializationPolicy = {
  maxDepth: 2,
  maxEntries: 4,
  maxStringLength: 16,
};
const devtoolsSerializedWithPolicy: Devtools.SerializableValue = Devtools.toSerializable(
  { nested: { value: "atlas" } },
  devtoolsSerializationPolicy,
);
const invalidDevtoolsSerializationPolicy: Devtools.SerializationPolicy = {
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

const serializedInvalidationPlan: Devtools.InvalidationPlan = {
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
const serializedRoutePlan: Devtools.RoutePlan = {
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
const devtoolsRequestTrace: Devtools.RequestTrace = {
  request: {
    id: "request-1",
    method: "GET",
    url: "https://example.test/projects/atlas",
    path: "/projects/atlas",
    transport: "ssr",
  },
  services: [],
  resources: [],
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
const devtoolsTimelineCommit: Devtools.TimelineCommit = {
  sequence: 1,
  label: 'Program "ProjectProgram" message Refresh',
  cause: { _tag: "Program", program: "ProjectProgram", event: "message", message: "Refresh" },
  changes: [{ signal: "ProjectProgram.model", previous: { loading: true }, next: {} }],
};
const devtoolsTimelineCommitWithSignal: Devtools.TimelineCommit = {
  sequence: 1,
  label: "commit",
  // @ts-expect-error Timeline commits label changed signals by name, not by signal reference.
  changes: [{ signal: devtoolsTimelineEntry.changes[0]!.signal, previous: 0, next: 1 }],
};
Effect.runSync(devtoolsStore.recordTimelineEntry(devtoolsTimelineEntry));
const devtoolsRecordTimelineEntryEffect: Effect.Effect<void> =
  devtoolsStore.recordTimelineEntry(devtoolsTimelineEntry);
const devtoolsRuntimeEvents: ReadonlyArray<Devtools.RuntimeEvent> = [
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
const devtoolsRuntimeSnapshot: Devtools.Snapshot = {
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
const invalidDevtoolsRuntimeEvent: Devtools.RuntimeEvent = {
  // @ts-expect-error runtime event tags are a fixed public union
  _tag: "Network",
  sequence: 1,
};

declare const devtoolsLiveInvalidationPlan: Resource.InvalidationPlan;
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
const devtoolsLiveActionStateOptions: Devtools.RecordActionStateOptions = {
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
} as unknown as Devtools.RecordActionStateOptions);
const devtoolsRecordRuntimeEventEffect: Effect.Effect<void> = devtoolsStore.recordRuntimeEvent(
  devtoolsRuntimeEvents[7]!,
);
Effect.runSync(devtoolsStore.recordRuntimeEvent(devtoolsRuntimeEvents[0]!));
Effect.runSync(devtoolsStore.recordRequestTrace(devtoolsRequestTrace));
const devtoolsRecordRequestTraceEffect: Effect.Effect<void> =
  devtoolsStore.recordRequestTrace(devtoolsRequestTrace);

const devtoolsBridgePayload: Devtools.BridgePayload = {
  panels: explicitDevtoolsPanels,
  selectedPanelId: "requests",
  title: "Sunfall Arc Devtools",
};
const devtoolsBridgePayloadResolution: Devtools.BridgePayloadResolution =
  Devtools.resolveBridgePayload(devtoolsBridgePayload);
if (devtoolsBridgePayloadResolution._tag === "Valid") {
  const resolvedBridgePayload: Devtools.BridgePayload = devtoolsBridgePayloadResolution.payload;
  void resolvedBridgePayload;
}
const invalidDevtoolsBridgePayloadResolution = Devtools.resolveBridgePayload({
  panels: { version: 2, panels: [] },
});
if (invalidDevtoolsBridgePayloadResolution._tag === "Invalid") {
  const bridgeError: DevtoolsPanelContractError = invalidDevtoolsBridgePayloadResolution.error;
  const bridgeReason: DevtoolsPanelContractError["reason"] = bridgeError.reason;
  const bridgeDiagnosticPanels: Devtools.Panels = invalidDevtoolsBridgePayloadResolution.panels;
  void bridgeReason;
  void bridgeDiagnosticPanels;
}
const devtoolsBridgeTarget: Devtools.BridgeTarget = {};
devtoolsBridgeTarget[Devtools.bridgeGlobal] = () => devtoolsBridgePayload;
const devtoolsBridgeInstallEffect: Effect.Effect<Devtools.BridgeInstall, never, Scope.Scope> =
  Devtools.installBridge(devtoolsBridgePayload, devtoolsBridgeTarget);
const devtoolsBridgeUninstall: Effect.Effect<void, never, Scope.Scope> = Effect.map(
  devtoolsBridgeInstallEffect,
  (install) => install.uninstall(),
);

declare const devtoolsAppGraph: Devtools.AppGraphDiagnostics;
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
void devtoolsSerializedInvalidationIndex;
void devtoolsSerializedInvalidationIndexEffect;
void devtoolsSerializedRoutePlanIndex;
void devtoolsSerializedRoutePlanIndexEffect;
void devtoolsRecordTimelineEntryEffect;
void devtoolsTimelineCommitWithSignal;
void devtoolsRecordActionStateEffect;
void devtoolsRecordActionStateConflictEffect;
void devtoolsRecordRuntimeEventEffect;
void devtoolsRecordRequestTraceEffect;
void devtoolsBridgeInstallEffect;
void devtoolsBridgeUninstall;
void devtoolsSetAppGraphDiagnosticsEffect;
void devtoolsClearAppGraphDiagnosticsEffect;
void devtoolsActionInvalidationPlanConflict;
