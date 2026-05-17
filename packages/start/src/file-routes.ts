import {
  compareRoutePathSegment,
  isRoutePathSegmentPrefix,
  type RoutePathParam,
  type RoutePathSegment,
} from "@sunfall/arc-core";
import { Data, Effect, Schema } from "effect";
import {
  decodeFileRoutePath,
  decodeFileRoutePathEffect,
  decodeSerializedFileRoutePathEffect,
  type DecodedFileRoutePath,
  type FileRoutePathDecodeInvalidSegment,
  isFileRoutePathlessSegment,
} from "./file-route-segments.js";

/** Branded id derived from a source file path in the routes directory. */
export const FileRouteSourceId = Schema.String.pipe(Schema.brand("FileRouteSourceId"));
export type FileRouteSourceId = typeof FileRouteSourceId.Type;

/** Branded route id generated from decoded file-route path segments. */
export const FileRouteId = Schema.String.pipe(Schema.brand("FileRouteId"));
export type FileRouteId = typeof FileRouteId.Type;

/** Brands a normalized source id. */
export const makeFileRouteSourceId = (id: string): FileRouteSourceId =>
  Schema.decodeUnknownSync(FileRouteSourceId)(id);

/** Brands a generated route id. */
export const makeFileRouteId = (id: string): FileRouteId =>
  Schema.decodeUnknownSync(FileRouteId)(id);

/** Decoded route path segment used by file-route manifests. */
export type FileRouteSegment = RoutePathSegment;
/** Decoded path parameter used by file-route manifests. */
export type FileRouteParam = RoutePathParam;

/**
 * File-route module roles discovered from file names such as route/layout/error/metadata.
 *
 * Layout, error-boundary, and metadata modules are scoped by source id
 * directory, not URL path alone. Sibling route groups may share the same route
 * path while keeping support modules isolated by source scope.
 */
export type FileRouteModuleKind = "Route" | "Layout" | "ErrorBoundary" | "Metadata";

/** One module discovered from the file-route tree. */
export interface FileRouteManifestModule {
  /** Source-file identity relative to the route directory. */
  readonly id: FileRouteSourceId;
  /** Role this module plays for its route path. */
  readonly kind: FileRouteModuleKind;
  /** Generated route identity shared by all modules for the same route path. */
  readonly routeId: FileRouteId;
  /** Importable module id used by generated virtual modules. */
  readonly moduleId: string;
  /** Normalized file path on disk. */
  readonly filePath: string;
  /** Runtime route path, e.g. `/projects/:id`. */
  readonly routePath: string;
  /** Decoded route path segments. */
  readonly segments: readonly FileRouteSegment[];
  /** Path parameters present in `routePath`. */
  readonly params: readonly FileRouteParam[];
  /** Export name expected from this module role. */
  readonly exportName: string;
}

/** Route entry used by generated route definitions and app graph diagnostics. */
export interface FileRouteManifestEntry {
  /** Source-file identity for the route module. */
  readonly id: FileRouteSourceId;
  /** Generated route identity. */
  readonly routeId: FileRouteId;
  /** Importable module id for the route module. */
  readonly moduleId: string;
  /** Normalized file path on disk. */
  readonly filePath: string;
  /** Runtime route path, e.g. `/projects/:id`. */
  readonly routePath: string;
  /** Decoded route path segments. */
  readonly segments: readonly FileRouteSegment[];
  /** Path parameters present in `routePath`. */
  readonly params: readonly FileRouteParam[];
}

/** Complete file-route manifest emitted by discovery and virtual modules. */
export interface FileRouteManifest {
  /** Manifest schema version. */
  readonly version: 1;
  /** Route entries that produce runtime route definitions. */
  readonly entries: readonly FileRouteManifestEntry[];
  /** All route-related modules, including layout/error/metadata modules. */
  readonly modules: readonly FileRouteManifestModule[];
  /** Optional route directory used to make file paths relative. */
  readonly routeDirectory?: string;
}

