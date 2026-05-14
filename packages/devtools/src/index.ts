import { isResourceRef, isResourceTag, type ActionInstance, type ActionState, type ReadableSignal, type ResourceInvalidation, type ResourceInvalidationCause, type ResourceInvalidationPlan, type ResourceStoreEvent, type Route } from "@effect-ui/core";
import { Data, Effect, type Scope } from "effect";

export type DevtoolsSerializableValue =
  | null
  | boolean
  | number
  | string
  | readonly DevtoolsSerializableValue[]
  | { readonly [key: string]: DevtoolsSerializableValue };

export type DevtoolsInvalidationTarget =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
      readonly input: unknown;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

export type DevtoolsInvalidationCause =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

export interface DevtoolsInvalidationPlan {
  readonly targets: ReadonlyArray<DevtoolsInvalidationTarget>;
  readonly entries: ReadonlyArray<{
    readonly ref: {
      readonly key: string;
      readonly family: string;
      readonly input: unknown;
    };
    readonly causes: ReadonlyArray<DevtoolsInvalidationCause>;
  }>;
}

export interface DevtoolsRoutePlan {
  readonly _tag: "Matched" | "NotFound";
  readonly href: string;
  readonly match:
    | {
        readonly path: string;
        readonly href: string;
        readonly params: unknown;
        readonly search: unknown;
      }
    | undefined;
  readonly resources: ReadonlyArray<{
    readonly key: string;
    readonly family: string;
    readonly input: unknown;
  }>;
  readonly hydration: {
    readonly resourceCount: number;
  };
}

export interface DevtoolsSnapshotResource {
  readonly key: string;
  readonly state: string;
}

export interface DevtoolsSnapshotAction {
  readonly name: string;
  readonly state: string;
  readonly invalidationIndexes?: ReadonlyArray<number>;
}

export type DevtoolsRecordActionStateOptions = {
  readonly input?: unknown;
} & (
  | {
      readonly invalidationPlan?: ResourceInvalidationPlan | undefined;
      readonly serializedInvalidationPlan?: never;
    }
  | {
      readonly invalidationPlan?: never;
      readonly serializedInvalidationPlan?: DevtoolsInvalidationPlan | undefined;
    }
);

export interface DevtoolsStartActionInstance {
  readonly definition: {
    readonly name: string;
  };
  readonly state: ReadableSignal<ActionState<unknown, unknown, unknown>>;
  readonly invalidation: ReadableSignal<DevtoolsInvalidationPlan | undefined>;
}

export type DevtoolsCollectionStoreEvent =
  | { readonly _tag: "CollectionLoaded"; readonly collection: string; readonly count: number; readonly updatedAt: number }
  | { readonly _tag: "CollectionLoadFailure"; readonly collection: string; readonly error: unknown }
  | { readonly _tag: "CollectionHydrated"; readonly collection: string; readonly count: number; readonly updatedAt: number }
  | { readonly _tag: "CollectionPersisted"; readonly collection: string; readonly key: string; readonly count: number }
  | { readonly _tag: "CollectionRestored"; readonly collection: string; readonly key: string; readonly count: number }
  | { readonly _tag: "CollectionMutationQueued"; readonly collection: string; readonly transaction: string; readonly mutations: number; readonly pending: number }
  | { readonly _tag: "CollectionMutateStarted"; readonly collection: string; readonly transaction: string; readonly mutations: number }
  | { readonly _tag: "CollectionMutationDequeued"; readonly collection: string; readonly transaction: string; readonly pending: number }
  | { readonly _tag: "CollectionMutateCommitted"; readonly collection: string; readonly transaction: string; readonly mutations: number }
  | { readonly _tag: "CollectionMutateRolledBack"; readonly collection: string; readonly transaction: string; readonly error: unknown }
  | { readonly _tag: "CollectionWritten"; readonly collection: string; readonly mutations: number };

export type DevtoolsRequestTraceTransport = "ssr" | "rpc" | "action" | "unknown";
export type DevtoolsRequestTraceStatus = "success" | "failure" | "cancelled";
export type DevtoolsRequestTraceStreamState = "open" | "closed" | "cancelled" | "errored";
export type DevtoolsRequestTraceFiberStatus = "running" | "done" | "interrupted" | "failed";

export class DevtoolsUnknownInvalidationTarget extends Data.TaggedError(
  "DevtoolsUnknownInvalidationTarget"
)<{
  readonly target: unknown;
  readonly guidance: string;
}> {}

export class DevtoolsActionInvalidationPlanConflict extends Data.TaggedError(
  "DevtoolsActionInvalidationPlanConflict"
)<{
  readonly guidance: string;
}> {}

export interface DevtoolsRequestTraceHeader {
  readonly name: string;
  readonly value: string;
}

export interface DevtoolsRequestTraceCookie {
  readonly name: string;
  readonly value: string;
}

export interface DevtoolsRequestTraceRequest {
  readonly id?: string;
  readonly traceparent?: string;
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly transport: DevtoolsRequestTraceTransport;
  readonly headers?: ReadonlyArray<DevtoolsRequestTraceHeader>;
  readonly cookies?: ReadonlyArray<DevtoolsRequestTraceCookie>;
}

export interface DevtoolsRequestTraceResponse {
  readonly status: number;
  readonly statusText?: string;
  readonly headers?: ReadonlyArray<DevtoolsRequestTraceHeader>;
  readonly setCookieCount?: number;
}

export interface DevtoolsRequestTraceResource {
  readonly key: string;
  readonly family: string;
  readonly input?: unknown;
  readonly state?: string;
}

export interface DevtoolsRequestTraceCollection {
  readonly name: string;
  readonly state?: string;
  readonly eventCount?: number;
}

export interface DevtoolsRequestTraceServerFunction {
  readonly name: string;
  readonly status?: DevtoolsRequestTraceStatus;
}

export interface DevtoolsRequestTraceAction {
  readonly name: string;
  readonly state?: string;
  readonly invalidationIndexes?: ReadonlyArray<number>;
}

export interface DevtoolsRequestTraceFiber {
  readonly name: string;
  readonly status: DevtoolsRequestTraceFiberStatus;
}

export interface DevtoolsRequestTraceStream {
  readonly name: string;
  readonly state: DevtoolsRequestTraceStreamState;
  readonly chunkCount?: number;
}

export interface DevtoolsRequestTraceTeardownSnapshot {
  readonly fiberCount: number;
  readonly familyCount: number;
  readonly moduleCount: number;
  readonly tagCount: number;
}

export interface DevtoolsRequestTraceTeardown {
  readonly runtimeDisposed: boolean;
  readonly reason?: string;
  readonly at?: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly durationMillis?: number;
  readonly beforeDispose?: DevtoolsRequestTraceTeardownSnapshot;
  readonly afterDispose?: DevtoolsRequestTraceTeardownSnapshot;
}

export interface DevtoolsRequestTrace {
  readonly request: DevtoolsRequestTraceRequest;
  readonly response?: DevtoolsRequestTraceResponse;
  readonly services: ReadonlyArray<string>;
  readonly routePlan?: DevtoolsRoutePlan;
  readonly resources: ReadonlyArray<DevtoolsRequestTraceResource>;
  readonly collections: ReadonlyArray<DevtoolsRequestTraceCollection>;
  readonly serverFunctions: ReadonlyArray<DevtoolsRequestTraceServerFunction>;
  readonly actions: ReadonlyArray<DevtoolsRequestTraceAction>;
  readonly fibers: ReadonlyArray<DevtoolsRequestTraceFiber>;
  readonly streams: ReadonlyArray<DevtoolsRequestTraceStream>;
  readonly status: DevtoolsRequestTraceStatus;
  readonly teardown?: DevtoolsRequestTraceTeardown;
}

export type DevtoolsRuntimeEvent =
  | {
      readonly _tag: "ResourceStoreEvent";
      readonly sequence?: number;
      readonly at?: number;
      readonly event: ResourceStoreEvent;
    }
  | {
      readonly _tag: "CollectionStoreEvent";
      readonly sequence?: number;
      readonly at?: number;
      readonly event: DevtoolsCollectionStoreEvent;
    }
  | {
      readonly _tag: "ActionState";
      readonly sequence?: number;
      readonly at?: number;
      readonly action: string;
      readonly state: string;
      readonly input?: unknown;
      readonly invalidationIndexes?: ReadonlyArray<number>;
    }
  | {
      readonly _tag: "Invalidation";
      readonly sequence?: number;
      readonly at?: number;
      readonly action?: string;
      readonly plan: DevtoolsInvalidationPlan;
    }
  | {
      readonly _tag: "RoutePlan";
      readonly sequence?: number;
      readonly at?: number;
      readonly plan: DevtoolsRoutePlan;
    }
  | {
      readonly _tag: "RequestTrace";
      readonly sequence?: number;
      readonly at?: number;
      readonly trace: DevtoolsRequestTrace;
    }
  | {
      readonly _tag: "Custom";
      readonly sequence?: number;
      readonly at?: number;
      readonly name: string;
      readonly payload?: unknown;
    };

export interface DevtoolsSnapshot {
  readonly appGraph?: DevtoolsStartAppGraphDiagnostics;
  readonly resources: ReadonlyArray<DevtoolsSnapshotResource>;
  readonly actions: ReadonlyArray<DevtoolsSnapshotAction>;
  readonly invalidations: ReadonlyArray<DevtoolsInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsRoutePlan>;
  readonly requestTraces?: ReadonlyArray<DevtoolsRequestTrace>;
  readonly events?: ReadonlyArray<DevtoolsRuntimeEvent>;
}

export interface DevtoolsStoreOptions {
  readonly invalidationLimit?: number;
  readonly routePlanLimit?: number;
  readonly requestTraceLimit?: number;
  readonly eventLimit?: number;
}

export interface DevtoolsStartAppGraphSchemaCoverage {
  readonly total: number;
  readonly input: number;
  readonly output: number;
  readonly error: number;
}

export interface DevtoolsStartAppGraphMissingSchema {
  readonly kind: "serverFunction" | "action";
  readonly name: string;
  readonly input: boolean;
  readonly output: boolean;
  readonly error: boolean;
}

export type DevtoolsStartAppGraphFeaturePresence = "present" | "absent" | "unknown";
export type DevtoolsStartAppGraphModuleKind = "server-only" | "contract" | "shared";
export type DevtoolsStartAppGraphActionBehaviorPresence = "present" | "absent" | "unknown";
export type DevtoolsStartAppGraphActionConcurrency = "latest" | "parallel" | "exhaust" | "unknown";
export type DevtoolsStartAppGraphRoutePreloadResourceStatus = "declared" | "none" | "unknown";
export type DevtoolsStartAppGraphRoutePreloadCollectionStatus = "declared" | "none" | "unknown";

export interface DevtoolsStartAppGraphRoutePreloadResources {
  readonly status: DevtoolsStartAppGraphRoutePreloadResourceStatus;
  readonly families: readonly string[];
}

export interface DevtoolsStartAppGraphRoutePreloadCollections {
  readonly status: DevtoolsStartAppGraphRoutePreloadCollectionStatus;
  readonly collections: readonly string[];
}

export interface DevtoolsStartAppGraphRouteModuleDiagnostics {
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly pathParamCount: number;
  readonly hasPathParams: boolean;
  readonly params: readonly {
    readonly name: string;
    readonly optional: boolean;
  }[];
  readonly paramsSchema: DevtoolsStartAppGraphFeaturePresence;
  readonly searchSchema: DevtoolsStartAppGraphFeaturePresence;
  readonly preload: DevtoolsStartAppGraphFeaturePresence;
  readonly preloadResources: DevtoolsStartAppGraphRoutePreloadResources;
  readonly preloadCollections: DevtoolsStartAppGraphRoutePreloadCollections;
  readonly component: DevtoolsStartAppGraphFeaturePresence;
}

export interface DevtoolsStartAppGraphWireDiagnostics {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
  readonly complete: boolean;
  readonly missing: readonly ("input" | "output" | "error")[];
}

export interface DevtoolsStartAppGraphServerFunctionDiagnostics {
  readonly id: string;
  readonly name: string;
  readonly server: {
    readonly module: string;
    readonly exportName: string;
    readonly moduleKind: DevtoolsStartAppGraphModuleKind;
    readonly hasHandler: boolean;
  };
  readonly client:
    | {
        readonly _tag: "Rpc";
        readonly rpcPath: string;
      }
    | {
        readonly _tag: "Import";
        readonly rpcPath: string;
        readonly module: string;
        readonly exportName: string;
        readonly moduleKind: Exclude<DevtoolsStartAppGraphModuleKind, "server-only">;
      };
  readonly wire: DevtoolsStartAppGraphWireDiagnostics;
}

export interface DevtoolsStartAppGraphActionBehavior {
  readonly invalidates: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly optimistic: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly retry: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly concurrency: DevtoolsStartAppGraphActionConcurrency;
}

export interface DevtoolsStartAppGraphActionDiagnostics {
  readonly id: string;
  readonly name: string;
  readonly server: {
    readonly module: string;
    readonly exportName: string;
    readonly moduleKind: DevtoolsStartAppGraphModuleKind;
  };
  readonly client:
    | {
        readonly _tag: "Post";
        readonly actionPath: string;
      }
    | {
        readonly _tag: "Import";
        readonly actionPath: string;
        readonly module: string;
        readonly exportName: string;
        readonly moduleKind: Exclude<DevtoolsStartAppGraphModuleKind, "server-only">;
      };
  readonly wire: DevtoolsStartAppGraphWireDiagnostics;
  readonly behavior: DevtoolsStartAppGraphActionBehavior;
}

export interface DevtoolsStartAppGraphResourceFamilyDiagnostics {
  readonly name: string;
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
  readonly providesTags: boolean;
  readonly policy: {
    readonly staleFor?: string | number;
    readonly gcFor?: string | number;
    readonly retry: boolean;
  };
}

