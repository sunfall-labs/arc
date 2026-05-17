import {
  type ActionInstance,
  type ActionSubmissionState,
  type ProgramEvent,
  type ProgramInstance,
  type ReadableSignal,
  type ResourceInvalidationPlan,
  type ResourceStoreEvent,
  type Route,
} from "@sunfall/arc-core";
import { Data, type Effect, type Fiber, type Scope } from "effect";

/**
 * JSON-safe value shape used by Devtools DTOs.
 *
 * Unknown runtime payloads are serialized through the Devtools Serialization
 * Policy before they enter this contract, so panel renderers and extension
 * bridges can treat these values as detached data.
 */
export type DevtoolsSerializableValue =
  | null
  | boolean
  | number
  | string
  | readonly DevtoolsSerializableValue[]
  | { readonly [key: string]: DevtoolsSerializableValue };

/**
 * Stable resource or tag target captured in a serialized invalidation plan.
 *
 * `input` is intentionally `unknown` at the public seam; serializers detach it
 * before Devtools stores or renders the plan.
 */
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

/** Stable resource or tag cause that explains why an invalidation target exists. */
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

/**
 * Serialized invalidation plan shown by summaries, panels, and causal graphs.
 *
 * `targets` is the user-facing invalidation set. `entries` preserves the
 * resource-level cause graph used to derive causal edges. Resource inputs stay
 * `unknown` at the raw snapshot boundary and are encoded before panel output.
 */
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

/**
 * Serializable route navigation plan used by Devtools route panels.
 *
 * `params`, `search`, and resource inputs stay `unknown` because Start/Core own
 * the domain schemas; Devtools owns detached inspection data.
 */
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
    readonly resourceKeys?: ReadonlyArray<string>;
  };
}

/** Resource snapshot fact recorded by the Devtools Store. */
export interface DevtoolsSnapshotResource {
  readonly key: string;
  readonly state: string;
}

/** Action state fact recorded by the Devtools Store. */
export interface DevtoolsSnapshotAction {
  readonly name: string;
  readonly state: string;
  readonly invalidationIndexes?: ReadonlyArray<number>;
}

/** Options for recording action state and optional invalidation metadata. */
export type DevtoolsRecordActionStateOptions = {
  readonly input?: unknown;
} & (
  | {
      readonly invalidationPlan?: ResourceInvalidationPlan<any> | undefined;
      readonly serializedInvalidationPlan?: never;
    }
  | {
      readonly invalidationPlan?: never;
      readonly serializedInvalidationPlan?: DevtoolsInvalidationPlan | undefined;
    }
);

/** Minimal Start action instance shape that Devtools can track. */
export interface DevtoolsStartActionInstance<
  I = unknown,
  A = unknown,
  E = unknown,
  P = DevtoolsInvalidationPlan,
> {
  readonly definition: {
    readonly name: string;
  };
  readonly state: ReadableSignal<ActionSubmissionState<I, A, E, P>>;
  readonly invalidation: ReadableSignal<DevtoolsInvalidationPlan | undefined>;
}

