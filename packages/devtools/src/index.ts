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

/** Typed error thrown when callers provide both live and serialized invalidation plans. */
export class DevtoolsActionInvalidationPlanConflict extends Data.TaggedError(
  "DevtoolsActionInvalidationPlanConflict"
)<{
  readonly guidance: string;
}> {}

/** Header captured for request inspection; sensitive values should already be redacted upstream. */
export interface DevtoolsRequestTraceHeader {
  readonly name: string;
  readonly value: string;
}

/** Cookie fact captured for request inspection; values should be redacted before recording. */
export interface DevtoolsRequestTraceCookie {
  readonly name: string;
  readonly value: string;
}

/** HTTP request facts recorded by Start or another compatible server adapter. */
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

/** HTTP response facts recorded for a request trace. */
export interface DevtoolsRequestTraceResponse {
  readonly status: number;
  readonly statusText?: string;
  readonly headers?: ReadonlyArray<DevtoolsRequestTraceHeader>;
  readonly setCookieCount?: number;
}

/** Resource fact touched, loaded, or serialized during one request. */
export interface DevtoolsRequestTraceResource {
  readonly key: string;
  readonly family: string;
  readonly input?: unknown;
  readonly state?: string;
}

/** Collection fact touched, loaded, or serialized during one request. */
export interface DevtoolsRequestTraceCollection {
  readonly name: string;
  readonly state?: string;
  readonly eventCount?: number;
}

/** Server function call observed during one request. */
export interface DevtoolsRequestTraceServerFunction {
  readonly name: string;
  readonly status?: DevtoolsRequestTraceStatus;
  readonly failureKind?: DevtoolsRequestTraceFailureKind;
}

/** Start Action call observed during one request. */
export interface DevtoolsRequestTraceAction {
  readonly name: string;
  readonly state?: string;
  readonly failureKind?: DevtoolsRequestTraceFailureKind;
  readonly invalidationIndexes?: ReadonlyArray<number>;
}

/** Fiber fact for work owned by a request runtime. */
export interface DevtoolsRequestTraceFiber {
  readonly name: string;
  readonly status: DevtoolsRequestTraceFiberStatus;
}

/** Stream fact for response or hydration streams owned by a request. */
export interface DevtoolsRequestTraceStream {
  readonly name: string;
  readonly state: DevtoolsRequestTraceStreamState;
  readonly chunkCount?: number;
}

/** Resource Store counts captured before or after request-runtime disposal. */
export interface DevtoolsRequestTraceTeardownSnapshot {
  readonly fiberCount: number;
  readonly familyCount: number;
  readonly moduleCount: number;
  readonly tagCount: number;
}

/** Request-runtime disposal facts used to detect leaks after streamed responses close. */
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

/**
 * Structural request trace contract consumed by Devtools.
 *
 * Start emits this shape without depending on `@effect-ui/devtools`; adapters
 * can record compatible traces when they preserve the same failure and teardown
 * semantics.
 */
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

/** Request-runtime store counts captured before or after teardown. */
export interface DevtoolsSummaryRequestTraceTeardownSnapshot {
  /** Live fibers visible in the request runtime store at the snapshot point. */
  readonly fiberCount: number;
  /** Registered resource families visible in the request runtime store. */
  readonly familyCount: number;
  /** Registered resource modules visible in the request runtime store. */
  readonly moduleCount: number;
  /** Registered resource tags visible in the request runtime store. */
  readonly tagCount: number;
}

/** Server-function activity summarized from one request trace. */
export interface DevtoolsSummaryRequestTraceServerFunction {
  readonly name: string;
  readonly status: DevtoolsRequestTraceStatus | null;
  readonly failureKind: DevtoolsRequestTraceFailureKind | null;
}

/** Action activity summarized from one request trace. */
export interface DevtoolsSummaryRequestTraceAction {
  readonly name: string;
  readonly state: string | null;
  readonly failureKind: DevtoolsRequestTraceFailureKind | null;
  readonly invalidationIndexes: ReadonlyArray<number>;
}

