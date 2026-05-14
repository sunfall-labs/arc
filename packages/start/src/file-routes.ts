import {
  compareRoutePathSegment,
  isRoutePathSegmentPrefix,
  isRouteParamName,
  routePathFromSegments,
  routeParamsFromSegments,
  routePathSlug,
  type RoutePathParam,
  type RoutePathSegment
} from "@effect-ui/core";
import { Data, Effect, Schema } from "effect";

export const FileRouteSourceId = Schema.String.pipe(Schema.brand("FileRouteSourceId"));
export type FileRouteSourceId = typeof FileRouteSourceId.Type;

export const FileRouteId = Schema.String.pipe(Schema.brand("FileRouteId"));
export type FileRouteId = typeof FileRouteId.Type;

export const makeFileRouteSourceId = (id: string): FileRouteSourceId =>
  Schema.decodeUnknownSync(FileRouteSourceId)(id);

export const makeFileRouteId = (id: string): FileRouteId =>
  Schema.decodeUnknownSync(FileRouteId)(id);

export type FileRouteSegment = RoutePathSegment;
export type FileRouteParam = RoutePathParam;

export type FileRouteModuleKind = "Route" | "Layout" | "ErrorBoundary" | "Metadata";

export interface FileRouteManifestModule {
  readonly id: FileRouteSourceId;
  readonly kind: FileRouteModuleKind;
  readonly routeId: FileRouteId;
  readonly moduleId: string;
  readonly filePath: string;
  readonly routePath: string;
  readonly segments: readonly FileRouteSegment[];
  readonly params: readonly FileRouteParam[];
  readonly exportName: string;
}

export interface FileRouteManifestEntry {
  readonly id: FileRouteSourceId;
  readonly routeId: FileRouteId;
  readonly moduleId: string;
  readonly filePath: string;
  readonly routePath: string;
  readonly segments: readonly FileRouteSegment[];
  readonly params: readonly FileRouteParam[];
}

export interface FileRouteManifest {
  readonly version: 1;
  readonly entries: readonly FileRouteManifestEntry[];
  readonly modules: readonly FileRouteManifestModule[];
  readonly routeDirectory?: string;
}

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

export interface FileRouteManifestOptions {
  readonly routeDirectory?: string;
  readonly extensions?: readonly string[];
}

export class FileRouteManifestDuplicateRoutePath extends Data.TaggedError(
  "FileRouteManifestDuplicateRoutePath"
)<{
  readonly routePath: string;
  readonly first: FileRouteManifestEntry;
  readonly second: FileRouteManifestEntry;
}> {}

export class FileRouteManifestInvalidSegment extends Data.TaggedError(
  "FileRouteManifestInvalidSegment"
)<{
  readonly filePath: string;
  readonly segment: string;
  readonly reason: "InvalidParamName";
}> {}

export class FileRouteManifestDuplicateModuleRole extends Data.TaggedError(
  "FileRouteManifestDuplicateModuleRole"
)<{
  readonly kind: Exclude<FileRouteModuleKind, "Route">;
  readonly routePath: string;
  readonly first: FileRouteManifestModule;
  readonly second: FileRouteManifestModule;
}> {}

