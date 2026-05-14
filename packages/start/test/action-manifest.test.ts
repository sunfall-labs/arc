import { Action } from "@effect-ui/core";
import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ActionManifestDuplicateExport,
  ActionManifestDuplicateName,
  ActionManifestParseError,
  ActionManifestUnsafeClientReference,
  actionManifestDefinition,
  clientReferencesForActionManifest,
  deserializeActionManifest,
  isBrowserSafeActionClientReference,
  makeActionManifest,
  serializeActionManifest,
  stableActionId
} from "../src/action-manifest.js";

describe("action manifest", () => {
  const RenameProject = {
    name: "Project.rename",
    module: "/src/project/domain.ts",
    exportName: "RenameProject",
    clientModule: "/src/project/domain.ts",
    clientExportName: "RenameProject",
    inputSchema: true,
    outputSchema: true,
    invalidates: true,
    optimistic: true,
    retry: false,
    concurrency: "exhaust" as const
  };
  const SubmitProjectName = {
    name: "Project.name.submit",
    module: "/src/project/domain.ts",
    exportName: "SubmitProjectName",
    clientModule: "/src/project/domain.ts",
    clientExportName: "SubmitProjectName",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true,
    invalidates: true,
    optimistic: false,
    retry: true,
    concurrency: "latest" as const
  };

  it("builds deterministic branded ids and serialized output", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* makeActionManifest([SubmitProjectName, RenameProject]);
        const second = yield* makeActionManifest([RenameProject, SubmitProjectName]);

        yield* Effect.sync(() => {
          expect(serializeActionManifest(first)).toBe(serializeActionManifest(second));
          expect(first.entries.map((entry) => entry.name)).toEqual([
            "Project.name.submit",
            "Project.rename"
          ]);
          expect(first.entries.map((entry) => entry.id)).toEqual(
            first.entries.map((entry) => stableActionId(entry.name))
          );
          expect(first.entries[0]).toMatchObject({
            server: {
              module: "/src/project/domain.ts",
              moduleKind: "shared"
            },
            wire: {
              inputSchema: true,
              outputSchema: true,
              errorSchema: true
            },
            behavior: {
              invalidates: "present",
              optimistic: "absent",
              retry: "present",
              concurrency: "latest"
            }
          });
        });
      })
    );
  });

  it("round-trips through serialization", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* makeActionManifest([SubmitProjectName, RenameProject], {
          actionPath: "/__effect-ui/test-action"
        });
        const roundTrip = yield* deserializeActionManifest(serializeActionManifest(manifest));

        yield* Effect.sync(() => expect(roundTrip).toEqual(manifest));
      })
    );
  });

  it("rejects malformed serialized manifests", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const invalidJson = yield* Effect.exit(deserializeActionManifest("{not-json"));
        const invalidIdentity = yield* Effect.exit(
          deserializeActionManifest(
            JSON.stringify({
              version: 1,
              actionPath: "/__effect-ui/action",
              entries: [
                {
                  id: stableActionId("Project.other"),
                  name: "Project.rename",
                  server: {
                    module: "/src/project/domain.ts",
                    exportName: "RenameProject",
                    moduleKind: "shared"
                  },
                  client: {
                    _tag: "Post",
                    id: stableActionId("Project.other"),
                    name: "Project.rename",
                    actionPath: "/__effect-ui/action"
                  },
                  wire: {
                    inputSchema: true,
                    outputSchema: true,
                    errorSchema: false
                  }
                }
              ]
            })
          )
        );

        yield* Effect.sync(() => {
          expect(firstFailure(invalidJson)).toBeInstanceOf(ActionManifestParseError);
          expect(firstFailure(invalidIdentity)).toBeInstanceOf(ActionManifestParseError);
        });
      })
    );
  });

  it("derives definitions from Action definitions", () => {
    const Save = Action.define({
      name: "Project.save.manifest",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => ({ ok: true })
    });

    return Effect.runPromise(
      makeActionManifest([
        actionManifestDefinition(Save, {
          module: "/src/project/domain.ts",
          exportName: "Save"
        })
      ]).pipe(
        Effect.tap((manifest) =>
          Effect.sync(() =>
            expect(manifest.entries[0]).toMatchObject({
              name: "Project.save.manifest",
              wire: {
                inputSchema: true,
                outputSchema: true,
                errorSchema: false
              },
              behavior: {
                invalidates: "absent",
                optimistic: "absent",
                retry: "absent",
                concurrency: "latest"
              }
            })
          )
        ),
        Effect.asVoid
      )
    );
  });

  it("detects duplicate public names and duplicate server exports", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const duplicateName = yield* Effect.exit(
          makeActionManifest([
            RenameProject,
            {
              ...RenameProject,
              module: "/src/other/domain.ts"
            }
          ])
        );
        const duplicateExport = yield* Effect.exit(
          makeActionManifest([
            RenameProject,
            {
              ...SubmitProjectName,
              module: RenameProject.module,
              exportName: RenameProject.exportName
            }
          ])
        );

        yield* Effect.sync(() => {
          expect(firstFailure(duplicateName)).toBeInstanceOf(ActionManifestDuplicateName);
          expect(firstFailure(duplicateExport)).toBeInstanceOf(ActionManifestDuplicateExport);
        });
      })
    );
  });

  it("creates browser-safe client references", () => {
    return Effect.runPromise(
      makeActionManifest([RenameProject]).pipe(
        Effect.tap((manifest) =>
          Effect.sync(() => {
            const reference = clientReferencesForActionManifest(manifest)[0];

            expect(reference).toBeDefined();
            expect(reference?._tag).toBe("Import");
            expect(reference ? isBrowserSafeActionClientReference(reference) : false).toBe(true);
            expect(JSON.stringify(reference)).not.toContain(".server");
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("rejects client references to server-only modules", () => {
    return Effect.runPromise(
      Effect.exit(
        makeActionManifest([
          {
            name: "Project.delete",
            module: "/src/project/domain.ts",
            exportName: "DeleteProject",
            clientModule: "/src/project/domain.server.ts"
          }
        ])
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => expect(firstFailure(exit)).toBeInstanceOf(ActionManifestUnsafeClientReference))
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
