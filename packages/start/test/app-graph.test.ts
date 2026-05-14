import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  createStartAppGraph,
  deserializeStartAppGraph,
  describeStartAppGraph,
  describeStartAppGraphEffect,
  serializeStartAppGraph,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  unknownRoutePreloadCollectionsForDiagnostics,
  unknownRoutePreloadResourcesForDiagnostics,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartAppGraphWireSchemasEffect
} from "../src/app-graph.js";
import { makeActionManifest } from "../src/action-manifest.js";
import { FileRouteManifestParseError, generateFileRouteManifestArtifact } from "../src/file-routes.js";
import { makeServerFunctionManifest } from "../src/server-function-manifest.js";

describe("Start app graph", () => {
  it("combines route, server function, and action manifests into one deterministic artifact", async () => {
    const graph = await makeGraph();

    expect(JSON.parse(serializeStartAppGraph(graph))).toMatchObject({
      version: 1,
      routes: {
        version: 1,
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
      },
      serverFunctions: {
        version: 1,
        entries: [
          {
            id: "sf_hvaqa4_project-load",
            name: "Project.load"
          }
        ]
      },
      actions: {
        version: 1,
        entries: [
          {
            id: "act_lgpr76_project-rename",
            name: "Project.rename"
          }
        ]
      }
    });
  });

  it("round-trips through typed deserialization", async () => {
    const graph = await makeGraph();
    const roundTrip = await Effect.runPromise(
      deserializeStartAppGraph(serializeStartAppGraph(graph))
    );

    expect(roundTrip).toEqual(graph);
  });

  it("describes app graph topology for devtools and build diagnostics", async () => {
    const graph = await makeGraph();

    expect(describeStartAppGraph(graph)).toEqual({
      version: 1,
      routeCount: 2,
      serverFunctionCount: 1,
      actionCount: 1,
      routePaths: ["/", "/projects/:id"],
      routeModules: [
        {
          routeId: "route_root",
          routePath: "/",
          moduleId: "src/routes/index.tsx",
          filePath: "src/routes/index.tsx",
          pathParamCount: 0,
          hasPathParams: false,
          params: [],
          paramsSchema: "unknown",
          searchSchema: "unknown",
          preload: "unknown",
          preloadResources: {
            status: "unknown",
            families: []
          },
          preloadCollections: {
            status: "unknown",
            collections: []
          },
          component: "unknown"
        },
        {
          routeId: "route_projects_$id",
          routePath: "/projects/:id",
          moduleId: "src/routes/projects/$id.tsx",
          filePath: "src/routes/projects/$id.tsx",
          pathParamCount: 1,
          hasPathParams: true,
          params: [
            {
              name: "id",
              optional: false
            }
          ],
          paramsSchema: "unknown",
          searchSchema: "unknown",
          preload: "unknown",
          preloadResources: {
            status: "unknown",
            families: []
          },
          preloadCollections: {
            status: "unknown",
            collections: []
          },
          component: "unknown"
        }
      ],
      serverFunctionModules: [
        {
          id: "sf_hvaqa4_project-load",
          name: "Project.load",
          server: {
            module: "/src/project/project.server.ts",
            exportName: "loadProject",
            moduleKind: "server-only",
            hasHandler: true
          },
          client: {
            _tag: "Import",
            rpcPath: "/__effect-ui/rpc",
            module: "/src/project/project.contract.ts",
            exportName: "loadProject",
            moduleKind: "contract"
          },
          wire: {
            inputSchema: true,
            outputSchema: true,
            errorSchema: false,
            complete: false,
            missing: ["error"]
          }
        }
      ],
      actionModules: [
        {
          id: "act_lgpr76_project-rename",
          name: "Project.rename",
          server: {
            module: "/src/project/project.actions.ts",
            exportName: "RenameProject",
            moduleKind: "shared"
          },
          client: {
            _tag: "Import",
            actionPath: "/__effect-ui/action",
            module: "/src/project/project.actions.ts",
            exportName: "RenameProject",
            moduleKind: "shared"
          },
          wire: {
            inputSchema: true,
            outputSchema: true,
            errorSchema: false,
            complete: false,
            missing: ["error"]
          },
          behavior: {
            invalidates: "present",
            optimistic: "absent",
            retry: "present",
            concurrency: "latest"
          }
        }
      ],
      resourceFamilies: [],
      resourceTags: [],
      collectionDefinitions: [],
      serverOnlyModules: ["/src/project/project.server.ts"],
      browserClientModules: [
        "/src/project/project.actions.ts",
        "/src/project/project.contract.ts"
      ],
      rpcPath: "/__effect-ui/rpc",
      actionPath: "/__effect-ui/action",
      schemaCoverage: {
        serverFunctions: {
          total: 1,
          input: 1,
          output: 1,
          error: 0
        },
        actions: {
          total: 1,
          input: 1,
          output: 1,
          error: 0
        }
      },
      missingSchemas: [
        {
          kind: "serverFunction",
          name: "Project.load",
          input: true,
          output: true,
          error: false
        },
        {
          kind: "action",
          name: "Project.rename",
          input: true,
          output: true,
          error: false
        }
      ],
      unknownActionBehavior: [],
      unknownRoutePreloadResources: [],
      unknownRoutePreloadCollections: []
    });

    await expect(Effect.runPromise(describeStartAppGraphEffect(graph))).resolves.toEqual(
      describeStartAppGraph(graph)
    );
  });

  it("validates required wire schema coverage with typed failures", async () => {
    const graph = await makeGraph();

    await expect(
      Effect.runPromise(validateStartAppGraphWireSchemasEffect(graph))
    ).resolves.toBeUndefined();

    const exit = await Effect.runPromiseExit(
      validateStartAppGraphWireSchemasEffect(graph, { requireError: true })
    );

    expect(firstFailure(exit)).toBeInstanceOf(StartAppGraphMissingWireSchemas);
    expect(firstFailure(exit)).toMatchObject({
      missing: [
        {
          kind: "serverFunction",
          name: "Project.load",
          error: false
        },
        {
          kind: "action",
          name: "Project.rename",
          error: false
        }
      ]
    });
  });

  it("can require action behavior metadata for build diagnostics", async () => {
    const graph = await makeGraph({
      actionBehavior: "unknown"
    });

    const exit = await Effect.runPromiseExit(
      validateStartAppGraphActionBehaviorEffect(graph)
    );

    expect(firstFailure(exit)).toBeInstanceOf(StartAppGraphUnknownActionBehavior);
    expect(firstFailure(exit)).toMatchObject({
      unknown: [
        {
          kind: "action",
          name: "Project.rename",
          invalidates: "unknown",
          concurrency: "unknown"
        }
      ]
    });
  });

  it("can require declared preload resources for route-module diagnostics", async () => {
    const graph = await makeGraph();
    const diagnostics = describeStartAppGraph(graph);
    const routeModules = diagnostics.routeModules.map((routeModule) =>
      routeModule.routeId === "route_projects_$id"
        ? {
            ...routeModule,
            preload: "present" as const,
            preloadResources: {
              status: "unknown" as const,
              families: []
            }
          }
        : routeModule
    );
    const withUnknownPreloadResources = {
      ...diagnostics,
      routeModules,
      unknownRoutePreloadResources: unknownRoutePreloadResourcesForDiagnostics({
        routeModules
      })
    };
    const withDeclaredPreloadResources = {
      ...withUnknownPreloadResources,
      routeModules: routeModules.map((routeModule) =>
        routeModule.routeId === "route_projects_$id"
          ? {
              ...routeModule,
              preloadResources: {
                status: "declared" as const,
                families: ["Project.byId"]
              }
            }
          : routeModule
      )
    };
    const declaredDiagnostics = {
      ...withDeclaredPreloadResources,
      unknownRoutePreloadResources: unknownRoutePreloadResourcesForDiagnostics({
        routeModules: withDeclaredPreloadResources.routeModules
      })
    };

    const exit = await Effect.runPromiseExit(
      validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect(
        withUnknownPreloadResources
      )
    );

    expect(firstFailure(exit)).toBeInstanceOf(StartAppGraphUnknownRoutePreloadResources);
    expect(firstFailure(exit)).toMatchObject({
      unknown: [
        {
          kind: "route",
          routePath: "/projects/:id",
          preload: "present",
          preloadResources: {
            status: "unknown"
          }
        }
      ]
    });
    await expect(
      Effect.runPromise(
        validateStartAppGraphDiagnosticsPolicyEffect(declaredDiagnostics, {
          routePreloadResources: {
            requireDeclaredForPreload: true
          }
        })
      )
    ).resolves.toBeUndefined();
  });

  it("can require declared preload collections for route-module diagnostics", async () => {
    const graph = await makeGraph();
    const diagnostics = describeStartAppGraph(graph);
    const routeModules = diagnostics.routeModules.map((routeModule) =>
      routeModule.routeId === "route_projects_$id"
        ? {
            ...routeModule,
            preload: "present" as const,
            preloadCollections: {
              status: "unknown" as const,
              collections: []
            }
          }
        : routeModule
    );
    const withUnknownPreloadCollections = {
      ...diagnostics,
      routeModules,
      unknownRoutePreloadCollections: unknownRoutePreloadCollectionsForDiagnostics({
        routeModules
      })
    };
    const withDeclaredPreloadCollections = {
      ...withUnknownPreloadCollections,
      routeModules: routeModules.map((routeModule) =>
        routeModule.routeId === "route_projects_$id"
          ? {
              ...routeModule,
              preloadCollections: {
                status: "declared" as const,
                collections: ["Projects.collection"]
              }
            }
          : routeModule
      )
    };
    const declaredDiagnostics = {
      ...withDeclaredPreloadCollections,
      unknownRoutePreloadCollections: unknownRoutePreloadCollectionsForDiagnostics({
        routeModules: withDeclaredPreloadCollections.routeModules
      })
    };

    const exit = await Effect.runPromiseExit(
      validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect(
        withUnknownPreloadCollections
      )
    );

    expect(firstFailure(exit)).toBeInstanceOf(StartAppGraphUnknownRoutePreloadCollections);
    expect(firstFailure(exit)).toMatchObject({
      unknown: [
        {
          kind: "route",
          routePath: "/projects/:id",
          preload: "present",
          preloadCollections: {
            status: "unknown"
          }
        }
      ]
    });
    await expect(
      Effect.runPromise(
        validateStartAppGraphDiagnosticsPolicyEffect(declaredDiagnostics, {
          routePreloadCollections: {
            requireDeclaredForPreload: true
          }
        })
      )
    ).resolves.toBeUndefined();
  });



  it("rejects malformed graph payloads before tooling consumes them", async () => {
    const invalidJson = await Effect.runPromiseExit(
      deserializeStartAppGraph("{not-json")
    );
    const invalidVersion = await Effect.runPromiseExit(
      deserializeStartAppGraph(JSON.stringify({ version: 2 }))
    );

    expect(firstFailure(invalidJson)).toBeInstanceOf(StartAppGraphParseError);
    expect(firstFailure(invalidVersion)).toBeInstanceOf(StartAppGraphParseError);
  });

  it("revalidates nested manifests while deserializing the graph", async () => {
    const graph = await makeGraph();
    const corrupted = JSON.parse(serializeStartAppGraph(graph)) as {
      readonly routes: {
        readonly entries: Array<{ routeId: string }>;
      };
    };
    corrupted.routes.entries[0].routeId = "route_wrong";

    const exit = await Effect.runPromiseExit(
      deserializeStartAppGraph(JSON.stringify(corrupted))
    );

    expect(firstFailure(exit)).toBeInstanceOf(FileRouteManifestParseError);
  });
});

const makeGraph = async (
  options: { readonly actionBehavior?: "known" | "unknown" } = {}
) => {
  const routes = generateFileRouteManifestArtifact(
    [
      "src/routes/projects/$id.tsx",
      "src/routes/index.tsx"
    ],
    { routeDirectory: "src/routes" }
  );
  const serverFunctions = await Effect.runPromise(
    makeServerFunctionManifest([
      {
        name: "Project.load",
        module: "/src/project/project.server.ts",
        exportName: "loadProject",
        clientModule: "/src/project/project.contract.ts",
        clientExportName: "loadProject",
        inputSchema: true,
        outputSchema: true
      }
    ])
  );
  const actions = await Effect.runPromise(
    makeActionManifest([
      {
        name: "Project.rename",
        module: "/src/project/project.actions.ts",
        exportName: "RenameProject",
        clientModule: "/src/project/project.actions.ts",
        clientExportName: "RenameProject",
        inputSchema: true,
        outputSchema: true,
        ...(options.actionBehavior === "unknown"
          ? {}
          : {
              invalidates: true,
              optimistic: false,
              retry: true,
              concurrency: "latest" as const
            })
      }
    ])
  );

  return createStartAppGraph({
    routes,
    serverFunctions,
    actions
  });
};

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
