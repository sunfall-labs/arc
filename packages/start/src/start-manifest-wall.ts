import type { ActionDefinition, ServerFunction } from "@effect-ui/core";
import { Data, Effect } from "effect";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import {
  createStartAppGraph,
  describeStartAppGraph,
  serializeStartAppGraph as serializeStartAppGraphArtifact,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphWireSchemasEffect,
  type StartAppGraph,
  type StartAppGraphActionBehaviorPolicy,
  type StartAppGraphDiagnosticsPolicy,
  type StartAppGraphDiagnosticsPolicyError,
  type StartAppGraphMissingWireSchemas as StartAppGraphMissingWireSchemasError,
  type StartAppGraphUnknownActionBehavior as StartAppGraphUnknownActionBehaviorError,
  type StartAppGraphWireSchemaPolicy
} from "./app-graph.js";
import {
  actionManifestDefinition,
  makeActionManifest,
  serializeActionManifest,
  type ActionManifest,
  type ActionManifestDefinition,
  type ActionManifestError,
  type ActionManifestSource
} from "./action-manifest.js";
import {
  createFileRouteManifest,
  defaultFileRouteExtensions,
  generateValidatedFileRouteManifestArtifactEffect,
  serializeFileRouteManifest,
  validateFileRouteManifestEffect,
  type FileRouteManifest,
  type FileRouteManifestEntry,
  type FileRouteManifestError,
  type FileRouteManifestOptions
} from "./file-routes.js";
import type { GeneratedFileRouteDefinitionsModuleOptions } from "./file-route-modules.js";
import {
  makeServerFunctionManifest,
  serializeServerFunctionManifest,
  serverFunctionManifestDefinition,
  type ServerFunctionManifest,
  type ServerFunctionManifestDefinition,
  type ServerFunctionManifestError,
  type ServerFunctionManifestSource
} from "./server-function-manifest.js";

/** Options for generated file-route definition modules written by the plugin. */
export interface FileRouteGenerationOptions
  extends GeneratedFileRouteDefinitionsModuleOptions {
  readonly outputFile?: string | false;
}

type AnyActionDefinition = ActionDefinition<any, any, any, any>;

/**
 * Vite plugin options for Start manifests, route discovery, and build policy.
 *
 * Prefer source definitions (`serverFunctions`, `actions`, `fileRoutes`) for
 * small apps and explicit manifests when integrating with generated build
 * steps.
 */
export interface EffectUiStartOptions {
  /** Server functions exported from the server entry using their function names. */
  readonly serverFunctions?: ReadonlyArray<ServerFunction<unknown, unknown>>;
  /** Prebuilt server-function manifest definitions. */
  readonly serverFunctionManifest?: Iterable<ServerFunctionManifestDefinition>;
  /** Server-function sources with explicit module/export references. */
  readonly serverFunctionSources?: Iterable<ServerFunctionManifestSource>;
  /** Start actions exported from the server entry using their action names. */
  readonly actions?: ReadonlyArray<AnyActionDefinition>;
  /** Prebuilt action manifest definitions. */
  readonly actionManifest?: Iterable<ActionManifestDefinition>;
  /** Action sources with explicit module/export references. */
  readonly actionSources?: Iterable<ActionManifestSource>;
  /** File paths to route modules when not using route directory discovery. */
  readonly fileRoutes?: Iterable<string>;
  /** Prebuilt or iterable file-route manifest entries. */
  readonly fileRouteManifest?: FileRouteManifest | Iterable<FileRouteManifestEntry>;
  /** Route parsing and route directory options. */
  readonly fileRouteOptions?: FileRouteManifestOptions;
  /** Controls generated route definition file output. */
  readonly fileRouteGeneration?: FileRouteGenerationOptions;
  /** Server entry module loaded by Vite dev SSR. */
  readonly serverEntry?: string;
  /** Named handler export to load from the server entry. */
  readonly handlerExport?: string;
  /** Build policy to enforce, or true for the default policy. */
  readonly buildPolicy?: StartBuildPolicy | boolean;
}