/** Per-route metadata projected from a complete file-route manifest. */
export interface FileRouteRouteMetadata {
  readonly routeId: FileRouteId;
  readonly routePath: string;
  readonly routeModule: FileRouteManifestModule;
  readonly parentRouteId?: FileRouteId;
  readonly parentRoutePath?: string;
  readonly layouts: readonly FileRouteManifestModule[];
  readonly errorBoundary?: FileRouteManifestModule;
  readonly metadataModules: readonly FileRouteManifestModule[];
}

/** Options for turning file paths into route manifest entries. */
export interface FileRouteManifestOptions {
  /** Directory prefix stripped from discovered files before route decoding. */
  readonly routeDirectory?: string;
  /** File extensions treated as route modules. Defaults to common TS/JS extensions. */
  readonly extensions?: readonly string[];
}

export class FileRouteManifestDuplicateRoutePath extends Data.TaggedError(
  "FileRouteManifestDuplicateRoutePath",
)<{
  readonly routePath: string;
  readonly first: FileRouteManifestEntry;
  readonly second: FileRouteManifestEntry;
}> {}

export class FileRouteManifestDuplicateRouteId extends Data.TaggedError(
  "FileRouteManifestDuplicateRouteId",
)<{
  readonly routeId: FileRouteId;
  readonly first: FileRouteManifestEntry;
  readonly second: FileRouteManifestEntry;
}> {}

export class FileRouteManifestInvalidSegment extends Data.TaggedError(
  "FileRouteManifestInvalidSegment",
)<{
  readonly filePath: string;
  readonly segment: string;
  readonly reason: "InvalidParamName";
}> {}

export class FileRouteManifestDuplicateModuleRole extends Data.TaggedError(
  "FileRouteManifestDuplicateModuleRole",
)<{
  readonly kind: Exclude<FileRouteModuleKind, "Route">;
  readonly routePath: string;
  readonly first: FileRouteManifestModule;
  readonly second: FileRouteManifestModule;
}> {}

export class FileRouteManifestRouteModuleMismatch extends Data.TaggedError(
  "FileRouteManifestRouteModuleMismatch",
)<{
  readonly reason: "MissingRouteModule" | "DuplicateRouteModule" | "OrphanRouteModule";
  readonly routePath: string;
  readonly moduleId: string;
  readonly entry?: FileRouteManifestEntry;
  readonly module?: FileRouteManifestModule;
  readonly first?: FileRouteManifestModule;
  readonly second?: FileRouteManifestModule;
}> {}

