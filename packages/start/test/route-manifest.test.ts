import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  FileRouteManifestDuplicateRoutePath,
  FileRouteManifestInvalidSegment,
  generateValidatedFileRouteManifestArtifactEffect,
  generateValidatedFileRouteManifestEffect
} from "../src/file-routes.js";

describe("validated file route manifest", () => {
  it("rejects files that collapse to the same route path", async () => {
    const exit = await Effect.runPromiseExit(
      generateValidatedFileRouteManifestEffect(
        [
          "src/routes/(app)/index.tsx",
          "src/routes/(marketing)/index.tsx"
        ],
        { routeDirectory: "src/routes" }
      )
    );

    expect(firstFailure(exit)).toBeInstanceOf(FileRouteManifestDuplicateRoutePath);
  });

  it("rejects malformed dynamic route params", async () => {
    const exit = await Effect.runPromiseExit(
      generateValidatedFileRouteManifestEffect(
        ["src/routes/projects/$123.tsx"],
        { routeDirectory: "src/routes" }
      )
    );

    expect(firstFailure(exit)).toBeInstanceOf(FileRouteManifestInvalidSegment);
  });

  it("returns a validated manifest artifact", async () => {
    await expect(
      Effect.runPromise(
        generateValidatedFileRouteManifestArtifactEffect(
          [
            "src/routes/projects/$id.tsx",
            "src/routes/index.tsx"
          ],
          { routeDirectory: "src/routes" }
        )
      )
    ).resolves.toMatchObject({
      version: 1,
      routeDirectory: "src/routes",
      entries: [
        {
          routeId: "route_root",
          routePath: "/"
        },
        {
          routeId: "route_projects_$id",
          routePath: "/projects/:id"
        }
      ]
    });
  });
});

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
