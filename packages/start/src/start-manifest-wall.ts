import { Data, Effect } from "effect";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import {
  createFileRouteManifest,
  defaultFileRouteExtensions,
  generateFileRouteManifest,
  validateFileRouteManifest,
  type FileRouteManifest,
  type FileRouteManifestEntry,
  type FileRouteManifestError,
  type FileRouteManifestModule,
  type FileRouteManifestOptions,
} from "./file-routes.js";
import type { GeneratedFileRouteDefinitionsModuleOptions } from "./file-route-modules.js";
import type { StartHostForkRunnerOptions } from "./start-host-runtime-runner.js";
import type { StartNodeRequestOptions } from "./node-web-exchange.js";
import type { StartPrerenderConfig } from "./start-prerender.js";

/** Options for generated file-route definition modules written by the plugin. */
export interface FileRouteGenerationOptions extends GeneratedFileRouteDefinitionsModuleOptions {
  /** Generated route definition path. String values must stay inside the Vite root; `false` disables writes. */
  readonly outputFile?: string | false;
}

/** Vite dev SSR host runtime options for serviceful server-entry handlers. */
export interface StartViteDevSsrOptions<
  RuntimeError = never,
> extends StartHostForkRunnerOptions<RuntimeError> {}

/** Vite plugin options for route discovery, dev SSR, prerendering, and build policy. */
export interface SunfallArcStartOptions {
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
  /**
   * Browser entry module (the file that calls `App.launch(app)`), root
   * relative. The production build bundles it as the client entry. Defaults
   * to `/src/main.tsx`.
   */
  readonly clientEntry?: string;
  /**
   * Runtime and run options used by the Vite dev SSR middleware.
   *
   * Pass this when the server-entry handler returns Effects that require app
   * services. The handler still owns request/runtime construction; this option
   * only selects the host Runtime Runner used to fork the dev middleware Effect.
   */
  readonly devSsr?: StartViteDevSsrOptions<unknown>;
  /**
   * Static prerendering to run after a production Vite build.
   *
   * `true` enables default static route discovery and link crawling. Use the
   * object form to set explicit pages, retry behavior, and output-path style.
   */
  readonly prerender?: StartPrerenderConfig;
  /** Node request origin and forwarded-header policy for the Vite dev SSR middleware. */
  readonly nodeRequest?: StartNodeRequestOptions;
  /** Build policy to enforce. */
  readonly buildPolicy?: StartBuildPolicy;
}

/** Build-time policies enforced by the Vite plugin. */
export interface StartBuildPolicy {
  /** Browser-client policy for fully static deployments. */
  readonly staticClient?: StartStaticClientPolicy | false;
}

/** Build-time browser-client policy for static Start deployments. */
export interface StartStaticClientPolicy {
  /** Enable static-client restrictions for a static deployment target. */
  readonly target?: "static";
  /** Compile the server-function RPC client out of `App.launch` in the browser build. Defaults to true. */
  readonly forbidBrowserRpc?: boolean;
}

/** Options for discovering file-route modules from a route directory. */
export interface FileRouteDiscoveryOptions {
  readonly root?: string;
  readonly routeDirectory?: string;
  readonly extensions?: readonly string[];
  /** Generated route definition output to ignore if it lives under the route directory. */
  readonly fileRouteGeneration?: FileRouteGenerationOptions;
}

/** Normalized file-route discovery policy shared by discovery and Vite adapters. */
export interface FileRouteDiscoveryPlan {
  readonly root: string;
  readonly routeDirectory: string;
  readonly directory: string;
  readonly extensions: readonly string[];
  readonly generatedDefinitionsFile?: string;
}

export class FileRouteDiscoveryError extends Data.TaggedError("FileRouteDiscoveryError")<{
  readonly directory: string;
  readonly cause: unknown;
}> {}

/** Default server entry module used by the Start Manifest Wall. */
export const defaultServerEntry = "/src/server.tsx";
/** Default directory scanned for file routes. */
export const defaultFileRouteDirectory = "src/routes";
/** Default generated route tree output path. */
export const defaultFileRouteGeneratedFile = "src/routeTree.gen.ts";