/** Build-time policies that can fail the build when app graph contracts drift. */
export interface StartBuildPolicy {
  readonly wireSchemas?: StartAppGraphWireSchemaPolicy | false;
  readonly actionBehavior?: StartAppGraphActionBehaviorPolicy | false;
  readonly diagnostics?: StartAppGraphDiagnosticsPolicy | false;
}

export type StartBuildPolicyError =
  | StartAppGraphMissingWireSchemasError
  | StartAppGraphUnknownActionBehaviorError
  | StartAppGraphDiagnosticsPolicyError;

/** Options for discovering file-route modules from a route directory. */
export interface FileRouteDiscoveryOptions {
  readonly root?: string;
  readonly routeDirectory?: string;
  readonly extensions?: readonly string[];
}

export class FileRouteDiscoveryError extends Data.TaggedError(
  "FileRouteDiscoveryError"
)<{
  readonly directory: string;
  readonly cause: unknown;
}> {}

export type StartAppGraphError =
  | ServerFunctionManifestError
  | ActionManifestError
  | FileRouteManifestError;

/** Compile-time define values generated from the Start Manifest Wall. */
export interface StartManifestWallDefineValues {
  readonly __EFFECT_UI_SERVER_FUNCTIONS__: string;
  readonly __EFFECT_UI_ACTIONS__: string;
  readonly __EFFECT_UI_FILE_ROUTES__: string;
  readonly __EFFECT_UI_APP_GRAPH__: string;
}

export const defaultServerEntry = "/src/server.tsx";
export const defaultFileRouteDirectory = "src/routes";
export const defaultFileRouteGeneratedFile = "src/routeTree.gen.ts";
export const defaultStartBuildWireSchemaPolicy: Required<StartAppGraphWireSchemaPolicy> = {
  requireInput: true,
  requireOutput: true,
  requireError: false
};
export const defaultStartBuildPolicy: StartBuildPolicy = {
  wireSchemas: defaultStartBuildWireSchemaPolicy
};

const normalizeDiscoveredFileRoutePath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

const isRouteFileName = (
  fileName: string,
  extensions: readonly string[]
): boolean =>
  !fileName.endsWith(".d.ts") &&
  extensions.some((extension) => fileName.endsWith(extension));

export const absoluteFileRouteDirectory = (
  root: string,
  routeDirectory: string = defaultFileRouteDirectory
): string =>
  isAbsolute(routeDirectory)
    ? routeDirectory
    : resolvePath(root, routeDirectory);

const discoverFileRoutesSync = (
  options: FileRouteDiscoveryOptions = {}
): readonly string[] => {
  const root = resolvePath(options.root ?? process.cwd());
  const routeDirectory = options.routeDirectory ?? defaultFileRouteDirectory;
  const directory = absoluteFileRouteDirectory(root, routeDirectory);
  const extensions = options.extensions ?? defaultFileRouteExtensions;

  if (!existsSync(directory)) {
    return [];
  }

  const discovered: string[] = [];
  const visit = (currentDirectory: string): void => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = resolvePath(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && isRouteFileName(entry.name, extensions)) {
        const routeFilePath = isAbsolute(routeDirectory)
          ? fullPath
          : relativePath(root, fullPath);
        discovered.push(normalizeDiscoveredFileRoutePath(routeFilePath));
      }
    }
  };

  visit(directory);
  return discovered.sort();
};

/** Recursively discovers route module files under the configured route directory. */
export const discoverFileRoutesEffect = (
  options: FileRouteDiscoveryOptions = {}
): Effect.Effect<readonly string[], FileRouteDiscoveryError> => {
  const root = resolvePath(options.root ?? process.cwd());
  const routeDirectory = options.routeDirectory ?? defaultFileRouteDirectory;
  const directory = absoluteFileRouteDirectory(root, routeDirectory);

  return Effect.try({
    try: () => discoverFileRoutesSync(options),
    catch: (cause) => new FileRouteDiscoveryError({ directory, cause })
  });
};

/** Synchronous facade for Vite hooks and other sync host boundaries. */
export const discoverFileRoutes = (
  options: FileRouteDiscoveryOptions = {}
): readonly string[] =>
  Effect.runSync(discoverFileRoutesEffect(options));

