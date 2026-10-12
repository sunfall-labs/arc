import type { Route, Action, Resource, Timeline } from "@sunfall/arc-core";
import { Data, type Effect, type Fiber, type Scope, type Tracer } from "effect";

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
  /** Submission `AsyncResult` tag: `Initial`, `Success`, or `Failure`. */
  readonly state: string;
  /** Whether a submission is in flight. */
  readonly waiting?: boolean;
  readonly invalidationIndexes?: ReadonlyArray<number>;
}

/** Options for recording action state and optional invalidation metadata. */
export type DevtoolsRecordActionStateOptions = {
  readonly input?: unknown;
  /** Whether a submission is in flight (the `AsyncResult` `waiting` flag). */
  readonly waiting?: boolean;
} & (
  | {
      readonly invalidationPlan?: Resource.InvalidationPlan<any> | undefined;
      readonly serializedInvalidationPlan?: never;
    }
  | {
      readonly invalidationPlan?: never;
      readonly serializedInvalidationPlan?: DevtoolsInvalidationPlan | undefined;
    }
);

/** One signal change inside a detached Timeline commit. */
export interface DevtoolsTimelineChange {
  /** The signal's `Signal.make` name. */
  readonly signal: string;
  readonly previous: unknown;
  readonly next: unknown;
}

/** A Core `Timeline` entry detached into Devtools runtime history. */
export interface DevtoolsTimelineCommit {
  /** Sequence within the Timeline recording. */
  readonly sequence: number;
  /** `Timeline.describe(cause)`, e.g. `ProjectPage.rename`. */
  readonly label: string;
  /** The named transition or framework event that made the commit. */
  readonly cause: Timeline.Cause;
  readonly changes: ReadonlyArray<DevtoolsTimelineChange>;
}

/** Typed error thrown when callers provide both live and serialized invalidation plans. */
export class DevtoolsActionInvalidationPlanConflict extends Data.TaggedError(
  "DevtoolsActionInvalidationPlanConflict",
)<{
  readonly guidance: string;
}> {}

/**
 * JSON-safe copy of one ended Effect span, recorded by `Devtools.layerTracer`
 * or `store.recordSpan`. Start request spans (`sunfall-arc.start.request`)
 * carry the route plan, failure kind, response, stream, and teardown as
 * attributes; the Requests panel reads them from here.
 */
export interface DevtoolsSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: string;
  /** Span start, in epoch milliseconds. */
  readonly startTime: number;
  readonly durationMillis: number;
  readonly status: "success" | "failure" | "interrupted";
  readonly attributes: { readonly [key: string]: unknown };
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
      readonly event: Resource.StoreEvent;
    }
  | {
      readonly _tag: "TimelineCommit";
      readonly sequence?: number;
      readonly at?: number;
      readonly commit: DevtoolsTimelineCommit;
    }
  | {
      readonly _tag: "ActionState";
      readonly sequence?: number;
      readonly at?: number;
      readonly action: string;
      readonly state: string;
      readonly waiting?: boolean;
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
  readonly resources: ReadonlyArray<DevtoolsSnapshotResource>;
  readonly actions: ReadonlyArray<DevtoolsSnapshotAction>;
  readonly invalidations: ReadonlyArray<DevtoolsInvalidationPlan>;
  readonly routePlans: ReadonlyArray<DevtoolsRoutePlan>;
  readonly spans?: ReadonlyArray<DevtoolsSpan>;
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
  /** Maximum ended spans retained in snapshots. Defaults to 200. */
  readonly spanLimit?: number;
  /** Maximum runtime events retained in snapshots. Defaults to 500. */
  readonly eventLimit?: number;
  /** Serialization and redaction policy applied before runtime facts enter the store. */
  readonly serializationPolicy?: DevtoolsSerializationPolicy;
}

/**
 * Store returned by `makeDevtoolsStore`.
 *
 * Every method returns an Effect: snapshot reads/writes, invalidation plans, action state, route plans, resource
 * events, Timeline commits, spans, summaries,
 * panels, and causal graphs.
 * Values are copied or projected before storage so panel consumers do not
 * mutate live framework state. Fact-recording methods return the retained
 * snapshot index after store limits are applied, so later runtime events can
 * point at the exact retained fact they observed.
 */
