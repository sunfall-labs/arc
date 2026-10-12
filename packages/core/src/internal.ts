/**
 * Internal plumbing shared by Sunfall Arc adapter packages (`@sunfall/arc-solid`,
 * `@sunfall/arc-start`, `@sunfall/arc-db`, ...).
 *
 * Not public API: no stability guarantees, and application code should not
 * import from `@sunfall/arc-core/internal`.
 */
export {
  applyResourceRowChanges,
  applyResourceRowPatch,
  resourceRowIndexBucket,
  resourceRowKey,
  resourceRowPositions,
  resourceRowsGet,
  resourceRowsIndex,
  type ResourceRowPatch,
} from "./resource-rows.js";
export type {
  ActionDefinitionRequirements,
  AppDefinitionRegistry,
  AppDefinitionRegistryActionDefinitions,
  AppDefinitionRegistryActionRequirements,
  AppDefinitionRegistryFromInput,
  AppDefinitionRegistryInput,
  AppDefinitionRegistryRequirements,
  AppDefinitionRegistryServerFunctionRequirements,
  AppDefinitionRegistryServerFunctions,
  ServerFunctionRequirements,
} from "./app.js";
export {
  makeActionSubmissionController,
  type ActionSubmissionController,
  type ActionSubmissionControllerOptions,
  type ActionSubmissionDecision,
  type ActionSubmissionFiber,
  type ActionSubmissionRun,
} from "./action-submission.js";
export { makeWindowBrowserHistoryAdapter } from "./browser-router-history-adapter.js";
export {
  browserRouterInitialMatchedState,
  createBrowserRouterKernel,
  type BrowserRouterInitialMatchedHost,
  type BrowserRouterInitialMatchedStateOptions,
  type BrowserRouterKernel,
  type BrowserRouterKernelOptions,
} from "./browser-router-kernel.js";
export * from "./browser-router-link.js";
export * from "./browser-router-render-decision.js";
export {
  browserRouterFailureState,
  routeStateMatch,
  type AnyBrowserRoute,
} from "./browser-router-state.js";
export * from "./definition-registry.js";
export { catchEffectInputPromiseDefect, invokeEffectInput, toEffect } from "./effect-like.js";
export {
  resourceFailureSnapshot,
  resourceRenderCause,
  resourceRenderCauseFromSnapshot,
  resourceRenderError,
  type ResourceFailureEncoding,
  type ResourceFailureSnapshot,
} from "./resource-failure-snapshot.js";
export * from "./resource-registry.js";
export { decodeServerWire, encodeServerWire } from "./server-wire-codec.js";
export type {
  MutableResourceStore,
  ResourceStoreEventBus,
  ResourceStoreFiberRegistry,
  ResourceStoreInvalidationCause,
  ResourceStoreModule,
  ResourceStoreModuleRegistry,
} from "./resource-store.js";
export {
  activeResourceStore,
  currentResourceStore,
  lookupResourceFamily,
  refsForResourceTag,
  resourceEntry,
} from "./resource-runtime.js";
export {
  cloneResourceSnapshotValue,
  decodeResourceHydrationInput,
  decodeResourceHydrationPayload,
  decodeResourceHydrationState,
  encodeResourceHydrationPayload,
  resourceHydrationSnapshotFromRef,
  validateResourceHydrationPayloadSync,
  validateResourceHydrationPayload,
  validateResourceHydrationSnapshot,
  validateResourceHydrationSnapshots,
} from "./resource-snapshot-codec.js";
export * from "./resource-ui-binding.js";
export * from "./stable-stringify.js";
export {
  buildRoutePath,
  compareRoutePathSegment,
  compareRoutePathSpecificity,
  DuplicateRouteParam,
  hrefForRouteInput,
  InvalidRouteParam,
  isRouteParamName,
  isRoutePathSegmentPrefix,
  matchRoutePath,
  MissingRouteParam,
  parseRoutePathSegments,
  parseRouteUrl,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSegmentsEqual,
  routePathSlug,
  type OptionalRoutePathParamNames,
  type RequiredRoutePathParamNames,
  type RoutePathParam,
  type RoutePathParamNames,
  type RoutePathSegment,
  type StripRouteParamName,
} from "./route-grammar.js";
export { matchRoutes } from "./route-match.js";
export type { AnySchema, RouteWithComponent } from "./route.js";
export { ResourceFamily } from "./resource.js";
export { makeActionInstance } from "./action-instance.js";
export { SignalWrites, type WritableSignal } from "./signal.js";
export { startStateOnRuntime } from "./state-start.js";
export {
  currentOrDefaultRuntime,
  defaultRuntime,
  eraseRuntime,
  getCurrentRuntime,
  runFork,
  withResourceStore,
} from "./runtime.js";
export * from "./scope.js";
export * from "./signal-watch.js";
export {
  batchSignalWrites,
  signalTransaction,
  SignalWriteOutsideTransition,
  withSignalTransition,
  writeUntracedSignals,
} from "./signal-transaction.js";