export interface DevtoolsStartAppGraphResourceTagDiagnostics {
  readonly name: string;
  readonly keyed: boolean;
}

export interface DevtoolsStartAppGraphCollectionDiagnostics {
  readonly name: string;
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly initialData: boolean;
  readonly indexes?: readonly {
    readonly name: string;
    readonly unique: boolean;
  }[];
  readonly load: boolean;
  readonly handlers: {
    readonly insert: boolean;
    readonly update: boolean;
    readonly delete: boolean;
  };
  readonly policy: {
    readonly retry: boolean;
  };
  readonly sync?: {
    readonly adapter: string;
  };
  readonly persistence: {
    readonly enabled: boolean;
    readonly key?: string;
    readonly hydrate: boolean;
    readonly restoreOnPreload: boolean;
    readonly loadAfterRestore: boolean;
    readonly persistOnLoad: boolean;
    readonly persistOnMutation: boolean;
    readonly persistOnWrite: boolean;
  };
}

export interface DevtoolsStartAppGraphUnknownActionBehaviorEntry {
  readonly kind: "action";
  readonly name: string;
  readonly invalidates: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly optimistic: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly retry: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly concurrency: DevtoolsStartAppGraphActionConcurrency;
}

export interface DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: DevtoolsStartAppGraphFeaturePresence;
  readonly preloadResources: DevtoolsStartAppGraphRoutePreloadResources;
}

export interface DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: DevtoolsStartAppGraphFeaturePresence;
  readonly preloadCollections: DevtoolsStartAppGraphRoutePreloadCollections;
}

export interface DevtoolsStartAppGraphDiagnostics {
  readonly version: 1;
  readonly routeCount: number;
  readonly serverFunctionCount: number;
  readonly actionCount: number;
  readonly routePaths: readonly string[];
  readonly routeModules: readonly DevtoolsStartAppGraphRouteModuleDiagnostics[];
  readonly serverFunctionModules: readonly DevtoolsStartAppGraphServerFunctionDiagnostics[];
  readonly actionModules: readonly DevtoolsStartAppGraphActionDiagnostics[];
  readonly resourceFamilies: readonly DevtoolsStartAppGraphResourceFamilyDiagnostics[];
  readonly resourceTags: readonly DevtoolsStartAppGraphResourceTagDiagnostics[];
  readonly collectionDefinitions: readonly DevtoolsStartAppGraphCollectionDiagnostics[];
  readonly serverOnlyModules: readonly string[];
  readonly browserClientModules: readonly string[];
  readonly rpcPath: string;
  readonly actionPath: string;
  readonly schemaCoverage: {
    readonly serverFunctions: DevtoolsStartAppGraphSchemaCoverage;
    readonly actions: DevtoolsStartAppGraphSchemaCoverage;
  };
  readonly missingSchemas: readonly DevtoolsStartAppGraphMissingSchema[];
  readonly unknownActionBehavior: readonly DevtoolsStartAppGraphUnknownActionBehaviorEntry[];
  readonly unknownRoutePreloadResources: readonly DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry[];
  readonly unknownRoutePreloadCollections: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[];
}

export interface DevtoolsSummaryResourceRef {
  readonly key: string;
  readonly family: string;
  readonly input: DevtoolsSerializableValue;
}

export type DevtoolsSummaryInvalidationTarget =
  | DevtoolsSummaryResourceRef & {
      readonly _tag: "Ref";
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

export type DevtoolsSummaryInvalidationCause =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

export interface DevtoolsSummaryInvalidationPlan {
  readonly index: number;
  readonly targetCount: number;
  readonly matchedResourceCount: number;
  readonly causeCount: number;
  readonly targets: ReadonlyArray<DevtoolsSummaryInvalidationTarget>;
  readonly entries: ReadonlyArray<{
    readonly ref: DevtoolsSummaryResourceRef;
    readonly causes: ReadonlyArray<DevtoolsSummaryInvalidationCause>;
  }>;
}

export interface DevtoolsSummaryRoutePlan {
  readonly index: number;
  readonly _tag: "Matched" | "NotFound";
  readonly href: string;
  readonly path: string | null;
  readonly params: DevtoolsSerializableValue | null;
  readonly search: DevtoolsSerializableValue | null;
  readonly resourceCount: number;
  readonly hydrationResourceCount: number;
  readonly resources: ReadonlyArray<DevtoolsSummaryResourceRef>;
}

export interface DevtoolsSummaryResource {
  readonly key: string;
  readonly family: string | null;
  readonly input: DevtoolsSerializableValue | null;
  readonly state: string | null;
  readonly sources: ReadonlyArray<"Invalidation" | "RequestTrace" | "RoutePlan" | "Snapshot">;
  readonly routeHrefs: ReadonlyArray<string>;
  readonly invalidationIndexes: ReadonlyArray<number>;
}

export interface DevtoolsSummaryRequestTrace {
  readonly index: number;
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly transport: DevtoolsRequestTraceTransport;
  readonly status: DevtoolsRequestTraceStatus;
  readonly responseStatus: number | null;
  readonly serviceCount: number;
  readonly resourceCount: number;
  readonly collectionCount: number;
  readonly serverFunctionCount: number;
  readonly actionCount: number;
  readonly fiberCount: number;
  readonly streamCount: number;
  readonly runtimeDisposed: boolean | null;
  readonly teardownReason: string | null;
  readonly durationMillis: number | null;
  readonly beforeDisposeFiberCount: number | null;
  readonly afterDisposeFiberCount: number | null;
  readonly routeHref: string | null;
}

export interface DevtoolsSummaryRuntimeEvent {
  readonly index: number;
  readonly id: string;
  readonly _tag: DevtoolsRuntimeEvent["_tag"];
  readonly sequence: number;
  readonly at: number | null;
  readonly label: string;
  readonly target:
    | {
        readonly kind: "Resource";
        readonly id: string;
      }
    | {
        readonly kind: "Collection";
        readonly id: string;
      }
    | {
        readonly kind: "Action";
        readonly id: string;
      }
    | {
        readonly kind: "InvalidationPlan";
        readonly id: string;
      }
    | {
        readonly kind: "RoutePlan";
        readonly id: string;
      }
    | {
        readonly kind: "RequestTrace";
        readonly id: string;
      }
    | null;
  readonly data: DevtoolsSerializableValue;
}

export type DevtoolsCausalNodeKind =
  | "RequestTrace"
  | "Route"
  | "RoutePlan"
  | "Resource"
  | "ResourceFamily"
  | "Collection"
  | "Action"
  | "InvalidationPlan"
  | "InvalidationTarget"
  | "ResourceTag"
  | "SchemaCoverage"
  | "MissingSchema"
  | "RuntimeEvent"
  | "Endpoint"
  | "Module"
  | "ServerFunction";

export type DevtoolsCausalEdgeKind =
  | "Matches"
  | "Preloads"
  | "Hydrates"
  | "Targets"
  | "Invalidates"
  | "Causes"
  | "Emits"
  | "Observes"
  | "Covers"
  | "MissingSchema"
  | "UsesEndpoint"
  | "UsesModule"
  | "Records";

export interface DevtoolsCausalNode {
  readonly id: string;
  readonly kind: DevtoolsCausalNodeKind;
  readonly label: string;
  readonly data: DevtoolsSerializableValue;
}

export interface DevtoolsCausalEdge {
  readonly id: string;
  readonly kind: DevtoolsCausalEdgeKind;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly data: DevtoolsSerializableValue;
}

export interface DevtoolsCausalGraph {
  readonly version: 1;
  readonly nodes: ReadonlyArray<DevtoolsCausalNode>;
  readonly edges: ReadonlyArray<DevtoolsCausalEdge>;
}

export interface DevtoolsSummary {
  readonly version: 1;
  readonly overview: {
    readonly routeCount: number;
    readonly serverFunctionCount: number;
    readonly actionCount: number;
    readonly resourceFamilyCount: number;
    readonly resourceTagCount: number;
    readonly collectionDefinitionCount: number;
    readonly runtimeResourceCount: number;
    readonly runtimeActionCount: number;
    readonly invalidationPlanCount: number;
    readonly routePlanCount: number;
    readonly requestTraceCount: number;
    readonly runtimeEventCount: number;
    readonly missingSchemaCount: number;
    readonly unknownActionBehaviorCount: number;
    readonly unknownRoutePreloadResourcesCount: number;
    readonly unknownRoutePreloadCollectionsCount: number;
    readonly notFoundRoutePlanCount: number;
    readonly causalNodeCount: number;
    readonly causalEdgeCount: number;
  };
  readonly graph:
    | {
        readonly _tag: "Available";
        readonly routes: {
          readonly count: number;
          readonly paths: readonly string[];
          readonly modules: readonly DevtoolsStartAppGraphRouteModuleDiagnostics[];
          readonly unknownPreloadResources: readonly DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry[];
          readonly unknownPreloadCollections: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[];
        };
        readonly serverFunctions: {
          readonly count: number;
          readonly schemaCoverage: DevtoolsStartAppGraphSchemaCoverage;
          readonly modules: readonly DevtoolsStartAppGraphServerFunctionDiagnostics[];
        };
        readonly actions: {
          readonly count: number;
          readonly schemaCoverage: DevtoolsStartAppGraphSchemaCoverage;
          readonly modules: readonly DevtoolsStartAppGraphActionDiagnostics[];
          readonly behavior: {
            readonly invalidates: readonly {
              readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
              readonly count: number;
            }[];
            readonly optimistic: readonly {
              readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
              readonly count: number;
            }[];
            readonly retry: readonly {
              readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
              readonly count: number;
            }[];
            readonly concurrency: readonly {
              readonly state: DevtoolsStartAppGraphActionConcurrency;
              readonly count: number;
            }[];
          };
          readonly unknownBehavior: readonly DevtoolsStartAppGraphUnknownActionBehaviorEntry[];
        };
        readonly resources: {
          readonly familyCount: number;
          readonly tagCount: number;
          readonly families: readonly DevtoolsStartAppGraphResourceFamilyDiagnostics[];
          readonly tags: readonly DevtoolsStartAppGraphResourceTagDiagnostics[];
        };
        readonly collections: {
          readonly definitionCount: number;
          readonly definitions: readonly DevtoolsStartAppGraphCollectionDiagnostics[];
        };
        readonly endpoints: {
          readonly rpc: string;
          readonly action: string;
        };
        readonly modules: {
          readonly serverOnly: readonly string[];
          readonly browserClient: readonly string[];
        };
        readonly missingSchemas: readonly DevtoolsStartAppGraphMissingSchema[];
      }
    | {
        readonly _tag: "Unavailable";
      };
  readonly runtime: {
    readonly resources: ReadonlyArray<{
      readonly key: string;
      readonly state: string;
    }>;
    readonly actions: ReadonlyArray<{
      readonly name: string;
      readonly state: string;
      readonly invalidationIndexes: ReadonlyArray<number>;
    }>;
    readonly events: ReadonlyArray<DevtoolsSummaryRuntimeEvent>;
    readonly resourceStates: ReadonlyArray<{
      readonly state: string;
      readonly count: number;
    }>;
    readonly actionStates: ReadonlyArray<{
      readonly state: string;
      readonly count: number;
    }>;
  };
  readonly invalidations: {
    readonly plans: ReadonlyArray<DevtoolsSummaryInvalidationPlan>;
  };
  readonly routes: {
    readonly plans: ReadonlyArray<DevtoolsSummaryRoutePlan>;
    readonly notFoundHrefs: readonly string[];
  };
  readonly requests: {
    readonly traces: ReadonlyArray<DevtoolsSummaryRequestTrace>;
  };
  readonly resources: ReadonlyArray<DevtoolsSummaryResource>;
  readonly causalGraph: DevtoolsCausalGraph;
}

export interface DevtoolsSummaryInput {
  readonly snapshot?: DevtoolsSnapshot;
  readonly appGraph?: DevtoolsStartAppGraphDiagnostics;
  readonly invalidations?: ReadonlyArray<DevtoolsInvalidationPlan>;
  readonly routePlans?: ReadonlyArray<DevtoolsRoutePlan>;
  readonly requestTraces?: ReadonlyArray<DevtoolsRequestTrace>;
  readonly runtimeEvents?: ReadonlyArray<DevtoolsRuntimeEvent>;
}

export type DevtoolsPanelId =
  | "app-graph"
  | "routes"
  | "resources"
  | "actions"
  | "collections"
  | "requests"
  | "diagnostics"
  | "causal-graph";

export type DevtoolsPanelSeverity = "ok" | "info" | "warning" | "error";

export interface DevtoolsPanelMetric {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
}

export interface DevtoolsPanelItem {
  readonly id: string;
  readonly label: string;
  readonly severity: DevtoolsPanelSeverity;
  readonly detail?: string;
  readonly metrics?: ReadonlyArray<DevtoolsPanelMetric>;
  readonly data?: DevtoolsSerializableValue;
}

export interface DevtoolsPanel {
  readonly id: DevtoolsPanelId;
  readonly title: string;
  readonly summary: string;
  readonly severity: DevtoolsPanelSeverity;
  readonly metrics: ReadonlyArray<DevtoolsPanelMetric>;
  readonly items: ReadonlyArray<DevtoolsPanelItem>;
}

export interface DevtoolsPanels {
  readonly version: 1;
  readonly panels: ReadonlyArray<DevtoolsPanel>;
}

export const effectUiDevtoolsBridgeGlobal = "__EFFECT_UI_DEVTOOLS__" as const;

export interface DevtoolsBridgePayload {
  readonly panels: DevtoolsPanels;
  readonly selectedPanelId?: DevtoolsPanelId;
  readonly title?: string;
}

export type DevtoolsBridgeProvider =
  | DevtoolsBridgePayload
  | (() => DevtoolsBridgePayload);

export interface DevtoolsBridgeTarget {
  [effectUiDevtoolsBridgeGlobal]?: DevtoolsBridgeProvider | undefined;
}

export interface DevtoolsBridgeInstall {
  readonly target: DevtoolsBridgeTarget;
  readonly uninstall: () => void;
}

export interface DevtoolsPanelsInput extends DevtoolsSummaryInput {
  readonly summary?: DevtoolsSummary;
}

export interface DevtoolsPanelUiOptions {
  readonly title?: string;
  readonly selectedPanelId?: DevtoolsPanelId;
  readonly maxItemsPerPanel?: number;
  readonly includeStyles?: boolean;
}

export interface DevtoolsPanelUiInput extends DevtoolsPanelsInput, DevtoolsPanelUiOptions {
  readonly panels?: DevtoolsPanels;
}

export interface DevtoolsPanelMountOptions extends DevtoolsPanelUiInput {
  readonly root: HTMLElement;
}

export interface DevtoolsPanelMount {
  readonly root: HTMLElement;
  readonly update: (input?: DevtoolsPanelUiInput) => void;
  readonly unmount: () => void;
}

const describeResourceRef = (ref: { readonly key: string; readonly family: { readonly options: { readonly name: string } }; readonly input: unknown }) => ({
  key: ref.key,
  family: ref.family.options.name,
  input: ref.input
});

const describeTarget = (target: ResourceInvalidation): DevtoolsInvalidationTarget => {
  if (isResourceRef(target)) {
    return {
      _tag: "Ref",
      ...describeResourceRef(target)
    };
  }

  if (isResourceTag(target)) {
    return {
      _tag: "Tag",
      key: target.key,
      name: target.name
    };
  }

  throw new DevtoolsUnknownInvalidationTarget({
    target,
    guidance: "Record invalidation targets as Resource refs or Resource tags."
  });
};

const describeCause = (cause: ResourceInvalidationCause): DevtoolsInvalidationCause => {
  switch (cause._tag) {
    case "Ref":
      return {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name
      };
    case "Tag":
      return {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name
      };
  }
};

const objectTag = (tag: string, value?: string): { readonly [key: string]: DevtoolsSerializableValue } =>
  value === undefined
    ? { _tag: tag }
    : {
        _tag: tag,
        value
      };

export const toDevtoolsSerializableValue = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): DevtoolsSerializableValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : objectTag("NonFiniteNumber", String(value));
  }

  if (typeof value === "bigint") {
    return objectTag("BigInt", value.toString());
  }

  if (typeof value === "undefined") {
    return objectTag("Undefined");
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return {
      _tag: "NonSerializable",
      kind: typeof value,
      value: String(value)
    };
  }

  if (value instanceof Date) {
    return {
      _tag: "Date",
      value: Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()
    };
  }

  if (seen.has(value)) {
    return objectTag("Circular");
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const serialized = value.map((item) => toDevtoolsSerializableValue(item, seen));
    seen.delete(value);
    return serialized;
  }

  const record = value as Record<string, unknown>;
  const serialized = Object.keys(record)
    .sort()
    .reduce<Record<string, DevtoolsSerializableValue>>((acc, key) => {
      acc[key] = toDevtoolsSerializableValue(record[key], seen);
      return acc;
    }, {});
  seen.delete(value);
  return serialized;
};

