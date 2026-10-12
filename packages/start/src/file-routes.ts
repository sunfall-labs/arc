import {
  compareRoutePathSegment,
  isRouteParamName,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSlug,
  type RoutePathParam,
  type RoutePathSegment,
} from "@sunfall/arc-core/internal";
import { Data, Effect } from "effect";

/** Decoded route path segment used by file-route manifests. */
export type FileRouteSegment = RoutePathSegment;
/** Decoded path parameter used by file-route manifests. */
export type FileRouteParam = RoutePathParam;

/**
 * File-route module roles discovered from file names such as route/layout/error/metadata.
 *
 * Layout, error-boundary, and metadata modules are scoped by source id
 * directory, not URL path alone. Sibling route groups may share the same route
 * path while keeping support modules isolated by source scope. A `Component`
 * module (`$id.component.tsx` beside `$id.ts`) default-exports its route's
 * component, which the generated route tree attaches as a lazy chunk.
 */
export type FileRouteModuleKind = "Route" | "Component" | "Layout" | "ErrorBoundary" | "Metadata";

/** One module discovered from the file-route tree. */
export interface FileRouteManifestModule {
  /** Source-file identity relative to the route directory, without extension. */
  readonly id: string;
  /** Role this module plays for its route path. */
  readonly kind: FileRouteModuleKind;
  /** Generated route identity shared by all modules for the same route path. */
  readonly routeId: string;
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

/** Route entry used by generated route definitions. */
export type FileRouteManifestEntry = Omit<FileRouteManifestModule, "kind" | "exportName">;

/** Complete file-route manifest emitted by discovery and virtual modules. */
export interface FileRouteManifest {
  /** Manifest schema version. */
  readonly version: 1;
  /** Route entries that produce runtime route definitions. */
  readonly entries: readonly FileRouteManifestEntry[];
  /** All route-related modules, including component/layout/error/metadata modules. */
  readonly modules: readonly FileRouteManifestModule[];
  /** Optional route directory used to make file paths relative. */
  readonly routeDirectory?: string;
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
  readonly routeId: string;
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

const stripLeadingCurrentDirectory = (path: string): string =>
  path.startsWith("./") ? path.slice(2) : path;

const stripRouteDirectory = (filePath: string, routeDirectory: string | undefined): string => {
  const relative = stripLeadingCurrentDirectory(filePath);
  if (!routeDirectory) {
    return relative;
  }
  const root = stripLeadingCurrentDirectory(normalizePath(routeDirectory));
  return relative === root
    ? ""
    : relative.startsWith(`${root}/`)
      ? relative.slice(root.length + 1)
      : relative;
};

/** Strips the longest matching extension and any query or hash after it (`$id?` is a name). */
const stripExtension = (path: string, extensions: readonly string[]): string | undefined => {
  for (const extension of [...extensions].sort((left, right) => right.length - left.length)) {
    const escaped = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^(.*?)${escaped}(?:[?#].*)?$`).exec(path);
    if (match !== null) {
      return match[1];
    }
  }
  return undefined;
};

const isFileRoutePathlessSegment = (segment: string): boolean =>
  segment.startsWith("_") && segment.length > 1;

/**
 * Decodes one file-name segment: route groups `(name)` and pathless `_name`
 * segments add nothing to the URL, `$id` / `$id?` are params.
 */
const decodeSegment = (
  segment: string,
  filePath: string,
): Effect.Effect<RoutePathSegment | undefined, FileRouteManifestInvalidSegment> => {
  const group = segment.startsWith("(") && segment.endsWith(")") && segment.length > 2;
  if (group || isFileRoutePathlessSegment(segment)) {
    return Effect.succeed(undefined);
  }
  if (!segment.startsWith("$")) {
    return Effect.succeed({ _tag: "Static", value: segment });
  }
  const raw = segment.slice(1);
  const optional = raw.endsWith("?");
  const name = optional ? raw.slice(0, -1) : raw;
  return isRouteParamName(name)
    ? Effect.succeed({ _tag: "Dynamic", name, optional })
    : Effect.fail(
        new FileRouteManifestInvalidSegment({ filePath, segment, reason: "InvalidParamName" }),
      );
};

const leafNames = (...names: readonly string[]): ReadonlySet<string> =>
  new Set(names.flatMap((name) => [name, `_${name}`, `+${name}`]));

const errorBoundaryLeaves = leafNames("error", "error-boundary");
const metadataLeaves = leafNames("meta", "metadata", "head");
const layoutLeaves = leafNames("layout");
const componentSuffix = ".component";

const fileRouteModuleKindFromLeaf = (segment: string): FileRouteModuleKind =>
  segment.endsWith(componentSuffix) && segment.length > componentSuffix.length
    ? "Component"
    : errorBoundaryLeaves.has(segment)
      ? "ErrorBoundary"
      : metadataLeaves.has(segment)
        ? "Metadata"
        : layoutLeaves.has(segment) || isFileRoutePathlessSegment(segment)
          ? "Layout"
          : "Route";

/** The route segments a module's file location maps to. */
const fileRouteSegmentsFor = (
  kind: FileRouteModuleKind,
  rawSegments: readonly string[],
): readonly string[] => {
  const leaf = rawSegments.at(-1) ?? "";
  const route = kind === "Component" ? leaf.slice(0, -componentSuffix.length) : leaf;
  return (kind === "Route" || kind === "Component") && route !== "index"
    ? [...rawSegments.slice(0, -1), route]
    : rawSegments.slice(0, -1);
};

/**
 * Export name each module role must provide. Route modules export
 * `route = Route.define(path, options)`; Start checks the declared path against
 * the path derived from the file location.
 */
export const fileRouteModuleExportName = (kind: FileRouteModuleKind): string =>
  kind === "Route" ? "route" : kind === "Component" ? "default" : kind;

const compareString = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareBySegmentsThenPath = (
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
): number => compareString(left.kind, right.kind) || compareBySegmentsThenPath(left, right);

/**
 * The source directory a module applies to: support modules apply to their
 * directory, route modules (other than `index`) to their own path.
 */
const fileRouteSourceScope = (value: {
  readonly id: string;
  readonly kind?: FileRouteModuleKind;
}): readonly string[] => {
  const segments = value.id.split("/").filter((segment) => segment.length > 0);
  const leaf = segments.at(-1);
  if (leaf === undefined) {
    return [];
  }
  return (value.kind ?? "Route") !== "Route" || leaf === "index" ? segments.slice(0, -1) : segments;
};

const isFileRouteSourceScopePrefix = (
  parent: readonly string[],
  child: readonly string[],
): boolean =>
  parent.length <= child.length && parent.every((segment, index) => child[index] === segment);

const compareBySourceScopeDepthThenPath = (
  left: FileRouteManifestModule,
  right: FileRouteManifestModule,
): number =>
  fileRouteSourceScope(left).length - fileRouteSourceScope(right).length ||
  compareString(left.filePath, right.filePath);

const manifestEntry = ({
  kind: _kind,
  exportName: _exportName,
  ...entry
}: FileRouteManifestModule): FileRouteManifestEntry => entry;

const manifestEntryToRouteModule = (entry: FileRouteManifestEntry): FileRouteManifestModule => ({
  ...entry,
  kind: "Route",
  exportName: fileRouteModuleExportName("Route"),
});

/** Converts one file path to a route/component/layout/error/metadata module when it matches route conventions. */
export const filePathToFileRouteModule = (
  filePath: string,
  options: FileRouteManifestOptions = {},
): Effect.Effect<FileRouteManifestModule | undefined, FileRouteManifestInvalidSegment> =>
  Effect.gen(function* () {
    const normalized = normalizePath(filePath);
    const id = stripExtension(
      stripRouteDirectory(normalized, options.routeDirectory),
      options.extensions ?? defaultFileRouteExtensions,
    );
    const rawSegments = id?.split("/").filter((segment) => segment.length > 0) ?? [];
    const leaf = rawSegments.at(-1);
    if (id === undefined || leaf === undefined) {
      return undefined;
    }

    const kind = fileRouteModuleKindFromLeaf(leaf);
    const segments = (yield* Effect.forEach(fileRouteSegmentsFor(kind, rawSegments), (segment) =>
      decodeSegment(segment, normalized),
    )).filter((segment): segment is RoutePathSegment => segment !== undefined);
    const routePath = routePathFromSegments(segments);

    return {
      id,
      kind,
      routeId: routePath === "/" ? "route_root" : `route_${routePathSlug(routePath)}`,
      moduleId: normalized.split(/[?#]/, 1)[0] ?? normalized,
      filePath: normalized,
      routePath,
      segments,
      params: routeParamsFromSegments(segments),
      exportName: fileRouteModuleExportName(kind),
    };
  });

const firstDuplicate = <A>(
  values: Iterable<A>,
  key: (value: A) => string,
): readonly [A, A] | undefined => {
  const seen = new Map<string, A>();
  for (const value of values) {
    const existing = seen.get(key(value));
    if (existing !== undefined) {
      return [existing, value];
    }
    seen.set(key(value), value);
  }
  return undefined;
};

/**
 * Validates duplicate route paths and route/module consistency.
 *
 * Duplicate support modules are duplicate only within the same module kind,
 * route path, and source-id scope.
 */
export const validateFileRouteManifest = (
  entries: Iterable<FileRouteManifestEntry>,
  modules?: Iterable<FileRouteManifestModule>,
): Effect.Effect<readonly FileRouteManifestEntry[], FileRouteManifestError> =>
  Effect.gen(function* () {
    const result = Array.from(entries).sort(compareBySegmentsThenPath);
    const moduleResult = Array.from(modules ?? []);

    const samePath = firstDuplicate(result, (entry) => entry.routePath);
    if (samePath !== undefined) {
      return yield* new FileRouteManifestDuplicateRoutePath({
        routePath: samePath[1].routePath,
        first: samePath[0],
        second: samePath[1],
      });
    }
    const sameId = firstDuplicate(result, (entry) => entry.routeId);
    if (sameId !== undefined) {
      return yield* new FileRouteManifestDuplicateRouteId({
        routeId: sameId[1].routeId,
        first: sameId[0],
        second: sameId[1],
      });
    }
    const sameRole = firstDuplicate(
      moduleResult.filter((module) => module.kind !== "Route"),
      (module) => `${module.kind}:${module.routePath}:${fileRouteSourceScope(module).join("/")}`,
    );
    if (sameRole !== undefined) {
      return yield* new FileRouteManifestDuplicateModuleRole({
        kind: sameRole[1].kind as Exclude<FileRouteModuleKind, "Route">,
        routePath: sameRole[1].routePath,
        first: sameRole[0],
        second: sameRole[1],
      });
    }
    if (modules === undefined) {
      return result;
    }

    const routeModuleKey = (value: FileRouteManifestEntry): string =>
      `${value.routePath}\u0000${value.moduleId}`;
    const entryKeys = new Set(result.map(routeModuleKey));
    const routeModules = moduleResult.filter((module) => module.kind === "Route");
    const orphan = routeModules.find((module) => !entryKeys.has(routeModuleKey(module)));
    if (orphan !== undefined) {
      return yield* new FileRouteManifestRouteModuleMismatch({
        reason: "OrphanRouteModule",
        routePath: orphan.routePath,
        moduleId: orphan.moduleId,
        module: orphan,
      });
    }
    for (const entry of result) {
      const matching = routeModules.filter(
        (module) => routeModuleKey(module) === routeModuleKey(entry),
      );
      if (matching.length !== 1) {
        return yield* new FileRouteManifestRouteModuleMismatch({
          reason: matching.length === 0 ? "MissingRouteModule" : "DuplicateRouteModule",
          routePath: entry.routePath,
          moduleId: entry.moduleId,
          entry,
          ...(matching.length === 0 ? {} : { first: matching[0]!, second: matching[1]! }),
        });
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
  const sortedEntries = Array.from(entries).sort(compareBySegmentsThenPath);
  const explicitModules = Array.from(modules);
  return {
    version: 1,
    ...(options.routeDirectory === undefined
      ? {}
      : { routeDirectory: normalizePath(options.routeDirectory) }),
    entries: sortedEntries,
    modules: (explicitModules.length === 0
      ? sortedEntries.map(manifestEntryToRouteModule)
      : explicitModules
    ).sort(compareManifestModules),
  };
};

/** Generates a validated manifest with route and companion modules from file paths. */
export const generateFileRouteManifest = (
  filePaths: Iterable<string>,
  options: FileRouteManifestOptions = {},
): Effect.Effect<FileRouteManifest, FileRouteManifestError> =>
  Effect.gen(function* () {
    const modules = (yield* Effect.forEach(filePaths, (filePath) =>
      filePathToFileRouteModule(filePath, options),
    )).filter((module): module is FileRouteManifestModule => module !== undefined);
    const entries = yield* validateFileRouteManifest(
      modules.filter((module) => module.kind === "Route").map(manifestEntry),
      modules,
    );
    return createFileRouteManifest(entries, options, modules);
  });

/**
 * The support modules that wrap a route: layouts and metadata from source-scope
 * root to leaf, and the nearest error boundary. Support modules are inherited
 * by source-id scope, so pathless/grouped siblings with the same URL path do
 * not share layout, error, or metadata modules.
 */
export const fileRouteSupportModules = (
  manifest: FileRouteManifest,
  entry: FileRouteManifestEntry,
): {
  readonly layouts: readonly FileRouteManifestModule[];
  readonly errorBoundary?: FileRouteManifestModule;
  readonly metadataModules: readonly FileRouteManifestModule[];
} => {
  const scoped = manifest.modules
    .filter((module) =>
      isFileRouteSourceScopePrefix(fileRouteSourceScope(module), fileRouteSourceScope(entry)),
    )
    .sort(compareBySourceScopeDepthThenPath);
  const errorBoundary = scoped
    .filter((module) => module.kind === "ErrorBoundary")
    .sort(
      (left, right) =>
        right.segments.length - left.segments.length ||
        compareString(right.filePath, left.filePath),
    )[0];
  return {
    layouts: scoped.filter((module) => module.kind === "Layout"),
    ...(errorBoundary === undefined ? {} : { errorBoundary }),
    metadataModules: scoped.filter((module) => module.kind === "Metadata"),
  };
};