/** Request trace row used by summaries and panel UIs. */
export interface DevtoolsSummaryRequestTrace {
  /** Stable ordinal within the summary input. */
  readonly index: number;
  /** Request trace id emitted by the Start request runtime. */
  readonly id: string;
  /** HTTP method for the traced request. */
  readonly method: string;
  /** URL path without query string. */
  readonly path: string;
  /** Original request URL when available. */
  readonly url: string;
  /** Start transport seam that produced the trace. */
  readonly transport: DevtoolsRequestTraceTransport;
  /** Terminal request status. */
  readonly status: DevtoolsRequestTraceStatus;
  /** Normalized failure owner/category, when the request failed. */
  readonly failureKind: DevtoolsRequestTraceFailureKind | null;
  /** HTTP response status, when one was produced. */
  readonly responseStatus: number | null;
  /** Services provided to the request runtime. */
  readonly serviceCount: number;
  /** Resource refs touched by request preload/render work. */
  readonly resourceCount: number;
  /** Collection definitions touched by request preload/render work. */
  readonly collectionCount: number;
  /** Server functions invoked during this request. */
  readonly serverFunctionCount: number;
  /** Actions invoked during this request. */
  readonly actionCount: number;
  /** Fibers observed before teardown. */
  readonly fiberCount: number;
  /** Response streams tracked by the request runtime. */
  readonly streamCount: number;
  /** Whether request runtime disposal completed. */
  readonly runtimeDisposed: boolean | null;
  /** Disposal reason reported by the Start request runtime. */
  readonly teardownReason: string | null;
  /** Timestamp reported by older teardown emitters, when present. */
  readonly teardownAt: number | null;
  /** Teardown start timestamp emitted by Start request handlers. */
  readonly teardownStartedAt: number | null;
  /** Teardown completion timestamp emitted by Start request handlers. */
  readonly teardownCompletedAt: number | null;
  /** Elapsed time from request start to response/teardown when available. */
  readonly durationMillis: number | null;
  /** Resource Store snapshot before runtime disposal. */
  readonly beforeDispose: DevtoolsSummaryRequestTraceTeardownSnapshot | null;
  /** Resource Store snapshot after runtime disposal. */
  readonly afterDispose: DevtoolsSummaryRequestTraceTeardownSnapshot | null;
  /** Back-compat shortcut for `beforeDispose.fiberCount`. */
  readonly beforeDisposeFiberCount: number | null;
  /** Back-compat shortcut for `afterDispose.fiberCount`. */
  readonly afterDisposeFiberCount: number | null;
  /** Per-server-function request activity, including owner failure kind. */
  readonly serverFunctions: ReadonlyArray<DevtoolsSummaryRequestTraceServerFunction>;
  /** Per-action request activity, including owner failure kind and invalidations. */
  readonly actions: ReadonlyArray<DevtoolsSummaryRequestTraceAction>;
  /** Matched route href for SSR traces, when available. */
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
  /** Human-readable metric label. */
  readonly label: string;
  /** Metric value already projected for panel display. */
  readonly value: string | number;
  /** Optional unit suffix such as `ms`. */
  readonly unit?: string;
}

export interface DevtoolsPanelItem {
  /** Stable item id for DOM keys, routing, and snapshot tests. */
  readonly id: string;
  /** Human-readable primary label. */
  readonly label: string;
  /** Highest diagnostic severity represented by this item. */
  readonly severity: DevtoolsPanelSeverity;
  /** Optional short diagnostic text for the item. */
  readonly detail?: string;
  /** Small numeric/string facts rendered beside the item. */
  readonly metrics?: ReadonlyArray<DevtoolsPanelMetric>;
  /** JSON-safe structured detail for richer renderers and agents. */
  readonly data?: DevtoolsSerializableValue;
}

/** One ordered UI panel derived from a Devtools summary. */
export interface DevtoolsPanel {
  /** Stable panel id used by renderers, tests, and browser routing. */
  readonly id: DevtoolsPanelId;
  /** Human-readable panel title. */
  readonly title: string;
  /** One-line aggregate state for the panel. */
  readonly summary: string;
  /** Highest diagnostic severity represented by this panel. */
  readonly severity: DevtoolsPanelSeverity;
  /** Aggregate metrics for the whole panel. */
  readonly metrics: ReadonlyArray<DevtoolsPanelMetric>;
  /** Ordered diagnostic rows for the panel. */
  readonly items: ReadonlyArray<DevtoolsPanelItem>;
}

/** Complete JSON-safe panel model consumed by browser panels and agents. */
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

/** Projects snapshots, diagnostics, and runtime facts into stable panel data. */
export const describeDevtoolsPanels = (
  input: DevtoolsPanelsInput = {}
): DevtoolsPanels =>
  describeDevtoolsPanelsWithRuntime(input, devtoolsPanelsRuntime);

/** Effect wrapper for `describeDevtoolsPanels(...)`. */
export const describeDevtoolsPanelsEffect = (
  input: DevtoolsPanelsInput = {}
): Effect.Effect<DevtoolsPanels> =>
  Effect.succeed(describeDevtoolsPanels(input));

const resolveDevtoolsPanels = (input: DevtoolsPanelUiInput): DevtoolsPanels =>
  input.panels ?? describeDevtoolsPanels(input);

/** Renders the stable panel contract to deterministic embeddable HTML. */
export const renderDevtoolsPanelsHtml = (
  input: DevtoolsPanelUiInput = {}
): string =>
  renderDevtoolsPanelsHtmlWithResolver(input, resolveDevtoolsPanels);

/** Effect wrapper for deterministic panel HTML rendering. */
export const renderDevtoolsPanelsHtmlEffect = (
  input: DevtoolsPanelUiInput = {}
): Effect.Effect<string> =>
  Effect.succeed(renderDevtoolsPanelsHtml(input));

/** Mounts the panel renderer into a host DOM root and returns update/unmount controls. */
export const mountDevtoolsPanels = (
  options: DevtoolsPanelMountOptions
): DevtoolsPanelMount =>
  mountDevtoolsPanelsWithResolver(options, resolveDevtoolsPanels);

/** Scoped Effect mount helper that unmounts the panel renderer when the Scope closes. */
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

/** Creates a bounded, detached Devtools Store for snapshots, traces, panels, and causal graphs. */
export const makeDevtoolsStore = (options: DevtoolsStoreOptions = {}) =>
  makeDevtoolsStoreWithRuntime(options, devtoolsStoreRuntime);
