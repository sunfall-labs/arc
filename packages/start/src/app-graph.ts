import { Data, Effect } from "effect";
import { Collection } from "@effect-ui/db";
import type { ActionManifest, ActionManifestError, ActionManifestParseError } from "./action-manifest.js";
import { deserializeActionManifest, serializeActionManifest } from "./action-manifest.js";
import type { FileRouteManifest, FileRouteManifestError, FileRouteManifestParseError } from "./file-routes.js";
import { deserializeFileRouteManifest, serializeFileRouteManifest } from "./file-routes.js";
import type {
  ServerFunctionManifest,
  ServerFunctionManifestError,
  ServerFunctionManifestParseError
} from "./server-function-manifest.js";
import { deserializeServerFunctionManifest, serializeServerFunctionManifest } from "./server-function-manifest.js";

/** Static Start app graph artifact combining route, server function, and action manifests. */
export interface StartAppGraph {
  /** Graph schema version. */
  readonly version: 1;
  /** File-route manifest used for generated routes and diagnostics. */
  readonly routes: FileRouteManifest;
  /** Server function manifest used for RPC diagnostics. */
  readonly serverFunctions: ServerFunctionManifest;
  /** Action manifest used for action transport diagnostics. */
  readonly actions: ActionManifest;
}

/** Inputs for creating a Start app graph artifact. */
export interface StartAppGraphOptions {
  readonly routes: FileRouteManifest;
  readonly serverFunctions: ServerFunctionManifest;
  readonly actions: ActionManifest;
}

/** Count of total definitions and schemas present on wire-facing contracts. */
export interface StartAppGraphSchemaCoverage {
  readonly total: number;
  readonly input: number;
  readonly output: number;
  readonly error: number;
}

/** Whether a route feature is statically present, absent, or unknown until runtime. */
export type StartAppGraphRouteFeaturePresence = "present" | "absent" | "unknown";

/** Route-module diagnostics projected from static file routes and loaded runtime routes. */
export interface StartAppGraphRouteDiagnostics {
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
  readonly paramsSchema: StartAppGraphRouteFeaturePresence;
  readonly searchSchema: StartAppGraphRouteFeaturePresence;
  readonly preload: StartAppGraphRouteFeaturePresence;
  readonly preloadResources: import("@effect-ui/core").Route.PreloadResourceDiagnostics;
  readonly preloadCollections: import("@effect-ui/core").Route.PreloadCollectionDiagnostics;
  readonly component: StartAppGraphRouteFeaturePresence;
}

/** Wire schema fields tracked for server function and action contracts. */
export type StartAppGraphWireSchemaField = "input" | "output" | "error";

/** Schema completeness diagnostics for one wire-facing contract. */
export interface StartAppGraphWireDiagnostics {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
  readonly complete: boolean;
  readonly missing: readonly StartAppGraphWireSchemaField[];
}

/** Server function diagnostics used by app graph virtual modules and devtools. */
export interface StartAppGraphServerFunctionDiagnostics {
  readonly id: string;
  readonly name: string;
  readonly server: {
    readonly module: string;
    readonly exportName: string;
    readonly moduleKind: ServerFunctionManifest["entries"][number]["server"]["moduleKind"];
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
        readonly moduleKind: Extract<
          ServerFunctionManifest["entries"][number]["client"],
          { readonly _tag: "Import" }
        >["moduleKind"];
      };
  readonly wire: StartAppGraphWireDiagnostics;
}

/** Action diagnostics used by app graph virtual modules and devtools. */
export interface StartAppGraphActionDiagnostics {
  readonly id: string;
  readonly name: string;
  readonly server: {
    readonly module: string;
    readonly exportName: string;
    readonly moduleKind: ActionManifest["entries"][number]["server"]["moduleKind"];
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
        readonly moduleKind: Extract<
          ActionManifest["entries"][number]["client"],
          { readonly _tag: "Import" }
        >["moduleKind"];
      };
  readonly wire: StartAppGraphWireDiagnostics;
  readonly behavior: ActionManifest["entries"][number]["behavior"];
}

/** Resource family diagnostics included in the Start app graph. */
export type StartAppGraphResourceFamilyDiagnostics =
  import("@effect-ui/core").Resource.FamilyDiagnostics;

/** Resource tag diagnostics included in the Start app graph. */
export type StartAppGraphResourceTagDiagnostics =
  import("@effect-ui/core").Resource.TagDiagnostics;

/** Collection diagnostics included in the Start app graph. */
export type StartAppGraphCollectionDiagnostics =
  import("@effect-ui/db").Collection.DefinitionDiagnostics;

/** Reads collection definition diagnostics through Start's DB dependency. */
export const startAppGraphCollectionDefinitions = (): readonly StartAppGraphCollectionDiagnostics[] =>
  Collection.diagnostics().collections;

/** Contract missing one or more input/output/error schemas. */
export interface StartAppGraphMissingSchema {
  readonly kind: "serverFunction" | "action";
  readonly name: string;
  readonly input: boolean;
  readonly output: boolean;
  readonly error: boolean;
}

/** Action whose static behavior cannot be fully described. */
export interface StartAppGraphUnknownActionBehaviorEntry {
  readonly kind: "action";
  readonly name: string;
  readonly invalidates: ActionManifest["entries"][number]["behavior"]["invalidates"];
  readonly optimistic: ActionManifest["entries"][number]["behavior"]["optimistic"];
  readonly retry: ActionManifest["entries"][number]["behavior"]["retry"];
  readonly concurrency: ActionManifest["entries"][number]["behavior"]["concurrency"];
}