const serverFunctionDefinitionsFromOptions = (
  options: EffectUiStartOptions,
  serverEntry: string
): Iterable<ServerFunctionManifestDefinition> => {
  if (options.serverFunctionManifest) {
    return options.serverFunctionManifest;
  }

  if (options.serverFunctionSources) {
    return Array.from(options.serverFunctionSources, (source) =>
      serverFunctionManifestDefinition(source.fn, source)
    );
  }

  return Array.from(options.serverFunctions ?? [], (fn) =>
    serverFunctionManifestDefinition(fn, {
      module: serverEntry,
      exportName: fn.name
    })
  );
};

const actionDefinitionsFromOptions = (
  options: EffectUiStartOptions,
  serverEntry: string
): Iterable<ActionManifestDefinition> => {
  if (options.actionManifest) {
    return options.actionManifest;
  }

  if (options.actionSources) {
    return Array.from(options.actionSources, (source) =>
      actionManifestDefinition(source.action, source)
    );
  }

  return Array.from(options.actions ?? [], (action) =>
    actionManifestDefinition(action, {
      module: serverEntry,
      exportName: action.name
    })
  );
};

/** Builds the server-function manifest from plugin options. */
export const makeStartServerFunctionManifestEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<ServerFunctionManifest, ServerFunctionManifestError> => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  return makeServerFunctionManifest(
    serverFunctionDefinitionsFromOptions(options, serverEntry)
  );
};

/** Synchronously serializes the Start server-function manifest. */
export const serializeStartServerFunctionManifest = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartServerFunctionManifestEffect(options), serializeServerFunctionManifest)
  );

/** Builds the Start action manifest from plugin options. */
export const makeStartActionManifestEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<ActionManifest, ActionManifestError> => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  return makeActionManifest(actionDefinitionsFromOptions(options, serverEntry));
};

/** Synchronously serializes the Start action manifest. */
export const serializeStartActionManifest = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartActionManifestEffect(options), serializeActionManifest)
  );

const isFileRouteManifest = (value: unknown): value is FileRouteManifest =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly version?: unknown }).version === 1 &&
  Array.isArray((value as { readonly entries?: unknown }).entries);

const withDefaultFileRouteDirectory = (
  options: EffectUiStartOptions
): EffectUiStartOptions => {
  if (
    options.fileRouteOptions?.routeDirectory !== undefined ||
    (options.fileRouteManifest !== undefined && isFileRouteManifest(options.fileRouteManifest))
  ) {
    return options;
  }

  return {
    ...options,
    fileRouteOptions: {
      ...options.fileRouteOptions,
      routeDirectory: defaultFileRouteDirectory
    }
  };
};

export const withDiscoveredFileRoutes = (
  options: EffectUiStartOptions,
  root: string
): EffectUiStartOptions =>
  Effect.runSync(withDiscoveredFileRoutesEffect(options, root));

export const withDiscoveredFileRoutesEffect = (
  options: EffectUiStartOptions,
  root: string
): Effect.Effect<EffectUiStartOptions, FileRouteDiscoveryError> => {
  const next = withDefaultFileRouteDirectory(options);
  if (next.fileRouteManifest !== undefined || next.fileRoutes !== undefined) {
    return Effect.succeed(next);
  }

  const fileRouteOptions = next.fileRouteOptions;
  return Effect.map(
    discoverFileRoutesEffect({
      root,
      ...(fileRouteOptions?.routeDirectory === undefined
        ? {}
        : { routeDirectory: fileRouteOptions.routeDirectory }),
      ...(fileRouteOptions?.extensions === undefined
        ? {}
        : { extensions: fileRouteOptions.extensions })
    }),
    (fileRoutes) => ({
      ...next,
      fileRoutes
    })
  );
};

/** Builds or validates the Start file-route manifest from plugin options. */
export const makeStartFileRouteManifestEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<FileRouteManifest, FileRouteManifestError> => {
  const manifest = options.fileRouteManifest;
  if (manifest) {
    const routeDirectory = isFileRouteManifest(manifest)
      ? manifest.routeDirectory
      : options.fileRouteOptions?.routeDirectory;
    const fileRouteOptions = {
      ...options.fileRouteOptions,
      ...(routeDirectory === undefined ? {} : { routeDirectory })
    };
    const entries = isFileRouteManifest(manifest) ? manifest.entries : manifest;
    const modules = isFileRouteManifest(manifest) && Array.isArray(manifest.modules)
      ? manifest.modules
      : [];

    return Effect.map(validateFileRouteManifestEffect(entries, modules), (entries) =>
      createFileRouteManifest(entries, fileRouteOptions, modules)
    );
  }

  if (options.fileRoutes) {
    return generateValidatedFileRouteManifestArtifactEffect(
      options.fileRoutes,
      options.fileRouteOptions
    );
  }

  return Effect.succeed(createFileRouteManifest([], options.fileRouteOptions));
};

