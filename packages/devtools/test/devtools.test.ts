import { Effect, PubSub, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Action, makeRuntime, read as readSignal, Resource, route, Route, Signal, type ActionState } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import {
  DevtoolsActionInvalidationPlanConflict,
  DevtoolsUnknownInvalidationTarget,
  devtoolsPanelStyles,
  makeDevtoolsStore,
  describeDevtoolsCausalGraph,
  describeDevtoolsCausalGraphEffect,
  describeDevtoolsSummary,
  describeDevtoolsSummaryEffect,
  describeDevtoolsPanels,
  describeDevtoolsPanelsEffect,
  describeInvalidationPlan,
  describeRoutePlan,
  effectUiDevtoolsBridgeGlobal,
  installDevtoolsBridge,
  installDevtoolsBridgeEffect,
  renderDevtoolsPanelsHtml,
  renderDevtoolsPanelsHtmlEffect,
  toDevtoolsSerializableValue,
  type DevtoolsBridgeTarget,
  type DevtoolsInvalidationPlan,
  type DevtoolsRequestTrace,
  type DevtoolsStartAppGraphDiagnostics
} from "../src/index.js";

describe("devtools invalidation plans", () => {
  it("rejects invalidation inputs with typed errors", () => {
    expect(() =>
      describeInvalidationPlan({
        // @ts-expect-error invalid target shape is rejected at runtime
        targets: [{}],
        entries: []
      })
    ).toThrow(DevtoolsUnknownInvalidationTarget);

    const Tag = Resource.tag("Devtools.error-tag");
    const store = makeDevtoolsStore();
    const serialized: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Devtools.error-tag",
          name: "Devtools.error-tag"
        }
      ],
      entries: []
    };

    expect(() =>
      store.recordActionState(
        "Devtools.conflict",
        "Pending",
        // @ts-expect-error conflicting invalidation inputs are rejected at runtime
        {
          invalidationPlan: Resource.planInvalidation(Tag),
          serializedInvalidationPlan: serialized
        }
      )
    ).toThrow(DevtoolsActionInvalidationPlanConflict);
  });

  it("serializes resource invalidation plans without live refs", async () => {
    const UserTag = Resource.tag<{ readonly id: string }>("User.devtools", {
      key: ({ id }) => id
    });
    const User = Resource.family({
      name: "User.devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (user) => [UserTag({ id: user.id })]
    });
    const ref = User("1");

    await Resource.prefetch(ref);

    expect(describeInvalidationPlan(Resource.planInvalidation(UserTag({ id: "1" })))).toEqual({
      targets: [
        {
          _tag: "Tag",
          key: "User.devtools:1",
          name: "User.devtools"
        }
      ],
      entries: [
        {
          ref: {
            key: ref.key,
            family: "User.devtools",
            input: "1"
          },
          causes: [
            {
              _tag: "Tag",
              key: "User.devtools:1",
              name: "User.devtools"
            }
          ]
        }
      ]
    });
  });

  it("keeps a bounded invalidation history", () => {
    const FirstTag = Resource.tag("First.devtools");
    const SecondTag = Resource.tag("Second.devtools");
    const store = makeDevtoolsStore({ invalidationLimit: 1 });

    store.recordInvalidation(Resource.planInvalidation(FirstTag));
    store.recordInvalidation(Resource.planInvalidation(SecondTag));

    expect(store.getSnapshot().invalidations).toEqual([
      {
        targets: [
          {
            _tag: "Tag",
            key: "Second.devtools",
            name: "Second.devtools"
          }
        ],
        entries: []
      }
    ]);
  });

  it("records serialized action invalidation plans from full-stack transports", async () => {
    const plan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Project.start:atlas",
          name: "Project.start"
        }
      ],
      entries: [
        {
          ref: {
            key: "Project.byId:atlas",
            family: "Project.byId",
            input: { id: "atlas" }
          },
          causes: [
            {
              _tag: "Tag",
              key: "Project.start:atlas",
              name: "Project.start"
            }
          ]
        }
      ]
    };
    const store = makeDevtoolsStore();

    await Effect.runPromise(
      store.recordActionStateEffect("Project.rename", "Success", {
        input: { id: "atlas" },
        serializedInvalidationPlan: plan
      })
    );

    const snapshot = store.getSnapshot();

    expect(snapshot.invalidations).toEqual([plan]);
    expect(snapshot.actions).toEqual([
      {
        name: "Project.rename",
        state: "Success",
        invalidationIndexes: [0]
      }
    ]);
    expect(snapshot.events).toEqual([
      {
        _tag: "ActionState",
        sequence: 0,
        action: "Project.rename",
        state: "Success",
        input: { id: "atlas" },
        invalidationIndexes: [0]
      }
    ]);
    expect(store.getCausalGraph().edges).toContainEqual(
      expect.objectContaining({
        kind: "Emits",
        source: "action:Project.rename",
        target: "invalidation:0"
      })
    );
  });

  it("tracks Start-shaped action instances without depending on the start package", async () => {
    const plan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "Project.byId:atlas",
          family: "Project.byId",
          input: { id: "atlas" }
        }
      ],
      entries: [
        {
          ref: {
            key: "Project.byId:atlas",
            family: "Project.byId",
            input: { id: "atlas" }
          },
          causes: [
            {
              _tag: "Ref",
              key: "Project.byId:atlas",
              family: "Project.byId"
            }
          ]
        }
      ]
    };
    const state = Signal.make<ActionState<{ readonly id: string }, unknown, unknown>>({ _tag: "Idle" });
    const invalidation = Signal.make<DevtoolsInvalidationPlan | undefined>(undefined);
    const store = makeDevtoolsStore();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* store.trackStartActionEffect({
            definition: {
              name: "Project.rename"
            },
            state,
            invalidation
          });

          state.set({
            _tag: "Pending",
            input: { id: "atlas" }
          });
          invalidation.set(plan);
          state.set({
            _tag: "Success",
            input: { id: "atlas" },
            value: {
              _tag: "Success"
            }
          });
        })
      )
    );

    expect(store.getSnapshot().actions).toEqual([
      {
        name: "Project.rename",
        state: "Success",
        invalidationIndexes: [0]
      }
    ]);
    expect(store.getSnapshot().invalidations).toEqual([plan]);
    expect(store.getSnapshot().events?.map((event) => event._tag)).toEqual([
      "ActionState",
      "ActionState",
      "ActionState"
    ]);
  });

  it("tracks action instances as scoped runtime facts", async () => {
    let value = 0;
    const Count = Resource.family({
      name: "Count.action-devtools",
      load: () => Effect.succeed(value)
    });
    const ref = Count(undefined);
    const Increment = Action.define({
      name: "Count.increment-devtools",
      run: () =>
        Effect.sync(() => {
          value++;
          return value;
        }),
      invalidates: () => [ref]
    });
    const action = Action.use(Increment);
    const store = makeDevtoolsStore();

    await Resource.prefetch(ref);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* store.trackActionEffect(action);
          yield* action.submitEffect(undefined);
        })
      )
    );

    const snapshot = store.getSnapshot();
    expect(snapshot.actions).toEqual([
      {
        name: "Count.increment-devtools",
        state: "Success",
        invalidationIndexes: [0]
      }
    ]);
    expect(snapshot.invalidations).toHaveLength(1);
    expect(snapshot.invalidations[0]?.entries.map((entry) => entry.ref.key)).toEqual([ref.key]);
    expect(snapshot.events?.map((event) => event._tag)).toEqual([
      "ActionState",
      "ActionState",
      "ActionState"
    ]);
  });

  it("serializes route plans into plain data", async () => {
    const User = Resource.family({
      name: "User.route-devtools",
      load: (id: string) => Effect.succeed({ id })
    });
    const UserRoute = route("/users/:id", {
      preload: ({ params }) => Resource.prefetchEffect(User(params.id))
    });
    const plan = await Route.planNavigation([UserRoute] as const, "/users/1");

    expect(describeRoutePlan(plan)).toEqual({
      _tag: "Matched",
      href: "/users/1",
      match: {
        path: "/users/:id",
        href: "/users/1",
        params: { id: "1" },
        search: {}
      },
      resources: [
        {
          key: User("1").key,
          family: "User.route-devtools",
          input: "1"
        }
      ],
      hydration: {
        resourceCount: 1
      }
    });
  });

  it("combines app graph diagnostics and runtime plans into a panel summary", async () => {
    const UserTag = Resource.tag<{ readonly id: string }>("User.summary-devtools", {
      key: ({ id }) => id
    });
    const User = Resource.family({
      name: "User.summary-devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (user) => [UserTag({ id: user.id })]
    });
    const UserRoute = route("/users/:id", {
      preload: ({ params }) => Resource.prefetchEffect(User(params.id))
    });
    const ref = User("1");

    await Resource.prefetch(ref);

    const routePlan = describeRoutePlan(
      await Route.planNavigation([UserRoute] as const, "/users/1")
    );
    const invalidationPlan = describeInvalidationPlan(
      Resource.planInvalidation(UserTag({ id: "1" }))
    );
    const summary = describeDevtoolsSummary({
      appGraph: appGraphDiagnostics,
      snapshot: {
        resources: [
          {
            key: ref.key,
            state: "Success"
          }
        ],
        actions: [
          {
            name: "User.rename",
            state: "Success"
          }
        ],
        invalidations: [invalidationPlan],
        routePlans: [routePlan]
      }
    });

    expect(summary).toMatchObject({
      version: 1,
      overview: {
        routeCount: 1,
        serverFunctionCount: 1,
        actionCount: 1,
        runtimeResourceCount: 1,
        runtimeActionCount: 1,
        invalidationPlanCount: 1,
        routePlanCount: 1,
        missingSchemaCount: 1,
        unknownActionBehaviorCount: 0,
        unknownRoutePreloadResourcesCount: 0,
        unknownRoutePreloadCollectionsCount: 0,
        notFoundRoutePlanCount: 0
      },
      graph: {
        _tag: "Available",
        routes: {
          modules: [
            {
              routePath: "/users/:id",
              preloadResources: {
                status: "declared",
                families: ["User.summary-devtools"]
              }
            }
          ]
        },
        actions: {
          behavior: {
            invalidates: [{ state: "present", count: 1 }],
            optimistic: [{ state: "absent", count: 1 }],
            retry: [{ state: "present", count: 1 }],
            concurrency: [{ state: "latest", count: 1 }]
          }
        },
        endpoints: {
          rpc: "/__effect-ui/rpc",
          action: "/__effect-ui/action"
        },
        modules: {
          serverOnly: ["/src/user/user.server.ts"],
          browserClient: ["/src/user/user.actions.ts"]
        },
        resources: {
          familyCount: 1,
          tagCount: 1
        }
      },
      invalidations: {
        plans: [
          {
            index: 0,
            targetCount: 1,
            matchedResourceCount: 1,
            causeCount: 1
          }
        ]
      },
      routes: {
        plans: [
          {
            index: 0,
            _tag: "Matched",
            href: "/users/1",
            path: "/users/:id",
            params: {
              id: "1"
            },
            search: {},
            resourceCount: 1,
            hydrationResourceCount: 1
          }
        ],
        notFoundHrefs: []
      }
    });
    expect(summary.runtime.resourceStates).toEqual([{ state: "Success", count: 1 }]);
    expect(summary.runtime.actionStates).toEqual([{ state: "Success", count: 1 }]);
    expect(summary.resources).toEqual([
      {
        key: ref.key,
        family: "User.summary-devtools",
        input: "1",
        state: "Success",
        sources: ["Invalidation", "RoutePlan", "Snapshot"],
        routeHrefs: ["/users/1"],
        invalidationIndexes: [0]
      }
    ]);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    const panels = describeDevtoolsPanels({ summary });
    expect(panels.panels.map((panel) => panel.id)).toEqual([
      "app-graph",
      "routes",
      "resources",
      "actions",
      "collections",
      "requests",
      "diagnostics",
      "causal-graph"
    ]);
    expect(panels.version).toBe(1);
    expect(panels.panels.find((panel) => panel.id === "app-graph")).toMatchObject({
      title: "App Graph",
      severity: "error"
    });
    expect(panels.panels.find((panel) => panel.id === "routes")).toMatchObject({
      severity: "ok"
    });
    expect(panels.panels.find((panel) => panel.id === "resources")).toMatchObject({
      severity: "ok"
    });
    expect(panels.panels.find((panel) => panel.id === "diagnostics")).toMatchObject({
      severity: "error",
      items: [
        {
          id: "missing-schema:action:User.rename",
          severity: "error"
        }
      ]
    });
    expect(JSON.parse(JSON.stringify(panels))).toEqual(panels);
    await expect(
      Effect.runPromise(describeDevtoolsSummaryEffect({ appGraph: appGraphDiagnostics }))
    ).resolves.toMatchObject({
      graph: {
        _tag: "Available"
      }
    });
    await expect(
      Effect.runPromise(describeDevtoolsPanelsEffect({ summary }))
    ).resolves.toMatchObject({
      panels: expect.arrayContaining([
        expect.objectContaining({ id: "app-graph" })
      ])
    });
  });

  it("renders deterministic browser panel HTML from the panel contract", async () => {
    const requestTrace = (
      id: string,
      path: string,
      status: DevtoolsRequestTrace["status"]
    ): DevtoolsRequestTrace => ({
      request: {
        id,
        method: "GET",
        url: `https://example.test${path}`,
        path,
        transport: "rpc"
      },
      response: {
        status: status === "success" ? 200 : 500
      },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status,
      teardown: {
        runtimeDisposed: status !== "failure",
        durationMillis: status === "success" ? 12 : 34
      }
    });
    const panels = describeDevtoolsPanels({
      requestTraces: [
        requestTrace("safe", "/projects/<atlas>", "success"),
        requestTrace("failed", "/projects/failure", "failure")
      ]
    });
    const html = renderDevtoolsPanelsHtml({
      panels,
      title: "Ops <Devtools>",
      selectedPanelId: "requests",
      maxItemsPerPanel: 1
    });

    expect(devtoolsPanelStyles).toContain(".effect-ui-devtools");
    expect(html).toContain("Ops &lt;Devtools&gt;");
    expect(html).toContain("data-selected-panel=\"requests\"");
    expect(html).toContain("data-effect-ui-devtools-panel-target=\"requests\"");
    expect(html).toContain("GET /projects/&lt;atlas&gt;");
    expect(html).toContain("1 more items hidden by the current render limit.");
    expect(html).not.toContain("Ops <Devtools>");
    await expect(
      Effect.runPromise(renderDevtoolsPanelsHtmlEffect({
        panels,
        title: "Ops <Devtools>",
        selectedPanelId: "requests",
        maxItemsPerPanel: 1
      }))
    ).resolves.toEqual(html);
  });

  it("installs the inspected-window devtools bridge with scoped cleanup", async () => {
    const target: DevtoolsBridgeTarget = {};
    const panels = describeDevtoolsPanels();
    const install = installDevtoolsBridge({
      panels,
      selectedPanelId: "requests",
      title: "Bridge"
    }, target);

    expect(target[effectUiDevtoolsBridgeGlobal]).toMatchObject({
      panels,
      selectedPanelId: "requests",
      title: "Bridge"
    });
    install.uninstall();
    expect(target[effectUiDevtoolsBridgeGlobal]).toBeUndefined();

    target[effectUiDevtoolsBridgeGlobal] = () => ({
      panels,
      title: "Previous"
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* installDevtoolsBridgeEffect(() => ({
            panels,
            selectedPanelId: "resources"
          }), target);
          expect(
            typeof target[effectUiDevtoolsBridgeGlobal]
          ).toBe("function");
          expect(
            typeof target[effectUiDevtoolsBridgeGlobal] === "function"
              ? target[effectUiDevtoolsBridgeGlobal]()
              : undefined
          ).toMatchObject({
            panels,
            selectedPanelId: "resources"
          });
        })
      )
    );

    expect(
      typeof target[effectUiDevtoolsBridgeGlobal] === "function"
        ? target[effectUiDevtoolsBridgeGlobal]()
        : undefined
    ).toMatchObject({
      panels,
      title: "Previous"
    });
  });

  it("derives a deterministic causal graph from routes, resources, actions, schemas, and runtime events", async () => {
    const UserTag = Resource.tag<{ readonly id: string }>("User.causal-devtools", {
      key: ({ id }) => id
    });
    const User = Resource.family({
      name: "User.causal-devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (user) => [UserTag({ id: user.id })]
    });
    const UserRoute = route("/users/:id", {
      preload: ({ params }) => Resource.prefetchEffect(User(params.id))
    });
    const ref = User("1");

    await Resource.prefetch(ref);

    const routePlan = describeRoutePlan(
      await Route.planNavigation([UserRoute] as const, "/users/1")
    );
    const invalidationPlan = describeInvalidationPlan(
      Resource.planInvalidation(UserTag({ id: "1" }))
    );
    const summary = describeDevtoolsSummary({
      appGraph: appGraphDiagnostics,
      snapshot: {
        resources: [
          {
            key: ref.key,
            state: "Success"
          }
        ],
        actions: [
          {
            name: "User.rename",
            state: "Success",
            invalidationIndexes: [0]
          }
        ],
        invalidations: [invalidationPlan],
        routePlans: [routePlan],
        events: [
          {
            _tag: "ResourceStoreEvent",
            sequence: 0,
            event: {
              _tag: "ResourcePending",
              name: "User.causal-devtools",
              key: ref.key,
              force: false,
              previous: false
            }
          },
          {
            _tag: "ActionState",
            sequence: 1,
            action: "User.rename",
            state: "Success",
            input: { id: "1" },
            invalidationIndexes: [0]
          },
          {
            _tag: "Invalidation",
            sequence: 2,
            action: "User.rename",
            plan: invalidationPlan
          }
        ]
      }
    });
    const graph = summary.causalGraph;
    const nodeKinds = new Set(graph.nodes.map((node) => node.kind));
    const edgeKinds = new Set(graph.edges.map((edge) => edge.kind));

    expect(summary.overview).toMatchObject({
      runtimeEventCount: 3,
      causalNodeCount: graph.nodes.length,
      causalEdgeCount: graph.edges.length
    });
    expect(nodeKinds).toEqual(
      new Set([
        "Action",
        "Endpoint",
        "InvalidationPlan",
        "MissingSchema",
        "Module",
        "Resource",
        "ResourceFamily",
        "ResourceTag",
        "Route",
        "RoutePlan",
        "RuntimeEvent",
        "SchemaCoverage",
        "ServerFunction"
      ])
    );
    expect(edgeKinds).toEqual(
      new Set([
        "Causes",
        "Covers",
        "Emits",
        "Hydrates",
        "Invalidates",
        "Matches",
        "MissingSchema",
        "Observes",
        "Preloads",
        "Targets",
        "UsesEndpoint",
        "UsesModule"
      ])
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: `resource:${ref.key}`,
        kind: "Resource",
        label: "User.causal-devtools"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Emits",
        source: "action:User.rename",
        target: "invalidation:0"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Preloads",
        source: "route:/users/:id",
        target: "resource-family:User.summary-devtools"
      })
    );
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
    expect(describeDevtoolsCausalGraph({
      appGraph: appGraphDiagnostics,
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        events: []
      }
    })).toEqual(describeDevtoolsCausalGraph({
      appGraph: appGraphDiagnostics,
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        events: []
      }
    }));
    await expect(
      Effect.runPromise(describeDevtoolsCausalGraphEffect({ appGraph: appGraphDiagnostics }))
    ).resolves.toMatchObject({
      version: 1
    });
  });

  it("normalizes non-JSON values before they reach the summary", () => {
    const circular: Record<string, unknown> = {
      z: 1,
      a: undefined,
      nested: [Number.NaN, 1n, new Date("2026-05-13T12:00:00.000Z")]
    };
    circular.self = circular;

    expect(toDevtoolsSerializableValue(circular)).toEqual({
      a: {
        _tag: "Undefined"
      },
      nested: [
        {
          _tag: "NonFiniteNumber",
          value: "NaN"
        },
        {
          _tag: "BigInt",
          value: "1"
        },
        {
          _tag: "Date",
          value: "2026-05-13T12:00:00.000Z"
        }
      ],
      self: {
        _tag: "Circular"
      },
      z: 1
    });
  });

  it("lets the store expose graph-aware summaries", () => {
    const store = makeDevtoolsStore();

    store.setAppGraphDiagnostics(appGraphDiagnostics);

    expect(store.getSummary().overview).toMatchObject({
      routeCount: 1,
      serverFunctionCount: 1,
      actionCount: 1,
      missingSchemaCount: 1
    });
    expect(store.getSummary().graph).toMatchObject({
      _tag: "Available",
      routes: {
        paths: ["/users/:id"]
      }
    });

    store.clearAppGraphDiagnostics();

    expect(store.getSummary().graph).toEqual({
      _tag: "Unavailable"
    });
  });

  it("summarizes collection events and observes their collection target", () => {
    const store = makeDevtoolsStore();

    store.recordCollectionEvent({
      _tag: "CollectionHydrated",
      collection: "Projects.collection-devtools",
      count: 2,
      updatedAt: 1
    });

    const summary = store.getSummary();

    expect(store.getSnapshot().events).toEqual([
      {
        _tag: "CollectionStoreEvent",
        sequence: 0,
        event: {
          _tag: "CollectionHydrated",
          collection: "Projects.collection-devtools",
          count: 2,
          updatedAt: 1
        }
      }
    ]);
    expect(summary.runtime.events).toEqual([
      expect.objectContaining({
        _tag: "CollectionStoreEvent",
        sequence: 0,
        label: "CollectionHydrated",
        target: {
          kind: "Collection",
          id: "collection:Projects.collection-devtools"
        }
      })
    ]);
    expect(summary.causalGraph.nodes).toContainEqual(
      expect.objectContaining({
        id: "collection:Projects.collection-devtools",
        kind: "Collection",
        label: "Projects.collection-devtools"
      })
    );
    expect(summary.causalGraph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:CollectionStoreEvent",
        target: "collection:Projects.collection-devtools",
        data: {
          targetKind: "Collection"
        }
      })
    );
  });

  it("records structured request traces and links them into the causal graph", async () => {
    const store = makeDevtoolsStore();
    const trace: DevtoolsRequestTrace = {
      request: {
        id: "req-project-atlas",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        method: "GET",
        url: "https://example.test/projects/atlas?tab=activity",
        path: "/projects/atlas",
        transport: "rpc",
        headers: [
          { name: "accept", value: "application/json" },
          { name: "x-effect-ui-request-id", value: "req-project-atlas" }
        ],
        cookies: [
          { name: "session", value: "redacted" }
        ]
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: [
          { name: "content-type", value: "application/json" }
        ],
        setCookieCount: 1
      },
      services: ["Clock", "ProjectApi"],
      routePlan: {
        _tag: "Matched",
        href: "/projects/atlas?tab=activity",
        match: {
          path: "/projects/:id",
          href: "/projects/atlas?tab=activity",
          params: { id: "atlas" },
          search: { tab: "activity" }
        },
        resources: [
          {
            key: "Project.byId:atlas",
            family: "Project.byId",
            input: { id: "atlas" }
          }
        ],
        hydration: {
          resourceCount: 1
        }
      },
      resources: [
        {
          key: "Project.byId:atlas",
          family: "Project.byId",
          input: { id: "atlas" },
          state: "Success"
        }
      ],
      collections: [
        {
          name: "Project.collection",
          state: "Ready",
          eventCount: 2
        }
      ],
      serverFunctions: [
        {
          name: "Project.load",
          status: "success"
        }
      ],
      actions: [
        {
          name: "Project.rename",
          state: "Success",
          invalidationIndexes: [0]
        }
      ],
      fibers: [
        {
          name: "render",
          status: "done"
        }
      ],
      streams: [
        {
          name: "html",
          state: "closed",
          chunkCount: 3
        }
      ],
      status: "success",
      teardown: {
        runtimeDisposed: true,
        reason: "response-end",
        at: 123,
        startedAt: 100,
        completedAt: 123,
        durationMillis: 23,
        beforeDispose: {
          fiberCount: 2,
          familyCount: 1,
          moduleCount: 1,
          tagCount: 1
        },
        afterDispose: {
          fiberCount: 0,
          familyCount: 1,
          moduleCount: 0,
          tagCount: 1
        }
      }
    };

    await Effect.runPromise(store.recordRequestTraceEffect(trace));

    const snapshot = store.getSnapshot();
    const summary = store.getSummary();
    const graph = store.getCausalGraph();

    expect(snapshot.requestTraces).toEqual([trace]);
    expect(snapshot.events).toEqual([
      {
        _tag: "RequestTrace",
        sequence: 0,
        trace
      }
    ]);
    expect(summary.overview).toMatchObject({
      requestTraceCount: 1,
      runtimeEventCount: 1
    });
    expect(summary.requests.traces).toEqual([
      {
        index: 0,
        id: "req-project-atlas",
        method: "GET",
        path: "/projects/atlas",
        url: "https://example.test/projects/atlas?tab=activity",
        transport: "rpc",
        status: "success",
        responseStatus: 200,
        serviceCount: 2,
        resourceCount: 1,
        collectionCount: 1,
        serverFunctionCount: 1,
        actionCount: 1,
        fiberCount: 1,
        streamCount: 1,
        runtimeDisposed: true,
        teardownReason: "response-end",
        durationMillis: 23,
        beforeDisposeFiberCount: 2,
        afterDisposeFiberCount: 0,
        routeHref: "/projects/atlas?tab=activity"
      }
    ]);
    const panels = store.getPanels();
    const requestPanel = panels.panels.find((panel) => panel.id === "requests");
    expect(requestPanel).toMatchObject({
      severity: "ok",
      metrics: expect.arrayContaining([
        {
          label: "average duration",
          value: 23,
          unit: "ms"
        }
      ]),
      items: [
        expect.objectContaining({
          id: "request:req-project-atlas",
          label: "GET /projects/atlas",
          detail: "rpc success",
          metrics: expect.arrayContaining([
            {
              label: "before fibers",
              value: 2
            },
            {
              label: "after fibers",
              value: 0
            }
          ]),
          data: {
            id: "req-project-atlas",
            routeHref: "/projects/atlas?tab=activity",
            teardownReason: "response-end",
            runtimeDisposed: true
          }
        })
      ]
    });
    await expect(Effect.runPromise(store.getPanelsEffect())).resolves.toMatchObject({
      panels: expect.arrayContaining([
        expect.objectContaining({ id: "requests" })
      ])
    });
    expect(summary.runtime.events).toEqual([
      expect.objectContaining({
        _tag: "RequestTrace",
        label: "GET /projects/atlas",
        target: {
          kind: "RequestTrace",
          id: "request-trace:req-project-atlas"
        }
      })
    ]);
    expect(summary.resources).toEqual([
      {
        key: "Project.byId:atlas",
        family: "Project.byId",
        input: { id: "atlas" },
        state: "Success",
        sources: ["RequestTrace"],
        routeHrefs: ["/projects/atlas?tab=activity"],
        invalidationIndexes: []
      }
    ]);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "request-trace:req-project-atlas", kind: "RequestTrace" }),
      expect.objectContaining({ id: "endpoint:rpc", kind: "Endpoint" }),
      expect.objectContaining({ id: "route:/projects/:id", kind: "Route" }),
      expect.objectContaining({ id: "resource:Project.byId:atlas", kind: "Resource" }),
      expect.objectContaining({ id: "collection:Project.collection", kind: "Collection" }),
      expect.objectContaining({ id: "server-function:Project.load", kind: "ServerFunction" }),
      expect.objectContaining({ id: "action:Project.rename", kind: "Action" })
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "UsesEndpoint",
        source: "request-trace:req-project-atlas",
        target: "endpoint:rpc"
      }),
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:req-project-atlas",
        target: "resource:Project.byId:atlas"
      }),
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:req-project-atlas",
        target: "collection:Project.collection"
      }),
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:req-project-atlas",
        target: "server-function:Project.load"
      }),
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:req-project-atlas",
        target: "action:Project.rename"
      }),
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RequestTrace",
        target: "request-trace:req-project-atlas"
      })
    ]));
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("lets adapters observe snapshots, summaries, events, and causal graphs through Effect", async () => {
    const store = makeDevtoolsStore({ eventLimit: 1 });

    await Effect.runPromise(store.setAppGraphDiagnosticsEffect(appGraphDiagnostics));
    await Effect.runPromise(
      store.recordRuntimeEventEffect({
        _tag: "Custom",
        name: "first",
        payload: {
          ignored: true
        }
      })
    );
    await Effect.runPromise(
      store.recordResourceEventEffect({
        _tag: "ResourceSuccess",
        name: "User.effect-devtools",
        key: "User.effect-devtools:1",
        updatedAt: 1
      })
    );

    const snapshot = await Effect.runPromise(store.getSnapshotEffect());
    const summary = await Effect.runPromise(store.getSummaryEffect());
    const graph = await Effect.runPromise(store.getCausalGraphEffect());

    expect(snapshot.events).toEqual([
      {
        _tag: "ResourceStoreEvent",
        sequence: 1,
        event: {
          _tag: "ResourceSuccess",
          name: "User.effect-devtools",
          key: "User.effect-devtools:1",
          updatedAt: 1
        }
      }
    ]);
    expect(summary.runtime.events).toEqual([
      expect.objectContaining({
        _tag: "ResourceStoreEvent",
        sequence: 1,
        target: {
          kind: "Resource",
          id: "resource:User.effect-devtools:1"
        }
      })
    ]);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "runtime-event:1:ResourceStoreEvent",
        kind: "RuntimeEvent"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:ResourceStoreEvent",
        target: "resource:User.effect-devtools:1"
      })
    );
  });

  it("explains the golden path across route, server, action, resource, collection, and invalidation facts", async () => {
    const runtime = makeRuntime();
    const store = makeDevtoolsStore();
    const ProjectId = Schema.Struct({ id: Schema.String });
    const Project = Schema.Struct({ id: Schema.String, name: Schema.String });
    const ProjectsTag = Resource.tag("Golden.Projects");
    const ProjectTag = Resource.tag<{ readonly id: string }>("Golden.Project", {
      key: ({ id }) => id
    });
    const ProjectById = Resource.family({
      name: "Golden.Project.byId",
      input: ProjectId,
      output: Project,
      load: ({ id }: { readonly id: string }) =>
        Effect.succeed({ id, name: id === "atlas" ? "Atlas" : id }),
      provides: (project) => [ProjectTag({ id: project.id })]
    });
    const ProjectRows = Collection.define<{ readonly id: string; readonly name: string }>({
      name: "Golden.Project.collection",
      getKey: (project) => project.id,
      load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }])
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      { readonly id: string; readonly name: string }
    >({
      name: "Golden.Project.rename",
      input: Project,
      output: Project,
      run: (input) => Effect.succeed(input),
      invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })]
    });
    const ProjectRoute = route("/projects/:id", {
      params: ProjectId,
      search: Schema.Struct({ tab: Schema.optional(Schema.String) }),
      preloadCollections: [ProjectRows],
      preload: ({ params }) =>
        Effect.all([
          Resource.prefetchEffect(ProjectById({ id: params.id })),
          ProjectRows.preloadEffect()
        ], { discard: true })
    });
    const ref = ProjectById({ id: "atlas" });
    const resourceDiagnostics = Resource.diagnostics();
    const action = Action.use(RenameProject, { runtime });

    try {
      await Effect.runPromise(
        store.setAppGraphDiagnosticsEffect(
          goldenPathAppGraphDiagnostics({
            resourceFamilies: resourceDiagnostics.families.filter((family) =>
              family.name === "Golden.Project.byId"
            ),
            resourceTags: resourceDiagnostics.tags.filter((tag) =>
              tag.name === "Golden.Project" || tag.name === "Golden.Projects"
            )
          })
        )
      );

      await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const resourceSubscription = yield* Resource.subscribeEventsEffect();
            const collectionStore = yield* Collection.storeEffect();
            const collectionSubscription = yield* collectionStore.subscribeEventsEffect();
            const routePlan = yield* Route.planNavigationEffect(
              [ProjectRoute] as const,
              "/projects/atlas?tab=activity"
            );

            yield* store.recordRoutePlanEffect(routePlan);
            yield* store.recordResourceEventEffect(yield* PubSub.take(resourceSubscription));
            yield* store.recordResourceEventEffect(yield* PubSub.take(resourceSubscription));
            yield* store.recordCollectionEventEffect(yield* PubSub.take(collectionSubscription));

            yield* action.submitEffect({ id: "atlas", name: "Atlas Prime" });
            const invalidationPlan = readSignal(action.invalidationPlan);
            const actionState = readSignal(action.state);

            if (invalidationPlan === undefined) {
              expect.fail("Expected the golden-path action to expose an invalidation plan.");
            }

            yield* store.recordResourceEventEffect(yield* PubSub.take(resourceSubscription));
            yield* store.recordResourceEventEffect(yield* PubSub.take(resourceSubscription));
            yield* store.recordResourceEventEffect(yield* PubSub.take(resourceSubscription));
            yield* store.recordInvalidationEffect(invalidationPlan);
            yield* store.recordRuntimeEventEffect({
              _tag: "ActionState",
              action: RenameProject.name,
              state: actionState._tag,
              input: { id: "atlas" },
              invalidationIndexes: [0]
            });

            const snapshot = yield* store.getSnapshotEffect();
            yield* store.setSnapshotEffect({
              ...snapshot,
              resources: [
                {
                  key: ref.key,
                  state: "Success"
                }
              ],
              actions: [
                {
                  name: RenameProject.name,
                  state: actionState._tag,
                  invalidationIndexes: [0]
                }
              ]
            });
          })
        )
      );

      const summary = await Effect.runPromise(store.getSummaryEffect());
      const graph = await Effect.runPromise(store.getCausalGraphEffect());

      expect(summary.overview).toMatchObject({
        routeCount: 1,
        serverFunctionCount: 1,
        actionCount: 1,
        resourceFamilyCount: 1,
        resourceTagCount: 2,
        collectionDefinitionCount: 1,
        runtimeResourceCount: 1,
        runtimeActionCount: 1,
        invalidationPlanCount: 1,
        routePlanCount: 1,
        runtimeEventCount: 7,
        missingSchemaCount: 0,
        unknownActionBehaviorCount: 0,
        unknownRoutePreloadResourcesCount: 0,
        unknownRoutePreloadCollectionsCount: 0
      });
      expect(summary.graph).toMatchObject({
        _tag: "Available",
        routes: {
          paths: ["/projects/:id"],
          modules: [
            {
              routePath: "/projects/:id",
              paramsSchema: "present",
              searchSchema: "present",
              preload: "present",
              component: "present"
            }
          ]
        },
        serverFunctions: {
          modules: [
            {
              name: "Golden.Project.load",
              client: {
                _tag: "Import",
                rpcPath: "/__effect-ui/rpc"
              },
              wire: {
                complete: true,
                missing: []
              }
            }
          ]
        },
        actions: {
          behavior: {
            invalidates: [{ state: "present", count: 1 }],
            optimistic: [{ state: "absent", count: 1 }],
            retry: [{ state: "absent", count: 1 }],
            concurrency: [{ state: "latest", count: 1 }]
          }
        },
        resources: {
          families: [
            {
              name: "Golden.Project.byId",
              inputSchema: true,
              outputSchema: true,
              providesTags: true
            }
          ],
          tags: expect.arrayContaining([
            {
              name: "Golden.Project",
              keyed: true
            },
            {
              name: "Golden.Projects",
              keyed: false
            }
          ])
        },
        collections: {
          definitionCount: 1,
          definitions: [
            expect.objectContaining({
              name: "Golden.Project.collection",
              load: true
            })
          ]
        },
        endpoints: {
          rpc: "/__effect-ui/rpc",
          action: "/__effect-ui/action"
        }
      });
      expect(summary.routes.plans).toEqual([
        expect.objectContaining({
          _tag: "Matched",
          href: "/projects/atlas?tab=activity",
          path: "/projects/:id",
          params: { id: "atlas" },
          search: { tab: "activity" },
          resourceCount: 1,
          hydrationResourceCount: 1,
          resources: [
            {
              key: ref.key,
              family: "Golden.Project.byId",
              input: { id: "atlas" }
            }
          ]
        })
      ]);
      expect(summary.invalidations.plans).toEqual([
        expect.objectContaining({
          index: 0,
          targetCount: 2,
          matchedResourceCount: 1,
          causeCount: 1,
          targets: [
            {
              _tag: "Tag",
              key: "Golden.Projects",
              name: "Golden.Projects"
            },
            {
              _tag: "Tag",
              key: "Golden.Project:atlas",
              name: "Golden.Project"
            }
          ]
        })
      ]);
      expect(summary.resources).toEqual([
        {
          key: ref.key,
          family: "Golden.Project.byId",
          input: { id: "atlas" },
          state: "Success",
          sources: ["Invalidation", "RoutePlan", "Snapshot"],
          routeHrefs: ["/projects/atlas?tab=activity"],
          invalidationIndexes: [0]
        }
      ]);
      expect(summary.runtime.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          _tag: "ResourceStoreEvent",
          label: "ResourcePending",
          target: {
            kind: "Resource",
            id: `resource:${ref.key}`
          }
        }),
        expect.objectContaining({
          _tag: "ResourceStoreEvent",
          label: "ResourceSuccess",
          target: {
            kind: "Resource",
            id: `resource:${ref.key}`
          }
        }),
        expect.objectContaining({
          _tag: "CollectionStoreEvent",
          label: "CollectionLoaded",
          target: {
            kind: "Collection",
            id: "collection:Golden.Project.collection"
          }
        }),
        expect.objectContaining({
          _tag: "ResourceStoreEvent",
          label: "ResourceInvalidated",
          target: {
            kind: "Resource",
            id: `resource:${ref.key}`
          }
        }),
        expect.objectContaining({
          _tag: "ActionState",
          label: "Golden.Project.rename Success",
          target: {
            kind: "Action",
            id: "action:Golden.Project.rename"
          }
        })
      ]));
      expect(summary.runtime.events.filter((event) => event.label === "ResourcePending").length)
        .toBeGreaterThanOrEqual(1);
      expect(summary.runtime.events.filter((event) => event.label === "ResourceSuccess").length)
        .toBeGreaterThanOrEqual(1);
      expect(graph.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "route:/projects/:id", kind: "Route" }),
          expect.objectContaining({ id: "server-function:Golden.Project.load", kind: "ServerFunction" }),
          expect.objectContaining({ id: "action:Golden.Project.rename", kind: "Action" }),
          expect.objectContaining({ id: "resource-family:Golden.Project.byId", kind: "ResourceFamily" }),
          expect.objectContaining({ id: "resource-tag:Golden.Project", kind: "ResourceTag" }),
          expect.objectContaining({ id: "resource-tag:Golden.Projects", kind: "ResourceTag" }),
          expect.objectContaining({ id: `resource:${ref.key}`, kind: "Resource" }),
          expect.objectContaining({ id: "collection:Golden.Project.collection", kind: "Collection" }),
          expect.objectContaining({ id: "invalidation:0", kind: "InvalidationPlan" })
        ])
      );
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "Matches",
            source: "route-plan:0:/projects/atlas?tab=activity",
            target: "route:/projects/:id"
          }),
          expect.objectContaining({
            kind: "Preloads",
            source: "route-plan:0:/projects/atlas?tab=activity",
            target: `resource:${ref.key}`
          }),
          expect.objectContaining({
            kind: "Hydrates",
            source: "route-plan:0:/projects/atlas?tab=activity",
            target: `resource:${ref.key}`
          }),
          expect.objectContaining({
            kind: "Preloads",
            source: "route:/projects/:id",
            target: "collection:Golden.Project.collection"
          }),
          expect.objectContaining({
            kind: "UsesEndpoint",
            source: "server-function:Golden.Project.load",
            target: "endpoint:rpc"
          }),
          expect.objectContaining({
            kind: "UsesEndpoint",
            source: "action:Golden.Project.rename",
            target: "endpoint:action"
          }),
          expect.objectContaining({
            kind: "Targets",
            source: "invalidation:0",
            target: "resource-tag:Golden.Projects"
          }),
          expect.objectContaining({
            kind: "Targets",
            source: "invalidation:0",
            target: "resource-tag:Golden.Project:atlas"
          }),
          expect.objectContaining({
            kind: "Invalidates",
            source: "invalidation:0",
            target: `resource:${ref.key}`
          }),
          expect.objectContaining({
            kind: "Causes",
            source: "resource-tag:Golden.Project:atlas",
            target: `resource:${ref.key}`
          }),
          expect.objectContaining({
            kind: "Emits",
            source: "action:Golden.Project.rename",
            target: "invalidation:0"
          }),
          expect.objectContaining({
            kind: "Observes",
            source: "runtime-event:2:CollectionStoreEvent",
            target: "collection:Golden.Project.collection"
          }),
          expect.objectContaining({
            kind: "Observes",
            source: "runtime-event:6:ActionState",
            target: "action:Golden.Project.rename"
          })
        ])
      );
      expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    } finally {
      await runtime.dispose();
    }
  });
});