export const describeInvalidationPlan = (
  plan: ResourceInvalidationPlan
): DevtoolsInvalidationPlan => ({
  targets: plan.targets.map(describeTarget),
  entries: plan.entries.map((entry) => ({
    ref: {
      ...describeResourceRef(entry.ref)
    },
    causes: entry.causes.map(describeCause)
  }))
});

const copyInvalidationTarget = (
  target: DevtoolsInvalidationTarget
): DevtoolsInvalidationTarget => ({ ...target });

const copyInvalidationCause = (
  cause: DevtoolsInvalidationCause
): DevtoolsInvalidationCause => ({ ...cause });

const copyInvalidationPlan = (
  plan: DevtoolsInvalidationPlan
): DevtoolsInvalidationPlan => ({
  targets: plan.targets.map(copyInvalidationTarget),
  entries: plan.entries.map((entry) => ({
    ref: { ...entry.ref },
    causes: entry.causes.map(copyInvalidationCause)
  }))
});

const copyTraceHeaders = (
  headers: ReadonlyArray<DevtoolsRequestTraceHeader> | undefined
): ReadonlyArray<DevtoolsRequestTraceHeader> | undefined =>
  headers === undefined
    ? undefined
    : headers.map((header) => ({ ...header })).sort((left, right) => left.name.localeCompare(right.name));

const copyTraceCookies = (
  cookies: ReadonlyArray<DevtoolsRequestTraceCookie> | undefined
): ReadonlyArray<DevtoolsRequestTraceCookie> | undefined =>
  cookies === undefined
    ? undefined
    : cookies.map((cookie) => ({ ...cookie })).sort((left, right) => left.name.localeCompare(right.name));

const copyRoutePlan = (
  plan: DevtoolsRoutePlan
): DevtoolsRoutePlan => ({
  _tag: plan._tag,
  href: plan.href,
  match: plan.match === undefined
    ? undefined
    : {
        path: plan.match.path,
        href: plan.match.href,
        params: plan.match.params,
        search: plan.match.search
      },
  resources: plan.resources.map((resource) => ({ ...resource })),
  hydration: { ...plan.hydration }
});

const copyRequestTraceTeardown = (
  teardown: DevtoolsRequestTraceTeardown
): DevtoolsRequestTraceTeardown => ({
  runtimeDisposed: teardown.runtimeDisposed,
  ...(teardown.reason === undefined ? {} : { reason: teardown.reason }),
  ...(teardown.at === undefined ? {} : { at: teardown.at }),
  ...(teardown.startedAt === undefined ? {} : { startedAt: teardown.startedAt }),
  ...(teardown.completedAt === undefined ? {} : { completedAt: teardown.completedAt }),
  ...(teardown.durationMillis === undefined ? {} : { durationMillis: teardown.durationMillis }),
  ...(teardown.beforeDispose === undefined ? {} : { beforeDispose: { ...teardown.beforeDispose } }),
  ...(teardown.afterDispose === undefined ? {} : { afterDispose: { ...teardown.afterDispose } })
});

const copyRequestTrace = (
  trace: DevtoolsRequestTrace
): DevtoolsRequestTrace => {
  const request: DevtoolsRequestTraceRequest = {
    method: trace.request.method,
    url: trace.request.url,
    path: trace.request.path,
    transport: trace.request.transport,
    ...(trace.request.id === undefined ? {} : { id: trace.request.id }),
    ...(trace.request.traceparent === undefined ? {} : { traceparent: trace.request.traceparent }),
    ...(trace.request.headers === undefined ? {} : { headers: copyTraceHeaders(trace.request.headers)! }),
    ...(trace.request.cookies === undefined ? {} : { cookies: copyTraceCookies(trace.request.cookies)! })
  };
  const response: DevtoolsRequestTraceResponse | undefined = trace.response === undefined
    ? undefined
    : {
        status: trace.response.status,
        ...(trace.response.statusText === undefined ? {} : { statusText: trace.response.statusText }),
        ...(trace.response.headers === undefined ? {} : { headers: copyTraceHeaders(trace.response.headers)! }),
        ...(trace.response.setCookieCount === undefined ? {} : { setCookieCount: trace.response.setCookieCount })
      };

  return {
    request,
    ...(response === undefined ? {} : { response }),
    services: [...trace.services].sort(),
    ...(trace.routePlan === undefined ? {} : { routePlan: copyRoutePlan(trace.routePlan) }),
    resources: trace.resources.map((resource) => ({ ...resource })),
    collections: trace.collections.map((collection) => ({ ...collection })),
    serverFunctions: trace.serverFunctions.map((serverFunction) => ({ ...serverFunction })),
    actions: trace.actions.map((action) => ({
      ...action,
      ...(action.invalidationIndexes === undefined ? {} : { invalidationIndexes: [...action.invalidationIndexes] })
    })),
    fibers: trace.fibers.map((fiber) => ({ ...fiber })),
    streams: trace.streams.map((stream) => ({ ...stream })),
    status: trace.status,
    ...(trace.teardown === undefined ? {} : { teardown: copyRequestTraceTeardown(trace.teardown) })
  };
};

export const describeRoutePlan = (
  plan: Route.NavigationPlan
): DevtoolsRoutePlan => ({
  _tag: plan._tag,
  href: plan.href,
  match: plan.match
    ? {
        path: plan.match.route.path,
        href: plan.match.href,
        params: plan.match.params,
        search: plan.match.search
      }
    : undefined,
  resources: plan.refs.map(describeResourceRef),
  hydration: {
    resourceCount: plan.resources.resources.length
  }
});

const emptySnapshot = (): DevtoolsSnapshot => ({
  resources: [],
  actions: [],
  invalidations: [],
  routePlans: []
});

const stateCounts = (
  entries: Iterable<{ readonly state: string }>
): ReadonlyArray<{ readonly state: string; readonly count: number }> => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => ({ state, count }));
};

const valueCounts = <Value extends string>(
  values: Iterable<Value>
): ReadonlyArray<{ readonly state: Value; readonly count: number }> => {
  const counts = new Map<Value, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => ({ state, count }));
};

const actionBehaviorSummary = (
  actions: readonly DevtoolsStartAppGraphActionDiagnostics[]
): {
  readonly invalidates: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly optimistic: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly retry: readonly {
    readonly state: DevtoolsStartAppGraphActionBehaviorPresence;
    readonly count: number;
  }[];
  readonly concurrency: readonly {
    readonly state: DevtoolsStartAppGraphActionConcurrency;
    readonly count: number;
  }[];
} => ({
    invalidates: valueCounts(actions.map((action) => action.behavior.invalidates)),
    optimistic: valueCounts(actions.map((action) => action.behavior.optimistic)),
    retry: valueCounts(actions.map((action) => action.behavior.retry)),
    concurrency: valueCounts(actions.map((action) => action.behavior.concurrency))
  });

const appGraphCollectionDefinitions = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphCollectionDiagnostics[] =>
  (appGraph as { readonly collectionDefinitions?: readonly DevtoolsStartAppGraphCollectionDiagnostics[] })
    .collectionDefinitions ?? [];

const appGraphUnknownRoutePreloadCollections = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] =>
  (appGraph as { readonly unknownRoutePreloadCollections?: readonly DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry[] })
    .unknownRoutePreloadCollections ?? [];

const routeModulePreloadCollections = (
  routeModule: DevtoolsStartAppGraphRouteModuleDiagnostics
): DevtoolsStartAppGraphRoutePreloadCollections =>
  (routeModule as { readonly preloadCollections?: DevtoolsStartAppGraphRoutePreloadCollections })
    .preloadCollections ?? {
      status: "unknown",
      collections: []
    };

const graphSummary = (
  appGraph: DevtoolsStartAppGraphDiagnostics | undefined
): DevtoolsSummary["graph"] => {
  if (!appGraph) {
    return {
      _tag: "Unavailable"
    };
  }

  const collections = appGraphCollectionDefinitions(appGraph);

  return {
    _tag: "Available",
    routes: {
      count: appGraph.routeCount,
      paths: [...appGraph.routePaths],
      modules: appGraph.routeModules.map((routeModule) => ({ ...routeModule })),
      unknownPreloadResources: appGraph.unknownRoutePreloadResources.map((entry) => ({ ...entry })),
      unknownPreloadCollections: appGraphUnknownRoutePreloadCollections(appGraph).map((entry) => ({ ...entry }))
    },
    serverFunctions: {
      count: appGraph.serverFunctionCount,
      schemaCoverage: { ...appGraph.schemaCoverage.serverFunctions },
      modules: appGraph.serverFunctionModules.map((serverFunction) => ({ ...serverFunction }))
    },
    actions: {
      count: appGraph.actionCount,
      schemaCoverage: { ...appGraph.schemaCoverage.actions },
      modules: appGraph.actionModules.map((action) => ({ ...action })),
      behavior: actionBehaviorSummary(appGraph.actionModules),
      unknownBehavior: appGraph.unknownActionBehavior.map((entry) => ({ ...entry }))
    },
    resources: {
      familyCount: appGraph.resourceFamilies.length,
      tagCount: appGraph.resourceTags.length,
      families: appGraph.resourceFamilies.map((family) => ({ ...family, policy: { ...family.policy } })),
      tags: appGraph.resourceTags.map((tag) => ({ ...tag }))
    },
    collections: {
      definitionCount: collections.length,
      definitions: collections.map((collection) => ({
        ...collection,
        indexes: [...(collection.indexes ?? [])],
        handlers: { ...collection.handlers },
        policy: { ...collection.policy },
        ...(collection.sync === undefined ? {} : { sync: { ...collection.sync } }),
        persistence: { ...collection.persistence }
      }))
    },
    endpoints: {
      rpc: appGraph.rpcPath,
      action: appGraph.actionPath
    },
    modules: {
      serverOnly: [...appGraph.serverOnlyModules],
      browserClient: [...appGraph.browserClientModules]
    },
    missingSchemas: appGraph.missingSchemas.map((missingSchema) => ({ ...missingSchema }))
  };
};

const summarizeResourceRef = (ref: {
  readonly key: string;
  readonly family: string;
  readonly input: unknown;
}): DevtoolsSummaryResourceRef => ({
  key: ref.key,
  family: ref.family,
  input: toDevtoolsSerializableValue(ref.input)
});

const summarizeTarget = (
  target: DevtoolsInvalidationTarget
): DevtoolsSummaryInvalidationTarget =>
  target._tag === "Ref"
    ? {
        _tag: "Ref",
        ...summarizeResourceRef(target)
      }
    : { ...target };

