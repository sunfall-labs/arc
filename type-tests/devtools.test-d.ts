import { Effect, Scope, type Fiber } from "effect";
import type { ResourceInvalidationPlan } from "@effect-ui/core";
import {
  DevtoolsActionInvalidationPlanConflict,
  DevtoolsPanelContractError,
  DevtoolsUnknownInvalidationTarget,
  bootDevtoolsPanels,
  describeDevtoolsCausalGraph,
  describeDevtoolsCausalGraphEffect,
  describeInvalidationPlan,
  describeRoutePlan,
  describeDevtoolsPanels,
  describeDevtoolsPanelsEffect,
  describeDevtoolsSummary,
  describeDevtoolsSummaryEffect,
  devtoolsPanelIds,
  devtoolsPanelSeverities,
  devtoolsPanelStyles,
  effectUiDevtoolsBridgeGlobal,
  installDevtoolsBridge,
  installDevtoolsBridgeEffect,
  interruptDevtoolsPanelBoot,
  isDevtoolsPanel,
  isDevtoolsPanelId,
  isDevtoolsPanelItem,
  isDevtoolsPanelMetric,
  isDevtoolsPanelOverflowItem,
  isDevtoolsPanels,
  isDevtoolsPanelSeverity,
  isDevtoolsSerializableValue,
  makeDevtoolsStore,
  mountDevtoolsPanels,
  mountDevtoolsPanelsEffect,
  normalizeDevtoolsPanels,
  normalizeEffectUiDevtoolsBridgePayload,
  resolveDevtoolsPanelContract,
  resolveDevtoolsPanelsInput,
  resolveEffectUiDevtoolsBridgePayload,
  renderDevtoolsPanelsHtml,
  renderDevtoolsPanelsHtmlEffect,
  toDevtoolsSerializableValue,
  type DevtoolsBridgePayload,
  type DevtoolsBridgePayloadContractResolution,
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
  type DevtoolsPanelContractResolution,
  type DevtoolsPanelId,
  type DevtoolsPanelItem,
  type DevtoolsPanelMetric,
  type DevtoolsPanelMount,
  type DevtoolsPanelMountOptions,
  type DevtoolsPanels,
  type DevtoolsPanelsInput,
  type DevtoolsPanelSeverity,
  type DevtoolsPanelUiInput,
  type DevtoolsProgramEvent,
  type DevtoolsRecordActionStateOptions,
  type DevtoolsRequestTrace,
  type DevtoolsRoutePlan,
  type DevtoolsRuntimeEvent,
  type DevtoolsSerializationPolicy,
  type DevtoolsSerializableValue,
  type DevtoolsSnapshot,
  type DevtoolsStartAppGraphDiagnostics,
  type DevtoolsStore,
  type DevtoolsStoreOptions,
  type DevtoolsSummary,
  type DevtoolsSummaryInput,
  type DevtoolsSummaryRuntimeEvent
} from "@effect-ui/devtools";

const devtoolsStoreOptions: DevtoolsStoreOptions = {
  invalidationLimit: 4,
  routePlanLimit: 4,
  requestTraceLimit: 4,
  eventLimit: 16,
  serializationPolicy: {
    maxDepth: 4,
    maxEntries: 20,
    maxStringLength: 200,
    redactKeys: ["tenantSecret", /private/i]
  }
};
const devtoolsStore: DevtoolsStore = makeDevtoolsStore(devtoolsStoreOptions);
const devtoolsSnapshot: DevtoolsSnapshot = devtoolsStore.getSnapshot();
const devtoolsSnapshotEffect: Effect.Effect<DevtoolsSnapshot> = devtoolsStore.getSnapshotEffect();
devtoolsStore.setSnapshot(devtoolsSnapshot);
const devtoolsSetSnapshotEffect: Effect.Effect<void> = devtoolsStore.setSnapshotEffect(devtoolsSnapshot);
const devtoolsSummary: DevtoolsSummary = devtoolsStore.getSummary();
const devtoolsSummaryEffect: Effect.Effect<DevtoolsSummary> = devtoolsStore.getSummaryEffect();
const devtoolsPanels: DevtoolsPanels = devtoolsStore.getPanels();
const devtoolsPanelsEffect: Effect.Effect<DevtoolsPanels> = devtoolsStore.getPanelsEffect();
const devtoolsCausalGraph: DevtoolsCausalGraph = devtoolsStore.getCausalGraph();
const devtoolsCausalGraphEffect: Effect.Effect<DevtoolsCausalGraph> =
  devtoolsStore.getCausalGraphEffect();

