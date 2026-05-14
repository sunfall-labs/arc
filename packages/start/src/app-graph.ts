import { Data, Effect } from "effect";
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

export interface StartAppGraph {
  readonly version: 1;
  readonly routes: FileRouteManifest;
  readonly serverFunctions: ServerFunctionManifest;
  readonly actions: ActionManifest;
}

export interface StartAppGraphOptions {
  readonly routes: FileRouteManifest;
  readonly serverFunctions: ServerFunctionManifest;
  readonly actions: ActionManifest;
}

export interface StartAppGraphSchemaCoverage {
  readonly total: number;
  readonly input: number;
  readonly output: number;
  readonly error: number;
}

export type StartAppGraphRouteFeaturePresence = "present" | "absent" | "unknown";

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

export type StartAppGraphWireSchemaField = "input" | "output" | "error";

export interface StartAppGraphWireDiagnostics {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
  readonly complete: boolean;
  readonly missing: readonly StartAppGraphWireSchemaField[];
}

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

export type StartAppGraphResourceFamilyDiagnostics =
  import("@effect-ui/core").Resource.FamilyDiagnostics;

export type StartAppGraphResourceTagDiagnostics =
  import("@effect-ui/core").Resource.TagDiagnostics;

export type StartAppGraphCollectionDiagnostics =
  import("@effect-ui/db").Collection.DefinitionDiagnostics;

export interface StartAppGraphMissingSchema {
  readonly kind: "serverFunction" | "action";
  readonly name: string;
  readonly input: boolean;
  readonly output: boolean;
  readonly error: boolean;
}

export interface StartAppGraphUnknownActionBehaviorEntry {
  readonly kind: "action";
  readonly name: string;
  readonly invalidates: ActionManifest["entries"][number]["behavior"]["invalidates"];
  readonly optimistic: ActionManifest["entries"][number]["behavior"]["optimistic"];
  readonly retry: ActionManifest["entries"][number]["behavior"]["retry"];
  readonly concurrency: ActionManifest["entries"][number]["behavior"]["concurrency"];
}

export interface StartAppGraphUnknownRoutePreloadResourcesEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: StartAppGraphRouteFeaturePresence;
  readonly preloadResources: import("@effect-ui/core").Route.PreloadResourceDiagnostics;
}

export interface StartAppGraphUnknownRoutePreloadCollectionsEntry {
  readonly kind: "route";
  readonly routeId: string;
  readonly routePath: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly preload: StartAppGraphRouteFeaturePresence;
  readonly preloadCollections: import("@effect-ui/core").Route.PreloadCollectionDiagnostics;
}

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
    const routePreloadResources = policy.routePreloadResources;
    if (routePreloadResources !== undefined && routePreloadResources !== false) {
      yield* validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect(
        diagnostics,
        routePreloadResources
      );
    }
    const routePreloadCollections = policy.routePreloadCollections;
    if (routePreloadCollections !== undefined && routePreloadCollections !== false) {
      yield* validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect(
        diagnostics,
        routePreloadCollections
      );
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