export class FileRouteManifestParseError extends Data.TaggedError(
  "FileRouteManifestParseError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type FileRouteManifestError =
  | FileRouteManifestDuplicateRoutePath
  | FileRouteManifestDuplicateModuleRole
  | FileRouteManifestInvalidSegment;

export const defaultFileRouteExtensions = [
  ".tsrx",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".cts",
  ".mdx"
] as const;

const normalizePath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

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
  extensions: readonly string[]
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

const isGroupSegment = (segment: string): boolean =>
  segment.startsWith("(") && segment.endsWith(")") && segment.length > 2;

const isPathlessSegment = (segment: string): boolean =>
  segment.startsWith("_") && segment.length > 1;

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
  segment === "layout" || segment === "_layout" || segment === "+layout" || isPathlessSegment(segment);

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

const routeIdFromPath = (routePath: string): FileRouteId => {
  if (routePath === "/") {
    return makeFileRouteId("route_root");
  }

  return makeFileRouteId(`route_${routePathSlug(routePath)}`);
};

const compareString = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const parseDynamicFileRouteSegment = (
  segment: string
): FileRouteSegment | undefined => {
  if (!segment.startsWith("$")) {
    return undefined;
  }

  const raw = segment.slice(1);
  const optional = raw.endsWith("?");
  const name = optional ? raw.slice(0, -1) : raw;
  return isRouteParamName(name)
    ? {
        _tag: "Dynamic",
        name,
        optional
      }
    : undefined;
};

const parseRouteSegment = (segment: string): FileRouteSegment | undefined => {
  if (isGroupSegment(segment) || isPathlessSegment(segment)) {
    return undefined;
  }

  const dynamic = parseDynamicFileRouteSegment(segment);
  if (dynamic !== undefined) {
    return dynamic;
  }

  return {
    _tag: "Static",
    value: segment
  };
};

const parseRouteSegmentEffect = (
  segment: string,
  filePath: string
): Effect.Effect<FileRouteSegment | undefined, FileRouteManifestInvalidSegment> => {
  if (isGroupSegment(segment) || isPathlessSegment(segment)) {
    return Effect.succeed(undefined);
  }

  const dynamic = parseDynamicFileRouteSegment(segment);
  if (dynamic !== undefined) {
    return Effect.succeed(dynamic);
  }

  if (segment.startsWith("$")) {
    return Effect.fail(
      new FileRouteManifestInvalidSegment({
        filePath,
        segment,
        reason: "InvalidParamName"
      })
    );
  }

  return Effect.succeed({
    _tag: "Static",
    value: segment
  });
};

const compareManifestEntries = (
  left: FileRouteManifestEntry,
  right: FileRouteManifestEntry
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
  right: FileRouteManifestModule
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

const fileRouteModuleToManifestEntry = (
  module: FileRouteManifestModule | undefined
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
    params: module.params
  };
};

const manifestEntryToRouteModule = (
  entry: FileRouteManifestEntry
): FileRouteManifestModule => ({
  id: entry.id,
  kind: "Route",
  routeId: entry.routeId,
  moduleId: entry.moduleId,
  filePath: entry.filePath,
  routePath: entry.routePath,
  segments: entry.segments,
  params: entry.params,
  exportName: exportNameForModuleKind("Route")
});

export const filePathToFileRouteModule = (
  filePath: string,
  options: FileRouteManifestOptions = {}
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
  const routeSegments = kind === "Route" && leaf !== "index"
    ? rawSegments
    : rawSegments.slice(0, -1);
  const segments = routeSegments.flatMap((segment) => {
    const parsed = parseRouteSegment(segment);
    return parsed ? [parsed] : [];
  });
  const params = routeParamsFromSegments(segments);
  const routePath = routePathFromSegments(segments);

  return {
    id: makeFileRouteSourceId(stripped.path),
    kind,
    routeId: routeIdFromPath(routePath),
    moduleId: normalizeModuleId(normalized),
    filePath: normalized,
    routePath,
    segments,
    params,
    exportName: exportNameForModuleKind(kind)
  };
};

export const filePathToFileRouteModuleEffect = (
  filePath: string,
  options: FileRouteManifestOptions = {}
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
    const routeSegments = kind === "Route" && leaf !== "index"
      ? rawSegments
      : rawSegments.slice(0, -1);
    const segments = yield* Effect.forEach(routeSegments, (segment) =>
      parseRouteSegmentEffect(segment, normalized)
    ).pipe(Effect.map((segments) => segments.filter((segment): segment is FileRouteSegment => segment !== undefined)));
    const params = routeParamsFromSegments(segments);
    const routePath = routePathFromSegments(segments);

    return {
      id: makeFileRouteSourceId(stripped.path),
      kind,
      routeId: routeIdFromPath(routePath),
      moduleId: normalizeModuleId(normalized),
      filePath: normalized,
      routePath,
      segments,
      params,
      exportName: exportNameForModuleKind(kind)
    };
  });