const goldenPathAppGraphDiagnostics = (
  resources: Pick<DevtoolsStartAppGraphDiagnostics, "resourceFamilies" | "resourceTags">
): DevtoolsStartAppGraphDiagnostics => ({
  version: 1,
  routeCount: 1,
  serverFunctionCount: 1,
  actionCount: 1,
  routePaths: ["/projects/:id"],
  routeModules: [
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
      paramsSchema: "present",
      searchSchema: "present",
      preload: "present",
      preloadResources: {
        status: "declared",
        families: ["Golden.Project.byId"]
      },
      preloadCollections: {
        status: "declared",
        collections: ["Golden.Project.collection"]
      },
      component: "present"
    }
  ],
  serverFunctionModules: [
    {
      id: "sf_golden_project_load",
      name: "Golden.Project.load",
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
        errorSchema: true,
        complete: true,
        missing: []
      }
    }
  ],
  actionModules: [
    {
      id: "act_golden_project_rename",
      name: "Golden.Project.rename",
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
        errorSchema: true,
        complete: true,
        missing: []
      },
      behavior: {
        invalidates: "present",
        optimistic: "absent",
        retry: "absent",
        concurrency: "latest"
      }
    }
  ],
  resourceFamilies: resources.resourceFamilies,
  resourceTags: resources.resourceTags,
  collectionDefinitions: [
    {
      name: "Golden.Project.collection",
      inputSchema: false,
      outputSchema: false,
      initialData: false,
      load: true,
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
  ],
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
      error: 1
    },
    actions: {
      total: 1,
      input: 1,
      output: 1,
      error: 1
    }
  },
  missingSchemas: [],
  unknownActionBehavior: [],
  unknownRoutePreloadResources: [],
  unknownRoutePreloadCollections: []
});