const normalizeDiscoveredFileRoutePath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");

const isRouteFileName = (fileName: string, extensions: readonly string[]): boolean =>
  !fileName.endsWith(".d.ts") &&
  !fileName.endsWith(".d.mts") &&
  !fileName.endsWith(".d.cts") &&
  extensions.some((extension) => fileName.endsWith(extension));

const absoluteFileRouteGeneratedFile = (
  root: string,
  options: FileRouteGenerationOptions = {},
): string | undefined => {
  if (options.outputFile === false) {
    return undefined;
  }

  const outputFile = options.outputFile ?? defaultFileRouteGeneratedFile;
  return isAbsolute(outputFile) ? outputFile : resolvePath(root, outputFile);
};

const absoluteFileRouteDirectory = (
  root: string,
  routeDirectory: string = defaultFileRouteDirectory,
): string => (isAbsolute(routeDirectory) ? routeDirectory : resolvePath(root, routeDirectory));

/** Builds the shared file-route discovery policy for directory scans and Vite hot updates. */
export const fileRouteDiscoveryPlan = (
  options: FileRouteDiscoveryOptions = {},
): FileRouteDiscoveryPlan => {
  const root = resolvePath(options.root ?? process.cwd());
  const routeDirectory = options.routeDirectory ?? defaultFileRouteDirectory;
  const generatedDefinitionsFile = absoluteFileRouteGeneratedFile(
    root,
    options.fileRouteGeneration,
  );
  return {
    root,
    routeDirectory,
    directory: absoluteFileRouteDirectory(root, routeDirectory),
    extensions: options.extensions ?? defaultFileRouteExtensions,
    ...(generatedDefinitionsFile === undefined ? {} : { generatedDefinitionsFile }),
  };
};

/** Checks whether the discovery plan's route directory currently exists. */
export const fileRouteDiscoveryDirectoryExists = (plan: FileRouteDiscoveryPlan): boolean =>
  existsSync(plan.directory);

/** Returns true when a host file path is a discoverable route module. */
export const isFileRouteDiscoveryFile = (
  plan: FileRouteDiscoveryPlan,
  filePath: string,
): boolean => {
  const absolutePath = isAbsolute(filePath) ? filePath : resolvePath(plan.root, filePath);
  if (
    plan.generatedDefinitionsFile !== undefined &&
    normalizeDiscoveredFileRoutePath(absolutePath) ===
      normalizeDiscoveredFileRoutePath(plan.generatedDefinitionsFile)
  ) {
    return false;
  }

  const relativeRouteFile = relativePath(plan.directory, absolutePath);
  if (
    relativeRouteFile === "" ||
    relativeRouteFile.startsWith("..") ||
    isAbsolute(relativeRouteFile)
  ) {
    return false;
  }

  return isRouteFileName(relativeRouteFile, plan.extensions);
};

/** Converts an absolute route module path to the manifest path for a discovery plan. */
const discoveredFileRoutePath = (plan: FileRouteDiscoveryPlan, filePath: string): string =>
  normalizeDiscoveredFileRoutePath(
    isAbsolute(plan.routeDirectory) ? filePath : relativePath(plan.root, filePath),
  );

const discoverFileRoutesSync = (options: FileRouteDiscoveryOptions = {}): readonly string[] => {
  const plan = fileRouteDiscoveryPlan(options);

  if (!fileRouteDiscoveryDirectoryExists(plan)) {
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
      } else if (entry.isFile() && isFileRouteDiscoveryFile(plan, fullPath)) {
        discovered.push(discoveredFileRoutePath(plan, fullPath));
      }
    }
  };

  visit(plan.directory);
  return discovered.sort();
};

/** Recursively discovers route module files under the configured route directory. */
export const discoverFileRoutes = (
  options: FileRouteDiscoveryOptions = {},
): Effect.Effect<readonly string[], FileRouteDiscoveryError> => {
  const plan = fileRouteDiscoveryPlan(options);

  return Effect.try({
    try: () => discoverFileRoutesSync(options),
    catch: (cause) => new FileRouteDiscoveryError({ directory: plan.directory, cause }),
  });
};

