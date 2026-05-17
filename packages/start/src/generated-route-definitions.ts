import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import { Data, Effect } from "effect";
import {
  createGeneratedFileRouteDefinitionsModule,
  isFileRouteDefinitionsModuleError,
  type FileRouteDefinitionsModuleError
} from "./file-route-modules.js";
import {
  defaultFileRouteGeneratedFile,
  fileRouteDiscoveryDirectoryExists,
  fileRouteDiscoveryPlan,
  type EffectUiStartOptions,
  type FileRouteGenerationOptions
} from "./start-manifest-wall.js";
import type { FileRouteManifest } from "./file-routes.js";

/** Plan for a generated route definitions file write. */
export interface FileRouteDefinitionsFileWritePlan {
  /** User-facing output path from `fileRouteGeneration.outputFile`. */
  readonly outputFile: string;
  /** Absolute filesystem path that will be read or written. */
  readonly absolutePath: string;
  /** Root-relative path embedded in the generated module source. */
  readonly generatedFile: string;
  /** Complete generated TypeScript module source. */
  readonly source: string;
}

/** Result from writing the generated route definitions module. */
export interface FileRouteDefinitionsFileWriteResult {
  /** User-facing output path from `fileRouteGeneration.outputFile`. */
  readonly outputFile: string;
  /** Absolute filesystem path that was checked. */
  readonly absolutePath: string;
  /** True when the file contents changed and were written. */
  readonly written: boolean;
  /** Complete generated TypeScript module source. */
  readonly source: string;
}

/** Error raised while reading or writing the generated route definitions file. */
export class FileRouteDefinitionsFileWriteError extends Data.TaggedError(
  "FileRouteDefinitionsFileWriteError"
)<{
  /** Filesystem operation that failed. */
  readonly operation: "read-existing" | "create-directory" | "write-file";
  /** Path passed to the failing filesystem operation. */
  readonly path: string;
  /** Original host filesystem error. */
  readonly cause: unknown;
}> {}

/** Error raised when generated route definitions would be written outside the Vite root. */
export class FileRouteDefinitionsOutputPathError extends Data.TaggedError(
  "FileRouteDefinitionsOutputPathError"
)<{
  /** Vite project root used to resolve the output file. */
  readonly root: string;
  /** Configured route definitions output file. */
  readonly outputFile: string;
  /** Absolute resolved output path that escaped the root. */
  readonly absolutePath: string;
  /** Human-readable repair hint for configuration diagnostics. */
  readonly guidance: string;
}> {}

/**
 * Typed failure channel for generated route definitions file writes.
 *
 * The union separates host filesystem failures, root-escape configuration
 * errors, and generated module validation errors so Vite integrations can keep
 * file-route generation inside Effect instead of catching unknown exceptions.
 */
export type FileRouteDefinitionsFileWriteFailure =
  | FileRouteDefinitionsFileWriteError
  | FileRouteDefinitionsOutputPathError
  | FileRouteDefinitionsModuleError;

const normalizeGeneratedRouteDefinitionsPath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

const assertOutputFileInsideRoot = (
  root: string,
  outputFile: string,
  absolutePath: string
): void => {
  const relative = relativePath(root, absolutePath);
  if (relative === "" || relative.startsWith("..") || isAbsolute(relative)) {
    throw new FileRouteDefinitionsOutputPathError({
      root,
      outputFile,
      absolutePath,
      guidance: "Keep fileRouteGeneration.outputFile inside the Vite root. Use a root-relative path such as 'src/routeTree.gen.ts'."
    });
  }
};

