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

  it("builds deterministic branded ids and serialized output", async () => {
    const first = await Effect.runPromise(
      makeActionManifest([SubmitProjectName, RenameProject])
    );
    const second = await Effect.runPromise(
      makeActionManifest([RenameProject, SubmitProjectName])
    );

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

  it("round-trips through serialization", async () => {
    const manifest = await Effect.runPromise(
      makeActionManifest([SubmitProjectName, RenameProject], {
        actionPath: "/__effect-ui/test-action"
      })
    );
    const roundTrip = await Effect.runPromise(
      deserializeActionManifest(serializeActionManifest(manifest))
    );

    expect(roundTrip).toEqual(manifest);
  });

  it("rejects malformed serialized manifests", async () => {
    const invalidJson = await Effect.runPromiseExit(
      deserializeActionManifest("{not-json")
    );
    const invalidIdentity = await Effect.runPromiseExit(
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

    expect(firstFailure(invalidJson)).toBeInstanceOf(ActionManifestParseError);
    expect(firstFailure(invalidIdentity)).toBeInstanceOf(ActionManifestParseError);
  });

  it("derives definitions from Action definitions", async () => {
    const Save = Action.define({
      name: "Project.save.manifest",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ ok: Schema.Boolean }),
      run: () => ({ ok: true })
    });
    const manifest = await Effect.runPromise(
      makeActionManifest([
        actionManifestDefinition(Save, {
          module: "/src/project/domain.ts",
          exportName: "Save"
        })
      ])
    );

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
    });
  });

  it("detects duplicate public names and duplicate server exports", async () => {
    const duplicateName = await Effect.runPromiseExit(
      makeActionManifest([
        RenameProject,
        {
          ...RenameProject,
          module: "/src/other/domain.ts"
        }
      ])
    );
    const duplicateExport = await Effect.runPromiseExit(
      makeActionManifest([
        RenameProject,
        {
          ...SubmitProjectName,
          module: RenameProject.module,
          exportName: RenameProject.exportName
        }
      ])
    );

    expect(firstFailure(duplicateName)).toBeInstanceOf(ActionManifestDuplicateName);
    expect(firstFailure(duplicateExport)).toBeInstanceOf(ActionManifestDuplicateExport);
  });

  it("creates browser-safe client references", async () => {
    const manifest = await Effect.runPromise(makeActionManifest([RenameProject]));
    const reference = clientReferencesForActionManifest(manifest)[0];

    expect(reference).toBeDefined();
    expect(reference?._tag).toBe("Import");
    expect(reference ? isBrowserSafeActionClientReference(reference) : false).toBe(true);
    expect(JSON.stringify(reference)).not.toContain(".server");
  });

  it("rejects client references to server-only modules", async () => {
    const exit = await Effect.runPromiseExit(
      makeActionManifest([
        {
          name: "Project.delete",
          module: "/src/project/domain.ts",
          exportName: "DeleteProject",
          clientModule: "/src/project/domain.server.ts"
        }
      ])
    );

    expect(firstFailure(exit)).toBeInstanceOf(ActionManifestUnsafeClientReference);
  });
});

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
