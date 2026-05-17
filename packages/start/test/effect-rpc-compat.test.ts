import { Server } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeStartEffectRpcCompatibilityArtifact,
  makeStartEffectRpcGroup,
  serverFunctionToEffectRpc,
} from "../src/effect-rpc-compat.js";
import { makeServerFunctionManifest } from "../src/server-function-manifest.js";

describe("Effect Rpc compatibility", () => {
  it("maps live server functions to Effect unstable Rpc descriptors", () => {
    const GetProjectInput = Schema.Struct({ id: Schema.String });
    const GetProjectOutput = Schema.Struct({ name: Schema.String });
    const GetProjectError = Schema.Struct({ reason: Schema.Literal("Missing") });
    const getProject = Server.fn("Project.byId", {
      input: GetProjectInput,
      output: GetProjectOutput,
      error: GetProjectError,
      handler: () => ({ name: "Sunfall Arc" }),
    });

    const rpc = serverFunctionToEffectRpc(getProject);
    const group = makeStartEffectRpcGroup([getProject]);

    expect(rpc._tag).toBe("Project.byId");
    expect(rpc.key).toBe("effect/rpc/Rpc/Project.byId");
    expect(rpc.payloadSchema).toBe(GetProjectInput);
    expect(rpc.successSchema).toBe(GetProjectOutput);
    expect(rpc.errorSchema).toBe(GetProjectError);
    const grouped = group.requests.get("Project.byId");
    expect(grouped?._tag).toBe("Project.byId");
    expect(grouped?.key).toBe("effect/rpc/Rpc/Project.byId");
    expect(grouped?.payloadSchema).toBe(GetProjectInput);
    expect(grouped?.successSchema).toBe(GetProjectOutput);
    expect(grouped?.errorSchema).toBe(GetProjectError);
  });

  it("falls back to Unknown schemas for untyped server functions", () => {
    const untyped = Server.fn("Project.untyped", {
      handler: () => ({ ok: true }),
    });
    const rpc = serverFunctionToEffectRpc(untyped);

    expect(rpc.payloadSchema).toBe(Schema.Unknown);
    expect(rpc.successSchema).toBe(Schema.Unknown);
    expect(rpc.errorSchema).toBe(Schema.Unknown);
  });

  it("emits deterministic manifest compatibility metadata", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* makeServerFunctionManifest(
          [
            {
              name: "Project.rename",
              module: "/src/project/project.server.ts",
              exportName: "renameProject",
              clientModule: "/src/project/project.contract.ts",
              clientExportName: "renameProject",
              inputSchema: true,
              outputSchema: true,
              errorSchema: true,
            },
            {
              name: "Project.byId",
              module: "/src/project/project.server.ts",
              exportName: "getProject",
              inputSchema: true,
              outputSchema: true,
            },
          ],
          { rpcPath: "/__sunfall-arc/test-rpc" },
        );

        yield* Effect.sync(() => {
          expect(makeStartEffectRpcCompatibilityArtifact(manifest)).toMatchObject({
            version: 1,
            primitive: "effect/unstable/rpc",
            endpoint: {
              method: "POST",
              path: "/__sunfall-arc/test-rpc",
              requestMediaType: "application/json",
              responseMediaType: "application/json",
              protocolVersion: "1",
            },
            procedures: [
              {
                tag: "Project.byId",
                clientReference: "rpc",
                schemas: {
                  payload: true,
                  success: true,
                  error: false,
                },
              },
              {
                tag: "Project.rename",
                clientReference: "import",
                schemas: {
                  payload: true,
                  success: true,
                  error: true,
                },
              },
            ],
          });
        });
      }),
    );
  });
});
