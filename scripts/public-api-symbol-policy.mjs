export const publicHoverDocGroups = [
  {
    file: "packages/core/src/action-submission.ts",
    declarations: ["ActionState"],
  },
  {
    file: "packages/core/src/action.ts",
    declarations: [
      "ActionTypeId",
      "ActionConcurrency",
      "ActionPolicy",
      "ActionDefinition",
      "ActionOptions",
      "ActionInstance",
      "ActionUseOptions",
      "isActionDefinition",
      "Action",
    ],
    namespaceDeclarations: {
      Action: [
        "Definition",
        "Instance",
        "State",
        "Concurrency",
        "Policy",
        "OptimisticTransaction",
        "OptimisticChange",
        "DurablePolicy",
        "OutboxOptions",
        "Outbox",
        "outboxLayer",
        "outbox",
        "restoreOutbox",
        "planOptimistic",
      ],
    },
  },
  {
    file: "packages/core/src/action-result.ts",
    declarations: [
      "ActionResultTypeId",
      "ActionRedirectStatus",
      "ActionResultOptions",
      "ActionResultRedirectOptions",
      "ActionResultValidationInput",
      "ActionResultBase",
      "ActionResultSuccess",
      "ActionResultValidationFailure",
      "ActionResultRedirect",
      "ActionResultFailure",
      "ActionResultBoundary",
      "AnyActionResult",
      "ActionResultInvalidationRequirements",
      "ActionResultMatch",
    ],
    allDeclarations: ["ActionResult"],
  },
  {
    file: "packages/core/src/capability.ts",
    declarations: ["CapabilityTypeId", "isCapability"],
    allDeclarations: ["Capability"],
    namespaceDeclarations: {
      Capability: ["Any", "Shape", "Identifier", "define", "layer", "mock", "provide"],
    },
  },
  {
    file: "packages/core/src/form.ts",
    declarations: [
      "FormTypeId",
      "FormFieldKey",
      "FormFieldFlags",
      "FormFieldErrors",
      "FormSchemaValues",
      "FormSchemaServices",
      "FormValidationTools",
      "FormStatus",
      "FormState",
      "FormOptions",
      "FormDataFileMode",
      "FormDataDecodeOptions",
      "FormInstance",
      "FormValidationError",
      "isForm",
    ],
    allDeclarations: ["Form"],
    namespaceDeclarations: {
      Form: [
        "FieldKey",
        "FieldFlags",
        "FieldErrors",
        "Status",
        "State",
        "Instance",
        "ValidationTools",
        "ValidationError",
        "DataFileMode",
        "DataOptions",
        "error",
        "fieldError",
        "make",
      ],
    },
  },
  {
    file: "packages/core/src/program.ts",
    declarations: ["Program", "ProgramStartOptions"],
    namespaceDeclarations: {
      Program: [
        "Definition",
        "Instance",
        "Failure",
        "RuntimeError",
        "StartOptions",
        "TaggedMessage",
        "HandlerMap",
        "RuntimeRemainingRequirements",
        "Phase",
        "Update",
        "Step",
        "Command",
        "CommandInput",
        "Subscription",
        "SubscriptionInput",
        "define",
        "step",
        "emit",
      ],
    },
  },
  {
    file: "packages/core/src/runtime.ts",
    declarations: [
      "RuntimeTypeId",
      "RuntimeDisposeError",
      "AnySunfallArcRuntime",
      "SunfallArcRuntime",
      "RuntimeProvideOptions",
      "RuntimeSource",
      "isSunfallArcRuntime",
      "makeRuntime",
      "withResourceStore",
      "defaultRuntime",
      "getCurrentRuntime",
      "currentOrDefaultRuntime",
      "runWithRuntime",
      "runFork",
    ],
  },
  {
    file: "packages/core/src/action-transport.ts",
    declarations: ["ActionTransportSubmission", "ActionTransportResponse", "ActionTransport"],
  },
  {
    file: "packages/core/src/action-outbox.ts",
    declarations: [
      "ActionDurablePolicy",
      "ActionQueued",
      "ActionSubmissionExpired",
      "ActionSubmissionUnrestorable",
      "isRetryableActionFailure",
      "ActionOutboxOptions",
      "ActionOutboxEntry",
      "ActionOutboxFailure",
      "ActionOutboxView",
      "ActionOutbox",
    ],
  },
  {
    file: "packages/core/src/action-instance.ts",
    declarations: ["makeActionInstance"],
  },
  {
    file: "packages/core/src/program-start.ts",
    declarations: ["startProgramOnRuntime"],
  },
  {
    file: "packages/core/src/effect-like.ts",
    declarations: ["isPromiseLikeValue"],
  },
  {
    file: "packages/core/src/timeline.ts",
    declarations: [
      "TimelineUserCause",
      "TimelineActionCause",
      "TimelineProgramCause",
      "TimelineResourceCause",
      "TimelineRouterCause",
      "TimelineCollectionCause",
      "TimelineCause",
      "TimelineChange",
      "TimelineEntry",
      "TimelineRecordOptions",
      "TimelineRecording",
      "TimelineEntryUnavailable",
      "TimelineAlreadyRecording",
      "Timeline",
    ],
    namespaceDeclarations: {
      Timeline: ["record", "describe"],
    },
  },
  {
    file: "packages/core/src/resource-duration.ts",
    declarations: ["DurationInput", "UnsupportedDuration"],
  },
  {
    file: "packages/core/src/program-contract.ts",
    declarations: [
      "ProgramStepTypeId",
      "ProgramCommandTypeId",
      "ProgramSubscriptionTypeId",
      "ProgramPhase",
      "ProgramFailure",
      "ProgramCommand",
      "ProgramCommandInput",
      "ProgramStep",
      "ProgramUpdate",
      "ProgramTaggedMessage",
      "ProgramHandlerMap",
      "ProgramSubscription",
      "ProgramSubscriptionInput",
      "ProgramSubscriptionError",
      "ProgramSubscriptionRequirements",
      "ProgramDefinition",
      "ProgramRuntimeError",
      "ProgramInstance",
    ],
  },
  {
    file: "packages/core/src/scope.ts",
    declarations: [
      "ForkScopedOptions",
      "UiScopeOptions",
      "UiScopeMissing",
      "UiScopeDisposed",
      "UiScope",
      "makeRuntimeUiScope",
      "RuntimeUiScopeFrame",
      "makeRuntimeUiScopeFrame",
      "getCurrentScope",
      "runWithScope",
      "scoped",
      "onDispose",
      "forkScoped",
    ],
  },
  {
    file: "packages/core/src/browser-router-link.ts",
    declarations: [
      "BrowserRouterClickEvent",
      "isPlainLeftClick",
      "opensOutsideRouter",
      "BrowserRouterLinkIgnoreReason",
      "BrowserRouterLinkTarget",
      "BrowserRouterLinkPreloadDecisionOptions",
      "BrowserRouterLinkPreloadDecision",
      "browserRouterLinkPreloadDecision",
      "BrowserRouterLinkPreloadIdentityOptions",
      "browserRouterLinkPreloadIdentity",
      "BrowserRouterLinkClickDecisionOptions",
      "BrowserRouterLinkClickDecision",
      "browserRouterLinkClickDecision",
      "BrowserRouterLinkPreloader",
      "BrowserRouterLinkPreloadIdentity",
      "BrowserRouterLinkPreloaderRuntime",
      "BrowserRouterLinkPreloaderOptions",
      "makeBrowserRouterLinkPreloader",
    ],
  },
  {
    file: "packages/core/src/browser-router-render-decision.ts",
    declarations: [
      "BrowserRouteOutletRenderers",
      "BrowserRouteOutletDefaultRenderers",
      "BrowserRouteRenderIdentityInput",
      "BrowserRouteReadyRenderProps",
      "BrowserRouteRenderDecision",
      "browserRouteRenderKey",
      "browserRouteRenderDecision",
      "browserRouteActiveRenderer",
      "browserRouteRenderIdentity",
    ],
  },
  {
    file: "packages/core/src/resource.ts",
    declarations: [
      "ResourceTag",
      "ResourceTagDefinition",
      "ResourceInvalidationPlan",
      "ResourceHydrationSuccessState",
      "ResourceHydrationSnapshot",
      "ResourceHydrationPayload",
      "ResourceStatus",
      "Resource",
    ],
    namespaceDeclarations: {
      Resource: [
        "Tag",
        "TagDefinition",
        "Invalidation",
        "InvalidationTarget",
        "InvalidationCause",
        "InvalidationPlanEntry",
        "InvalidationPlan",
        "Snapshot",
        "HydrationPayload",
        "HydrationOptions",
        "Status",
        "diagnostics",
        "result",
        "status",
        "changes",
        "hydrationPayload",
      ],
    },
  },
  {
    file: "packages/core/src/resource-ui-binding.ts",
    declarations: [
      "ResourceUiInput",
      "ResourceUiPreloadFailure",
      "ResourceUiAutoPreloadOptions",
      "ResourceUiBindingControllerOptions",
      "ResourceUiBindingController",
      "ResourceUiSuspensePreloadFiber",
      "ResourceUiSuspensePreloadOptions",
      "ResourceUiSuspensePreloadController",
      "resourceUiRefValue",
      "resourceUiRefAccessor",
      "resourceUiSameRef",
      "resourceUiPreloadFailureFor",
      "resourceUiBindRuntimeEffect",
      "makeResourceUiBindingController",
      "makeResourceUiSuspensePreloadController",
    ],
  },
  {
    file: "packages/devtools/src/serialization.ts",
    declarations: [
      "DevtoolsUnknownInvalidationTarget",
      "describeInvalidationPlan",
      "describeRoutePlan",
    ],
  },
  {
    file: "packages/devtools/src/devtools-contract.ts",
    declarations: [
      "DevtoolsRuntimeEvent",
      "DevtoolsTimelineChange",
      "DevtoolsTimelineCommit",
      "DevtoolsSnapshot",
      "DevtoolsStoreOptions",
      "DevtoolsStore",
      "DevtoolsStartAppGraphSchemaCoverage",
      "DevtoolsStartAppGraphUnknownRoutePreloadResourcesEntry",
      "DevtoolsStartAppGraphUnknownRoutePreloadCollectionsEntry",
      "DevtoolsSummaryResourceRef",
      "DevtoolsSummaryInvalidationTarget",
      "DevtoolsSummaryInvalidationCause",
      "DevtoolsSummaryInvalidationPlan",
      "DevtoolsSummaryRoutePlan",
      "DevtoolsSummaryResource",
      "DevtoolsPanelId",
      "DevtoolsPanelSeverity",
      "DevtoolsPanelMetric",
      "DevtoolsPanelItem",
      "DevtoolsPanel",
      "DevtoolsPanels",
      "DevtoolsPanelsInput",
      "DevtoolsPanelUiOptions",
      "DevtoolsPanelUiInput",
      "DevtoolsPanelMountOptions",
      "DevtoolsPanelMount",
      "DevtoolsPanelBootOptions",
      "DevtoolsPanelBoot",
    ],
  },
  {
    file: "packages/devtools/src/index.ts",
    declarations: [
      "makeDevtoolsStore",
      "describeDevtoolsPanels",
      "renderDevtoolsPanelsHtml",
      "mountDevtoolsPanels",
      "bootDevtoolsPanels",
    ],
  },
  {
    file: "packages/devtools/src/summary.ts",
    declarations: ["describeDevtoolsSummary"],
  },
  {
    file: "packages/devtools/src/panel-contract.ts",
    declarations: [
      "DevtoolsPanelContractErrorReason",
      "DevtoolsBridgePayloadContractResolution",
      "devtoolsPanelIds",
      "devtoolsPanelSeverities",
    ],
  },
  {
    file: "packages/start/src/file-route.ts",
    declarations: ["FileRoute"],
  },
  {
    file: "packages/db/src/collection-index-materialization.ts",
    declarations: ["UnknownCollectionIndex"],
  },
  {
    file: "packages/db/src/collection-errors.ts",
    declarations: [
      "CollectionRowKeyChanged",
      "CollectionRowNotFound",
      "ReadonlyCollectionMutation",
    ],
  },
  {
    file: "packages/db/src/collection-snapshot-codec.ts",
    declarations: ["CollectionSnapshotCodecError"],
  },
  {
    file: "packages/db/src/index.ts",
    namespaceDeclarations: {
      Collection: [
        "Definition",
        "Any",
        "Value",
        "RowValue",
        "Error",
        "Requirements",
        "Options",
        "Row",
        "Key",
        "Origin",
        "Policy",
        "Sync",
        "SyncAdapter",
        "IndexValue",
        "IndexResult",
        "IndexDefinition",
        "IndexInput",
        "IndexRecord",
        "Change",
        "WriteOptions",
        "RowSnapshot",
        "Snapshot",
        "HydrationPayload",
        "HydrateOptions",
        "PersistOptions",
        "PersistenceConfig",
        "LiveQueryOptions",
        "define",
        "liveQuery",
      ],
    },
  },
  {
    file: "packages/db/src/query-plan.ts",
    declarations: ["UnsupportedLiveQuery", "QueryEvaluationError"],
  },
  {
    file: "packages/db/src/query-builder.ts",
    namespaceDeclarations: {
      Query: [
        "Builder",
        "Factory",
        "Live",
        "EvaluationOperation",
        "JoinStrategy",
        "JoinKey",
        "SortDirection",
        "SortValue",
        "PlanSourceDiagnostics",
        "PlanJoinDiagnostics",
        "PlanDiagnostics",
        "Root",
        "GroupKey",
        "Aggregate",
        "Aggregates",
        "AggregateResult",
        "from",
        "count",
        "sum",
        "avg",
        "min",
        "max",
        "diagnostics",
        "once",
        "live",
      ],
    },
  },
  {
    file: "packages/solid-db/src/collection.ts",
    declarations: ["CollectionBindingOptions", "CollectionHandle", "collection"],
  },
  {
    file: "packages/solid-db/src/live-query.ts",
    declarations: ["LiveQueryBindingOptions", "LiveQueryHandle", "liveQuery"],
  },
  {
    file: "packages/core/src/browser-router-state.ts",
    declarations: ["BrowserRouterError"],
  },
  {
    file: "packages/core/src/browser-router-history-adapter.ts",
    declarations: [
      "BrowserNavigateOptions",
      "BrowserHistoryWindow",
      "BrowserHistoryAdapter",
      "MemoryBrowserHistoryAdapter",
      "makeWindowBrowserHistoryAdapter",
      "makeMemoryBrowserHistoryAdapter",
    ],
  },
  {
    file: "packages/core/src/browser-router-kernel.ts",
    declarations: [
      "BrowserNavigateArgs",
      "BrowserRouterInitialMatchedHost",
      "BrowserRouterInitialMatchedStateOptions",
      "browserRouterInitialMatchedState",
      "BrowserRouterKernelOptions",
      "BrowserRouterKernel",
      "createBrowserRouterKernel",
      "RouterRouteNotRegistered",
    ],
  },
  {
    file: "packages/core/src/browser-router-host-controller.ts",
    declarations: ["BrowserRouterHostController", "createBrowserRouterHostController"],
  },
  {
    file: "packages/solid/src/router.ts",
    declarations: [
      "BrowserRouter",
      "RouterOptions",
      "RouterProviderProps",
      "RouterOutletProps",
      "RouterContextMissing",
      "useRouter",
      "RouterOutlet",
      "RouterProvider",
    ],
  },
  {
    file: "packages/solid/src/link.ts",
    declarations: ["RouterLinkProps", "isPlainLeftClick", "RouterLink"],
  },
  {
    file: "packages/solid/src/component.ts",
    allDeclarations: ["Component"],
    namespaceDeclarations: {
      Component: [
        "Solid",
        "Render",
        "ErrorOf",
        "ServicesOf",
        "Handlers",
        "MountOptions",
        "Instance",
        "ResourceReader",
        "ActionError",
        "ActionHandle",
        "ProgramModelView",
        "ProgramOptions",
        "ProgramHandle",
        "RouterServices",
        "RouterError",
        "define",
        "instance",
        "resource",
        "action",
        "program",
        "stream",
        "callback",
        "router",
        "catchTags",
        "catchAll",
        "loading",
        "provide",
        "mount",
        "launch",
        "embed",
      ],
    },
  },
  {
    file: "packages/start/src/start-action-request-codec.ts",
    declarations: ["StartActionFormOptions", "StartActionFormEncodeError"],
  },
  {
    file: "packages/start/src/start-action-client.ts",
    declarations: ["StartAction"],
  },
  {
    file: "packages/start/src/start-app.ts",
    declarations: [
      "AppDefinition",
      "AnyAppDefinition",
      "AppLaunchServices",
      "StartRootMissing",
      "AppLaunchError",
      "App",
    ],
    namespaceDeclarations: {
      App: ["RootProps", "LaunchOptions", "define", "launch"],
    },
  },
  {
    file: "packages/start/src/start-app-request-handler.ts",
    declarations: ["CreateRequestHandlerOptions", "createRequestHandler"],
  },
  {
    file: "packages/start/src/start-document.ts",
    declarations: ["StartDocumentTagAttributes", "StartDocument", "StartDocumentContext"],
  },
  {
    file: "packages/start/src/hydration.ts",
    declarations: ["HydrateFromDocumentOptions"],
  },
  {
    file: "packages/start/src/start-transport-protocol.ts",
    declarations: ["StartActionDuplicateName"],
  },
  {
    file: "packages/start/src/app-graph.ts",
    declarations: ["StartAppGraphMissingWireSchemas", "describeStartAppGraphRuntimeDiagnostics"],
  },
  {
    file: "packages/start/src/start-app-graph-diagnostics-policy.ts",
    declarations: [
      "StartAppGraphUnknownRoutePreloadResources",
      "StartAppGraphUnknownRoutePreloadCollections",
      "validateStartAppGraphDiagnosticsPolicyExceptionEffect",
    ],
  },
  {
    file: "packages/start/src/start-manifest-wall.ts",
    declarations: ["StartBuildPolicy", "StartBuildPolicyError"],
  },
  {
    file: "packages/start/src/start-prerender.ts",
    declarations: [
      "StartPrerenderPageOptions",
      "StartPrerenderPage",
      "StartPrerenderPageInput",
      "StartPrerenderPageContext",
      "StartPrerenderSuccessEvent",
      "StartPrerenderFailureEvent",
      "StartPrerenderOptions",
      "StartPrerenderConfig",
      "StartPrerenderError",
    ],
  },
  {
    file: "packages/start/src/start-vite-dev-ssr.ts",
    declarations: ["StartHandlerNotFound", "StartDevServerError"],
  },
  {
    file: "packages/start/src/start-vite-diagnostics-loader.ts",
    declarations: ["StartAppGraphDiagnosticsRunnerError"],
  },
  {
    file: "packages/start/src/start-transport-endpoints.ts",
    declarations: [
      "StartTransportEndpointPathError",
      "StartTransportEndpointConflictError",
      "StartTransportEndpointOverrides",
    ],
  },
  {
    file: "packages/start/src/request-trace.ts",
    declarations: ["StartRequestTrace", "StartRequestTraceHandler"],
  },
  {
    file: "packages/start/src/fetch.ts",
    allDeclarations: ["toFetchHandler", "createFetchHandler"],
  },
  {
    file: "packages/start/src/node.ts",
    allDeclarations: ["createNodeHandler", "createNodeServerHandler"],
  },
];