export class FileRouteManifestParseError extends Data.TaggedError("FileRouteManifestParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type FileRouteManifestError =
  | FileRouteManifestDuplicateRoutePath
  | FileRouteManifestDuplicateRouteId
  | FileRouteManifestDuplicateModuleRole
  | FileRouteManifestRouteModuleMismatch
  | FileRouteManifestInvalidSegment;

export const defaultFileRouteExtensions = [
  ".tsrx",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".cts",
  ".mdx",
] as const;

const normalizePath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");

const normalizeModuleId = (filePath: string): string =>
  normalizePath(filePath).split(/[?#]/, 1)[0] ?? filePath;

const stripLeadingCurrentDirectory = (path: string): string =>
  path.startsWith("./") ? path.slice(2) : path;

const stripRouteDirectory = (filePath: string, routeDirectory: string | undefined): string => {
  if (!routeDirectory) {
    return stripLeadingCurrentDirectory(filePath);
  }

  const root = stripLeadingCurrentDirectory(normalizePath(routeDirectory));
  const relative = stripLeadingCurrentDirectory(filePath);

  if (relative === root) {
    return "";
  }

  return relative.startsWith(`${root}/`) ? relative.slice(root.length + 1) : relative;
};

const stripExtension = (
  path: string,
  extensions: readonly string[],
): { readonly path: string; readonly extension: string } | undefined => {
  const sorted = [...extensions].sort((left, right) => right.length - left.length);

  for (const extension of sorted) {
    if (path.endsWith(extension)) {
      return { path: path.slice(0, -extension.length), extension };
    }

    const queryIndex = path.indexOf(`${extension}?`);
    const hashIndex = path.indexOf(`${extension}#`);
    const suffixIndex =
      queryIndex === -1
        ? hashIndex
        : hashIndex === -1
          ? queryIndex
          : Math.min(queryIndex, hashIndex);

    if (suffixIndex !== -1) {
      return { path: path.slice(0, suffixIndex), extension };
    }
  }

  return undefined;
};

const isErrorBoundaryFile = (segment: string): boolean =>
  segment === "error" ||
  segment === "_error" ||
  segment === "+error" ||
  segment === "error-boundary" ||
  segment === "_error-boundary" ||
  segment === "+error-boundary";

const isMetadataFile = (segment: string): boolean =>
  segment === "meta" ||
  segment === "_meta" ||
  segment === "+meta" ||
  segment === "metadata" ||
  segment === "_metadata" ||
  segment === "+metadata" ||
  segment === "head" ||
  segment === "_head" ||
  segment === "+head";

const isLayoutFile = (segment: string): boolean =>
  segment === "layout" ||
  segment === "_layout" ||
  segment === "+layout" ||
  isFileRoutePathlessSegment(segment);

const fileRouteModuleKindFromLeaf = (segment: string): FileRouteModuleKind => {
  if (isErrorBoundaryFile(segment)) {
    return "ErrorBoundary";
  }
  if (isMetadataFile(segment)) {
    return "Metadata";
  }
  if (isLayoutFile(segment)) {
    return "Layout";
  }
  return "Route";
};

const exportNameForModuleKind = (kind: FileRouteModuleKind): string => {
  switch (kind) {
    case "Route":
      return "Route";
    case "Layout":
      return "Layout";
    case "ErrorBoundary":
      return "ErrorBoundary";
    case "Metadata":
      return "Metadata";
  }
};

const compareString = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const invalidSegmentFromPathDecodeError = (
  error: FileRoutePathDecodeInvalidSegment,
  filePath: string,
): FileRouteManifestInvalidSegment =>
  new FileRouteManifestInvalidSegment({
    filePath,
    segment: error.segment,
    reason: error.reason,
  });

const decodeManifestPathFields = (
  value: {
    readonly routeId: string;
    readonly routePath: string;
    readonly segments: readonly unknown[];
    readonly params: readonly unknown[];
  },
  owner: string,
): Effect.Effect<DecodedFileRoutePath, FileRouteManifestParseError> =>
  decodeSerializedFileRoutePathEffect(value, { owner }).pipe(
    Effect.mapError(
      (error) =>
        new FileRouteManifestParseError({
          message: error.message,
        }),
    ),
  );

const compareManifestEntries = (
  left: FileRouteManifestEntry,
  right: FileRouteManifestEntry,
): number => {
  const length = Math.max(left.segments.length, right.segments.length);

  for (let index = 0; index < length; index++) {
    const comparison = compareRoutePathSegment(left.segments[index], right.segments[index]);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return compareString(left.filePath, right.filePath);
};

const compareManifestModules = (
  left: FileRouteManifestModule,
  right: FileRouteManifestModule,
): number => {
  const kind = compareString(left.kind, right.kind);
  if (kind !== 0) {
    return kind;
  }

  const length = Math.max(left.segments.length, right.segments.length);
  for (let index = 0; index < length; index++) {
    const comparison = compareRoutePathSegment(left.segments[index], right.segments[index]);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return compareString(left.filePath, right.filePath);
};

const fileRouteSourceSegments = (value: { readonly id: FileRouteSourceId }): readonly string[] =>
  String(value.id)
    .split("/")
    .filter((segment) => segment.length > 0);

const fileRouteSourceScope = (value: {
  readonly id: FileRouteSourceId;
  readonly kind?: FileRouteModuleKind;
}): readonly string[] => {
  const segments = fileRouteSourceSegments(value);
  const leaf = segments.at(-1);
  if (leaf === undefined) {
    return [];
  }

  const kind = value.kind ?? "Route";
  return kind !== "Route" || leaf === "index" ? segments.slice(0, -1) : segments;
};

const isFileRouteSourceScopePrefix = (
  parent: readonly string[],
  child: readonly string[],
): boolean =>
  parent.length <= child.length && parent.every((segment, index) => child[index] === segment);

const fileRouteSourceScopeKey = (value: {
  readonly id: FileRouteSourceId;
  readonly kind?: FileRouteModuleKind;
}): string => fileRouteSourceScope(value).join("/");

const compareBySourceScopeDepthThenPath = (
  left: {
    readonly id: FileRouteSourceId;
    readonly filePath: string;
    readonly kind?: FileRouteModuleKind;
  },
  right: {
    readonly id: FileRouteSourceId;
    readonly filePath: string;
    readonly kind?: FileRouteModuleKind;
  },
): number => {
  const depth = fileRouteSourceScope(left).length - fileRouteSourceScope(right).length;
  return depth === 0 ? compareString(left.filePath, right.filePath) : depth;
};

const fileRouteModuleToManifestEntry = (
  module: FileRouteManifestModule | undefined,
): FileRouteManifestEntry | undefined => {
  if (!module || module.kind !== "Route") {
    return undefined;
  }

  return {
    id: module.id,
    routeId: module.routeId,
    moduleId: module.moduleId,
    filePath: module.filePath,
    routePath: module.routePath,
    segments: module.segments,
    params: module.params,
  };
};

const manifestEntryToRouteModule = (entry: FileRouteManifestEntry): FileRouteManifestModule => ({
  id: entry.id,
  kind: "Route",
  routeId: entry.routeId,
  moduleId: entry.moduleId,
  filePath: entry.filePath,
  routePath: entry.routePath,
  segments: entry.segments,
  params: entry.params,
  exportName: exportNameForModuleKind("Route"),
});

/** Converts one file path to a route/layout/error/metadata module when it matches route conventions. */
export const filePathToFileRouteModule = (
  filePath: string,
  options: FileRouteManifestOptions = {},
): FileRouteManifestModule | undefined => {
  const normalized = normalizePath(filePath);
  const relative = stripRouteDirectory(normalized, options.routeDirectory);
  const stripped = stripExtension(relative, options.extensions ?? defaultFileRouteExtensions);

  if (!stripped) {
    return undefined;
  }

  const rawSegments = stripped.path.split("/").filter((segment) => segment.length > 0);
  const leaf = rawSegments.at(-1);

  if (!leaf) {
    return undefined;
  }

  const kind = fileRouteModuleKindFromLeaf(leaf);
  const routeSegments =
    kind === "Route" && leaf !== "index" ? rawSegments : rawSegments.slice(0, -1);
  const decodedPath = decodeFileRoutePath(routeSegments);
  if (!decodedPath) {
    return undefined;
  }

  return {
    id: makeFileRouteSourceId(stripped.path),
    kind,
    routeId: makeFileRouteId(decodedPath.routeId),
    moduleId: normalizeModuleId(normalized),
    filePath: normalized,
    routePath: decodedPath.routePath,
    segments: decodedPath.segments,
    params: decodedPath.params,
    exportName: exportNameForModuleKind(kind),
  };
};

/** Effect variant of `filePathToFileRouteModule` that reports invalid route segments. */
export const filePathToFileRouteModuleEffect = (
  filePath: string,
  options: FileRouteManifestOptions = {},
): Effect.Effect<FileRouteManifestModule | undefined, FileRouteManifestInvalidSegment> =>
  Effect.gen(function* () {
    const normalized = normalizePath(filePath);
    const relative = stripRouteDirectory(normalized, options.routeDirectory);
    const stripped = stripExtension(relative, options.extensions ?? defaultFileRouteExtensions);

    if (!stripped) {
      return undefined;
    }

    const rawSegments = stripped.path.split("/").filter((segment) => segment.length > 0);
    const leaf = rawSegments.at(-1);

    if (!leaf) {
      return undefined;
    }

    const kind = fileRouteModuleKindFromLeaf(leaf);
    const routeSegments =
      kind === "Route" && leaf !== "index" ? rawSegments : rawSegments.slice(0, -1);
    const decodedPath = yield* decodeFileRoutePathEffect(routeSegments).pipe(
      Effect.mapError((error) => invalidSegmentFromPathDecodeError(error, normalized)),
    );

    return {
      id: makeFileRouteSourceId(stripped.path),
      kind,
      routeId: makeFileRouteId(decodedPath.routeId),
      moduleId: normalizeModuleId(normalized),
      filePath: normalized,
      routePath: decodedPath.routePath,
      segments: decodedPath.segments,
      params: decodedPath.params,
      exportName: exportNameForModuleKind(kind),
    };
  });

/** Converts one file path to a route entry, ignoring non-route companion modules. */
export const filePathToRouteManifestEntry = (
  filePath: string,
  options: FileRouteManifestOptions = {},
): FileRouteManifestEntry | undefined =>
  fileRouteModuleToManifestEntry(filePathToFileRouteModule(filePath, options));

/** Effect variant of `filePathToRouteManifestEntry` that reports invalid route segments. */
export const filePathToRouteManifestEntryEffect = (
  filePath: string,
  options: FileRouteManifestOptions = {},
): Effect.Effect<FileRouteManifestEntry | undefined, FileRouteManifestInvalidSegment> =>
  Effect.map(filePathToFileRouteModuleEffect(filePath, options), fileRouteModuleToManifestEntry);

/** Generates sorted route entries from discovered file paths without duplicate validation. */
export const generateFileRouteManifest = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): readonly FileRouteManifestEntry[] =>
  Array.from(filePaths, (filePath) => filePathToRouteManifestEntry(filePath, options))
    .filter((entry): entry is FileRouteManifestEntry => entry !== undefined)
    .sort(compareManifestEntries);

/** Generates sorted route, layout, error-boundary, and metadata modules from discovered file paths. */
export const generateFileRouteModules = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): readonly FileRouteManifestModule[] =>
  Array.from(filePaths, (filePath) => filePathToFileRouteModule(filePath, options))
    .filter((module): module is FileRouteManifestModule => module !== undefined)
    .sort(compareManifestModules);

/**
 * Validates duplicate route paths and route/module consistency.
 *
 * Duplicate support modules are duplicate only within the same module kind,
 * route path, and source-id scope.
 */
export const validateFileRouteManifestEffect = (
  entries: Iterable<FileRouteManifestEntry>,
  modules?: Iterable<FileRouteManifestModule>,
): Effect.Effect<readonly FileRouteManifestEntry[], FileRouteManifestError> =>
  Effect.gen(function* () {
    const byRoutePath = new Map<string, FileRouteManifestEntry>();
    const byRouteId = new Map<string, FileRouteManifestEntry>();
    const result = Array.from(entries).sort(compareManifestEntries);
    const moduleResult = Array.from(modules ?? []);
    const validateRouteModules = modules !== undefined;
    const byModuleRole = new Map<string, FileRouteManifestModule>();

    for (const entry of result) {
      const existing = byRoutePath.get(entry.routePath);
      if (existing) {
        return yield* Effect.fail(
          new FileRouteManifestDuplicateRoutePath({
            routePath: entry.routePath,
            first: existing,
            second: entry,
          }),
        );
      }
      byRoutePath.set(entry.routePath, entry);

      const existingRouteId = byRouteId.get(entry.routeId);
      if (existingRouteId) {
        return yield* Effect.fail(
          new FileRouteManifestDuplicateRouteId({
            routeId: entry.routeId,
            first: existingRouteId,
            second: entry,
          }),
        );
      }
      byRouteId.set(entry.routeId, entry);
    }

    for (const module of moduleResult) {
      if (module.kind === "Route") {
        continue;
      }

      const key = `${module.kind}:${module.routePath}:${fileRouteSourceScopeKey(module)}`;
      const existing = byModuleRole.get(key);
      if (existing) {
        return yield* Effect.fail(
          new FileRouteManifestDuplicateModuleRole({
            kind: module.kind,
            routePath: module.routePath,
            first: existing,
            second: module,
          }),
        );
      }
      byModuleRole.set(key, module);
    }

    if (validateRouteModules) {
      const routeModulesByEntry = new Map<string, FileRouteManifestModule[]>();
      const entryKeys = new Set<string>();
      const routeModuleKey = (routePath: string, moduleId: string) =>
        `${routePath}\u0000${moduleId}`;
      for (const entry of result) {
        entryKeys.add(routeModuleKey(entry.routePath, entry.moduleId));
      }
      for (const module of moduleResult) {
        if (module.kind !== "Route") {
          continue;
        }

        const key = routeModuleKey(module.routePath, module.moduleId);
        if (!entryKeys.has(key)) {
          return yield* Effect.fail(
            new FileRouteManifestRouteModuleMismatch({
              reason: "OrphanRouteModule",
              routePath: module.routePath,
              moduleId: module.moduleId,
              module,
            }),
          );
        }
        routeModulesByEntry.set(key, [...(routeModulesByEntry.get(key) ?? []), module]);
      }
      for (const entry of result) {
        const key = routeModuleKey(entry.routePath, entry.moduleId);
        const matching = routeModulesByEntry.get(key) ?? [];
        if (matching.length === 0) {
          return yield* Effect.fail(
            new FileRouteManifestRouteModuleMismatch({
              reason: "MissingRouteModule",
              routePath: entry.routePath,
              moduleId: entry.moduleId,
              entry,
            }),
          );
        }
        if (matching.length > 1) {
          const first = matching[0]!;
          const second = matching[1]!;
          return yield* Effect.fail(
            new FileRouteManifestRouteModuleMismatch({
              reason: "DuplicateRouteModule",
              routePath: entry.routePath,
              moduleId: entry.moduleId,
              entry,
              first,
              second,
            }),
          );
        }
      }
    }

    return result;
  });

/** Creates a normalized manifest from route entries and optional explicit modules. */
export const createFileRouteManifest = (
  entries: Iterable<FileRouteManifestEntry>,
  options: FileRouteManifestOptions = {},
  modules: Iterable<FileRouteManifestModule> = [],
): FileRouteManifest => {
  const routeDirectory =
    options.routeDirectory === undefined
      ? {}
      : { routeDirectory: normalizePath(options.routeDirectory) };
  const sortedEntries = Array.from(entries).sort(compareManifestEntries);
  const explicitModules = Array.from(modules);
  const sortedModules = (
    explicitModules.length === 0 ? sortedEntries.map(manifestEntryToRouteModule) : explicitModules
  ).sort(compareManifestModules);

  return {
    version: 1,
    ...routeDirectory,
    entries: sortedEntries,
    modules: sortedModules,
  };
};

/** Serializes a file-route manifest for virtual-module handoff. */
export const serializeFileRouteManifest = (manifest: FileRouteManifest): string =>
  JSON.stringify(manifest);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isIdentifier = (value: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);

const isFileRouteModuleKind = (value: unknown): value is FileRouteModuleKind =>
  value === "Route" || value === "Layout" || value === "ErrorBoundary" || value === "Metadata";

const decodeSerializedModule = (
  value: unknown,
  index: number,
): Effect.Effect<FileRouteManifestModule, FileRouteManifestParseError> =>
  Effect.gen(function* () {
    if (
      !isRecord(value) ||
      !isNonEmptyString(value.id) ||
      !isFileRouteModuleKind(value.kind) ||
      !isNonEmptyString(value.routeId) ||
      !isNonEmptyString(value.moduleId) ||
      !isNonEmptyString(value.filePath) ||
      !isNonEmptyString(value.routePath) ||
      !Array.isArray(value.segments) ||
      !Array.isArray(value.params) ||
      !isNonEmptyString(value.exportName) ||
      !isIdentifier(value.exportName)
    ) {
      return yield* Effect.fail(
        new FileRouteManifestParseError({
          message: `File route module ${index} has invalid top-level fields.`,
        }),
      );
    }

    const decodedPath = yield* decodeManifestPathFields(
      {
        routeId: value.routeId,
        routePath: value.routePath,
        segments: value.segments,
        params: value.params,
      },
      `File route module ${index}`,
    );

    return {
      id: makeFileRouteSourceId(value.id),
      kind: value.kind,
      routeId: makeFileRouteId(decodedPath.routeId),
      moduleId: normalizeModuleId(value.moduleId),
      filePath: normalizePath(value.filePath),
      routePath: decodedPath.routePath,
      segments: decodedPath.segments,
      params: decodedPath.params,
      exportName: value.exportName,
    };
  });

const decodeSerializedEntry = (
  value: unknown,
  index: number,
): Effect.Effect<FileRouteManifestEntry, FileRouteManifestParseError> =>
  Effect.gen(function* () {
    if (
      !isRecord(value) ||
      !isNonEmptyString(value.id) ||
      !isNonEmptyString(value.routeId) ||
      !isNonEmptyString(value.moduleId) ||
      !isNonEmptyString(value.filePath) ||
      !isNonEmptyString(value.routePath) ||
      !Array.isArray(value.segments) ||
      !Array.isArray(value.params)
    ) {
      return yield* Effect.fail(
        new FileRouteManifestParseError({
          message: `File route manifest entry ${index} has invalid top-level fields.`,
        }),
      );
    }

    const decodedPath = yield* decodeManifestPathFields(
      {
        routeId: value.routeId,
        routePath: value.routePath,
        segments: value.segments,
        params: value.params,
      },
      `File route manifest entry ${index}`,
    );

    return {
      id: makeFileRouteSourceId(value.id),
      routeId: makeFileRouteId(decodedPath.routeId),
      moduleId: normalizeModuleId(value.moduleId),
      filePath: normalizePath(value.filePath),
      routePath: decodedPath.routePath,
      segments: decodedPath.segments,
      params: decodedPath.params,
    };
  });

const decodeSerializedManifest = (
  value: unknown,
): Effect.Effect<FileRouteManifest, FileRouteManifestParseError | FileRouteManifestError> =>
  Effect.gen(function* () {
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.entries) ||
      (value.modules !== undefined && !Array.isArray(value.modules)) ||
      (value.routeDirectory !== undefined && !isNonEmptyString(value.routeDirectory))
    ) {
      return yield* Effect.fail(
        new FileRouteManifestParseError({
          message: "Expected a version 1 file route manifest.",
        }),
      );
    }

    const entries = yield* Effect.forEach(value.entries, decodeSerializedEntry);
    const hasSerializedModules = value.modules !== undefined;
    const modules = hasSerializedModules
      ? yield* Effect.forEach(value.modules as ReadonlyArray<unknown>, decodeSerializedModule)
      : [];
    const validated = yield* validateFileRouteManifestEffect(
      entries,
      hasSerializedModules ? modules : undefined,
    );

    return createFileRouteManifest(
      validated,
      value.routeDirectory === undefined ? {} : { routeDirectory: value.routeDirectory },
      modules,
    );
  });

/** Parses and validates a serialized file-route manifest. */
export const deserializeFileRouteManifest = (
  serialized: string,
): Effect.Effect<FileRouteManifest, FileRouteManifestParseError | FileRouteManifestError> =>
  Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: (cause) =>
      new FileRouteManifestParseError({
        message: "File route manifest is not valid JSON.",
        cause,
      }),
  }).pipe(Effect.flatMap(decodeSerializedManifest));

