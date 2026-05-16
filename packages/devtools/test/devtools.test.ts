import { Effect, PubSub, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Action, makeRuntime, Program, read as readSignal, Resource, route, Route, Signal, type ActionState } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import {
  bootDevtoolsPanels,
  DevtoolsActionInvalidationPlanConflict,
  DevtoolsUnknownInvalidationTarget,
  devtoolsPanelIds,
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
  isDevtoolsPanelId,
  isDevtoolsPanelItem,
  isDevtoolsPanels,
  isDevtoolsSerializableValue,
  mountDevtoolsPanels,
  normalizeEffectUiDevtoolsBridgePayload,
  renderDevtoolsPanelsHtml,
  renderDevtoolsPanelsHtmlEffect,
  toDevtoolsSerializableValue,
  type DevtoolsBridgeTarget,
  type DevtoolsInvalidationPlan,
  type DevtoolsRequestTrace,
  type DevtoolsRoutePlan,
  type DevtoolsStartAppGraphDiagnostics
} from "../src/index.js";
import { stableFactFingerprint } from "../src/fact-identity.js";

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

    await Effect.runPromise(Resource.prefetchEffect(ref));

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

  it("normalizes unsafe store history limits before trimming", async () => {
    const RouteUser = route("/history/:id", {});
    const routePlan = await Effect.runPromise(
      Route.planNavigationEffect([RouteUser] as const, "/history/1")
    );
    const invalidationStore = makeDevtoolsStore({ invalidationLimit: 0 });
    const routeStore = makeDevtoolsStore({ routePlanLimit: -1 });
    const traceStore = makeDevtoolsStore({ requestTraceLimit: Number.NaN });
    const eventStore = makeDevtoolsStore({ eventLimit: Number.POSITIVE_INFINITY });

    for (let index = 0; index < 55; index++) {
      invalidationStore.recordSerializedInvalidation({
        targets: [{ _tag: "Tag", key: `Project.${index}`, name: "Project" }],
        entries: []
      });
      routeStore.recordRoutePlan(routePlan);
      traceStore.recordRequestTrace({
        request: {
          id: `req:${index}`,
          method: "GET",
          url: `https://example.test/history/${index}`,
          path: `/history/${index}`,
          transport: "ssr"
        },
        services: [],
        resources: [],
        collections: [],
        serverFunctions: [],
        actions: [],
        fibers: [],
        streams: [],
        status: "success"
      });
    }
    for (let index = 0; index < 505; index++) {
      eventStore.recordRuntimeEvent({
        _tag: "Custom",
        name: `event:${index}`
      });
    }

    expect(invalidationStore.getSnapshot().invalidations).toHaveLength(50);
    expect(routeStore.getSnapshot().routePlans).toHaveLength(50);
    expect(traceStore.getSnapshot().requestTraces).toHaveLength(50);
    expect(eventStore.getSnapshot().events).toHaveLength(500);
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

  it("uses bounded structural invalidation identity for matching and deduplication", () => {
    const invalidationPlan = (tail: string): DevtoolsInvalidationPlan => ({
      targets: [
        {
          _tag: "Tag",
          key: "Project.bulk",
          name: "Project.bulk"
        }
      ],
      entries: Array.from({ length: 50 }, (_, index) => ({
        ref: {
          key: index < 49 ? `Project:${index}` : `Project:${tail}`,
          family: "Project",
          input: { id: index < 49 ? index : tail }
        },
        causes: [
          {
            _tag: "Tag",
            key: "Project.bulk",
            name: "Project.bulk"
          }
        ]
      }))
    });
    const firstPlan = invalidationPlan("first-tail");
    const secondPlan = invalidationPlan("second-tail");
    const store = makeDevtoolsStore();

    store.recordActionState("Project.bulk.first", "Success", {
      serializedInvalidationPlan: firstPlan
    });
    store.recordActionState("Project.bulk.second", "Success", {
      serializedInvalidationPlan: secondPlan
    });
    store.recordRuntimeEvent({
      _tag: "Invalidation",
      action: "Project.bulk.first",
      plan: firstPlan
    });
    store.recordRuntimeEvent({
      _tag: "Invalidation",
      action: "Project.bulk.second",
      plan: secondPlan
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.invalidations).toHaveLength(2);
    expect(snapshot.invalidations[0]?.entries[49]?.ref.key).toBe("Project:first-tail");
    expect(snapshot.invalidations[1]?.entries[49]?.ref.key).toBe("Project:second-tail");
    expect(snapshot.actions).toEqual([
      {
        name: "Project.bulk.first",
        state: "Success",
        invalidationIndexes: [0]
      },
      {
        name: "Project.bulk.second",
        state: "Success",
        invalidationIndexes: [1]
      }
    ]);
    expect(snapshot.events?.filter((event) => event._tag === "Invalidation")).toEqual([
      expect.objectContaining({
        _tag: "Invalidation",
        action: "Project.bulk.first",
        invalidationIndex: 0
      }),
      expect.objectContaining({
        _tag: "Invalidation",
        action: "Project.bulk.second",
        invalidationIndex: 1
      })
    ]);
    expect(
      store.getCausalGraph().nodes
        .filter((node) => node.kind === "InvalidationPlan")
        .map((node) => node.id)
    ).toEqual(["invalidation:0", "invalidation:1"]);
  });

  it("drops stale action invalidation links after bounded history trimming", () => {
    const firstPlan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Project.first",
          name: "Project.first"
        }
      ],
      entries: []
    };
    const secondPlan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Project.second",
          name: "Project.second"
        }
      ],
      entries: []
    };
    const store = makeDevtoolsStore({ invalidationLimit: 1 });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* store.recordActionStateEffect("Project.first", "Success", {
          serializedInvalidationPlan: firstPlan
        });
        yield* store.recordActionStateEffect("Project.second", "Success", {
          serializedInvalidationPlan: secondPlan
        });

        const snapshot = store.getSnapshot();
        expect(snapshot.invalidations).toEqual([secondPlan]);
        expect(snapshot.actions).toEqual([
          {
            name: "Project.first",
            state: "Success"
          },
          {
            name: "Project.second",
            state: "Success",
            invalidationIndexes: [0]
          }
        ]);
        expect(snapshot.events).toEqual([
          {
            _tag: "ActionState",
            sequence: 0,
            action: "Project.first",
            state: "Success"
          },
          {
            _tag: "ActionState",
            sequence: 1,
            action: "Project.second",
            state: "Success",
            invalidationIndexes: [0]
          }
        ]);

        expect(store.getCausalGraph().edges).not.toContainEqual(
          expect.objectContaining({
            kind: "Emits",
            source: "action:Project.first",
            target: "invalidation:0"
          })
        );
        expect(store.getCausalGraph().edges).toContainEqual(
          expect.objectContaining({
            kind: "Emits",
            source: "action:Project.second",
            target: "invalidation:0"
          })
        );
      })
    );
  });

  it("rebases request trace action invalidation links after bounded history trimming", () => {
    const firstPlan: DevtoolsInvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Project.first", name: "Project.first" }],
      entries: []
    };
    const secondPlan: DevtoolsInvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Project.second", name: "Project.second" }],
      entries: []
    };
    const thirdPlan: DevtoolsInvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Project.third", name: "Project.third" }],
      entries: []
    };
    const store = makeDevtoolsStore({ invalidationLimit: 2 });

    store.recordSerializedInvalidation(firstPlan);
    store.recordSerializedInvalidation(secondPlan);
    store.recordRequestTrace({
      request: {
        id: "req-project-action",
        method: "POST",
        url: "https://example.test/__effect-ui/action",
        path: "/__effect-ui/action",
        transport: "action"
      },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [
        {
          name: "Project.rename",
          state: "Success",
          invalidationIndexes: [1]
        }
      ],
      fibers: [],
      streams: [],
      status: "success"
    });
    store.recordSerializedInvalidation(thirdPlan);

    const snapshot = store.getSnapshot();
    expect(snapshot.invalidations).toEqual([secondPlan, thirdPlan]);
    expect(snapshot.requestTraces?.[0]?.actions).toEqual([
      {
        name: "Project.rename",
        state: "Success",
        invalidationIndexes: [0]
      }
    ]);
    expect(snapshot.events?.find((event) => event._tag === "RequestTrace")).toMatchObject({
      _tag: "RequestTrace",
      trace: {
        actions: [
          {
            name: "Project.rename",
            state: "Success",
            invalidationIndexes: [0]
          }
        ]
      }
    });
    expect(store.getSummary().requests.traces[0]?.actions).toEqual([
      {
        name: "Project.rename",
        state: "Success",
        failureKind: null,
        invalidationIndexes: [0]
      }
    ]);
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
      "ActionState",
      "ActionState"
    ]);
  });

  it("tracks Start-shaped action invalidation changes after terminal state updates", async () => {
    const plan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "Project.byId:atlas",
          family: "Project.byId",
          input: { id: "atlas" }
        }
      ],
      entries: []
    };
    const state = Signal.make<ActionState<{ readonly id: string }, unknown, unknown>>({ _tag: "Idle" });
    const invalidation = Signal.make<DevtoolsInvalidationPlan | undefined>(undefined);
    const store = makeDevtoolsStore();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* store.trackStartActionEffect({
            definition: {
              name: "Project.rename.after-terminal"
            },
            state,
            invalidation
          });

          state.set({
            _tag: "Success",
            input: { id: "atlas" },
            value: {
              _tag: "Success"
            }
          });
          invalidation.set(plan);
        })
      )
    );

    expect(store.getSnapshot().actions).toEqual([
      {
        name: "Project.rename.after-terminal",
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

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Resource.prefetchEffect(ref);
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

  it("records Program timeline events as serializable runtime panel facts", () => {
    const before: { readonly count: number; readonly password: string; self?: unknown } = {
      count: 0,
      password: "open-sesame"
    };
    before.self = before;
    const store = makeDevtoolsStore({
      serializationPolicy: {
        redactKeys: ["tenantPrivate"]
      }
    });

    store.recordProgramEvent({
      _tag: "Message",
      sequence: 1,
      program: "Counter.program-devtools",
      message: { _tag: "Increment", accessToken: "secret-token" },
      before,
      after: { count: 1, nested: { apiKey: "secret-api-key", tenantPrivate: "tenant-secret" } },
      commandCount: 0
    });
    store.recordProgramEvent({
      _tag: "UpdateFailed",
      sequence: 2,
      program: "Counter.program-devtools",
      failure: {
        _tag: "ProgramFailure",
        phase: "Update",
        message: { _tag: "Fail" },
        error: new Error("boom")
      }
    });

    const summary = store.getSummary();
    const firstEventData = summary.runtime.events[0]?.data as {
      readonly after?: { readonly nested?: { readonly apiKey?: unknown; readonly tenantPrivate?: unknown } };
      readonly before?: { readonly password?: unknown; readonly self?: unknown };
      readonly message?: { readonly accessToken?: unknown };
    };
    expect(summary.runtime.events.map((event) => event._tag)).toEqual([
      "ProgramEvent",
      "ProgramEvent"
    ]);
    expect(summary.runtime.events[0]).toMatchObject({
      label: "Counter.program-devtools Message",
      target: {
        kind: "Program",
        id: "program:Counter.program-devtools"
      }
    });
    expect(firstEventData.before?.self).toEqual({ _tag: "Circular" });
    expect(firstEventData.before?.password).toEqual({ _tag: "Redacted" });
    expect(firstEventData.message?.accessToken).toEqual({ _tag: "Redacted" });
    expect(firstEventData.after?.nested?.apiKey).toEqual({ _tag: "Redacted" });
    expect(firstEventData.after?.nested?.tenantPrivate).toEqual({ _tag: "Redacted" });
    expect(JSON.stringify(summary)).not.toContain("open-sesame");
    expect(JSON.stringify(summary)).not.toContain("secret-token");
    expect(JSON.stringify(summary)).not.toContain("secret-api-key");
    expect(JSON.stringify(summary)).not.toContain("tenant-secret");

    const programsPanel = store.getPanels().panels.find((panel) => panel.id === "programs");
    expect(programsPanel).toMatchObject({
      title: "Programs",
      summary: "1 programs, 2 events",
      severity: "error"
    });
    expect(programsPanel?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "program-event:runtime-event:0:ProgramEvent",
        label: "Counter.program-devtools Message",
        detail: "Counter.program-devtools Message",
        severity: "ok",
        data: expect.objectContaining({
          _tag: "Message",
          before: expect.objectContaining({
            password: { _tag: "Redacted" }
          })
        })
      }),
      expect.objectContaining({
        id: "program-event:runtime-event:1:ProgramEvent",
        label: "Counter.program-devtools UpdateFailed",
        detail: "Counter.program-devtools UpdateFailed",
        severity: "error"
      }),
      expect.objectContaining({
        id: "program-summary:Counter.program-devtools",
        label: "Counter.program-devtools",
        severity: "error"
      })
    ]));
    expect(JSON.stringify(programsPanel)).not.toContain("open-sesame");
    expect(JSON.stringify(programsPanel)).not.toContain("secret-token");
    expect(store.getCausalGraph().nodes).toContainEqual(
      expect.objectContaining({
        id: "program:Counter.program-devtools",
        kind: "Program",
        label: "Counter.program-devtools"
      })
    );
  });

  it("tracks running Program timelines with scoped cleanup", async () => {
    const store = makeDevtoolsStore();
    const program = Program.start(
      Program.define<{ readonly count: number }, { readonly _tag: "Increment" }>({
        name: "Counter.program-track",
        initial: { count: 0 },
        update: (model) => Effect.succeed({ count: model.count + 1 })
      })
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* store.trackProgramEffect(program);
            yield* program.dispatchEffect({ _tag: "Increment" });
            yield* Effect.sleep("10 millis");
          })
        )
      );

      const trackedEvents = store.getSnapshot().events?.filter((event) => event._tag === "ProgramEvent") ?? [];
      expect(readSignal(program.model)).toEqual({ count: 1 });
      expect(trackedEvents.map((event) => event.event._tag)).toEqual(["Message"]);

      await Effect.runPromise(program.dispatchEffect({ _tag: "Increment" }));
      await Effect.runPromise(Effect.sleep("10 millis"));
      expect(store.getSnapshot().events?.filter((event) => event._tag === "ProgramEvent")).toHaveLength(
        trackedEvents.length
      );
    } finally {
      await Effect.runPromise(program.disposeEffect);
    }
  });

  it("tracks anonymous Program timelines with bounded high-water identity", async () => {
    const store = makeDevtoolsStore();
    const first = Program.start(
      Program.define<{ readonly count: number }, { readonly _tag: "Increment" }>({
        initial: { count: 0 },
        update: (model) => Effect.succeed({ count: model.count + 1 })
      })
    );
    const second = Program.start(
      Program.define<{ readonly count: number }, { readonly _tag: "Increment" }>({
        initial: { count: 0 },
        update: (model) => Effect.succeed({ count: model.count + 1 })
      })
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* store.trackProgramEffect(first);
            yield* store.trackProgramEffect(second);
            yield* first.dispatchEffect({ _tag: "Increment" });
            yield* second.dispatchEffect({ _tag: "Increment" });
            yield* Effect.sleep("10 millis");
          })
        )
      );

      expect(store.getSummary().runtime.events.map((event) => event.target)).toEqual([
        { kind: "Program", id: "program:Program#1" },
        { kind: "Program", id: "program:Program#2" }
      ]);
    } finally {
      await Effect.runPromise(Effect.all([
        first.disposeEffect,
        second.disposeEffect
      ], { discard: true }));
    }
  });

  it("serializes route plans into plain data", async () => {
    const User = Resource.family({
      name: "User.route-devtools",
      load: (id: string) => Effect.succeed({ id })
    });
    const UserRoute = route("/users/:id", {
      preload: ({ params }) => Resource.prefetchEffect(User(params.id))
    });
    const plan = await Effect.runPromise(
      Route.planNavigationEffect([UserRoute] as const, "/users/1")
    );

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
        resourceCount: 1,
        resourceKeys: [User("1").key]
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

    const routePlan = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Resource.prefetchEffect(ref);
        return describeRoutePlan(
          yield* Route.planNavigationEffect([UserRoute] as const, "/users/1")
        );
      })
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
    expect(panels.panels.map((panel) => panel.id)).toEqual(devtoolsPanelIds);
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
    expect(html).toContain("data-effect-ui-devtools-item-id=\"request:safe\"");
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

  it("keeps inspected-window devtools bridge cleanup stack-safe", () => {
    const target: DevtoolsBridgeTarget = {};
    const panels = describeDevtoolsPanels();
    const previous = () => ({
      panels,
      title: "Previous"
    });
    const firstProvider = { panels, title: "First" };
    const secondProvider = { panels, title: "Second" };
    const thirdProvider = { panels, title: "Third" };
    target[effectUiDevtoolsBridgeGlobal] = previous;

    const first = installDevtoolsBridge(firstProvider, target);
    const second = installDevtoolsBridge(secondProvider, target);
    const third = installDevtoolsBridge(thirdProvider, target);

    expect(target[effectUiDevtoolsBridgeGlobal]).toBe(thirdProvider);
    second.uninstall();
    expect(target[effectUiDevtoolsBridgeGlobal]).toBe(thirdProvider);
    first.uninstall();
    expect(target[effectUiDevtoolsBridgeGlobal]).toBe(thirdProvider);
    third.uninstall();
    expect(target[effectUiDevtoolsBridgeGlobal]).toBe(previous);
    second.uninstall();
    expect(target[effectUiDevtoolsBridgeGlobal]).toBe(previous);

    const noBaselineTarget: DevtoolsBridgeTarget = {};
    const noBaselineFirst = installDevtoolsBridge(firstProvider, noBaselineTarget);
    const noBaselineSecond = installDevtoolsBridge(secondProvider, noBaselineTarget);

    noBaselineFirst.uninstall();
    expect(noBaselineTarget[effectUiDevtoolsBridgeGlobal]).toBe(secondProvider);
    noBaselineSecond.uninstall();
    expect(noBaselineTarget[effectUiDevtoolsBridgeGlobal]).toBeUndefined();
  });

  it("normalizes inspected-window panel payloads through the shared panel contract", () => {
    const panels = describeDevtoolsPanels();

    expect(isDevtoolsPanelId("requests")).toBe(true);
    expect(isDevtoolsPanelId("missing")).toBe(false);
    expect(isDevtoolsPanelItem({
      id: "unsafe-metrics",
      label: "Unsafe metrics",
      severity: "ok",
      metrics: {
        count: 1
      }
    })).toBe(false);
    expect(isDevtoolsPanels(panels)).toBe(true);
    expect(isDevtoolsPanels({ version: 1, panels: panels.panels.slice(0, 1) })).toBe(false);
    expect(isDevtoolsPanels({ version: 1, panels: [panels.panels[0]!, panels.panels[0]!] })).toBe(false);
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: [...panels.panels].reverse()
      }
    })?.panels.panels.map((panel) => panel.id)).toEqual(devtoolsPanelIds);
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels,
      selectedPanelId: "requests",
      title: "Live"
    })).toEqual({
      panels,
      selectedPanelId: "requests",
      title: "Live"
    });
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels,
      selectedPanelId: "missing"
    })).toEqual({ panels });
    const longString = "x".repeat(1_050);
    const boundedPayload = normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: panels.panels.map((panel) =>
          panel.id === "requests"
            ? {
                ...panel,
                title: longString,
                summary: longString,
                metrics: [{ label: longString, value: longString, unit: longString }],
                items: [
                  {
                    id: "request:long",
                    label: longString,
                    severity: "ok",
                    detail: longString,
                    metrics: [{ label: "payload", value: longString, unit: longString }],
                    data: {
                      nested: [longString],
                      value: longString
                    }
                  }
                ]
              }
            : panel
        )
      },
      title: longString
    });
    const boundedLongString = longString.slice(0, 1_000);
    const boundedRequestsPanel = boundedPayload?.panels.panels.find((panel) => panel.id === "requests");
    expect(boundedPayload?.title).toBe(boundedLongString);
    expect(boundedRequestsPanel).toMatchObject({
      title: boundedLongString,
      summary: boundedLongString,
      metrics: [
        {
          label: boundedLongString,
          value: boundedLongString,
          unit: boundedLongString
        }
      ],
      items: [
        expect.objectContaining({
          label: boundedLongString,
          detail: boundedLongString,
          metrics: [
            {
              label: "payload",
              value: boundedLongString,
              unit: boundedLongString
            }
          ],
          data: {
            nested: [boundedLongString],
            value: boundedLongString
          }
        })
      ]
    });
    const longDataKey = "k".repeat(1_001);
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: panels.panels.map((panel) =>
          panel.id === "requests"
            ? {
                ...panel,
                items: [
                  {
                    id: "request:long-key",
                    label: "Long key",
                    severity: "ok",
                    data: { [longDataKey]: "value" }
                  }
                ]
              }
            : panel
        )
      }
    })).toBeUndefined();
    const sourcePanels = {
      version: 1 as const,
      panels: panels.panels.map((panel) =>
        panel.id === "requests"
          ? {
              id: "requests" as const,
              title: "Requests",
              summary: "Detached",
              severity: "ok" as const,
              metrics: [{ label: "Duration", value: "1", unit: "ms" }],
              items: [
                {
                  id: "request:1",
                  label: "Request",
                  severity: "ok" as const,
                  detail: "Initial",
                  metrics: [],
                  data: { value: "stable" }
                }
              ]
            }
          : panel
      )
    };
    const duplicateItemPanels = {
      ...sourcePanels,
      panels: sourcePanels.panels.map((panel) =>
        panel.id === "requests"
          ? { ...panel, items: [panel.items[0]!, { ...panel.items[0]!, label: "Duplicate request" }] }
          : panel
      )
    };
    expect(isDevtoolsPanels(duplicateItemPanels)).toBe(false);
    expect(normalizeEffectUiDevtoolsBridgePayload({ panels: duplicateItemPanels })).toBeUndefined();
    let sourcePanelReads = 0;
    const lateThrowingPayload = {
      get panels(): unknown {
        sourcePanelReads++;
        if (sourcePanelReads > 1) {
          throw new Error("late panel getter failed");
        }
        return sourcePanels;
      }
    };
    const normalized = normalizeEffectUiDevtoolsBridgePayload(lateThrowingPayload);
    sourcePanels.panels[0]!.title = "Mutated";

    expect(sourcePanelReads).toBe(1);
    expect(normalized?.panels.panels.find((panel) => panel.id === "requests")?.title).toBe("Requests");
    expect(renderDevtoolsPanelsHtml({ panels: normalized!.panels })).toContain("Requests");
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: [
          {
            id: "missing",
            title: "Bad",
            summary: "Bad",
            severity: "ok",
            metrics: [],
            items: []
          }
        ]
      }
    })).toBeUndefined();
    const throwingPayload = {
      get panels(): unknown {
        throw new Error("bridge getter failed");
      }
    };
    const throwingSerializableRecord = new Proxy<Record<string, unknown>>({}, {
      getPrototypeOf: () => Object.prototype,
      ownKeys: () => {
        throw new Error("own keys failed");
      }
    });
    const throwingPanelItem = new Proxy<Record<string, unknown>>({
      id: "request:1",
      severity: "ok"
    }, {
      get: (target, property, receiver) => {
        if (property === "label") {
          throw new Error("item getter failed");
        }
        return Reflect.get(target, property, receiver);
      }
    });
    expect(() => normalizeEffectUiDevtoolsBridgePayload(throwingPayload)).not.toThrow();
    expect(normalizeEffectUiDevtoolsBridgePayload(throwingPayload)).toBeUndefined();
    expect(() => isDevtoolsSerializableValue(throwingSerializableRecord)).not.toThrow();
    expect(isDevtoolsSerializableValue(throwingSerializableRecord)).toBe(false);
    expect(() =>
      normalizeEffectUiDevtoolsBridgePayload({
        panels: {
          version: 1,
          panels: [
            {
              id: "requests",
              title: "Requests",
              summary: "Throwing item",
              severity: "ok",
              metrics: [],
              items: [throwingPanelItem]
            }
          ]
        }
      })
    ).not.toThrow();
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: [
          {
            id: "requests",
            title: "Requests",
            summary: "Throwing item",
            severity: "ok",
            metrics: [],
            items: [throwingPanelItem]
          }
        ]
      }
    })).toBeUndefined();
    const cyclicData: Record<string, unknown> = {};
    cyclicData.self = cyclicData;
    expect(isDevtoolsSerializableValue(cyclicData)).toBe(false);
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: panels.panels.map((panel) =>
          panel.id === "requests"
            ? {
                ...panel,
                items: [
                  {
                    id: "request:cycle",
                    label: "Cycle",
                    severity: "ok",
                    data: cyclicData
                  }
                ]
              }
            : panel
        )
      }
    })).toBeUndefined();
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: panels.panels.map((panel) =>
          panel.id === "requests"
            ? {
                ...panel,
                items: [
                  {
                    id: "request:huge",
                    label: "Huge",
                    severity: "ok",
                    data: new Array(1_001).fill("value")
                  }
                ]
              }
            : panel
        )
      }
    })).toBeUndefined();
    for (const data of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date("2026-05-14T00:00:00.000Z"),
      new Map([["key", "value"]]),
      new Set(["value"]),
      new Error("boom")
    ]) {
      expect(isDevtoolsSerializableValue(data)).toBe(false);
      expect(normalizeEffectUiDevtoolsBridgePayload({
        panels: {
          version: 1,
          panels: [
            {
              id: "requests",
              title: "Requests",
              summary: "Invalid data",
              severity: "ok",
              metrics: [],
              items: [
                {
                  id: "request:1",
                  label: "Request",
                  severity: "ok",
                  data
                }
              ]
            }
          ]
        }
      })).toBeUndefined();
    }
    expect(normalizeEffectUiDevtoolsBridgePayload({
      panels: {
        version: 1,
        panels: [
          {
            id: "requests",
            title: "Requests",
            summary: "Invalid metric",
            severity: "ok",
            metrics: [{ label: "Duration", value: Number.NaN }],
            items: []
          }
        ]
      }
    })).toBeUndefined();
  });

  it("renders malformed public panel payloads as contract diagnostics", () => {
    const panels = describeDevtoolsPanels();
    const duplicatePanels = {
      version: 1 as const,
      panels: panels.panels.map((panel, index) =>
        index === 1 ? { ...panel, id: panels.panels[0]!.id } : panel
      )
    };
    const missingPanels = {
      version: 1 as const,
      panels: panels.panels.filter((panel) => panel.id !== "requests")
    };

    const duplicateHtml = renderDevtoolsPanelsHtml({
      panels: duplicatePanels,
      selectedPanelId: "diagnostics",
      includeStyles: false
    });
    const missingHtml = renderDevtoolsPanelsHtml({
      panels: missingPanels,
      selectedPanelId: "diagnostics",
      includeStyles: false
    });
    const root = {
      innerHTML: "",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      contains: () => true
    } as unknown as HTMLElement;
    const mount = mountDevtoolsPanels({
      root,
      panels: missingPanels,
      selectedPanelId: "diagnostics",
      includeStyles: false
    });

    expect(duplicateHtml).toContain("Panel contract error");
    expect(duplicateHtml).toContain("Duplicate panel id");
    expect(duplicateHtml).not.toContain("GET /projects/atlas");
    expect(missingHtml).toContain("Panel contract error");
    expect(missingHtml).toContain("Missing required panel");
    expect(missingHtml).not.toContain("GET /projects/atlas");
    expect(root.innerHTML).toContain("Panel contract error");
    expect(root.innerHTML).toContain("Missing required panel");
    mount.unmount();
  });

  it("releases devtools panel lifecycle listeners on manual boot interrupt", async () => {
    type LifecycleType = "pagehide" | "beforeunload";
    const listeners = new Map<LifecycleType, Set<() => void>>([
      ["pagehide", new Set()],
      ["beforeunload", new Set()]
    ]);
    const lifecycleWindow = {
      addEventListener: (type: LifecycleType, listener: () => void) => {
        listeners.get(type)?.add(listener);
      },
      removeEventListener: (type: LifecycleType, listener: () => void) => {
        listeners.get(type)?.delete(listener);
      }
    };
    const root = {
      innerHTML: "",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      contains: () => true
    } as unknown as HTMLElement;
    const boot = bootDevtoolsPanels({
      root,
      includeStyles: false,
      lifecycleWindow: lifecycleWindow as unknown as Window
    });

    expect(listeners.get("pagehide")?.size).toBe(1);
    expect(listeners.get("beforeunload")?.size).toBe(1);

    boot.interrupt();

    expect(listeners.get("pagehide")?.size).toBe(0);
    expect(listeners.get("beforeunload")?.size).toBe(0);
    await Effect.runPromise(boot.interruptEffect);
  });

  it("keeps public devtools Effect wrappers lazy until execution", async () => {
    const throwingInput = new Proxy({}, {
      get: (_target, property) => {
        if (property === "snapshot") {
          throw new Error("lazy snapshot read");
        }
        return undefined;
      }
    });

    expect(() => describeDevtoolsSummaryEffect(throwingInput)).not.toThrow();
    expect(() => describeDevtoolsCausalGraphEffect(throwingInput)).not.toThrow();
    expect(() => describeDevtoolsPanelsEffect(throwingInput)).not.toThrow();
    expect(() => renderDevtoolsPanelsHtmlEffect(throwingInput)).not.toThrow();

    await expect(Effect.runPromise(describeDevtoolsSummaryEffect(throwingInput)))
      .rejects.toThrow("lazy snapshot read");
    await expect(Effect.runPromise(describeDevtoolsCausalGraphEffect(throwingInput)))
      .rejects.toThrow("lazy snapshot read");
    await expect(Effect.runPromise(describeDevtoolsPanelsEffect(throwingInput)))
      .rejects.toThrow("lazy snapshot read");
    await expect(Effect.runPromise(renderDevtoolsPanelsHtmlEffect(throwingInput)))
      .rejects.toThrow("lazy snapshot read");
  });

  it("renders legacy app graph route modules without preload collection diagnostics", () => {
    const legacyRouteModule = { ...appGraphDiagnostics.routeModules[0]! };
    delete (legacyRouteModule as { preloadCollections?: unknown }).preloadCollections;
    const panels = describeDevtoolsPanels({
      appGraph: {
        ...appGraphDiagnostics,
        routeModules: [
          legacyRouteModule as DevtoolsStartAppGraphDiagnostics["routeModules"][number]
        ]
      }
    });

    expect(panels.panels.find((panel) => panel.id === "app-graph")?.items[0])
      .toMatchObject({
        severity: "warning",
        metrics: expect.arrayContaining([
          {
            label: "preload collections",
            value: "unknown"
          }
        ])
      });
  });

  it("normalizes legacy app graph collection diagnostics across store, panels, and causal graph", () => {
    const legacyRouteModule = { ...appGraphDiagnostics.routeModules[0]! };
    delete (legacyRouteModule as { preloadCollections?: unknown }).preloadCollections;
    const legacyAppGraph = {
      ...appGraphDiagnostics,
      routeModules: [
        legacyRouteModule as DevtoolsStartAppGraphDiagnostics["routeModules"][number]
      ]
    } as DevtoolsStartAppGraphDiagnostics;
    delete (legacyAppGraph as { collectionDefinitions?: unknown }).collectionDefinitions;
    delete (legacyAppGraph as { unknownRoutePreloadCollections?: unknown }).unknownRoutePreloadCollections;
    const store = makeDevtoolsStore();

    store.setAppGraphDiagnostics(legacyAppGraph);

    const snapshotAppGraph = store.getSnapshot().appGraph;
    expect(snapshotAppGraph?.collectionDefinitions).toEqual([]);
    expect(snapshotAppGraph?.unknownRoutePreloadCollections).toEqual([]);
    expect(snapshotAppGraph?.routeModules[0]?.preloadCollections).toEqual({
      status: "unknown",
      collections: []
    });
    const summary = store.getSummary();
    expect(summary.overview.collectionDefinitionCount).toBe(0);
    expect(summary.overview.unknownRoutePreloadCollectionsCount).toBe(0);
    expect(summary.graph._tag).toBe("Available");
    if (summary.graph._tag !== "Available") {
      expect.fail("Expected normalized app graph summary.");
    }
    expect(summary.graph.routes.modules[0]?.preloadCollections).toEqual({
      status: "unknown",
      collections: []
    });
    const appGraphPanelItem = store
      .getPanels()
      .panels.find((panel) => panel.id === "app-graph")
      ?.items[0];
    expect(appGraphPanelItem).toMatchObject({
      severity: "warning",
      metrics: expect.arrayContaining([
        {
          label: "preload collections",
          value: "unknown"
        }
      ])
    });
    const routeNode = store.getCausalGraph().nodes.find((node) =>
      node.kind === "Route" &&
      node.label === appGraphDiagnostics.routeModules[0]!.routePath
    );
    expect(routeNode?.data).toMatchObject({
      preloadCollections: {
        status: "unknown",
        collections: []
      }
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

    await Effect.runPromise(Resource.prefetchEffect(ref));

    const routePlan = describeRoutePlan(
      await Effect.runPromise(Route.planNavigationEffect([UserRoute] as const, "/users/1"))
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
        kind: "Observes",
        source: "runtime-event:2:Invalidation",
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
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "resource-family:User.summary-devtools",
        kind: "ResourceFamily",
        data: expect.objectContaining({
          name: "User.summary-devtools",
          inputSchema: true,
          outputSchema: true,
          providesTags: true,
          policy: {
            staleFor: "30 seconds",
            gcFor: "5 minutes",
            retry: true
          }
        })
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

  it("links route hydration edges only to hydrated resources", () => {
    const routePlan: DevtoolsRoutePlan = {
      _tag: "Matched",
      href: "/projects/atlas",
      match: {
        path: "/projects/:id",
        href: "/projects/atlas",
        params: { id: "atlas" },
        search: {}
      },
      resources: [
        {
          key: "Project:atlas",
          family: "Project",
          input: { id: "atlas" }
        },
        {
          key: "Owner:ada",
          family: "Owner",
          input: { id: "ada" }
        }
      ],
      hydration: {
        resourceCount: 1,
        resourceKeys: ["Project:atlas"]
      }
    };
    const summary = describeDevtoolsSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [routePlan]
      }
    });

    expect(summary.routes.plans[0]?.hydratedResourceKeys).toEqual(["Project:atlas"]);
    expect(
      summary.causalGraph.edges
        .filter((edge) => edge.kind === "Hydrates")
        .map((edge) => edge.target)
    ).toEqual(["resource:Project:atlas"]);
  });

  it("does not infer hydration identity from count-only route-plan facts", () => {
    const routePlan: DevtoolsRoutePlan = {
      _tag: "Matched",
      href: "/projects/atlas",
      match: {
        path: "/projects/:id",
        href: "/projects/atlas",
        params: { id: "atlas" },
        search: {}
      },
      resources: [
        {
          key: "Project:atlas",
          family: "Project",
          input: { id: "atlas" }
        }
      ],
      hydration: {
        resourceCount: 1
      }
    };
    const summary = describeDevtoolsSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [routePlan]
      }
    });

    expect(summary.routes.plans[0]?.hydrationResourceCount).toBe(1);
    expect(summary.routes.plans[0]?.hydratedResourceKeys).toEqual([]);
    expect(summary.causalGraph.edges.some((edge) => edge.kind === "Hydrates")).toBe(false);
  });

  it("keeps Ref invalidation targets under the Resource causal node kind", () => {
    const invalidationPlan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "project:atlas",
          family: "Project",
          input: {
            id: "atlas"
          }
        }
      ],
      entries: []
    };
    const graph = describeDevtoolsCausalGraph({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [invalidationPlan],
        routePlans: []
      }
    });

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "resource:project:atlas",
        kind: "Resource"
      })
    );
    expect(graph.nodes).not.toContainEqual(
      expect.objectContaining({
        id: "resource:project:atlas",
        kind: "InvalidationTarget"
      })
    );
  });

  it("links runtime events to existing invalidation and route-plan facts", async () => {
    const RuntimeTargetTag = Resource.tag("Runtime.target-devtools");
    const RuntimeTargetRoute = route("/runtime-targets/:id", {});
    const routePlan = describeRoutePlan(
      await Effect.runPromise(
        Route.planNavigationEffect([RuntimeTargetRoute] as const, "/runtime-targets/1")
      )
    );
    const invalidationPlan = describeInvalidationPlan(
      Resource.planInvalidation(RuntimeTargetTag)
    );
    const summary = describeDevtoolsSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [invalidationPlan],
        routePlans: [routePlan],
        events: [
          {
            _tag: "Custom",
            sequence: 0,
            name: "before"
          },
          {
            _tag: "Invalidation",
            sequence: 1,
            plan: invalidationPlan
          },
          {
            _tag: "RoutePlan",
            sequence: 2,
            plan: routePlan
          }
        ]
      }
    });

    expect(summary.runtime.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: "Invalidation",
        target: {
          kind: "InvalidationPlan",
          id: "invalidation:0"
        }
      }),
      expect.objectContaining({
        _tag: "RoutePlan",
        target: {
          kind: "RoutePlan",
          id: "route-plan:0:/runtime-targets/1"
        }
      })
    ]));
    expect(summary.causalGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:Invalidation",
        target: "invalidation:0"
      }),
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:2:RoutePlan",
        target: "route-plan:0:/runtime-targets/1"
      })
    ]));
    expect(summary.causalGraph.edges.filter((edge) =>
      edge.kind === "Matches" &&
      edge.source === "route-plan:0:/runtime-targets/1"
    )).toHaveLength(1);
    expect(summary.causalGraph.nodes).not.toContainEqual(
      expect.objectContaining({ id: "invalidation:1" })
    );
    expect(summary.causalGraph.nodes).not.toContainEqual(
      expect.objectContaining({ id: "route-plan:2:/runtime-targets/1" })
    );
  });

  it("allocates unmatched runtime event fact targets after recorded facts", async () => {
    const FirstTag = Resource.tag("Runtime.recorded-target-devtools");
    const SecondTag = Resource.tag("Runtime.recorded-other-devtools");
    const MissingTag = Resource.tag<{ readonly id: string }>("Runtime.unrecorded-target-devtools", {
      key: ({ id }) => id
    });
    const MissingResource = Resource.family({
      name: "Runtime.unrecorded-resource-devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (value) => [MissingTag({ id: value.id })]
    });
    const FirstRoute = route("/runtime-recorded/:id", {});
    const SecondRoute = route("/runtime-recorded-other/:id", {});
    const MissingRoute = route("/runtime-unrecorded/:id", {
      preload: ({ params }) => Resource.prefetchEffect(MissingResource(params.id))
    });
    const recordedRoutePlans = await Effect.runPromise(
      Effect.all([
        Route.planNavigationEffect([FirstRoute] as const, "/runtime-recorded/1"),
        Route.planNavigationEffect([SecondRoute] as const, "/runtime-recorded-other/2")
      ])
    );
    const missingRoutePlan = await Effect.runPromise(
      Route.planNavigationEffect([MissingRoute] as const, "/runtime-unrecorded/3")
    );
    const missingInvalidationPlan = describeInvalidationPlan(
      Resource.planInvalidation(MissingTag({ id: "3" }))
    );
    const missingRouteSummary = describeRoutePlan(missingRoutePlan);
    const missingResourceKey = MissingResource("3").key;
    const missingResourceId = `resource:${missingResourceKey}`;
    const missingTargetId = `resource-tag:${missingInvalidationPlan.targets[0]!.key}`;
    const recordedInvalidations = [
      describeInvalidationPlan(Resource.planInvalidation(FirstTag)),
      describeInvalidationPlan(Resource.planInvalidation(SecondTag))
    ];
    const summary = describeDevtoolsSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: recordedInvalidations,
        routePlans: recordedRoutePlans.map(describeRoutePlan),
        events: [
          {
            _tag: "Invalidation",
            sequence: 0,
            plan: missingInvalidationPlan
          },
          {
            _tag: "RoutePlan",
            sequence: 1,
            plan: missingRouteSummary
          }
        ]
      }
    });

    expect(summary.runtime.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: "Invalidation",
        target: {
          kind: "InvalidationPlan",
          id: "invalidation:2"
        }
      }),
      expect.objectContaining({
        _tag: "RoutePlan",
        target: {
          kind: "RoutePlan",
          id: "route-plan:3:/runtime-unrecorded/3"
        }
      })
    ]));
    expect(summary.resources).toEqual([
      {
        key: missingResourceKey,
        family: "Runtime.unrecorded-resource-devtools",
        input: "3",
        state: null,
        sources: ["Invalidation", "RoutePlan"],
        routeHrefs: ["/runtime-unrecorded/3"],
        invalidationIndexes: [2]
      }
    ]);
    expect(describeDevtoolsPanels({ summary }).panels.find((panel) => panel.id === "resources")).toMatchObject({
      items: [
        expect.objectContaining({
          id: missingResourceId,
          label: "Runtime.unrecorded-resource-devtools",
          detail: "unknown",
          metrics: [
            { label: "routes", value: 1 },
            { label: "invalidations", value: 1 }
          ]
        })
      ]
    });
    expect(summary.causalGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "Targets",
        source: "invalidation:2",
        target: missingTargetId
      }),
      expect.objectContaining({
        kind: "Invalidates",
        source: "invalidation:2",
        target: missingResourceId
      }),
      expect.objectContaining({
        kind: "Causes",
        source: missingTargetId,
        target: missingResourceId
      }),
      expect.objectContaining({
        kind: "Matches",
        source: "route-plan:3:/runtime-unrecorded/3",
        target: "route:/runtime-unrecorded/:id"
      }),
      expect.objectContaining({
        kind: "Preloads",
        source: "route-plan:3:/runtime-unrecorded/3",
        target: missingResourceId
      }),
      expect.objectContaining({
        kind: "Hydrates",
        source: "route-plan:3:/runtime-unrecorded/3",
        target: missingResourceId
      })
    ]));
  });

  it("links request-embedded route plans to matching recorded route-plan facts", async () => {
    const OtherRoute = route("/request-route-other/:id", {});
    const RequestTargetRoute = route("/request-route-targets/:a/:b", {});
    const otherPlan = describeRoutePlan(
      await Effect.runPromise(
        Route.planNavigationEffect([OtherRoute] as const, "/request-route-other/1")
      )
    );
    const routePlan = describeRoutePlan(
      await Effect.runPromise(
        Route.planNavigationEffect([RequestTargetRoute] as const, "/request-route-targets/1/2")
      )
    );
    const requestRoutePlan = routePlan._tag === "Matched"
      ? {
          ...routePlan,
          match: {
            ...routePlan.match,
            params: { b: "2", a: "1" }
          }
        }
      : routePlan;
    const summary = describeDevtoolsSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [otherPlan, routePlan],
        requestTraces: [
          {
            request: {
              id: "req-route-target",
              method: "GET",
              url: "https://example.test/request-route-targets/1/2",
              path: "/request-route-targets/1/2",
              transport: "ssr"
            },
            response: { status: 200 },
            services: [],
            routePlan: requestRoutePlan,
            resources: [],
            collections: [],
            serverFunctions: [],
            actions: [],
            fibers: [],
            streams: [],
            status: "success"
          }
        ]
      }
    });

    expect(summary.causalGraph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:req-route-target",
        target: "route-plan:1:/request-route-targets/1/2"
      })
    );
    expect(summary.causalGraph.nodes).not.toContainEqual(
      expect.objectContaining({ id: "route-plan:0:/request-route-targets/1/2" })
    );
  });

  it("keeps request-embedded route-plan identity disjoint from recorded plans with the same href", () => {
    const recordedPlan: DevtoolsRoutePlan = {
      _tag: "Matched",
      href: "/same-route",
      match: {
        path: "/same-route",
        href: "/same-route",
        params: {},
        search: {}
      },
      resources: [
        {
          key: "Recorded:1",
          family: "Recorded",
          input: null
        }
      ],
      hydration: {
        resourceCount: 0
      }
    };
    const embeddedPlan: DevtoolsRoutePlan = {
      ...recordedPlan,
      resources: [
        {
          key: "Embedded:1",
          family: "Embedded",
          input: null
        }
      ]
    };
    const summary = describeDevtoolsSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [recordedPlan],
        requestTraces: [
          {
            request: {
              id: "request-with-colliding-plan",
              method: "GET",
              url: "https://example.test/same-route",
              path: "/same-route",
              transport: "ssr"
            },
            services: [],
            routePlan: embeddedPlan,
            resources: [],
            collections: [],
            serverFunctions: [],
            actions: [],
            fibers: [],
            streams: [],
            status: "success"
          }
        ]
      }
    });

    expect(summary.causalGraph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "route-plan:0:/same-route" }),
      expect.objectContaining({ id: "route-plan:1:/same-route" })
    ]));
    expect(summary.causalGraph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:request-with-colliding-plan",
        target: "route-plan:1:/same-route"
      })
    );
    expect(summary.causalGraph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Preloads",
        source: "route-plan:1:/same-route",
        target: "resource:Embedded:1"
      })
    );
  });

  it("keeps causal edge ids stable when unrelated facts are inserted first", () => {
    const snapshot = {
      resources: [],
      actions: [],
      invalidations: [],
      routePlans: [],
      events: [
        {
          _tag: "ResourceStoreEvent" as const,
          sequence: 0,
          event: {
            _tag: "ResourceSuccess" as const,
            name: "Stable.edge-devtools",
            key: "Stable.edge-devtools:1",
            updatedAt: 1
          }
        }
      ]
    };
    const baseGraph = describeDevtoolsCausalGraph({ snapshot });
    const graphWithAppFacts = describeDevtoolsCausalGraph({
      appGraph: appGraphDiagnostics,
      snapshot
    });
    const observedEdge = {
      kind: "Observes",
      source: "runtime-event:0:ResourceStoreEvent",
      target: "resource:Stable.edge-devtools:1"
    } as const;

    const baseId = baseGraph.edges.find((edge) =>
      edge.kind === observedEdge.kind &&
      edge.source === observedEdge.source &&
      edge.target === observedEdge.target
    )?.id;
    const graphWithAppFactsId = graphWithAppFacts.edges.find((edge) =>
      edge.kind === observedEdge.kind &&
      edge.source === observedEdge.source &&
      edge.target === observedEdge.target
    )?.id;

    expect(baseId).toBeDefined();
    expect(graphWithAppFactsId).toBe(baseId);
  });

  it("frames causal edge id parts so source and target delimiters cannot collide", () => {
    const requestTrace = (
      id: string,
      resourceKey: string
    ): DevtoolsRequestTrace => ({
      request: {
        id,
        method: "GET",
        url: `https://example.test/${id}`,
        path: `/${id}`,
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [
        {
          key: resourceKey,
          family: "Project",
          state: "Success"
        }
      ],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    });
    const graph = describeDevtoolsCausalGraph({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        requestTraces: [
          requestTrace("a", "b->resource:c"),
          requestTrace("a->resource:b", "c")
        ]
      }
    });
    const collidingRecordsEdges = graph.edges.filter((edge) =>
      edge.kind === "Records" &&
      edge.source.startsWith("request-trace:") &&
      edge.target.startsWith("resource:")
    );

    expect(collidingRecordsEdges).toHaveLength(2);
    expect(new Set(collidingRecordsEdges.map((edge) => edge.id)).size).toBe(2);
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

  it("applies a safe serialization policy to complex values", () => {
    const throwingGetter: Record<string, unknown> = {};
    Object.defineProperty(throwingGetter, "bad", {
      enumerable: true,
      get() {
        throw new Error("getter exploded");
      }
    });

    expect(toDevtoolsSerializableValue(new Map([["a", 1]]))).toEqual({
      _tag: "Map",
      size: 1,
      entries: [["a", 1]]
    });
    expect(toDevtoolsSerializableValue(new Set(["x"]))).toEqual({
      _tag: "Set",
      size: 1,
      values: ["x"]
    });
    expect(toDevtoolsSerializableValue(new Error("boom"))).toMatchObject({
      _tag: "Error",
      name: "Error",
      message: "boom"
    });
    expect(toDevtoolsSerializableValue(throwingGetter)).toEqual({
      bad: {
        _tag: "Accessor"
      }
    });
    const hostileRecord = new Proxy<Record<string, unknown>>({}, {
      ownKeys: () => {
        throw new Error("own keys failed");
      }
    });
    const hostileMap = new Proxy(new Map([["a", 1]]), {
      get: (target, property, receiver) => {
        if (property === "size") {
          throw new Error("map size failed");
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const hostileArray = new Proxy(["a"], {
      get: (target, property, receiver) => {
        if (property === "0") {
          throw new Error("array item failed");
        }
        return Reflect.get(target, property, receiver);
      }
    });

    expect(() => toDevtoolsSerializableValue(hostileRecord)).not.toThrow();
    expect(toDevtoolsSerializableValue(hostileRecord)).toMatchObject({
      _tag: "UninspectableObject",
      message: "own keys failed"
    });
    expect(() => toDevtoolsSerializableValue(hostileMap)).not.toThrow();
    expect(toDevtoolsSerializableValue(hostileMap)).toMatchObject({
      _tag: "UninspectableObject"
    });
    expect(() => toDevtoolsSerializableValue(hostileArray)).not.toThrow();
    expect(toDevtoolsSerializableValue(hostileArray)).toMatchObject({
      _tag: "UninspectableObject",
      message: "array item failed"
    });
    expect(toDevtoolsSerializableValue(["a", "b", "c"], { maxEntries: 2 })).toEqual([
      "a",
      "b",
      {
        _tag: "Truncated",
        remaining: 1
      }
    ]);
    const accessed: Array<string> = [];
    const boundedArray = new Proxy(["a", "b", "c"], {
      get: (target, property, receiver) => {
        accessed.push(String(property));
        if (property === "1") {
          throw new Error("serializer crossed the entry bound");
        }
        return Reflect.get(target, property, receiver);
      }
    });
    expect(toDevtoolsSerializableValue(boundedArray, { maxEntries: 1 })).toEqual([
      "a",
      {
        _tag: "Truncated",
        remaining: 2
      }
    ]);
    expect(accessed).not.toContain("1");
    expect(toDevtoolsSerializableValue("abcdef", { maxStringLength: 3 })).toEqual({
      _tag: "TruncatedString",
      length: 6,
      value: "abc"
    });
  });

  it("normalizes unsafe serialization policy bounds", () => {
    const longArray = Array.from({ length: 55 }, (_, index) => index);

    expect(toDevtoolsSerializableValue({ nested: { value: 1 } }, { maxDepth: 1.8 })).toEqual({
      nested: {
        _tag: "MaxDepth"
      }
    });
    expect(toDevtoolsSerializableValue(["a", "b", "c"], { maxEntries: 1.8 })).toEqual([
      "a",
      {
        _tag: "Truncated",
        remaining: 2
      }
    ]);
    expect(toDevtoolsSerializableValue("abcdef", { maxStringLength: 3.8 })).toEqual({
      _tag: "TruncatedString",
      length: 6,
      value: "abc"
    });
    expect(toDevtoolsSerializableValue("abcdef", { maxStringLength: -1 })).toBe("abcdef");
    expect(toDevtoolsSerializableValue(longArray, { maxEntries: Number.POSITIVE_INFINITY })).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      {
        _tag: "Truncated",
        remaining: 5
      }
    ]);
    expect(toDevtoolsSerializableValue({ nested: { value: 1 } }, { maxDepth: Number.NaN })).toEqual({
      nested: {
        value: 1
      }
    });
  });

  it("detaches stored Error and byte-view payloads before serialization", () => {
    const store = makeDevtoolsStore();
    const error = new TypeError("before");
    (error as Error & { extra?: { readonly nested: { value: number } } }).extra = {
      nested: { value: 1 }
    };
    const bytes = new Uint8Array([1, 2, 3]);
    const buffer = Buffer.from([4, 5, 6]);

    store.recordRuntimeEvent({
      _tag: "Custom",
      name: "Devtools.detached-payload",
      payload: {
        error,
        bytes,
        buffer
      }
    });

    error.message = "after";
    (error as Error & { extra: { nested: { value: number } } }).extra.nested.value = 2;
    bytes[0] = 9;
    buffer[0] = 9;

    const event = store.getSnapshot().events?.[0];
    expect(event?._tag).toBe("Custom");
    const payload = event?._tag === "Custom"
      ? event.payload as {
          readonly error: { readonly name: string; readonly message: string; readonly extra: { readonly nested: { readonly value: number } } };
          readonly bytes: Uint8Array;
          readonly buffer: Buffer;
        }
      : undefined;

    expect(payload?.error).toMatchObject({
      name: "TypeError",
      message: "before",
      extra: {
        nested: { value: 1 }
      }
    });
    expect([...payload!.bytes]).toEqual([1, 2, 3]);
    expect([...payload!.buffer]).toEqual([4, 5, 6]);
    expect(toDevtoolsSerializableValue(payload?.error)).toMatchObject({
      name: "TypeError",
      message: "before",
      extra: {
        nested: { value: 1 }
      }
    });
  });

  it("guards hostile array proxies while detaching stored payloads", () => {
    const store = makeDevtoolsStore();
    const hostileArray = new Proxy(["a"], {
      get: (target, property, receiver) => {
        if (property === "0") {
          throw new Error("array item failed");
        }
        return Reflect.get(target, property, receiver);
      }
    });

    expect(() =>
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "Devtools.hostile-array",
        payload: hostileArray
      })
    ).not.toThrow();

    const event = store.getSnapshot().events?.[0];
    expect(event).toMatchObject({
      _tag: "Custom",
      payload: {
        _tag: "UninspectableObject"
      }
    });
  });

  it("bounds deeply nested custom runtime payloads while detaching", () => {
    const store = makeDevtoolsStore();
    let payload: Record<string, unknown> = { value: "leaf" };
    for (let index = 0; index < 20_000; index++) {
      payload = { child: payload };
    }

    expect(() =>
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "Devtools.deep-payload",
        payload
      })
    ).not.toThrow();

    const event = store.getSnapshot().events?.[0];
    expect(event?._tag).toBe("Custom");
    let cursor = event?._tag === "Custom" ? event.payload : undefined;
    for (let depth = 0; depth < 8; depth++) {
      cursor = (cursor as { readonly child?: unknown }).child;
    }
    expect(cursor).toEqual({
      _tag: "MaxDepth"
    });
  });

  it("truncates large arrays and maps while detaching stored payloads", () => {
    const store = makeDevtoolsStore();
    const accessedArrayIndexes: Array<string> = [];
    const largeArray = new Proxy(Array.from({ length: 55 }, (_, index) => index), {
      get: (target, property, receiver) => {
        accessedArrayIndexes.push(String(property));
        if (property === "50") {
          throw new Error("array copy crossed the entry bound");
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const largeMap = new Map(Array.from({ length: 55 }, (_, index) => [index, index] as const));
    const originalEntries = largeMap.entries.bind(largeMap);
    let pulledMapEntries = 0;
    Object.defineProperty(largeMap, "entries", {
      value: (): IterableIterator<[number, number]> => {
        const iterator = originalEntries();
        const guardedIterator: IterableIterator<[number, number]> = {
          next: () => {
            if (pulledMapEntries >= 50) {
              throw new Error("map copy crossed the entry bound");
            }
            pulledMapEntries += 1;
            return iterator.next();
          },
          [Symbol.iterator]: () => guardedIterator
        };
        return guardedIterator;
      }
    });

    expect(() =>
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "Devtools.large-payload",
        payload: {
          largeArray,
          largeMap
        }
      })
    ).not.toThrow();

    const event = store.getSnapshot().events?.[0];
    const payload = event?._tag === "Custom"
      ? event.payload as {
          readonly largeArray: ReadonlyArray<unknown>;
          readonly largeMap: Map<number, number>;
        }
      : undefined;

    expect(payload?.largeArray).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      {
        _tag: "Truncated",
        remaining: 5
      }
    ]);
    expect(toDevtoolsSerializableValue(payload?.largeArray)).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      {
        _tag: "Truncated",
        remaining: 5
      }
    ]);
    expect(accessedArrayIndexes).not.toContain("50");
    expect(payload?.largeMap).toBeInstanceOf(Map);
    expect([...(payload?.largeMap.entries() ?? [])]).toEqual(
      Array.from({ length: 50 }, (_, index) => [index, index])
    );
    expect(pulledMapEntries).toBe(50);
    expect(toDevtoolsSerializableValue(payload?.largeMap)).toEqual({
      _tag: "Map",
      size: 55,
      entries: [
        ...Array.from({ length: 50 }, (_, index) => [index, index]),
        {
          _tag: "Truncated",
          remaining: 5
        }
      ]
    });
  });

  it("copies ArrayBuffer payloads and serializes inspectable bytes", () => {
    const store = makeDevtoolsStore();
    const buffer = new ArrayBuffer(3);
    const bytes = new Uint8Array(buffer);
    bytes.set([4, 5, 6]);

    store.recordRuntimeEvent({
      _tag: "Custom",
      name: "Devtools.array-buffer",
      payload: {
        buffer
      }
    });
    bytes[0] = 9;

    const event = store.getSnapshot().events?.[0];
    const copiedBuffer = event?._tag === "Custom"
      ? (event.payload as { readonly buffer: ArrayBuffer }).buffer
      : undefined;

    expect(copiedBuffer).toBeInstanceOf(ArrayBuffer);
    expect(copiedBuffer).not.toBe(buffer);
    expect([...new Uint8Array(copiedBuffer!)]).toEqual([4, 5, 6]);
    expect(toDevtoolsSerializableValue(copiedBuffer)).toEqual({
      _tag: "ArrayBuffer",
      byteLength: 3,
      bytes: [4, 5, 6]
    });
    expect(store.getSummary().runtime.events[0]?.data).toEqual({
      name: "Devtools.array-buffer",
      payload: {
        buffer: {
          _tag: "ArrayBuffer",
          byteLength: 3,
          bytes: [4, 5, 6]
        }
      }
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

  it("detaches store summaries from nested app graph diagnostics", () => {
    const store = makeDevtoolsStore();

    store.setAppGraphDiagnostics(appGraphDiagnostics);
    const summary = store.getSummary();
    if (summary.graph._tag !== "Available") {
      throw new Error("expected available app graph summary");
    }

    (summary.graph.routes.modules[0]!.params[0] as { name: string }).name = "mutated";
    (summary.graph.routes.modules[0]!.preloadResources.families as unknown as string[])[0] = "Mutated.family";

    const next = store.getSummary();
    expect(next.graph).toMatchObject({
      _tag: "Available",
      routes: {
        modules: [
          {
            params: [
              {
                name: "id"
              }
            ],
            preloadResources: {
              families: ["User.summary-devtools"]
            }
          }
        ]
      }
    });
  });

  it("preserves huge app graph route module arrays through summaries, panels, store copies, and bridge windows", () => {
    const appGraph = appGraphDiagnosticsWithRoutes(1_001);
    const summary = describeDevtoolsSummary({ appGraph });
    const panels = describeDevtoolsPanels({ appGraph });
    const store = makeDevtoolsStore();

    store.setAppGraphDiagnostics(appGraph);

    expect(summary.overview.routeCount).toBe(1_001);
    expect(summary.graph).toMatchObject({
      _tag: "Available",
      routes: {
        paths: expect.arrayContaining(["/users/1000/:id"])
      }
    });
    if (summary.graph._tag !== "Available") {
      expect.fail("expected available app graph summary");
    }
    expect(summary.graph.routes.modules).toHaveLength(1_001);
    expect(summary.graph.routes.modules[1000]).toMatchObject({
      routeId: "route_users_1000_$id",
      routePath: "/users/1000/:id"
    });

    const appGraphPanel = panels.panels.find((panel) => panel.id === "app-graph");
    expect(appGraphPanel?.items).toHaveLength(1_001);
    expect(appGraphPanel?.items[1000]).toMatchObject({
      id: "route:route_users_1000_$id",
      label: "/users/1000/:id"
    });
    expect(isDevtoolsPanels(panels)).toBe(true);
    const bridgeAppGraphPanel = normalizeEffectUiDevtoolsBridgePayload({ panels })
      ?.panels.panels.find((panel) => panel.id === "app-graph");
    expect(bridgeAppGraphPanel?.items).toHaveLength(1_000);
    expect(bridgeAppGraphPanel?.items[998]).toMatchObject({
      id: "route:route_users_998_$id",
      label: "/users/998/:id"
    });
    expect(bridgeAppGraphPanel?.items[999]).toMatchObject({
      id: "__effect-ui-devtools-overflow:app-graph",
      label: "2 panel items hidden",
      severity: "info",
      metrics: [
        { label: "shown", value: 999 },
        { label: "hidden", value: 2 },
        { label: "total", value: 1_001 }
      ],
      data: {
        total: 1_001,
        shown: 999,
        hidden: 2
      }
    });
    const defaultRenderedHtml = renderDevtoolsPanelsHtml({
      panels,
      selectedPanelId: "app-graph"
    });
    expect(defaultRenderedHtml).toContain(
      "data-effect-ui-devtools-item-id=\"__effect-ui-devtools-overflow:app-graph\""
    );
    expect(defaultRenderedHtml).toContain("&quot;total&quot;: 1001");
    expect(defaultRenderedHtml).toContain("&quot;shown&quot;: 999");
    expect(defaultRenderedHtml).toContain("&quot;hidden&quot;: 2");

    const snapshotRouteModules = store.getSnapshot().appGraph?.routeModules;
    expect(snapshotRouteModules).toHaveLength(1_001);
    expect(snapshotRouteModules?.some((routeModule) =>
      (routeModule as { readonly _tag?: unknown })._tag === "Truncated"
    )).toBe(false);
    expect(store.getSummary().graph).toMatchObject({
      _tag: "Available",
      routes: {
        modules: expect.arrayContaining([
          expect.objectContaining({
            routeId: "route_users_1000_$id"
          })
        ])
      }
    });
    expect(isDevtoolsPanels(store.getPanels())).toBe(true);
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

  it("projects resource and collection runtime events into their panels", () => {
    const store = makeDevtoolsStore();

    store.recordResourceEvent({
      _tag: "ResourceSuccess",
      name: "Project.runtime-resource",
      key: "Project.runtime-resource:atlas",
      updatedAt: 1
    });
    store.recordCollectionEvent({
      _tag: "CollectionLoadFailure",
      collection: "Project.runtime-collection",
      error: new Error("offline")
    });

    const summary = store.getSummary();
    expect(summary.resources).toEqual([
      expect.objectContaining({
        key: "Project.runtime-resource:atlas",
        family: "Project.runtime-resource",
        state: "Success",
        sources: ["RuntimeEvent"]
      })
    ]);

    const panels = store.getPanels();
    expect(panels.panels.find((panel) => panel.id === "resources")).toMatchObject({
      severity: "ok",
      items: [
        expect.objectContaining({
          id: "resource:Project.runtime-resource:atlas",
          label: "Project.runtime-resource",
          detail: "Success"
        })
      ]
    });
    expect(panels.panels.find((panel) => panel.id === "collections")).toMatchObject({
      severity: "error",
      items: [
        expect.objectContaining({
          id: "collection:Project.runtime-collection",
          label: "Project.runtime-collection",
          detail: "CollectionLoadFailure",
          severity: "error",
          metrics: [
            { label: "events", value: 1 }
          ]
        })
      ]
    });
  });

  it("records change-feed collection failures with detached errors", () => {
    const store = makeDevtoolsStore();
    const error = { message: "feed failed" };

    store.recordCollectionEvent({
      _tag: "CollectionChangeFeedFailure",
      collection: "Projects.collection-feed",
      error
    });
    error.message = "mutated";

    const snapshot = store.getSnapshot();
    const event = snapshot.events[0];

    expect(event).toMatchObject({
      _tag: "CollectionStoreEvent",
      event: {
        _tag: "CollectionChangeFeedFailure",
        collection: "Projects.collection-feed",
        error: {
          message: "feed failed"
        }
      }
    });
    expect(store.getSummary().runtime.events[0]).toMatchObject({
      _tag: "CollectionStoreEvent",
      label: "CollectionChangeFeedFailure",
      target: {
        kind: "Collection",
        id: "collection:Projects.collection-feed"
      }
    });
  });

  it("redacts sensitive request trace headers and cookies before storage and projection", () => {
    const store = makeDevtoolsStore();
    const trace: DevtoolsRequestTrace = {
      request: {
        id: "req-sensitive",
        method: "POST",
        url: "https://example.test/projects/secret",
        path: "/projects/secret",
        transport: "rpc",
        headers: [
          { name: "accept", value: "application/json" },
          { name: "authorization", value: "Bearer raw-secret" },
          { name: "cookie", value: "sid=raw-cookie; theme=dark" },
          { name: "x-api-key", value: "raw-api-key" }
        ],
        cookies: [
          { name: "theme", value: "dark" },
          { name: "session", value: "raw-session" },
          { name: "csrfToken", value: "raw-csrf" }
        ]
      },
      response: {
        status: 200,
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "set-cookie", value: "sid=raw-set-cookie; Path=/" },
          { name: "x-api-key", value: "raw-response-key" }
        ]
      },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    };

    store.recordRequestTrace(trace);

    const snapshot = store.getSnapshot();
    const storedTrace = snapshot.requestTraces?.[0];
    expect(storedTrace?.request.headers).toEqual(expect.arrayContaining([
      { name: "accept", value: "application/json" },
      { name: "[redacted]", value: "[redacted]" }
    ]));
    expect(storedTrace?.request.headers?.filter((header) => header.name === "[redacted]"))
      .toHaveLength(3);
    expect(storedTrace?.response?.headers).toEqual(expect.arrayContaining([
      { name: "content-type", value: "application/json" },
      { name: "[redacted]", value: "[redacted]" }
    ]));
    expect(storedTrace?.response?.headers?.filter((header) => header.name === "[redacted]"))
      .toHaveLength(2);
    expect(storedTrace?.request.cookies).toEqual(expect.arrayContaining([
      { name: "theme", value: "[redacted]" },
      { name: "[redacted]", value: "[redacted]" }
    ]));
    expect(storedTrace?.request.cookies?.every((cookie) => cookie.value === "[redacted]"))
      .toBe(true);
    expect(storedTrace?.request.cookies?.filter((cookie) => cookie.name === "[redacted]"))
      .toHaveLength(2);

    const projections = [
      snapshot,
      store.getSummary(),
      store.getPanels(),
      store.getCausalGraph()
    ];
    for (const projection of projections) {
      const projected = JSON.stringify(projection).toLowerCase();
      for (const raw of [
        "authorization",
        "bearer raw-secret",
        "sid=raw-cookie",
        "x-api-key",
        "raw-api-key",
        "set-cookie",
        "raw-set-cookie",
        "raw-response-key",
        "raw-session",
        "raw-csrf"
      ]) {
        expect(projected).not.toContain(raw);
      }
    }
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
          { name: "[redacted]", value: "[redacted]" }
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
          resourceCount: 1,
          resourceKeys: ["Project.byId:atlas"]
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
        failureKind: null,
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
        teardownAt: 123,
        teardownStartedAt: 100,
        teardownCompletedAt: 123,
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
        },
        beforeDisposeFiberCount: 2,
        afterDisposeFiberCount: 0,
        serverFunctions: [
          {
            name: "Project.load",
            status: "success",
            failureKind: null
          }
        ],
        actions: [
          {
            name: "Project.rename",
            state: "Success",
            failureKind: null,
            invalidationIndexes: [0]
          }
        ],
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
            },
            {
              label: "before families",
              value: 1
            },
            {
              label: "after modules",
              value: 0
            }
          ]),
          data: expect.objectContaining({
            id: "req-project-atlas",
            failureKind: null,
            routeHref: "/projects/atlas?tab=activity",
            teardownReason: "response-end",
            runtimeDisposed: true,
            teardownAt: 123,
            teardownStartedAt: 100,
            teardownCompletedAt: 123,
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
            },
            serverFunctions: [
              {
                name: "Project.load",
                status: "success",
                failureKind: null
              }
            ],
            actions: [
              {
                name: "Project.rename",
                state: "Success",
                failureKind: null,
                invalidationIndexes: [0]
              }
            ]
          })
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
        target: "route-plan:0:/projects/atlas?tab=activity"
      }),
      expect.objectContaining({
        kind: "Matches",
        source: "route-plan:0:/projects/atlas?tab=activity",
        target: "route:/projects/:id"
      }),
      expect.objectContaining({
        kind: "Preloads",
        source: "route-plan:0:/projects/atlas?tab=activity",
        target: "resource:Project.byId:atlas"
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
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "Hydrates",
        source: "route-plan:0:/projects/atlas?tab=activity",
        target: "resource:Project.byId:atlas"
      })
    ]));
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("projects runtime-only request trace events into request facts and causal records", () => {
    const store = makeDevtoolsStore();
    const trace: DevtoolsRequestTrace = {
      request: {
        id: "req-runtime-only",
        method: "GET",
        url: "https://example.test/projects/runtime-only",
        path: "/projects/runtime-only",
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [
        {
          key: "Project.runtime-only:1",
          family: "Project.runtime-only",
          input: { id: "1" },
          state: "Success"
        }
      ],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    };

    store.recordRuntimeEvent({
      _tag: "RequestTrace",
      trace
    });

    const summary = store.getSummary();
    const requestPanel = store.getPanels().panels.find((panel) => panel.id === "requests");
    const graph = store.getCausalGraph();

    expect(summary.requests.traces).toEqual([
      expect.objectContaining({
        id: "req-runtime-only",
        method: "GET",
        path: "/projects/runtime-only",
        resourceCount: 1
      })
    ]);
    expect(requestPanel?.items).toEqual([
      expect.objectContaining({
        id: "request:req-runtime-only",
        label: "GET /projects/runtime-only"
      })
    ]);
    expect(summary.resources).toEqual([
      expect.objectContaining({
        key: "Project.runtime-only:1",
        family: "Project.runtime-only",
        state: "Success",
        sources: ["RequestTrace"]
      })
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:req-runtime-only",
        target: "resource:Project.runtime-only:1"
      }),
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RequestTrace",
        target: "request-trace:req-runtime-only"
      })
    ]));
  });

  it("preserves request owner failures in summaries and panels", async () => {
    const store = makeDevtoolsStore();
    const trace: DevtoolsRequestTrace = {
      request: {
        id: "req-project-failure",
        method: "POST",
        url: "https://example.test/__effect-ui/action",
        path: "/__effect-ui/action",
        transport: "action"
      },
      services: ["ProjectApi"],
      resources: [],
      collections: [],
      serverFunctions: [
        {
          name: "Project.load",
          status: "failure",
          failureKind: "domain"
        }
      ],
      actions: [
        {
          name: "Project.rename",
          state: "Failure",
          failureKind: "validation",
          invalidationIndexes: [2]
        }
      ],
      fibers: [],
      streams: [],
      status: "failure",
      failureKind: "validation",
      teardown: {
        runtimeDisposed: true,
        reason: "action-end",
        completedAt: 42,
        durationMillis: 12,
        beforeDispose: {
          fiberCount: 1,
          familyCount: 2,
          moduleCount: 3,
          tagCount: 4
        },
        afterDispose: {
          fiberCount: 0,
          familyCount: 2,
          moduleCount: 1,
          tagCount: 4
        }
      }
    };

    await Effect.runPromise(store.recordRequestTraceEffect(trace));

    const summary = store.getSummary();
    expect(summary.requests.traces[0]).toMatchObject({
      failureKind: "validation",
      beforeDispose: {
        fiberCount: 1,
        familyCount: 2,
        moduleCount: 3,
        tagCount: 4
      },
      afterDispose: {
        fiberCount: 0,
        familyCount: 2,
        moduleCount: 1,
        tagCount: 4
      },
      serverFunctions: [
        {
          name: "Project.load",
          status: "failure",
          failureKind: "domain"
        }
      ],
      actions: [
        {
          name: "Project.rename",
          state: "Failure",
          failureKind: "validation",
          invalidationIndexes: [2]
        }
      ]
    });

    const requestPanel = store.getPanels().panels.find((panel) => panel.id === "requests");
    expect(requestPanel?.items[0]).toMatchObject({
      detail: "action failure (validation) server:Project.load:domain, action:Project.rename:validation",
      metrics: expect.arrayContaining([
        {
          label: "server failures",
          value: 1
        },
        {
          label: "action failures",
          value: 1
        },
        {
          label: "before modules",
          value: 3
        },
        {
          label: "after modules",
          value: 1
        }
      ]),
      data: expect.objectContaining({
        serverFunctions: [
          {
            name: "Project.load",
            status: "failure",
            failureKind: "domain"
          }
        ],
        actions: [
          {
            name: "Project.rename",
            state: "Failure",
            failureKind: "validation",
            invalidationIndexes: [2]
          }
        ]
      })
    });
  });

  it("stamps id-less request traces before runtime-event summarization", () => {
    const store = makeDevtoolsStore();
    const trace: DevtoolsRequestTrace = {
      request: {
        method: "GET",
        url: "https://example.test/projects/atlas",
        path: "/projects/atlas",
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    };

    store.recordRuntimeEvent({
      _tag: "Custom",
      sequence: 0,
      name: "before-trace"
    });
    store.recordRequestTrace(trace);

    const snapshot = store.getSnapshot();
    expect(snapshot.requestTraces?.[0]?.request.id).toBe("trace:0");
    expect(snapshot.events?.[1]).toMatchObject({
      _tag: "RequestTrace",
      sequence: 1,
      trace: {
        request: {
          id: "trace:0"
        }
      }
    });

    const graph = store.getCausalGraph();
    expect(graph.nodes.filter((node) => node.kind === "RequestTrace")).toEqual([
      expect.objectContaining({ id: "request-trace:trace:0" })
    ]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:RequestTrace",
        target: "request-trace:trace:0"
      })
    );
  });

  it("normalizes direct id-less request traces before runtime-event graph projection", () => {
    const trace: DevtoolsRequestTrace = {
      request: {
        method: "GET",
        url: "https://example.test/projects/direct",
        path: "/projects/direct",
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    };
    const graph = describeDevtoolsCausalGraph({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        requestTraces: [trace],
        events: [
          {
            _tag: "Custom",
            sequence: 0,
            name: "before"
          },
          {
            _tag: "RequestTrace",
            sequence: 1,
            trace
          }
        ]
      }
    });

    expect(graph.nodes.filter((node) => node.kind === "RequestTrace")).toEqual([
      expect.objectContaining({ id: "request-trace:trace:0" })
    ]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:RequestTrace",
        target: "request-trace:trace:0"
      })
    );
  });

  it("seeds runtime trace id allocation from caller-supplied trace ids", () => {
    const store = makeDevtoolsStore();
    const requestTrace = (
      path: string,
      id?: string
    ): DevtoolsRequestTrace => ({
      request: {
        ...(id === undefined ? {} : { id }),
        method: "GET",
        url: `https://example.test${path}`,
        path,
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    });

    store.recordRequestTrace(requestTrace("/projects/existing", "trace:1"));
    store.recordRequestTrace(requestTrace("/projects/runtime"));

    const snapshot = store.getSnapshot();
    expect(snapshot.requestTraces?.map((trace) => trace.request.id)).toEqual([
      "trace:1",
      "trace:2"
    ]);
    expect(snapshot.events?.map((event) =>
      event._tag === "RequestTrace" ? event.trace.request.id : null
    )).toEqual([
      "trace:1",
      "trace:2"
    ]);
  });

  it("normalizes imported id-less request traces before allocating new trace ids", () => {
    const store = makeDevtoolsStore();
    const requestTrace = (
      path: string,
      id?: string
    ): DevtoolsRequestTrace => ({
      request: {
        ...(id === undefined ? {} : { id }),
        method: "GET",
        url: `https://example.test${path}`,
        path,
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    });
    const importedTrace = requestTrace("/projects/imported");

    store.setSnapshot({
      resources: [],
      actions: [],
      invalidations: [],
      routePlans: [],
      requestTraces: [
        importedTrace,
        requestTrace("/projects/existing", "trace:7")
      ],
      events: [
        {
          _tag: "RequestTrace",
          sequence: 3,
          trace: importedTrace
        }
      ]
    });
    store.recordRequestTrace(requestTrace("/projects/runtime"));

    const snapshot = store.getSnapshot();
    expect(snapshot.requestTraces?.map((trace) => trace.request.id)).toEqual([
      "trace:8",
      "trace:7",
      "trace:9"
    ]);
    expect(snapshot.events?.map((event) =>
      event._tag === "RequestTrace" ? event.trace.request.id : null
    )).toEqual([
      "trace:8",
      "trace:9"
    ]);

    expect(store.getSummary().requests.traces.map((trace) => trace.id)).toEqual([
      "trace:8",
      "trace:7",
      "trace:9"
    ]);
    expect(
      store.getCausalGraph().nodes
        .filter((node) => node.kind === "RequestTrace")
        .map((node) => node.id)
    ).toEqual([
      "request-trace:trace:7",
      "request-trace:trace:8",
      "request-trace:trace:9"
    ]);
    expect(store.getCausalGraph().edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:3:RequestTrace",
        target: "request-trace:trace:8"
      }),
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:4:RequestTrace",
        target: "request-trace:trace:9"
      })
    ]));
  });

  it("normalizes id-less request traces before applying import trace limits", () => {
    const store = makeDevtoolsStore({
      requestTraceLimit: 1,
      eventLimit: 2
    });
    const requestTrace = (resourceKey: string): DevtoolsRequestTrace => ({
      request: {
        method: "GET",
        url: "https://example.test/projects/atlas",
        path: "/projects/atlas",
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [
        {
          key: resourceKey,
          family: "Project",
          input: { id: resourceKey },
          state: "Success"
        }
      ],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    });
    const droppedTrace = requestTrace("Project:dropped");
    const retainedTrace = requestTrace("Project:retained");

    store.setSnapshot({
      resources: [],
      actions: [],
      invalidations: [],
      routePlans: [],
      requestTraces: [droppedTrace, retainedTrace],
      events: [
        {
          _tag: "RequestTrace",
          sequence: 0,
          trace: droppedTrace
        },
        {
          _tag: "RequestTrace",
          sequence: 1,
          trace: retainedTrace
        }
      ]
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.requestTraces?.map((trace) => ({
      id: trace.request.id,
      resourceKey: trace.resources[0]?.key
    }))).toEqual([
      {
        id: "trace:1",
        resourceKey: "Project:retained"
      }
    ]);
    expect(snapshot.events?.filter((event) => event._tag === "RequestTrace").map((event) =>
      event._tag === "RequestTrace"
        ? {
            id: event.trace.request.id,
            resourceKey: event.trace.resources[0]?.key
          }
        : undefined
    )).toEqual([
      {
        id: "trace:0",
        resourceKey: "Project:dropped"
      },
      {
        id: "trace:1",
        resourceKey: "Project:retained"
      }
    ]);

    const graph = store.getCausalGraph();
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RequestTrace",
        target: "request-trace:trace:0"
      })
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:RequestTrace",
        target: "request-trace:trace:1"
      })
    );
    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RequestTrace",
        target: "request-trace:trace:1"
      })
    );
  });

  it("does not detach request traces dropped by import limits", () => {
    const store = makeDevtoolsStore({
      requestTraceLimit: 1
    });
    const droppedTrace = {
      request: {
        method: "GET",
        url: "https://example.test/dropped",
        path: "/dropped",
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      get resources() {
        throw new Error("dropped trace should not be detached");
      },
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    } as DevtoolsRequestTrace;
    const retainedTrace: DevtoolsRequestTrace = {
      request: {
        method: "GET",
        url: "https://example.test/retained",
        path: "/retained",
        transport: "ssr"
      },
      response: { status: 200 },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success"
    };

    expect(() =>
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        requestTraces: [droppedTrace, retainedTrace]
      })
    ).not.toThrow();
    expect(store.getSnapshot().requestTraces?.map((trace) => trace.request.path)).toEqual([
      "/retained"
    ]);
  });

  it("applies store limits and fact rebasing when importing snapshots", () => {
    const store = makeDevtoolsStore({
      invalidationLimit: 1,
      routePlanLimit: 1,
      requestTraceLimit: 1,
      eventLimit: 2
    });
    const firstInvalidation: DevtoolsInvalidationPlan = {
      targets: [{ _tag: "Tag", key: "First", name: "First" }],
      entries: []
    };
    const secondInvalidation: DevtoolsInvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Second", name: "Second" }],
      entries: []
    };
    const firstRoutePlan: DevtoolsRoutePlan = {
      _tag: "Matched",
      href: "/first",
      match: {
        path: "/first",
        href: "/first",
        params: {},
        search: {}
      },
      resources: [],
      hydration: { resourceCount: 0 }
    };
    const secondRoutePlan: DevtoolsRoutePlan = {
      ...firstRoutePlan,
      href: "/second",
      match: {
        path: "/second",
        href: "/second",
        params: {},
        search: {}
      }
    };
    const requestTrace = (id: string): DevtoolsRequestTrace => ({
      request: {
        id,
        method: "GET",
        url: `https://example.test/${id}`,
        path: `/${id}`,
        transport: "ssr"
      },
      services: [],
      resources: [],
      collections: [],
      serverFunctions: [],
      actions: [
        {
          name: "Project.rename",
          invalidationIndexes: [0, 1]
        }
      ],
      fibers: [],
      streams: [],
      status: "success"
    });

    store.setSnapshot({
      resources: [],
      actions: [
        {
          name: "Project.rename",
          state: "Success",
          invalidationIndexes: [0, 1]
        }
      ],
      invalidations: [firstInvalidation, secondInvalidation],
      routePlans: [firstRoutePlan, secondRoutePlan],
      requestTraces: [requestTrace("trace:0"), requestTrace("trace:1")],
      events: [
        {
          _tag: "Custom",
          sequence: 0,
          name: "dropped"
        },
        {
          _tag: "ActionState",
          sequence: 1,
          action: "Project.rename",
          state: "Success",
          invalidationIndexes: [0, 1]
        },
        {
          _tag: "RoutePlan",
          sequence: 2,
          routePlanIndex: 1,
          plan: secondRoutePlan
        }
      ]
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.invalidations).toEqual([secondInvalidation]);
    expect(snapshot.routePlans).toEqual([secondRoutePlan]);
    expect(snapshot.requestTraces?.map((trace) => trace.request.id)).toEqual(["trace:1"]);
    expect(snapshot.actions[0]?.invalidationIndexes).toEqual([0]);
    expect(snapshot.requestTraces?.[0]?.actions[0]?.invalidationIndexes).toEqual([0]);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        _tag: "ActionState",
        sequence: 1,
        invalidationIndexes: [0]
      }),
      expect.objectContaining({
        _tag: "RoutePlan",
        sequence: 2,
        routePlanIndex: 0
      })
    ]);
  });

  it("returns retained route plan indexes so runtime events can observe duplicate route facts", () => {
    const store = makeDevtoolsStore();
    const plan: DevtoolsRoutePlan = {
      _tag: "Matched",
      href: "/duplicate",
      match: {
        path: "/duplicate",
        href: "/duplicate",
        params: {},
        search: {}
      },
      resources: [],
      hydration: {
        resourceCount: 0
      }
    };
    const invalidationIndex = store.recordSerializedInvalidation({
      targets: [{ _tag: "Tag", key: "Duplicate.Project", name: "Duplicate.Project" }],
      entries: []
    });
    const firstRoutePlanIndex = store.recordSerializedRoutePlan(plan);
    const secondRoutePlanIndex = store.recordSerializedRoutePlan(plan);

    store.recordRuntimeEvent({
      _tag: "RoutePlan",
      routePlanIndex: secondRoutePlanIndex,
      plan
    });

    expect(invalidationIndex).toBe(0);
    expect(firstRoutePlanIndex).toBe(0);
    expect(secondRoutePlanIndex).toBe(1);
    expect(store.getSnapshot().events).toEqual([
      expect.objectContaining({
        _tag: "RoutePlan",
        sequence: 0,
        routePlanIndex: 1
      })
    ]);

    const summary = store.getSummary();
    expect(summary.routes.plans.map((routePlan) => routePlan.index)).toEqual([0, 1]);
    expect(summary.runtime.events[0]).toMatchObject({
      _tag: "RoutePlan",
      target: {
        kind: "RoutePlan",
        id: "route-plan:1:/duplicate"
      },
      routePlan: {
        index: 1,
        href: "/duplicate"
      }
    });
    expect(store.getCausalGraph().edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RoutePlan",
        target: "route-plan:1:/duplicate"
      })
    );
  });

  it("applies import limits before detaching dropped runtime event payloads", () => {
    const store = makeDevtoolsStore({ eventLimit: 1 });
    const droppedPayload: Record<string, unknown> = {};
    Object.defineProperty(droppedPayload, "explode", {
      enumerable: true,
      get() {
        throw new Error("dropped payload should not be inspected");
      }
    });

    expect(() =>
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        events: [
          {
            _tag: "Custom",
            sequence: 0,
            name: "dropped",
            payload: droppedPayload
          },
          {
            _tag: "Custom",
            sequence: 1,
            name: "kept",
            payload: { ok: true }
          }
        ]
      })
    ).not.toThrow();

    expect(store.getSnapshot().events).toEqual([
      {
        _tag: "Custom",
        sequence: 1,
        name: "kept",
        payload: { ok: true }
      }
    ]);
  });

  it("seeds runtime event sequence ids from imported snapshots", () => {
    const store = makeDevtoolsStore();

    store.setSnapshot({
      resources: [],
      actions: [],
      invalidations: [],
      routePlans: [],
      events: [
        {
          _tag: "Custom",
          sequence: 4,
          name: "imported"
        }
      ]
    });
    store.recordRuntimeEvent({
      _tag: "Custom",
      name: "runtime"
    });

    expect(store.getSnapshot().events).toEqual([
      {
        _tag: "Custom",
        sequence: 4,
        name: "imported"
      },
      {
        _tag: "Custom",
        sequence: 5,
        name: "runtime"
      }
    ]);
    expect(store.getCausalGraph().nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-event:4:Custom",
        kind: "RuntimeEvent",
        label: "imported"
      }),
      expect.objectContaining({
        id: "runtime-event:5:Custom",
        kind: "RuntimeEvent",
        label: "runtime"
      })
    ]));
  });

  it("rebases duplicate runtime event sequences imported from snapshots", () => {
    const store = makeDevtoolsStore();

    store.setSnapshot({
      resources: [],
      actions: [],
      invalidations: [],
      routePlans: [],
      events: [
        {
          _tag: "Custom",
          sequence: 0,
          name: "first"
        },
        {
          _tag: "Custom",
          sequence: 0,
          name: "second"
        }
      ]
    });
    store.recordRuntimeEvent({
      _tag: "Custom",
      name: "runtime"
    });

    expect(store.getSnapshot().events).toEqual([
      {
        _tag: "Custom",
        sequence: 0,
        name: "first"
      },
      {
        _tag: "Custom",
        sequence: 1,
        name: "second"
      },
      {
        _tag: "Custom",
        sequence: 2,
        name: "runtime"
      }
    ]);
  });

  it("rebases duplicate caller-supplied runtime event sequences", () => {
    const store = makeDevtoolsStore();

    store.recordRuntimeEvent({
      _tag: "Custom",
      sequence: 0,
      name: "first"
    });
    store.recordRuntimeEvent({
      _tag: "Custom",
      sequence: 0,
      name: "second"
    });

    expect(store.getSnapshot().events).toEqual([
      {
        _tag: "Custom",
        sequence: 0,
        name: "first"
      },
      {
        _tag: "Custom",
        sequence: 1,
        name: "second"
      }
    ]);
    expect(store.getCausalGraph().nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "runtime-event:0:Custom" }),
      expect.objectContaining({ id: "runtime-event:1:Custom" })
    ]));
  });

  it("matches route-plan facts with stable serialized fingerprints", () => {
    const routePlan: DevtoolsRoutePlan = {
      _tag: "Matched",
      href: "/ordered",
      match: {
        path: "/ordered",
        href: "/ordered",
        params: { a: "1", b: "2" },
        search: { x: "1", y: "2" }
      },
      resources: [],
      hydration: { resourceCount: 0 }
    };
    const reorderedRoutePlan: DevtoolsRoutePlan = {
      ...routePlan,
      match: {
        ...routePlan.match,
        params: { b: "2", a: "1" },
        search: { y: "2", x: "1" }
      }
    };
    const store = makeDevtoolsStore();

    store.setSnapshot({
      resources: [],
      actions: [],
      invalidations: [],
      routePlans: [routePlan]
    });
    store.recordRuntimeEvent({
      _tag: "RoutePlan",
      plan: reorderedRoutePlan
    });

    expect(store.getSnapshot().events?.[0]).toMatchObject({
      _tag: "RoutePlan",
      routePlanIndex: 0
    });
    expect(store.getSummary().runtime.events[0]?.target).toEqual({
      kind: "RoutePlan",
      id: "route-plan:0:/ordered"
    });
  });

  it("keeps structural route-plan fact identity bounded", () => {
    const accessedIndexes: Array<string> = [];
    const resources = new Proxy(Array.from({ length: 55 }, (_, index) => ({
      key: `Project:${index}`,
      family: "Project",
      input: { id: String(index) }
    })), {
      get: (target, property, receiver) => {
        accessedIndexes.push(String(property));
        if (property === "50") {
          throw new Error("fact identity crossed the entry bound");
        }
        return Reflect.get(target, property, receiver);
      }
    }) as DevtoolsRoutePlan["resources"];
    const routePlan: DevtoolsRoutePlan = {
      _tag: "Matched",
      href: "/bounded",
      match: {
        path: "/bounded",
        href: "/bounded",
        params: {},
        search: {}
      },
      resources,
      hydration: { resourceCount: 55 }
    };

    const fingerprint = stableFactFingerprint({
      _tag: "RoutePlan",
      plan: routePlan
    });

    expect(fingerprint).toBeDefined();
    expect(accessedIndexes).not.toContain("50");
  });

  it("matches invalidation facts through the bounded serialization policy", () => {
    const store = makeDevtoolsStore();
    const accessedIndexes: Array<string> = [];
    const largeInput = new Proxy(Array.from({ length: 55 }, (_, index) => index), {
      get: (target, property, receiver) => {
        accessedIndexes.push(String(property));
        if (property === "50") {
          throw new Error("fact identity crossed the entry bound");
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const plan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "Project:bounded",
          family: "Project",
          input: largeInput
        }
      ],
      entries: []
    };

    store.setSnapshot({
      resources: [],
      actions: [],
      invalidations: [plan],
      routePlans: []
    });
    store.recordRuntimeEvent({
      _tag: "Invalidation",
      plan
    });

    expect(accessedIndexes).not.toContain("50");
    expect(store.getSnapshot().events?.[0]).toMatchObject({
      _tag: "Invalidation",
      invalidationIndex: 0
    });
  });

  it("detaches caller snapshots at the store seam", () => {
    const store = makeDevtoolsStore();
    const input = { id: "atlas" };
    const plan: DevtoolsInvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "project:atlas",
          family: "Project",
          input
        }
      ],
      entries: []
    };

    store.setSnapshot({
      resources: [],
      actions: [],
      invalidations: [plan],
      routePlans: []
    });
    input.id = "changed-after-set";

    const firstSnapshot = store.getSnapshot();
    const firstTarget = firstSnapshot.invalidations[0]?.targets[0];
    expect(firstTarget).toMatchObject({
      _tag: "Ref",
      input: {
        id: "atlas"
      }
    });
    if (firstTarget?._tag === "Ref") {
      (firstTarget.input as { id: string }).id = "changed-after-read";
    }

    expect(store.getSnapshot().invalidations[0]?.targets[0]).toMatchObject({
      _tag: "Ref",
      input: {
        id: "atlas"
      }
    });
  });

  it("detaches live invalidation and route-plan descriptions at serialization time", async () => {
    const input = { id: "atlas" };
    const Project = Resource.family({
      name: "Devtools.detached-ref",
      load: (projectInput: typeof input) => Effect.succeed(projectInput)
    });
    const routeDefinition = route("/detached-route/:id", {
      search: Schema.Struct({
        tab: Schema.String
      })
    });
    const ref = Project(input);
    const invalidationPlan = describeInvalidationPlan(Resource.planInvalidation(ref));
    const navigationPlan = await Effect.runPromise(
      Route.planNavigationEffect([routeDefinition] as const, "/detached-route/atlas?tab=activity")
    );
    const routePlan = describeRoutePlan(navigationPlan);

    input.id = "changed";
    if (navigationPlan.match !== undefined) {
      (navigationPlan.match.params as { id: string }).id = "changed";
      (navigationPlan.match.search as { tab: string }).tab = "changed";
    }

    expect(invalidationPlan.targets[0]).toMatchObject({
      _tag: "Ref",
      input: {
        id: "atlas"
      }
    });
    expect(routePlan.match).toMatchObject({
      params: {
        id: "atlas"
      },
      search: {
        tab: "activity"
      }
    });
  });

  it("detaches recorded runtime event payloads at the store seam", () => {
    const store = makeDevtoolsStore();
    const payload = {
      nested: {
        count: 1
      }
    };

    store.recordRuntimeEvent({
      _tag: "Custom",
      name: "custom",
      payload
    });
    payload.nested.count = 2;

    const firstEvent = store.getSnapshot().events?.[0];
    expect(firstEvent).toMatchObject({
      _tag: "Custom",
      payload: {
        nested: {
          count: 1
        }
      }
    });
    if (firstEvent?._tag === "Custom") {
      ((firstEvent.payload as { nested: { count: number } }).nested).count = 3;
    }

    expect(store.getSnapshot().events?.[0]).toMatchObject({
      _tag: "Custom",
      payload: {
        nested: {
          count: 1
        }
      }
    });
  });

  it("lets adapters observe snapshots, summaries, events, and causal graphs through Effect", async () => {
    const store = makeDevtoolsStore({ eventLimit: 1 });

    const [snapshot, summary, graph] = await Effect.runPromise(
      Effect.gen(function* () {
        yield* store.setAppGraphDiagnosticsEffect(appGraphDiagnostics);
        yield* store.recordRuntimeEventEffect({
          _tag: "Custom",
          name: "first",
          payload: {
            ignored: true
          }
        });
        yield* store.recordResourceEventEffect({
          _tag: "ResourceSuccess",
          name: "User.effect-devtools",
          key: "User.effect-devtools:1",
          updatedAt: 1
        });

        return yield* Effect.all([
          store.getSnapshotEffect(),
          store.getSummaryEffect(),
          store.getCausalGraphEffect()
        ]);
      })
    );

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

    const [summary, graph] = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* store.setAppGraphDiagnosticsEffect(
            goldenPathAppGraphDiagnostics({
              resourceFamilies: resourceDiagnostics.families.filter((family) =>
                family.name === "Golden.Project.byId"
              ),
              resourceTags: resourceDiagnostics.tags.filter((tag) =>
                tag.name === "Golden.Project" || tag.name === "Golden.Projects"
              )
            })
          );

          yield* runtime.provide(
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

          return yield* Effect.all([
            store.getSummaryEffect(),
            store.getCausalGraphEffect()
          ]);
        })
      ).pipe(Effect.ensuring(runtime.disposeEffect))
    );

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
          sources: ["Invalidation", "RoutePlan", "RuntimeEvent", "Snapshot"],
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

const appGraphDiagnosticsWithRoutes = (
  routeCount: number
): DevtoolsStartAppGraphDiagnostics => ({
  ...appGraphDiagnostics,
  routeCount,
  routePaths: Array.from({ length: routeCount }, (_value, index) => `/users/${index}/:id`),
  routeModules: Array.from({ length: routeCount }, (_value, index) => ({
    ...appGraphDiagnostics.routeModules[0]!,
    routeId: `route_users_${index}_$id`,
    routePath: `/users/${index}/:id`,
    moduleId: `src/routes/users/${index}/$id.tsx`,
    filePath: `src/routes/users/${index}/$id.tsx`
  }))
});