/** Route whose preload resource declarations are unknown or incomplete. */
export interface StartAppGraphUnknownRoutePreloadResourcesEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: StartAppGraphRouteFeaturePresence;
  readonly preloadResources: import("@effect-ui/core").Route.PreloadResourceDiagnostics;
}

/** Route whose preload collection declarations are unknown or incomplete. */
export interface StartAppGraphUnknownRoutePreloadCollectionsEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: StartAppGraphRouteFeaturePresence;
  readonly preloadCollections: import("@effect-ui/core").Route.PreloadCollectionDiagnostics;
}

/** Full diagnostic projection of a Start app graph for LSPs, CI, and devtools. */
export interface StartAppGraphDiagnostics {
  readonly version: 1;
  readonly routeCount: number;
  readonly serverFunctionCount: number;
  readonly actionCount: number;
  readonly routePaths: readonly string[];
  readonly routeModules: readonly StartAppGraphRouteDiagnostics[];
  readonly serverFunctionModules: readonly StartAppGraphServerFunctionDiagnostics[];
  readonly actionModules: readonly StartAppGraphActionDiagnostics[];
  readonly resourceFamilies: readonly StartAppGraphResourceFamilyDiagnostics[];
  readonly resourceTags: readonly StartAppGraphResourceTagDiagnostics[];
  readonly collectionDefinitions: readonly StartAppGraphCollectionDiagnostics[];
  readonly serverOnlyModules: readonly string[];
  readonly browserClientModules: readonly string[];
  readonly rpcPath: string;
  readonly actionPath: string;
  readonly schemaCoverage: {
    readonly serverFunctions: StartAppGraphSchemaCoverage;
    readonly actions: StartAppGraphSchemaCoverage;
  };
  readonly missingSchemas: readonly StartAppGraphMissingSchema[];
  readonly unknownActionBehavior: readonly StartAppGraphUnknownActionBehaviorEntry[];
  readonly unknownRoutePreloadResources: readonly StartAppGraphUnknownRoutePreloadResourcesEntry[];
  readonly unknownRoutePreloadCollections: readonly StartAppGraphUnknownRoutePreloadCollectionsEntry[];
}

/**
 * Runtime route candidate used to enrich static app graph diagnostics with
 * route-module features discovered from loaded route definitions.
 *
 * Includes preload resource and collection diagnostics from the runtime route
 * object.
 */
export interface StartAppGraphRouteDiagnosticsRuntimeCandidate {
  readonly entry: FileRouteManifest["entries"][number];
  readonly route: {
    readonly options?: {
      readonly params?: unknown;
      readonly search?: unknown;
      readonly preload?: unknown;
      readonly component?: unknown;
    };
  };
  readonly preloadResources: import("@effect-ui/core").Route.PreloadResourceDiagnostics;
  readonly preloadCollections: import("@effect-ui/core").Route.PreloadCollectionDiagnostics;
}

export interface StartAppGraphDiagnosticsRuntimeCandidates {
  readonly routeModules?: Iterable<StartAppGraphRouteDiagnosticsRuntimeCandidate>;
  readonly resourceFamilies?: readonly StartAppGraphResourceFamilyDiagnostics[];
  readonly resourceTags?: readonly StartAppGraphResourceTagDiagnostics[];
  readonly collectionDefinitions?: readonly StartAppGraphCollectionDiagnostics[];
}

export interface StartAppGraphWireSchemaPolicy {
  readonly requireInput?: boolean;
  readonly requireOutput?: boolean;
  readonly requireError?: boolean;
}

export interface StartAppGraphActionBehaviorPolicy {
  readonly requireInvalidates?: boolean;
  readonly requireOptimistic?: boolean;
  readonly requireRetry?: boolean;
  readonly requireConcurrency?: boolean;
}

export interface StartAppGraphRoutePreloadResourcesPolicy {
  readonly requireDeclaredForPreload?: boolean;
}

export interface StartAppGraphRoutePreloadCollectionsPolicy {
  readonly requireDeclaredForPreload?: boolean;
}

export interface StartAppGraphDiagnosticsPolicy {
  readonly routePreloadResources?: StartAppGraphRoutePreloadResourcesPolicy | false;
  readonly routePreloadCollections?: StartAppGraphRoutePreloadCollectionsPolicy | false;
}

export class StartAppGraphParseError extends Data.TaggedError(
  "StartAppGraphParseError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class StartAppGraphMissingWireSchemas extends Data.TaggedError(
  "StartAppGraphMissingWireSchemas"
)<{
  readonly missing: readonly StartAppGraphMissingSchema[];
}> {}

export class StartAppGraphUnknownActionBehavior extends Data.TaggedError(
  "StartAppGraphUnknownActionBehavior"
)<{
  readonly unknown: readonly StartAppGraphUnknownActionBehaviorEntry[];
}> {}

export class StartAppGraphUnknownRoutePreloadResources extends Data.TaggedError(
  "StartAppGraphUnknownRoutePreloadResources"
)<{
  readonly unknown: readonly StartAppGraphUnknownRoutePreloadResourcesEntry[];
}> {}

export class StartAppGraphUnknownRoutePreloadCollections extends Data.TaggedError(
  "StartAppGraphUnknownRoutePreloadCollections"
)<{
  readonly unknown: readonly StartAppGraphUnknownRoutePreloadCollectionsEntry[];
}> {}

