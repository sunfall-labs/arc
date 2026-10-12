import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  filePathToFileRouteModule,
  fileRouteSupportModules,
  FileRouteManifestDuplicateModuleRole,
  FileRouteManifestDuplicateRouteId,
  FileRouteManifestDuplicateRoutePath,
  FileRouteManifestInvalidSegment,
  FileRouteManifestRouteModuleMismatch,
  generateFileRouteManifest,
  validateFileRouteManifest,
  type FileRouteManifest,
} from "../src/file-routes.js";

const options = { routeDirectory: "src/routes" };
const moduleFor = (filePath: string) =>
  Effect.runSync(filePathToFileRouteModule(filePath, options));
const manifestFor = (filePaths: Iterable<string>): FileRouteManifest =>
  Effect.runSync(generateFileRouteManifest(filePaths, options));
const failureOf = <A, E>(effect: Effect.Effect<A, E>): E | undefined => {
  const exit = Effect.runSyncExit(effect);
  return Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isFailReason)?.error : undefined;
};

describe("file route manifest generation", () => {
  it("turns a root index file into the root route", () => {
    expect(moduleFor("src/routes/index.tsx")).toMatchObject({
      id: "index",
      kind: "Route",
      routeId: "route_root",
      moduleId: "src/routes/index.tsx",
      filePath: "src/routes/index.tsx",
      routePath: "/",
      segments: [],
      params: [],
    });
  });

  it("turns nested index files into parent routes", () => {
    expect(moduleFor("src/routes/projects/index.tsx")).toMatchObject({
      id: "projects/index",
      routePath: "/projects",
      segments: [{ _tag: "Static", value: "projects" }],
    });
  });

  it("turns $ segments into dynamic route params", () => {
    expect(moduleFor("src/routes/projects/$id.tsx")).toMatchObject({
      id: "projects/$id",
      routeId: "route_projects_$id",
      moduleId: "src/routes/projects/$id.tsx",
      routePath: "/projects/:id",
      segments: [
        { _tag: "Static", value: "projects" },
        { _tag: "Dynamic", name: "id", optional: false },
      ],
      params: [{ name: "id", optional: false }],
    });
  });

  it("marks $ segments with a trailing question mark as optional params", () => {
    expect(moduleFor("src/routes/projects/$id?.tsx")).toMatchObject({
      routeId: "route_projects_$id_optional",
      routePath: "/projects/:id?",
      params: [{ name: "id", optional: true }],
    });
  });

  it("rejects malformed dynamic params", () => {
    expect(
      failureOf(generateFileRouteManifest(["src/routes/projects/$123.tsx"], options)),
    ).toBeInstanceOf(FileRouteManifestInvalidSegment);
  });

  it("ignores route group and pathless layout directory segments", () => {
    expect(moduleFor("src/routes/(app)/_shell/projects/$id.tsx")).toMatchObject({
      id: "(app)/_shell/projects/$id",
      routePath: "/projects/:id",
    });
  });

  it("classifies route support and component modules without turning them into routes", () => {
    expect(moduleFor("src/routes/projects/_layout.tsx")).toMatchObject({
      id: "projects/_layout",
      kind: "Layout",
      exportName: "Layout",
      routeId: "route_projects",
      routePath: "/projects",
    });
    expect(moduleFor("src/routes/projects/error.tsx")).toMatchObject({
      kind: "ErrorBoundary",
      exportName: "ErrorBoundary",
      routePath: "/projects",
    });
    expect(moduleFor("src/routes/projects/metadata.ts")).toMatchObject({
      kind: "Metadata",
      exportName: "Metadata",
      routePath: "/projects",
    });
    expect(moduleFor("src/routes/projects/index.component.tsx")).toMatchObject({
      kind: "Component",
      exportName: "default",
      routePath: "/projects",
    });
    for (const layout of ["layout", "_layout", "+layout"]) {
      expect(moduleFor(`src/routes/${layout}.tsx`)).toMatchObject({ kind: "Layout" });
    }
    expect(
      manifestFor([
        "src/routes/layout.tsx",
        "src/routes/projects/error.tsx",
        "src/routes/projects/$id.component.tsx",
      ]).entries,
    ).toEqual([]);
  });

  it("sorts routes deterministically with static siblings before dynamic siblings", () => {
    expect(
      manifestFor([
        "src/routes/projects/$id.tsx",
        "src/routes/projects/new.tsx",
        "src/routes/projects/index.tsx",
        "src/routes/(app)/index.tsx",
        "src/routes/about.tsx",
      ]).entries.map((route) => route.routePath),
    ).toEqual(["/", "/about", "/projects", "/projects/new", "/projects/:id"]);
  });

  it("creates a deterministic route manifest artifact", () => {
    const ordered = manifestFor([
      "src/routes/projects/$id.tsx",
      "src/routes/index.tsx",
      "src/routes/projects/new.tsx",
    ]);
    const reversed = manifestFor([
      "src/routes/projects/new.tsx",
      "src/routes/index.tsx",
      "src/routes/projects/$id.tsx",
    ]);

    expect(JSON.stringify(ordered)).toBe(JSON.stringify(reversed));
    expect(ordered).toMatchObject({
      version: 1,
      routeDirectory: "src/routes",
      entries: [
        { routeId: "route_root", moduleId: "src/routes/index.tsx", routePath: "/" },
        {
          routeId: "route_projects_new",
          moduleId: "src/routes/projects/new.tsx",
          routePath: "/projects/new",
        },
        {
          routeId: "route_projects_$id",
          moduleId: "src/routes/projects/$id.tsx",
          routePath: "/projects/:id",
        },
      ],
      modules: [
        { kind: "Route", routePath: "/" },
        { kind: "Route", routePath: "/projects/new" },
        { kind: "Route", routePath: "/projects/:id" },
      ],
    });
  });

  it("creates a full manifest artifact from one-shot file path iterables", () => {
    function* discoveredFiles() {
      yield "src/routes/layout.tsx";
      yield "src/routes/error.tsx";
      yield "src/routes/metadata.ts";
      yield "src/routes/index.tsx";
    }

    const manifest = manifestFor(discoveredFiles());

    expect(manifest.entries).toEqual([
      expect.objectContaining({ routePath: "/", moduleId: "src/routes/index.tsx" }),
    ]);
    expect(manifest.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "Route", moduleId: "src/routes/index.tsx" }),
        expect.objectContaining({ kind: "Layout", moduleId: "src/routes/layout.tsx" }),
        expect.objectContaining({ kind: "ErrorBoundary", moduleId: "src/routes/error.tsx" }),
        expect.objectContaining({ kind: "Metadata", moduleId: "src/routes/metadata.ts" }),
      ]),
    );
  });

  it("scopes support modules to the routes beneath them", () => {
    const manifest = manifestFor([
      "src/routes/layout.tsx",
      "src/routes/error.tsx",
      "src/routes/metadata.ts",
      "src/routes/index.tsx",
      "src/routes/projects/_layout.tsx",
      "src/routes/projects/error.tsx",
      "src/routes/projects/metadata.ts",
      "src/routes/projects/index.tsx",
      "src/routes/projects/$id.tsx",
    ]);
    const project = manifest.entries.find((entry) => entry.routePath === "/projects/:id")!;

    expect(fileRouteSupportModules(manifest, project)).toEqual({
      layouts: [
        expect.objectContaining({ kind: "Layout", routePath: "/" }),
        expect.objectContaining({ kind: "Layout", routePath: "/projects" }),
      ],
      errorBoundary: expect.objectContaining({ kind: "ErrorBoundary", routePath: "/projects" }),
      metadataModules: [
        expect.objectContaining({ kind: "Metadata", routePath: "/" }),
        expect.objectContaining({ kind: "Metadata", routePath: "/projects" }),
      ],
    });
  });

  it("scopes group and pathless support modules by source directory", () => {
    const manifest = manifestFor([
      "src/routes/layout.tsx",
      "src/routes/index.tsx",
      "src/routes/(admin)/_layout.tsx",
      "src/routes/(admin)/dashboard.tsx",
      "src/routes/(marketing)/about.tsx",
      "src/routes/_auth/_layout.tsx",
      "src/routes/_auth/settings.tsx",
    ]);
    const layoutIds = (routePath: string) =>
      fileRouteSupportModules(
        manifest,
        manifest.entries.find((entry) => entry.routePath === routePath)!,
      ).layouts.map((layout) => layout.id);

    expect(layoutIds("/dashboard")).toEqual(["layout", "(admin)/_layout"]);
    expect(layoutIds("/about")).toEqual(["layout"]);
    expect(layoutIds("/settings")).toEqual(["layout", "_auth/_layout"]);
  });

  it("rejects duplicate support modules for the same route scope", () => {
    expect(
      failureOf(
        generateFileRouteManifest(
          [
            "src/routes/index.tsx",
            "src/routes/projects/layout.tsx",
            "src/routes/projects/_layout.tsx",
          ],
          options,
        ),
      ),
    ).toBeInstanceOf(FileRouteManifestDuplicateModuleRole);
  });

  it("allows sibling group support modules with the same URL scope", () => {
    const manifest = manifestFor([
      "src/routes/(admin)/_layout.tsx",
      "src/routes/(admin)/dashboard.tsx",
      "src/routes/(marketing)/_layout.tsx",
      "src/routes/(marketing)/about.tsx",
    ]);
    expect(
      manifest.modules.filter((module) => module.kind === "Layout").map((module) => module.id),
    ).toEqual(["(admin)/_layout", "(marketing)/_layout"]);
  });

  it("rejects files that collapse to the same route path", () => {
    expect(
      failureOf(
        generateFileRouteManifest(
          ["src/routes/(app)/index.tsx", "src/routes/(marketing)/index.tsx"],
          options,
        ),
      ),
    ).toBeInstanceOf(FileRouteManifestDuplicateRoutePath);
  });

  it("rejects duplicate generated route id slug collisions", () => {
    const failure = failureOf(
      generateFileRouteManifest(
        ["src/routes/projects/foo-bar.tsx", "src/routes/projects/foo_bar.tsx"],
        options,
      ),
    );
    expect(failure).toBeInstanceOf(FileRouteManifestDuplicateRouteId);
    expect(failure).toMatchObject({ routeId: "route_projects_foo_bar" });
  });

  it("rejects explicit manifests whose route entries and modules disagree", () => {
    const manifest = manifestFor([
      "src/routes/projects/_layout.tsx",
      "src/routes/projects/$id.tsx",
    ]);
    const routeModule = manifest.modules.find((module) => module.kind === "Route")!;
    const supportModules = manifest.modules.filter((module) => module.kind !== "Route");

    const reasons = [
      supportModules,
      [...supportModules, { ...routeModule, moduleId: "src/routes/projects/orphan.tsx" }],
      [...manifest.modules, routeModule],
    ].map((modules) => failureOf(validateFileRouteManifest(manifest.entries, modules)));

    for (const failure of reasons) {
      expect(failure).toBeInstanceOf(FileRouteManifestRouteModuleMismatch);
    }
    expect(
      reasons.map((failure) => (failure as FileRouteManifestRouteModuleMismatch).reason),
    ).toEqual(["MissingRouteModule", "OrphanRouteModule", "DuplicateRouteModule"]);
  });
});