/** Collection event DTO mirrored from the DB Collection Store for Devtools panels. */
export type DevtoolsCollectionStoreEvent =
  | {
      readonly _tag: "CollectionLoaded";
      readonly collection: string;
      readonly count: number;
      readonly updatedAt: number;
    }
  | { readonly _tag: "CollectionLoadFailure"; readonly collection: string; readonly error: unknown }
  | {
      readonly _tag: "CollectionHydrated";
      readonly collection: string;
      readonly count: number;
      readonly updatedAt: number;
    }
  | {
      readonly _tag: "CollectionPersisted";
      readonly collection: string;
      readonly key: string;
      readonly count: number;
    }
  | {
      readonly _tag: "CollectionRestored";
      readonly collection: string;
      readonly key: string;
      readonly count: number;
    }
  | {
      readonly _tag: "CollectionMutationQueued";
      readonly collection: string;
      readonly transaction: string;
      readonly mutations: number;
      readonly pending: number;
    }
  | {
      readonly _tag: "CollectionMutateStarted";
      readonly collection: string;
      readonly transaction: string;
      readonly mutations: number;
    }
  | {
      readonly _tag: "CollectionMutationDequeued";
      readonly collection: string;
      readonly transaction: string;
      readonly pending: number;
    }
  | {
      readonly _tag: "CollectionMutateCommitted";
      readonly collection: string;
      readonly transaction: string;
      readonly mutations: number;
    }
  | {
      readonly _tag: "CollectionMutateRolledBack";
      readonly collection: string;
      readonly transaction: string;
      readonly error: unknown;
    }
  | {
      readonly _tag: "CollectionChangeFeedFailure";
      readonly collection: string;
      readonly error: unknown;
    }
  | { readonly _tag: "CollectionWritten"; readonly collection: string; readonly mutations: number };

/** Typed Program timeline event detached into Devtools runtime history. */
export type DevtoolsProgramEvent = ProgramEvent<unknown, unknown, unknown>;

/** Transport family that produced a request trace. */
export type DevtoolsRequestTraceTransport = "ssr" | "rpc" | "action" | "unknown";
/** Final request trace status. */
export type DevtoolsRequestTraceStatus = "success" | "failure" | "cancelled";
/** High-level failure category used by request trace panels. */
export type DevtoolsRequestTraceFailureKind =
  | "domain"
  | "validation"
  | "protocol"
  | "transport"
  | "defect"
  | "interruption";
/** Streaming response lifecycle state. */
export type DevtoolsRequestTraceStreamState = "open" | "closed" | "cancelled" | "errored";
/** Request-runtime fiber lifecycle state. */
export type DevtoolsRequestTraceFiberStatus = "running" | "done" | "interrupted" | "failed";

/** Typed error thrown when callers provide both live and serialized invalidation plans. */
export class DevtoolsActionInvalidationPlanConflict extends Data.TaggedError(
  "DevtoolsActionInvalidationPlanConflict",
)<{
  readonly guidance: string;
}> {}

/** Header captured for request inspection; Devtools serialization redacts sensitive names and values before storage/projection. */
export interface DevtoolsRequestTraceHeader {
  readonly name: string;
  readonly value: string;
}

/** Cookie fact captured for request inspection; Devtools serialization redacts values and sensitive names before storage/projection. */
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

/** Best-effort request-runtime cleanup failure summary emitted by Start traces. */
export interface DevtoolsRequestTraceCleanupFailure {
  readonly _tag: "Failure" | "Defect" | "Interruption";
  readonly message: string;
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
  readonly cleanupFailure?: DevtoolsRequestTraceCleanupFailure;
}