export const filePathToRouteManifestEntry = (
  filePath: string,
  options: FileRouteManifestOptions = {}
): FileRouteManifestEntry | undefined =>
  fileRouteModuleToManifestEntry(filePathToFileRouteModule(filePath, options));

export const filePathToRouteManifestEntryEffect = (
  filePath: string,
  options: FileRouteManifestOptions = {}
): Effect.Effect<FileRouteManifestEntry | undefined, FileRouteManifestInvalidSegment> =>
  Effect.map(filePathToFileRouteModuleEffect(filePath, options), fileRouteModuleToManifestEntry);

export const generateFileRouteManifest = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {}
): readonly FileRouteManifestEntry[] =>
  Array.from(filePaths, (filePath) => filePathToRouteManifestEntry(filePath, options))
    .filter((entry): entry is FileRouteManifestEntry => entry !== undefined)
    .sort(compareManifestEntries);

export const generateFileRouteModules = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {}
): readonly FileRouteManifestModule[] =>
  Array.from(filePaths, (filePath) => filePathToFileRouteModule(filePath, options))
    .filter((module): module is FileRouteManifestModule => module !== undefined)
    .sort(compareManifestModules);

export const validateFileRouteManifestEffect = (
  entries: Iterable<FileRouteManifestEntry>,
  modules: Iterable<FileRouteManifestModule> = []
): Effect.Effect<readonly FileRouteManifestEntry[], FileRouteManifestError> =>
  Effect.gen(function* () {
    const byRoutePath = new Map<string, FileRouteManifestEntry>();
    const result = Array.from(entries).sort(compareManifestEntries);
    const moduleResult = Array.from(modules);
    const byModuleRole = new Map<string, FileRouteManifestModule>();

    for (const entry of result) {
      const existing = byRoutePath.get(entry.routePath);
      if (existing) {
        return yield* Effect.fail(
          new FileRouteManifestDuplicateRoutePath({
            routePath: entry.routePath,
            first: existing,
            second: entry
          })
        );
      }
      byRoutePath.set(entry.routePath, entry);
    }

    for (const module of moduleResult) {
      if (module.kind === "Route") {
        continue;
      }

      const key = `${module.kind}:${module.routePath}`;
      const existing = byModuleRole.get(key);
      if (existing) {
        return yield* Effect.fail(
          new FileRouteManifestDuplicateModuleRole({
            kind: module.kind,
            routePath: module.routePath,
            first: existing,
            second: module
          })
        );
      }
      byModuleRole.set(key, module);
    }

    return result;
  });

export const createFileRouteManifest = (
  entries: Iterable<FileRouteManifestEntry>,
  options: FileRouteManifestOptions = {},
  modules: Iterable<FileRouteManifestModule> = []
): FileRouteManifest => {
  const routeDirectory = options.routeDirectory === undefined
    ? {}
    : { routeDirectory: normalizePath(options.routeDirectory) };
  const sortedEntries = Array.from(entries).sort(compareManifestEntries);
  const explicitModules = Array.from(modules);
  const sortedModules = (explicitModules.length === 0
    ? sortedEntries.map(manifestEntryToRouteModule)
    : explicitModules).sort(compareManifestModules);

  return {
    version: 1,
    ...routeDirectory,
    entries: sortedEntries,
    modules: sortedModules
  };
};

export const serializeFileRouteManifest = (manifest: FileRouteManifest): string =>
  JSON.stringify(manifest);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isIdentifier = (value: string): boolean =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);

