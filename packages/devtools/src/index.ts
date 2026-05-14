import { type ActionSubmissionState, type ActionState, type ReadableSignal, type ResourceInvalidationPlan, type ResourceStoreEvent, type Route } from "@effect-ui/core";
import { Data, Effect, type Scope } from "effect";
import {
  mountDevtoolsPanelsEffectWithResolver,
  mountDevtoolsPanelsWithResolver,
  renderDevtoolsPanelsHtmlWithResolver
} from "./panel-renderer.js";
import { describeDevtoolsPanelsWithRuntime } from "./panels.js";
import {
  copyInvalidationPlan,
  copyRequestTrace,
  describeInvalidationPlan,
  describeRoutePlan,
  toDevtoolsSerializableValue
} from "./serialization.js";
import {
  describeDevtoolsCausalGraph,
  describeDevtoolsSummary
} from "./summary.js";
import { makeDevtoolsStoreWithRuntime } from "./store.js";

export * from "./bridge.js";
export { devtoolsPanelStyles } from "./panel-renderer.js";
export {
  DevtoolsUnknownInvalidationTarget,
  describeInvalidationPlan,
  describeRoutePlan,
  toDevtoolsSerializableValue
} from "./serialization.js";
export {
  describeDevtoolsCausalGraph,
  describeDevtoolsCausalGraphEffect,
  describeDevtoolsSummary,
  describeDevtoolsSummaryEffect
} from "./summary.js";

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
  readonly state: ReadableSignal<ActionSubmissionState<unknown, unknown, unknown, unknown>>;
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
export type DevtoolsRequestTraceFailureKind =
  | "domain"
  | "validation"
  | "protocol"
  | "transport"
  | "defect"
  | "interruption";
export type DevtoolsRequestTraceStreamState = "open" | "closed" | "cancelled" | "errored";
export type DevtoolsRequestTraceFiberStatus = "running" | "done" | "interrupted" | "failed";

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
  readonly failureKind?: DevtoolsRequestTraceFailureKind;
}

export interface DevtoolsRequestTraceAction {
  readonly name: string;
  readonly state?: string;
  readonly failureKind?: DevtoolsRequestTraceFailureKind;
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
  readonly failureKind?: DevtoolsRequestTraceFailureKind;
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
  readonly failureKind: DevtoolsRequestTraceFailureKind | null;
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

const devtoolsPanelsRuntime = {
  describeSummary: describeDevtoolsSummary,
  toSerializableValue: toDevtoolsSerializableValue
};

export const describeDevtoolsPanels = (
  input: DevtoolsPanelsInput = {}
): DevtoolsPanels =>
  describeDevtoolsPanelsWithRuntime(input, devtoolsPanelsRuntime);

export const describeDevtoolsPanelsEffect = (
  input: DevtoolsPanelsInput = {}
): Effect.Effect<DevtoolsPanels> =>
  Effect.succeed(describeDevtoolsPanels(input));

const resolveDevtoolsPanels = (input: DevtoolsPanelUiInput): DevtoolsPanels =>
  input.panels ?? describeDevtoolsPanels(input);

export const renderDevtoolsPanelsHtml = (
  input: DevtoolsPanelUiInput = {}
): string =>
  renderDevtoolsPanelsHtmlWithResolver(input, resolveDevtoolsPanels);

export const renderDevtoolsPanelsHtmlEffect = (
  input: DevtoolsPanelUiInput = {}
): Effect.Effect<string> =>
  Effect.succeed(renderDevtoolsPanelsHtml(input));

export const mountDevtoolsPanels = (
  options: DevtoolsPanelMountOptions
): DevtoolsPanelMount =>
  mountDevtoolsPanelsWithResolver(options, resolveDevtoolsPanels);

export const mountDevtoolsPanelsEffect = (
  options: DevtoolsPanelMountOptions
): Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> =>
  mountDevtoolsPanelsEffectWithResolver(options, resolveDevtoolsPanels);

const devtoolsStoreRuntime = {
  describeInvalidationPlan,
  copyInvalidationPlan,
  copyRequestTrace,
  describeRoutePlan,
  throwActionInvalidationPlanConflict: (guidance: string): never => {
    throw new DevtoolsActionInvalidationPlanConflict({ guidance });
  },
  describeSummary: describeDevtoolsSummary,
  describePanels: describeDevtoolsPanels,
  describeCausalGraph: describeDevtoolsCausalGraph
};

export const makeDevtoolsStore = (options: DevtoolsStoreOptions = {}) =>
  makeDevtoolsStoreWithRuntime(options, devtoolsStoreRuntime);