export const namespaceBackedSurfaceModules = new Map([
  [
    "@sunfall/arc-db",
    new Set(["collection-contract", "collection-runtime", "live-query-collection"]),
  ],
]);

export const currentDocsEvidencePolicy = {
  latestFocusedReview: 512,
  latestFocusedTitle: "Generated Route Artifact Formatting",
  latestFullGateReview: 492,
  rootTestFiles: 58,
  rootTestCount: 1223,
  effectFirstFiles: 449,
  activeCleanCounter: "12/30",
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const spacedTextPattern = (value) => escapeRegExp(value).replace(/\s+/g, "\\s+");
const latestFocusedReviewPattern = `Review${currentDocsEvidencePolicy.latestFocusedReview}\\s+${spacedTextPattern(
  currentDocsEvidencePolicy.latestFocusedTitle,
)}`;
const activeCleanCounterPattern = escapeRegExp(currentDocsEvidencePolicy.activeCleanCounter);

const staleFocusedReviewPattern =
  /(?:The latest focused Review|Latest focused evidence: Review|newest focused review is Review) ?(?:1\d\d|2\d\d|3\d\d|4\d\d|50\d|51[0-1])\b/;
const staleAsOfReviewPattern =
  /As of Review(?:1\d\d|2\d\d|3\d\d|4\d\d|50\d|51[0-1]), the latest full/;
const staleFullGateReviewPattern =
  /(?:The latest full verification gate is green after Review|Latest full gate[^.\n]*after Review|latest full `pnpm verify` passed after Review|current full gate is the Review) ?(?:1\d\d|2\d\d|3\d\d|4[0-8]\d|49[0-1])\b/;
const stalePostReviewWaitPattern =
  /until\s+a fresh\s+post-Review(?:1\d\d|2\d\d|3\d\d|4[0-9]\d)\s+sweep reports no actionable\s+findings/;

export const currentDocsTextPolicies = [
  {
    file: "CONTEXT.md",
    banned: [
      {
        name: "Start Diagnostics CLI Contract must describe variadic graph/impact arguments",
        pattern: /Start Diagnostics CLI Contract[\s\S]*?nested `Command` subcommands/,
      },
    ],
  },
  {
    file: "packages/start/src/start-agent-graph-contract.ts",
    banned: [
      {
        name: "StartAgentGraphQuery hover docs must describe graph/impact arguments, not query-kind subcommands",
        pattern: /CLI subcommands/,
      },
    ],
  },
  {
    file: "packages/start/src/start-agent-graph-vocabulary.ts",
    banned: [
      {
        name: "Start agent graph vocabulary hover docs must describe query parsing, not query-kind subcommands",
        pattern: /wiring CLI subcommands or impact relations/,
      },
    ],
  },
  {
    file: "docs/architecture-deepening-review.md",
    required: [
      {
        name: "Architecture tip must name the current focused review",
        pattern: new RegExp(`The newest focused review is ${latestFocusedReviewPattern}`),
      },
      {
        name: "Architecture tip must keep Review492 as the newest full checkpoint",
        pattern: new RegExp(
          `newest full verification checkpoint is Review${currentDocsEvidencePolicy.latestFullGateReview}`,
        ),
      },
      {
        name: "Architecture tip must record the current clean sweep",
        pattern: new RegExp(
          `active\\s+Thirty-Sweep\\s+clean\\s+counter\\s+is ${activeCleanCounterPattern}\\s+after\\s+Clean\\s+Sweep\\s+12\\s+after\\s+Review${currentDocsEvidencePolicy.latestFocusedReview}`,
        ),
      },
    ],
    banned: [
      {
        name: "Architecture tip must not name an older newest focused review",
        pattern: staleFocusedReviewPattern,
      },
      {
        name: "Architecture tip must not wait on an older post-review sweep",
        pattern: stalePostReviewWaitPattern,
      },
    ],
  },
  {
    file: "docs/perfection-progress.md",
    required: [
      {
        name: "Perfection progress must name the current focused review from currentDocsEvidencePolicy",
        pattern: new RegExp(`The latest focused ${latestFocusedReviewPattern}`),
      },
      {
        name: "Perfection progress must keep the Review492 full gate as current full evidence",
        pattern: new RegExp(
          `latest full verification gate is green after Review${currentDocsEvidencePolicy.latestFullGateReview}`,
        ),
      },
      {
        name: "Perfection progress must record the current clean sweep",
        pattern: new RegExp(
          `active\\s+Thirty-Sweep\\s+clean\\s+counter\\s+is ${activeCleanCounterPattern}\\s+after\\s+Clean\\s+Sweep\\s+12\\s+after\\s+Review${currentDocsEvidencePolicy.latestFocusedReview}`,
        ),
      },
    ],
    banned: [
      {
        name: "Perfection progress must not name an older latest focused review",
        pattern: staleFocusedReviewPattern,
      },
      {
        name: "Perfection progress must not name an older latest full gate review",
        pattern: staleFullGateReviewPattern,
      },
      {
        name: "Perfection progress must not wait on an older post-review sweep",
        pattern: stalePostReviewWaitPattern,
      },
      {
        name: "Perfection progress must not call Review239 the latest focused review",
        pattern: /latest focused Review239/,
      },
      {
        name: "Perfection progress must not call Review239 the latest full verification gate",
        pattern: /latest full verification gate is green after Review239/,
      },
      {
        name: "Perfection progress must not wait on a post-Review239 clean sweep",
        pattern: /fresh post-Review239 sweep is clean/,
      },
    ],
  },
  {
    file: "docs/release-notes.md",
    required: [
      {
        name: "Release notes must include the current focused review entry",
        pattern: new RegExp(
          `Review ${currentDocsEvidencePolicy.latestFocusedReview} ${spacedTextPattern(
            currentDocsEvidencePolicy.latestFocusedTitle,
          )}`,
        ),
      },
      {
        name: "Release notes must keep the Review492 full gate snapshot",
        pattern: new RegExp(
          `Latest full gate on May 17, 2026 after Review ${currentDocsEvidencePolicy.latestFullGateReview}`,
        ),
      },
      {
        name: "Release notes must record the current clean sweep",
        pattern: new RegExp(
          `Clean Sweep 12 after Review${currentDocsEvidencePolicy.latestFocusedReview}\\s+found no actionable`,
        ),
      },
    ],
    banned: [
      {
        name: "Release notes must not name an older latest full gate review",
        pattern: staleFullGateReviewPattern,
      },
      {
        name: "Release notes must not wait on an older post-review sweep",
        pattern: stalePostReviewWaitPattern,
      },
      {
        name: "Release notes must not call Review239 the latest full gate",
        pattern: /Latest full gate on May 17, 2026 after Review 239/,
      },
      {
        name: "Release notes must not call Review239 the latest full verify",
        pattern: /latest full `pnpm verify` passed after Review 239/,
      },
      {
        name: "Release notes must not wait on a post-Review239 clean sweep",
        pattern: /fresh post-Review239 sweep (?:is clean|reports no actionable findings)/,
      },
    ],
  },
  {
    file: "docs/docs-drift-audit.md",
    required: [
      {
        name: "Docs drift audit must name the current focused review evidence",
        pattern: new RegExp(
          `As of Review${currentDocsEvidencePolicy.latestFocusedReview}, the latest full`,
        ),
      },
      {
        name: "Docs drift audit must keep Review492 full gate counts",
        pattern: new RegExp(
          `Review${currentDocsEvidencePolicy.latestFullGateReview} run with ${currentDocsEvidencePolicy.rootTestFiles} root test files / ${currentDocsEvidencePolicy.rootTestCount} tests`,
        ),
      },
      {
        name: "Docs drift audit must record the current clean sweep",
        pattern: new RegExp(
          `counter\\s+is ${activeCleanCounterPattern}\\s+after\\s+Clean\\s+Sweep\\s+12\\s+after\\s+Review${currentDocsEvidencePolicy.latestFocusedReview}`,
        ),
      },
    ],
    banned: [
      {
        name: "Docs drift audit must not name an older current release-tracking review",
        pattern: staleAsOfReviewPattern,
      },
      {
        name: "Docs drift audit must not wait on an older post-review sweep",
        pattern: stalePostReviewWaitPattern,
      },
      {
        name: "Docs drift audit must not call Review239 the current release-tracking truth",
        pattern: /As of Review239, the latest full/,
      },
      {
        name: "Docs drift audit must not wait on a post-Review239 clean sweep",
        pattern: /fresh post-Review239 sweep reports no actionable findings/,
      },
    ],
  },
  {
    file: "docs/type-test-coverage-audit.md",
    required: [
      {
        name: "Type-test audit must name Review492 public type-test pins",
        pattern: new RegExp(
          `Review${currentDocsEvidencePolicy.latestFullGateReview} Route Suspense Runtime And Prerender Callback Pins`,
        ),
      },
      {
        name: "Type-test audit must record current evidence policy",
        pattern: new RegExp(latestFocusedReviewPattern),
      },
      {
        name: "Type-test audit must keep Review492 full gate counts",
        pattern: new RegExp(
          `Full ${escapeRegExp("`pnpm verify`")} passed after Review${currentDocsEvidencePolicy.latestFullGateReview} with\\s+${currentDocsEvidencePolicy.rootTestFiles} root test files / ${currentDocsEvidencePolicy.rootTestCount} tests`,
        ),
      },
    ],
    banned: [
      {
        name: "Type-test audit must not use Review239 as current verification evidence",
        pattern: /full `pnpm verify` passed\s+after Review239 with/,
      },
    ],
  },
  {
    file: "docs/effect-first-audit.md",
    required: [
      {
        name: "Effect-first audit must name current sweep work",
        pattern: new RegExp(latestFocusedReviewPattern),
      },
      {
        name: "Effect-first audit must keep the 449-file audit count",
        pattern: new RegExp(
          `Effect-first audit\\s+over ${currentDocsEvidencePolicy.effectFirstFiles} physical and virtual files`,
        ),
      },
      {
        name: "Effect-first audit must keep the Review492 full gate as current full evidence",
        pattern: new RegExp(
          `current full gate is the Review ${currentDocsEvidencePolicy.latestFullGateReview}`,
        ),
      },
    ],
    banned: [
      {
        name: "Effect-first audit must not call an older review the current full gate",
        pattern:
          /current full (?:gate is the|`pnpm verify` passed after) Review ?(?:1\d\d|2\d\d|3\d\d|4[0-8]\d|49[0-1])\b/,
      },
      {
        name: "Effect-first audit must not keep Review239 root-test count as current evidence",
        pattern: /53 root test files \/ 1161 tests/,
      },
    ],
  },
  {
    file: "docs/package-hygiene-audit.md",
    required: [
      {
        name: "Package hygiene audit must keep the Review491 license drift self-test evidence",
        pattern:
          /Review491 added a package payload policy self-test[\s\S]*mismatched package-local `LICENSE`[\s\S]*workspace MIT license text/,
      },
    ],
    banned: [
      {
        name: "Package hygiene audit must not call an older review the current full gate",
        pattern:
          /current full `pnpm verify` passed after Review ?(?:1\d\d|2\d\d|3\d\d|4[0-8]\d|49[0-1])\b/,
      },
      {
        name: "Package hygiene audit must not keep Review239 root-test count as current evidence",
        pattern: /53 root test files \/ 1161 tests/,
      },
    ],
  },
  {
    file: "docs/sharp-cast-audit.md",
    banned: [
      {
        name: "Sharp cast audit must not call an older review the current verification gate",
        pattern:
          /current full verification gate is recorded in the Review ?(?:1\d\d|2\d\d|3\d\d|4[0-8]\d|49[0-1])\b/,
      },
      {
        name: "Sharp cast audit must not keep Review239 root-test count as current evidence",
        pattern: /53 root test files \/ 1161 tests/,
      },
    ],
  },
  {
    file: "docs/ultimate-goal-checklist.md",
    required: [
      {
        name: "Ultimate goal checklist must name current latest focused evidence",
        pattern: new RegExp(
          `Latest focused evidence: Review ${currentDocsEvidencePolicy.latestFocusedReview}`,
        ),
      },
      {
        name: "Ultimate goal checklist must pin latest focused verification subsection",
        pattern: new RegExp(
          `Latest focused verification recorded\\.[\\s\\S]*?Evidence: Review ${currentDocsEvidencePolicy.latestFocusedReview} records[\\s\\S]*?generated route artifact formatting`,
        ),
      },
      {
        name: "Ultimate goal checklist must keep Review492 as latest full evidence",
        pattern: new RegExp(
          `Review ?${currentDocsEvidencePolicy.latestFullGateReview} records the\\s+latest\\s+full gate`,
        ),
      },
      {
        name: "Ultimate goal checklist must keep active clean counter at current evidence value",
        pattern: new RegExp(`leaving\\s+the\\s+active counter at ${activeCleanCounterPattern}`),
      },
    ],
    banned: [
      {
        name: "Ultimate goal checklist must not name an older latest focused review",
        pattern: staleFocusedReviewPattern,
      },
      {
        name: "Ultimate goal checklist must not wait on an older post-review sweep",
        pattern: stalePostReviewWaitPattern,
      },
      {
        name: "Ultimate goal checklist must not call Review239 latest focused evidence",
        pattern: /Latest focused evidence: Review 239/,
      },
      {
        name: "Ultimate goal checklist must not call Review239 latest full evidence",
        pattern: /`pnpm verify` ran after Review 239/,
      },
      {
        name: "Ultimate goal checklist must not keep Review239 root-test count as current evidence",
        pattern: /53 root\s+test files \/ 1161/,
      },
    ],
  },
];