const isFileRouteModuleKind = (value: unknown): value is FileRouteModuleKind =>
  value === "Route" ||
  value === "Layout" ||
  value === "ErrorBoundary" ||
  value === "Metadata";

const decodeSerializedSegment = (
  value: unknown,
  index: number
): Effect.Effect<FileRouteSegment, FileRouteManifestParseError> => {
  if (!isRecord(value)) {
    return Effect.fail(
      new FileRouteManifestParseError({
        message: `Expected file route segment ${index} to be a record.`
      })
    );
  }

  if (value._tag === "Static" && isNonEmptyString(value.value)) {
    return Effect.succeed({
      _tag: "Static",
      value: value.value
    });
  }

  if (
    value._tag === "Dynamic" &&
    isNonEmptyString(value.name) &&
    isRouteParamName(value.name) &&
    typeof value.optional === "boolean"
  ) {
    return Effect.succeed({
      _tag: "Dynamic",
      name: value.name,
      optional: value.optional
    });
  }

  return Effect.fail(
    new FileRouteManifestParseError({
      message: `File route segment ${index} is invalid.`
    })
  );
};

const decodeSerializedParam = (
  value: unknown,
  index: number
): Effect.Effect<FileRouteParam, FileRouteManifestParseError> => {
  if (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isRouteParamName(value.name) &&
    typeof value.optional === "boolean"
  ) {
    return Effect.succeed({
      name: value.name,
      optional: value.optional
    });
  }

  return Effect.fail(
    new FileRouteManifestParseError({
      message: `File route param ${index} is invalid.`
    })
  );
};

const decodeSerializedModule = (
  value: unknown,
  index: number
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
          message: `File route module ${index} has invalid top-level fields.`
        })
      );
    }

    const segments = yield* Effect.forEach(value.segments, decodeSerializedSegment);
    const params = yield* Effect.forEach(value.params, decodeSerializedParam);
    const routePath = routePathFromSegments(segments);
    const expectedParams = routeParamsFromSegments(segments);

    if (
      value.routePath !== routePath ||
      value.routeId !== routeIdFromPath(routePath) ||
      JSON.stringify(params) !== JSON.stringify(expectedParams)
    ) {
      return yield* Effect.fail(
        new FileRouteManifestParseError({
          message: `File route module ${index} does not match its segments.`
        })
      );
    }

    return {
      id: makeFileRouteSourceId(value.id),
      kind: value.kind,
      routeId: makeFileRouteId(value.routeId),
      moduleId: normalizeModuleId(value.moduleId),
      filePath: normalizePath(value.filePath),
      routePath,
      segments,
      params,
      exportName: value.exportName
    };
  });

const decodeSerializedEntry = (
  value: unknown,
  index: number
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
          message: `File route manifest entry ${index} has invalid top-level fields.`
        })
      );
    }

    const segments = yield* Effect.forEach(value.segments, decodeSerializedSegment);
    const params = yield* Effect.forEach(value.params, decodeSerializedParam);
    const routePath = routePathFromSegments(segments);
    const expectedParams = routeParamsFromSegments(segments);

    if (
      value.routePath !== routePath ||
      value.routeId !== routeIdFromPath(routePath) ||
      JSON.stringify(params) !== JSON.stringify(expectedParams)
    ) {
      return yield* Effect.fail(
        new FileRouteManifestParseError({
          message: `File route manifest entry ${index} does not match its segments.`
        })
      );
    }

    return {
      id: makeFileRouteSourceId(value.id),
      routeId: makeFileRouteId(value.routeId),
      moduleId: normalizeModuleId(value.moduleId),
      filePath: normalizePath(value.filePath),
      routePath,
      segments,
      params
    };
  });

const decodeSerializedManifest = (
  value: unknown
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
          message: "Expected a version 1 file route manifest."
        })
      );
    }

    const entries = yield* Effect.forEach(value.entries, decodeSerializedEntry);
    const modules = value.modules === undefined
      ? []
      : yield* Effect.forEach(value.modules, decodeSerializedModule);
    const validated = yield* validateFileRouteManifestEffect(entries, modules);

    return createFileRouteManifest(validated, {
      ...(value.routeDirectory === undefined
        ? {}
        : { routeDirectory: value.routeDirectory })
    }, modules);
  });

