import { describe, expect, it } from "vitest";
import {
  createFileRouteManifest,
  generateFileRouteManifestArtifact
} from "../src/file-routes.js";
import {
  createFileRouteDefinitionsModule,
  FileRouteDefinitionsModuleInvalidExportName,
  FileRouteDefinitionsModuleInvalidIdentifier
} from "../src/file-route-modules.js";

describe("file route definition module generation", () => {
  it("turns a validated file route manifest into typed route definitions", () => {
    const manifest = generateFileRouteManifestArtifact(
      [
        "src/routes/projects/$id.tsx",
        "src/routes/index.tsx",
        "src/routes/projects/new.tsx"
      ],
      { routeDirectory: "src/routes" }
    );

    const generated = createFileRouteDefinitionsModule(manifest);

    expect(generated).toMatchInlineSnapshot(`
      "import type { Route } from "@effect-ui/core";

      import { Route as route_root } from "./routes/index.js";
      import { Route as route_projects_new } from "./routes/projects/new.js";
      import { Route as route_projects_$id } from "./routes/projects/$id.js";

      const route_root_path: "/" = route_root.path;
      const route_projects_new_path: "/projects/new" = route_projects_new.path;
      const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;

      export { route_root, route_projects_new, route_projects_$id };

      export const routes = [route_root, route_projects_new, route_projects_$id] as const;
      export const routeTree = routes;
      export const routeById = {
        "route_root": route_root,
        "route_projects_new": route_projects_new,
        "route_projects_$id": route_projects_$id
      } as const;
      export const routeByPath = {
        "/": route_root,
        "/projects/new": route_projects_new,
        "/projects/:id": route_projects_$id
      } as const;

      export const fileRouteModules = [
        {
          "id": "index",
          "kind": "Route",
          "routeId": "route_root",
          "moduleId": "src/routes/index.tsx",
          "filePath": "src/routes/index.tsx",
          "routePath": "/",
          "segments": [],
          "params": [],
          "exportName": "Route"
        },
        {
          "id": "projects/new",
          "kind": "Route",
          "routeId": "route_projects_new",
          "moduleId": "src/routes/projects/new.tsx",
          "filePath": "src/routes/projects/new.tsx",
          "routePath": "/projects/new",
          "segments": [
            {
              "_tag": "Static",
              "value": "projects"
            },
            {
              "_tag": "Static",
              "value": "new"
            }
          ],
          "params": [],
          "exportName": "Route"
        },
        {
          "id": "projects/$id",
          "kind": "Route",
          "routeId": "route_projects_$id",
          "moduleId": "src/routes/projects/$id.tsx",
          "filePath": "src/routes/projects/$id.tsx",
          "routePath": "/projects/:id",
          "segments": [
            {
              "_tag": "Static",
              "value": "projects"
            },
            {
              "_tag": "Dynamic",
              "name": "id",
              "optional": false
            }
          ],
          "params": [
            {
              "name": "id",
              "optional": false
            }
          ],
          "exportName": "Route"
        }
      ] as const;
      export const fileRouteMetadata = [
        {
          "routeId": "route_root",
          "routePath": "/",
          "routeModule": {
            "id": "index",
            "kind": "Route",
            "routeId": "route_root",
            "moduleId": "src/routes/index.tsx",
            "filePath": "src/routes/index.tsx",
            "routePath": "/",
            "segments": [],
            "params": [],
            "exportName": "Route"
          },
          "layouts": [],
          "metadataModules": []
        },
        {
          "routeId": "route_projects_new",
          "routePath": "/projects/new",
          "routeModule": {
            "id": "projects/new",
            "kind": "Route",
            "routeId": "route_projects_new",
            "moduleId": "src/routes/projects/new.tsx",
            "filePath": "src/routes/projects/new.tsx",
            "routePath": "/projects/new",
            "segments": [
              {
                "_tag": "Static",
                "value": "projects"
              },
              {
                "_tag": "Static",
                "value": "new"
              }
            ],
            "params": [],
            "exportName": "Route"
          },
          "parentRouteId": "route_root",
          "parentRoutePath": "/",
          "layouts": [],
          "metadataModules": []
        },
        {
          "routeId": "route_projects_$id",
          "routePath": "/projects/:id",
          "routeModule": {
            "id": "projects/$id",
            "kind": "Route",
            "routeId": "route_projects_$id",
            "moduleId": "src/routes/projects/$id.tsx",
            "filePath": "src/routes/projects/$id.tsx",
            "routePath": "/projects/:id",
            "segments": [
              {
                "_tag": "Static",
                "value": "projects"
              },
              {
                "_tag": "Dynamic",
                "name": "id",
                "optional": false
              }
            ],
            "params": [
              {
                "name": "id",
                "optional": false
              }
            ],
            "exportName": "Route"
          },
          "parentRouteId": "route_root",
          "parentRoutePath": "/",
          "layouts": [],
          "metadataModules": []
        }
      ] as const;

      export type RouteTree = typeof routeTree;
      export type RouteById = typeof routeById;
      export type RouteByPath = typeof routeByPath;
      export type FileRoute = RouteTree[number];
      export type FileRouteId = keyof RouteById;
      export type FileRoutePath = keyof RouteByPath;
      export type FileRouteByPath = RouteByPath;
      export type FileRouteParamsById = { readonly [Id in FileRouteId]: Route.Params<RouteById[Id]> };
      export type FileRouteSearchById = { readonly [Id in FileRouteId]: Route.Search<RouteById[Id]> };
      export type FileRouteHrefOptionsById = { readonly [Id in FileRouteId]: Route.HrefOptions<RouteById[Id]> };
      export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];
      export type FileRouteParamsByPath = { readonly [Path in keyof FileRouteByPath]: Route.Params<FileRouteByPath[Path]> };
      export type FileRouteSearchByPath = { readonly [Path in keyof FileRouteByPath]: Route.Search<FileRouteByPath[Path]> };
      export type FileRouteHrefOptionsByPath = { readonly [Path in keyof FileRouteByPath]: Route.HrefOptions<FileRouteByPath[Path]> };
      export type FileRouteModules = typeof fileRouteModules;
      export type FileRouteMetadata = typeof fileRouteMetadata;
      export default routes;"
    `);
    expect(generated).toContain([
      'import type { Route } from "@effect-ui/core";',
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
      "export const routes = [route_root, route_projects_new, route_projects_$id] as const;",
      "export const routeTree = routes;",
      "export const routeById = {",
      '  "route_root": route_root,',
      '  "route_projects_new": route_projects_new,',
      '  "route_projects_$id": route_projects_$id',
      "} as const;",
      "export const routeByPath = {",
      '  "/": route_root,',
      '  "/projects/new": route_projects_new,',
      '  "/projects/:id": route_projects_$id',
      "} as const;"
    ].join("\n"));
    expect(generated).toContain("export const fileRouteModules = ");
    expect(generated).toContain('"kind": "Route"');
    expect(generated).toContain("export const fileRouteMetadata = ");
    expect(generated).toContain("export type FileRouteMetadata = typeof fileRouteMetadata;");
    expect(generated).toContain("export type FileRouteId = keyof RouteById;");
    expect(generated).toContain("export type RouteByPath = typeof routeByPath;");
    expect(generated).toContain("export type FileRoutePath = keyof RouteByPath;");
    expect(generated).toContain("export type FileRouteByPath = RouteByPath;");
    expect(generated).toContain("export type FileRouteParamsById = { readonly [Id in FileRouteId]: Route.Params<RouteById[Id]> };");
    expect(generated).toContain("export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];");
    expect(generated).toContain("export type FileRouteHrefOptionsByPath = { readonly [Path in keyof FileRouteByPath]: Route.HrefOptions<FileRouteByPath[Path]> };");
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
        "src/routes/projects/$id.tsx"
      ],
      { routeDirectory: "src/routes" }
    );
    const generated = createFileRouteDefinitionsModule(manifest);

    expect(generated).toMatchInlineSnapshot(`
      "import type { Route } from "@effect-ui/core";

      import { Route as route_root } from "./routes/index.js";
      import { Route as route_projects_$id } from "./routes/projects/$id.js";

      const route_root_path: "/" = route_root.path;
      const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;

      export { route_root, route_projects_$id };

      export const routes = [route_root, route_projects_$id] as const;
      export const routeTree = routes;
      export const routeById = {
        "route_root": route_root,
        "route_projects_$id": route_projects_$id
      } as const;
      export const routeByPath = {
        "/": route_root,
        "/projects/:id": route_projects_$id
      } as const;

      export const fileRouteModules = [
        {
          "id": "error",
          "kind": "ErrorBoundary",
          "routeId": "route_root",
          "moduleId": "src/routes/error.tsx",
          "filePath": "src/routes/error.tsx",
          "routePath": "/",
          "segments": [],
          "params": [],
          "exportName": "ErrorBoundary"
        },
        {
          "id": "projects/error",
          "kind": "ErrorBoundary",
          "routeId": "route_projects",
          "moduleId": "src/routes/projects/error.tsx",
          "filePath": "src/routes/projects/error.tsx",
          "routePath": "/projects",
          "segments": [
            {
              "_tag": "Static",
              "value": "projects"
            }
          ],
          "params": [],
          "exportName": "ErrorBoundary"
        },
        {
          "id": "layout",
          "kind": "Layout",
          "routeId": "route_root",
          "moduleId": "src/routes/layout.tsx",
          "filePath": "src/routes/layout.tsx",
          "routePath": "/",
          "segments": [],
          "params": [],
          "exportName": "Layout"
        },
        {
          "id": "projects/_layout",
          "kind": "Layout",
          "routeId": "route_projects",
          "moduleId": "src/routes/projects/_layout.tsx",
          "filePath": "src/routes/projects/_layout.tsx",
          "routePath": "/projects",
          "segments": [
            {
              "_tag": "Static",
              "value": "projects"
            }
          ],
          "params": [],
          "exportName": "Layout"
        },
        {
          "id": "metadata",
          "kind": "Metadata",
          "routeId": "route_root",
          "moduleId": "src/routes/metadata.ts",
          "filePath": "src/routes/metadata.ts",
          "routePath": "/",
          "segments": [],
          "params": [],
          "exportName": "Metadata"
        },
        {
          "id": "projects/metadata",
          "kind": "Metadata",
          "routeId": "route_projects",
          "moduleId": "src/routes/projects/metadata.ts",
          "filePath": "src/routes/projects/metadata.ts",
          "routePath": "/projects",
          "segments": [
            {
              "_tag": "Static",
              "value": "projects"
            }
          ],
          "params": [],
          "exportName": "Metadata"
        },
        {
          "id": "index",
          "kind": "Route",
          "routeId": "route_root",
          "moduleId": "src/routes/index.tsx",
          "filePath": "src/routes/index.tsx",
          "routePath": "/",
          "segments": [],
          "params": [],
          "exportName": "Route"
        },
        {
          "id": "projects/$id",
          "kind": "Route",
          "routeId": "route_projects_$id",
          "moduleId": "src/routes/projects/$id.tsx",
          "filePath": "src/routes/projects/$id.tsx",
          "routePath": "/projects/:id",
          "segments": [
            {
              "_tag": "Static",
              "value": "projects"
            },
            {
              "_tag": "Dynamic",
              "name": "id",
              "optional": false
            }
          ],
          "params": [
            {
              "name": "id",
              "optional": false
            }
          ],
          "exportName": "Route"
        }
      ] as const;
      export const fileRouteMetadata = [
        {
          "routeId": "route_root",
          "routePath": "/",
          "routeModule": {
            "id": "index",
            "kind": "Route",
            "routeId": "route_root",
            "moduleId": "src/routes/index.tsx",
            "filePath": "src/routes/index.tsx",
            "routePath": "/",
            "segments": [],
            "params": [],
            "exportName": "Route"
          },
          "layouts": [
            {
              "id": "layout",
              "kind": "Layout",
              "routeId": "route_root",
              "moduleId": "src/routes/layout.tsx",
              "filePath": "src/routes/layout.tsx",
              "routePath": "/",
              "segments": [],
              "params": [],
              "exportName": "Layout"
            }
          ],
          "errorBoundary": {
            "id": "error",
            "kind": "ErrorBoundary",
            "routeId": "route_root",
            "moduleId": "src/routes/error.tsx",
            "filePath": "src/routes/error.tsx",
            "routePath": "/",
            "segments": [],
            "params": [],
            "exportName": "ErrorBoundary"
          },
          "metadataModules": [
            {
              "id": "metadata",
              "kind": "Metadata",
              "routeId": "route_root",
              "moduleId": "src/routes/metadata.ts",
              "filePath": "src/routes/metadata.ts",
              "routePath": "/",
              "segments": [],
              "params": [],
              "exportName": "Metadata"
            }
          ]
        },
        {
          "routeId": "route_projects_$id",
          "routePath": "/projects/:id",
          "routeModule": {
            "id": "projects/$id",
            "kind": "Route",
            "routeId": "route_projects_$id",
            "moduleId": "src/routes/projects/$id.tsx",
            "filePath": "src/routes/projects/$id.tsx",
            "routePath": "/projects/:id",
            "segments": [
              {
                "_tag": "Static",
                "value": "projects"
              },
              {
                "_tag": "Dynamic",
                "name": "id",
                "optional": false
              }
            ],
            "params": [
              {
                "name": "id",
                "optional": false
              }
            ],
            "exportName": "Route"
          },
          "parentRouteId": "route_root",
          "parentRoutePath": "/",
          "layouts": [
            {
              "id": "layout",
              "kind": "Layout",
              "routeId": "route_root",
              "moduleId": "src/routes/layout.tsx",
              "filePath": "src/routes/layout.tsx",
              "routePath": "/",
              "segments": [],
              "params": [],
              "exportName": "Layout"
            },
            {
              "id": "projects/_layout",
              "kind": "Layout",
              "routeId": "route_projects",
              "moduleId": "src/routes/projects/_layout.tsx",
              "filePath": "src/routes/projects/_layout.tsx",
              "routePath": "/projects",
              "segments": [
                {
                  "_tag": "Static",
                  "value": "projects"
                }
              ],
              "params": [],
              "exportName": "Layout"
            }
          ],
          "errorBoundary": {
            "id": "projects/error",
            "kind": "ErrorBoundary",
            "routeId": "route_projects",
            "moduleId": "src/routes/projects/error.tsx",
            "filePath": "src/routes/projects/error.tsx",
            "routePath": "/projects",
            "segments": [
              {
                "_tag": "Static",
                "value": "projects"
              }
            ],
            "params": [],
            "exportName": "ErrorBoundary"
          },
          "metadataModules": [
            {
              "id": "metadata",
              "kind": "Metadata",
              "routeId": "route_root",
              "moduleId": "src/routes/metadata.ts",
              "filePath": "src/routes/metadata.ts",
              "routePath": "/",
              "segments": [],
              "params": [],
              "exportName": "Metadata"
            },
            {
              "id": "projects/metadata",
              "kind": "Metadata",
              "routeId": "route_projects",
              "moduleId": "src/routes/projects/metadata.ts",
              "filePath": "src/routes/projects/metadata.ts",
              "routePath": "/projects",
              "segments": [
                {
                  "_tag": "Static",
                  "value": "projects"
                }
              ],
              "params": [],
              "exportName": "Metadata"
            }
          ]
        }
      ] as const;

      export type RouteTree = typeof routeTree;
      export type RouteById = typeof routeById;
      export type RouteByPath = typeof routeByPath;
      export type FileRoute = RouteTree[number];
      export type FileRouteId = keyof RouteById;
      export type FileRoutePath = keyof RouteByPath;
      export type FileRouteByPath = RouteByPath;
      export type FileRouteParamsById = { readonly [Id in FileRouteId]: Route.Params<RouteById[Id]> };
      export type FileRouteSearchById = { readonly [Id in FileRouteId]: Route.Search<RouteById[Id]> };
      export type FileRouteHrefOptionsById = { readonly [Id in FileRouteId]: Route.HrefOptions<RouteById[Id]> };
      export type FileRouteHrefOptions<Id extends FileRouteId> = FileRouteHrefOptionsById[Id];
      export type FileRouteParamsByPath = { readonly [Path in keyof FileRouteByPath]: Route.Params<FileRouteByPath[Path]> };
      export type FileRouteSearchByPath = { readonly [Path in keyof FileRouteByPath]: Route.Search<FileRouteByPath[Path]> };
      export type FileRouteHrefOptionsByPath = { readonly [Path in keyof FileRouteByPath]: Route.HrefOptions<FileRouteByPath[Path]> };
      export type FileRouteModules = typeof fileRouteModules;
      export type FileRouteMetadata = typeof fileRouteMetadata;
      export default routes;"
    `);
    expect(generated).toContain('"kind": "Layout"');
    expect(generated).toContain('"kind": "ErrorBoundary"');
    expect(generated).toContain('"kind": "Metadata"');
    expect(generated).toContain('"routePath": "/projects/:id"');
    expect(generated).toContain('"routePath": "/projects"');
    expect(generated).toContain('"parentRouteId": "route_root"');
    expect(generated).toContain('"errorBoundary"');
    expect(generated).toContain('"metadataModules"');
  });

  it("emits route module imports relative to a custom generated file", () => {
    const manifest = generateFileRouteManifestArtifact(
      [
        "src/routes/projects/$id.ts",
        "src/routes/index.ts"
      ],
      { routeDirectory: "src/routes" }
    );

    expect(
      createFileRouteDefinitionsModule(manifest, {
        generatedFile: "src/generated/routeTree.gen.ts"
      })
    ).toContain('import { Route as route_projects_$id } from "../routes/projects/$id.js";');
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
            params: []
          }
        ])
      )
    ).toThrow(FileRouteDefinitionsModuleInvalidIdentifier);
  });

  it("rejects invalid route module export names", () => {
    const manifest = generateFileRouteManifestArtifact(["src/routes/index.ts"], {
      routeDirectory: "src/routes"
    });

    expect(() =>
      createFileRouteDefinitionsModule(manifest, {
        routeModuleExportName: "not-valid"
      })
    ).toThrow(FileRouteDefinitionsModuleInvalidExportName);
  });
});
