import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createFileRouteManifest, generateFileRouteManifestArtifact } from "../src/file-routes.js";
import {
  createFileRouteDefinitionsModule,
  FileRouteDefinitionsModuleInvalidExportName,
  FileRouteDefinitionsModuleInvalidIdentifier,
} from "../src/file-route-modules.js";
import {
  fileRouteDefinitionsVirtualModuleId,
  loadStartVirtualModuleEffect,
  resolveStartVirtualModuleId,
} from "../src/start-virtual-modules.js";
import {
  FileRouteDefinitionsFileWriteError,
  writeFileRouteDefinitionsFileEffect,
} from "../src/generated-route-definitions.js";

describe("file route definition module generation", () => {
  it("turns a validated file route manifest into typed route definitions", () => {
    const manifest = generateFileRouteManifestArtifact(
      ["src/routes/projects/$id.tsx", "src/routes/index.tsx", "src/routes/projects/new.tsx"],
      { routeDirectory: "src/routes" },
    );

    const generated = createFileRouteDefinitionsModule(manifest);

    expect(generated).toMatchInlineSnapshot(`
      "import { Route } from "@sunfall/arc-core";

      import { Route as route_root } from "./routes/index.js";
      import { Route as route_projects_new } from "./routes/projects/new.js";
      import { Route as route_projects_$id } from "./routes/projects/$id.js";

      const route_root_path: "/" = route_root.path;
      const route_projects_new_path: "/projects/new" = route_projects_new.path;
      const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;

      export { route_root, route_projects_new, route_projects_$id };

      /** Ordered app-specific route definitions discovered from Start file routes. */
      export const routes = [route_root, route_projects_new, route_projects_$id] as const;
      /** Alias for \`routes\`, kept for router-style naming and generated-file ergonomics. */
      export const routeTree = routes;
      /** Map from generated route id to the exact route definition for that file route. */
      export const routeById = {
        route_root: route_root,
        route_projects_new: route_projects_new,
        route_projects_$id: route_projects_$id,
      } as const;
      /** Map from route path pattern to the exact route definition for that file route. */
      export const routeByPath = {
        "/": route_root,
        "/projects/new": route_projects_new,
        "/projects/:id": route_projects_$id,
      } as const;
      /** Map from route path pattern to generated route id. */
      export const routeIdByPath = {
        "/": "route_root",
        "/projects/new": "route_projects_new",
        "/projects/:id": "route_projects_$id",
      } as const;
      /** Builds a typed href for a generated route id. */
      export const hrefById = <Id extends RouteId>(
        id: Id,
        ...args: Route.HrefArgs<RouteById[Id]>
      ): string => Route.href(routeById[id], ...args);
      /** Builds a typed href for a generated route path pattern. */
      export const hrefByPath = <Path extends RoutePath>(
        path: Path,
        ...args: Route.HrefArgs<RouteByPath[Path]>
      ): string => Route.href(routeByPath[path], ...args);

      /** Layout modules that wrap each generated route, ordered from source-scope root to leaf. */
      export const fileRouteLayoutsById = {
        route_root: [],
        route_projects_new: [],
        route_projects_$id: [],
      } as const;
      /** Nearest source-scoped error boundary module for each generated route, when one exists. */
      export const fileRouteErrorBoundaryById = {} as const;
      /** Metadata modules scoped to each generated route by source id, ordered from root to leaf. */
      export const fileRouteMetadataById = {
        route_root: [],
        route_projects_new: [],
        route_projects_$id: [],
      } as const;
      /** Returns layout modules for a generated route id. */
      export const layoutsById = <Id extends RouteId>(id: Id): FileRouteLayouts<Id> =>
        fileRouteLayoutsById[id];
      /** Returns layout modules for a generated route path pattern. */
      export const layoutsByPath = <Path extends RoutePath>(
        path: Path,
      ): FileRouteLayouts<RouteIdByPath[Path]> => layoutsById(routeIdByPath[path]);
      /** Returns the nearest error boundary module for a generated route id, when one exists. */
      export const errorBoundaryById = <Id extends RouteId>(id: Id): FileRouteErrorBoundary<Id> =>
        (fileRouteErrorBoundaryById as Partial<Record<RouteId, unknown>>)[
          id
        ] as FileRouteErrorBoundary<Id>;
      /** Returns the nearest error boundary module for a generated route path pattern, when one exists. */
      export const errorBoundaryByPath = <Path extends RoutePath>(
        path: Path,
      ): FileRouteErrorBoundary<RouteIdByPath[Path]> => errorBoundaryById(routeIdByPath[path]);
      /** Returns metadata modules for a generated route id. */
      export const metadataById = <Id extends RouteId>(id: Id): FileRouteMetadataModules<Id> =>
        fileRouteMetadataById[id];
      /** Returns metadata modules for a generated route path pattern. */
      export const metadataByPath = <Path extends RoutePath>(
        path: Path,
      ): FileRouteMetadataModules<RouteIdByPath[Path]> => metadataById(routeIdByPath[path]);

      /** Route, layout, error boundary, and metadata modules discovered by Start. */
      export const fileRouteModules = [
        {
          id: "index",
          kind: "Route",
          routeId: "route_root",
          moduleId: "src/routes/index.tsx",
          filePath: "src/routes/index.tsx",
          routePath: "/",
          segments: [],
          params: [],
          exportName: "Route",
        },
        {
          id: "projects/new",
          kind: "Route",
          routeId: "route_projects_new",
          moduleId: "src/routes/projects/new.tsx",
          filePath: "src/routes/projects/new.tsx",
          routePath: "/projects/new",
          segments: [
            {
              _tag: "Static",
              value: "projects",
            },
            {
              _tag: "Static",
              value: "new",
            },
          ],
          params: [],
          exportName: "Route",
        },
        {
          id: "projects/$id",
          kind: "Route",
          routeId: "route_projects_$id",
          moduleId: "src/routes/projects/$id.tsx",
          filePath: "src/routes/projects/$id.tsx",
          routePath: "/projects/:id",
          segments: [
            {
              _tag: "Static",
              value: "projects",
            },
            {
              _tag: "Dynamic",
              name: "id",
              optional: false,
            },
          ],
          params: [
            {
              name: "id",
              optional: false,
            },
          ],
          exportName: "Route",
        },
      ] as const;
      /** Parent, layout, error boundary, and metadata relationships for each generated route. */
      export const fileRouteMetadata = [
        {
          routeId: "route_root",
          routePath: "/",
          routeModule: {
            id: "index",
            kind: "Route",
            routeId: "route_root",
            moduleId: "src/routes/index.tsx",
            filePath: "src/routes/index.tsx",
            routePath: "/",
            segments: [],
            params: [],
            exportName: "Route",
          },
          layouts: [],
          metadataModules: [],
        },
        {
          routeId: "route_projects_new",
          routePath: "/projects/new",
          routeModule: {
            id: "projects/new",
            kind: "Route",
            routeId: "route_projects_new",
            moduleId: "src/routes/projects/new.tsx",
            filePath: "src/routes/projects/new.tsx",
            routePath: "/projects/new",
            segments: [
              {
                _tag: "Static",
                value: "projects",
              },
              {
                _tag: "Static",
                value: "new",
              },
            ],
            params: [],
            exportName: "Route",
          },
          parentRouteId: "route_root",
          parentRoutePath: "/",
          layouts: [],
          metadataModules: [],
        },
        {
          routeId: "route_projects_$id",
          routePath: "/projects/:id",
          routeModule: {
            id: "projects/$id",
            kind: "Route",
            routeId: "route_projects_$id",
            moduleId: "src/routes/projects/$id.tsx",
            filePath: "src/routes/projects/$id.tsx",
            routePath: "/projects/:id",
            segments: [
              {
                _tag: "Static",
                value: "projects",
              },
              {
                _tag: "Dynamic",
                name: "id",
                optional: false,
              },
            ],
            params: [
              {
                name: "id",
                optional: false,
              },
            ],
            exportName: "Route",
          },
          parentRouteId: "route_root",
          parentRoutePath: "/",
          layouts: [],
          metadataModules: [],
        },
      ] as const;

      /** Tuple type for the generated app-specific route tree. */
      export type RouteTree = typeof routeTree;
      /** Map type keyed by generated route id. */
      export type RouteById = typeof routeById;
      /** Map type keyed by route path pattern. */
      export type RouteByPath = typeof routeByPath;
      /** Map type from route path pattern to generated route id. */
      export type RouteIdByPath = typeof routeIdByPath;
      /** Union of every generated route definition. */
      export type FileRoute = RouteTree[number];
      /** Union of generated route ids such as \`route_projects_$id\`. */
      export type FileRouteId = keyof RouteById;
      /** Union of generated route path patterns such as \`/projects/:id\`. */
      export type FileRoutePath = keyof RouteByPath;
      /** Route path lookup map preserved for path-keyed helper types. */
      export type FileRouteByPath = RouteByPath;
      /** Params for each generated route id. */
      export type FileRouteParamsById = { readonly [Id in FileRouteId]: Route.Params<RouteById[Id]> };
      /** Search values for each generated route id. */
      export type FileRouteSearchById = { readonly [Id in FileRouteId]: Route.Search<RouteById[Id]> };
      /** Href options for each generated route id. */
      export type FileRouteHrefOptionsById = {
        readonly [Id in FileRouteId]: Route.HrefOptions<RouteById[Id]>;
      };
      /** Href options for one generated route id. */
      export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];
      /** Href arguments for each generated route id. */
      export type FileRouteHrefArgsById = { readonly [Id in FileRouteId]: Route.HrefArgs<RouteById[Id]> };
      /** Href arguments for one generated route id. */
      export type FileRouteHrefArgs<Id extends FileRouteId> = FileRouteHrefArgsById[Id];
      /** Params for each generated route path pattern. */
      export type FileRouteParamsByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.Params<FileRouteByPath[Path]>;
      };
      /** Search values for each generated route path pattern. */
      export type FileRouteSearchByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.Search<FileRouteByPath[Path]>;
      };
      /** Href options for each generated route path pattern. */
      export type FileRouteHrefOptionsByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.HrefOptions<FileRouteByPath[Path]>;
      };
      /** Href arguments for each generated route path pattern. */
      export type FileRouteHrefArgsByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.HrefArgs<FileRouteByPath[Path]>;
      };
      /** Route match narrowed to one generated route path pattern. */
      export type FileRouteMatch<Path extends FileRoutePath> = Route.Match<FileRouteByPath[Path]>;
      /** Layout modules keyed by generated route id. */
      export type FileRouteLayoutsById = typeof fileRouteLayoutsById;
      /** Error boundary modules keyed by generated route id when present. */
      export type FileRouteErrorBoundaryById = typeof fileRouteErrorBoundaryById;
      /** Metadata modules keyed by generated route id. */
      export type FileRouteMetadataById = typeof fileRouteMetadataById;
      /** Layout modules for one generated route id. */
      export type FileRouteLayouts<Id extends FileRouteId> = FileRouteLayoutsById[Id];
      /** Error boundary module for one generated route id, or undefined when none is scoped. */
      export type FileRouteErrorBoundary<Id extends FileRouteId> =
        Id extends keyof FileRouteErrorBoundaryById ? FileRouteErrorBoundaryById[Id] : undefined;
      /** Metadata modules for one generated route id. */
      export type FileRouteMetadataModules<Id extends FileRouteId> = FileRouteMetadataById[Id];
      /** Friendly alias for the generated route id union. */
      export type RouteId = FileRouteId;
      /** Friendly alias for the generated route path union. */
      export type RoutePath = FileRoutePath;
      /** Friendly alias for params keyed by generated route id. */
      export type ParamsById = FileRouteParamsById;
      /** Friendly alias for search values keyed by generated route id. */
      export type SearchById = FileRouteSearchById;
      /** Friendly alias for href options keyed by generated route id. */
      export type HrefById = FileRouteHrefOptionsById;
      /** Friendly alias for href options for one generated route id. */
      export type Href<Id extends RouteId> = FileRouteHrefOptions<Id>;
      /** Friendly alias for href arguments keyed by generated route id. */
      export type HrefArgsById = FileRouteHrefArgsById;
      /** Friendly alias for href arguments for one generated route id. */
      export type HrefArgs<Id extends RouteId> = FileRouteHrefArgs<Id>;
      /** Friendly alias for params keyed by generated route path. */
      export type ParamsByPath = FileRouteParamsByPath;
      /** Friendly alias for search values keyed by generated route path. */
      export type SearchByPath = FileRouteSearchByPath;
      /** Friendly alias for href options keyed by generated route path. */
      export type HrefByPath = FileRouteHrefOptionsByPath;
      /** Friendly alias for href arguments keyed by generated route path. */
      export type HrefArgsByPath = FileRouteHrefArgsByPath;
      /** Friendly alias for route matches narrowed by generated route path. */
      export type Match<Path extends RoutePath> = FileRouteMatch<Path>;
      /** Narrows a broad route match to one generated route path pattern. */
      export const isRoutePathMatch = <Path extends FileRoutePath>(
        path: Path,
        match: Route.Match<FileRoute> | undefined,
      ): match is FileRouteMatch<Path> => match?.route.path === path;
      /** Static metadata for all file-route modules discovered by Start. */
      export type FileRouteModules = typeof fileRouteModules;
      /** Static parent/layout/error/metadata relationships for generated routes. */
      export type FileRouteMetadata = typeof fileRouteMetadata;
      /** Default generated route tree export for router-style imports. */
      export default routes;"
    `);
    expect(generated).toContain(
      [
        'import { Route } from "@sunfall/arc-core";',
        "",
        'import { Route as route_root } from "./routes/index.js";',
        'import { Route as route_projects_new } from "./routes/projects/new.js";',
        'import { Route as route_projects_$id } from "./routes/projects/$id.js";',
        "",
        'const route_root_path: "/" = route_root.path;',
        'const route_projects_new_path: "/projects/new" = route_projects_new.path;',
        'const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;',
        "",
        "export { route_root, route_projects_new, route_projects_$id };",
        "",
        "/** Ordered app-specific route definitions discovered from Start file routes. */",
        "export const routes = [route_root, route_projects_new, route_projects_$id] as const;",
        "/** Alias for `routes`, kept for router-style naming and generated-file ergonomics. */",
        "export const routeTree = routes;",
        "/** Map from generated route id to the exact route definition for that file route. */",
        "export const routeById = {",
        "  route_root: route_root,",
        "  route_projects_new: route_projects_new,",
        "  route_projects_$id: route_projects_$id,",
        "} as const;",
        "/** Map from route path pattern to the exact route definition for that file route. */",
        "export const routeByPath = {",
        '  "/": route_root,',
        '  "/projects/new": route_projects_new,',
        '  "/projects/:id": route_projects_$id,',
        "} as const;",
        "/** Map from route path pattern to generated route id. */",
        "export const routeIdByPath = {",
        '  "/": "route_root",',
        '  "/projects/new": "route_projects_new",',
        '  "/projects/:id": "route_projects_$id",',
        "} as const;",
        "/** Builds a typed href for a generated route id. */",
        "export const hrefById = <Id extends RouteId>(",
        "  id: Id,",
        "  ...args: Route.HrefArgs<RouteById[Id]>",
        "): string => Route.href(routeById[id], ...args);",
        "/** Builds a typed href for a generated route path pattern. */",
        "export const hrefByPath = <Path extends RoutePath>(",
        "  path: Path,",
        "  ...args: Route.HrefArgs<RouteByPath[Path]>",
        "): string => Route.href(routeByPath[path], ...args);",
      ].join("\n"),
    );
    expect(generated).toContain("export const fileRouteModules = ");
    expect(generated).toContain('kind: "Route"');
    expect(generated).toContain("export const fileRouteMetadata = ");
    expect(generated).toContain("export type FileRouteMetadata = typeof fileRouteMetadata;");
    expect(generated).toContain("export type FileRouteId = keyof RouteById;");
    expect(generated).toContain("export type RouteByPath = typeof routeByPath;");
    expect(generated).toContain("export type RouteIdByPath = typeof routeIdByPath;");
    expect(generated).toContain("export type FileRoutePath = keyof RouteByPath;");
    expect(generated).toContain("export type FileRouteByPath = RouteByPath;");
    expect(generated).toContain("export const fileRouteLayoutsById = ");
    expect(generated).toContain("export const fileRouteErrorBoundaryById = ");
    expect(generated).toContain("export const fileRouteMetadataById = ");
    expect(generated).toContain("export const layoutsByPath = <Path extends RoutePath>(");
    expect(generated).toContain("export const errorBoundaryByPath = <Path extends RoutePath>(");
    expect(generated).toContain("export const metadataByPath = <Path extends RoutePath>(");
    expect(generated).toContain(
      "export type FileRouteParamsById = { readonly [Id in FileRouteId]: Route.Params<RouteById[Id]> };",
    );
    expect(generated).toContain(
      "export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];",
    );
    expect(generated).toContain(
      "export type FileRouteHrefArgs<Id extends FileRouteId> = FileRouteHrefArgsById[Id];",
    );
    expect(generated).toContain(
      [
        "export type FileRouteHrefOptionsByPath = {",
        "  readonly [Path in keyof FileRouteByPath]: Route.HrefOptions<FileRouteByPath[Path]>;",
        "};",
      ].join("\n"),
    );
    expect(generated).toContain(
      "export type FileRouteLayouts<Id extends FileRouteId> = FileRouteLayoutsById[Id];",
    );
    expect(generated).toContain(
      [
        "export type FileRouteErrorBoundary<Id extends FileRouteId> =",
        "  Id extends keyof FileRouteErrorBoundaryById ? FileRouteErrorBoundaryById[Id] : undefined;",
      ].join("\n"),
    );
    expect(generated).toContain(
      "export type FileRouteMetadataModules<Id extends FileRouteId> = FileRouteMetadataById[Id];",
    );
    expect(generated).toContain("export type Href<Id extends RouteId> = FileRouteHrefOptions<Id>;");
    expect(generated).toContain(
      "export type HrefArgs<Id extends RouteId> = FileRouteHrefArgs<Id>;",
    );
    expect(generated).toContain(
      "export type Match<Path extends RoutePath> = FileRouteMatch<Path>;",
    );
    expect(generated).toContain("export default routes;");
  });

  it("emits deterministic typed metadata for layout, error, and metadata modules", () => {
    const manifest = generateFileRouteManifestArtifact(
      [
        "src/routes/layout.tsx",
        "src/routes/error.tsx",
        "src/routes/metadata.ts",
        "src/routes/index.tsx",
        "src/routes/projects/_layout.tsx",
        "src/routes/projects/error.tsx",
        "src/routes/projects/metadata.ts",
        "src/routes/projects/$id.tsx",
      ],
      { routeDirectory: "src/routes" },
    );
    const generated = createFileRouteDefinitionsModule(manifest);

    expect(generated).toMatchInlineSnapshot(`
      "import { Route } from "@sunfall/arc-core";

      import { Route as route_root } from "./routes/index.js";
      import { Route as route_projects_$id } from "./routes/projects/$id.js";
      import { ErrorBoundary as errorBoundary_route_root } from "./routes/error.js";
      import { ErrorBoundary as errorBoundary_route_projects } from "./routes/projects/error.js";
      import { Layout as layout_route_root } from "./routes/layout.js";
      import { Layout as layout_route_projects } from "./routes/projects/_layout.js";
      import { Metadata as metadata_route_root } from "./routes/metadata.js";
      import { Metadata as metadata_route_projects } from "./routes/projects/metadata.js";

      const route_root_path: "/" = route_root.path;
      const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;

      export { route_root, route_projects_$id };

      /** Ordered app-specific route definitions discovered from Start file routes. */
      export const routes = [route_root, route_projects_$id] as const;
      /** Alias for \`routes\`, kept for router-style naming and generated-file ergonomics. */
      export const routeTree = routes;
      /** Map from generated route id to the exact route definition for that file route. */
      export const routeById = {
        route_root: route_root,
        route_projects_$id: route_projects_$id,
      } as const;
      /** Map from route path pattern to the exact route definition for that file route. */
      export const routeByPath = {
        "/": route_root,
        "/projects/:id": route_projects_$id,
      } as const;
      /** Map from route path pattern to generated route id. */
      export const routeIdByPath = {
        "/": "route_root",
        "/projects/:id": "route_projects_$id",
      } as const;
      /** Builds a typed href for a generated route id. */
      export const hrefById = <Id extends RouteId>(
        id: Id,
        ...args: Route.HrefArgs<RouteById[Id]>
      ): string => Route.href(routeById[id], ...args);
      /** Builds a typed href for a generated route path pattern. */
      export const hrefByPath = <Path extends RoutePath>(
        path: Path,
        ...args: Route.HrefArgs<RouteByPath[Path]>
      ): string => Route.href(routeByPath[path], ...args);

      /** Layout modules that wrap each generated route, ordered from source-scope root to leaf. */
      export const fileRouteLayoutsById = {
        route_root: [layout_route_root],
        route_projects_$id: [layout_route_root, layout_route_projects],
      } as const;
      /** Nearest source-scoped error boundary module for each generated route, when one exists. */
      export const fileRouteErrorBoundaryById = {
        route_root: errorBoundary_route_root,
        route_projects_$id: errorBoundary_route_projects,
      } as const;
      /** Metadata modules scoped to each generated route by source id, ordered from root to leaf. */
      export const fileRouteMetadataById = {
        route_root: [metadata_route_root],
        route_projects_$id: [metadata_route_root, metadata_route_projects],
      } as const;
      /** Returns layout modules for a generated route id. */
      export const layoutsById = <Id extends RouteId>(id: Id): FileRouteLayouts<Id> =>
        fileRouteLayoutsById[id];
      /** Returns layout modules for a generated route path pattern. */
      export const layoutsByPath = <Path extends RoutePath>(
        path: Path,
      ): FileRouteLayouts<RouteIdByPath[Path]> => layoutsById(routeIdByPath[path]);
      /** Returns the nearest error boundary module for a generated route id, when one exists. */
      export const errorBoundaryById = <Id extends RouteId>(id: Id): FileRouteErrorBoundary<Id> =>
        (fileRouteErrorBoundaryById as Partial<Record<RouteId, unknown>>)[
          id
        ] as FileRouteErrorBoundary<Id>;
      /** Returns the nearest error boundary module for a generated route path pattern, when one exists. */
      export const errorBoundaryByPath = <Path extends RoutePath>(
        path: Path,
      ): FileRouteErrorBoundary<RouteIdByPath[Path]> => errorBoundaryById(routeIdByPath[path]);
      /** Returns metadata modules for a generated route id. */
      export const metadataById = <Id extends RouteId>(id: Id): FileRouteMetadataModules<Id> =>
        fileRouteMetadataById[id];
      /** Returns metadata modules for a generated route path pattern. */
      export const metadataByPath = <Path extends RoutePath>(
        path: Path,
      ): FileRouteMetadataModules<RouteIdByPath[Path]> => metadataById(routeIdByPath[path]);

      /** Route, layout, error boundary, and metadata modules discovered by Start. */
      export const fileRouteModules = [
        {
          id: "error",
          kind: "ErrorBoundary",
          routeId: "route_root",
          moduleId: "src/routes/error.tsx",
          filePath: "src/routes/error.tsx",
          routePath: "/",
          segments: [],
          params: [],
          exportName: "ErrorBoundary",
        },
        {
          id: "projects/error",
          kind: "ErrorBoundary",
          routeId: "route_projects",
          moduleId: "src/routes/projects/error.tsx",
          filePath: "src/routes/projects/error.tsx",
          routePath: "/projects",
          segments: [
            {
              _tag: "Static",
              value: "projects",
            },
          ],
          params: [],
          exportName: "ErrorBoundary",
        },
        {
          id: "layout",
          kind: "Layout",
          routeId: "route_root",
          moduleId: "src/routes/layout.tsx",
          filePath: "src/routes/layout.tsx",
          routePath: "/",
          segments: [],
          params: [],
          exportName: "Layout",
        },
        {
          id: "projects/_layout",
          kind: "Layout",
          routeId: "route_projects",
          moduleId: "src/routes/projects/_layout.tsx",
          filePath: "src/routes/projects/_layout.tsx",
          routePath: "/projects",
          segments: [
            {
              _tag: "Static",
              value: "projects",
            },
          ],
          params: [],
          exportName: "Layout",
        },
        {
          id: "metadata",
          kind: "Metadata",
          routeId: "route_root",
          moduleId: "src/routes/metadata.ts",
          filePath: "src/routes/metadata.ts",
          routePath: "/",
          segments: [],
          params: [],
          exportName: "Metadata",
        },
        {
          id: "projects/metadata",
          kind: "Metadata",
          routeId: "route_projects",
          moduleId: "src/routes/projects/metadata.ts",
          filePath: "src/routes/projects/metadata.ts",
          routePath: "/projects",
          segments: [
            {
              _tag: "Static",
              value: "projects",
            },
          ],
          params: [],
          exportName: "Metadata",
        },
        {
          id: "index",
          kind: "Route",
          routeId: "route_root",
          moduleId: "src/routes/index.tsx",
          filePath: "src/routes/index.tsx",
          routePath: "/",
          segments: [],
          params: [],
          exportName: "Route",
        },
        {
          id: "projects/$id",
          kind: "Route",
          routeId: "route_projects_$id",
          moduleId: "src/routes/projects/$id.tsx",
          filePath: "src/routes/projects/$id.tsx",
          routePath: "/projects/:id",
          segments: [
            {
              _tag: "Static",
              value: "projects",
            },
            {
              _tag: "Dynamic",
              name: "id",
              optional: false,
            },
          ],
          params: [
            {
              name: "id",
              optional: false,
            },
          ],
          exportName: "Route",
        },
      ] as const;
      /** Parent, layout, error boundary, and metadata relationships for each generated route. */
      export const fileRouteMetadata = [
        {
          routeId: "route_root",
          routePath: "/",
          routeModule: {
            id: "index",
            kind: "Route",
            routeId: "route_root",
            moduleId: "src/routes/index.tsx",
            filePath: "src/routes/index.tsx",
            routePath: "/",
            segments: [],
            params: [],
            exportName: "Route",
          },
          layouts: [
            {
              id: "layout",
              kind: "Layout",
              routeId: "route_root",
              moduleId: "src/routes/layout.tsx",
              filePath: "src/routes/layout.tsx",
              routePath: "/",
              segments: [],
              params: [],
              exportName: "Layout",
            },
          ],
          errorBoundary: {
            id: "error",
            kind: "ErrorBoundary",
            routeId: "route_root",
            moduleId: "src/routes/error.tsx",
            filePath: "src/routes/error.tsx",
            routePath: "/",
            segments: [],
            params: [],
            exportName: "ErrorBoundary",
          },
          metadataModules: [
            {
              id: "metadata",
              kind: "Metadata",
              routeId: "route_root",
              moduleId: "src/routes/metadata.ts",
              filePath: "src/routes/metadata.ts",
              routePath: "/",
              segments: [],
              params: [],
              exportName: "Metadata",
            },
          ],
        },
        {
          routeId: "route_projects_$id",
          routePath: "/projects/:id",
          routeModule: {
            id: "projects/$id",
            kind: "Route",
            routeId: "route_projects_$id",
            moduleId: "src/routes/projects/$id.tsx",
            filePath: "src/routes/projects/$id.tsx",
            routePath: "/projects/:id",
            segments: [
              {
                _tag: "Static",
                value: "projects",
              },
              {
                _tag: "Dynamic",
                name: "id",
                optional: false,
              },
            ],
            params: [
              {
                name: "id",
                optional: false,
              },
            ],
            exportName: "Route",
          },
          parentRouteId: "route_root",
          parentRoutePath: "/",
          layouts: [
            {
              id: "layout",
              kind: "Layout",
              routeId: "route_root",
              moduleId: "src/routes/layout.tsx",
              filePath: "src/routes/layout.tsx",
              routePath: "/",
              segments: [],
              params: [],
              exportName: "Layout",
            },
            {
              id: "projects/_layout",
              kind: "Layout",
              routeId: "route_projects",
              moduleId: "src/routes/projects/_layout.tsx",
              filePath: "src/routes/projects/_layout.tsx",
              routePath: "/projects",
              segments: [
                {
                  _tag: "Static",
                  value: "projects",
                },
              ],
              params: [],
              exportName: "Layout",
            },
          ],
          errorBoundary: {
            id: "projects/error",
            kind: "ErrorBoundary",
            routeId: "route_projects",
            moduleId: "src/routes/projects/error.tsx",
            filePath: "src/routes/projects/error.tsx",
            routePath: "/projects",
            segments: [
              {
                _tag: "Static",
                value: "projects",
              },
            ],
            params: [],
            exportName: "ErrorBoundary",
          },
          metadataModules: [
            {
              id: "metadata",
              kind: "Metadata",
              routeId: "route_root",
              moduleId: "src/routes/metadata.ts",
              filePath: "src/routes/metadata.ts",
              routePath: "/",
              segments: [],
              params: [],
              exportName: "Metadata",
            },
            {
              id: "projects/metadata",
              kind: "Metadata",
              routeId: "route_projects",
              moduleId: "src/routes/projects/metadata.ts",
              filePath: "src/routes/projects/metadata.ts",
              routePath: "/projects",
              segments: [
                {
                  _tag: "Static",
                  value: "projects",
                },
              ],
              params: [],
              exportName: "Metadata",
            },
          ],
        },
      ] as const;

      /** Tuple type for the generated app-specific route tree. */
      export type RouteTree = typeof routeTree;
      /** Map type keyed by generated route id. */
      export type RouteById = typeof routeById;
      /** Map type keyed by route path pattern. */
      export type RouteByPath = typeof routeByPath;
      /** Map type from route path pattern to generated route id. */
      export type RouteIdByPath = typeof routeIdByPath;
      /** Union of every generated route definition. */
      export type FileRoute = RouteTree[number];
      /** Union of generated route ids such as \`route_projects_$id\`. */
      export type FileRouteId = keyof RouteById;
      /** Union of generated route path patterns such as \`/projects/:id\`. */
      export type FileRoutePath = keyof RouteByPath;
      /** Route path lookup map preserved for path-keyed helper types. */
      export type FileRouteByPath = RouteByPath;
      /** Params for each generated route id. */
      export type FileRouteParamsById = { readonly [Id in FileRouteId]: Route.Params<RouteById[Id]> };
      /** Search values for each generated route id. */
      export type FileRouteSearchById = { readonly [Id in FileRouteId]: Route.Search<RouteById[Id]> };
      /** Href options for each generated route id. */
      export type FileRouteHrefOptionsById = {
        readonly [Id in FileRouteId]: Route.HrefOptions<RouteById[Id]>;
      };
      /** Href options for one generated route id. */
      export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];
      /** Href arguments for each generated route id. */
      export type FileRouteHrefArgsById = { readonly [Id in FileRouteId]: Route.HrefArgs<RouteById[Id]> };
      /** Href arguments for one generated route id. */
      export type FileRouteHrefArgs<Id extends FileRouteId> = FileRouteHrefArgsById[Id];
      /** Params for each generated route path pattern. */
      export type FileRouteParamsByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.Params<FileRouteByPath[Path]>;
      };
      /** Search values for each generated route path pattern. */
      export type FileRouteSearchByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.Search<FileRouteByPath[Path]>;
      };
      /** Href options for each generated route path pattern. */
      export type FileRouteHrefOptionsByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.HrefOptions<FileRouteByPath[Path]>;
      };
      /** Href arguments for each generated route path pattern. */
      export type FileRouteHrefArgsByPath = {
        readonly [Path in keyof FileRouteByPath]: Route.HrefArgs<FileRouteByPath[Path]>;
      };
      /** Route match narrowed to one generated route path pattern. */
      export type FileRouteMatch<Path extends FileRoutePath> = Route.Match<FileRouteByPath[Path]>;
      /** Layout modules keyed by generated route id. */
      export type FileRouteLayoutsById = typeof fileRouteLayoutsById;
      /** Error boundary modules keyed by generated route id when present. */
      export type FileRouteErrorBoundaryById = typeof fileRouteErrorBoundaryById;
      /** Metadata modules keyed by generated route id. */
      export type FileRouteMetadataById = typeof fileRouteMetadataById;
      /** Layout modules for one generated route id. */
      export type FileRouteLayouts<Id extends FileRouteId> = FileRouteLayoutsById[Id];
      /** Error boundary module for one generated route id, or undefined when none is scoped. */
      export type FileRouteErrorBoundary<Id extends FileRouteId> =
        Id extends keyof FileRouteErrorBoundaryById ? FileRouteErrorBoundaryById[Id] : undefined;
      /** Metadata modules for one generated route id. */
      export type FileRouteMetadataModules<Id extends FileRouteId> = FileRouteMetadataById[Id];
      /** Friendly alias for the generated route id union. */
      export type RouteId = FileRouteId;
      /** Friendly alias for the generated route path union. */
      export type RoutePath = FileRoutePath;
      /** Friendly alias for params keyed by generated route id. */
      export type ParamsById = FileRouteParamsById;
      /** Friendly alias for search values keyed by generated route id. */
      export type SearchById = FileRouteSearchById;
      /** Friendly alias for href options keyed by generated route id. */
      export type HrefById = FileRouteHrefOptionsById;
      /** Friendly alias for href options for one generated route id. */
      export type Href<Id extends RouteId> = FileRouteHrefOptions<Id>;
      /** Friendly alias for href arguments keyed by generated route id. */
      export type HrefArgsById = FileRouteHrefArgsById;
      /** Friendly alias for href arguments for one generated route id. */
      export type HrefArgs<Id extends RouteId> = FileRouteHrefArgs<Id>;
      /** Friendly alias for params keyed by generated route path. */
      export type ParamsByPath = FileRouteParamsByPath;
      /** Friendly alias for search values keyed by generated route path. */
      export type SearchByPath = FileRouteSearchByPath;
      /** Friendly alias for href options keyed by generated route path. */
      export type HrefByPath = FileRouteHrefOptionsByPath;
      /** Friendly alias for href arguments keyed by generated route path. */
      export type HrefArgsByPath = FileRouteHrefArgsByPath;
      /** Friendly alias for route matches narrowed by generated route path. */
      export type Match<Path extends RoutePath> = FileRouteMatch<Path>;
      /** Narrows a broad route match to one generated route path pattern. */
      export const isRoutePathMatch = <Path extends FileRoutePath>(
        path: Path,
        match: Route.Match<FileRoute> | undefined,
      ): match is FileRouteMatch<Path> => match?.route.path === path;
      /** Static metadata for all file-route modules discovered by Start. */
      export type FileRouteModules = typeof fileRouteModules;
      /** Static parent/layout/error/metadata relationships for generated routes. */
      export type FileRouteMetadata = typeof fileRouteMetadata;
      /** Default generated route tree export for router-style imports. */
      export default routes;"
    `);
    expect(generated).toContain('kind: "Layout"');
    expect(generated).toContain('kind: "ErrorBoundary"');
    expect(generated).toContain('kind: "Metadata"');
    expect(generated).toContain('routePath: "/projects/:id"');
    expect(generated).toContain('routePath: "/projects"');
    expect(generated).toContain('parentRouteId: "route_root"');
    expect(generated).toContain("errorBoundary");
    expect(generated).toContain("metadataModules");
  });

  it("emits route module imports relative to a custom generated file", () => {
    const manifest = generateFileRouteManifestArtifact(
      ["src/routes/projects/$id.ts", "src/routes/index.ts"],
      { routeDirectory: "src/routes" },
    );

    expect(
      createFileRouteDefinitionsModule(manifest, {
        generatedFile: "src/generated/routeTree.gen.ts",
      }),
    ).toContain('import { Route as route_projects_$id } from "../routes/projects/$id.js";');
  });

  it("emits source-scoped companion identifiers for sibling route groups", () => {
    const manifest = generateFileRouteManifestArtifact(
      [
        "src/routes/(admin)/_layout.tsx",
        "src/routes/(admin)/dashboard.tsx",
        "src/routes/(marketing)/_layout.tsx",
        "src/routes/(marketing)/about.tsx",
      ],
      { routeDirectory: "src/routes" },
    );
    const generated = createFileRouteDefinitionsModule(manifest);

    expect(generated).toContain("layout_route_root_admin_layout");
    expect(generated).toContain("layout_route_root_marketing_layout");
    expect(generated).not.toContain("Layout as layout_route_root }");
    expect(generated).toContain("route_dashboard: [layout_route_root_admin_layout]");
    expect(generated).toContain("route_about: [layout_route_root_marketing_layout]");
  });

  it("rejects route ids that cannot be emitted as named TypeScript exports", () => {
    expect(() =>
      createFileRouteDefinitionsModule(
        createFileRouteManifest([
          {
            id: "source",
            routeId: "route-with-dash",
            moduleId: "src/routes/index.tsx",
            filePath: "src/routes/index.tsx",
            routePath: "/",
            segments: [],
            params: [],
          },
        ]),
      ),
    ).toThrow(FileRouteDefinitionsModuleInvalidIdentifier);
  });

  it("rejects invalid route module export names", () => {
    const manifest = generateFileRouteManifestArtifact(["src/routes/index.ts"], {
      routeDirectory: "src/routes",
    });

    expect(() =>
      createFileRouteDefinitionsModule(manifest, {
        routeModuleExportName: "not-valid",
      }),
    ).toThrow(FileRouteDefinitionsModuleInvalidExportName);
  });

  it("reports generated route file write failures through the Effect seam", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-routes-"));
    try {
      const manifest = generateFileRouteManifestArtifact(["src/routes/index.tsx"], {
        routeDirectory: "src/routes",
      });
      const blockingPath = join(root, "blocked");
      writeFileSync(blockingPath, "not a directory");

      const error = await Effect.runPromise(
        Effect.flip(
          writeFileRouteDefinitionsFileEffect(root, manifest, {
            outputFile: "blocked/routeTree.gen.ts",
          }),
        ),
      );

      expect(error).toBeInstanceOf(FileRouteDefinitionsFileWriteError);
      expect(error).toMatchObject({
        _tag: "FileRouteDefinitionsFileWriteError",
        operation: "create-directory",
        path: blockingPath,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports generated route planning failures through the Effect seam", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-routes-"));
    try {
      const manifest = createFileRouteManifest(
        [
          {
            id: "bad",
            kind: "Route",
            routeId: "not-valid",
            moduleId: "src/routes/bad.ts",
            filePath: "src/routes/bad.ts",
            routePath: "/bad",
            segments: [],
            params: [],
            exportName: "Route",
          },
        ],
        { routeDirectory: "src/routes" },
      );

      const error = await Effect.runPromise(
        Effect.flip(writeFileRouteDefinitionsFileEffect(root, manifest)),
      );

      expect(error).toBeInstanceOf(FileRouteDefinitionsModuleInvalidIdentifier);
      expect(error).toMatchObject({
        _tag: "FileRouteDefinitionsModuleInvalidIdentifier",
        routeId: "not-valid",
        routePath: "/bad",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports virtual generated route planning failures through the Effect seam", async () => {
    const manifest = createFileRouteManifest(
      [
        {
          id: "bad",
          kind: "Route",
          routeId: "not-valid",
          moduleId: "src/routes/bad.ts",
          filePath: "src/routes/bad.ts",
          routePath: "/bad",
          segments: [],
          params: [],
          exportName: "Route",
        },
      ],
      { routeDirectory: "src/routes" },
    );
    const resolvedId = resolveStartVirtualModuleId(fileRouteDefinitionsVirtualModuleId);
    if (resolvedId === null) {
      throw new Error("Expected generated route definitions virtual module id.");
    }

    const error = await Effect.runPromise(
      Effect.flip(
        loadStartVirtualModuleEffect(resolvedId, {
          fileRouteManifest: manifest,
        }),
      ),
    );

    expect(error).toBeInstanceOf(FileRouteDefinitionsModuleInvalidIdentifier);
    expect(error).toMatchObject({
      _tag: "FileRouteDefinitionsModuleInvalidIdentifier",
      routeId: "not-valid",
      routePath: "/bad",
    });
  });
});