const summarizeInvalidationPlan = (
  plan: DevtoolsInvalidationPlan,
  index: number
): DevtoolsSummaryInvalidationPlan => ({
  index,
  targetCount: plan.targets.length,
  matchedResourceCount: plan.entries.length,
  causeCount: plan.entries.reduce((sum, entry) => sum + entry.causes.length, 0),
  targets: plan.targets.map(summarizeTarget),
  entries: plan.entries.map((entry) => ({
    ref: summarizeResourceRef(entry.ref),
    causes: entry.causes.map((cause) => ({ ...cause }))
  }))
});

const summarizeRoutePlan = (
  plan: DevtoolsRoutePlan,
  index: number
): DevtoolsSummaryRoutePlan => ({
  index,
  _tag: plan._tag,
  href: plan.href,
  path: plan.match?.path ?? null,
  params: plan.match ? toDevtoolsSerializableValue(plan.match.params) : null,
  search: plan.match ? toDevtoolsSerializableValue(plan.match.search) : null,
  resourceCount: plan.resources.length,
  hydrationResourceCount: plan.hydration.resourceCount,
  resources: plan.resources.map(summarizeResourceRef)
});

const summarizeRequestTrace = (
  trace: DevtoolsRequestTrace,
  index: number
): DevtoolsSummaryRequestTrace => ({
  index,
  id: trace.request.id ?? `${trace.request.method}:${trace.request.path}:${index}`,
  method: trace.request.method,
  path: trace.request.path,
  url: trace.request.url,
  transport: trace.request.transport,
  status: trace.status,
  responseStatus: trace.response?.status ?? null,
  serviceCount: trace.services.length,
  resourceCount: trace.resources.length,
  collectionCount: trace.collections.length,
  serverFunctionCount: trace.serverFunctions.length,
  actionCount: trace.actions.length,
  fiberCount: trace.fibers.length,
  streamCount: trace.streams.length,
  runtimeDisposed: trace.teardown?.runtimeDisposed ?? null,
  teardownReason: trace.teardown?.reason ?? null,
  durationMillis: trace.teardown?.durationMillis ?? null,
  beforeDisposeFiberCount: trace.teardown?.beforeDispose?.fiberCount ?? null,
  afterDisposeFiberCount: trace.teardown?.afterDispose?.fiberCount ?? null,
  routeHref: trace.routePlan?.href ?? null
});

const actionNodeId = (name: string): string => `action:${name}`;

const collectionNodeId = (collection: string): string => `collection:${collection}`;

const endpointNodeId = (name: string): string => `endpoint:${name}`;

const invalidationNodeId = (index: number): string => `invalidation:${index}`;

const missingSchemaNodeId = (schema: DevtoolsStartAppGraphMissingSchema): string =>
  `missing-schema:${schema.kind}:${schema.name}:${schema.input ? "input" : "no-input"}:${schema.output ? "output" : "no-output"}:${schema.error ? "error" : "no-error"}`;

const moduleNodeId = (kind: "server-only" | "browser-client" | "route" | DevtoolsStartAppGraphModuleKind, path: string): string =>
  `module:${kind}:${path}`;

const resourceFamilyNodeId = (name: string): string => `resource-family:${name}`;

const resourceNodeId = (key: string): string => `resource:${key}`;

const requestTraceNodeId = (trace: DevtoolsSummaryRequestTrace): string =>
  `request-trace:${trace.id}`;

const routeNodeId = (path: string): string => `route:${path}`;

const routePlanNodeId = (index: number, href: string): string => `route-plan:${index}:${href}`;

const schemaCoverageNodeId = (kind: "serverFunctions" | "actions"): string =>
  `schema-coverage:${kind}`;

const serverFunctionNodeId = (name: string): string => `server-function:${name}`;

const tagNodeId = (key: string): string => `resource-tag:${key}`;

const targetNodeId = (target: DevtoolsSummaryInvalidationTarget | DevtoolsSummaryInvalidationCause): string =>
  target._tag === "Tag" ? tagNodeId(target.key) : resourceNodeId(target.key);

const runtimeEventNodeId = (event: DevtoolsSummaryRuntimeEvent): string =>
  `runtime-event:${event.sequence}:${event._tag}`;

const resourceEventTarget = (event: ResourceStoreEvent): { readonly id: string; readonly label: string } => ({
  id: resourceNodeId(event.key),
  label: event.name
});

const collectionEventTarget = (event: DevtoolsCollectionStoreEvent): { readonly id: string; readonly label: string } => ({
  id: collectionNodeId(event.collection),
  label: event.collection
});

const runtimeTargetLabel = (target: NonNullable<DevtoolsSummaryRuntimeEvent["target"]>): string =>
  target.kind === "Collection" && target.id.startsWith("collection:")
    ? target.id.slice("collection:".length)
    : target.kind === "RequestTrace" && target.id.startsWith("request-trace:")
      ? target.id.slice("request-trace:".length)
    : target.id;

const summarizeRuntimeEvent = (
  event: DevtoolsRuntimeEvent,
  index: number
): DevtoolsSummaryRuntimeEvent => {
  const sequence = event.sequence ?? index;
  const at = event.at ?? null;

  switch (event._tag) {
    case "ResourceStoreEvent": {
      const target = resourceEventTarget(event.event);
      return {
        index,
        id: `runtime-event:${sequence}:ResourceStoreEvent`,
        _tag: event._tag,
        sequence,
        at,
        label: event.event._tag,
        target: {
          kind: "Resource",
          id: target.id
        },
        data: toDevtoolsSerializableValue(event.event)
      };
    }
    case "CollectionStoreEvent": {
      const target = collectionEventTarget(event.event);
      return {
        index,
        id: `runtime-event:${sequence}:CollectionStoreEvent`,
        _tag: event._tag,
        sequence,
        at,
        label: event.event._tag,
        target: {
          kind: "Collection",
          id: target.id
        },
        data: toDevtoolsSerializableValue(event.event)
      };
    }
    case "ActionState":
      return {
        index,
        id: `runtime-event:${sequence}:ActionState`,
        _tag: event._tag,
        sequence,
        at,
        label: `${event.action} ${event.state}`,
        target: {
          kind: "Action",
          id: actionNodeId(event.action)
        },
        data: toDevtoolsSerializableValue({
          action: event.action,
          state: event.state,
          input: event.input,
          invalidationIndexes: event.invalidationIndexes ?? []
        })
      };
    case "Invalidation":
      return {
        index,
        id: `runtime-event:${sequence}:Invalidation`,
        _tag: event._tag,
        sequence,
        at,
        label: event.action === undefined ? "Invalidation" : `${event.action} invalidation`,
        target: {
          kind: "InvalidationPlan",
          id: invalidationNodeId(index)
        },
        data: toDevtoolsSerializableValue({
          action: event.action ?? null,
          plan: event.plan
        })
      };
    case "RoutePlan":
      return {
        index,
        id: `runtime-event:${sequence}:RoutePlan`,
        _tag: event._tag,
        sequence,
        at,
        label: event.plan.href,
        target: {
          kind: "RoutePlan",
          id: routePlanNodeId(index, event.plan.href)
        },
        data: toDevtoolsSerializableValue(event.plan)
      };
    case "RequestTrace": {
      const trace = summarizeRequestTrace(event.trace, index);
      return {
        index,
        id: `runtime-event:${sequence}:RequestTrace`,
        _tag: event._tag,
        sequence,
        at,
        label: `${trace.method} ${trace.path}`,
        target: {
          kind: "RequestTrace",
          id: requestTraceNodeId(trace)
        },
        data: toDevtoolsSerializableValue(event.trace)
      };
    }
    case "Custom":
      return {
        index,
        id: `runtime-event:${sequence}:Custom`,
        _tag: event._tag,
        sequence,
        at,
        label: event.name,
        target: null,
        data: toDevtoolsSerializableValue({
          name: event.name,
          payload: event.payload
        })
      };
  }
};

const sortedStrings = (values: Iterable<string>): readonly string[] =>
  Array.from(new Set(values)).sort();