const devtoolsSummaryInput: DevtoolsSummaryInput = {
  snapshot: devtoolsSnapshot,
  runtimeEvents: []
};
const describedDevtoolsSummary: DevtoolsSummary = describeDevtoolsSummary(devtoolsSummaryInput);
const describedDevtoolsSummaryEffect: Effect.Effect<DevtoolsSummary> =
  describeDevtoolsSummaryEffect(devtoolsSummaryInput);
const describedDevtoolsPanels: DevtoolsPanels = describeDevtoolsPanels({
  summary: describedDevtoolsSummary
});
const describedDevtoolsPanelsEffect: Effect.Effect<DevtoolsPanels> =
  describeDevtoolsPanelsEffect({ summary: describedDevtoolsSummary });
const describedDevtoolsCausalGraph: DevtoolsCausalGraph =
  describeDevtoolsCausalGraph(devtoolsSummaryInput);
const describedDevtoolsCausalGraphEffect: Effect.Effect<DevtoolsCausalGraph> =
  describeDevtoolsCausalGraphEffect(devtoolsSummaryInput);

const devtoolsPanelId: DevtoolsPanelId = devtoolsPanelIds[0]!;
const devtoolsPanelSeverity: DevtoolsPanelSeverity = devtoolsPanelSeverities[0]!;
const devtoolsCssText: string = devtoolsPanelStyles;
const devtoolsPanelMetric: DevtoolsPanelMetric = {
  label: "Requests",
  value: 1,
  unit: "count"
};
const devtoolsPanelItem: DevtoolsPanelItem = {
  id: "request:1",
  label: "GET /projects/atlas",
  severity: devtoolsPanelSeverity,
  metrics: [devtoolsPanelMetric],
  data: { route: "/projects/:id" }
};
const devtoolsPanel: DevtoolsPanel = {
  id: devtoolsPanelId,
  title: "Requests",
  summary: "1 request",
  severity: devtoolsPanelSeverity,
  metrics: [devtoolsPanelMetric],
  items: [devtoolsPanelItem]
};
const explicitDevtoolsPanels: DevtoolsPanels = {
  version: 1,
  panels: [devtoolsPanel]
};
const devtoolsPanelsInput: DevtoolsPanelsInput = {
  summary: describedDevtoolsSummary
};
const devtoolsPanelUiInput: DevtoolsPanelUiInput = {
  panels: explicitDevtoolsPanels,
  selectedPanelId: "requests",
  maxItemsPerPanel: 4
};
if (isDevtoolsPanelId(devtoolsPanelId) && isDevtoolsPanelSeverity(devtoolsPanelSeverity)) {
  devtoolsPanelId.toUpperCase();
  devtoolsPanelSeverity.toUpperCase();
}
if (
  isDevtoolsPanelMetric(devtoolsPanelMetric) &&
  isDevtoolsPanelItem(devtoolsPanelItem) &&
  isDevtoolsPanelOverflowItem(devtoolsPanelId, devtoolsPanelItem) &&
  isDevtoolsPanel(devtoolsPanel) &&
  isDevtoolsSerializableValue(devtoolsPanelItem.data)
) {
  devtoolsPanel.items.map((item) => item.label);
}
if (isDevtoolsPanels(explicitDevtoolsPanels)) {
  explicitDevtoolsPanels.panels.map((panel) => panel.id);
}
const normalizedDevtoolsPanels: DevtoolsPanels | undefined =
  normalizeDevtoolsPanels(explicitDevtoolsPanels);
const resolvedDevtoolsPanelsInput: DevtoolsPanels = resolveDevtoolsPanelsInput(
  devtoolsPanelsInput,
  describeDevtoolsPanels
);
const devtoolsPanelContractResolution: DevtoolsPanelContractResolution =
  resolveDevtoolsPanelContract(explicitDevtoolsPanels);
