import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import { Data, Effect } from "effect";
import {
  createGeneratedFileRouteDefinitionsModule,
  type FileRouteDefinitionsModuleError,
} from "./file-route-modules.js";
import {
  defaultFileRouteGeneratedFile,
  fileRouteDiscoveryDirectoryExists,
  fileRouteDiscoveryPlan,
  type SunfallArcStartOptions,
  type FileRouteGenerationOptions,
} from "./start-manifest-wall.js";
import type { FileRouteManifest } from "./file-routes.js";

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
  "FileRouteDefinitionsFileWriteError",
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
  "FileRouteDefinitionsOutputPathError",
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
 * Typed failure channel for generated route definitions file writes: host
 * filesystem failures, root-escape configuration errors, and generated module
 * validation errors.
 */
export type FileRouteDefinitionsFileWriteFailure =
  | FileRouteDefinitionsFileWriteError
  | FileRouteDefinitionsOutputPathError
  | FileRouteDefinitionsModuleError;

export const shouldWriteFileRouteDefinitionsFile = (
  root: string,
  activeOptions: SunfallArcStartOptions,
  initialOptions: SunfallArcStartOptions,
): boolean =>
  activeOptions.fileRouteGeneration?.outputFile !== false &&
  (initialOptions.fileRoutes !== undefined ||
    initialOptions.fileRouteManifest !== undefined ||
    fileRouteDiscoveryDirectoryExists(
      fileRouteDiscoveryPlan({
        root,
        ...(activeOptions.fileRouteOptions?.routeDirectory === undefined
          ? {}
          : { routeDirectory: activeOptions.fileRouteOptions.routeDirectory }),
        ...(activeOptions.fileRouteOptions?.extensions === undefined
          ? {}
          : { extensions: activeOptions.fileRouteOptions.extensions }),
        ...(activeOptions.fileRouteGeneration === undefined
          ? {}
          : { fileRouteGeneration: activeOptions.fileRouteGeneration }),
      }),
    ));

const fileSystem = <A>(
  operation: FileRouteDefinitionsFileWriteError["operation"],
  path: string,
  run: () => A,
): Effect.Effect<A, FileRouteDefinitionsFileWriteError> =>
  Effect.try({
    try: run,
    catch: (cause) => new FileRouteDefinitionsFileWriteError({ operation, path, cause }),
  });

/**
 * Writes the generated route definitions file when content has changed.
 *
 * Succeeds with `undefined` when generation is disabled and reports whether a
 * file write was necessary otherwise; filesystem failures stay typed.
 */
export const writeFileRouteDefinitionsFile = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {},
): Effect.Effect<
  FileRouteDefinitionsFileWriteResult | undefined,
  FileRouteDefinitionsFileWriteFailure
> =>
  Effect.gen(function* () {
    if (options.outputFile === false) {
      return undefined;
    }
    const outputFile = options.outputFile ?? defaultFileRouteGeneratedFile;
    const absolutePath = isAbsolute(outputFile) ? outputFile : resolvePath(root, outputFile);
    const relative = relativePath(root, absolutePath);
    if (relative === "" || relative.startsWith("..") || isAbsolute(relative)) {
      return yield* new FileRouteDefinitionsOutputPathError({
        root,
        outputFile,
        absolutePath,
        guidance:
          "Keep fileRouteGeneration.outputFile inside the Vite root. Use a root-relative path such as 'src/routeTree.gen.ts'.",
      });
    }
    const source = yield* createGeneratedFileRouteDefinitionsModule(manifest, {
      ...options,
      generatedFile: isAbsolute(outputFile) ? relative.replace(/\\/g, "/") : outputFile,
    });

    const current = yield* fileSystem("read-existing", absolutePath, () =>
      existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : undefined,
    );
    const written = current !== source;
    if (written) {
      yield* fileSystem("create-directory", dirname(absolutePath), () =>
        mkdirSync(dirname(absolutePath), { recursive: true }),
      );
      yield* fileSystem("write-file", absolutePath, () => writeFileSync(absolutePath, source));
    }
    return { outputFile, absolutePath, source, written };
  });