interface FileRouteManifestParts {
  readonly entries: readonly FileRouteManifestEntry[];
  readonly modules: readonly FileRouteManifestModule[];
}

const manifestEntriesFromModules = (
  modules: Iterable<FileRouteManifestModule>,
): readonly FileRouteManifestEntry[] =>
  Array.from(modules, fileRouteModuleToManifestEntry)
    .filter((entry): entry is FileRouteManifestEntry => entry !== undefined)
    .sort(compareManifestEntries);

const generateFileRouteManifestParts = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): FileRouteManifestParts => {
  const modules = Array.from(filePaths, (filePath) =>
    filePathToFileRouteModule(filePath, options),
  ).filter((module): module is FileRouteManifestModule => module !== undefined);

  return {
    entries: manifestEntriesFromModules(modules),
    modules: modules.sort(compareManifestModules),
  };
};

/** Generates the full manifest artifact used by Start virtual modules. */
export const generateFileRouteManifestArtifact = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): FileRouteManifest => {
  const parts = generateFileRouteManifestParts(filePaths, options);
  return createFileRouteManifest(parts.entries, options, parts.modules);
};

const generateValidatedFileRouteManifestPartsEffect = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): Effect.Effect<FileRouteManifestParts, FileRouteManifestError> =>
  Effect.gen(function* () {
    const modules = yield* Effect.forEach(filePaths, (filePath) =>
      filePathToFileRouteModuleEffect(filePath, options),
    ).pipe(
      Effect.map((modules) =>
        modules.filter((module): module is FileRouteManifestModule => module !== undefined),
      ),
    );
    const entries = manifestEntriesFromModules(modules);
    const validated = yield* validateFileRouteManifestEffect(entries, modules);

    return {
      entries: validated,
      modules: modules.sort(compareManifestModules),
    };
  });