const resourceIndex = (
  snapshot: DevtoolsSnapshot,
  invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>,
  routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>,
  requestTraces: ReadonlyArray<DevtoolsRequestTrace>
): ReadonlyArray<DevtoolsSummaryResource> => {
  const resources = new Map<string, {
    key: string;
    family: string | null;
    input: DevtoolsSerializableValue | null;
    state: string | null;
    sources: Set<"Invalidation" | "RequestTrace" | "RoutePlan" | "Snapshot">;
    routeHrefs: Set<string>;
    invalidationIndexes: Set<number>;
  }>();

  const entryFor = (key: string) => {
    const existing = resources.get(key);
    if (existing) {
      return existing;
    }
    const next = {
      key,
      family: null,
      input: null,
      state: null,
      sources: new Set<"Invalidation" | "RequestTrace" | "RoutePlan" | "Snapshot">(),
      routeHrefs: new Set<string>(),
      invalidationIndexes: new Set<number>()
    };
    resources.set(key, next);
    return next;
  };

  for (const resource of snapshot.resources) {
    const entry = entryFor(resource.key);
    entry.state = resource.state;
    entry.sources.add("Snapshot");
  }

  for (const plan of routePlans) {
    for (const resource of plan.resources) {
      const entry = entryFor(resource.key);
      entry.family = resource.family;
      entry.input = resource.input;
      entry.sources.add("RoutePlan");
      entry.routeHrefs.add(plan.href);
    }
  }

  for (const plan of invalidations) {
    for (const entryPlan of plan.entries) {
      const entry = entryFor(entryPlan.ref.key);
      entry.family = entryPlan.ref.family;
      entry.input = entryPlan.ref.input;
      entry.sources.add("Invalidation");
      entry.invalidationIndexes.add(plan.index);
    }
  }

  for (const trace of requestTraces) {
    for (const resource of trace.resources) {
      const entry = entryFor(resource.key);
      entry.family = resource.family;
      if (resource.input !== undefined) {
        entry.input = toDevtoolsSerializableValue(resource.input);
      }
      if (resource.state !== undefined) {
        entry.state = resource.state;
      }
      entry.sources.add("RequestTrace");
      if (trace.routePlan) {
        entry.routeHrefs.add(trace.routePlan.href);
      }
    }
  }

  return Array.from(resources.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((resource) => ({
      key: resource.key,
      family: resource.family,
      input: resource.input,
      state: resource.state,
      sources: Array.from(resource.sources).sort(),
      routeHrefs: sortedStrings(resource.routeHrefs),
      invalidationIndexes: Array.from(resource.invalidationIndexes).sort((left, right) => left - right)
    }));
};

const summarizeRuntimeEvents = (
  events: ReadonlyArray<DevtoolsRuntimeEvent>
): ReadonlyArray<DevtoolsSummaryRuntimeEvent> =>
  events.map(summarizeRuntimeEvent).sort((left, right) => {
    const bySequence = left.sequence - right.sequence;
    return bySequence === 0 ? left.id.localeCompare(right.id) : bySequence;
  });

const schemaCoverageData = (
  coverage: DevtoolsStartAppGraphSchemaCoverage
): DevtoolsSerializableValue => ({
  error: coverage.error,
  input: coverage.input,
  output: coverage.output,
  total: coverage.total
});

const addNode = (
  nodes: Map<string, DevtoolsCausalNode>,
  node: DevtoolsCausalNode
): void => {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
};

const addEdge = (
  edges: Array<DevtoolsCausalEdge>,
  edge: Omit<DevtoolsCausalEdge, "id">,
  index: number
): void => {
  edges.push({
    id: `edge:${index}:${edge.kind}:${edge.source}->${edge.target}`,
    ...edge
  });
};

interface DevtoolsCausalGraphInput {
  readonly appGraph: DevtoolsStartAppGraphDiagnostics | undefined;
  readonly snapshot: DevtoolsSnapshot;
  readonly invalidations: ReadonlyArray<DevtoolsSummaryInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsSummaryRoutePlan>;
  readonly requestTraces: ReadonlyArray<DevtoolsRequestTrace>;
  readonly requestTraceSummaries: ReadonlyArray<DevtoolsSummaryRequestTrace>;
  readonly resources: ReadonlyArray<DevtoolsSummaryResource>;
  readonly runtimeEvents: ReadonlyArray<DevtoolsSummaryRuntimeEvent>;
}

const makeDevtoolsCausalGraph = (
  input: DevtoolsCausalGraphInput
): DevtoolsCausalGraph => {
  const nodes = new Map<string, DevtoolsCausalNode>();
  const edges: Array<DevtoolsCausalEdge> = [];
  let edgeIndex = 0;

  const connect = (edge: Omit<DevtoolsCausalEdge, "id">): void => {
    addEdge(edges, edge, edgeIndex);
    edgeIndex += 1;
  };
  const addModuleNode = (
    kind: "server-only" | "browser-client" | "route" | DevtoolsStartAppGraphModuleKind,
    path: string,
    data: DevtoolsSerializableValue = null
  ): string => {
    const id = moduleNodeId(kind, path);
    addNode(nodes, {
      id,
      kind: "Module",
      label: path,
      data: {
        boundary: kind,
        path,
        ...(typeof data === "object" && data !== null && !Array.isArray(data) ? data : {})
      }
    });
    return id;
  };

  if (input.appGraph) {
    const collectionDefinitionsByName = new Map(
      appGraphCollectionDefinitions(input.appGraph).map((collection) => [collection.name, collection] as const)
    );

    addNode(nodes, {
      id: endpointNodeId("rpc"),
      kind: "Endpoint",
      label: input.appGraph.rpcPath,
      data: {
        path: input.appGraph.rpcPath,
        transport: "rpc"
      }
    });
    addNode(nodes, {
      id: endpointNodeId("action"),
      kind: "Endpoint",
      label: input.appGraph.actionPath,
      data: {
        path: input.appGraph.actionPath,
        transport: "action"
      }
    });

    for (const routeModule of input.appGraph.routeModules) {
      const routeId = routeNodeId(routeModule.routePath);
      addNode(nodes, {
        id: routeId,
        kind: "Route",
        label: routeModule.routePath,
        data: toDevtoolsSerializableValue(routeModule)
      });
      const moduleId = addModuleNode("route", routeModule.filePath, {
        moduleId: routeModule.moduleId,
        routeId: routeModule.routeId
      });
      connect({
        kind: "UsesModule",
        source: routeId,
        target: moduleId,
        label: "declared in",
        data: {
          routeId: routeModule.routeId
        }
      });
      for (const family of routeModule.preloadResources.families) {
        const familyId = resourceFamilyNodeId(family);
        addNode(nodes, {
          id: familyId,
          kind: "ResourceFamily",
          label: family,
          data: {
            name: family,
            source: "RoutePreloadResources",
            status: routeModule.preloadResources.status
          }
        });
        connect({
          kind: "Preloads",
          source: routeId,
          target: familyId,
          label: "declares preload",
          data: {
            routeId: routeModule.routeId,
            status: routeModule.preloadResources.status
          }
        });
      }
      const preloadCollections = routeModulePreloadCollections(routeModule);
      for (const collection of preloadCollections.collections) {
        const collectionId = collectionNodeId(collection);
        const definition = collectionDefinitionsByName.get(collection);
        addNode(nodes, {
          id: collectionId,
          kind: "Collection",
          label: collection,
          data: toDevtoolsSerializableValue(
            definition === undefined
              ? {
                  name: collection,
                  source: "RoutePreloadCollections",
                  status: preloadCollections.status
                }
              : {
                  ...definition,
                  source: "AppGraph"
                }
          )
        });
        connect({
          kind: "Preloads",
          source: routeId,
          target: collectionId,
          label: "declares collection preload",
          data: {
            routeId: routeModule.routeId,
            status: preloadCollections.status
          }
        });
      }
    }

    for (const path of input.appGraph.routePaths) {
      addNode(nodes, {
        id: routeNodeId(path),
        kind: "Route",
        label: path,
        data: { path }
      });
    }

    const serverFunctionCoverageId = schemaCoverageNodeId("serverFunctions");
    addNode(nodes, {
      id: serverFunctionCoverageId,
      kind: "SchemaCoverage",
      label: "serverFunctions schemas",
      data: schemaCoverageData(input.appGraph.schemaCoverage.serverFunctions)
    });
    connect({
      kind: "UsesEndpoint",
      source: serverFunctionCoverageId,
      target: endpointNodeId("rpc"),
      label: "served by",
      data: null
    });

    const actionCoverageId = schemaCoverageNodeId("actions");
    addNode(nodes, {
      id: actionCoverageId,
      kind: "SchemaCoverage",
      label: "actions schemas",
      data: schemaCoverageData(input.appGraph.schemaCoverage.actions)
    });
    connect({
      kind: "UsesEndpoint",
      source: actionCoverageId,
      target: endpointNodeId("action"),
      label: "served by",
      data: null
    });

    for (const serverFunction of input.appGraph.serverFunctionModules) {
      const serverFunctionId = serverFunctionNodeId(serverFunction.name);
      addNode(nodes, {
        id: serverFunctionId,
        kind: "ServerFunction",
        label: serverFunction.name,
        data: toDevtoolsSerializableValue(serverFunction)
      });
      connect({
        kind: "UsesEndpoint",
        source: serverFunctionId,
        target: endpointNodeId("rpc"),
        label: "served by",
        data: {
          rpcPath: serverFunction.client.rpcPath
        }
      });
      connect({
        kind: "Covers",
        source: serverFunctionCoverageId,
        target: serverFunctionId,
        label: "covers",
        data: schemaCoverageData({
          total: 1,
          input: serverFunction.wire.inputSchema ? 1 : 0,
          output: serverFunction.wire.outputSchema ? 1 : 0,
          error: serverFunction.wire.errorSchema ? 1 : 0
        })
      });
      connect({
        kind: "UsesModule",
        source: serverFunctionId,
        target: addModuleNode(serverFunction.server.moduleKind, serverFunction.server.module, {
          exportName: serverFunction.server.exportName
        }),
        label: "server export",
        data: {
          exportName: serverFunction.server.exportName,
          moduleKind: serverFunction.server.moduleKind
        }
      });
      if (serverFunction.client._tag === "Import") {
        connect({
          kind: "UsesModule",
          source: serverFunctionId,
          target: addModuleNode(serverFunction.client.moduleKind, serverFunction.client.module, {
            exportName: serverFunction.client.exportName
          }),
          label: "client reference",
          data: {
            exportName: serverFunction.client.exportName,
            moduleKind: serverFunction.client.moduleKind
          }
        });
      }
    }

    for (const action of input.appGraph.actionModules) {
      const actionId = actionNodeId(action.name);
      addNode(nodes, {
        id: actionId,
        kind: "Action",
        label: action.name,
        data: toDevtoolsSerializableValue(action)
      });
      connect({
        kind: "UsesEndpoint",
        source: actionId,
        target: endpointNodeId("action"),
        label: "served by",
        data: {
          actionPath: action.client.actionPath
        }
      });
      connect({
        kind: "Covers",
        source: actionCoverageId,
        target: actionId,
        label: "covers",
        data: schemaCoverageData({
          total: 1,
          input: action.wire.inputSchema ? 1 : 0,
          output: action.wire.outputSchema ? 1 : 0,
          error: action.wire.errorSchema ? 1 : 0
        })
      });
      connect({
        kind: "UsesModule",
        source: actionId,
        target: addModuleNode(action.server.moduleKind, action.server.module, {
          exportName: action.server.exportName
        }),
        label: "server export",
        data: {
          exportName: action.server.exportName,
          moduleKind: action.server.moduleKind
        }
      });
      if (action.client._tag === "Import") {
        connect({
          kind: "UsesModule",
          source: actionId,
          target: addModuleNode(action.client.moduleKind, action.client.module, {
            exportName: action.client.exportName
          }),
          label: "client reference",
          data: {
            exportName: action.client.exportName,
            moduleKind: action.client.moduleKind
          }
        });
      }
    }

    for (const family of input.appGraph.resourceFamilies) {
      addNode(nodes, {
        id: resourceFamilyNodeId(family.name),
        kind: "ResourceFamily",
        label: family.name,
        data: toDevtoolsSerializableValue(family)
      });
    }

    for (const tag of input.appGraph.resourceTags) {
      addNode(nodes, {
        id: tagNodeId(tag.name),
        kind: "ResourceTag",
        label: tag.name,
        data: toDevtoolsSerializableValue(tag)
      });
    }

    for (const collection of appGraphCollectionDefinitions(input.appGraph)) {
      addNode(nodes, {
        id: collectionNodeId(collection.name),
        kind: "Collection",
        label: collection.name,
        data: toDevtoolsSerializableValue({
          ...collection,
          source: "AppGraph"
        })
      });
    }

    for (const modulePath of input.appGraph.serverOnlyModules) {
      const moduleId = addModuleNode("server-only", modulePath);
      connect({
        kind: "UsesModule",
        source: serverFunctionCoverageId,
        target: moduleId,
        label: "discovers",
        data: null
      });
    }

    for (const modulePath of input.appGraph.browserClientModules) {
      const moduleId = addModuleNode("browser-client", modulePath);
      connect({
        kind: "UsesModule",
        source: actionCoverageId,
        target: moduleId,
        label: "discovers",
        data: null
      });
    }

    for (const missingSchema of input.appGraph.missingSchemas) {
      const missingId = missingSchemaNodeId(missingSchema);
      const ownerId = missingSchema.kind === "action"
        ? actionNodeId(missingSchema.name)
        : serverFunctionNodeId(missingSchema.name);
      const coverageId = missingSchema.kind === "action" ? actionCoverageId : serverFunctionCoverageId;

      addNode(nodes, {
        id: ownerId,
        kind: missingSchema.kind === "action" ? "Action" : "ServerFunction",
        label: missingSchema.name,
        data: {
          name: missingSchema.name
        }
      });
      addNode(nodes, {
        id: missingId,
        kind: "MissingSchema",
        label: missingSchema.name,
        data: toDevtoolsSerializableValue(missingSchema)
      });
      connect({
        kind: "MissingSchema",
        source: ownerId,
        target: missingId,
        label: "missing schema",
        data: null
      });
      connect({
        kind: "Covers",
        source: coverageId,
        target: missingId,
        label: "reports",
        data: null
      });
    }
  }

  for (const resource of input.resources) {
    addNode(nodes, {
      id: resourceNodeId(resource.key),
      kind: "Resource",
      label: resource.family ?? resource.key,
      data: {
        family: resource.family,
        input: resource.input,
        key: resource.key,
        sources: [...resource.sources],
        state: resource.state
      }
    });
  }

  for (const action of input.snapshot.actions) {
    const actionId = actionNodeId(action.name);
    addNode(nodes, {
      id: actionId,
      kind: "Action",
      label: action.name,
      data: {
        name: action.name,
        state: action.state
      }
    });

    for (const invalidationIndex of action.invalidationIndexes ?? []) {
      connect({
        kind: "Emits",
        source: actionId,
        target: invalidationNodeId(invalidationIndex),
        label: "emits",
        data: {
          invalidationIndex
        }
      });
    }
  }

  for (const plan of input.routePlans) {
    const routePlanId = routePlanNodeId(plan.index, plan.href);
    addNode(nodes, {
      id: routePlanId,
      kind: "RoutePlan",
      label: plan.href,
      data: {
        href: plan.href,
        hydrationResourceCount: plan.hydrationResourceCount,
        params: plan.params,
        path: plan.path,
        resourceCount: plan.resourceCount,
        search: plan.search,
        tag: plan._tag
      }
    });

    if (plan.path !== null) {
      const routeId = routeNodeId(plan.path);
      addNode(nodes, {
        id: routeId,
        kind: "Route",
        label: plan.path,
        data: { path: plan.path }
      });
      connect({
        kind: "Matches",
        source: routePlanId,
        target: routeId,
        label: "matches",
        data: {
          href: plan.href
        }
      });
    }

    for (const resource of plan.resources) {
      const targetId = resourceNodeId(resource.key);
      addNode(nodes, {
        id: targetId,
        kind: "Resource",
        label: resource.family,
        data: {
          family: resource.family,
          input: resource.input,
          key: resource.key,
          state: null
        }
      });
      connect({
        kind: "Preloads",
        source: routePlanId,
        target: targetId,
        label: "preloads",
        data: {
          href: plan.href
        }
      });
      if (plan.hydrationResourceCount > 0) {
        connect({
          kind: "Hydrates",
          source: routePlanId,
          target: targetId,
          label: "hydrates",
          data: {
            href: plan.href
          }
        });
      }
    }
  }

  input.requestTraces.forEach((trace, index) => {
    const traceSummary = input.requestTraceSummaries[index] ?? summarizeRequestTrace(trace, index);
    const traceId = requestTraceNodeId(traceSummary);
    addNode(nodes, {
      id: traceId,
      kind: "RequestTrace",
      label: `${trace.request.method} ${trace.request.path}`,
      data: toDevtoolsSerializableValue({
        request: trace.request,
        response: trace.response ?? null,
        services: trace.services,
        status: trace.status,
        teardown: trace.teardown ?? null,
        fibers: trace.fibers,
        streams: trace.streams
      })
    });

    if (trace.request.transport === "rpc" || trace.request.transport === "action") {
      const endpointId = endpointNodeId(trace.request.transport);
      addNode(nodes, {
        id: endpointId,
        kind: "Endpoint",
        label: trace.request.transport,
        data: {
          transport: trace.request.transport
        }
      });
      connect({
        kind: "UsesEndpoint",
        source: traceId,
        target: endpointId,
        label: "uses",
        data: {
          transport: trace.request.transport
        }
      });
    }

    if (trace.routePlan) {
      const plan = summarizeRoutePlan(trace.routePlan, index);
      const traceRoutePlanId = routePlanNodeId(index, plan.href);
      addNode(nodes, {
        id: traceRoutePlanId,
        kind: "RoutePlan",
        label: plan.href,
        data: {
          href: plan.href,
          hydrationResourceCount: plan.hydrationResourceCount,
          params: plan.params,
          path: plan.path,
          resourceCount: plan.resourceCount,
          search: plan.search,
          tag: plan._tag
        }
      });
      connect({
        kind: "Records",
        source: traceId,
        target: traceRoutePlanId,
        label: "records",
        data: null
      });

      if (plan.path !== null) {
        const routeId = routeNodeId(plan.path);
        addNode(nodes, {
          id: routeId,
          kind: "Route",
          label: plan.path,
          data: { path: plan.path }
        });
        connect({
          kind: "Matches",
          source: traceRoutePlanId,
          target: routeId,
          label: "matches",
          data: {
            href: plan.href
          }
        });
      }
    }

    for (const resource of trace.resources) {
      const resourceId = resourceNodeId(resource.key);
      addNode(nodes, {
        id: resourceId,
        kind: "Resource",
        label: resource.family,
        data: {
          family: resource.family,
          input: resource.input === undefined ? null : toDevtoolsSerializableValue(resource.input),
          key: resource.key,
          state: resource.state ?? null
        }
      });
      connect({
        kind: "Records",
        source: traceId,
        target: resourceId,
        label: "records",
        data: {
          targetKind: "Resource"
        }
      });
    }

    for (const collection of trace.collections) {
      const collectionId = collectionNodeId(collection.name);
      addNode(nodes, {
        id: collectionId,
        kind: "Collection",
        label: collection.name,
        data: toDevtoolsSerializableValue({
          ...collection,
          source: "RequestTrace"
        })
      });
      connect({
        kind: "Records",
        source: traceId,
        target: collectionId,
        label: "records",
        data: {
          targetKind: "Collection"
        }
      });
    }

    for (const action of trace.actions) {
      const actionId = actionNodeId(action.name);
      addNode(nodes, {
        id: actionId,
        kind: "Action",
        label: action.name,
        data: toDevtoolsSerializableValue(action)
      });
      connect({
        kind: "Records",
        source: traceId,
        target: actionId,
        label: "records",
        data: {
          targetKind: "Action"
        }
      });
    }

    for (const serverFunction of trace.serverFunctions) {
      const serverFunctionId = serverFunctionNodeId(serverFunction.name);
      addNode(nodes, {
        id: serverFunctionId,
        kind: "ServerFunction",
        label: serverFunction.name,
        data: toDevtoolsSerializableValue(serverFunction)
      });
      connect({
        kind: "Records",
        source: traceId,
        target: serverFunctionId,
        label: "records",
        data: {
          targetKind: "ServerFunction"
        }
      });
    }
  });

  for (const plan of input.invalidations) {
    const planId = invalidationNodeId(plan.index);
    addNode(nodes, {
      id: planId,
      kind: "InvalidationPlan",
      label: `Invalidation ${plan.index}`,
      data: {
        causeCount: plan.causeCount,
        index: plan.index,
        matchedResourceCount: plan.matchedResourceCount,
        targetCount: plan.targetCount
      }
    });

    for (const target of plan.targets) {
      const targetId = targetNodeId(target);
      addNode(nodes, {
        id: targetId,
        kind: target._tag === "Tag" ? "ResourceTag" : "InvalidationTarget",
        label: target._tag === "Tag" ? target.name : target.family,
        data: toDevtoolsSerializableValue(target)
      });
      connect({
        kind: "Targets",
        source: planId,
        target: targetId,
        label: "targets",
        data: null
      });
    }

    for (const entry of plan.entries) {
      const affectedResourceId = resourceNodeId(entry.ref.key);
      addNode(nodes, {
        id: affectedResourceId,
        kind: "Resource",
        label: entry.ref.family,
        data: {
          family: entry.ref.family,
          input: entry.ref.input,
          key: entry.ref.key,
          state: null
        }
      });
      connect({
        kind: "Invalidates",
        source: planId,
        target: affectedResourceId,
        label: "invalidates",
        data: {
          causeCount: entry.causes.length
        }
      });

      for (const cause of entry.causes) {
        const causeId = targetNodeId(cause);
        addNode(nodes, {
          id: causeId,
          kind: cause._tag === "Tag" ? "ResourceTag" : "Resource",
          label: cause._tag === "Tag" ? cause.name : cause.family,
          data: toDevtoolsSerializableValue(cause)
        });
        connect({
          kind: "Causes",
          source: causeId,
          target: affectedResourceId,
          label: "causes",
          data: {
            invalidationIndex: plan.index
          }
        });
      }
    }
  }

  for (const event of input.runtimeEvents) {
    const eventId = runtimeEventNodeId(event);
    addNode(nodes, {
      id: eventId,
      kind: "RuntimeEvent",
      label: event.label,
      data: {
        at: event.at,
        event: event.data,
        index: event.index,
        sequence: event.sequence,
        tag: event._tag
      }
    });
    if (event.target !== null) {
      addNode(nodes, {
        id: event.target.id,
        kind: event.target.kind,
        label: runtimeTargetLabel(event.target),
        data: {
          source: "RuntimeEvent",
          targetKind: event.target.kind
        }
      });
      connect({
        kind: "Observes",
        source: eventId,
        target: event.target.id,
        label: "observes",
        data: {
          targetKind: event.target.kind
        }
      });
    }
  }

  return {
    version: 1,
    nodes: Array.from(nodes.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id))
  };
};