if (devtoolsPanelContractResolution._tag === "Valid") {
  const resolvedPanels: DevtoolsPanels = devtoolsPanelContractResolution.panels;
  void resolvedPanels;
}
const invalidDevtoolsPanelContractResolution = resolveDevtoolsPanelContract({
  version: 2,
  panels: []
});
if (invalidDevtoolsPanelContractResolution._tag === "Invalid") {
  const contractError: DevtoolsPanelContractError = invalidDevtoolsPanelContractResolution.error;
  const contractReason: DevtoolsPanelContractErrorReason = contractError.reason;
  const diagnosticPanels: DevtoolsPanels = invalidDevtoolsPanelContractResolution.panels;
  void contractReason;
  void diagnosticPanels;
}

declare const devtoolsPanelRoot: HTMLElement;
const devtoolsPanelMountOptions: DevtoolsPanelMountOptions = {
  root: devtoolsPanelRoot,
  panels: explicitDevtoolsPanels
};
const devtoolsPanelMount: DevtoolsPanelMount = mountDevtoolsPanels(devtoolsPanelMountOptions);
devtoolsPanelMount.update({
  panels: normalizedDevtoolsPanels ?? explicitDevtoolsPanels,
  selectedPanelId: "actions"
});
devtoolsPanelMount.unmount();
const devtoolsPanelMountEffect: Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> =
  mountDevtoolsPanelsEffect(devtoolsPanelMountOptions);
const renderedDevtoolsHtml: string = renderDevtoolsPanelsHtml(devtoolsPanelUiInput);
const renderedDevtoolsHtmlEffect: Effect.Effect<string> =
  renderDevtoolsPanelsHtmlEffect(devtoolsPanelUiInput);
const devtoolsPanelBootOptions: DevtoolsPanelBootOptions = {
  ...devtoolsPanelMountOptions,
  afterMount: (mount) =>
    Effect.sync(() => mount.update({ selectedPanelId: "diagnostics" }))
};
const devtoolsPanelBoot: DevtoolsPanelBoot = bootDevtoolsPanels(devtoolsPanelBootOptions);
const interruptedDevtoolsPanelBootEffect: Effect.Effect<void> =
  interruptDevtoolsPanelBoot(devtoolsPanelBoot.fiber);
const devtoolsBootFiber: Fiber.Fiber<void, never> = devtoolsPanelBoot.fiber;
devtoolsPanelBoot.interrupt();

const devtoolsSerializationPolicy: DevtoolsSerializationPolicy = {
  maxDepth: 2,
  maxEntries: 4,
  maxStringLength: 16
};
const devtoolsSerializedWithPolicy: DevtoolsSerializableValue =
  toDevtoolsSerializableValue({ nested: { value: "atlas" } }, devtoolsSerializationPolicy);
const invalidDevtoolsSerializationPolicy: DevtoolsSerializationPolicy = {
  // @ts-expect-error serialization policy limits are numeric
  maxDepth: "deep"
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
      name: "Project"
    }
  ],
  entries: [
    {
      ref: {
        key: "Project.byId:atlas",
        family: "Project.byId",
        input: "atlas"
      },
      causes: [
        {
          _tag: "Tag",
          key: "Project:atlas",
          name: "Project"
        }
      ]
    }
  ]
};
const serializedRoutePlan: DevtoolsRoutePlan = {
  _tag: "Matched",
  href: "/projects/atlas",
  match: {
    path: "/projects/:id",
    href: "/projects/atlas",
    params: { id: "atlas" },
    search: {}
  },
  resources: [],
  hydration: {
    resourceCount: 0
  }
};
const devtoolsRequestTrace: DevtoolsRequestTrace = {
  request: {
    id: "request-1",
    method: "GET",
    url: "https://example.test/projects/atlas",
    path: "/projects/atlas",
    transport: "ssr"
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
      tagCount: 1
    },
    afterDispose: {
      fiberCount: 0,
      familyCount: 1,
      moduleCount: 0,
      tagCount: 1
    }
  }
};
const devtoolsProgramEvent: DevtoolsProgramEvent = {
  _tag: "Message",
  sequence: 1,
  program: "ProjectProgram",
  message: { _tag: "Refresh" },
  before: { selected: undefined, loading: false },
  after: { selected: undefined, loading: false },
  commandCount: 0
};
const devtoolsCollectionStoreEvent: DevtoolsCollectionStoreEvent = {
  _tag: "CollectionWritten",
  collection: "Projects",
  mutations: 1
};
devtoolsStore.recordProgramEvent(devtoolsProgramEvent);
const devtoolsRecordProgramEventEffect: Effect.Effect<void> =
  devtoolsStore.recordProgramEventEffect(devtoolsProgramEvent);