const appGraphDiagnostics: DevtoolsStartAppGraphDiagnostics = {
  version: 1,
  routeCount: 1,
  serverFunctionCount: 1,
  actionCount: 1,
  routePaths: ["/users/:id"],
  routeModules: [
    {
      routeId: "route_users_$id",
      routePath: "/users/:id",
      moduleId: "src/routes/users/$id.tsx",
      filePath: "src/routes/users/$id.tsx",
      pathParamCount: 1,
      hasPathParams: true,
      params: [
        {
          name: "id",
          optional: false
        }
      ],
      paramsSchema: "present",
      searchSchema: "absent",
      preload: "present",
      preloadResources: {
        status: "declared",
        families: ["User.summary-devtools"]
      },
      preloadCollections: {
        status: "declared",
        collections: []
      },
      component: "present"
    }
  ],
  serverFunctionModules: [
    {
      id: "sf_user_get",
      name: "User.get",
      server: {
        module: "/src/user/user.server.ts",
        exportName: "getUser",
        moduleKind: "server-only",
        hasHandler: true
      },
      client: {
        _tag: "Import",
        rpcPath: "/__effect-ui/rpc",
        module: "/src/user/user.contract.ts",
        exportName: "getUser",
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
      id: "act_user_rename",
      name: "User.rename",
      server: {
        module: "/src/user/user.actions.ts",
        exportName: "RenameUser",
        moduleKind: "shared"
      },
      client: {
        _tag: "Import",
        actionPath: "/__effect-ui/action",
        module: "/src/user/user.actions.ts",
        exportName: "RenameUser",
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
  resourceFamilies: [
    {
      name: "User.summary-devtools",
      inputSchema: true,
      outputSchema: true,
      errorSchema: false,
      providesTags: true,
      policy: {
        staleFor: "30 seconds",
        gcFor: "5 minutes",
        retry: true
      }
    }
  ],
  resourceTags: [
    {
      name: "User.summary-devtools",
      keyed: true
    }
  ],
  collectionDefinitions: [],
  serverOnlyModules: ["/src/user/user.server.ts"],
  browserClientModules: ["/src/user/user.actions.ts"],
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
      kind: "action",
      name: "User.rename",
      input: true,
      output: true,
      error: false
    }
  ],
  unknownActionBehavior: [],
  unknownRoutePreloadResources: [],
  unknownRoutePreloadCollections: []
};