export const describeDevtoolsCausalGraph = (
  input: DevtoolsSummaryInput = {}
): DevtoolsCausalGraph => {
  const snapshot = input.snapshot ?? emptySnapshot();
  const appGraph = input.appGraph ?? snapshot.appGraph;
  const invalidationPlans = input.invalidations ?? snapshot.invalidations;
  const routePlans = input.routePlans ?? snapshot.routePlans;
  const requestTraces = input.requestTraces ?? snapshot.requestTraces ?? [];
  const runtimeEvents = input.runtimeEvents ?? snapshot.events ?? [];
  const invalidations = invalidationPlans.map(summarizeInvalidationPlan);
  const routes = routePlans.map(summarizeRoutePlan);
  const requests = requestTraces.map(summarizeRequestTrace);
  const resources = resourceIndex(snapshot, invalidations, routes, requestTraces);
  const events = summarizeRuntimeEvents(runtimeEvents);

  return makeDevtoolsCausalGraph({
    appGraph,
    snapshot,
    invalidations,
    routePlans: routes,
    requestTraces,
    requestTraceSummaries: requests,
    resources,
    runtimeEvents: events
  });
};

export const describeDevtoolsCausalGraphEffect = (
  input: DevtoolsSummaryInput = {}
): Effect.Effect<DevtoolsCausalGraph> =>
  Effect.succeed(describeDevtoolsCausalGraph(input));

export const describeDevtoolsSummary = (
  input: DevtoolsSummaryInput = {}
): DevtoolsSummary => {
  const snapshot = input.snapshot ?? emptySnapshot();
  const appGraph = input.appGraph ?? snapshot.appGraph;
  const invalidationPlans = input.invalidations ?? snapshot.invalidations;
  const routePlans = input.routePlans ?? snapshot.routePlans;
  const requestTraces = input.requestTraces ?? snapshot.requestTraces ?? [];
  const runtimeEvents = input.runtimeEvents ?? snapshot.events ?? [];
  const invalidations = invalidationPlans.map(summarizeInvalidationPlan);
  const routes = routePlans.map(summarizeRoutePlan);
  const requests = requestTraces.map(summarizeRequestTrace);
  const events = summarizeRuntimeEvents(runtimeEvents);
  const resources = resourceIndex(snapshot, invalidations, routes, requestTraces);
  const causalGraph = makeDevtoolsCausalGraph({
    appGraph,
    snapshot,
    invalidations,
    routePlans: routes,
    requestTraces,
    requestTraceSummaries: requests,
    resources,
    runtimeEvents: events
  });

  return {
    version: 1,
    overview: {
      routeCount: appGraph?.routeCount ?? 0,
      serverFunctionCount: appGraph?.serverFunctionCount ?? 0,
      actionCount: appGraph?.actionCount ?? 0,
      resourceFamilyCount: appGraph?.resourceFamilies.length ?? 0,
      resourceTagCount: appGraph?.resourceTags.length ?? 0,
      collectionDefinitionCount: appGraph ? appGraphCollectionDefinitions(appGraph).length : 0,
      runtimeResourceCount: snapshot.resources.length,
      runtimeActionCount: snapshot.actions.length,
      invalidationPlanCount: invalidations.length,
      routePlanCount: routes.length,
      requestTraceCount: requests.length,
      runtimeEventCount: events.length,
      missingSchemaCount: appGraph?.missingSchemas.length ?? 0,
      unknownActionBehaviorCount: appGraph?.unknownActionBehavior.length ?? 0,
      unknownRoutePreloadResourcesCount: appGraph?.unknownRoutePreloadResources.length ?? 0,
      unknownRoutePreloadCollectionsCount: appGraph ? appGraphUnknownRoutePreloadCollections(appGraph).length : 0,
      notFoundRoutePlanCount: routes.filter((plan) => plan._tag === "NotFound").length,
      causalNodeCount: causalGraph.nodes.length,
      causalEdgeCount: causalGraph.edges.length
    },
    graph: graphSummary(appGraph),
    runtime: {
      resources: snapshot.resources.map((resource) => ({ ...resource })),
      actions: snapshot.actions.map((action) => ({
        name: action.name,
        state: action.state,
        invalidationIndexes: [...(action.invalidationIndexes ?? [])]
      })),
      events,
      resourceStates: stateCounts(snapshot.resources),
      actionStates: stateCounts(snapshot.actions)
    },
    invalidations: {
      plans: invalidations
    },
    routes: {
      plans: routes,
      notFoundHrefs: routes.flatMap((plan) => plan._tag === "NotFound" ? [plan.href] : [])
    },
    requests: {
      traces: requests
    },
    resources,
    causalGraph
  };
};

export const describeDevtoolsSummaryEffect = (
  input: DevtoolsSummaryInput = {}
): Effect.Effect<DevtoolsSummary> =>
  Effect.succeed(describeDevtoolsSummary(input));

const panelMetric = (
  label: string,
  value: string | number,
  unit?: string
): DevtoolsPanelMetric => ({
  label,
  value,
  ...(unit === undefined ? {} : { unit })
});

const panelItem = (options: {
  readonly id: string;
  readonly label: string;
  readonly severity?: DevtoolsPanelSeverity;
  readonly detail?: string;
  readonly metrics?: ReadonlyArray<DevtoolsPanelMetric>;
  readonly data?: DevtoolsSerializableValue;
}): DevtoolsPanelItem => ({
  id: options.id,
  label: options.label,
  severity: options.severity ?? "ok",
  ...(options.detail === undefined ? {} : { detail: options.detail }),
  ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
  ...(options.data === undefined ? {} : { data: options.data })
});

const severityRank: Record<DevtoolsPanelSeverity, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  error: 3
};

const maxSeverity = (
  severities: ReadonlyArray<DevtoolsPanelSeverity>,
  fallback: DevtoolsPanelSeverity = "ok"
): DevtoolsPanelSeverity =>
  severities.reduce(
    (current, next) => severityRank[next] > severityRank[current] ? next : current,
    fallback
  );

const requestTraceSeverity = (
  trace: DevtoolsSummaryRequestTrace
): DevtoolsPanelSeverity => {
  if (trace.status === "failure") {
    return "error";
  }
  if (trace.status === "cancelled" || trace.runtimeDisposed === false) {
    return "warning";
  }
  return "ok";
};

const diagnosticsSeverity = (summary: DevtoolsSummary): DevtoolsPanelSeverity => {
  if (summary.overview.missingSchemaCount > 0) {
    return "error";
  }
  return summary.overview.unknownActionBehaviorCount > 0 ||
    summary.overview.unknownRoutePreloadResourcesCount > 0 ||
    summary.overview.unknownRoutePreloadCollectionsCount > 0
    ? "warning"
    : "ok";
};