export const shouldWriteFileRouteDefinitionsFile = (
  root: string,
  activeOptions: EffectUiStartOptions,
  initialOptions: EffectUiStartOptions
): boolean => {
  if (activeOptions.fileRouteGeneration?.outputFile === false) {
    return false;
  }

  if (initialOptions.fileRoutes !== undefined || initialOptions.fileRouteManifest !== undefined) {
    return true;
  }

  return fileRouteDiscoveryDirectoryExists(fileRouteDiscoveryPlan({
    root,
    ...(activeOptions.fileRouteOptions?.routeDirectory === undefined
      ? {}
      : { routeDirectory: activeOptions.fileRouteOptions.routeDirectory }),
    ...(activeOptions.fileRouteOptions?.extensions === undefined
      ? {}
      : { extensions: activeOptions.fileRouteOptions.extensions }),
    ...(activeOptions.fileRouteGeneration === undefined
      ? {}
      : { fileRouteGeneration: activeOptions.fileRouteGeneration })
  }));
};

export const planFileRouteDefinitionsFileWrite = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {}
): FileRouteDefinitionsFileWritePlan | undefined => {
  if (options.outputFile === false) {
    return undefined;
  }

  const outputFile = options.outputFile ?? defaultFileRouteGeneratedFile;
  const absolutePath = isAbsolute(outputFile)
    ? outputFile
    : resolvePath(root, outputFile);
  assertOutputFileInsideRoot(root, outputFile, absolutePath);
  const generatedFile = isAbsolute(outputFile)
    ? normalizeGeneratedRouteDefinitionsPath(relativePath(root, absolutePath))
    : outputFile;
  const source = createGeneratedFileRouteDefinitionsModule(manifest, {
    ...options,
    generatedFile
  });

  return {
    outputFile,
    absolutePath,
    generatedFile,
    source
  };
};

const planFileRouteDefinitionsFileWriteEffect = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {}
): Effect.Effect<FileRouteDefinitionsFileWritePlan | undefined, FileRouteDefinitionsModuleError | FileRouteDefinitionsOutputPathError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(planFileRouteDefinitionsFileWrite(root, manifest, options));
    } catch (cause) {
      if (isFileRouteDefinitionsModuleError(cause) || cause instanceof FileRouteDefinitionsOutputPathError) {
        return Effect.fail(cause);
      }
      throw cause;
    }
  });

/**
 * Writes the generated route definitions file when content has changed.
 *
 * Returns `undefined` when generation is disabled and reports whether a file
 * write was necessary otherwise.
 */
export const writeFileRouteDefinitionsFile = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {}
): FileRouteDefinitionsFileWriteResult | undefined =>
  Effect.runSync(writeFileRouteDefinitionsFileEffect(root, manifest, options));

/** Effect-first generated route definitions file write with typed filesystem failures. */
export const writeFileRouteDefinitionsFileEffect = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {}
): Effect.Effect<FileRouteDefinitionsFileWriteResult | undefined, FileRouteDefinitionsFileWriteFailure> =>
  Effect.gen(function* () {
    const plan = yield* planFileRouteDefinitionsFileWriteEffect(root, manifest, options);
    if (plan === undefined) {
      return undefined;
    }

    const current = yield* Effect.try({
      try: () => existsSync(plan.absolutePath) ? readFileSync(plan.absolutePath, "utf8") : undefined,
      catch: (cause) =>
        new FileRouteDefinitionsFileWriteError({
          operation: "read-existing",
          path: plan.absolutePath,
          cause
        })
    });

    if (current === plan.source) {
      return {
        outputFile: plan.outputFile,
        absolutePath: plan.absolutePath,
        source: plan.source,
        written: false
      };
    }

    yield* Effect.try({
      try: () => mkdirSync(dirname(plan.absolutePath), { recursive: true }),
      catch: (cause) =>
        new FileRouteDefinitionsFileWriteError({
          operation: "create-directory",
          path: dirname(plan.absolutePath),
          cause
        })
    });
    yield* Effect.try({
      try: () => writeFileSync(plan.absolutePath, plan.source),
      catch: (cause) =>
        new FileRouteDefinitionsFileWriteError({
          operation: "write-file",
          path: plan.absolutePath,
          cause
        })
    });

    return {
      outputFile: plan.outputFile,
      absolutePath: plan.absolutePath,
      source: plan.source,
      written: true
    };
  });
