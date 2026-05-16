import { Data, Effect } from "effect";
import type {
  StartAppGraphDiagnostics,
  StartAppGraphUnknownRoutePreloadCollectionsEntry,
  StartAppGraphUnknownRoutePreloadResourcesEntry
} from "./app-graph.js";

/** Policy for route preload resource diagnostics. */
export interface StartAppGraphRoutePreloadResourcesPolicy {
  readonly requireDeclaredForPreload?: boolean;
}

/** Policy for route preload collection diagnostics. */
export interface StartAppGraphRoutePreloadCollectionsPolicy {
  readonly requireDeclaredForPreload?: boolean;
}

/** Build and runtime diagnostics policy for Start app graph route preload facts. */
export interface StartAppGraphDiagnosticsPolicy {
  readonly routePreloadResources?: StartAppGraphRoutePreloadResourcesPolicy | false;
  readonly routePreloadCollections?: StartAppGraphRoutePreloadCollectionsPolicy | false;
}

/** Error raised when a route with preload lacks declared resource families. */
export class StartAppGraphUnknownRoutePreloadResources extends Data.TaggedError(
  "StartAppGraphUnknownRoutePreloadResources"
)<{
  readonly unknown: readonly StartAppGraphUnknownRoutePreloadResourcesEntry[];
}> {}

/** Error raised when a route with preload lacks declared collections. */
export class StartAppGraphUnknownRoutePreloadCollections extends Data.TaggedError(
  "StartAppGraphUnknownRoutePreloadCollections"
)<{
  readonly unknown: readonly StartAppGraphUnknownRoutePreloadCollectionsEntry[];
}> {}

/** Failure channel for diagnostics policy validation Effects. */
export type StartAppGraphDiagnosticsPolicyError =
  | StartAppGraphUnknownRoutePreloadResources
  | StartAppGraphUnknownRoutePreloadCollections;

/** One grouped diagnostics policy violation used by CLI reports and virtual modules. */
export type StartAppGraphDiagnosticsPolicyViolation =
  | {
      readonly _tag: "UnknownRoutePreloadResources";
      readonly message: string;
      readonly routes: readonly StartAppGraphUnknownRoutePreloadResourcesEntry[];
    }
  | {
      readonly _tag: "UnknownRoutePreloadCollections";
      readonly message: string;
      readonly routes: readonly StartAppGraphUnknownRoutePreloadCollectionsEntry[];
    };

/** Exception thrown or failed when resolved app graph diagnostics violate policy. */
export class StartAppGraphDiagnosticsPolicyException extends Data.TaggedError(
  "StartAppGraphDiagnosticsPolicyError"
)<{
  readonly message: string;
  readonly violations: readonly StartAppGraphDiagnosticsPolicyViolation[];
  readonly diagnostics: StartAppGraphDiagnostics;
}> {}

const shouldReportUnknownRoutePreloadResources = (
  entry: StartAppGraphUnknownRoutePreloadResourcesEntry,
  policy: Required<StartAppGraphRoutePreloadResourcesPolicy>
): boolean =>
  policy.requireDeclaredForPreload &&
  entry.preload === "present" &&
  entry.preloadResources.status === "unknown";

/** Validates resource preload declarations against diagnostics policy. */
export const validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect = (
  diagnostics: StartAppGraphDiagnostics,
  policy: StartAppGraphRoutePreloadResourcesPolicy = {}
): Effect.Effect<void, StartAppGraphUnknownRoutePreloadResources> => {
  const requiredPolicy: Required<StartAppGraphRoutePreloadResourcesPolicy> = {
    requireDeclaredForPreload: policy.requireDeclaredForPreload ?? true
  };
  const unknown = diagnostics.unknownRoutePreloadResources.filter((entry) =>
    shouldReportUnknownRoutePreloadResources(entry, requiredPolicy)
  );

  return unknown.length === 0
    ? Effect.void
    : Effect.fail(new StartAppGraphUnknownRoutePreloadResources({ unknown }));
};

const shouldReportUnknownRoutePreloadCollections = (
  entry: StartAppGraphUnknownRoutePreloadCollectionsEntry,
  policy: Required<StartAppGraphRoutePreloadCollectionsPolicy>
): boolean =>
  policy.requireDeclaredForPreload &&
  entry.preload === "present" &&
  entry.preloadCollections.status === "unknown";

const isEnabledDiagnosticsPolicy = <A>(value: A | false | null | undefined): value is A =>
  value !== undefined && value !== null && value !== false;