export type StartAppGraphDiagnosticsPolicyError =
  | StartAppGraphUnknownRoutePreloadResources
  | StartAppGraphUnknownRoutePreloadCollections;

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

export class StartAppGraphDiagnosticsPolicyException extends Data.TaggedError(
  "StartAppGraphDiagnosticsPolicyError"
)<{
  readonly message: string;
  readonly violations: readonly StartAppGraphDiagnosticsPolicyViolation[];
  readonly diagnostics: StartAppGraphDiagnostics;
}> {}

export class StartAppGraphDiagnosticsDtoError extends Data.TaggedError(
  "StartAppGraphDiagnosticsDtoError"
)<{
  readonly message: string;
  readonly value: unknown;
}> {}

export interface StartAppGraphDiagnosticsDtoInput {
  readonly diagnostics: unknown;
  readonly diagnosticsPolicyViolations?: unknown;
}

export interface StartAppGraphDiagnosticsDto {
  readonly diagnostics: StartAppGraphDiagnostics;
  readonly diagnosticsPolicyViolations: readonly StartAppGraphDiagnosticsPolicyViolation[];
}

export type StartAppGraphDeserializeError =
  | StartAppGraphParseError
  | FileRouteManifestParseError
  | FileRouteManifestError
  | ServerFunctionManifestParseError
  | ServerFunctionManifestError
  | ActionManifestParseError
  | ActionManifestError;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const diagnosticsDtoError = (
  message: string,
  value: unknown
): StartAppGraphDiagnosticsDtoError =>
  new StartAppGraphDiagnosticsDtoError({ message, value });

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isFeaturePresence = (
  value: unknown
): value is StartAppGraphRouteFeaturePresence =>
  value === "present" || value === "absent" || value === "unknown";

const isWireSchemaField = (
  value: unknown
): value is StartAppGraphWireSchemaField =>
  value === "input" || value === "output" || value === "error";

const isRouteParamDiagnostics = (
  value: unknown
): value is StartAppGraphRouteDiagnostics["params"][number] =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.optional === "boolean";

const isPreloadResourceDiagnostics = (
  value: unknown
): value is import("@effect-ui/core").Route.PreloadResourceDiagnostics =>
  isRecord(value) &&
  typeof value.status === "string" &&
  isStringArray(value.families);

const isPreloadCollectionDiagnostics = (
  value: unknown
): value is import("@effect-ui/core").Route.PreloadCollectionDiagnostics =>
  isRecord(value) &&
  typeof value.status === "string" &&
  isStringArray(value.collections);

const isResourceFamilyDiagnostics = (
  value: unknown
): value is StartAppGraphResourceFamilyDiagnostics =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.inputSchema === "boolean" &&
  typeof value.outputSchema === "boolean" &&
  typeof value.errorSchema === "boolean" &&
  typeof value.providesTags === "boolean" &&
  isRecord(value.policy) &&
  typeof value.policy.retry === "boolean";

const isResourceTagDiagnostics = (
  value: unknown
): value is StartAppGraphResourceTagDiagnostics =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.keyed === "boolean";

const isCollectionIndexDiagnostics = (
  value: unknown
): value is StartAppGraphCollectionDiagnostics["indexes"][number] =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.unique === "boolean";

const isCollectionHandlersDiagnostics = (
  value: unknown
): value is StartAppGraphCollectionDiagnostics["handlers"] =>
  isRecord(value) &&
  typeof value.insert === "boolean" &&
  typeof value.update === "boolean" &&
  typeof value.delete === "boolean";

const isCollectionPolicyDiagnostics = (
  value: unknown
): value is StartAppGraphCollectionDiagnostics["policy"] =>
  isRecord(value) &&
  typeof value.retry === "boolean";

const isCollectionPersistenceDiagnostics = (
  value: unknown
): value is StartAppGraphCollectionDiagnostics["persistence"] =>
  isRecord(value) &&
  typeof value.enabled === "boolean" &&
  (value.key === undefined || typeof value.key === "string") &&
  typeof value.hydrate === "boolean" &&
  typeof value.restoreOnPreload === "boolean" &&
  typeof value.loadAfterRestore === "boolean" &&
  typeof value.persistOnLoad === "boolean" &&
  typeof value.persistOnMutation === "boolean" &&
  typeof value.persistOnWrite === "boolean";

const isCollectionSyncDiagnostics = (
  value: unknown
): value is NonNullable<StartAppGraphCollectionDiagnostics["sync"]> =>
  isRecord(value) &&
  typeof value.adapter === "string";

const isCollectionDefinitionDiagnostics = (
  value: unknown
): value is StartAppGraphCollectionDiagnostics =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.inputSchema === "boolean" &&
  typeof value.outputSchema === "boolean" &&
  typeof value.initialData === "boolean" &&
  Array.isArray(value.indexes) &&
  value.indexes.every(isCollectionIndexDiagnostics) &&
  typeof value.load === "boolean" &&
  isCollectionHandlersDiagnostics(value.handlers) &&
  isCollectionPolicyDiagnostics(value.policy) &&
  (value.sync === undefined || isCollectionSyncDiagnostics(value.sync)) &&
  isCollectionPersistenceDiagnostics(value.persistence);