/** Generates validated route entries and reports manifest errors in the Effect channel. */
export const generateValidatedFileRouteManifestEffect = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): Effect.Effect<readonly FileRouteManifestEntry[], FileRouteManifestError> =>
  Effect.map(
    generateValidatedFileRouteManifestPartsEffect(filePaths, options),
    (parts) => parts.entries,
  );

/** Generates a validated full manifest artifact with route and companion modules. */
export const generateValidatedFileRouteManifestArtifactEffect = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): Effect.Effect<FileRouteManifest, FileRouteManifestError> =>
  Effect.map(generateValidatedFileRouteManifestPartsEffect(filePaths, options), (parts) =>
    createFileRouteManifest(parts.entries, options, parts.modules),
  );

const compareByDepthThenPath = (
  left: { readonly segments: readonly FileRouteSegment[]; readonly filePath: string },
  right: { readonly segments: readonly FileRouteSegment[]; readonly filePath: string },
): number => {
  const depth = left.segments.length - right.segments.length;
  return depth === 0 ? compareString(left.filePath, right.filePath) : depth;
};

/**
 * Projects a manifest into per-route metadata including parent/layout/error relationships.
 *
 * Support modules are inherited by source-id scope, so pathless/grouped
 * siblings with the same URL path do not accidentally share layout, error, or
 * metadata modules.
 */