export const deserializeFileRouteManifest = (
  serialized: string
): Effect.Effect<FileRouteManifest, FileRouteManifestParseError | FileRouteManifestError> =>
  Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: (cause) =>
      new FileRouteManifestParseError({
        message: "File route manifest is not valid JSON.",
        cause
      })
  }).pipe(Effect.flatMap(decodeSerializedManifest));

export const generateFileRouteManifestArtifact = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {}
): FileRouteManifest =>
  createFileRouteManifest(
    generateFileRouteManifest(filePaths, options),
    options,
    generateFileRouteModules(filePaths, options)
  );

interface FileRouteManifestParts {
  readonly entries: readonly FileRouteManifestEntry[];
  readonly modules: readonly FileRouteManifestModule[];
}

const generateValidatedFileRouteManifestPartsEffect = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {}
): Effect.Effect<FileRouteManifestParts, FileRouteManifestError> =>
  Effect.gen(function* () {
    const modules = yield* Effect.forEach(filePaths, (filePath) =>
      filePathToFileRouteModuleEffect(filePath, options)
    ).pipe(Effect.map((modules) => modules.filter((module): module is FileRouteManifestModule => module !== undefined)));
    const entries = modules.flatMap((module) => {
      const entry = fileRouteModuleToManifestEntry(module);
      return entry ? [entry] : [];
    });
    const validated = yield* validateFileRouteManifestEffect(entries, modules);

    return {
      entries: validated,
      modules: modules.sort(compareManifestModules)
    };
  });

export const generateValidatedFileRouteManifestEffect = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {}
): Effect.Effect<readonly FileRouteManifestEntry[], FileRouteManifestError> =>
  Effect.map(generateValidatedFileRouteManifestPartsEffect(filePaths, options), (parts) => parts.entries);

export const generateValidatedFileRouteManifestArtifactEffect = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {}
): Effect.Effect<FileRouteManifest, FileRouteManifestError> =>
  Effect.map(generateValidatedFileRouteManifestPartsEffect(filePaths, options), (parts) =>
    createFileRouteManifest(parts.entries, options, parts.modules)
  );

const compareByDepthThenPath = (
  left: { readonly segments: readonly FileRouteSegment[]; readonly filePath: string },
  right: { readonly segments: readonly FileRouteSegment[]; readonly filePath: string }
): number => {
  const depth = left.segments.length - right.segments.length;
  return depth === 0 ? compareString(left.filePath, right.filePath) : depth;
};

export const describeFileRouteManifest = (
  manifest: FileRouteManifest
): readonly FileRouteRouteMetadata[] => {
  const modules = manifest.modules.length === 0
    ? manifest.entries.map(manifestEntryToRouteModule)
    : manifest.modules;
  const routeModules = modules.filter((module) => module.kind === "Route");

  return manifest.entries.map((entry) => {
    const routeModule = routeModules.find((module) =>
      module.routePath === entry.routePath && module.moduleId === entry.moduleId
    ) ?? manifestEntryToRouteModule(entry);
    const parent = manifest.entries
      .filter((candidate) =>
        candidate.routePath !== entry.routePath &&
        isRoutePathSegmentPrefix(candidate.segments, entry.segments)
      )
      .sort((left, right) => compareByDepthThenPath(right, left))[0];
    const scopedModules = modules
      .filter((module) => isRoutePathSegmentPrefix(module.segments, entry.segments))
      .sort(compareByDepthThenPath);
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
            parentRoutePath: parent.routePath
          }),
      layouts,
      ...(errorBoundary === undefined ? {} : { errorBoundary }),
      metadataModules
    };
  });
};
