import type { ActionDefinition, ServerFunction } from "@effect-ui/core";
import { Data, Effect } from "effect";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import {
  createStartAppGraph,
  serializeStartAppGraph as serializeStartAppGraphArtifact,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphWireSchemasEffect,
  type StartAppGraph,
  type StartAppGraphActionBehaviorPolicy,
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
  type FileRouteManifestModule,
  type FileRouteManifestOptions
} from "./file-routes.js";
import type { GeneratedFileRouteDefinitionsModuleOptions } from "./file-route-modules.js";
import type {
  StartAppGraphDiagnosticsPolicy
} from "./start-app-graph-diagnostics-policy.js";
import {
  makeServerFunctionManifest,
  serializeServerFunctionManifest,
  serverFunctionManifestDefinition,
  type ServerFunctionManifest,
  type ServerFunctionManifestDefinition,
  type ServerFunctionManifestError,
  type ServerFunctionManifestSource
} from "./server-function-manifest.js";
import type { StartNodeRequestOptions } from "./node-web-exchange.js";
import {
  resolveStartTransportEndpointsEffect,
  type StartTransportEndpointConflictError,
  type StartTransportEndpointPathError
} from "./start-transport-endpoints.js";

/** Options for generated file-route definition modules written by the plugin. */
export interface FileRouteGenerationOptions
  extends GeneratedFileRouteDefinitionsModuleOptions {
  /** Generated route definition path. String values must stay inside the Vite root; `false` disables writes. */
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
  /** Unsupported for manifest generation: use `serverFunctionSources` with explicit module/export metadata. */
  readonly serverFunctions?: ReadonlyArray<ServerFunction<any, any, any, any>>;
  /** Prebuilt server-function manifest definitions. */
  readonly serverFunctionManifest?: Iterable<ServerFunctionManifestDefinition>;
  /** Server-function sources with explicit module/export references. */
  readonly serverFunctionSources?: Iterable<ServerFunctionManifestSource>;
  /** Unsupported for manifest generation: use `actionSources` with explicit module/export metadata. */
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
  /** RPC endpoint path used by generated server-function client references. */
  readonly rpcPath?: string;
  /** Action endpoint path used by generated POST client references. */
  readonly actionPath?: string;
  /** Node request origin and forwarded-header policy for the Vite dev SSR middleware. */
  readonly nodeRequest?: StartNodeRequestOptions;
  /** Build policy to enforce, or true for the default policy. */
  readonly buildPolicy?: StartBuildPolicy | boolean;
}

/** Build-time policies that can fail the build when app graph contracts drift. */
export interface StartBuildPolicy {
  readonly wireSchemas?: StartAppGraphWireSchemaPolicy | false;
  readonly actionBehavior?: StartAppGraphActionBehaviorPolicy | false;
  /** Resolved runtime diagnostics policy, enforced by the Vite diagnostics gate. */
  readonly diagnostics?: StartAppGraphDiagnosticsPolicy | false;
}

/** Failure channel for static Start build policy validation. */
export type StartBuildPolicyError =
  | StartAppGraphMissingWireSchemasError
  | StartAppGraphUnknownActionBehaviorError;

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
  | FileRouteManifestError
  | StartManifestDirectReferenceError
  | StartTransportEndpointPathError
  | StartTransportEndpointConflictError;

export type StartManifestDirectReferenceKind = "serverFunctions" | "actions";

export class StartManifestDirectReferenceError extends Data.TaggedError(
  "StartManifestDirectReferenceError"
)<{
  readonly kind: StartManifestDirectReferenceKind;
  readonly count: number;
  readonly serverEntry: string;
  readonly guidance: string;
}> {}

/** Compile-time define values generated from the Start Manifest Wall. */
export interface StartManifestWallDefineValues {
  readonly __EFFECT_UI_SERVER_FUNCTIONS__: string;
  readonly __EFFECT_UI_ACTIONS__: string;
  readonly __EFFECT_UI_FILE_ROUTES__: string;
  readonly __EFFECT_UI_APP_GRAPH__: string;
}

