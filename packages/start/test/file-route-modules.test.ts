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