/** Synchronously serializes the Start file-route manifest. */
export const serializeStartFileRouteManifest = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartFileRouteManifestEffect(options), serializeFileRouteManifest)
  );

/** Combines route, server-function, and action manifests into a Start app graph. */
export const makeStartAppGraphEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<StartAppGraph, StartAppGraphError> =>
  Effect.gen(function* () {
    const serverFunctions = yield* makeStartServerFunctionManifestEffect(options);
    const actions = yield* makeStartActionManifestEffect(options);
    const routes = yield* makeStartFileRouteManifestEffect(options);

    return createStartAppGraph({
      routes,
      serverFunctions,
      actions
    });
  });

export const normalizeStartBuildPolicy = (
  policy: EffectUiStartOptions["buildPolicy"]
): StartBuildPolicy | undefined => {
  if (policy === undefined || policy === false) {
    return undefined;
  }

  return policy === true ? defaultStartBuildPolicy : policy;
};

/** Applies configured build policies to a resolved Start app graph. */
export const validateStartBuildPolicyEffect = (
  graph: StartAppGraph,
  policy: StartBuildPolicy = defaultStartBuildPolicy
): Effect.Effect<void, StartBuildPolicyError> =>
  Effect.gen(function* () {
    const wireSchemas = policy.wireSchemas;
    if (wireSchemas !== false) {
      yield* validateStartAppGraphWireSchemasEffect(
        graph,
        wireSchemas ?? defaultStartBuildWireSchemaPolicy
      );
    }

    const actionBehavior = policy.actionBehavior;
    if (actionBehavior !== undefined && actionBehavior !== false) {
      yield* validateStartAppGraphActionBehaviorEffect(graph, actionBehavior);
    }

    const diagnostics = policy.diagnostics;
    if (diagnostics !== undefined && diagnostics !== false) {
      yield* validateStartAppGraphDiagnosticsPolicyEffect(
        describeStartAppGraph(graph),
        diagnostics
      );
    }
  });

/** Builds the app graph and applies any enabled build policy. */
export const makeStartBuildAppGraphEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<StartAppGraph, StartAppGraphError | StartBuildPolicyError> =>
  Effect.gen(function* () {
    const graph = yield* makeStartAppGraphEffect(options);
    const policy = normalizeStartBuildPolicy(options.buildPolicy);
    if (policy !== undefined) {
      yield* validateStartBuildPolicyEffect(graph, policy);
    }

    return graph;
  });

/** Synchronously serializes the policy-checked Start app graph. */
export const serializeStartAppGraph = (
  options: EffectUiStartOptions = {}
): string =>
  Effect.runSync(
    Effect.map(makeStartBuildAppGraphEffect(options), serializeStartAppGraphArtifact)
  );

/** Creates the production define values for a policy-checked Start app graph. */
export const createStartManifestWallDefineValues = (
  graph: StartAppGraph
): StartManifestWallDefineValues => ({
  __EFFECT_UI_SERVER_FUNCTIONS__: serializeServerFunctionManifest(graph.serverFunctions),
  __EFFECT_UI_ACTIONS__: serializeActionManifest(graph.actions),
  __EFFECT_UI_FILE_ROUTES__: serializeFileRouteManifest(graph.routes),
  __EFFECT_UI_APP_GRAPH__: serializeStartAppGraphArtifact(graph)
});

/** Builds the production define values from plugin options. */
export const makeStartManifestWallDefineValuesEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<StartManifestWallDefineValues, StartAppGraphError | StartBuildPolicyError> =>
  Effect.map(makeStartBuildAppGraphEffect(options), createStartManifestWallDefineValues);