export const describeDevtoolsPanels = (
  input: DevtoolsPanelsInput = {}
): DevtoolsPanels => {
  const summary = input.summary ?? describeDevtoolsSummary(input);
  const graphAvailable = summary.graph._tag === "Available";
  const diagnosticsPanelSeverity = diagnosticsSeverity(summary);
  const requestDurations = summary.requests.traces.flatMap((trace) =>
    trace.durationMillis === null ? [] : [trace.durationMillis]
  );
  const requestAverageDuration = requestDurations.length === 0
    ? 0
    : Number((requestDurations.reduce((total, duration) => total + duration, 0) / requestDurations.length).toFixed(2));
  const failedRequestCount = summary.requests.traces.filter((trace) => trace.status === "failure").length;
  const cancelledRequestCount = summary.requests.traces.filter((trace) => trace.status === "cancelled").length;

  return {
    version: 1,
    panels: [
      {
        id: "app-graph",
        title: "App Graph",
        summary: graphAvailable
          ? `${summary.overview.routeCount} routes, ${summary.overview.serverFunctionCount} server functions, ${summary.overview.actionCount} actions`
          : "No app graph diagnostics recorded",
        severity: graphAvailable ? diagnosticsPanelSeverity : "info",
        metrics: [
          panelMetric("routes", summary.overview.routeCount),
          panelMetric("server functions", summary.overview.serverFunctionCount),
          panelMetric("actions", summary.overview.actionCount),
          panelMetric("resource families", summary.overview.resourceFamilyCount),
          panelMetric("collections", summary.overview.collectionDefinitionCount)
        ],
        items: graphAvailable
          ? summary.graph.routes.modules.map((routeModule) =>
              panelItem({
                id: `route:${routeModule.routeId}`,
                label: routeModule.routePath,
                detail: routeModule.moduleId,
                severity: routeModule.preloadResources.status === "unknown" ||
                  routeModule.preloadCollections.status === "unknown"
                  ? "warning"
                  : "ok",
                metrics: [
                  panelMetric("params", routeModule.pathParamCount),
                  panelMetric("preload resources", routeModule.preloadResources.status),
                  panelMetric("preload collections", routeModule.preloadCollections.status)
                ]
              })
            )
          : []
      },
      {
        id: "routes",
        title: "Routes",
        summary: `${summary.overview.routePlanCount} route plans, ${summary.overview.notFoundRoutePlanCount} not found`,
        severity: summary.overview.notFoundRoutePlanCount > 0 ? "warning" : summary.overview.routePlanCount === 0 ? "info" : "ok",
        metrics: [
          panelMetric("plans", summary.overview.routePlanCount),
          panelMetric("not found", summary.overview.notFoundRoutePlanCount)
        ],
        items: summary.routes.plans.map((plan) =>
          panelItem({
            id: `route-plan:${plan.index}`,
            label: plan.href,
            detail: plan.path ?? "not found",
            severity: plan._tag === "NotFound" ? "warning" : "ok",
            metrics: [
              panelMetric("resources", plan.resourceCount),
              panelMetric("hydrated", plan.hydrationResourceCount)
            ],
            data: {
              params: plan.params,
              search: plan.search
            }
          })
        )
      },
      {
        id: "resources",
        title: "Resources",
        summary: `${summary.resources.length} indexed resources, ${summary.overview.runtimeResourceCount} runtime resources`,
        severity: summary.resources.length === 0 ? "info" : "ok",
        metrics: [
          panelMetric("indexed", summary.resources.length),
          panelMetric("runtime", summary.overview.runtimeResourceCount),
          panelMetric("families", summary.overview.resourceFamilyCount),
          panelMetric("tags", summary.overview.resourceTagCount)
        ],
        items: summary.resources.map((resource) =>
          panelItem({
            id: `resource:${resource.key}`,
            label: resource.family ?? resource.key,
            detail: resource.state ?? "unknown",
            severity: resource.state === "Failure" ? "error" : "ok",
            metrics: [
              panelMetric("routes", resource.routeHrefs.length),
              panelMetric("invalidations", resource.invalidationIndexes.length)
            ],
            data: {
              key: resource.key,
              input: resource.input,
              sources: resource.sources
            }
          })
        )
      },
      {
        id: "actions",
        title: "Actions",
        summary: `${summary.overview.actionCount} graph actions, ${summary.overview.runtimeActionCount} runtime actions`,
        severity: summary.runtime.actions.some((action) => action.state === "Failure") ? "error" : "ok",
        metrics: [
          panelMetric("graph", summary.overview.actionCount),
          panelMetric("runtime", summary.overview.runtimeActionCount),
          panelMetric("invalidation plans", summary.overview.invalidationPlanCount)
        ],
        items: summary.runtime.actions.map((action) =>
          panelItem({
            id: `action:${action.name}`,
            label: action.name,
            detail: action.state,
            severity: action.state === "Failure" ? "error" : "ok",
            metrics: [
              panelMetric("invalidations", action.invalidationIndexes.length)
            ]
          })
        )
      },
      {
        id: "collections",
        title: "Collections",
        summary: `${summary.overview.collectionDefinitionCount} graph collections`,
        severity: summary.overview.collectionDefinitionCount === 0 ? "info" : "ok",
        metrics: [
          panelMetric("definitions", summary.overview.collectionDefinitionCount),
          panelMetric(
            "traced",
            summary.requests.traces.reduce((count, trace) => count + trace.collectionCount, 0)
          )
        ],
        items: graphAvailable
          ? summary.graph.collections.definitions.map((collection) =>
              panelItem({
                id: `collection:${collection.name}`,
                label: collection.name,
                severity: "ok"
              })
            )
          : []
      },
      {
        id: "requests",
        title: "Requests",
        summary: `${summary.overview.requestTraceCount} traces, ${failedRequestCount} failures, ${cancelledRequestCount} cancelled`,
        severity: maxSeverity(summary.requests.traces.map(requestTraceSeverity), summary.overview.requestTraceCount === 0 ? "info" : "ok"),
        metrics: [
          panelMetric("traces", summary.overview.requestTraceCount),
          panelMetric("failures", failedRequestCount),
          panelMetric("cancelled", cancelledRequestCount),
          panelMetric("average duration", requestAverageDuration, "ms")
        ],
        items: summary.requests.traces.map((trace) =>
          panelItem({
            id: `request:${trace.id}`,
            label: `${trace.method} ${trace.path}`,
            detail: `${trace.transport} ${trace.status}`,
            severity: requestTraceSeverity(trace),
            metrics: [
              panelMetric("resources", trace.resourceCount),
              panelMetric("collections", trace.collectionCount),
              panelMetric("actions", trace.actionCount),
              panelMetric("duration", trace.durationMillis ?? "unknown", trace.durationMillis === null ? undefined : "ms"),
              panelMetric("before fibers", trace.beforeDisposeFiberCount ?? "unknown"),
              panelMetric("after fibers", trace.afterDisposeFiberCount ?? "unknown")
            ],
            data: {
              id: trace.id,
              routeHref: trace.routeHref,
              teardownReason: trace.teardownReason,
              runtimeDisposed: trace.runtimeDisposed
            }
          })
        )
      },
      {
        id: "diagnostics",
        title: "Diagnostics",
        summary: `${summary.overview.missingSchemaCount} missing schemas, ${summary.overview.unknownActionBehaviorCount} unknown action behaviors`,
        severity: diagnosticsPanelSeverity,
        metrics: [
          panelMetric("missing schemas", summary.overview.missingSchemaCount),
          panelMetric("unknown action behavior", summary.overview.unknownActionBehaviorCount),
          panelMetric("unknown preload resources", summary.overview.unknownRoutePreloadResourcesCount),
          panelMetric("unknown preload collections", summary.overview.unknownRoutePreloadCollectionsCount)
        ],
        items: graphAvailable
          ? [
              ...summary.graph.missingSchemas.map((schema) =>
                panelItem({
                  id: `missing-schema:${schema.kind}:${schema.name}`,
                  label: schema.name,
                  detail: schema.kind,
                  severity: "error",
                  data: toDevtoolsSerializableValue(schema)
                })
              ),
              ...summary.graph.actions.unknownBehavior.map((entry) =>
                panelItem({
                  id: `unknown-action:${entry.name}`,
                  label: entry.name,
                  detail: "unknown action behavior",
                  severity: "warning",
                  data: toDevtoolsSerializableValue(entry)
                })
              ),
              ...summary.graph.routes.unknownPreloadResources.map((entry) =>
                panelItem({
                  id: `unknown-preload-resources:${entry.routeId}`,
                  label: entry.routePath,
                  detail: "unknown preload resources",
                  severity: "warning",
                  data: toDevtoolsSerializableValue(entry)
                })
              ),
              ...summary.graph.routes.unknownPreloadCollections.map((entry) =>
                panelItem({
                  id: `unknown-preload-collections:${entry.routeId}`,
                  label: entry.routePath,
                  detail: "unknown preload collections",
                  severity: "warning",
                  data: toDevtoolsSerializableValue(entry)
                })
              )
            ]
          : []
      },
      {
        id: "causal-graph",
        title: "Causal Graph",
        summary: `${summary.overview.causalNodeCount} nodes, ${summary.overview.causalEdgeCount} edges`,
        severity: summary.overview.causalNodeCount === 0 ? "info" : "ok",
        metrics: [
          panelMetric("nodes", summary.overview.causalNodeCount),
          panelMetric("edges", summary.overview.causalEdgeCount)
        ],
        items: summary.causalGraph.nodes.map((node) =>
          panelItem({
            id: node.id,
            label: node.label,
            detail: node.kind,
            severity: "ok",
            data: node.data
          })
        )
      }
    ]
  };
};

export const describeDevtoolsPanelsEffect = (
  input: DevtoolsPanelsInput = {}
): Effect.Effect<DevtoolsPanels> =>
  Effect.succeed(describeDevtoolsPanels(input));

const devtoolsPanelIds: ReadonlyArray<DevtoolsPanelId> = [
  "app-graph",
  "routes",
  "resources",
  "actions",
  "collections",
  "requests",
  "diagnostics",
  "causal-graph"
];

const devtoolsPanelIdSet: ReadonlySet<string> = new Set(devtoolsPanelIds);

const isDevtoolsPanelId = (value: string | undefined): value is DevtoolsPanelId =>
  value !== undefined && devtoolsPanelIdSet.has(value);

const defaultDevtoolsPanelTitle = "Effect UI Devtools";
const defaultDevtoolsMaxPanelItems = 8;

export const devtoolsPanelStyles = `
.effect-ui-devtools {
  color: #172033;
  background: #f7f8fb;
  border: 1px solid #d8deea;
  border-radius: 8px;
  font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-width: 1120px;
}
.effect-ui-devtools * {
  box-sizing: border-box;
}
.effect-ui-devtools__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #d8deea;
}
.effect-ui-devtools__title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.effect-ui-devtools__version {
  color: #5d6b82;
  font-size: 12px;
}
.effect-ui-devtools__tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 12px;
  border-bottom: 1px solid #d8deea;
}
.effect-ui-devtools__tab {
  appearance: none;
  background: #ffffff;
  border: 1px solid #cdd5e2;
  border-radius: 6px;
  color: #172033;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  white-space: nowrap;
}
.effect-ui-devtools__tab[aria-selected="true"] {
  background: #173b68;
  border-color: #173b68;
  color: #ffffff;
}
.effect-ui-devtools__severity {
  border-radius: 999px;
  border: 1px solid currentColor;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
}
.effect-ui-devtools__body {
  padding: 14px 16px 16px;
}
.effect-ui-devtools__panel {
  display: grid;
  gap: 12px;
}
.effect-ui-devtools__panel[hidden] {
  display: none;
}
.effect-ui-devtools__panel-header {
  display: grid;
  gap: 4px;
}
.effect-ui-devtools__panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}
.effect-ui-devtools__summary {
  color: #4d5c73;
  margin: 0;
}
.effect-ui-devtools__metrics {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  margin: 0;
}
.effect-ui-devtools__metric {
  background: #ffffff;
  border: 1px solid #d8deea;
  border-radius: 6px;
  padding: 8px 10px;
}
.effect-ui-devtools__metric-label {
  color: #5d6b82;
  display: block;
  font-size: 11px;
}
.effect-ui-devtools__metric-value {
  display: block;
  font-size: 14px;
  font-weight: 650;
}
.effect-ui-devtools__items {
  display: grid;
  gap: 8px;
}
.effect-ui-devtools__item {
  background: #ffffff;
  border: 1px solid #d8deea;
  border-radius: 6px;
  display: grid;
  gap: 8px;
  padding: 10px;
}
.effect-ui-devtools__item-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}
.effect-ui-devtools__item-label {
  font-weight: 650;
  overflow-wrap: anywhere;
}
.effect-ui-devtools__item-detail {
  color: #5d6b82;
  overflow-wrap: anywhere;
}
.effect-ui-devtools__data {
  margin: 0;
}
.effect-ui-devtools__data pre {
  background: #101828;
  border-radius: 6px;
  color: #eef4ff;
  margin: 8px 0 0;
  max-height: 280px;
  overflow: auto;
  padding: 10px;
}
.effect-ui-devtools__empty {
  color: #5d6b82;
  margin: 0;
}
`.trim();

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const metricValueText = (metric: DevtoolsPanelMetric): string =>
  metric.unit === undefined ? String(metric.value) : `${metric.value} ${metric.unit}`;

const metricHtml = (metric: DevtoolsPanelMetric): string => `
<div class="effect-ui-devtools__metric">
  <span class="effect-ui-devtools__metric-label">${escapeHtml(metric.label)}</span>
  <span class="effect-ui-devtools__metric-value">${escapeHtml(metricValueText(metric))}</span>
</div>`;

const metricsHtml = (metrics: ReadonlyArray<DevtoolsPanelMetric>): string =>
  metrics.length === 0
    ? ""
    : `<div class="effect-ui-devtools__metrics">${metrics.map(metricHtml).join("")}</div>`;

const dataHtml = (data: DevtoolsSerializableValue | undefined): string =>
  data === undefined
    ? ""
    : `<details class="effect-ui-devtools__data"><summary>Data</summary><pre>${escapeHtml(JSON.stringify(data, null, 2) ?? "null")}</pre></details>`;

const itemHtml = (item: DevtoolsPanelItem): string => `
<article class="effect-ui-devtools__item" data-severity="${escapeHtml(item.severity)}">
  <div class="effect-ui-devtools__item-header">
    <div>
      <div class="effect-ui-devtools__item-label">${escapeHtml(item.label)}</div>
      ${item.detail === undefined ? "" : `<div class="effect-ui-devtools__item-detail">${escapeHtml(item.detail)}</div>`}
    </div>
    <span class="effect-ui-devtools__severity">${escapeHtml(item.severity)}</span>
  </div>
  ${metricsHtml(item.metrics ?? [])}
  ${dataHtml(item.data)}
</article>`;

const limitPanelItems = (
  items: ReadonlyArray<DevtoolsPanelItem>,
  maxItems: number
): ReadonlyArray<DevtoolsPanelItem> =>
  maxItems < 0 ? items : items.slice(0, maxItems);

const panelHtml = (
  panel: DevtoolsPanel,
  selectedPanelId: DevtoolsPanelId | undefined,
  maxItems: number
): string => {
  const visible = panel.id === selectedPanelId;
  const items = limitPanelItems(panel.items, maxItems);
  const remainingCount = panel.items.length - items.length;

  return `
<section class="effect-ui-devtools__panel" data-panel-id="${escapeHtml(panel.id)}"${visible ? "" : " hidden"}>
  <header class="effect-ui-devtools__panel-header">
    <h3 class="effect-ui-devtools__panel-title">${escapeHtml(panel.title)}</h3>
    <p class="effect-ui-devtools__summary">${escapeHtml(panel.summary)}</p>
  </header>
  ${metricsHtml(panel.metrics)}
  <div class="effect-ui-devtools__items">
    ${items.length === 0 ? `<p class="effect-ui-devtools__empty">No panel items recorded.</p>` : items.map(itemHtml).join("")}
    ${remainingCount > 0 ? `<p class="effect-ui-devtools__empty">${remainingCount} more items hidden by the current render limit.</p>` : ""}
  </div>
</section>`;
};

const resolveDevtoolsPanels = (input: DevtoolsPanelUiInput): DevtoolsPanels =>
  input.panels ?? describeDevtoolsPanels(input);

const resolveMaxPanelItems = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultDevtoolsMaxPanelItems;
  }
  return Math.max(0, Math.floor(value));
};

const resolveSelectedPanelId = (
  panels: DevtoolsPanels,
  requested: DevtoolsPanelId | undefined
): DevtoolsPanelId | undefined => {
  if (requested !== undefined && panels.panels.some((panel) => panel.id === requested)) {
    return requested;
  }
  return panels.panels[0]?.id;
};