const isRouteDiagnostics = (
  value: unknown
): value is StartAppGraphRouteDiagnostics =>
  isRecord(value) &&
  typeof value.routeId === "string" &&
  typeof value.routePath === "string" &&
  typeof value.moduleId === "string" &&
  typeof value.filePath === "string" &&
  typeof value.pathParamCount === "number" &&
  typeof value.hasPathParams === "boolean" &&
  Array.isArray(value.params) &&
  value.params.every(isRouteParamDiagnostics) &&
  isFeaturePresence(value.paramsSchema) &&
  isFeaturePresence(value.searchSchema) &&
  isFeaturePresence(value.preload) &&
  isPreloadResourceDiagnostics(value.preloadResources) &&
  isPreloadCollectionDiagnostics(value.preloadCollections) &&
  isFeaturePresence(value.component);

const isWireDiagnostics = (
  value: unknown
): value is StartAppGraphWireDiagnostics =>
  isRecord(value) &&
  typeof value.inputSchema === "boolean" &&
  typeof value.outputSchema === "boolean" &&
  typeof value.errorSchema === "boolean" &&
  typeof value.complete === "boolean" &&
  Array.isArray(value.missing) &&
  value.missing.every(isWireSchemaField);

const isServerFunctionDiagnostics = (
  value: unknown
): value is StartAppGraphServerFunctionDiagnostics => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isRecord(value.server) ||
    typeof value.server.module !== "string" ||
    typeof value.server.exportName !== "string" ||
    typeof value.server.moduleKind !== "string" ||
    typeof value.server.hasHandler !== "boolean" ||
    !isRecord(value.client) ||
    !isWireDiagnostics(value.wire)
  ) {
    return false;
  }

  if (value.client._tag === "Rpc") {
    return typeof value.client.rpcPath === "string";
  }

  return value.client._tag === "Import" &&
    typeof value.client.rpcPath === "string" &&
    typeof value.client.module === "string" &&
    typeof value.client.exportName === "string" &&
    typeof value.client.moduleKind === "string";
};

const isActionDiagnostics = (
  value: unknown
): value is StartAppGraphActionDiagnostics => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isRecord(value.server) ||
    typeof value.server.module !== "string" ||
    typeof value.server.exportName !== "string" ||
    typeof value.server.moduleKind !== "string" ||
    !isRecord(value.client) ||
    !isWireDiagnostics(value.wire) ||
    !isRecord(value.behavior) ||
    typeof value.behavior.invalidates !== "string" ||
    typeof value.behavior.optimistic !== "string" ||
    typeof value.behavior.retry !== "string" ||
    typeof value.behavior.concurrency !== "string"
  ) {
    return false;
  }

  if (value.client._tag === "Post") {
    return typeof value.client.actionPath === "string";
  }

  return value.client._tag === "Import" &&
    typeof value.client.actionPath === "string" &&
    typeof value.client.module === "string" &&
    typeof value.client.exportName === "string" &&
    typeof value.client.moduleKind === "string";
};

const isSchemaCoverage = (
  value: unknown
): value is StartAppGraphSchemaCoverage =>
  isRecord(value) &&
  typeof value.total === "number" &&
  typeof value.input === "number" &&
  typeof value.output === "number" &&
  typeof value.error === "number";

const isMissingSchemaDiagnostics = (
  value: unknown
): value is StartAppGraphMissingSchema =>
  isRecord(value) &&
  (value.kind === "serverFunction" || value.kind === "action") &&
  typeof value.name === "string" &&
  typeof value.input === "boolean" &&
  typeof value.output === "boolean" &&
  typeof value.error === "boolean";

const isUnknownActionBehaviorDiagnostics = (
  value: unknown
): value is StartAppGraphUnknownActionBehaviorEntry =>
  isRecord(value) &&
  value.kind === "action" &&
  typeof value.name === "string" &&
  typeof value.invalidates === "string" &&
  typeof value.optimistic === "string" &&
  typeof value.retry === "string" &&
  typeof value.concurrency === "string";

const isUnknownRoutePreloadResourcesDiagnostics = (
  value: unknown
): value is StartAppGraphUnknownRoutePreloadResourcesEntry =>
  isRecord(value) &&
  value.kind === "route" &&
  typeof value.routeId === "string" &&
  typeof value.routePath === "string" &&
  typeof value.moduleId === "string" &&
  typeof value.filePath === "string" &&
  isFeaturePresence(value.preload) &&
  isPreloadResourceDiagnostics(value.preloadResources);

const isUnknownRoutePreloadCollectionsDiagnostics = (
  value: unknown
): value is StartAppGraphUnknownRoutePreloadCollectionsEntry =>
  isRecord(value) &&
  value.kind === "route" &&
  typeof value.routeId === "string" &&
  typeof value.routePath === "string" &&
  typeof value.moduleId === "string" &&
  typeof value.filePath === "string" &&
  isFeaturePresence(value.preload) &&
  isPreloadCollectionDiagnostics(value.preloadCollections);