export interface DevtoolsStore {
  /** Read the current detached fact snapshot. */
  readonly getSnapshot: () => Effect.Effect<DevtoolsSnapshot>;
  /** Replace all retained facts; inputs are copied and bounded before storage. */
  readonly setSnapshot: (next: DevtoolsSnapshot) => Effect.Effect<void>;
  /** Serialize and retain a live Resource invalidation plan, returning its retained index. */
  readonly recordInvalidation: (plan: Resource.InvalidationPlan) => Effect.Effect<number>;
  /** Retain an already-serialized invalidation plan, returning its retained index. */
  readonly recordSerializedInvalidation: (plan: DevtoolsInvalidationPlan) => Effect.Effect<number>;
  /** Record one action state transition, with optional input and invalidation plan facts. */
  readonly recordActionState: (
    action: string,
    state: string,
    actionOptions?: DevtoolsRecordActionStateOptions,
  ) => Effect.Effect<void, DevtoolsActionInvalidationPlanConflict>;
  /** Record an Action instance's current state and invalidation plan. */
  readonly recordAction: <I, A, E, R>(action: Action.Instance<I, A, E, R>) => Effect.Effect<void>;
  /** Records an Action instance's state changes until the scope closes. */
  readonly trackAction: <I, A, E, R>(
    action: Action.Instance<I, A, E, R>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  /** Serialize and retain a live route navigation plan, returning its retained index. */
  readonly recordRoutePlan: (plan: Route.NavigationPlan) => Effect.Effect<number>;
  /** Retain an already-serialized route plan, returning its retained index. */
  readonly recordSerializedRoutePlan: (plan: DevtoolsRoutePlan) => Effect.Effect<number>;
  /** Record a Core Resource Store event as a runtime event. */
  readonly recordResourceEvent: (event: Resource.StoreEvent) => Effect.Effect<void>;
  /** Record one Core `Timeline` entry as a runtime event. */
  readonly recordTimelineEntry: (entry: Timeline.Entry) => Effect.Effect<void>;
  /** Records a running `Timeline` recording's retained and future entries until the scope closes. */
  readonly trackTimeline: (
    recording: Timeline.Recording,
  ) => Effect.Effect<void, never, Scope.Scope>;
  /** Record a prebuilt runtime event, assigning sequence and serialization bounds. */
  readonly recordRuntimeEvent: (event: DevtoolsRuntimeEvent) => Effect.Effect<void>;
  /** Record one ended Effect span (what `Devtools.layerTracer` does for every span). */
  readonly recordSpan: (span: Tracer.Span) => Effect.Effect<void>;
  /** Project the current snapshot into summarized counts, tables, and runtime rows. */
  readonly getSummary: () => Effect.Effect<DevtoolsSummary>;
  /** Project the current snapshot into renderable panel data. */
  readonly getPanels: () => Effect.Effect<DevtoolsPanels>;
  /** Project the current snapshot into a stable causal graph. */
  readonly getCausalGraph: () => Effect.Effect<DevtoolsCausalGraph>;
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
  readonly sources: ReadonlyArray<"Invalidation" | "RoutePlan" | "RuntimeEvent" | "Snapshot">;
  readonly routeHrefs: ReadonlyArray<string>;
  readonly invalidationIndexes: ReadonlyArray<number>;
}

/** One Start request, projected from its `sunfall-arc.start.request` span. */
export interface DevtoolsSummaryRequest {
  readonly index: number;
  /** Request span id. */
  readonly id: string;
  readonly traceId: string;
  /** Start request id (`x-sunfall-arc-request-id`). */
  readonly requestId: string | null;
  readonly method: string;
  readonly path: string;
  /** Matched route path for SSR requests. */
  readonly route: string | null;
  /** Resource keys the SSR route plan preloaded. */
  readonly resources: ReadonlyArray<string>;
  readonly transport: string;
  readonly status: "success" | "failure" | "cancelled";
  readonly failureKind: string | null;
  readonly responseStatus: number | null;
  readonly durationMillis: number;
  readonly runtimeDisposed: boolean | null;
  /** Live fibers left after request runtime disposal; non-zero is a leak. */
  readonly fibersAfterDispose: number | null;
  /** Server-function and Action spans inside this request. */
  readonly children: ReadonlyArray<{
    readonly name: string;
    readonly status: DevtoolsSpan["status"];
  }>;
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
  | "Route"
  | "RoutePlan"
  | "Resource"
  | "Program"
  | "Action"
  | "InvalidationPlan"
  | "ResourceTag"
  | "RuntimeEvent";

/**
 * Stable relationship categories in the Devtools causal graph.
 *
 * `Matches` links route plans to matched routes. `Preloads` and `Hydrates` explain route/resource
 * loading. `Observes` links runtime events to the facts they
 * report.
 */
export type DevtoolsCausalEdgeKind =
  | "Matches"
  | "Preloads"
  | "Hydrates"
  | "Targets"
  | "Invalidates"
  | "Causes"
  | "Emits"
  | "Observes";

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
    readonly runtimeResourceCount: number;
    readonly runtimeActionCount: number;
    readonly invalidationPlanCount: number;
    readonly routePlanCount: number;
    readonly requestCount: number;
    readonly spanCount: number;
    readonly runtimeEventCount: number;
    readonly notFoundRoutePlanCount: number;
    readonly causalNodeCount: number;
    readonly causalEdgeCount: number;
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
  readonly requests: ReadonlyArray<DevtoolsSummaryRequest>;
  readonly resources: ReadonlyArray<DevtoolsSummaryResource>;
  readonly causalGraph: DevtoolsCausalGraph;
}

/** Input accepted by summary projection helpers. */
export interface DevtoolsSummaryInput {
  readonly snapshot?: DevtoolsSnapshot;
  readonly invalidations?: ReadonlyArray<DevtoolsInvalidationPlan>;
  readonly routePlans?: ReadonlyArray<DevtoolsRoutePlan>;
  readonly spans?: ReadonlyArray<DevtoolsSpan>;
  readonly runtimeEvents?: ReadonlyArray<DevtoolsRuntimeEvent>;
}

/**
 * Stable id for a rendered Devtools panel.
 *
 * Panel ids are used by the HTML renderer, extension UI, selected-panel state,
 * and snapshot tests, so custom shells should treat them as durable keys.
 */
export type DevtoolsPanelId =
  | "routes"
  | "resources"
  | "actions"
  | "programs"
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

/** Running Devtools panel boot fiber plus its host interrupt hook. */
export interface DevtoolsPanelBoot {
  /** Fiber that owns the scoped panel mount and any post-mount work. */
  readonly fiber: Fiber.Fiber<void, never>;
  /** Interrupts the boot fiber and releases the panel mount Scope (host page lifecycle handlers). */
  readonly interrupt: () => void;
}
