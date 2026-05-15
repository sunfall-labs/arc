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
  ServerFunctionManifestInvalidEndpointPath,
  ServerFunctionManifestInvalidEntry,
  ServerFunctionManifestParseError,
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

  it("normalizes source server function endpoint paths", () => {
    return Effect.runPromise(
      makeServerFunctionManifest([GetProject], {
        rpcPath: " /__effect-ui/custom-rpc "
      }).pipe(
        Effect.tap((manifest) =>
          Effect.sync(() => {
            expect(manifest.rpcPath).toBe("/__effect-ui/custom-rpc");
            expect(manifest.entries[0]?.client).toMatchObject({
              rpcPath: "/__effect-ui/custom-rpc"
            });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("rejects unsafe source server function endpoint paths", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const exits = yield* Effect.all(
          ["", "   ", "rpc", "https://example.com/rpc", "/__effect-ui/rpc\r\nx"].map((rpcPath) =>
            Effect.exit(makeServerFunctionManifest([GetProject], { rpcPath }))
          )
        );

        yield* Effect.sync(() => {
          for (const exit of exits) {
            expect(firstFailure(exit)).toBeInstanceOf(ServerFunctionManifestInvalidEndpointPath);
          }
        });
      })
    );
  });

  it("normalizes serialized server function endpoint paths", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* makeServerFunctionManifest([GetProject], {
          rpcPath: "/__effect-ui/rpc"
        });
        const serialized = JSON.parse(serializeServerFunctionManifest(manifest)) as {
          rpcPath: string;
          entries: Array<{ client: { rpcPath: string } }>;
        };
        serialized.rpcPath = " /__effect-ui/serialized-rpc ";
        serialized.entries[0]!.client.rpcPath = " /__effect-ui/serialized-rpc ";
        const decoded = yield* deserializeServerFunctionManifest(JSON.stringify(serialized));

        yield* Effect.sync(() => {
          expect(decoded.rpcPath).toBe("/__effect-ui/serialized-rpc");
          expect(decoded.entries[0]?.client).toMatchObject({
            rpcPath: "/__effect-ui/serialized-rpc"
          });
        });
      })
    );
  });

  it("rejects unsafe serialized server function endpoint paths", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* makeServerFunctionManifest([GetProject]);
        const serialized = serializeServerFunctionManifest(manifest);
        type SerializedServerFunctionManifest = {
          rpcPath: string;
          entries: Array<{ client: { rpcPath: string } }>;
        };
        const cases = [
          (value: SerializedServerFunctionManifest) => {
            value.rpcPath = "https://example.com/rpc";
          },
          (value: SerializedServerFunctionManifest) => {
            value.rpcPath = "";
          },
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.client.rpcPath = "/__effect-ui/rpc\nx";
          },
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.client.rpcPath = "rpc";
          }
        ];
        const exits = yield* Effect.all(
          cases.map((mutate) => {
            const decoded = JSON.parse(serialized) as SerializedServerFunctionManifest;
            mutate(decoded);
            return Effect.exit(deserializeServerFunctionManifest(JSON.stringify(decoded)));
          })
        );

        yield* Effect.sync(() => {
          for (const exit of exits) {
            expect(firstFailure(exit)).toBeInstanceOf(ServerFunctionManifestParseError);
          }
        });
      })
    );
  });

  it("rejects serialized entries whose moduleKind disagrees with their modules", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* makeServerFunctionManifest([GetProject]);
        const serverKindMismatch = JSON.parse(serializeServerFunctionManifest(manifest)) as {
          readonly entries: Array<{
            readonly server: { moduleKind: string };
          }>;
        };
        const clientKindMismatch = JSON.parse(serializeServerFunctionManifest(manifest)) as {
          readonly entries: Array<{
            readonly client: { moduleKind?: string };
          }>;
        };

        serverKindMismatch.entries[0]!.server.moduleKind = "shared";
        clientKindMismatch.entries[0]!.client.moduleKind = "shared";

        const invalidServerKind = yield* Effect.exit(
          deserializeServerFunctionManifest(JSON.stringify(serverKindMismatch))
        );
        const invalidClientKind = yield* Effect.exit(
          deserializeServerFunctionManifest(JSON.stringify(clientKindMismatch))
        );

        yield* Effect.sync(() => {
          expect(firstFailure(invalidServerKind)).toBeInstanceOf(ServerFunctionManifestParseError);
          expect(firstFailure(invalidClientKind)).toBeInstanceOf(ServerFunctionManifestParseError);
        });
      })
    );
  });

  it("rejects serialized manifests with whitespace-only identity fields", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* makeServerFunctionManifest([GetProject]);
        const serialized = serializeServerFunctionManifest(manifest);
        type SerializedServerFunctionManifest = {
          readonly entries: Array<{
            name: string;
            readonly server: { module: string; exportName: string };
            readonly client: { name: string; module?: string; exportName?: string };
          }>;
        };
        const cases = [
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.name = "   ";
          },
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.server.module = "   ";
          },
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.server.exportName = "   ";
          },
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.client.name = "   ";
          },
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.client.module = "   ";
          },
          (value: SerializedServerFunctionManifest) => {
            value.entries[0]!.client.exportName = "   ";
          }
        ];
        const exits = yield* Effect.all(
          cases.map((mutate) => {
            const decoded = JSON.parse(serialized) as SerializedServerFunctionManifest;
            mutate(decoded);
            return Effect.exit(deserializeServerFunctionManifest(JSON.stringify(decoded)));
          })
        );

        yield* Effect.sync(() => {
          for (const exit of exits) {
            expect(firstFailure(exit)).toBeInstanceOf(ServerFunctionManifestParseError);
          }
        });
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

  it("rejects import client references with empty module or export names", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const emptyClientModule = yield* Effect.exit(
          makeServerFunctionManifest([
            {
              ...GetProject,
              clientModule: ""
            }
          ])
        );
        const emptyClientExport = yield* Effect.exit(
          makeServerFunctionManifest([
            {
              ...GetProject,
              clientExportName: ""
            }
          ])
        );

        yield* Effect.sync(() => {
          expect(firstFailure(emptyClientModule)).toBeInstanceOf(ServerFunctionManifestInvalidEntry);
          expect(firstFailure(emptyClientModule)).toMatchObject({
            reason: "MissingModule"
          });
          expect(firstFailure(emptyClientExport)).toBeInstanceOf(ServerFunctionManifestInvalidEntry);
          expect(firstFailure(emptyClientExport)).toMatchObject({
            reason: "MissingExportName"
          });
        });
      })
    );
  });

  it("rejects whitespace-only server function manifest identity fields", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const invalidEntries = yield* Effect.all(
          [
            { ...GetProject, name: "   " },
            { ...GetProject, module: "   " },
            { ...GetProject, exportName: "   " },
            { ...GetProject, clientModule: "   " },
            { ...GetProject, clientExportName: "   " }
          ].map((definition) => Effect.exit(makeServerFunctionManifest([definition])))
        );

        yield* Effect.sync(() => {
          for (const exit of invalidEntries) {
            expect(firstFailure(exit)).toBeInstanceOf(ServerFunctionManifestInvalidEntry);
          }
        });
      })
    );
  });
});

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
