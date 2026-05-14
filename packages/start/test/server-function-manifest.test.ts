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

  it("builds deterministic stable ids and serialized output", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* makeServerFunctionManifest([RenameProject, GetProject]);
        const second = yield* makeServerFunctionManifest([GetProject, RenameProject]);

        yield* Effect.sync(() => {
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
      })
    );
  });

  it("round-trips through serialization", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* makeServerFunctionManifest([GetProject, RenameProject], {
          rpcPath: "/__effect-ui/test-rpc"
        });
        const roundTrip = yield* deserializeServerFunctionManifest(
          serializeServerFunctionManifest(manifest)
        );

        yield* Effect.sync(() => expect(roundTrip).toEqual(manifest));
      })
    );
  });

  it("detects duplicate public names and duplicate server exports", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const duplicateName = yield* Effect.exit(
          makeServerFunctionManifest([
            GetProject,
            {
              ...GetProject,
              module: "/src/other/project.server.ts"
            }
          ])
        );
        const duplicateExport = yield* Effect.exit(
          makeServerFunctionManifest([
            GetProject,
            {
              ...RenameProject,
              module: GetProject.module,
              exportName: GetProject.exportName
            }
          ])
        );

        yield* Effect.sync(() => {
          expect(firstFailure(duplicateName)).toBeInstanceOf(
            ServerFunctionManifestDuplicateName
          );
          expect(firstFailure(duplicateExport)).toBeInstanceOf(
            ServerFunctionManifestDuplicateExport
          );
        });
      })
    );
  });

  it("creates browser-safe client references", () => {
    return Effect.runPromise(
      makeServerFunctionManifest([GetProject]).pipe(
        Effect.tap((manifest) =>
          Effect.sync(() => {
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
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("rejects client references to server-only modules", () => {
    return Effect.runPromise(
      Effect.exit(
        makeServerFunctionManifest([
          {
            name: "Project.delete",
            module: "/src/project/project.server.ts",
            exportName: "deleteProject",
            clientModule: "/src/project/project.server.ts"
          }
        ])
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() =>
            expect(firstFailure(exit)).toBeInstanceOf(
              ServerFunctionManifestUnsafeClientReference
            )
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
