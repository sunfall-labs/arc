/**
 * Internal plumbing shared by Sunfall Arc adapter packages (`@sunfall/arc-solid`,
 * `@sunfall/arc-start`, `@sunfall/arc-db`, ...).
 *
 * Not public API: no stability guarantees, and application code should not
 * import from `@sunfall/arc-core/internal`.
 */
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
export { lookupResourceFamilyEffect, refsForResourceTag } from "./resource-runtime.js";
export {
  cloneResourceSnapshotValue,
  decodeResourceHydrationInputEffect,
  decodeResourceHydrationPayloadEffect,
  decodeResourceHydrationStateEffect,
  encodeResourceHydrationPayloadEffect,
  resourceHydrationSnapshotFromRefEffect,
  validateResourceHydrationPayload,
  validateResourceHydrationPayloadEffect,
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
export { matchRoutesEffect } from "./route-match.js";
export { makeActionInstance } from "./action-instance.js";
export { startProgramOnRuntime } from "./program-start.js";
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
