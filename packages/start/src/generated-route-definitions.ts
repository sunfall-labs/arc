import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import { Data, Effect } from "effect";
import {
  createGeneratedFileRouteDefinitionsModule,
  isFileRouteDefinitionsModuleError,
  type FileRouteDefinitionsModuleError
} from "./file-route-modules.js";
import {
  absoluteFileRouteDirectory,
  defaultFileRouteDirectory,
  defaultFileRouteGeneratedFile,
  type EffectUiStartOptions,
  type FileRouteGenerationOptions
} from "./start-manifest-wall.js";
import type { FileRouteManifest } from "./file-routes.js";

/** Plan for a generated route definitions file write. */
export interface FileRouteDefinitionsFileWritePlan {
  readonly outputFile: string;
  readonly absolutePath: string;
  readonly generatedFile: string;
  readonly source: string;
}

/** Result from writing the generated route definitions module. */
export interface FileRouteDefinitionsFileWriteResult {
  readonly outputFile: string;
  readonly absolutePath: string;
  readonly written: boolean;
  readonly source: string;
}

/** Error raised while reading or writing the generated route definitions file. */
export class FileRouteDefinitionsFileWriteError extends Data.TaggedError(
  "FileRouteDefinitionsFileWriteError"
)<{
  readonly operation: "read-existing" | "create-directory" | "write-file";
  readonly path: string;
  readonly cause: unknown;
}> {}

export type FileRouteDefinitionsFileWriteFailure =
  | FileRouteDefinitionsFileWriteError
  | FileRouteDefinitionsModuleError;

const normalizeGeneratedRouteDefinitionsPath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

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

  const routeDirectory = activeOptions.fileRouteOptions?.routeDirectory ?? defaultFileRouteDirectory;
  return existsSync(absoluteFileRouteDirectory(root, routeDirectory));
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
): Effect.Effect<FileRouteDefinitionsFileWritePlan | undefined, FileRouteDefinitionsModuleError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(planFileRouteDefinitionsFileWrite(root, manifest, options));
    } catch (cause) {
      if (isFileRouteDefinitionsModuleError(cause)) {
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