const isFileRouteManifest = (value: unknown): value is FileRouteManifest =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly version?: unknown }).version === 1 &&
  Array.isArray((value as { readonly entries?: unknown }).entries);

const materializeIterableOption = <A>(value: Iterable<A> | undefined): readonly A[] | undefined =>
  value === undefined ? undefined : Array.from(value);

const normalizeFileRouteManifestOption = (
  manifest: SunfallArcStartOptions["fileRouteManifest"],
): SunfallArcStartOptions["fileRouteManifest"] => {
  if (manifest === undefined) {
    return undefined;
  }

  if (isFileRouteManifest(manifest)) {
    const modules = (manifest as { readonly modules?: Iterable<FileRouteManifestModule> }).modules;
    return {
      ...manifest,
      entries: Array.from(manifest.entries),
      modules: modules === undefined ? [] : Array.from(modules),
    };
  }

  return Array.from(manifest);
};

/** Materializes caller-supplied manifest Iterables once at the Vite/plugin seam. */
export const normalizeStartManifestIterableOptions = (
  options: SunfallArcStartOptions = {},
): SunfallArcStartOptions => {
  const fileRoutes = materializeIterableOption(options.fileRoutes);
  const fileRouteManifest = normalizeFileRouteManifestOption(options.fileRouteManifest);

  return {
    ...options,
    ...(fileRoutes === undefined ? {} : { fileRoutes }),
    ...(fileRouteManifest === undefined ? {} : { fileRouteManifest }),
  };
};

const withDefaultFileRouteDirectory = (options: SunfallArcStartOptions): SunfallArcStartOptions => {
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
      routeDirectory: defaultFileRouteDirectory,
    },
  };
};

export const withDiscoveredFileRoutes = (
  options: SunfallArcStartOptions,
  root: string,
): Effect.Effect<SunfallArcStartOptions, FileRouteDiscoveryError> => {
  const next = withDefaultFileRouteDirectory(options);
  if (next.fileRouteManifest !== undefined || next.fileRoutes !== undefined) {
    return Effect.succeed(next);
  }

  const fileRouteOptions = next.fileRouteOptions;
  const routeDirectory = fileRouteOptions?.routeDirectory ?? defaultFileRouteDirectory;
  return Effect.map(
    discoverFileRoutes({
      root,
      routeDirectory,
      ...(fileRouteOptions?.extensions === undefined
        ? {}
        : { extensions: fileRouteOptions.extensions }),
      ...(next.fileRouteGeneration === undefined
        ? {}
        : { fileRouteGeneration: next.fileRouteGeneration }),
    }),
    (fileRoutes) => ({
      ...next,
      fileRoutes,
    }),
  );
};

/** Builds or validates the Start file-route manifest from plugin options. */
export const makeStartFileRouteManifest = (
  options: SunfallArcStartOptions = {},
): Effect.Effect<FileRouteManifest, FileRouteManifestError> => {
  const manifest = options.fileRouteManifest;
  if (manifest) {
    const routeDirectory = isFileRouteManifest(manifest)
      ? manifest.routeDirectory
      : options.fileRouteOptions?.routeDirectory;
    const fileRouteOptions = {
      ...options.fileRouteOptions,
      ...(routeDirectory === undefined ? {} : { routeDirectory }),
    };
    const entries = isFileRouteManifest(manifest) ? manifest.entries : manifest;
    const modules =
      isFileRouteManifest(manifest) && Array.isArray(manifest.modules)
        ? manifest.modules
        : undefined;

    return Effect.map(validateFileRouteManifest(entries, modules), (entries) =>
      createFileRouteManifest(entries, fileRouteOptions, modules ?? []),
    );
  }

  if (options.fileRoutes) {
    return generateFileRouteManifest(options.fileRoutes, options.fileRouteOptions);
  }

  return Effect.succeed(createFileRouteManifest([], options.fileRouteOptions));
};
