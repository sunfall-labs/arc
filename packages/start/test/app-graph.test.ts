import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  createStartAppGraph,
  collectStartAppGraphDiagnosticsPolicyViolations,
  decodeStartAppGraphDiagnosticsDtoEffect,
  deserializeStartAppGraph,
  describeStartAppGraphRuntimeDiagnostics,
  describeStartAppGraph,
  describeStartAppGraphEffect,
  enforceStartAppGraphDiagnosticsPolicy,
  serializeStartAppGraph,
  StartAppGraphDiagnosticsDtoError,
  StartAppGraphDiagnosticsPolicyException,
  StartAppGraphMissingWireSchemas,
  StartAppGraphParseError,
  StartAppGraphUnknownActionBehavior,
  StartAppGraphUnknownRoutePreloadCollections,
  StartAppGraphUnknownRoutePreloadResources,
  unknownRoutePreloadCollectionsForDiagnostics,
  unknownRoutePreloadResourcesForDiagnostics,
  validateStartAppGraphActionBehaviorEffect,
  validateStartAppGraphDiagnosticsPolicyExceptionEffect,
  validateStartAppGraphDiagnosticsPolicyEffect,
  validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect,
  validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect,
  validateStartAppGraphWireSchemasEffect
} from "../src/app-graph.js";
import {
  createStartAgentGraphImpact,
  createStartAgentGraph,
  formatStartAgentGraph,
  formatStartAgentGraphImpact,
  queryStartAgentGraph,
  queryStartAgentGraphEffect
} from "../src/agent-graph.js";
import type {
  StartAgentGraph,
  StartAgentGraphNodeKind,
  StartAgentGraphQueryKind
} from "../src/start-agent-graph-contract.js";
import {
  startAgentGraphQueryKinds
} from "../src/start-agent-graph-vocabulary.js";
import { startDiagnosticsCliVerifyCommandsForQuery } from "../src/start-diagnostics-cli-contract.js";
import { makeActionManifest } from "../src/action-manifest.js";
import { FileRouteManifestParseError, generateFileRouteManifestArtifact } from "../src/file-routes.js";
import { makeServerFunctionManifest } from "../src/server-function-manifest.js";
import { StartTransportEndpointConflictError } from "../src/start-transport-endpoints.js";

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

  it("validates diagnostics DTOs and policy violations through the shared Effect decoder", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const diagnostics = describeStartAppGraph(graph);
        const decoded = yield* decodeStartAppGraphDiagnosticsDtoEffect({
          diagnostics,
          diagnosticsPolicyViolations: []
        });
        const invalidDiagnosticsExit = yield* Effect.exit(
          decodeStartAppGraphDiagnosticsDtoEffect({
            diagnostics: {
              ...diagnostics,
              routeModules: [{}]
            },
            diagnosticsPolicyViolations: []
          })
        );
        const invalidRegistryExits = yield* Effect.all([
          Effect.exit(
            decodeStartAppGraphDiagnosticsDtoEffect({
              diagnostics: {
                ...diagnostics,
                resourceFamilies: [
                  {
                    name: "Project.Resource",
                    inputSchema: true
                  }
                ]
              },
              diagnosticsPolicyViolations: []
            })
          ),
          Effect.exit(
            decodeStartAppGraphDiagnosticsDtoEffect({
              diagnostics: {
                ...diagnostics,
                resourceTags: [
                  {
                    name: "Project.Tag",
                    keyed: "yes"
                  }
                ]
              },
              diagnosticsPolicyViolations: []
            })
          ),
          Effect.exit(
            decodeStartAppGraphDiagnosticsDtoEffect({
              diagnostics: {
                ...diagnostics,
                collectionDefinitions: [
                  {
                    name: "Projects",
                    inputSchema: true,
                    outputSchema: true,
                    initialData: false,
                    indexes: [],
                    load: true,
                    handlers: {
                      insert: false,
                      update: false,
                      delete: false
                    },
                    policy: {
                      retry: false
                    }
                  }
                ]
              },
              diagnosticsPolicyViolations: []
            })
          )
        ]);
        const invalidPolicyExit = yield* Effect.exit(
          decodeStartAppGraphDiagnosticsDtoEffect({
            diagnostics,
            diagnosticsPolicyViolations: [
              {
                _tag: "UnknownRoutePreloadResources",
                message: "Routes with preload must declare preloadResources.",
                routes: [{}]
              }
            ]
          })
        );
        const invalidEndpointExit = yield* Effect.exit(
          decodeStartAppGraphDiagnosticsDtoEffect({
            diagnostics: {
              ...diagnostics,
              rpcPath: "/same",
              actionPath: "/same"
            },
            diagnosticsPolicyViolations: []
          })
        );
        const invalidEnumExits = yield* Effect.all([
          Effect.exit(
            decodeStartAppGraphDiagnosticsDtoEffect({
              diagnostics: {
                ...diagnostics,
                routeModules: [
                  {
                    ...diagnostics.routeModules[0]!,
                    preloadResources: {
                      status: "maybe",
                      families: []
                    }
                  }
                ]
              },
              diagnosticsPolicyViolations: []
            })
          ),
          Effect.exit(
            decodeStartAppGraphDiagnosticsDtoEffect({
              diagnostics: {
                ...diagnostics,
                routeModules: [
                  {
                    ...diagnostics.routeModules[0]!,
                    preloadCollections: {
                      status: "maybe",
                      collections: []
                    }
                  }
                ]
              },
              diagnosticsPolicyViolations: []
            })
          ),
          Effect.exit(
            decodeStartAppGraphDiagnosticsDtoEffect({
              diagnostics: {
                ...diagnostics,
                actionModules: [
                  {
                    ...diagnostics.actionModules[0]!,
                    behavior: {
                      invalidates: "maybe",
                      optimistic: "unknown",
                      retry: "unknown",
                      concurrency: "unknown"
                    }
                  }
                ]
              },
              diagnosticsPolicyViolations: []
            })
          ),
          Effect.exit(
            decodeStartAppGraphDiagnosticsDtoEffect({
              diagnostics: {
                ...diagnostics,
                unknownActionBehavior: [
                  {
                    kind: "action",
                    name: "Project.rename",
                    invalidates: "unknown",
                    optimistic: "unknown",
                    retry: "unknown",
                    concurrency: "maybe"
                  }
                ]
              },
              diagnosticsPolicyViolations: []
            })
          )
        ]);

        yield* Effect.sync(() => {
          expect(decoded).toEqual({
            diagnostics,
            diagnosticsPolicyViolations: []
          });
          expect(firstFailure(invalidDiagnosticsExit)).toBeInstanceOf(
            StartAppGraphDiagnosticsDtoError
          );
          for (const exit of invalidRegistryExits) {
            expect(firstFailure(exit)).toBeInstanceOf(
              StartAppGraphDiagnosticsDtoError
            );
          }
          expect(firstFailure(invalidPolicyExit)).toBeInstanceOf(
            StartAppGraphDiagnosticsDtoError
          );
          expect(firstFailure(invalidEndpointExit)).toBeInstanceOf(
            StartAppGraphDiagnosticsDtoError
          );
          for (const exit of invalidEnumExits) {
            expect(firstFailure(exit)).toBeInstanceOf(
              StartAppGraphDiagnosticsDtoError
            );
          }
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

        const policyExit = yield* Effect.exit(
          validateStartAppGraphDiagnosticsPolicyExceptionEffect(withUnknownPreloadResources, {
            routePreloadResources: {
              requireDeclaredForPreload: true
            }
          })
        );
        const failure = firstFailure(policyExit);
        expect(failure).toMatchObject({
          name: "StartAppGraphDiagnosticsPolicyError",
          diagnostics: withUnknownPreloadResources,
          violations: [
            expect.objectContaining({
              _tag: "UnknownRoutePreloadResources"
            })
          ]
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

  it("allows diagnostics preload policy to be disabled at each policy seam", () => {
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
                },
                preloadCollections: {
                  status: "unknown" as const,
                  collections: []
                }
              }
            : routeModule
        );
        const withUnknownPreloads = {
          ...diagnostics,
          routeModules,
          unknownRoutePreloadResources: unknownRoutePreloadResourcesForDiagnostics({
            routeModules
          }),
          unknownRoutePreloadCollections: unknownRoutePreloadCollectionsForDiagnostics({
            routeModules
          })
        };

        expect(withUnknownPreloads.unknownRoutePreloadResources).toHaveLength(1);
        expect(withUnknownPreloads.unknownRoutePreloadCollections).toHaveLength(1);
        expect(collectStartAppGraphDiagnosticsPolicyViolations(
          withUnknownPreloads,
          false
        )).toEqual([]);
        expect(collectStartAppGraphDiagnosticsPolicyViolations(
          withUnknownPreloads,
          null
        )).toEqual([]);
        expect(collectStartAppGraphDiagnosticsPolicyViolations(
          withUnknownPreloads,
          {
            routePreloadResources: false,
            routePreloadCollections: false
          }
        )).toEqual([]);
        expect(collectStartAppGraphDiagnosticsPolicyViolations(
          withUnknownPreloads,
          {
            routePreloadResources: {
              requireDeclaredForPreload: false
            },
            routePreloadCollections: {
              requireDeclaredForPreload: false
            }
          }
        )).toEqual([]);
        yield* validateStartAppGraphDiagnosticsPolicyExceptionEffect(
          withUnknownPreloads,
          false
        );
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
            expect(error).toBeInstanceOf(StartAppGraphDiagnosticsPolicyException);
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

  it("merges runtime route candidates without dropping static manifest routes", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const projectEntry = graph.routes.entries.find((entry) =>
          entry.routePath === "/projects/:id"
        );

        if (projectEntry === undefined) {
          throw new Error("Expected project route entry.");
        }

        const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {
          routeModules: [
            {
              entry: projectEntry,
              route: {
                options: {
                  params: {},
                  preload: () => undefined,
                  component: () => null
                }
              },
              preloadResources: {
                status: "declared" as const,
                families: ["Project.byId"]
              },
              preloadCollections: {
                status: "none" as const,
                collections: []
              }
            }
          ]
        });

        yield* Effect.sync(() => {
          expect(diagnostics.routeModules).toHaveLength(2);
          expect(diagnostics.routeModules.map((routeModule) => routeModule.routePath)).toEqual([
            "/",
            "/projects/:id"
          ]);
          expect(diagnostics.routeModules.find((routeModule) => routeModule.routePath === "/")).toMatchObject({
            routePath: "/",
            paramsSchema: "unknown",
            preload: "unknown",
            preloadResources: {
              status: "unknown"
            }
          });
          expect(diagnostics.routeModules.find((routeModule) => routeModule.routePath === "/projects/:id")).toMatchObject({
            routePath: "/projects/:id",
            paramsSchema: "present",
            preload: "present",
            preloadResources: {
              status: "declared",
              families: ["Project.byId"]
            },
            component: "present"
          });
        });
      })
    );
  });

  it("projects resolved diagnostics into an agent-readable semantic graph", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const projectEntry = graph.routes.entries.find((entry) =>
          entry.routePath === "/projects/:id"
        );

        if (projectEntry === undefined) {
          throw new Error("Expected project route entry.");
        }

        const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {
          routeModules: [
            {
              entry: projectEntry,
              route: {
                options: {
                  params: {},
                  preload: () => undefined,
                  component: () => null
                }
              },
              preloadResources: {
                status: "declared" as const,
                families: ["Project.byId"]
              },
              preloadCollections: {
                status: "declared" as const,
                collections: ["ProjectRows"]
              }
            }
          ]
        });
        const agentGraph = createStartAgentGraph({ graph, diagnostics });
        const projectRoute = queryStartAgentGraph(agentGraph, {
          kind: "route",
          text: "/projects/:id"
        });
        const renameAction = queryStartAgentGraph(agentGraph, {
          kind: "action",
          text: "Project.rename"
        });

        yield* Effect.sync(() => {
          expect(agentGraph.selfReview).toMatchObject({
            status: "needs-attention",
            policyClean: true,
            routePreloadsDeclared: true
          });
          expect(projectRoute.nodes).toEqual([
            expect.objectContaining({
              id: "route:route_projects_$id",
              kind: "Route",
              status: "known"
            })
          ]);
          expect(projectRoute.edges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: "PreloadsResourceFamily",
                to: "resource-family:Project.byId"
              }),
              expect.objectContaining({
                kind: "PreloadsCollection",
                to: "collection:ProjectRows"
              })
            ])
          );
          expect(renameAction.nodes).toEqual([
            expect.objectContaining({
              id: "action:Project.rename",
              kind: "Action",
              status: "needs-attention"
            })
          ]);
        });
      })
    );
  });

  it("queries agent graph nodes whose facts contain BigInt and circular values", async () => {
    const circularFacts: Record<string, unknown> = {
      reason: "cycle"
    };
    circularFacts.self = circularFacts;

    const graph: StartAgentGraph = {
      version: 1,
      summary: {
        nodes: 2,
        edges: 0,
        routes: 1,
        serverFunctions: 0,
        actions: 1,
        resourceFamilies: 0,
        resourceTags: 0,
        collections: 0,
        findings: 0
      },
      selfReview: {
        status: "pass",
        policyClean: true,
        wireComplete: true,
        actionBehaviorKnown: true,
        routePreloadsDeclared: true,
        findingCount: 0
      },
      nodes: [
        {
          id: "action:Project.bigint",
          kind: "Action",
          label: "Project.bigint",
          status: "known",
          owner: "src/project/actions.ts",
          facts: {
            submittedAt: 1n
          }
        },
        {
          id: "route:route_circular",
          kind: "Route",
          label: "Circular Route",
          status: "known",
          owner: "src/routes/circular.tsx",
          facts: circularFacts
        }
      ],
      edges: [],
      findings: []
    };

    const byId = queryStartAgentGraph(graph, {
      text: "action:Project.bigint"
    });
    const byOwner = queryStartAgentGraph(graph, {
      text: "src/project/actions.ts"
    });
    const byLabel = await Effect.runPromise(
      queryStartAgentGraphEffect(graph, {
        text: "Circular Route"
      })
    );

    expect(byId.nodes.map((node) => node.id)).toEqual(["action:Project.bigint"]);
    expect(byOwner.nodes.map((node) => node.owner)).toEqual(["src/project/actions.ts"]);
    expect(byLabel.nodes.map((node) => node.label)).toEqual(["Circular Route"]);
    expect(formatStartAgentGraph(graph, { verbose: true })).toContain("submittedAt: 1");
    expect(formatStartAgentGraph(graph, { verbose: true })).toContain("[Circular]");
  });

  it("queries and formats agent graph nodes with hostile fact objects", () => {
    const hostileFacts: Record<string, unknown> = {
      safe: "hostile"
    };
    Object.defineProperty(hostileFacts, "boom", {
      enumerable: true,
      get() {
        throw new Error("fact boom");
      }
    });
    Object.defineProperty(hostileFacts, Symbol.toStringTag, {
      get() {
        throw new Error("tag boom");
      }
    });

    const graph: StartAgentGraph = {
      version: 1,
      summary: {
        nodes: 1,
        edges: 0,
        routes: 1,
        serverFunctions: 0,
        actions: 0,
        resourceFamilies: 0,
        resourceTags: 0,
        collections: 0,
        findings: 0
      },
      selfReview: {
        status: "pass",
        policyClean: true,
        wireComplete: true,
        actionBehaviorKnown: true,
        routePreloadsDeclared: true,
        findingCount: 0
      },
      nodes: [
        {
          id: "route:route_hostile",
          kind: "Route",
          label: "Hostile Route",
          status: "known",
          owner: "src/routes/hostile.tsx",
          facts: hostileFacts
        }
      ],
      edges: [],
      findings: []
    };

    const byLabel = queryStartAgentGraph(graph, {
      text: "Hostile Route"
    });
    const verbose = formatStartAgentGraph(graph, { verbose: true });

    expect(byLabel.nodes.map((node) => node.id)).toEqual(["route:route_hostile"]);
    expect(verbose).toContain("safe: hostile");
    expect(verbose).toContain("boom: [Uninspectable]");
  });

  it("derives a concise edit impact brief from the semantic graph", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const projectEntry = graph.routes.entries.find((entry) =>
          entry.routePath === "/projects/:id"
        );

        if (projectEntry === undefined) {
          throw new Error("Expected project route entry.");
        }

        const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {
          routeModules: [
            {
              entry: projectEntry,
              route: {
                options: {
                  params: {},
                  preload: () => undefined,
                  component: () => null
                }
              },
              preloadResources: {
                status: "declared" as const,
                families: ["Project.byId"]
              },
              preloadCollections: {
                status: "declared" as const,
                collections: ["ProjectRows"]
              }
            }
          ]
        });
        const agentGraph = createStartAgentGraph({ graph, diagnostics });
        const impact = createStartAgentGraphImpact(
          agentGraph,
          { kind: "route", text: "/projects/:id" },
          { root: "examples/project-console" }
        );
        const text = formatStartAgentGraphImpact(impact);

        yield* Effect.sync(() => {
          expect(impact.matches).toBe(1);
          expect(impact.items[0]).toMatchObject({
            editTarget: "src/routes/projects/$id.tsx",
            contracts: expect.arrayContaining([
              "params: id",
              "preloads: resources Project.byId; collections ProjectRows"
            ]),
            dependencies: expect.arrayContaining([
              expect.objectContaining({
                kind: "resource",
                label: "Project.byId",
                reason: "preloaded resource"
              }),
              expect.objectContaining({
                kind: "collection",
                label: "ProjectRows",
                reason: "preloaded collection"
              })
            ]),
            verify: [
              "effect-ui-start diagnostics --root=examples/project-console",
              "effect-ui-start graph --root=examples/project-console route /projects/:id"
            ]
          });
          expect(text).toContain("Impact: route /projects/:id");
          expect(text).toContain("Contracts");
          expect(text).toContain("- preloads: resources Project.byId; collections ProjectRows");
          expect(text).toContain("Depends on");
          expect(text).toContain("- effect-ui-start diagnostics --root=examples/project-console");
          expect(text).not.toContain("route:route_projects_$id");
        });
      })
    );
  });

  it("pins Start agent graph query vocabulary to node filtering and impact commands", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const graph = yield* makeGraphEffect();
        const projectEntry = graph.routes.entries.find((entry) =>
          entry.routePath === "/projects/:id"
        );

        if (projectEntry === undefined) {
          throw new Error("Expected project route entry.");
        }

        const diagnostics = describeStartAppGraphRuntimeDiagnostics(graph, {
          routeModules: [
            {
              entry: projectEntry,
              route: {
                options: {
                  params: {},
                  preload: () => undefined,
                  component: () => null
                }
              },
              preloadResources: {
                status: "declared" as const,
                families: ["Project.byId"]
              },
              preloadCollections: {
                status: "declared" as const,
                collections: ["ProjectRows"]
              }
            }
          ],
          resourceFamilies: [
            {
              name: "Project.byId",
              inputSchema: true,
              outputSchema: true,
              errorSchema: false,
              providesTags: true,
              policy: {
                retry: false
              }
            }
          ],
          resourceTags: [
            {
              name: "Project.updated",
              keyed: true
            }
          ],
          collectionDefinitions: [
            {
              name: "ProjectRows",
              inputSchema: false,
              outputSchema: false,
              initialData: false,
              indexes: [],
              load: false,
              handlers: {
                insert: false,
                update: false,
                delete: false
              },
              policy: {
                retry: false
              },
              persistence: {
                enabled: false,
                hydrate: false,
                restoreOnPreload: false,
                loadAfterRestore: false,
                persistOnLoad: false,
                persistOnMutation: false,
                persistOnWrite: false
              }
            }
          ]
        });
        const agentGraph = createStartAgentGraph({ graph, diagnostics });
        const expectedNodeKind = {
          action: "Action",
          collection: "Collection",
          endpoint: "Endpoint",
          finding: "Finding",
          module: "Module",
          node: undefined,
          resource: "ResourceFamily",
          "resource-tag": "ResourceTag",
          route: "Route",
          "server-function": "ServerFunction"
        } satisfies Record<StartAgentGraphQueryKind, StartAgentGraphNodeKind | undefined>;
        const queryText = {
          action: "Project.rename",
          collection: "ProjectRows",
          endpoint: "rpc",
          finding: "wire-schema",
          module: "project.server",
          node: "Project",
          resource: "Project.byId",
          "resource-tag": "Project.updated",
          route: "/projects/:id",
          "server-function": "Project.load"
        } satisfies Record<StartAgentGraphQueryKind, string>;
        const root = "examples/project-console";

        yield* Effect.sync(() => {
          expect(new Set(startAgentGraphQueryKinds)).toEqual(
            new Set(Object.keys(expectedNodeKind))
          );

          for (const kind of startAgentGraphQueryKinds) {
            const query = { kind, text: queryText[kind] };
            const result = queryStartAgentGraph(agentGraph, query);
            const impact = createStartAgentGraphImpact(agentGraph, query, { root });
            const expected = expectedNodeKind[kind];

            expect(result.nodes.length).toBeGreaterThan(0);
            expect(impact.matches).toBe(result.nodes.length);
            expect(impact.items[0]?.verify).toEqual(
              startDiagnosticsCliVerifyCommandsForQuery(query, { root })
            );
            if (expected === undefined) {
              expect(new Set(result.nodes.map((node) => node.kind)).size).toBeGreaterThan(1);
            } else {
              expect(result.nodes.every((node) => node.kind === expected)).toBe(true);
            }
          }
        });
      })
    );
  });

  it("shares shell-safe Start CLI verify commands with impact reports", () => {
    expect(startDiagnosticsCliVerifyCommandsForQuery(
      { kind: "route", text: "/project spaces/:id" },
      { root: "examples/project console" }
    )).toEqual([
      "effect-ui-start diagnostics --root='examples/project console'",
      "effect-ui-start graph --root='examples/project console' route '/project spaces/:id'"
    ]);
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

  it("rejects app graphs whose RPC and action endpoints collide", () => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const routes = generateFileRouteManifestArtifact([], {
          routeDirectory: "src/routes"
        });
        const serverFunctions = yield* makeServerFunctionManifest([], {
          rpcPath: "/same"
        });
        const actions = yield* makeActionManifest([], {
          actionPath: "/same"
        });
        const serialized = JSON.stringify({
          version: 1,
          routes,
          serverFunctions,
          actions
        });
        const deserialized = yield* Effect.exit(deserializeStartAppGraph(serialized));

        yield* Effect.sync(() => {
          expect(() =>
            createStartAppGraph({
              routes,
              serverFunctions,
              actions
            })
          ).toThrow(StartTransportEndpointConflictError);
          expect(firstFailure(deserialized)).toBeInstanceOf(StartTransportEndpointConflictError);
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