devtoolsStore.recordCollectionEvent(devtoolsCollectionStoreEvent);
const devtoolsRecordCollectionEventEffect: Effect.Effect<void> =
  devtoolsStore.recordCollectionEventEffect(devtoolsCollectionStoreEvent);
const devtoolsRuntimeEvents: ReadonlyArray<DevtoolsRuntimeEvent> = [
  {
    _tag: "ResourceStoreEvent",
    sequence: 1,
    event: {
      _tag: "ResourcePending",
      name: "Project.byId",
      key: "atlas",
      force: false,
      previous: false
    }
  },
  {
    _tag: "CollectionStoreEvent",
    event: devtoolsCollectionStoreEvent
  },
  {
    _tag: "ProgramEvent",
    event: devtoolsProgramEvent
  },
  {
    _tag: "ActionState",
    action: "Project.touch",
    state: "Success",
    input: { id: "atlas" }
  },
  {
    _tag: "Invalidation",
    action: "Project.touch",
    plan: serializedInvalidationPlan
  },
  {
    _tag: "RoutePlan",
    plan: serializedRoutePlan
  },
  {
    _tag: "RequestTrace",
    trace: devtoolsRequestTrace
  },
  {
    _tag: "Custom",
    name: "host:ready",
    payload: { ready: true }
  }
];
const devtoolsRuntimeSnapshot: DevtoolsSnapshot = {
  resources: [],
  actions: [],
  invalidations: [serializedInvalidationPlan],
  routePlans: [serializedRoutePlan],
  requestTraces: [devtoolsRequestTrace],
  events: devtoolsRuntimeEvents
};
const devtoolsSummaryRuntimeEvent: DevtoolsSummaryRuntimeEvent = {
  index: 0,
  id: "runtime:0",
  _tag: "Custom",
  sequence: 1,
  at: null,
  label: "host:ready",
  target: null,
  data: { ready: true }
};
const invalidDevtoolsRuntimeEvent: DevtoolsRuntimeEvent = {
  // @ts-expect-error runtime event tags are a fixed public union
  _tag: "Network",
  sequence: 1
};

declare const devtoolsLiveInvalidationPlan: ResourceInvalidationPlan;
declare const devtoolsLiveRoutePlan: Parameters<typeof describeRoutePlan>[0];
const describedLiveInvalidationPlan: DevtoolsInvalidationPlan =
  describeInvalidationPlan(devtoolsLiveInvalidationPlan);
const describedLiveRoutePlan: DevtoolsRoutePlan =
  describeRoutePlan(devtoolsLiveRoutePlan);
const devtoolsUnknownInvalidationTarget: DevtoolsUnknownInvalidationTarget =
  new DevtoolsUnknownInvalidationTarget({
    target: "not-a-resource",
    guidance: "Use Resource refs or tags."
  });
const devtoolsSerializedInvalidationIndex: number =
  devtoolsStore.recordSerializedInvalidation(serializedInvalidationPlan);
const devtoolsSerializedInvalidationIndexEffect: Effect.Effect<number> =
  devtoolsStore.recordSerializedInvalidationEffect(serializedInvalidationPlan);
const devtoolsSerializedRoutePlanIndex: number =
  devtoolsStore.recordSerializedRoutePlan(serializedRoutePlan);
const devtoolsSerializedRoutePlanIndexEffect: Effect.Effect<number> =
  devtoolsStore.recordSerializedRoutePlanEffect(serializedRoutePlan);
devtoolsStore.recordActionState("Project.touch", "Success", {
  serializedInvalidationPlan
});
const devtoolsRecordActionStateEffect: Effect.Effect<void> =
  devtoolsStore.recordActionStateEffect("Project.touch", "Success", {
    serializedInvalidationPlan
  });
const devtoolsLiveActionStateOptions: DevtoolsRecordActionStateOptions = {
  input: { id: "atlas" },
  invalidationPlan: devtoolsLiveInvalidationPlan
};
devtoolsStore.recordActionState("Project.touch", "Success", devtoolsLiveActionStateOptions);
devtoolsStore.recordActionState("Project.touch", "Success", {
  invalidationPlan: devtoolsLiveInvalidationPlan,
  // @ts-expect-error devtools action state accepts either live or serialized invalidation plans, not both
  serializedInvalidationPlan
});
const devtoolsRecordRuntimeEventEffect: Effect.Effect<void> =
  devtoolsStore.recordRuntimeEventEffect(devtoolsRuntimeEvents[7]!);