export const renderDevtoolsPanelsHtml = (
  input: DevtoolsPanelUiInput = {}
): string => {
  const panels = resolveDevtoolsPanels(input);
  const selectedPanelId = resolveSelectedPanelId(panels, input.selectedPanelId);
  const maxItems = resolveMaxPanelItems(input.maxItemsPerPanel);
  const title = input.title ?? defaultDevtoolsPanelTitle;
  const includeStyles = input.includeStyles ?? true;

  return `${includeStyles ? `<style>${devtoolsPanelStyles}</style>` : ""}
<article class="effect-ui-devtools" data-effect-ui-devtools-version="${panels.version}"${selectedPanelId === undefined ? "" : ` data-selected-panel="${escapeHtml(selectedPanelId)}"`}>
  <header class="effect-ui-devtools__header">
    <h2 class="effect-ui-devtools__title">${escapeHtml(title)}</h2>
    <span class="effect-ui-devtools__version">panel contract v${panels.version}</span>
  </header>
  <nav class="effect-ui-devtools__tabs" aria-label="Effect UI devtools panels">
    ${panels.panels.map((panel) => `
      <button
        type="button"
        class="effect-ui-devtools__tab"
        data-effect-ui-devtools-panel-target="${escapeHtml(panel.id)}"
        aria-selected="${panel.id === selectedPanelId ? "true" : "false"}"
      >
        <span>${escapeHtml(panel.title)}</span>
        <span class="effect-ui-devtools__severity">${escapeHtml(panel.severity)}</span>
      </button>
    `).join("")}
  </nav>
  <div class="effect-ui-devtools__body">
    ${panels.panels.map((panel) => panelHtml(panel, selectedPanelId, maxItems)).join("")}
  </div>
</article>`;
};

export const renderDevtoolsPanelsHtmlEffect = (
  input: DevtoolsPanelUiInput = {}
): Effect.Effect<string> =>
  Effect.succeed(renderDevtoolsPanelsHtml(input));

export const mountDevtoolsPanels = (
  options: DevtoolsPanelMountOptions
): DevtoolsPanelMount => {
  const { root, ...initialInput } = options;
  let input: DevtoolsPanelUiInput = initialInput;
  let mounted = true;

  const render = (): void => {
    root.innerHTML = renderDevtoolsPanelsHtml(input);
  };

  const selectPanel = (panelId: DevtoolsPanelId): void => {
    input = {
      ...input,
      selectedPanelId: panelId
    };
    render();
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const trigger = target.closest<HTMLElement>("[data-effect-ui-devtools-panel-target]");
    if (trigger === null || !root.contains(trigger)) {
      return;
    }
    const panelId = trigger.dataset.effectUiDevtoolsPanelTarget;
    if (!isDevtoolsPanelId(panelId)) {
      return;
    }
    event.preventDefault();
    selectPanel(panelId);
  };

  root.addEventListener("click", onClick);
  render();

  return {
    root,
    update: (nextInput: DevtoolsPanelUiInput = {}) => {
      if (!mounted) {
        return;
      }
      input = {
        ...input,
        ...nextInput
      };
      render();
    },
    unmount: () => {
      if (!mounted) {
        return;
      }
      mounted = false;
      root.removeEventListener("click", onClick);
      root.innerHTML = "";
    }
  };
};

export const mountDevtoolsPanelsEffect = (
  options: DevtoolsPanelMountOptions
): Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => mountDevtoolsPanels(options)),
    (mount) => Effect.sync(() => {
      mount.unmount();
    })
  );

export const installDevtoolsBridge = (
  provider: DevtoolsBridgeProvider,
  target: DevtoolsBridgeTarget = globalThis as DevtoolsBridgeTarget
): DevtoolsBridgeInstall => {
  const hadPrevious = Object.prototype.hasOwnProperty.call(
    target,
    effectUiDevtoolsBridgeGlobal
  );
  const previous = target[effectUiDevtoolsBridgeGlobal];
  let installed = true;
  target[effectUiDevtoolsBridgeGlobal] = provider;

  return {
    target,
    uninstall: () => {
      if (!installed) {
        return;
      }
      installed = false;
      if (hadPrevious) {
        target[effectUiDevtoolsBridgeGlobal] = previous;
      } else {
        delete target[effectUiDevtoolsBridgeGlobal];
      }
    }
  };
};

export const installDevtoolsBridgeEffect = (
  provider: DevtoolsBridgeProvider,
  target?: DevtoolsBridgeTarget
): Effect.Effect<DevtoolsBridgeInstall, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => installDevtoolsBridge(provider, target)),
    (bridge) => Effect.sync(() => {
      bridge.uninstall();
    })
  );

const actionStateTag = <I, A, E>(state: ActionState<I, A, E>): string =>
  state._tag;

const actionStateInput = <I, A, E>(state: ActionState<I, A, E>): I | undefined =>
  "input" in state ? state.input : undefined;

export const makeDevtoolsStore = (options: DevtoolsStoreOptions = {}) => {
  const invalidationLimit = options.invalidationLimit ?? 50;
  const routePlanLimit = options.routePlanLimit ?? 50;
  const requestTraceLimit = options.requestTraceLimit ?? 50;
  const eventLimit = options.eventLimit ?? 500;
  let nextEventSequence = 0;
  let snapshot: DevtoolsSnapshot = {
    resources: [],
    actions: [],
    invalidations: [],
    routePlans: []
  };

  const boundedEvents = (
    events: ReadonlyArray<DevtoolsRuntimeEvent>
  ): ReadonlyArray<DevtoolsRuntimeEvent> =>
    events.slice(-eventLimit);

  const withSequence = (event: DevtoolsRuntimeEvent): DevtoolsRuntimeEvent => {
    if (event.sequence !== undefined) {
      nextEventSequence = Math.max(nextEventSequence, event.sequence + 1);
      return event;
    }

    const sequence = nextEventSequence;
    nextEventSequence += 1;
    return {
      ...event,
      sequence
    };
  };

  const recordRuntimeEvent = (event: DevtoolsRuntimeEvent): void => {
    snapshot = {
      ...snapshot,
      events: boundedEvents([
        ...(snapshot.events ?? []),
        withSequence(event)
      ])
    };
  };

  const recordInvalidationPlan = (plan: ResourceInvalidationPlan): number => {
    return recordSerializedInvalidationPlan(describeInvalidationPlan(plan));
  };

  const recordSerializedInvalidationPlan = (plan: DevtoolsInvalidationPlan): number => {
    const invalidations = [
      ...snapshot.invalidations,
      copyInvalidationPlan(plan)
    ].slice(-invalidationLimit);
    snapshot = {
      ...snapshot,
      invalidations
    };
    return invalidations.length - 1;
  };

  const recordActionInvalidations = (
    actionOptions: DevtoolsRecordActionStateOptions
  ): ReadonlyArray<number> | undefined => {
    if (
      actionOptions.invalidationPlan !== undefined &&
      actionOptions.serializedInvalidationPlan !== undefined
    ) {
      throw new DevtoolsActionInvalidationPlanConflict({
        guidance: "Pass invalidationPlan for local refs or serializedInvalidationPlan for transport-provided snapshots."
      });
    }

    if (actionOptions.invalidationPlan !== undefined) {
      return [recordInvalidationPlan(actionOptions.invalidationPlan)];
    }

    if (actionOptions.serializedInvalidationPlan !== undefined) {
      return [recordSerializedInvalidationPlan(actionOptions.serializedInvalidationPlan)];
    }

    return undefined;
  };

  const recordRequestTrace = (trace: DevtoolsRequestTrace): void => {
    snapshot = {
      ...snapshot,
      requestTraces: [
        ...(snapshot.requestTraces ?? []),
        copyRequestTrace(trace)
      ].slice(-requestTraceLimit)
    };
    recordRuntimeEvent({
      _tag: "RequestTrace",
      trace: copyRequestTrace(trace)
    });
  };

  const recordActionState = (
    action: string,
    state: string,
    actionOptions: DevtoolsRecordActionStateOptions = {}
  ): void => {
    const invalidationIndexes = recordActionInvalidations(actionOptions);
    snapshot = {
      ...snapshot,
      actions: [
        ...snapshot.actions.filter((entry) => entry.name !== action),
        {
          name: action,
          state,
          ...(invalidationIndexes === undefined ? {} : { invalidationIndexes })
        }
      ]
    };
    recordRuntimeEvent({
      _tag: "ActionState",
      action,
      state,
      ...(actionOptions.input === undefined ? {} : { input: actionOptions.input }),
      ...(invalidationIndexes === undefined ? {} : { invalidationIndexes })
    });
  };

  const recordAction = (
    action: ActionInstance<unknown, unknown, unknown, unknown>
  ): void => {
    const state = action.state.get();
    const input = actionStateInput(state);
    const invalidationPlan = action.invalidationPlan.get();
    recordActionState(
      action.definition.name,
      actionStateTag(state),
      {
        ...(input === undefined ? {} : { input }),
        ...(invalidationPlan === undefined ? {} : { invalidationPlan })
      }
    );
  };

  const recordStartAction = (
    action: DevtoolsStartActionInstance
  ): void => {
    const state = action.state.get();
    const input = actionStateInput(state);
    const serializedInvalidationPlan = action.invalidation.get();
    recordActionState(
      action.definition.name,
      actionStateTag(state),
      {
        ...(input === undefined ? {} : { input }),
        ...(serializedInvalidationPlan === undefined ? {} : { serializedInvalidationPlan })
      }
    );
  };

  return {
    getSnapshot: () => snapshot,
    getSnapshotEffect: () => Effect.sync(() => snapshot),
    setSnapshot: (next: DevtoolsSnapshot) => {
      snapshot = next;
    },
    setSnapshotEffect: (next: DevtoolsSnapshot) =>
      Effect.sync(() => {
        snapshot = next;
      }),
    setAppGraphDiagnostics: (appGraph: DevtoolsStartAppGraphDiagnostics) => {
      snapshot = {
        ...snapshot,
        appGraph
      };
    },
    setAppGraphDiagnosticsEffect: (appGraph: DevtoolsStartAppGraphDiagnostics) =>
      Effect.sync(() => {
        snapshot = {
          ...snapshot,
          appGraph
        };
      }),
    clearAppGraphDiagnostics: () => {
      const { appGraph: _appGraph, ...next } = snapshot;
      snapshot = next;
    },
    clearAppGraphDiagnosticsEffect: () =>
      Effect.sync(() => {
        const { appGraph: _appGraph, ...next } = snapshot;
        snapshot = next;
      }),
    recordInvalidation: (plan: ResourceInvalidationPlan) => {
      recordInvalidationPlan(plan);
    },
    recordInvalidationEffect: (plan: ResourceInvalidationPlan) =>
      Effect.sync(() => {
        recordInvalidationPlan(plan);
      }),
    recordSerializedInvalidation: (plan: DevtoolsInvalidationPlan) => {
      recordSerializedInvalidationPlan(plan);
    },
    recordSerializedInvalidationEffect: (plan: DevtoolsInvalidationPlan) =>
      Effect.sync(() => {
        recordSerializedInvalidationPlan(plan);
      }),
    recordActionState,
    recordActionStateEffect: (
      action: string,
      state: string,
      actionOptions: DevtoolsRecordActionStateOptions = {}
    ) =>
      Effect.sync(() => {
        recordActionState(action, state, actionOptions);
      }),
    recordAction,
    recordActionEffect: (action: ActionInstance<unknown, unknown, unknown, unknown>) =>
      Effect.sync(() => {
        recordAction(action);
      }),
    trackActionEffect: (action: ActionInstance<unknown, unknown, unknown, unknown>) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          recordAction(action);
          return action.state.subscribe(() => recordAction(action));
        }),
        (unsubscribe) => Effect.sync(unsubscribe)
      ).pipe(Effect.asVoid),
    recordStartAction,
    recordStartActionEffect: (action: DevtoolsStartActionInstance) =>
      Effect.sync(() => {
        recordStartAction(action);
      }),
    trackStartActionEffect: (action: DevtoolsStartActionInstance) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          recordStartAction(action);
          return action.state.subscribe(() => recordStartAction(action));
        }),
        (unsubscribe) => Effect.sync(unsubscribe)
      ).pipe(Effect.asVoid),
    recordRoutePlan: (plan: Route.NavigationPlan) => {
      snapshot = {
        ...snapshot,
        routePlans: [
          ...snapshot.routePlans,
          describeRoutePlan(plan)
        ].slice(-routePlanLimit)
      };
    },
    recordRoutePlanEffect: (plan: Route.NavigationPlan) =>
      Effect.sync(() => {
        snapshot = {
          ...snapshot,
          routePlans: [
            ...snapshot.routePlans,
            describeRoutePlan(plan)
          ].slice(-routePlanLimit)
        };
      }),
    recordResourceEvent: (event: ResourceStoreEvent) => {
      recordRuntimeEvent({
        _tag: "ResourceStoreEvent",
        event
      });
    },
    recordResourceEventEffect: (event: ResourceStoreEvent) =>
      Effect.sync(() => {
        recordRuntimeEvent({
          _tag: "ResourceStoreEvent",
          event
        });
      }),
    recordCollectionEvent: (event: DevtoolsCollectionStoreEvent) => {
      recordRuntimeEvent({
        _tag: "CollectionStoreEvent",
        event
      });
    },
    recordCollectionEventEffect: (event: DevtoolsCollectionStoreEvent) =>
      Effect.sync(() => {
        recordRuntimeEvent({
          _tag: "CollectionStoreEvent",
          event
        });
      }),
    recordRuntimeEvent,
    recordRuntimeEventEffect: (event: DevtoolsRuntimeEvent) =>
      Effect.sync(() => {
        recordRuntimeEvent(event);
      }),
    recordRequestTrace,
    recordRequestTraceEffect: (trace: DevtoolsRequestTrace) =>
      Effect.sync(() => {
        recordRequestTrace(trace);
      }),
    getSummary: () => describeDevtoolsSummary({ snapshot }),
    getSummaryEffect: () => Effect.sync(() => describeDevtoolsSummary({ snapshot })),
    getPanels: () => describeDevtoolsPanels({ snapshot }),
    getPanelsEffect: () => Effect.sync(() => describeDevtoolsPanels({ snapshot })),
    getCausalGraph: () => describeDevtoolsCausalGraph({ snapshot }),
    getCausalGraphEffect: () => Effect.sync(() => describeDevtoolsCausalGraph({ snapshot }))
  };
};
