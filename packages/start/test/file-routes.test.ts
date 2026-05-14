import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  describeFileRouteManifest,
  deserializeFileRouteManifest,
  filePathToFileRouteModule,
  filePathToRouteManifestEntry,
  FileRouteManifestDuplicateModuleRole,
  FileRouteManifestParseError,
  generateFileRouteManifest,
  generateFileRouteManifestArtifact,
  generateValidatedFileRouteManifestArtifactEffect,
  serializeFileRouteManifest
} from "../src/index.js";

describe("file route manifest generation", () => {
  const options = { routeDirectory: "src/routes" };

  it("turns a root index file into the root route", () => {
    expect(filePathToRouteManifestEntry("src/routes/index.tsx", options)).toMatchObject({
      id: "index",
      routeId: "route_root",
      moduleId: "src/routes/index.tsx",
      filePath: "src/routes/index.tsx",
      routePath: "/",
      segments: [],
      params: []
    });
  });

  it("turns nested index files into parent routes", () => {
    expect(filePathToRouteManifestEntry("src/routes/projects/index.tsx", options)).toMatchObject({
      id: "projects/index",
      routePath: "/projects",
      segments: [
        {
          _tag: "Static",
          value: "projects"
        }
      ]
    });
  });

  it("turns $ segments into dynamic route params", () => {
    expect(filePathToRouteManifestEntry("src/routes/projects/$id.tsx", options)).toMatchObject({
      id: "projects/$id",
      routeId: "route_projects_$id",
      moduleId: "src/routes/projects/$id.tsx",
      routePath: "/projects/:id",
      segments: [
        {
          _tag: "Static",
          value: "projects"
        },
        {
          _tag: "Dynamic",
          name: "id",
          optional: false
        }
      ],
      params: [
        {
          name: "id",
          optional: false
        }
      ]
    });
  });

  it("marks $ segments with a trailing question mark as optional params", () => {
    expect(filePathToRouteManifestEntry("src/routes/projects/$id?.tsx", options)).toMatchObject({
      routeId: "route_projects_$id_optional",
      routePath: "/projects/:id?",
      params: [
        {
          name: "id",
          optional: true
        }
      ]
    });
  });

  it("ignores route group and pathless layout directory segments", () => {
    expect(filePathToRouteManifestEntry("src/routes/(app)/_shell/projects/$id.tsx", options)).toMatchObject({
      id: "(app)/_shell/projects/$id",
      routePath: "/projects/:id"
    });
  });

  it("does not emit entries for layout files", () => {
    expect(
      generateFileRouteManifest(
        [
          "src/routes/layout.tsx",
          "src/routes/_layout.tsx",
          "src/routes/+layout.tsx",
          "src/routes/projects/_layout.tsx"
        ],
        options
      )
    ).toEqual([]);
  });

  it("classifies route support modules without turning them into routes", () => {
    expect(filePathToFileRouteModule("src/routes/projects/_layout.tsx", options)).toMatchObject({
      id: "projects/_layout",
      kind: "Layout",
      exportName: "Layout",
      routeId: "route_projects",
      routePath: "/projects"
    });
    expect(filePathToFileRouteModule("src/routes/projects/error.tsx", options)).toMatchObject({
      kind: "ErrorBoundary",
      exportName: "ErrorBoundary",
      routePath: "/projects"
    });
    expect(filePathToFileRouteModule("src/routes/projects/metadata.ts", options)).toMatchObject({
      kind: "Metadata",
      exportName: "Metadata",
      routePath: "/projects"
    });
    expect(generateFileRouteManifest(["src/routes/projects/error.tsx"], options)).toEqual([]);
  });

  it("sorts routes deterministically with static siblings before dynamic siblings", () => {
    expect(
      generateFileRouteManifest(
        [
          "src/routes/projects/$id.tsx",
          "src/routes/projects/new.tsx",
          "src/routes/projects/index.tsx",
          "src/routes/(app)/index.tsx",
          "src/routes/about.tsx"
        ],
        options
      ).map((route) => route.routePath)
    ).toEqual(["/", "/about", "/projects", "/projects/new", "/projects/:id"]);
  });

  it("creates a deterministic route manifest artifact", () => {
    const ordered = generateFileRouteManifestArtifact(
      [
        "src/routes/projects/$id.tsx",
        "src/routes/index.tsx",
        "src/routes/projects/new.tsx"
      ],
      options
    );
    const reversed = generateFileRouteManifestArtifact(
      [
        "src/routes/projects/new.tsx",
        "src/routes/index.tsx",
        "src/routes/projects/$id.tsx"
      ],
      options
    );

    expect(serializeFileRouteManifest(ordered)).toBe(serializeFileRouteManifest(reversed));
    expect(
      ordered
    ).toMatchObject({
      version: 1,
      routeDirectory: "src/routes",
      entries: [
        {
          routeId: "route_root",
          moduleId: "src/routes/index.tsx",
          routePath: "/"
        },
        {
          routeId: "route_projects_new",
          moduleId: "src/routes/projects/new.tsx",
          routePath: "/projects/new"
        },
        {
          routeId: "route_projects_$id",
          moduleId: "src/routes/projects/$id.tsx",
          routePath: "/projects/:id"
        }
      ],
      modules: [
        {
          kind: "Route",
          routePath: "/"
        },
        {
          kind: "Route",
          routePath: "/projects/new"
        },
        {
          kind: "Route",
          routePath: "/projects/:id"
        }
      ]
    });
  });

  it("describes parent routes and scoped support modules", () => {
    const manifest = generateFileRouteManifestArtifact(
      [
        "src/routes/layout.tsx",
        "src/routes/error.tsx",
        "src/routes/metadata.ts",
        "src/routes/index.tsx",
        "src/routes/projects/_layout.tsx",
        "src/routes/projects/error.tsx",
        "src/routes/projects/metadata.ts",
        "src/routes/projects/index.tsx",
        "src/routes/projects/$id.tsx"
      ],
      options
    );

    expect(describeFileRouteManifest(manifest)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeId: "route_projects_$id",
          routePath: "/projects/:id",
          parentRouteId: "route_projects",
          parentRoutePath: "/projects",
          layouts: [
            expect.objectContaining({ kind: "Layout", routePath: "/" }),
            expect.objectContaining({ kind: "Layout", routePath: "/projects" })
          ],
          errorBoundary: expect.objectContaining({
            kind: "ErrorBoundary",
            routePath: "/projects"
          }),
          metadataModules: [
            expect.objectContaining({ kind: "Metadata", routePath: "/" }),
            expect.objectContaining({ kind: "Metadata", routePath: "/projects" })
          ]
        })
      ])
    );
  });

  it("rejects duplicate support modules for the same route scope", async () => {
    const duplicate = await Effect.runPromiseExit(
      generateValidatedFileRouteManifestArtifactEffect(
        [
          "src/routes/index.tsx",
          "src/routes/projects/layout.tsx",
          "src/routes/projects/_layout.tsx"
        ],
        options
      )
    );

    expect(firstFailure(duplicate)).toBeInstanceOf(FileRouteManifestDuplicateModuleRole);
  });

  it("round-trips a branded route manifest artifact", async () => {
    const manifest = generateFileRouteManifestArtifact(
      [
        "src/routes/projects/_layout.tsx",
        "src/routes/projects/$id.tsx",
        "src/routes/index.tsx"
      ],
      options
    );
    const roundTrip = await Effect.runPromise(
      deserializeFileRouteManifest(serializeFileRouteManifest(manifest))
    );

    expect(roundTrip).toEqual(manifest);
    expect(roundTrip.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "Layout", routePath: "/projects" }),
        expect.objectContaining({ kind: "Route", routePath: "/projects/:id" })
      ])
    );
  });

  it("rejects route manifests whose ids do not match their segments", async () => {
    const manifest = generateFileRouteManifestArtifact(
      ["src/routes/projects/$id.tsx"],
      options
    );
    const invalid = await Effect.runPromiseExit(
      deserializeFileRouteManifest(
        JSON.stringify({
          ...manifest,
          entries: manifest.entries.map((entry) => ({
            ...entry,
            routeId: "route_projects_wrong"
          }))
        })
      )
    );

    expect(firstFailure(invalid)).toBeInstanceOf(FileRouteManifestParseError);
  });
});

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