const isStartAppGraphDiagnostics = (
  value: unknown
): value is StartAppGraphDiagnostics =>
  isRecord(value) &&
  value.version === 1 &&
  typeof value.routeCount === "number" &&
  typeof value.serverFunctionCount === "number" &&
  typeof value.actionCount === "number" &&
  isStringArray(value.routePaths) &&
  Array.isArray(value.routeModules) &&
  value.routeModules.every(isRouteDiagnostics) &&
  Array.isArray(value.serverFunctionModules) &&
  value.serverFunctionModules.every(isServerFunctionDiagnostics) &&
  Array.isArray(value.actionModules) &&
  value.actionModules.every(isActionDiagnostics) &&
  Array.isArray(value.resourceFamilies) &&
  value.resourceFamilies.every(isResourceFamilyDiagnostics) &&
  Array.isArray(value.resourceTags) &&
  value.resourceTags.every(isResourceTagDiagnostics) &&
  Array.isArray(value.collectionDefinitions) &&
  value.collectionDefinitions.every(isCollectionDefinitionDiagnostics) &&
  isStringArray(value.serverOnlyModules) &&
  isStringArray(value.browserClientModules) &&
  typeof value.rpcPath === "string" &&
  typeof value.actionPath === "string" &&
  isRecord(value.schemaCoverage) &&
  isSchemaCoverage(value.schemaCoverage.serverFunctions) &&
  isSchemaCoverage(value.schemaCoverage.actions) &&
  Array.isArray(value.missingSchemas) &&
  value.missingSchemas.every(isMissingSchemaDiagnostics) &&
  Array.isArray(value.unknownActionBehavior) &&
  value.unknownActionBehavior.every(isUnknownActionBehaviorDiagnostics) &&
  Array.isArray(value.unknownRoutePreloadResources) &&
  value.unknownRoutePreloadResources.every(isUnknownRoutePreloadResourcesDiagnostics) &&
  Array.isArray(value.unknownRoutePreloadCollections) &&
  value.unknownRoutePreloadCollections.every(isUnknownRoutePreloadCollectionsDiagnostics);

const isStartAppGraphDiagnosticsPolicyViolation = (
  value: unknown
): value is StartAppGraphDiagnosticsPolicyViolation =>
  isRecord(value) &&
  typeof value.message === "string" &&
  (
    value._tag === "UnknownRoutePreloadResources"
      ? Array.isArray(value.routes) &&
        value.routes.every(isUnknownRoutePreloadResourcesDiagnostics)
      : value._tag === "UnknownRoutePreloadCollections" &&
        Array.isArray(value.routes) &&
        value.routes.every(isUnknownRoutePreloadCollectionsDiagnostics)
  );

export const decodeStartAppGraphDiagnosticsEffect = (
  value: unknown
): Effect.Effect<StartAppGraphDiagnostics, StartAppGraphDiagnosticsDtoError> =>
  isStartAppGraphDiagnostics(value)
    ? Effect.succeed(value)
    : Effect.fail(
        diagnosticsDtoError(
          "Expected a Start app graph diagnostics DTO.",
          value
        )
      );

export const decodeStartAppGraphDiagnosticsPolicyViolationsEffect = (
  value: unknown
): Effect.Effect<readonly StartAppGraphDiagnosticsPolicyViolation[], StartAppGraphDiagnosticsDtoError> =>
  Array.isArray(value) && value.every(isStartAppGraphDiagnosticsPolicyViolation)
    ? Effect.succeed(value)
    : Effect.fail(
        diagnosticsDtoError(
          "Expected Start app graph diagnostics policy violations DTOs.",
          value
        )
      );

export const decodeStartAppGraphDiagnosticsDtoEffect = (
  input: StartAppGraphDiagnosticsDtoInput
): Effect.Effect<StartAppGraphDiagnosticsDto, StartAppGraphDiagnosticsDtoError> =>
  Effect.gen(function* () {
    const diagnostics = yield* decodeStartAppGraphDiagnosticsEffect(input.diagnostics);
    const diagnosticsPolicyViolations = yield* decodeStartAppGraphDiagnosticsPolicyViolationsEffect(
      input.diagnosticsPolicyViolations ?? []
    );

    return {
      diagnostics,
      diagnosticsPolicyViolations
    };
  });

export const createStartAppGraph = (
  options: StartAppGraphOptions
): StartAppGraph => ({
  version: 1,
  routes: options.routes,
  serverFunctions: options.serverFunctions,
  actions: options.actions
});

export const serializeStartAppGraph = (graph: StartAppGraph): string =>
  JSON.stringify({
    version: 1,
    routes: JSON.parse(serializeFileRouteManifest(graph.routes)) as FileRouteManifest,
    serverFunctions: JSON.parse(
      serializeServerFunctionManifest(graph.serverFunctions)
    ) as ServerFunctionManifest,
    actions: JSON.parse(serializeActionManifest(graph.actions)) as ActionManifest
  });

const uniqueSorted = (values: Iterable<string>): readonly string[] =>
  Array.from(new Set(values)).sort();

export const describeFileRouteManifestEntry = (
  entry: FileRouteManifest["entries"][number],
  moduleFeatures: {
    readonly paramsSchema?: StartAppGraphRouteFeaturePresence;
    readonly searchSchema?: StartAppGraphRouteFeaturePresence;
    readonly preload?: StartAppGraphRouteFeaturePresence;
    readonly preloadResources?: import("@effect-ui/core").Route.PreloadResourceDiagnostics;
    readonly preloadCollections?: import("@effect-ui/core").Route.PreloadCollectionDiagnostics;
    readonly component?: StartAppGraphRouteFeaturePresence;
  } = {}
): StartAppGraphRouteDiagnostics => ({
  routeId: String(entry.routeId),
  routePath: entry.routePath,
  moduleId: entry.moduleId,
  filePath: entry.filePath,
  pathParamCount: entry.params.length,
  hasPathParams: entry.params.length > 0,
  params: entry.params,
  paramsSchema: moduleFeatures.paramsSchema ?? "unknown",
  searchSchema: moduleFeatures.searchSchema ?? "unknown",
  preload: moduleFeatures.preload ?? "unknown",
  preloadResources: moduleFeatures.preloadResources ?? {
    status: "unknown",
    families: []
  },
  preloadCollections: moduleFeatures.preloadCollections ?? {
    status: "unknown",
    collections: []
  },
  component: moduleFeatures.component ?? "unknown"
});

