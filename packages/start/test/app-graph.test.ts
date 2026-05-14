import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  createStartAppGraph,
  deserializeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  describeStartAppGraph,
  describeStartAppGraphEffect,
  enforceStartAppGraphDiagnosticsPolicy,
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
  it("combines route, server function, and action manifests into one deterministic artifact", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();

        yield* Effect.sync(() =>
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
          })
        );
      })
    );
  });

  it("round-trips through typed deserialization", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const roundTrip = yield* deserializeStartAppGraph(serializeStartAppGraph(graph));

        yield* Effect.sync(() => {
          expect(roundTrip).toEqual(graph);
        });
      })
    );
  });

  it("describes app graph topology for devtools and build diagnostics", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();

        yield* Effect.sync(() => {
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
        });

        const description = yield* describeStartAppGraphEffect(graph);
        yield* Effect.sync(() => {
          expect(description).toEqual(describeStartAppGraph(graph));
        });
      })
    );
  });

  it("validates required wire schema coverage with typed failures", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();

        yield* validateStartAppGraphWireSchemasEffect(graph);

        const exit = yield* Effect.exit(
          validateStartAppGraphWireSchemasEffect(graph, { requireError: true })
        );

        yield* Effect.sync(() => {
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
      })
    );
  });

  it("can require action behavior metadata for build diagnostics", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect({
          actionBehavior: "unknown"
        });

        const exit = yield* Effect.exit(
          validateStartAppGraphActionBehaviorEffect(graph)
        );

        yield* Effect.sync(() => {
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
      })
    );
  });

  it("can require declared preload resources for route-module diagnostics", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
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

        const exit = yield* Effect.exit(
          validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect(
            withUnknownPreloadResources
          )
        );

        yield* Effect.sync(() => {
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
        });

        yield* validateStartAppGraphDiagnosticsPolicyEffect(declaredDiagnostics, {
          routePreloadResources: {
            requireDeclaredForPreload: true
          }
        });
      })
    );
  });

  it("can require declared preload collections for route-module diagnostics", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
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

        const exit = yield* Effect.exit(
          validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect(
            withUnknownPreloadCollections
          )
        );

        yield* Effect.sync(() => {
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
        });

        yield* validateStartAppGraphDiagnosticsPolicyEffect(declaredDiagnostics, {
          routePreloadCollections: {
            requireDeclaredForPreload: true
          }
        });
      })
    );
  });

  it("assembles runtime diagnostics from route module candidates", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {
          routeModules: graph.routes.entries.map((entry) => ({
            entry,
            route: entry.routePath === "/"
              ? {
                  options: {
                    params: {},
                    preload: () => undefined
                  }
                }
              : {
                  options: {}
                },
            preloadResources: entry.routePath === "/"
              ? {
                  status: "declared" as const,
                  families: ["Project.byId"]
                }
              : {
                  status: "none" as const,
                  families: []
                },
            preloadCollections: entry.routePath === "/"
              ? {
                  status: "unknown" as const,
                  collections: []
                }
              : {
                  status: "none" as const,
                  collections: []
                }
          }))
        });

        yield* Effect.sync(() => {
          expect(diagnostics.routeModules[0]).toMatchObject({
            routePath: "/",
            paramsSchema: "present",
            searchSchema: "absent",
            preload: "present",
            preloadResources: {
              status: "declared",
              families: ["Project.byId"]
            },
            preloadCollections: {
              status: "unknown"
            },
            component: "absent"
          });
          expect(diagnostics.unknownRoutePreloadResources).toEqual([]);
          expect(diagnostics.unknownRoutePreloadCollections).toEqual([
            expect.objectContaining({
              routePath: "/",
              preload: "present"
            })
          ]);
          expect(() =>
            enforceStartAppGraphDiagnosticsPolicy(diagnostics, {
              routePreloadCollections: {
                requireDeclaredForPreload: true
              }
            })
          ).toThrowError(
            "Effect UI app graph diagnostics policy failed: Routes with preload must declare preloadCollections. / (src/routes/index.tsx)"
          );

          try {
            enforceStartAppGraphDiagnosticsPolicy(diagnostics, {
              routePreloadCollections: {
                requireDeclaredForPreload: true
              }
            });
          } catch (error) {
            expect(error).toMatchObject({
              name: "StartAppGraphDiagnosticsPolicyError",
              diagnostics,
              violations: [
                expect.objectContaining({
                  _tag: "UnknownRoutePreloadCollections"
                })
              ]
            });
          }
        });
      })
    );
  });

  it("rejects malformed graph payloads before tooling consumes them", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const invalidJson = yield* Effect.exit(
          deserializeStartAppGraph("{not-json")
        );
        const invalidVersion = yield* Effect.exit(
          deserializeStartAppGraph(JSON.stringify({ version: 2 }))
        );

        yield* Effect.sync(() => {
          expect(firstFailure(invalidJson)).toBeInstanceOf(StartAppGraphParseError);
          expect(firstFailure(invalidVersion)).toBeInstanceOf(StartAppGraphParseError);
        });
      })
    );
  });

  it("revalidates nested manifests while deserializing the graph", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const corrupted = JSON.parse(serializeStartAppGraph(graph)) as {
          readonly routes: {
            readonly entries: Array<{ routeId: string }>;
          };
        };
        corrupted.routes.entries[0].routeId = "route_wrong";

        const exit = yield* Effect.exit(
          deserializeStartAppGraph(JSON.stringify(corrupted))
        );

        yield* Effect.sync(() => {
          expect(firstFailure(exit)).toBeInstanceOf(FileRouteManifestParseError);
        });
      })
    );
  });

  it("revalidates nested route modules while deserializing the graph", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const corrupted = JSON.parse(serializeStartAppGraph(graph)) as {
          readonly routes: {
            readonly modules: Array<{ routePath: string }>;
          };
        };
        const routeModule = corrupted.routes.modules.find((module) => module.routePath === "/projects/:id");

        if (!routeModule) {
          throw new Error("Expected generated route module.");
        }

        routeModule.routePath = "/projects/wrong";

        const exit = yield* Effect.exit(
          deserializeStartAppGraph(JSON.stringify(corrupted))
        );

        yield* Effect.sync(() => {
          expect(firstFailure(exit)).toBeInstanceOf(FileRouteManifestParseError);
        });
      })
    );
  });
});

const makeGraphEffect = (
  options: { readonly actionBehavior?: "known" | "unknown" } = {}
): Effect.Effect<ReturnType<typeof createStartAppGraph>, never, never> =>
  Effect.gen(function* () {
    const routes = generateFileRouteManifestArtifact(
      [
        "src/routes/projects/$id.tsx",
        "src/routes/index.tsx"
      ],
      { routeDirectory: "src/routes" }
    );
    const serverFunctions = yield* makeServerFunctionManifest([
      {
        name: "Project.load",
        module: "/src/project/project.server.ts",
        exportName: "loadProject",
        clientModule: "/src/project/project.contract.ts",
        clientExportName: "loadProject",
        inputSchema: true,
        outputSchema: true
      }
    ]);
    const actions = yield* makeActionManifest([
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
    ]);

    return createStartAppGraph({
      routes,
      serverFunctions,
      actions
    });
  });

const firstFailure = <E>(exit: Exit.Exit<unknown, E>): E | undefined => {
  if (!Exit.isFailure(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};
