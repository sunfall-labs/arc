export const publicHoverDocGroups = [
  {
    file: "packages/core/src/program.ts",
    declarations: [
      "Program",
      "ProgramStartOptions",
      "startProgram",
      "startProgramWithRuntimeError"
    ],
    namespaceDeclarations: {
      Program: [
        "Definition",
        "Instance",
        "Failure",
        "RuntimeError",
        "StartOptions",
        "RuntimeRemainingRequirements",
        "TimelineOptions",
        "Event",
        "EventBase",
        "MessageEvent",
        "CommandStartedEvent",
        "CommandCompletedEvent",
        "CommandFailedEvent",
        "UpdateFailedEvent",
        "SubscriptionStartedEvent",
        "SubscriptionEmittedEvent",
        "SubscriptionFailedEvent",
        "DisposedEvent",
        "Phase",
        "Update",
        "Step",
        "Command",
        "CommandInput",
        "Subscription",
        "SubscriptionInput",
        "StoryEntry",
        "Story",
        "StoryOptions"
      ]
    }
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
      "ProgramSubscription",
      "ProgramSubscriptionInput",
      "ProgramUpdateError",
      "ProgramUpdateRequirements",
      "ProgramSubscriptionError",
      "ProgramSubscriptionRequirements",
      "ProgramDefinition",
      "ProgramRuntimeError",
      "ProgramTimelineOptions",
      "ProgramEventBase",
      "ProgramMessageEvent",
      "ProgramCommandStartedEvent",
      "ProgramCommandCompletedEvent",
      "ProgramCommandFailedEvent",
      "ProgramUpdateFailedEvent",
      "ProgramSubscriptionStartedEvent",
      "ProgramSubscriptionEmittedEvent",
      "ProgramSubscriptionFailedEvent",
      "ProgramDisposedEvent",
      "ProgramEvent",
      "ProgramStoryEntry",
      "ProgramStory",
      "ProgramStoryOptions",
      "ProgramInstance"
    ]
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
      "onScopeDispose",
      "onDispose",
      "forkScoped"
    ]
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
      "makeBrowserRouterLinkPreloader"
    ]
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
      "browserRouteRenderIdentity"
    ]
  },
  {
    file: "packages/core/src/resource-ui-binding.ts",
    declarations: [
      "ResourceUiInput",
      "ResourceUiSuccessMeta",
      "ResourceUiPendingMeta",
      "ResourceUiFailureMeta",
      "ResourceUiMatch",
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
      "resourceUiStateHasValue",
      "resourceUiPreloadFailureFor",
      "resourceUiMatchState",
      "resourceUiBindRuntimeEffect",
      "makeResourceUiBindingController",
      "makeResourceUiSuspensePreloadController"
    ]
  },
  {
    file: "packages/devtools/src/serialization.ts",
    declarations: [
      "DevtoolsUnknownInvalidationTarget",
      "describeInvalidationPlan",
      "describeRoutePlan"
    ]
  },
  {
    file: "packages/core/src/browser-router-history-adapter.ts",
    declarations: [
      "BrowserNavigateOptions",
      "BrowserHistoryWindow",
      "BrowserHistoryAdapter",
      "MemoryBrowserHistoryAdapter",
      "makeWindowBrowserHistoryAdapter",
      "makeMemoryBrowserHistoryAdapter"
    ]
  },
  {
    file: "packages/core/src/browser-router-kernel.ts",
    declarations: [
      "BrowserRouterKernelOptions",
      "BrowserRouterKernel",
      "createBrowserRouterKernel",
      "RouterRouteNotRegistered"
    ]
  },
  {
    file: "packages/core/src/browser-router-host-controller.ts",
    declarations: [
      "BrowserRouterHostController",
      "createBrowserRouterHostController"
    ]
  },
  {
    file: "packages/react/src/router.ts",
    declarations: [
      "BrowserRouterOptions",
      "RouterProviderProps"
    ]
  },
  {
    file: "packages/react/src/runtime.ts",
    declarations: [
      "RuntimeContext",
      "RuntimeProviderProps",
      "createEffectRuntime",
      "useRuntime",
      "RuntimeProvider",
      "useComponentScope",
      "useScoped"
    ]
  },
  {
    file: "packages/solid/src/router.ts",
    declarations: [
      "BrowserRouterOptions",
      "RouterProviderProps"
    ]
  },
  {
    file: "packages/solid/src/runtime.ts",
    declarations: [
      "RuntimeContext",
      "RuntimeProviderProps",
      "createEffectRuntime",
      "useRuntime",
      "RuntimeProvider",
      "createComponentScope"
    ]
  },
  {
    file: "packages/start/src/agent-graph.ts",
    declarations: [
      "createStartAgentGraph",
      "createStartAgentGraphEffect"
    ]
  },
  {
    file: "packages/start/src/app-graph.ts",
    declarations: [
      "StartAppGraphDiagnosticsRuntimeCandidates",
      "StartAppGraphWireSchemaPolicy",
      "StartAppGraphActionBehaviorPolicy",
      "StartAppGraphParseError",
      "StartAppGraphMissingWireSchemas",
      "StartAppGraphUnknownActionBehavior",
      "StartAppGraphDiagnosticsDtoError",
      "StartAppGraphDiagnosticsDtoInput",
      "StartAppGraphDiagnosticsDto",
      "StartAppGraphDeserializeError",
      "decodeStartAppGraphDiagnosticsEffect",
      "decodeStartAppGraphDiagnosticsPolicyViolationsEffect",
      "decodeStartAppGraphDiagnosticsDtoEffect",
      "createStartAppGraph",
      "serializeStartAppGraph",
      "describeFileRouteManifestEntry",
      "describeStartAppGraphRouteDiagnosticsRuntimeCandidate",
      "describeServerFunctionManifestEntry",
      "describeActionManifestEntry",
      "unknownRoutePreloadResourcesForDiagnostics",
      "unknownRoutePreloadCollectionsForDiagnostics",
      "describeStartAppGraph",
      "describeStartAppGraphRuntimeDiagnostics",
      "describeStartAppGraphEffect",
      "validateStartAppGraphWireSchemasEffect",
      "validateStartAppGraphActionBehaviorEffect",
      "deserializeStartAppGraph"
    ]
  },
  {
    file: "packages/start/src/start-app-graph-diagnostics-policy.ts",
    declarations: [
      "StartAppGraphRoutePreloadResourcesPolicy",
      "StartAppGraphRoutePreloadCollectionsPolicy",
      "StartAppGraphDiagnosticsPolicy",
      "StartAppGraphUnknownRoutePreloadResources",
      "StartAppGraphUnknownRoutePreloadCollections",
      "StartAppGraphDiagnosticsPolicyError",
      "StartAppGraphDiagnosticsPolicyViolation",
      "StartAppGraphDiagnosticsPolicyException",
      "validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect",
      "collectStartAppGraphDiagnosticsPolicyViolations",
      "formatStartAppGraphDiagnosticsPolicyViolation",
      "createStartAppGraphDiagnosticsPolicyException",
      "enforceStartAppGraphDiagnosticsPolicy",
      "validateStartAppGraphDiagnosticsPolicyExceptionEffect",
      "validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect",
      "validateStartAppGraphDiagnosticsPolicyEffect"
    ]
  },
  {
    file: "packages/start/src/start-manifest-wall.ts",
    declarations: [
      "StartBuildPolicy",
      "StartBuildPolicyError"
    ]
  },
  {
    file: "packages/start/src/start-vite-diagnostics-loader.ts",
    declarations: [
      "StartAppGraphDiagnosticsLoadError"
    ]
  },
  {
    file: "packages/start/src/start-transport-endpoints.ts",
    declarations: [
      "StartEndpointPathInvalidReason",
      "StartEndpointPathErrorInput",
      "StartEndpointConflictErrorInput",
      "startEndpointPathGuidance",
      "startEndpointConflictGuidance",
      "startEndpointPathInvalidReason",
      "normalizeStartEndpointPath",
      "validateStartEndpointPathEffect",
      "StartTransportEndpointPathError",
      "StartTransportEndpointConflictError",
      "StartTransportEndpoints",
      "StartTransportEndpointOverrides",
      "StartServerFunctionEndpointManifest",
      "StartActionEndpointManifest",
      "StartTransportEndpointManifestSource",
      "StartTransportEndpointSource",
      "StartRpcEndpointSource",
      "StartActionEndpointSource",
      "defaultStartTransportEndpoints",
      "resolveStartTransportEndpoints",
      "resolveStartTransportEndpointsEffect",
      "resolveStartRpcEndpoint",
      "resolveStartActionEndpoint",
      "isStartRpcEndpointRequest",
      "isStartActionEndpointRequest"
    ]
  },
  {
    file: "packages/start/src/request-trace.ts",
    declarations: [
      "StartRequestTraceTransport",
      "StartRequestTraceStatus",
      "StartRequestTraceFailureKind",
      "StartRequestTraceStreamState",
      "StartRequestTraceFiberStatus",
      "StartRequestTraceHeader",
      "StartRequestTraceCookie",
      "StartRequestTraceRequest",
      "StartRequestTraceResponse",
      "StartRequestTraceResource",
      "StartRequestTraceCollection",
      "StartRequestTraceServerFunction",
      "StartRequestTraceAction",
      "StartRequestTraceFiber",
      "StartRequestTraceStream",
      "StartRequestTraceTeardownSnapshot",
      "StartRequestTraceCleanupFailure",
      "StartRequestTraceTeardown",
      "StartRequestTrace",
      "StartRequestTraceRoutePlan",
      "StartRequestTraceHandler",
      "startRequestCountMetric",
      "startRequestDurationMetric",
      "startRequestStatusMetric"
    ]
  },
  {
    file: "packages/start/src/fetch-adapter.ts",
    allDeclarations: [
      "toFetchHandlerEffect",
      "toFetchHandler",
      "createFetchHandler"
    ]
  },
  {
    file: "packages/start/src/node-adapter.ts",
    allDeclarations: [
      "createNodeHandlerEffect",
      "createNodeHandler",
      "createNodeServerHandler"
    ]
  }
];

export const namespaceBackedSurfaceModules = new Map([
  ["@effect-ui/db", new Set(["sync-adapter"])]
]);
