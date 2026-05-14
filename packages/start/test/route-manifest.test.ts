import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  FileRouteManifestDuplicateRoutePath,
  FileRouteManifestInvalidSegment,
  generateValidatedFileRouteManifestArtifactEffect,
  generateValidatedFileRouteManifestEffect
} from "../src/file-routes.js";

describe("validated file route manifest", () => {
  it("rejects files that collapse to the same route path", () => {
    return Effect.runPromise(
      Effect.exit(
        generateValidatedFileRouteManifestEffect(
          [
            "src/routes/(app)/index.tsx",
            "src/routes/(marketing)/index.tsx"
          ],
          { routeDirectory: "src/routes" }
        )
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => expect(firstFailure(exit)).toBeInstanceOf(FileRouteManifestDuplicateRoutePath))
        ),
        Effect.asVoid
      )
    );
  });

  it("rejects malformed dynamic route params", () => {
    return Effect.runPromise(
      Effect.exit(
        generateValidatedFileRouteManifestEffect(
          ["src/routes/projects/$123.tsx"],
          { routeDirectory: "src/routes" }
        )
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => expect(firstFailure(exit)).toBeInstanceOf(FileRouteManifestInvalidSegment))
        ),
        Effect.asVoid
      )
    );
  });

  it("returns a validated manifest artifact", () => {
    return Effect.runPromise(
      generateValidatedFileRouteManifestArtifactEffect(
        [
          "src/routes/projects/$id.tsx",
          "src/routes/index.tsx"
        ],
        { routeDirectory: "src/routes" }
      ).pipe(
        Effect.tap((manifest) =>
          Effect.sync(() =>
            expect(manifest).toMatchObject({
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
            })
          )
        ),
        Effect.asVoid
      )
    );
  });
});

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
