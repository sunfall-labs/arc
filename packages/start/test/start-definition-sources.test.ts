import { Action, Route, Server } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { App, createRequestHandler } from "../src/index.js";
import {
  StartDefinitionNotExported,
  startDefinitionSourcesFromModules,
} from "../src/start-definition-sources.js";
import { startServedDefinitionsOf } from "../src/start-served-definitions.js";

const GetProject = Server.contract<{ readonly id: string }, string>("Derive.project.get", {
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.String,
});
const getProjectClient = Server.client(GetProject);
const getProjectServer = Server.implement(GetProject, ({ id }) => Effect.succeed(id));
const RenameProject = Action.define({
  name: "Derive.project.rename",
  input: Schema.String,
  output: Schema.String,
  run: (name) => Effect.succeed(name),
});

const Root = Component.define("DeriveRoot", function* () {
  yield* Effect.void;
  return () => "root";
});

describe("deriving manifest sources from the server entry", () => {
  it("attaches what a handler serves", () => {
    const handler = createRequestHandler(
      App.define({
        root: Root,
        routes: [Route.define("/", {})] as const,
        actions: [RenameProject],
      }),
      { serverFunctions: [getProjectServer] },
    );

    expect(startServedDefinitionsOf(handler)).toEqual({
      actions: [RenameProject],
      serverFunctions: [getProjectServer],
    });
    expect(startServedDefinitionsOf(() => undefined)).toBeUndefined();
  });

  it("names each served definition by the module export it came from", async () => {
    const sources = await Effect.runPromise(
      startDefinitionSourcesFromModules(
        { actions: [RenameProject], serverFunctions: [getProjectServer] },
        [
          { id: "/src/project.server.ts", exports: { getProject: getProjectServer } },
          { id: "/src/project.contract.ts", exports: { getProject: getProjectClient, GetProject } },
          { id: "/src/project.ts", exports: { RenameProject, default: RenameProject } },
        ],
      ),
    );

    expect(sources.serverFunctionSources).toEqual([
      {
        fn: getProjectServer,
        module: "/src/project.server.ts",
        exportName: "getProject",
        clientModule: "/src/project.contract.ts",
        clientExportName: "getProject",
      },
    ]);
    expect(sources.actionSources).toEqual([
      {
        action: RenameProject,
        module: "/src/project.ts",
        exportName: "RenameProject",
        clientModule: "/src/project.ts",
        clientExportName: "RenameProject",
      },
    ]);
  });

  it("omits the client reference when no module exports a client for the server function", async () => {
    const sources = await Effect.runPromise(
      startDefinitionSourcesFromModules({ actions: [], serverFunctions: [getProjectServer] }, [
        { id: "/src/project.server.ts", exports: { getProject: getProjectServer } },
      ]),
    );

    expect(sources.serverFunctionSources).toEqual([
      { fn: getProjectServer, module: "/src/project.server.ts", exportName: "getProject" },
    ]);
  });

  it("fails with guidance when a served definition is not exported", async () => {
    const exit = await Effect.runPromiseExit(
      startDefinitionSourcesFromModules({ actions: [RenameProject], serverFunctions: [] }, [
        { id: "/src/project.server.ts", exports: { getProject: getProjectServer } },
      ]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.findErrorOption(exit)).toMatchObject({
      _tag: "Some",
      value: expect.objectContaining({
        _tag: "StartDefinitionNotExported",
        kind: "action",
        name: "Derive.project.rename",
      }),
    });
    expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
      value: expect.any(StartDefinitionNotExported),
    });
  });
});