/** Collects Start app graph diagnostics policy violations without throwing. */
export const collectStartAppGraphDiagnosticsPolicyViolations = (
  diagnostics: StartAppGraphDiagnostics,
  policy: StartAppGraphDiagnosticsPolicy | false | null | undefined
): readonly StartAppGraphDiagnosticsPolicyViolation[] => {
  if (!isEnabledDiagnosticsPolicy(policy)) {
    return [];
  }

  const violations: StartAppGraphDiagnosticsPolicyViolation[] = [];
  const routePreloadResources = policy.routePreloadResources;
  if (isEnabledDiagnosticsPolicy(routePreloadResources)) {
    const requiredPolicy: Required<StartAppGraphRoutePreloadResourcesPolicy> = {
      requireDeclaredForPreload: routePreloadResources.requireDeclaredForPreload ?? true
    };
    const routes = diagnostics.unknownRoutePreloadResources.filter((entry) =>
      shouldReportUnknownRoutePreloadResources(entry, requiredPolicy)
    );
    if (routes.length > 0) {
      violations.push({
        _tag: "UnknownRoutePreloadResources",
        message: "Routes with preload must declare preloadResources.",
        routes
      });
    }
  }

  const routePreloadCollections = policy.routePreloadCollections;
  if (isEnabledDiagnosticsPolicy(routePreloadCollections)) {
    const requiredPolicy: Required<StartAppGraphRoutePreloadCollectionsPolicy> = {
      requireDeclaredForPreload: routePreloadCollections.requireDeclaredForPreload ?? true
    };
    const routes = diagnostics.unknownRoutePreloadCollections.filter((entry) =>
      shouldReportUnknownRoutePreloadCollections(entry, requiredPolicy)
    );
    if (routes.length > 0) {
      violations.push({
        _tag: "UnknownRoutePreloadCollections",
        message: "Routes with preload must declare preloadCollections.",
        routes
      });
    }
  }

  return violations;
};

/** Formats one diagnostics policy violation for errors and CLI output. */
export const formatStartAppGraphDiagnosticsPolicyViolation = (
  violation: StartAppGraphDiagnosticsPolicyViolation
): string => {
  const routes = violation.routes
    .map((route) => `${route.routePath} (${route.filePath})`)
    .join(", ");
  return `${violation.message} ${routes}`;
};

/** Creates the typed exception for one or more diagnostics policy violations. */
export const createStartAppGraphDiagnosticsPolicyException = (
  diagnostics: StartAppGraphDiagnostics,
  violations: readonly StartAppGraphDiagnosticsPolicyViolation[]
): StartAppGraphDiagnosticsPolicyException =>
  new StartAppGraphDiagnosticsPolicyException({
    message: `Effect UI app graph diagnostics policy failed: ${violations
      .map(formatStartAppGraphDiagnosticsPolicyViolation)
      .join("; ")}`,
    violations,
    diagnostics
  });

/** Enforces diagnostics policy synchronously for generated runtime modules. */
export const enforceStartAppGraphDiagnosticsPolicy = (
  diagnostics: StartAppGraphDiagnostics,
  policy: StartAppGraphDiagnosticsPolicy | false | null | undefined
): readonly StartAppGraphDiagnosticsPolicyViolation[] => {
  const violations = collectStartAppGraphDiagnosticsPolicyViolations(
    diagnostics,
    policy
  );
  if (violations.length > 0) {
    throw createStartAppGraphDiagnosticsPolicyException(diagnostics, violations);
  }

  return violations;
};

/** Effect validation that preserves grouped diagnostics policy violations. */
export const validateStartAppGraphDiagnosticsPolicyExceptionEffect = (
  diagnostics: StartAppGraphDiagnostics,
  policy: StartAppGraphDiagnosticsPolicy | false | null | undefined
): Effect.Effect<readonly StartAppGraphDiagnosticsPolicyViolation[], StartAppGraphDiagnosticsPolicyException> => {
  const violations = collectStartAppGraphDiagnosticsPolicyViolations(
    diagnostics,
    policy
  );
  return violations.length > 0
    ? Effect.fail(createStartAppGraphDiagnosticsPolicyException(diagnostics, violations))
    : Effect.succeed(violations);
};

/** Validates collection preload declarations against diagnostics policy. */
export const validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect = (
  diagnostics: StartAppGraphDiagnostics,
  policy: StartAppGraphRoutePreloadCollectionsPolicy = {}
): Effect.Effect<void, StartAppGraphUnknownRoutePreloadCollections> => {
  const requiredPolicy: Required<StartAppGraphRoutePreloadCollectionsPolicy> = {
    requireDeclaredForPreload: policy.requireDeclaredForPreload ?? true
  };
  const unknown = diagnostics.unknownRoutePreloadCollections.filter((entry) =>
    shouldReportUnknownRoutePreloadCollections(entry, requiredPolicy)
  );

  return unknown.length === 0
    ? Effect.void
    : Effect.fail(new StartAppGraphUnknownRoutePreloadCollections({ unknown }));
};

/** Validates diagnostics policy and fails with the first typed policy error. */
export const validateStartAppGraphDiagnosticsPolicyEffect = (
  diagnostics: StartAppGraphDiagnostics,
  policy: StartAppGraphDiagnosticsPolicy = {}
): Effect.Effect<void, StartAppGraphDiagnosticsPolicyError> =>
  Effect.gen(function* () {
    const violation = collectStartAppGraphDiagnosticsPolicyViolations(diagnostics, policy)[0];
    if (violation === undefined) {
      return;
    }
    switch (violation._tag) {
      case "UnknownRoutePreloadResources":
        return yield* Effect.fail(new StartAppGraphUnknownRoutePreloadResources({
          unknown: violation.routes
        }));
      case "UnknownRoutePreloadCollections":
        return yield* Effect.fail(new StartAppGraphUnknownRoutePreloadCollections({
          unknown: violation.routes
        }));
    }
  });