export const describeFileRouteManifest = (
  manifest: FileRouteManifest,
): readonly FileRouteRouteMetadata[] => {
  const modules =
    manifest.modules.length === 0
      ? manifest.entries.map(manifestEntryToRouteModule)
      : manifest.modules;
  const routeModules = modules.filter((module) => module.kind === "Route");

  return manifest.entries.map((entry) => {
    const routeModule =
      routeModules.find(
        (module) => module.routePath === entry.routePath && module.moduleId === entry.moduleId,
      ) ?? manifestEntryToRouteModule(entry);
    const parent = manifest.entries
      .filter(
        (candidate) =>
          candidate.routePath !== entry.routePath &&
          isRoutePathSegmentPrefix(candidate.segments, entry.segments),
      )
      .sort((left, right) => compareByDepthThenPath(right, left))[0];
    const scopedModules = modules
      .filter((module) =>
        isFileRouteSourceScopePrefix(fileRouteSourceScope(module), fileRouteSourceScope(entry)),
      )
      .sort(compareBySourceScopeDepthThenPath);
    const layouts = scopedModules.filter((module) => module.kind === "Layout");
    const errorBoundary = scopedModules
      .filter((module) => module.kind === "ErrorBoundary")
      .sort((left, right) => compareByDepthThenPath(right, left))[0];
    const metadataModules = scopedModules.filter((module) => module.kind === "Metadata");

    return {
      routeId: entry.routeId,
      routePath: entry.routePath,
      routeModule,
      ...(parent === undefined
        ? {}
        : {
            parentRouteId: parent.routeId,
            parentRoutePath: parent.routePath,
          }),
      layouts,
      ...(errorBoundary === undefined ? {} : { errorBoundary }),
      metadataModules,
    };
  });
};