/** Default server entry module used by the Start Manifest Wall. */
export const defaultServerEntry = "/src/server.tsx";
/** Default directory scanned for file routes. */
export const defaultFileRouteDirectory = "src/routes";
/** Default generated route tree output path. */
export const defaultFileRouteGeneratedFile = "src/routeTree.gen.ts";
/** Default wire-schema policy applied while building the Start app graph. */
export const defaultStartBuildWireSchemaPolicy: Required<StartAppGraphWireSchemaPolicy> = {
  requireInput: true,
  requireOutput: true,
  requireError: false
};
/** Default Start build policy used by the Vite plugin and manifest helpers. */
export const defaultStartBuildPolicy: StartBuildPolicy = {
  wireSchemas: defaultStartBuildWireSchemaPolicy
};

const directReferenceGuidance = (
  kind: StartManifestDirectReferenceKind
): string =>
  kind === "serverFunctions"
    ? "Direct `serverFunctions` arrays only carry wire names, not implementation export names. Use `serverFunctionSources` with explicit `module` and `exportName`, or provide `serverFunctionManifest` entries."
    : "Direct `actions` arrays only carry wire names, not implementation export names. Use `actionSources` with explicit `module` and `exportName`, or provide `actionManifest` entries.";

const directReferenceError = (
  kind: StartManifestDirectReferenceKind,
  count: number,
  serverEntry: string
): StartManifestDirectReferenceError =>
  new StartManifestDirectReferenceError({
    kind,
    count,
    serverEntry,
    guidance: directReferenceGuidance(kind)
  });

const normalizeDiscoveredFileRoutePath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

export const absoluteFileRouteGeneratedFile = (
  root: string,
  options: FileRouteGenerationOptions = {}
): string | undefined => {
  if (options.outputFile === false) {
    return undefined;
  }

  const outputFile = options.outputFile ?? defaultFileRouteGeneratedFile;
  return isAbsolute(outputFile)
    ? outputFile
    : resolvePath(root, outputFile);
};

export const isGeneratedFileRouteDefinitionsOutputFile = (
  root: string,
  options: EffectUiStartOptions,
  filePath: string
): boolean => {
  const generated = absoluteFileRouteGeneratedFile(root, options.fileRouteGeneration);
  if (generated === undefined) {
    return false;
  }

  const absolutePath = isAbsolute(filePath) ? filePath : resolvePath(root, filePath);
  return normalizeDiscoveredFileRoutePath(absolutePath) === normalizeDiscoveredFileRoutePath(generated);
};

const generatedFileRouteDefinitionsDiscoveryPath = (
  root: string,
  routeDirectory: string,
  options: FileRouteGenerationOptions = {}
): string | undefined => {
  const generated = absoluteFileRouteGeneratedFile(root, options);
  if (generated === undefined) {
    return undefined;
  }

  return normalizeDiscoveredFileRoutePath(
    isAbsolute(routeDirectory) ? generated : relativePath(root, generated)
  );
};

const isRouteFileName = (
  fileName: string,
  extensions: readonly string[]
): boolean =>
  !fileName.endsWith(".d.ts") &&
  !fileName.endsWith(".d.mts") &&
  !fileName.endsWith(".d.cts") &&
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

const serverFunctionDefinitionsFromOptionsEffect = (
  options: EffectUiStartOptions,
  serverEntry: string
): Effect.Effect<
  Iterable<ServerFunctionManifestDefinition>,
  StartManifestDirectReferenceError
> => {
  if (options.serverFunctionManifest) {
    return Effect.succeed(options.serverFunctionManifest);
  }

  if (options.serverFunctionSources) {
    return Effect.succeed(
      Array.from(options.serverFunctionSources, (source) =>
        serverFunctionManifestDefinition(source.fn, source)
      )
    );
  }

  const direct = options.serverFunctions ?? [];
  return direct.length === 0
    ? Effect.succeed([])
    : Effect.fail(directReferenceError("serverFunctions", direct.length, serverEntry));
};

const actionDefinitionsFromOptionsEffect = (
  options: EffectUiStartOptions,
  serverEntry: string
): Effect.Effect<
  Iterable<ActionManifestDefinition>,
  StartManifestDirectReferenceError
> => {
  if (options.actionManifest) {
    return Effect.succeed(options.actionManifest);
  }

  if (options.actionSources) {
    return Effect.succeed(
      Array.from(options.actionSources, (source) =>
        actionManifestDefinition(source.action, source)
      )
    );
  }

  const direct = options.actions ?? [];
  return direct.length === 0
    ? Effect.succeed([])
    : Effect.fail(directReferenceError("actions", direct.length, serverEntry));
};