const runtimeFeaturePresence = (
  value: unknown
): StartAppGraphRouteFeaturePresence =>
  value === undefined ? "absent" : "present";

export const describeStartAppGraphRouteDiagnosticsRuntimeCandidate = (
  candidate: StartAppGraphRouteDiagnosticsRuntimeCandidate
): StartAppGraphRouteDiagnostics =>
  describeFileRouteManifestEntry(candidate.entry, {
    paramsSchema: runtimeFeaturePresence(candidate.route.options?.params),
    searchSchema: runtimeFeaturePresence(candidate.route.options?.search),
    preload: runtimeFeaturePresence(candidate.route.options?.preload),
    preloadResources: candidate.preloadResources,
    preloadCollections: candidate.preloadCollections,
    component: runtimeFeaturePresence(candidate.route.options?.component)
  });

const routeModuleDiagnosticsKey = (
  routeModule: Pick<StartAppGraphRouteDiagnostics, "routeId" | "moduleId">
): string => `${routeModule.routeId}\u0000${routeModule.moduleId}`;

const routeModuleEntryKey = (
  entry: Pick<FileRouteManifest["entries"][number], "routeId" | "moduleId">
): string => `${String(entry.routeId)}\u0000${entry.moduleId}`;

const describeWireContract = (
  wire: { readonly inputSchema: boolean; readonly outputSchema: boolean; readonly errorSchema: boolean }
): StartAppGraphWireDiagnostics => {
  const missing: StartAppGraphWireSchemaField[] = [];
  if (!wire.inputSchema) {
    missing.push("input");
  }
  if (!wire.outputSchema) {
    missing.push("output");
  }
  if (!wire.errorSchema) {
    missing.push("error");
  }

  return {
    inputSchema: wire.inputSchema,
    outputSchema: wire.outputSchema,
    errorSchema: wire.errorSchema,
    complete: missing.length === 0,
    missing
  };
};

export const describeServerFunctionManifestEntry = (
  entry: ServerFunctionManifest["entries"][number]
): StartAppGraphServerFunctionDiagnostics => ({
  id: String(entry.id),
  name: entry.name,
  server: {
    module: entry.server.module,
    exportName: entry.server.exportName,
    moduleKind: entry.server.moduleKind,
    hasHandler: entry.server.hasHandler
  },
  client: entry.client._tag === "Import"
    ? {
        _tag: "Import",
        rpcPath: entry.client.rpcPath,
        module: entry.client.module,
        exportName: entry.client.exportName,
        moduleKind: entry.client.moduleKind
      }
    : {
        _tag: "Rpc",
        rpcPath: entry.client.rpcPath
      },
  wire: describeWireContract(entry.wire)
});

export const describeActionManifestEntry = (
  entry: ActionManifest["entries"][number]
): StartAppGraphActionDiagnostics => ({
  id: String(entry.id),
  name: entry.name,
  server: {
    module: entry.server.module,
    exportName: entry.server.exportName,
    moduleKind: entry.server.moduleKind
  },
  client: entry.client._tag === "Import"
    ? {
        _tag: "Import",
        actionPath: entry.client.actionPath,
        module: entry.client.module,
        exportName: entry.client.exportName,
        moduleKind: entry.client.moduleKind
      }
    : {
        _tag: "Post",
        actionPath: entry.client.actionPath
      },
  wire: describeWireContract(entry.wire),
  behavior: entry.behavior
});

const schemaCoverage = (
  entries: Iterable<{ readonly wire: { readonly inputSchema: boolean; readonly outputSchema: boolean; readonly errorSchema: boolean } }>
): StartAppGraphSchemaCoverage => {
  let total = 0;
  let input = 0;
  let output = 0;
  let error = 0;

  for (const entry of entries) {
    total++;
    input += entry.wire.inputSchema ? 1 : 0;
    output += entry.wire.outputSchema ? 1 : 0;
    error += entry.wire.errorSchema ? 1 : 0;
  }

  return {
    total,
    input,
    output,
    error
  };
};

export const unknownRoutePreloadResourcesForDiagnostics = (
  diagnostics: Pick<StartAppGraphDiagnostics, "routeModules">
): readonly StartAppGraphUnknownRoutePreloadResourcesEntry[] =>
  diagnostics.routeModules
    .filter((routeModule) =>
      routeModule.preload === "present" &&
      routeModule.preloadResources.status === "unknown"
    )
    .map((routeModule): StartAppGraphUnknownRoutePreloadResourcesEntry => ({
      kind: "route",
      routeId: routeModule.routeId,
      routePath: routeModule.routePath,
      moduleId: routeModule.moduleId,
      filePath: routeModule.filePath,
      preload: routeModule.preload,
      preloadResources: routeModule.preloadResources
    }));