devtoolsStore.recordRuntimeEvent(devtoolsRuntimeEvents[0]!);
devtoolsStore.recordRequestTrace(devtoolsRequestTrace);
const devtoolsRecordRequestTraceEffect: Effect.Effect<void> =
  devtoolsStore.recordRequestTraceEffect(devtoolsRequestTrace);

const devtoolsBridgePayload: DevtoolsBridgePayload = {
  panels: explicitDevtoolsPanels,
  selectedPanelId: "requests",
  title: "Effect UI Devtools"
};
const normalizedBridgePayload: DevtoolsBridgePayload | undefined =
  normalizeEffectUiDevtoolsBridgePayload(devtoolsBridgePayload);
const devtoolsBridgePayloadResolution: DevtoolsBridgePayloadContractResolution =
  resolveEffectUiDevtoolsBridgePayload(devtoolsBridgePayload);
if (devtoolsBridgePayloadResolution._tag === "Valid") {
  const resolvedBridgePayload: DevtoolsBridgePayload = devtoolsBridgePayloadResolution.payload;
  void resolvedBridgePayload;
}
const invalidDevtoolsBridgePayloadResolution = resolveEffectUiDevtoolsBridgePayload({
  panels: { version: 2, panels: [] }
});
if (invalidDevtoolsBridgePayloadResolution._tag === "Invalid") {
  const bridgeError: DevtoolsPanelContractError = invalidDevtoolsBridgePayloadResolution.error;
  const bridgeReason: DevtoolsPanelContractErrorReason = bridgeError.reason;
  const bridgeDiagnosticPanels: DevtoolsPanels = invalidDevtoolsBridgePayloadResolution.panels;
  void bridgeReason;
  void bridgeDiagnosticPanels;
}
const devtoolsBridgeTarget: DevtoolsBridgeTarget = {};
const devtoolsBridgeInstall = installDevtoolsBridge(devtoolsBridgePayload, devtoolsBridgeTarget);
devtoolsBridgeTarget[effectUiDevtoolsBridgeGlobal] = () => devtoolsBridgePayload;
devtoolsBridgeInstall.uninstall();
const devtoolsBridgeInstallEffect: Effect.Effect<void, never, Scope.Scope> =
  installDevtoolsBridgeEffect(() => devtoolsBridgePayload, devtoolsBridgeTarget);

declare const devtoolsAppGraph: DevtoolsStartAppGraphDiagnostics;
devtoolsStore.setAppGraphDiagnostics(devtoolsAppGraph);
const devtoolsSetAppGraphDiagnosticsEffect: Effect.Effect<void> =
  devtoolsStore.setAppGraphDiagnosticsEffect(devtoolsAppGraph);
devtoolsStore.clearAppGraphDiagnostics();
const devtoolsClearAppGraphDiagnosticsEffect: Effect.Effect<void> =
  devtoolsStore.clearAppGraphDiagnosticsEffect();
const devtoolsActionInvalidationPlanConflict: DevtoolsActionInvalidationPlanConflict =
  new DevtoolsActionInvalidationPlanConflict({ guidance: "Choose one invalidation plan source." });

void devtoolsSnapshotEffect;
void devtoolsSetSnapshotEffect;
void devtoolsSummaryEffect;
void devtoolsPanelsEffect;
void devtoolsCausalGraphEffect;
void devtoolsCausalGraph;
void describedDevtoolsSummaryEffect;
void describedDevtoolsPanelsEffect;
void describedDevtoolsCausalGraph;
void describedDevtoolsCausalGraphEffect;
void resolvedDevtoolsPanelsInput;
void devtoolsPanelMountEffect;
void devtoolsCssText;
void renderedDevtoolsHtml;
void renderedDevtoolsHtmlEffect;
void interruptedDevtoolsPanelBootEffect;
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
void devtoolsRecordProgramEventEffect;
void devtoolsRecordCollectionEventEffect;
void devtoolsRecordActionStateEffect;
void devtoolsRecordRuntimeEventEffect;
void devtoolsRecordRequestTraceEffect;
void normalizedBridgePayload;
void devtoolsBridgeInstallEffect;
void devtoolsSetAppGraphDiagnosticsEffect;
void devtoolsClearAppGraphDiagnosticsEffect;
void devtoolsActionInvalidationPlanConflict;