/** Builds the server-function manifest from plugin options. */
export const makeStartServerFunctionManifestEffect = (
  options: EffectUiStartOptions = {}
): Effect.Effect<
  ServerFunctionManifest,
  ServerFunctionManifestError | StartManifestDirectReferenceError
> => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  return Effect.gen(function* () {
    const definitions = yield* serverFunctionDefinitionsFromOptionsEffect(options, serverEntry);
    return yield* makeServerFunctionManifest(
      definitions,
      options.rpcPath === undefined ? {} : { rpcPath: options.rpcPath }
    );
  });
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
): Effect.Effect<
  ActionManifest,
  ActionManifestError | StartManifestDirectReferenceError
> => {
  const serverEntry = options.serverEntry ?? defaultServerEntry;
  return Effect.gen(function* () {
    const definitions = yield* actionDefinitionsFromOptionsEffect(options, serverEntry);
    return yield* makeActionManifest(
      definitions,
      options.actionPath === undefined ? {} : { actionPath: options.actionPath }
    );
  });
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

const materializeIterableOption = <A>(
  value: Iterable<A> | undefined
): readonly A[] | undefined =>
  value === undefined ? undefined : Array.from(value);

const normalizeFileRouteManifestOption = (
  manifest: EffectUiStartOptions["fileRouteManifest"]
): EffectUiStartOptions["fileRouteManifest"] => {
  if (manifest === undefined) {
    return undefined;
  }

  if (isFileRouteManifest(manifest)) {
    const modules = (manifest as { readonly modules?: Iterable<FileRouteManifestModule> }).modules;
    return {
      ...manifest,
      entries: Array.from(manifest.entries),
      modules: modules === undefined ? [] : Array.from(modules)
    };
  }

  return Array.from(manifest);
};

/** Materializes caller-supplied manifest Iterables once at the Vite/plugin seam. */
export const normalizeStartManifestIterableOptions = (
  options: EffectUiStartOptions = {}
): EffectUiStartOptions => {
  const serverFunctionManifest = materializeIterableOption(options.serverFunctionManifest);
  const serverFunctionSources = materializeIterableOption(options.serverFunctionSources);
  const actionManifest = materializeIterableOption(options.actionManifest);
  const actionSources = materializeIterableOption(options.actionSources);
  const fileRoutes = materializeIterableOption(options.fileRoutes);
  const fileRouteManifest = normalizeFileRouteManifestOption(options.fileRouteManifest);

  return {
    ...options,
    ...(serverFunctionManifest === undefined ? {} : { serverFunctionManifest }),
    ...(serverFunctionSources === undefined ? {} : { serverFunctionSources }),
    ...(actionManifest === undefined ? {} : { actionManifest }),
    ...(actionSources === undefined ? {} : { actionSources }),
    ...(fileRoutes === undefined ? {} : { fileRoutes }),
    ...(fileRouteManifest === undefined ? {} : { fileRouteManifest })
  };
};

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
  const routeDirectory = fileRouteOptions?.routeDirectory ?? defaultFileRouteDirectory;
  const ignoredGeneratedFile = generatedFileRouteDefinitionsDiscoveryPath(
    root,
    routeDirectory,
    next.fileRouteGeneration
  );
  return Effect.map(
    discoverFileRoutesEffect({
      root,
      routeDirectory,
      ...(fileRouteOptions?.extensions === undefined
        ? {}
        : { extensions: fileRouteOptions.extensions })
    }),
    (fileRoutes) => ({
      ...next,
      fileRoutes: ignoredGeneratedFile === undefined
        ? fileRoutes
        : fileRoutes.filter((fileRoute) =>
            normalizeDiscoveredFileRoutePath(fileRoute) !== ignoredGeneratedFile
          )
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
      : undefined;

    return Effect.map(validateFileRouteManifestEffect(entries, modules), (entries) =>
      createFileRouteManifest(entries, fileRouteOptions, modules ?? [])
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
    yield* resolveStartTransportEndpointsEffect({
      serverFunctionManifest: serverFunctions,
      actionManifest: actions
    });
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

/** Applies static build policies to a Start app graph. */
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