export const unknownRoutePreloadCollectionsForDiagnostics = (
  diagnostics: Pick<StartAppGraphDiagnostics, "routeModules">
): readonly StartAppGraphUnknownRoutePreloadCollectionsEntry[] =>
  diagnostics.routeModules
    .filter((routeModule) =>
      routeModule.preload === "present" &&
      routeModule.preloadCollections.status === "unknown"
    )
    .map((routeModule): StartAppGraphUnknownRoutePreloadCollectionsEntry => ({
      kind: "route",
      routeId: routeModule.routeId,
      routePath: routeModule.routePath,
      moduleId: routeModule.moduleId,
      filePath: routeModule.filePath,
      preload: routeModule.preload,
      preloadCollections: routeModule.preloadCollections
    }));

export const describeStartAppGraph = (
  graph: StartAppGraph
): StartAppGraphDiagnostics => {
  const routeModules = graph.routes.entries.map((entry) =>
    describeFileRouteManifestEntry(entry)
  );
  const serverFunctionMissingSchemas = graph.serverFunctions.entries
    .filter((entry) => !entry.wire.inputSchema || !entry.wire.outputSchema || !entry.wire.errorSchema)
    .map((entry): StartAppGraphMissingSchema => ({
      kind: "serverFunction",
      name: entry.name,
      input: entry.wire.inputSchema,
      output: entry.wire.outputSchema,
      error: entry.wire.errorSchema
    }));
  const actionMissingSchemas = graph.actions.entries
    .filter((entry) => !entry.wire.inputSchema || !entry.wire.outputSchema || !entry.wire.errorSchema)
    .map((entry): StartAppGraphMissingSchema => ({
      kind: "action",
      name: entry.name,
      input: entry.wire.inputSchema,
      output: entry.wire.outputSchema,
      error: entry.wire.errorSchema
    }));
  const unknownActionBehavior = graph.actions.entries
    .filter((entry) =>
      entry.behavior.invalidates === "unknown" ||
      entry.behavior.optimistic === "unknown" ||
      entry.behavior.retry === "unknown" ||
      entry.behavior.concurrency === "unknown"
    )
    .map((entry): StartAppGraphUnknownActionBehaviorEntry => ({
      kind: "action",
      name: entry.name,
      invalidates: entry.behavior.invalidates,
      optimistic: entry.behavior.optimistic,
      retry: entry.behavior.retry,
      concurrency: entry.behavior.concurrency
    }));

  return {
    version: 1,
    routeCount: graph.routes.entries.length,
    serverFunctionCount: graph.serverFunctions.entries.length,
    actionCount: graph.actions.entries.length,
    routePaths: graph.routes.entries.map((entry) => entry.routePath),
    routeModules,
    serverFunctionModules: graph.serverFunctions.entries.map((entry) =>
      describeServerFunctionManifestEntry(entry)
    ),
    actionModules: graph.actions.entries.map((entry) =>
      describeActionManifestEntry(entry)
    ),
    resourceFamilies: [],
    resourceTags: [],
    collectionDefinitions: [],
    serverOnlyModules: uniqueSorted([
      ...graph.serverFunctions.entries.flatMap((entry) =>
        entry.server.moduleKind === "server-only" ? [entry.server.module] : []
      ),
      ...graph.actions.entries.flatMap((entry) =>
        entry.server.moduleKind === "server-only" ? [entry.server.module] : []
      )
    ]),
    browserClientModules: uniqueSorted([
      ...graph.serverFunctions.entries.flatMap((entry) =>
        entry.client._tag === "Import" ? [entry.client.module] : []
      ),
      ...graph.actions.entries.flatMap((entry) =>
        entry.client._tag === "Import" ? [entry.client.module] : []
      )
    ]),
    rpcPath: graph.serverFunctions.rpcPath,
    actionPath: graph.actions.actionPath,
    schemaCoverage: {
      serverFunctions: schemaCoverage(graph.serverFunctions.entries),
      actions: schemaCoverage(graph.actions.entries)
    },
    missingSchemas: [...serverFunctionMissingSchemas, ...actionMissingSchemas],
    unknownActionBehavior,
    unknownRoutePreloadResources: unknownRoutePreloadResourcesForDiagnostics({
      routeModules
    }),
    unknownRoutePreloadCollections: unknownRoutePreloadCollectionsForDiagnostics({
      routeModules
    })
  };
};

/**
 * Rebuilds app graph diagnostics from static manifest data plus runtime
 * definition facts.
 *
 * Runtime route candidates enrich matching static route-module placeholders and
 * unknown preload-resource/preload-collection diagnostics are recomputed from
 * the merged static/runtime evidence. Static manifest routes without runtime
 * candidates remain present in the output.
 */
export const describeStartAppGraphRuntimeDiagnostics = (
  graph: StartAppGraph,
  candidates: StartAppGraphDiagnosticsRuntimeCandidates = {}
): StartAppGraphDiagnostics => {
  const staticDiagnostics = describeStartAppGraph(graph);
  const runtimeRouteModules = new Map(
    Array.from(candidates.routeModules ?? [], (candidate) => [
      routeModuleEntryKey(candidate.entry),
      describeStartAppGraphRouteDiagnosticsRuntimeCandidate(candidate)
    ] as const)
  );
  const routeModules = staticDiagnostics.routeModules.map((routeModule) =>
    runtimeRouteModules.get(routeModuleDiagnosticsKey(routeModule)) ?? routeModule
  );

  return {
    ...staticDiagnostics,
    routeModules,
    resourceFamilies: candidates.resourceFamilies ?? staticDiagnostics.resourceFamilies,
    resourceTags: candidates.resourceTags ?? staticDiagnostics.resourceTags,
    collectionDefinitions:
      candidates.collectionDefinitions ?? staticDiagnostics.collectionDefinitions,
    unknownRoutePreloadResources: unknownRoutePreloadResourcesForDiagnostics({
      routeModules
    }),
    unknownRoutePreloadCollections: unknownRoutePreloadCollectionsForDiagnostics({
      routeModules
    })
  };
};

