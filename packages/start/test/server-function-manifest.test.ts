import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  clientReferencesForServerFunctionManifest,
  deserializeServerFunctionManifest,
  isBrowserSafeServerFunctionClientReference,
  makeServerFunctionManifest,
  serializeServerFunctionManifest,
  ServerFunctionManifestDuplicateExport,
  ServerFunctionManifestDuplicateName,
  ServerFunctionManifestUnsafeClientReference,
  stableServerFunctionId
} from "../src/server-function-manifest.js";

describe("server function manifest", () => {
  const GetProject = {
    name: "Project.byId",
    module: "/src/project/project.server.ts",
    exportName: "getProject",
    clientModule: "/src/project/project.contract.ts",
    clientExportName: "getProject",
    inputSchema: true,
    outputSchema: true
  };
  const RenameProject = {
    name: "Project.rename",
    module: "/src/project/project.server.ts",
    exportName: "renameProject",
    clientModule: "/src/project/project.contract.ts",
    clientExportName: "renameProject",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true
  };

  it("builds deterministic stable ids and serialized output", async () => {
    const first = await Effect.runPromise(
      makeServerFunctionManifest([RenameProject, GetProject])
    );
    const second = await Effect.runPromise(
      makeServerFunctionManifest([GetProject, RenameProject])
    );

    expect(serializeServerFunctionManifest(first)).toBe(
      serializeServerFunctionManifest(second)
    );
    expect(first.entries.map((entry) => entry.name)).toEqual([
      "Project.byId",
      "Project.rename"
    ]);
    expect(first.entries.map((entry) => entry.id)).toEqual(
      first.entries.map((entry) => stableServerFunctionId(entry.name))
    );
    expect(first.entries[0]).toMatchObject({
      server: {
        module: "/src/project/project.server.ts",
        moduleKind: "server-only",
        hasHandler: true
      },
      wire: {
        inputSchema: true,
        outputSchema: true,
        errorSchema: false
      }
    });
  });

  it("round-trips through serialization", async () => {
    const manifest = await Effect.runPromise(
      makeServerFunctionManifest([GetProject, RenameProject], {
        rpcPath: "/__effect-ui/test-rpc"
      })
    );
    const roundTrip = await Effect.runPromise(
      deserializeServerFunctionManifest(serializeServerFunctionManifest(manifest))
    );

    expect(roundTrip).toEqual(manifest);
  });

  it("detects duplicate public names and duplicate server exports", async () => {
    const duplicateName = await Effect.runPromiseExit(
      makeServerFunctionManifest([
        GetProject,
        {
          ...GetProject,
          module: "/src/other/project.server.ts"
        }
      ])
    );
    const duplicateExport = await Effect.runPromiseExit(
      makeServerFunctionManifest([
        GetProject,
        {
          ...RenameProject,
          module: GetProject.module,
          exportName: GetProject.exportName
        }
      ])
    );

    expect(firstFailure(duplicateName)).toBeInstanceOf(
      ServerFunctionManifestDuplicateName
    );
    expect(firstFailure(duplicateExport)).toBeInstanceOf(
      ServerFunctionManifestDuplicateExport
    );
  });

  it("creates browser-safe client references", async () => {
    const manifest = await Effect.runPromise(makeServerFunctionManifest([GetProject]));
    const references = clientReferencesForServerFunctionManifest(manifest);
    const reference = references[0];

    expect(reference).toBeDefined();
    expect(reference?._tag).toBe("Import");
    expect(reference ? isBrowserSafeServerFunctionClientReference(reference) : false).toBe(true);
    expect(JSON.stringify(reference)).not.toContain(".server");
    if (reference?._tag === "Import") {
      expect(reference.module).toBe("/src/project/project.contract.ts");
      expect(reference.moduleKind).toBe("contract");
    }
  });

  it("rejects client references to server-only modules", async () => {
    const exit = await Effect.runPromiseExit(
      makeServerFunctionManifest([
        {
          name: "Project.delete",
          module: "/src/project/project.server.ts",
          exportName: "deleteProject",
          clientModule: "/src/project/project.server.ts"
        }
      ])
    );

    expect(firstFailure(exit)).toBeInstanceOf(
      ServerFunctionManifestUnsafeClientReference
    );
  });
});

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