/**
 * Structural request trace contract consumed by Devtools.
 *
 * Start emits this shape without depending on `@sunfall/arc-devtools`; adapters
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

/**
 * Bounded runtime fact recorded by the Devtools Store.
 *
 * `sequence` is store-assigned when absent. Payload-bearing variants are copied
 * through the serialization policy before summaries or panels observe them.
 */
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
      readonly _tag: "ProgramEvent";
      readonly sequence?: number;
      readonly at?: number;
      readonly event: DevtoolsProgramEvent;
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
      /** Index of the matching invalidation fact in the snapshot, when known. */
      readonly invalidationIndex?: number;
      readonly plan: DevtoolsInvalidationPlan;
    }
  | {
      readonly _tag: "RoutePlan";
      readonly sequence?: number;
      readonly at?: number;
      /** Index of the matching route-plan fact in the snapshot, when known. */
      readonly routePlanIndex?: number;
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

/**
 * Raw detached Devtools facts recorded by framework packages or app code.
 *
 * Snapshot fields may include `unknown` inspection data owned by Core, Start,
 * DB, or the host app. Devtools summaries, panels, causal graphs, and bridge
 * payloads project those facts into JSON-safe values before rendering.
 */
export interface DevtoolsSnapshot {
  readonly appGraph?: DevtoolsStartAppGraphDiagnostics;
  readonly resources: ReadonlyArray<DevtoolsSnapshotResource>;
  readonly actions: ReadonlyArray<DevtoolsSnapshotAction>;
  readonly invalidations: ReadonlyArray<DevtoolsInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsRoutePlan>;
  readonly requestTraces?: ReadonlyArray<DevtoolsRequestTrace>;
  readonly events?: ReadonlyArray<DevtoolsRuntimeEvent>;
}

/** Controls how unknown runtime values are projected into JSON-safe Devtools data. */
export interface DevtoolsSerializationPolicy {
  /** Maximum object/array nesting depth before values become a `MaxDepth` marker. */
  readonly maxDepth?: number;
  /** Maximum entries copied from arrays, maps, sets, and plain records. */
  readonly maxEntries?: number;
  /** Maximum string length before values become a `TruncatedString` marker. */
  readonly maxStringLength?: number;
  /** Record keys that should be replaced by a `Redacted` marker before storage or rendering. */
  readonly redactKeys?: ReadonlyArray<string | RegExp>;
}

/** Limits applied by the bounded in-memory Devtools Store. */
export interface DevtoolsStoreOptions {
  /** Maximum invalidation plans retained in snapshots. Defaults to 50. */
  readonly invalidationLimit?: number;
  /** Maximum route plans retained in snapshots. Defaults to 50. */
  readonly routePlanLimit?: number;
  /** Maximum request traces retained in snapshots. Defaults to 50. */
  readonly requestTraceLimit?: number;
  /** Maximum runtime events retained in snapshots. Defaults to 500. */
  readonly eventLimit?: number;
  /** Serialization and redaction policy applied before runtime facts enter the store. */
  readonly serializationPolicy?: DevtoolsSerializationPolicy;
}

/**
 * Store returned by `makeDevtoolsStore`.
 *
 * Provides synchronous and Effect variants for snapshot reads/writes, app graph
 * diagnostics, invalidation plans, action state, route plans, resource and
 * collection events, Program timeline events, request traces, summaries,
 * panels, and causal graphs.
 * Values are copied or projected before storage so panel consumers do not
 * mutate live framework state. Fact-recording methods return the retained
 * snapshot index after store limits are applied, so later runtime events can
 * point at the exact retained fact they observed.
 */
export interface DevtoolsStore {
  /** Read the current detached fact snapshot synchronously at host/UI boundaries. */
  readonly getSnapshot: () => DevtoolsSnapshot;
  /** Read the current detached fact snapshot inside Effect workflows. */
  readonly getSnapshotEffect: () => Effect.Effect<DevtoolsSnapshot>;
  /** Replace all retained facts; inputs are copied and bounded before storage. */
  readonly setSnapshot: (next: DevtoolsSnapshot) => void;
  /** Effect variant of `setSnapshot(...)`. */
  readonly setSnapshotEffect: (next: DevtoolsSnapshot) => Effect.Effect<void>;
  /** Store the latest static Start app-graph diagnostics used by summaries and panels. */
  readonly setAppGraphDiagnostics: (appGraph: DevtoolsStartAppGraphDiagnostics) => void;
  /** Effect variant of `setAppGraphDiagnostics(...)`. */
  readonly setAppGraphDiagnosticsEffect: (
    appGraph: DevtoolsStartAppGraphDiagnostics,
  ) => Effect.Effect<void>;
  /** Remove stored app-graph diagnostics without clearing runtime facts. */
  readonly clearAppGraphDiagnostics: () => void;
  /** Effect variant of `clearAppGraphDiagnostics(...)`. */
  readonly clearAppGraphDiagnosticsEffect: () => Effect.Effect<void>;
  /** Serialize and retain a live Resource invalidation plan, returning its retained index. */
  readonly recordInvalidation: (plan: ResourceInvalidationPlan) => number;
  /** Effect variant of `recordInvalidation(...)`. */
  readonly recordInvalidationEffect: (plan: ResourceInvalidationPlan) => Effect.Effect<number>;
  /** Retain an already-serialized invalidation plan, returning its retained index. */
  readonly recordSerializedInvalidation: (plan: DevtoolsInvalidationPlan) => number;
  /** Effect variant of `recordSerializedInvalidation(...)`. */
  readonly recordSerializedInvalidationEffect: (
    plan: DevtoolsInvalidationPlan,
  ) => Effect.Effect<number>;
  readonly recordActionState: (
    action: string,
    state: string,
    actionOptions?: DevtoolsRecordActionStateOptions,
  ) => void;
  readonly recordActionStateEffect: (
    action: string,
    state: string,
    actionOptions?: DevtoolsRecordActionStateOptions,
  ) => Effect.Effect<void, DevtoolsActionInvalidationPlanConflict>;
  readonly recordAction: <I, A, E, R>(action: ActionInstance<I, A, E, R>) => void;
  readonly recordActionEffect: <I, A, E, R>(
    action: ActionInstance<I, A, E, R>,
  ) => Effect.Effect<void>;
  readonly trackActionEffect: <I, A, E, R>(
    action: ActionInstance<I, A, E, R>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly recordStartAction: <I, A, E, P>(action: DevtoolsStartActionInstance<I, A, E, P>) => void;
  readonly recordStartActionEffect: <I, A, E, P>(
    action: DevtoolsStartActionInstance<I, A, E, P>,
  ) => Effect.Effect<void>;
  readonly trackStartActionEffect: <I, A, E, P>(
    action: DevtoolsStartActionInstance<I, A, E, P>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly recordRoutePlan: (plan: Route.NavigationPlan) => number;
  /** Effect variant of `recordRoutePlan(...)`. */
  readonly recordRoutePlanEffect: (plan: Route.NavigationPlan) => Effect.Effect<number>;
  /** Retain an already-serialized route plan, returning its retained index. */
  readonly recordSerializedRoutePlan: (plan: DevtoolsRoutePlan) => number;
  /** Effect variant of `recordSerializedRoutePlan(...)`. */
  readonly recordSerializedRoutePlanEffect: (plan: DevtoolsRoutePlan) => Effect.Effect<number>;
  /** Record a Core Resource Store event as a runtime event. */
  readonly recordResourceEvent: (event: ResourceStoreEvent) => void;
  /** Effect variant of `recordResourceEvent(...)`. */
  readonly recordResourceEventEffect: (event: ResourceStoreEvent) => Effect.Effect<void>;
  /** Record a DB Collection Store event as a runtime event. */
  readonly recordCollectionEvent: (event: DevtoolsCollectionStoreEvent) => void;
  /** Effect variant of `recordCollectionEvent(...)`. */
  readonly recordCollectionEventEffect: (
    event: DevtoolsCollectionStoreEvent,
  ) => Effect.Effect<void>;
  /** Record one Core Program timeline event as a runtime event. */
  readonly recordProgramEvent: <Model, Message, E>(event: ProgramEvent<Model, Message, E>) => void;
  /** Effect variant of `recordProgramEvent(...)`. */
  readonly recordProgramEventEffect: <Model, Message, E>(
    event: ProgramEvent<Model, Message, E>,
  ) => Effect.Effect<void>;
  readonly trackProgramEffect: <Model, Message, E>(
    program: ProgramInstance<Model, Message, E>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  /** Record a prebuilt runtime event, assigning sequence and serialization bounds. */
  readonly recordRuntimeEvent: (event: DevtoolsRuntimeEvent) => void;
  /** Effect variant of `recordRuntimeEvent(...)`. */
  readonly recordRuntimeEventEffect: (event: DevtoolsRuntimeEvent) => Effect.Effect<void>;
  /** Record one structural request trace and normalize its fact identity. */
  readonly recordRequestTrace: (trace: DevtoolsRequestTrace) => void;
  /** Effect variant of `recordRequestTrace(...)`. */
  readonly recordRequestTraceEffect: (trace: DevtoolsRequestTrace) => Effect.Effect<void>;
  /** Project the current snapshot into summarized counts, tables, and runtime rows. */
  readonly getSummary: () => DevtoolsSummary;
  /** Effect variant of `getSummary(...)`. */
  readonly getSummaryEffect: () => Effect.Effect<DevtoolsSummary>;
  /** Project the current snapshot into renderable panel data. */
  readonly getPanels: () => DevtoolsPanels;
  /** Effect variant of `getPanels(...)`. */
  readonly getPanelsEffect: () => Effect.Effect<DevtoolsPanels>;
  /** Project the current snapshot into a stable causal graph. */
  readonly getCausalGraph: () => DevtoolsCausalGraph;
  /** Effect variant of `getCausalGraph(...)`. */
  readonly getCausalGraphEffect: () => Effect.Effect<DevtoolsCausalGraph>;
}

/** Count of contracts with input, output, and error schemas in a Start app graph. */
export interface DevtoolsStartAppGraphSchemaCoverage {
  readonly total: number;
  readonly input: number;
  readonly output: number;
  readonly error: number;
}

/** Server function or action missing at least one wire schema. */
export interface DevtoolsStartAppGraphMissingSchema {
  readonly kind: "serverFunction" | "action";
  readonly name: string;
  readonly input: boolean;
  readonly output: boolean;
  readonly error: boolean;
}

/** Whether a graph feature is present, absent, or unknown until runtime. */
export type DevtoolsStartAppGraphFeaturePresence = "present" | "absent" | "unknown";
/** Static module boundary kind discovered by Start manifests. */
export type DevtoolsStartAppGraphModuleKind = "server-only" | "contract" | "shared";
/** Whether an action behavior was statically described. */
export type DevtoolsStartAppGraphActionBehaviorPresence = "present" | "absent" | "unknown";
/** Action concurrency policy projected into Devtools diagnostics. */
export type DevtoolsStartAppGraphActionConcurrency = "latest" | "parallel" | "exhaust" | "unknown";
/** Route preload-resource diagnostic status. */
export type DevtoolsStartAppGraphRoutePreloadResourceStatus = "declared" | "none" | "unknown";
/** Route preload-collection diagnostic status. */
export type DevtoolsStartAppGraphRoutePreloadCollectionStatus = "declared" | "none" | "unknown";

/** Resource preload declarations projected from Start route diagnostics. */
export interface DevtoolsStartAppGraphRoutePreloadResources {
  readonly status: DevtoolsStartAppGraphRoutePreloadResourceStatus;
  readonly families: readonly string[];
}

/** Collection preload declarations projected from Start route diagnostics. */
export interface DevtoolsStartAppGraphRoutePreloadCollections {
  readonly status: DevtoolsStartAppGraphRoutePreloadCollectionStatus;
  readonly collections: readonly string[];
}

/** Route module diagnostics projected from the Start app graph. */
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

/** Wire schema completeness diagnostics for one action/server-function contract. */
export interface DevtoolsStartAppGraphWireDiagnostics {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
  readonly complete: boolean;
  readonly missing: readonly ("input" | "output" | "error")[];
}

/** Server function graph diagnostics projected for Devtools panels. */
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

/** Static action behavior diagnostics projected for Devtools panels. */
export interface DevtoolsStartAppGraphActionBehavior {
  readonly invalidates: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly optimistic: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly retry: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly concurrency: DevtoolsStartAppGraphActionConcurrency;
}

/** Action graph diagnostics projected for Devtools panels. */
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

/** Resource family diagnostics projected for Devtools panels. */
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

/** Resource tag diagnostics projected for Devtools panels. */
export interface DevtoolsStartAppGraphResourceTagDiagnostics {
  readonly name: string;
  readonly keyed: boolean;
}

/** Collection definition diagnostics projected for Devtools panels. */
export interface DevtoolsStartAppGraphCollectionDiagnostics {
  readonly name: string;
  /**
   * True for derived/live-query collections that reject direct writes.
   *
   * Optional only for legacy Start app-graph DTO input; devtools normalization
   * fills missing values as `false`.
   */
  readonly readOnly?: boolean;
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

/** Action whose behavior policy could not be fully described statically. */
export interface DevtoolsStartAppGraphUnknownActionBehaviorEntry {
  readonly kind: "action";
  readonly name: string;
  readonly invalidates: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly optimistic: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly retry: DevtoolsStartAppGraphActionBehaviorPresence;
  readonly concurrency: DevtoolsStartAppGraphActionConcurrency;
}

/** Route whose resource preload policy remains unknown after app graph analysis. */
export interface DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: DevtoolsStartAppGraphFeaturePresence;
  readonly preloadResources: DevtoolsStartAppGraphRoutePreloadResources;
}

/** Route whose collection preload policy remains unknown after app graph analysis. */
export interface DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: DevtoolsStartAppGraphFeaturePresence;
  readonly preloadCollections: DevtoolsStartAppGraphRoutePreloadCollections;
}

/**
 * Runtime-aware Start app graph diagnostics projected for devtools.
 *
 * This summarizes generated route modules, server functions, actions,
 * resources, collections, endpoint paths, module boundaries, schema coverage,
 * and policy unknowns. It is a diagnostic data contract, not the executable app
 * graph itself.
 */
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

/** Stable resource reference used by summaries, routes, and invalidation plans. */
export interface DevtoolsSummaryResourceRef {
  readonly key: string;
  readonly family: string;
  readonly input: DevtoolsSerializableValue;
}

/** Resource or tag target selected by an invalidation plan. */
export type DevtoolsSummaryInvalidationTarget =
  | (DevtoolsSummaryResourceRef & {
      readonly _tag: "Ref";
    })
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

/** Resource or tag cause that matched an invalidation target. */
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

/** Summarized invalidation plan with matched resources and causes. */
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

/** Summarized navigation plan with route params, search, and hydration facts. */
export interface DevtoolsSummaryRoutePlan {
  readonly index: number;
  readonly _tag: "Matched" | "NotFound";
  readonly href: string;
  readonly path: string | null;
  readonly params: DevtoolsSerializableValue | null;
  readonly search: DevtoolsSerializableValue | null;
  readonly resourceCount: number;
  readonly hydrationResourceCount: number;
  readonly hydratedResourceKeys: ReadonlyArray<string>;
  readonly resources: ReadonlyArray<DevtoolsSummaryResourceRef>;
}

/** Resource summary row merged from snapshots, route plans, traces, and events. */
export interface DevtoolsSummaryResource {
  readonly key: string;
  readonly family: string | null;
  readonly input: DevtoolsSerializableValue | null;
  readonly state: string | null;
  readonly sources: ReadonlyArray<
    "Invalidation" | "RequestTrace" | "RoutePlan" | "RuntimeEvent" | "Snapshot"
  >;
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
  /** Bounded cleanup failure summary when request-runtime disposal failed. */
  readonly cleanupFailure: DevtoolsRequestTraceCleanupFailure | null;
  /** Per-server-function request activity, including owner failure kind. */
  readonly serverFunctions: ReadonlyArray<DevtoolsSummaryRequestTraceServerFunction>;
  /** Per-action request activity, including owner failure kind and invalidations. */
  readonly actions: ReadonlyArray<DevtoolsSummaryRequestTraceAction>;
  /** Matched route href for SSR traces, when available. */
  readonly routeHref: string | null;
}

/**
 * Runtime-event row projected for summaries and panels.
 *
 * `target` links the event to a stable Devtools fact id when identity can be
 * derived; `data` is already JSON-safe and detached from caller-owned objects.
 */
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
        readonly kind: "Program";
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
  /** Summarized invalidation facts carried by runtime-only invalidation events. */
  readonly invalidationPlan?: DevtoolsSummaryInvalidationPlan;
  /** Summarized route facts carried by runtime-only route-plan events. */
  readonly routePlan?: DevtoolsSummaryRoutePlan;
  readonly data: DevtoolsSerializableValue;
}

/**
 * Stable node categories in the Devtools causal graph.
 *
 * Node ids come from the Devtools Graph Identity Module and are stable across
 * summaries for the same underlying route, resource, action, event, or module.
 */
export type DevtoolsCausalNodeKind =
  | "RequestTrace"
  | "Route"
  | "RoutePlan"
  | "Resource"
  | "ResourceFamily"
  | "Collection"
  | "Program"
  | "Action"
  | "InvalidationPlan"
  | "ResourceTag"
  | "SchemaCoverage"
  | "MissingSchema"
  | "RuntimeEvent"
  | "Endpoint"
  | "Module"
  | "ServerFunction";

/**
 * Stable relationship categories in the Devtools causal graph.
 *
 * `Records` links request traces to observed facts. `Matches` links route
 * plans to matched routes. `Preloads` and `Hydrates` explain route/resource or
 * route/collection loading. `Observes` links runtime events to the facts they
 * report. `Covers` and `MissingSchema` describe schema diagnostics, while
 * `UsesEndpoint` and `UsesModule` describe app graph structure.
 */
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

/** One stable fact node in a Devtools causal graph. */
export interface DevtoolsCausalNode {
  /** Stable graph id such as `route:/projects/:id` or `resource:<key>`. */
  readonly id: string;
  /** Node category used by renderers and agents. */
  readonly kind: DevtoolsCausalNodeKind;
  /** Human-readable label for graph UIs. */
  readonly label: string;
  /** JSON-safe detail payload for richer renderers and agents. */
  readonly data: DevtoolsSerializableValue;
}

/** One directed causal relationship between two graph nodes. */
export interface DevtoolsCausalEdge {
  /** Stable edge id derived from kind, source, target, label, and duplicate ordinal. */
  readonly id: string;
  /** Relationship category. */
  readonly kind: DevtoolsCausalEdgeKind;
  /** Source node id. */
  readonly source: string;
  /** Target node id. */
  readonly target: string;
  /** Human-readable relationship label. */
  readonly label: string;
  /** JSON-safe detail payload for the relationship. */
  readonly data: DevtoolsSerializableValue;
}

/** Complete Devtools causal graph projected from summaries and runtime facts. */
export interface DevtoolsCausalGraph {
  readonly version: 1;
  readonly nodes: ReadonlyArray<DevtoolsCausalNode>;
  readonly edges: ReadonlyArray<DevtoolsCausalEdge>;
}

/** Summary projection used by Devtools panels and causal graph generation. */
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

/** Input accepted by summary projection helpers. */
export interface DevtoolsSummaryInput {
  readonly snapshot?: DevtoolsSnapshot;
  readonly appGraph?: DevtoolsStartAppGraphDiagnostics;
  readonly invalidations?: ReadonlyArray<DevtoolsInvalidationPlan>;
  readonly routePlans?: ReadonlyArray<DevtoolsRoutePlan>;
  readonly requestTraces?: ReadonlyArray<DevtoolsRequestTrace>;
  readonly runtimeEvents?: ReadonlyArray<DevtoolsRuntimeEvent>;
}

/**
 * Stable id for a rendered Devtools panel.
 *
 * Panel ids are used by the HTML renderer, extension UI, selected-panel state,
 * and snapshot tests, so custom shells should treat them as durable keys.
 */
export type DevtoolsPanelId =
  | "app-graph"
  | "routes"
  | "resources"
  | "actions"
  | "programs"
  | "collections"
  | "requests"
  | "diagnostics"
  | "causal-graph";

/** Highest diagnostic level represented by a panel, row, or metric group. */
export type DevtoolsPanelSeverity = "ok" | "info" | "warning" | "error";

/** Small scalar fact displayed in a Devtools panel or panel item. */
export interface DevtoolsPanelMetric {
  /** Human-readable metric label. */
  readonly label: string;
  /** Metric value already projected for panel display. */
  readonly value: string | number;
  /** Optional unit suffix such as `ms`. */
  readonly unit?: string;
}

/** One row in a Devtools panel, with optional metrics and structured detail. */
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

/** JSON-safe panel model consumed by browser panels and agents. Runtime guards normalize it to the complete public panel catalog. */
export interface DevtoolsPanels {
  readonly version: 1;
  readonly panels: ReadonlyArray<DevtoolsPanel>;
}

/** Input accepted by panel projection helpers. */
export interface DevtoolsPanelsInput extends DevtoolsSummaryInput {
  readonly summary?: DevtoolsSummary;
}

/** Rendering options shared by Devtools HTML and mount helpers. */
export interface DevtoolsPanelUiOptions {
  /** Page or widget title. Defaults to the built-in Sunfall Arc Devtools title. */
  readonly title?: string;
  /** Panel selected on first render or update. Defaults to the first panel. */
  readonly selectedPanelId?: DevtoolsPanelId;
  /** Maximum diagnostic rows rendered in each panel. */
  readonly maxItemsPerPanel?: number;
  /** Whether to include the built-in CSS when rendering HTML. */
  readonly includeStyles?: boolean;
}

/** Input accepted by HTML rendering and mount/update panel helpers. */
export interface DevtoolsPanelUiInput extends DevtoolsPanelsInput, DevtoolsPanelUiOptions {
  readonly panels?: DevtoolsPanels;
}

/** Options for mounting a live Devtools panel UI into an existing DOM node. */
export interface DevtoolsPanelMountOptions extends DevtoolsPanelUiInput {
  /** DOM element that receives the rendered Devtools panel markup. */
  readonly root: HTMLElement;
}

/** Handle returned by Devtools panel mount helpers. */
export interface DevtoolsPanelMount {
  /** Root DOM element managed by the mount. */
  readonly root: HTMLElement;
  /** Re-render with merged panel input; omitted fields keep the current mount input after the initial defaults are applied. */
  readonly update: (input?: DevtoolsPanelUiInput) => void;
  /** Remove rendered markup and release the mount. */
  readonly unmount: () => void;
}

/** Options for booting a scoped Devtools panel entrypoint. */
export interface DevtoolsPanelBootOptions extends DevtoolsPanelMountOptions {
  /**
   * Additional scoped work to start after the panel is mounted, such as polling
   * an inspected browser window for live panel payloads.
   */
  readonly afterMount?: (mount: DevtoolsPanelMount) => Effect.Effect<void, never, Scope.Scope>;
  /**
   * Window whose page lifecycle should interrupt the panel fiber. Pass the host
   * window from browser or extension entrypoints.
   */
  readonly lifecycleWindow?: Pick<Window, "addEventListener" | "removeEventListener">;
}

/** Running Devtools panel boot fiber plus its Effect-first interrupt hook. */
export interface DevtoolsPanelBoot {
  /** Fiber that owns the scoped panel mount and any post-mount work. */
  readonly fiber: Fiber.Fiber<void, never>;
  /** Interrupts the boot fiber and releases the panel mount Scope. */
  readonly interruptEffect: Effect.Effect<void>;
  /** Host callback facade for page lifecycle handlers. */
  readonly interrupt: () => void;
}