export const describeStartAppGraphEffect = (
  graph: StartAppGraph
): Effect.Effect<StartAppGraphDiagnostics> =>
  Effect.succeed(describeStartAppGraph(graph));

const shouldReportMissingSchema = (
  missing: StartAppGraphMissingSchema,
  policy: Required<StartAppGraphWireSchemaPolicy>
): boolean =>
  (policy.requireInput && !missing.input) ||
  (policy.requireOutput && !missing.output) ||
  (policy.requireError && !missing.error);

export const validateStartAppGraphWireSchemasEffect = (
  graph: StartAppGraph,
  policy: StartAppGraphWireSchemaPolicy = {}
): Effect.Effect<void, StartAppGraphMissingWireSchemas> => {
  const requiredPolicy: Required<StartAppGraphWireSchemaPolicy> = {
    requireInput: policy.requireInput ?? true,
    requireOutput: policy.requireOutput ?? true,
    requireError: policy.requireError ?? false
  };
  const missing = describeStartAppGraph(graph).missingSchemas.filter((entry) =>
    shouldReportMissingSchema(entry, requiredPolicy)
  );

  return missing.length === 0
    ? Effect.void
    : Effect.fail(new StartAppGraphMissingWireSchemas({ missing }));
};

const shouldReportUnknownActionBehavior = (
  entry: StartAppGraphUnknownActionBehaviorEntry,
  policy: Required<StartAppGraphActionBehaviorPolicy>
): boolean =>
  (policy.requireInvalidates && entry.invalidates === "unknown") ||
  (policy.requireOptimistic && entry.optimistic === "unknown") ||
  (policy.requireRetry && entry.retry === "unknown") ||
  (policy.requireConcurrency && entry.concurrency === "unknown");

export const validateStartAppGraphActionBehaviorEffect = (
  graph: StartAppGraph,
  policy: StartAppGraphActionBehaviorPolicy = {}
): Effect.Effect<void, StartAppGraphUnknownActionBehavior> => {
  const requiredPolicy: Required<StartAppGraphActionBehaviorPolicy> = {
    requireInvalidates: policy.requireInvalidates ?? true,
    requireOptimistic: policy.requireOptimistic ?? false,
    requireRetry: policy.requireRetry ?? false,
    requireConcurrency: policy.requireConcurrency ?? true
  };
  const unknown = describeStartAppGraph(graph).unknownActionBehavior.filter((entry) =>
    shouldReportUnknownActionBehavior(entry, requiredPolicy)
  );

  return unknown.length === 0
    ? Effect.void
    : Effect.fail(new StartAppGraphUnknownActionBehavior({ unknown }));
};

const shouldReportUnknownRoutePreloadResources = (
  entry: StartAppGraphUnknownRoutePreloadResourcesEntry,
  policy: Required<StartAppGraphRoutePreloadResourcesPolicy>
): boolean =>
  policy.requireDeclaredForPreload &&
  entry.preload === "present" &&
  entry.preloadResources.status === "unknown";

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

export const formatStartAppGraphDiagnosticsPolicyViolation = (
  violation: StartAppGraphDiagnosticsPolicyViolation
): string => {
  const routes = violation.routes
    .map((route) => `${route.routePath} (${route.filePath})`)
    .join(", ");
  return `${violation.message} ${routes}`;
};

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

const serializeSection = (
  section: unknown,
  name: "routes" | "serverFunctions" | "actions"
): Effect.Effect<string, StartAppGraphParseError> => {
  if (!isRecord(section)) {
    return Effect.fail(
      new StartAppGraphParseError({
        message: `Expected app graph ${name} section to be a manifest record.`
      })
    );
  }

  return Effect.try({
    try: () => JSON.stringify(section),
    catch: (cause) =>
      new StartAppGraphParseError({
        message: `Unable to serialize app graph ${name} section for validation.`,
        cause
      })
  });
};

const decodeSerializedGraph = (
  value: unknown
): Effect.Effect<StartAppGraph, StartAppGraphDeserializeError> =>
  Effect.gen(function* () {
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !isRecord(value.routes) ||
      !isRecord(value.serverFunctions) ||
      !isRecord(value.actions)
    ) {
      return yield* Effect.fail(
        new StartAppGraphParseError({
          message: "Expected a version 1 Start app graph."
        })
      );
    }

    const routes = yield* serializeSection(value.routes, "routes").pipe(
      Effect.flatMap(deserializeFileRouteManifest)
    );
    const serverFunctions = yield* serializeSection(value.serverFunctions, "serverFunctions").pipe(
      Effect.flatMap(deserializeServerFunctionManifest)
    );
    const actions = yield* serializeSection(value.actions, "actions").pipe(
      Effect.flatMap(deserializeActionManifest)
    );

    return createStartAppGraph({
      routes,
      serverFunctions,
      actions
    });
  });

export const deserializeStartAppGraph = (
  serialized: string
): Effect.Effect<StartAppGraph, StartAppGraphDeserializeError> =>
  Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: (cause) =>
      new StartAppGraphParseError({
        message: "Start app graph is not valid JSON.",
        cause
      })
  }).pipe(Effect.flatMap(decodeSerializedGraph));
