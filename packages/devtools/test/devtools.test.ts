import { Cause, Effect, Exit, Fiber, PubSub, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { Action, makeRuntime, State, Resource, Route, Timeline } from "@sunfall/arc-core";
import { Devtools, DevtoolsActionInvalidationPlanConflict } from "../src/index.js";
import {
  DevtoolsUnknownInvalidationTarget,
  describeInvalidationPlan,
  describeRoutePlan,
} from "../src/serialization.js";
import { stableFactFingerprint } from "../src/fact-identity.js";
import {
  devtoolsPanelIds,
  isDevtoolsSerializableValue,
  isDevtoolsPanelId,
  isDevtoolsPanelItem,
  isDevtoolsPanels,
  normalizeSunfallArcDevtoolsBridgePayload,
} from "../src/panel-contract.js";
import { devtoolsPanelStyles } from "../src/panel-renderer.js";
import { defaultRuntime, SignalWrites } from "@sunfall/arc-core/internal";

type DevtoolsLifecycleType = "pagehide" | "beforeunload";

const installBridgeForTest = (
  ...args: Parameters<typeof Devtools.installBridge>
): Effect.Success<ReturnType<typeof Devtools.installBridge>> =>
  Effect.runSync(Devtools.installBridge(...args).pipe(Scope.provide(Scope.makeUnsafe())));

const makeDevtoolsLifecycleWindow = () => {
  const listeners = new Map<DevtoolsLifecycleType, Set<() => void>>([
    ["pagehide", new Set()],
    ["beforeunload", new Set()],
  ]);
  const lifecycleWindow = {
    addEventListener: (type: DevtoolsLifecycleType, listener: () => void) => {
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: DevtoolsLifecycleType, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as Window;

  return {
    lifecycleWindow,
    listeners,
  };
};

const expectNoDevtoolsLifecycleListeners = (
  listeners: ReadonlyMap<DevtoolsLifecycleType, ReadonlySet<() => void>>,
): void => {
  expect(listeners.get("pagehide")?.size).toBe(0);
  expect(listeners.get("beforeunload")?.size).toBe(0);
};

describe("devtools invalidation plans", () => {
  it("rejects invalidation inputs with typed errors", async () => {
    expect(() =>
      describeInvalidationPlan({
        // @ts-expect-error invalid target shape is rejected at runtime
        targets: [{}],
        entries: [],
      }),
    ).toThrow(DevtoolsUnknownInvalidationTarget);

    const Tag = Resource.tag("Devtools.error-tag");
    const store = Devtools.makeStore();
    const serialized: Devtools.InvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Devtools.error-tag",
          name: "Devtools.error-tag",
        },
      ],
      entries: [],
    };

    const conflictOptions = {
      invalidationPlan: Effect.runSync(Resource.planInvalidation(Tag)),
      serializedInvalidationPlan: serialized,
    } as unknown as Parameters<typeof store.recordActionState>[2];

    expect(() =>
      Effect.runSync(store.recordActionState("Devtools.conflict", "Pending", conflictOptions)),
    ).toThrow(DevtoolsActionInvalidationPlanConflict);

    const effectFailure = await Effect.runPromise(
      store.recordActionState("Devtools.conflict", "Pending", conflictOptions).pipe(Effect.flip),
    );
    expect(effectFailure).toBeInstanceOf(DevtoolsActionInvalidationPlanConflict);
  });

  it("serializes resource invalidation plans without live refs", async () => {
    const UserTag = Resource.tag<{ readonly id: string }>("User.devtools", {
      key: ({ id }) => id,
    });
    const User = Resource.define({
      name: "User.devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (user) => [UserTag({ id: user.id })],
    });
    const ref = User("1");

    await Effect.runPromise(Resource.preload(ref));

    expect(
      describeInvalidationPlan(Effect.runSync(Resource.planInvalidation(UserTag({ id: "1" })))),
    ).toEqual({
      targets: [
        {
          _tag: "Tag",
          key: "User.devtools:1",
          name: "User.devtools",
        },
      ],
      entries: [
        {
          ref: {
            key: ref.key,
            family: "User.devtools",
            input: "1",
          },
          causes: [
            {
              _tag: "Tag",
              key: "User.devtools:1",
              name: "User.devtools",
            },
          ],
        },
      ],
    });
  });

  it("keeps a bounded invalidation history", () => {
    const FirstTag = Resource.tag("First.devtools");
    const SecondTag = Resource.tag("Second.devtools");
    const store = Devtools.makeStore({ invalidationLimit: 1 });

    Effect.runSync(store.recordInvalidation(Effect.runSync(Resource.planInvalidation(FirstTag))));
    Effect.runSync(store.recordInvalidation(Effect.runSync(Resource.planInvalidation(SecondTag))));

    expect(Effect.runSync(store.getSnapshot()).invalidations).toEqual([
      {
        targets: [
          {
            _tag: "Tag",
            key: "Second.devtools",
            name: "Second.devtools",
          },
        ],
        entries: [],
      },
    ]);
  });

  it("normalizes unsafe store history limits before trimming", async () => {
    const RouteUser = Route.define("/history/:id", {});
    const routePlan = await Effect.runPromise(
      Route.planNavigation([RouteUser] as const, "/history/1"),
    );
    const invalidationStore = Devtools.makeStore({ invalidationLimit: 0 });
    const routeStore = Devtools.makeStore({ routePlanLimit: -1 });
    const traceStore = Devtools.makeStore({ requestTraceLimit: Number.NaN });
    const eventStore = Devtools.makeStore({ eventLimit: Number.POSITIVE_INFINITY });

    for (let index = 0; index < 55; index++) {
      Effect.runSync(
        invalidationStore.recordSerializedInvalidation({
          targets: [{ _tag: "Tag", key: `Project.${index}`, name: "Project" }],
          entries: [],
        }),
      );
      Effect.runSync(routeStore.recordRoutePlan(routePlan));
      Effect.runSync(
        traceStore.recordRequestTrace({
          request: {
            id: `req:${index}`,
            method: "GET",
            url: `https://example.test/history/${index}`,
            path: `/history/${index}`,
            transport: "ssr",
          },
          services: [],
          resources: [],
          serverFunctions: [],
          actions: [],
          fibers: [],
          streams: [],
          status: "success",
        }),
      );
    }
    for (let index = 0; index < 505; index++) {
      Effect.runSync(
        eventStore.recordRuntimeEvent({
          _tag: "Custom",
          name: `event:${index}`,
        }),
      );
    }

    expect(Effect.runSync(invalidationStore.getSnapshot()).invalidations).toHaveLength(50);
    expect(Effect.runSync(routeStore.getSnapshot()).routePlans).toHaveLength(50);
    expect(Effect.runSync(traceStore.getSnapshot()).requestTraces).toHaveLength(50);
    expect(Effect.runSync(eventStore.getSnapshot()).events).toHaveLength(500);
  });

  it("records serialized action invalidation plans from full-stack transports", async () => {
    const plan: Devtools.InvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Project.start:atlas",
          name: "Project.start",
        },
      ],
      entries: [
        {
          ref: {
            key: "Project.byId:atlas",
            family: "Project.byId",
            input: { id: "atlas" },
          },
          causes: [
            {
              _tag: "Tag",
              key: "Project.start:atlas",
              name: "Project.start",
            },
          ],
        },
      ],
    };
    const store = Devtools.makeStore();

    await Effect.runPromise(
      store.recordActionState("Project.rename", "Success", {
        input: { id: "atlas" },
        serializedInvalidationPlan: plan,
      }),
    );

    const snapshot = Effect.runSync(store.getSnapshot());

    expect(snapshot.invalidations).toEqual([plan]);
    expect(snapshot.actions).toEqual([
      {
        name: "Project.rename",
        state: "Success",
        invalidationIndexes: [0],
      },
    ]);
    expect(snapshot.events).toEqual([
      {
        _tag: "ActionState",
        sequence: 0,
        action: "Project.rename",
        state: "Success",
        input: { id: "atlas" },
        invalidationIndexes: [0],
      },
    ]);
    expect(Effect.runSync(store.getCausalGraph()).edges).toContainEqual(
      expect.objectContaining({
        kind: "Emits",
        source: "action:Project.rename",
        target: "invalidation:0",
      }),
    );
  });

  it("uses bounded structural invalidation identity for matching and deduplication", () => {
    const invalidationPlan = (tail: string): Devtools.InvalidationPlan => ({
      targets: [
        {
          _tag: "Tag",
          key: "Project.bulk",
          name: "Project.bulk",
        },
      ],
      entries: Array.from({ length: 50 }, (_, index) => ({
        ref: {
          key: index < 49 ? `Project:${index}` : `Project:${tail}`,
          family: "Project",
          input: { id: index < 49 ? index : tail },
        },
        causes: [
          {
            _tag: "Tag",
            key: "Project.bulk",
            name: "Project.bulk",
          },
        ],
      })),
    });
    const firstPlan = invalidationPlan("first-tail");
    const secondPlan = invalidationPlan("second-tail");
    const store = Devtools.makeStore();

    Effect.runSync(
      store.recordActionState("Project.bulk.first", "Success", {
        serializedInvalidationPlan: firstPlan,
      }),
    );
    Effect.runSync(
      store.recordActionState("Project.bulk.second", "Success", {
        serializedInvalidationPlan: secondPlan,
      }),
    );
    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Invalidation",
        action: "Project.bulk.first",
        plan: firstPlan,
      }),
    );
    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Invalidation",
        action: "Project.bulk.second",
        plan: secondPlan,
      }),
    );

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(snapshot.invalidations).toHaveLength(2);
    expect(snapshot.invalidations[0]?.entries[49]?.ref.key).toBe("Project:first-tail");
    expect(snapshot.invalidations[1]?.entries[49]?.ref.key).toBe("Project:second-tail");
    expect(snapshot.actions).toEqual([
      {
        name: "Project.bulk.first",
        state: "Success",
        invalidationIndexes: [0],
      },
      {
        name: "Project.bulk.second",
        state: "Success",
        invalidationIndexes: [1],
      },
    ]);
    expect(snapshot.events?.filter((event) => event._tag === "Invalidation")).toEqual([
      expect.objectContaining({
        _tag: "Invalidation",
        action: "Project.bulk.first",
        invalidationIndex: 0,
      }),
      expect.objectContaining({
        _tag: "Invalidation",
        action: "Project.bulk.second",
        invalidationIndex: 1,
      }),
    ]);
    expect(
      Effect.runSync(store.getCausalGraph())
        .nodes.filter((node) => node.kind === "InvalidationPlan")
        .map((node) => node.id),
    ).toEqual(["invalidation:0", "invalidation:1"]);
  });

  it("drops stale action invalidation links after bounded history trimming", () => {
    const firstPlan: Devtools.InvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Project.first",
          name: "Project.first",
        },
      ],
      entries: [],
    };
    const secondPlan: Devtools.InvalidationPlan = {
      targets: [
        {
          _tag: "Tag",
          key: "Project.second",
          name: "Project.second",
        },
      ],
      entries: [],
    };
    const store = Devtools.makeStore({ invalidationLimit: 1 });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* store.recordActionState("Project.first", "Success", {
          serializedInvalidationPlan: firstPlan,
        });
        yield* store.recordActionState("Project.second", "Success", {
          serializedInvalidationPlan: secondPlan,
        });

        const snapshot = Effect.runSync(store.getSnapshot());
        expect(snapshot.invalidations).toEqual([secondPlan]);
        expect(snapshot.actions).toEqual([
          {
            name: "Project.first",
            state: "Success",
          },
          {
            name: "Project.second",
            state: "Success",
            invalidationIndexes: [0],
          },
        ]);
        expect(snapshot.events).toEqual([
          {
            _tag: "ActionState",
            sequence: 0,
            action: "Project.first",
            state: "Success",
          },
          {
            _tag: "ActionState",
            sequence: 1,
            action: "Project.second",
            state: "Success",
            invalidationIndexes: [0],
          },
        ]);

        expect(Effect.runSync(store.getCausalGraph()).edges).not.toContainEqual(
          expect.objectContaining({
            kind: "Emits",
            source: "action:Project.first",
            target: "invalidation:0",
          }),
        );
        expect(Effect.runSync(store.getCausalGraph()).edges).toContainEqual(
          expect.objectContaining({
            kind: "Emits",
            source: "action:Project.second",
            target: "invalidation:0",
          }),
        );
      }),
    );
  });

  it("rebases request trace action invalidation links after bounded history trimming", () => {
    const firstPlan: Devtools.InvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Project.first", name: "Project.first" }],
      entries: [],
    };
    const secondPlan: Devtools.InvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Project.second", name: "Project.second" }],
      entries: [],
    };
    const thirdPlan: Devtools.InvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Project.third", name: "Project.third" }],
      entries: [],
    };
    const store = Devtools.makeStore({ invalidationLimit: 2 });

    Effect.runSync(store.recordSerializedInvalidation(firstPlan));
    Effect.runSync(store.recordSerializedInvalidation(secondPlan));
    Effect.runSync(
      store.recordRequestTrace({
        request: {
          id: "req-project-action",
          method: "POST",
          url: "https://example.test/__sunfall-arc/action",
          path: "/__sunfall-arc/action",
          transport: "action",
        },
        services: [],
        resources: [],
        serverFunctions: [],
        actions: [
          {
            name: "Project.rename",
            state: "Success",
            invalidationIndexes: [1],
          },
        ],
        fibers: [],
        streams: [],
        status: "success",
      }),
    );
    Effect.runSync(store.recordSerializedInvalidation(thirdPlan));

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(snapshot.invalidations).toEqual([secondPlan, thirdPlan]);
    expect(snapshot.requestTraces?.[0]?.actions).toEqual([
      {
        name: "Project.rename",
        state: "Success",
        invalidationIndexes: [0],
      },
    ]);
    expect(snapshot.events?.find((event) => event._tag === "RequestTrace")).toMatchObject({
      _tag: "RequestTrace",
      trace: {
        actions: [
          {
            name: "Project.rename",
            state: "Success",
            invalidationIndexes: [0],
          },
        ],
      },
    });
    expect(Effect.runSync(store.getSummary()).requests.traces[0]?.actions).toEqual([
      {
        name: "Project.rename",
        state: "Success",
        failureKind: null,
        invalidationIndexes: [0],
      },
    ]);
  });

  it("tracks action instances as scoped runtime facts", async () => {
    let value = 0;
    const Count = Resource.define({
      name: "Count.action-devtools",
      load: () => Effect.succeed(value),
    });
    const ref = Count(undefined);
    const Increment = Action.define({
      name: "Count.increment-devtools",
      run: () =>
        Effect.sync(() => {
          value++;
          return value;
        }),
      invalidates: () => [ref],
    });
    const action = Action.use(Increment, { runtime: defaultRuntime });
    const store = Devtools.makeStore();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Resource.preload(ref);
          yield* store.trackAction(action);
          yield* action.submit(undefined);
        }),
      ),
    );

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(snapshot.actions).toEqual([
      {
        name: "Count.increment-devtools",
        state: "Success",
        waiting: false,
        invalidationIndexes: [0],
      },
    ]);
    expect(snapshot.invalidations).toHaveLength(1);
    expect(snapshot.invalidations[0]?.entries.map((entry) => entry.ref.key)).toEqual([ref.key]);
    expect(snapshot.events?.map((event) => event._tag)).toEqual([
      "ActionState",
      "ActionState",
      "ActionState",
    ]);
  });

  it("records Timeline commits as serializable runtime panel facts", () => {
    const previous: {
      readonly count: number;
      readonly password?: string;
      readonly nested?: unknown;
      self?: unknown;
    } = {
      count: 0,
      password: "open-sesame",
    };
    previous.self = previous;
    const model = SignalWrites.make(previous, { name: "Counter.model" });
    const failures = SignalWrites.make<ReadonlyArray<unknown>>([], { name: "Counter.failures" });
    const store = Devtools.makeStore({
      serializationPolicy: {
        redactKeys: ["tenantPrivate"],
      },
    });

    Effect.runSync(
      store.recordTimelineEntry({
        sequence: 1,
        at: 10,
        cause: {
          _tag: "State",
          state: "Counter.state-devtools",
          event: "message",
          message: { _tag: "Increment", accessToken: "secret-token" },
        },
        changes: [
          {
            signal: model,
            name: "Counter.model",
            previous,
            next: {
              count: 1,
              nested: { apiKey: "secret-api-key", tenantPrivate: "tenant-secret" },
            },
          },
        ],
      }),
    );
    Effect.runSync(
      store.recordTimelineEntry({
        sequence: 2,
        at: 11,
        cause: {
          _tag: "State",
          state: "Counter.state-devtools",
          event: "failure",
          message: { _tag: "Fail" },
        },
        changes: [{ signal: failures, name: "Counter.failures", previous: [], next: ["boom"] }],
      }),
    );

    const summary = Effect.runSync(store.getSummary());
    const firstEventData = summary.runtime.events[0]?.data as {
      readonly cause?: { readonly message?: { readonly accessToken?: unknown } };
      readonly changes?: ReadonlyArray<{
        readonly signal?: unknown;
        readonly previous?: { readonly password?: unknown; readonly self?: unknown };
        readonly next?: {
          readonly nested?: { readonly apiKey?: unknown; readonly tenantPrivate?: unknown };
        };
      }>;
    };
    expect(summary.runtime.events.map((event) => event._tag)).toEqual([
      "TimelineCommit",
      "TimelineCommit",
    ]);
    expect(summary.runtime.events[0]).toMatchObject({
      at: 10,
      label: 'State "Counter.state-devtools" Increment',
      target: {
        kind: "State",
        id: "state:Counter.state-devtools",
      },
    });
    const [change] = firstEventData.changes ?? [];
    expect(change?.signal).toBe("Counter.model");
    expect(change?.previous?.self).toEqual({ _tag: "Circular" });
    expect(change?.previous?.password).toEqual({ _tag: "Redacted" });
    expect(firstEventData.cause?.message?.accessToken).toEqual({ _tag: "Redacted" });
    expect(change?.next?.nested?.apiKey).toEqual({ _tag: "Redacted" });
    expect(change?.next?.nested?.tenantPrivate).toEqual({ _tag: "Redacted" });
    expect(JSON.stringify(summary)).not.toContain("open-sesame");
    expect(JSON.stringify(summary)).not.toContain("secret-token");
    expect(JSON.stringify(summary)).not.toContain("secret-api-key");
    expect(JSON.stringify(summary)).not.toContain("tenant-secret");

    const statesPanel = Effect.runSync(store.getPanels()).panels.find(
      (panel) => panel.id === "states",
    );
    expect(statesPanel).toMatchObject({
      title: "States",
      summary: "1 states, 2 events",
      severity: "error",
    });
    expect(statesPanel?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "state-event:runtime-event:0:TimelineCommit",
          label: 'State "Counter.state-devtools" Increment',
          detail: "Counter.state-devtools message",
          severity: "ok",
        }),
        expect.objectContaining({
          id: "state-event:runtime-event:1:TimelineCommit",
          label: 'State "Counter.state-devtools" failure',
          detail: "Counter.state-devtools failure",
          severity: "error",
        }),
        expect.objectContaining({
          id: "state-summary:Counter.state-devtools",
          label: "Counter.state-devtools",
          severity: "error",
        }),
      ]),
    );
    expect(JSON.stringify(statesPanel)).not.toContain("open-sesame");
    expect(JSON.stringify(statesPanel)).not.toContain("secret-token");
    expect(Effect.runSync(store.getCausalGraph()).nodes).toContainEqual(
      expect.objectContaining({
        id: "state:Counter.state-devtools",
        kind: "State",
        label: "Counter.state-devtools",
      }),
    );
  });

  it("tracks a running Timeline recording with scoped cleanup", async () => {
    const store = Devtools.makeStore();
    const state = State.start(
      State.define<{ readonly count: number }, { readonly _tag: "Increment" }>()({
        name: "Counter.state-track",
        initial: { count: 0 },
        on: { Increment: (model) => ({ count: model.count + 1 }) },
      }),
      { runtime: defaultRuntime },
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const recording = yield* Timeline.record();
            yield* state.dispatch({ _tag: "Increment" });
            yield* store.trackTimeline(recording);
            yield* state.dispatch({ _tag: "Increment" });
          }),
        ),
      );

      const tracked =
        Effect.runSync(store.getSnapshot()).events?.filter(
          (event) => event._tag === "TimelineCommit",
        ) ?? [];
      expect(state.model.get()).toEqual({ count: 2 });
      expect(tracked.map((event) => event.commit.label)).toEqual([
        'State "Counter.state-track" Increment',
        'State "Counter.state-track" Increment',
      ]);
      expect(
        Effect.runSync(store.getSummary()).runtime.events.map((event) => event.target),
      ).toEqual([
        { kind: "State", id: "state:Counter.state-track" },
        { kind: "State", id: "state:Counter.state-track" },
      ]);

      await Effect.runPromise(state.dispatch({ _tag: "Increment" }));
      expect(
        Effect.runSync(store.getSnapshot()).events?.filter(
          (event) => event._tag === "TimelineCommit",
        ),
      ).toHaveLength(tracked.length);
    } finally {
      await Effect.runPromise(state.dispose);
    }
  });

  it("serializes route plans into plain data", async () => {
    const User = Resource.define({
      name: "User.route-devtools",
      load: (id: string) => Effect.succeed({ id }),
    });
    const UserRoute = Route.define("/users/:id", {
      preload: ({ params }) => Resource.preload(User(params.id)).pipe(Effect.asVoid),
    });
    const plan = await Effect.runPromise(Route.planNavigation([UserRoute] as const, "/users/1"));

    expect(describeRoutePlan(plan)).toEqual({
      _tag: "Matched",
      href: "/users/1",
      match: {
        path: "/users/:id",
        href: "/users/1",
        params: { id: "1" },
        search: {},
      },
      resources: [
        {
          key: User("1").key,
          family: "User.route-devtools",
          input: "1",
        },
      ],
      hydration: {
        resourceCount: 1,
        resourceKeys: [User("1").key],
      },
    });
  });

  it("combines runtime plans into a panel summary", async () => {
    const UserTag = Resource.tag<{ readonly id: string }>("User.summary-devtools", {
      key: ({ id }) => id,
    });
    const User = Resource.define({
      name: "User.summary-devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (user) => [UserTag({ id: user.id })],
    });
    const UserRoute = Route.define("/users/:id", {
      preload: ({ params }) => Resource.preload(User(params.id)),
    });
    const ref = User("1");

    const routePlan = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Resource.preload(ref);
        return describeRoutePlan(yield* Route.planNavigation([UserRoute] as const, "/users/1"));
      }),
    );
    const invalidationPlan = describeInvalidationPlan(
      Effect.runSync(Resource.planInvalidation(UserTag({ id: "1" }))),
    );
    const summary = Devtools.describeSummary({
      snapshot: {
        resources: [
          {
            key: ref.key,
            state: "Success",
          },
        ],
        actions: [
          {
            name: "User.rename",
            state: "Success",
          },
        ],
        invalidations: [invalidationPlan],
        routePlans: [routePlan],
      },
    });

    expect(summary).toMatchObject({
      version: 1,
      overview: {
        runtimeResourceCount: 1,
        runtimeActionCount: 1,
        invalidationPlanCount: 1,
        routePlanCount: 1,
        notFoundRoutePlanCount: 0,
      },
      invalidations: {
        plans: [
          {
            index: 0,
            targetCount: 1,
            matchedResourceCount: 1,
            causeCount: 1,
          },
        ],
      },
      routes: {
        plans: [
          {
            index: 0,
            _tag: "Matched",
            href: "/users/1",
            path: "/users/:id",
            params: {
              id: "1",
            },
            search: {},
            resourceCount: 1,
            hydrationResourceCount: 1,
          },
        ],
        notFoundHrefs: [],
      },
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
        invalidationIndexes: [0],
      },
    ]);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    const panels = Devtools.describePanels({ summary });
    expect(panels.panels.map((panel) => panel.id)).toEqual(devtoolsPanelIds);
    expect(panels.version).toBe(1);
    expect(panels.panels.find((panel) => panel.id === "routes")).toMatchObject({
      severity: "ok",
    });
    expect(panels.panels.find((panel) => panel.id === "resources")).toMatchObject({
      severity: "ok",
    });
    expect(JSON.parse(JSON.stringify(panels))).toEqual(panels);
  });

  it("renders deterministic browser panel HTML from the panel contract", async () => {
    const requestTrace = (
      id: string,
      path: string,
      status: Devtools.RequestTrace["status"],
    ): Devtools.RequestTrace => ({
      request: {
        id,
        method: "GET",
        url: `https://example.test${path}`,
        path,
        transport: "rpc",
      },
      response: {
        status: status === "success" ? 200 : 500,
      },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status,
      teardown: {
        runtimeDisposed: status !== "failure",
        durationMillis: status === "success" ? 12 : 34,
      },
    });
    const panels = Devtools.describePanels({
      requestTraces: [
        requestTrace("safe", "/projects/<atlas>", "success"),
        requestTrace("failed", "/projects/failure", "failure"),
      ],
    });
    const html = Devtools.renderPanelsHtml({
      panels,
      title: "Ops <Devtools>",
      selectedPanelId: "requests",
      maxItemsPerPanel: 1,
    });

    expect(devtoolsPanelStyles).toContain(".sunfall-arc-devtools");
    expect(html).toContain("Ops &lt;Devtools&gt;");
    expect(html).toContain('data-selected-panel="requests"');
    expect(html).toContain('data-sunfall-arc-devtools-panel-target="requests"');
    expect(html).toContain('data-sunfall-arc-devtools-item-id="request:safe"');
    expect(html).toContain("GET /projects/&lt;atlas&gt;");
    expect(html).toContain("1 more items hidden by the current render limit.");
    expect(html).not.toContain("Ops <Devtools>");
  });

  it("installs the inspected-window devtools bridge with scoped cleanup", async () => {
    const target: Devtools.BridgeTarget = {};
    const panels = Devtools.describePanels();
    const install = installBridgeForTest(
      {
        panels,
        selectedPanelId: "requests",
        title: "Bridge",
      },
      target,
    );

    expect(target[Devtools.bridgeGlobal]).toMatchObject({
      panels,
      selectedPanelId: "requests",
      title: "Bridge",
    });
    install.uninstall();
    expect(target[Devtools.bridgeGlobal]).toBeUndefined();

    target[Devtools.bridgeGlobal] = () => ({
      panels,
      title: "Previous",
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Devtools.installBridge(
            () => ({
              panels,
              selectedPanelId: "resources",
            }),
            target,
          );
          expect(typeof target[Devtools.bridgeGlobal]).toBe("function");
          expect(
            typeof target[Devtools.bridgeGlobal] === "function"
              ? target[Devtools.bridgeGlobal]()
              : undefined,
          ).toMatchObject({
            panels,
            selectedPanelId: "resources",
          });
        }),
      ),
    );

    expect(
      typeof target[Devtools.bridgeGlobal] === "function"
        ? target[Devtools.bridgeGlobal]()
        : undefined,
    ).toMatchObject({
      panels,
      title: "Previous",
    });
  });

  it("keeps inspected-window devtools bridge cleanup stack-safe", () => {
    const target: Devtools.BridgeTarget = {};
    const panels = Devtools.describePanels();
    const previous = () => ({
      panels,
      title: "Previous",
    });
    const firstProvider = { panels, title: "First" };
    const secondProvider = { panels, title: "Second" };
    const thirdProvider = { panels, title: "Third" };
    target[Devtools.bridgeGlobal] = previous;

    const first = installBridgeForTest(firstProvider, target);
    const second = installBridgeForTest(secondProvider, target);
    const third = installBridgeForTest(thirdProvider, target);

    expect(target[Devtools.bridgeGlobal]).toBe(thirdProvider);
    second.uninstall();
    expect(target[Devtools.bridgeGlobal]).toBe(thirdProvider);
    first.uninstall();
    expect(target[Devtools.bridgeGlobal]).toBe(thirdProvider);
    third.uninstall();
    expect(target[Devtools.bridgeGlobal]).toBe(previous);
    second.uninstall();
    expect(target[Devtools.bridgeGlobal]).toBe(previous);

    const noBaselineTarget: Devtools.BridgeTarget = {};
    const noBaselineFirst = installBridgeForTest(firstProvider, noBaselineTarget);
    const noBaselineSecond = installBridgeForTest(secondProvider, noBaselineTarget);

    noBaselineFirst.uninstall();
    expect(noBaselineTarget[Devtools.bridgeGlobal]).toBe(secondProvider);
    noBaselineSecond.uninstall();
    expect(noBaselineTarget[Devtools.bridgeGlobal]).toBeUndefined();
  });

  it("normalizes inspected-window panel payloads through the shared panel contract", () => {
    const panels = Devtools.describePanels();

    expect(isDevtoolsPanelId("requests")).toBe(true);
    expect(isDevtoolsPanelId("missing")).toBe(false);
    expect(
      isDevtoolsPanelItem({
        id: "unsafe-metrics",
        label: "Unsafe metrics",
        severity: "ok",
        metrics: {
          count: 1,
        },
      }),
    ).toBe(false);
    expect(isDevtoolsPanels(panels)).toBe(true);
    expect(isDevtoolsPanels({ version: 1, panels: panels.panels.slice(0, 1) })).toBe(false);
    expect(isDevtoolsPanels({ version: 1, panels: [panels.panels[0]!, panels.panels[0]!] })).toBe(
      false,
    );
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
        panels: {
          version: 1,
          panels: [...panels.panels].reverse(),
        },
      })?.panels.panels.map((panel) => panel.id),
    ).toEqual(devtoolsPanelIds);
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
        panels,
        selectedPanelId: "requests",
        title: "Live",
      }),
    ).toEqual({
      panels,
      selectedPanelId: "requests",
      title: "Live",
    });
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
        panels,
        selectedPanelId: "missing",
      }),
    ).toEqual({ panels });
    const longString = "x".repeat(1_050);
    const boundedPayload = normalizeSunfallArcDevtoolsBridgePayload({
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
                      value: longString,
                    },
                  },
                ],
              }
            : panel,
        ),
      },
      title: longString,
    });
    const boundedLongString = longString.slice(0, 1_000);
    const boundedRequestsPanel = boundedPayload?.panels.panels.find(
      (panel) => panel.id === "requests",
    );
    expect(boundedPayload?.title).toBe(boundedLongString);
    expect(boundedRequestsPanel).toMatchObject({
      title: boundedLongString,
      summary: boundedLongString,
      metrics: [
        {
          label: boundedLongString,
          value: boundedLongString,
          unit: boundedLongString,
        },
      ],
      items: [
        expect.objectContaining({
          label: boundedLongString,
          detail: boundedLongString,
          metrics: [
            {
              label: "payload",
              value: boundedLongString,
              unit: boundedLongString,
            },
          ],
          data: {
            nested: [boundedLongString],
            value: boundedLongString,
          },
        }),
      ],
    });
    const longDataKey = "k".repeat(1_001);
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
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
                      data: { [longDataKey]: "value" },
                    },
                  ],
                }
              : panel,
          ),
        },
      }),
    ).toBeUndefined();
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
                  data: { value: "stable" },
                },
              ],
            }
          : panel,
      ),
    };
    const duplicateItemPanels = {
      ...sourcePanels,
      panels: sourcePanels.panels.map((panel) =>
        panel.id === "requests"
          ? {
              ...panel,
              items: [panel.items[0]!, { ...panel.items[0]!, label: "Duplicate request" }],
            }
          : panel,
      ),
    };
    expect(isDevtoolsPanels(duplicateItemPanels)).toBe(false);
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({ panels: duplicateItemPanels }),
    ).toBeUndefined();
    let sourcePanelReads = 0;
    const lateThrowingPayload = {
      get panels(): unknown {
        sourcePanelReads++;
        if (sourcePanelReads > 1) {
          throw new Error("late panel getter failed");
        }
        return sourcePanels;
      },
    };
    const normalized = normalizeSunfallArcDevtoolsBridgePayload(lateThrowingPayload);
    // Deliberately mutate the readonly source after normalization to prove it was detached.
    Object.assign(sourcePanels.panels[0]!, { title: "Mutated" });

    expect(sourcePanelReads).toBe(1);
    expect(normalized?.panels.panels.find((panel) => panel.id === "requests")?.title).toBe(
      "Requests",
    );
    expect(Devtools.renderPanelsHtml({ panels: normalized!.panels })).toContain("Requests");
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
        panels: {
          version: 1,
          panels: [
            {
              id: "missing",
              title: "Bad",
              summary: "Bad",
              severity: "ok",
              metrics: [],
              items: [],
            },
          ],
        },
      }),
    ).toBeUndefined();
    const throwingPayload = {
      get panels(): unknown {
        throw new Error("bridge getter failed");
      },
    };
    const throwingSerializableRecord = new Proxy<Record<string, unknown>>(
      {},
      {
        getPrototypeOf: () => Object.prototype,
        ownKeys: () => {
          throw new Error("own keys failed");
        },
      },
    );
    const throwingPanelItem = new Proxy<Record<string, unknown>>(
      {
        id: "request:1",
        severity: "ok",
      },
      {
        get: (target, property, receiver) => {
          if (property === "label") {
            throw new Error("item getter failed");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(() => normalizeSunfallArcDevtoolsBridgePayload(throwingPayload)).not.toThrow();
    expect(normalizeSunfallArcDevtoolsBridgePayload(throwingPayload)).toBeUndefined();
    expect(() => isDevtoolsSerializableValue(throwingSerializableRecord)).not.toThrow();
    expect(isDevtoolsSerializableValue(throwingSerializableRecord)).toBe(false);
    expect(() =>
      normalizeSunfallArcDevtoolsBridgePayload({
        panels: {
          version: 1,
          panels: [
            {
              id: "requests",
              title: "Requests",
              summary: "Throwing item",
              severity: "ok",
              metrics: [],
              items: [throwingPanelItem],
            },
          ],
        },
      }),
    ).not.toThrow();
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
        panels: {
          version: 1,
          panels: [
            {
              id: "requests",
              title: "Requests",
              summary: "Throwing item",
              severity: "ok",
              metrics: [],
              items: [throwingPanelItem],
            },
          ],
        },
      }),
    ).toBeUndefined();
    const cyclicData: Record<string, unknown> = {};
    cyclicData.self = cyclicData;
    expect(isDevtoolsSerializableValue(cyclicData)).toBe(false);
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
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
                      data: cyclicData,
                    },
                  ],
                }
              : panel,
          ),
        },
      }),
    ).toBeUndefined();
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
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
                      data: new Array(1_001).fill("value"),
                    },
                  ],
                }
              : panel,
          ),
        },
      }),
    ).toBeUndefined();
    for (const data of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date("2026-05-14T00:00:00.000Z"),
      new Map([["key", "value"]]),
      new Set(["value"]),
      new Error("boom"),
    ]) {
      expect(isDevtoolsSerializableValue(data)).toBe(false);
      expect(
        normalizeSunfallArcDevtoolsBridgePayload({
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
                    data,
                  },
                ],
              },
            ],
          },
        }),
      ).toBeUndefined();
    }
    expect(
      normalizeSunfallArcDevtoolsBridgePayload({
        panels: {
          version: 1,
          panels: [
            {
              id: "requests",
              title: "Requests",
              summary: "Invalid metric",
              severity: "ok",
              metrics: [{ label: "Duration", value: Number.NaN }],
              items: [],
            },
          ],
        },
      }),
    ).toBeUndefined();
  });

  it("renders malformed public panel payloads as contract diagnostics", () => {
    const panels = Devtools.describePanels();
    const duplicatePanels = {
      version: 1 as const,
      panels: panels.panels.map((panel, index) =>
        index === 1 ? { ...panel, id: panels.panels[0]!.id } : panel,
      ),
    };
    const missingPanels = {
      version: 1 as const,
      panels: panels.panels.filter((panel) => panel.id !== "requests"),
    };

    const duplicateHtml = Devtools.renderPanelsHtml({
      panels: duplicatePanels,
      selectedPanelId: "diagnostics",
      includeStyles: false,
    });
    const missingHtml = Devtools.renderPanelsHtml({
      panels: missingPanels,
      selectedPanelId: "diagnostics",
      includeStyles: false,
    });
    const root = {
      innerHTML: "",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      contains: () => true,
    } as unknown as HTMLElement;
    const mountScope = Effect.runSync(Scope.make());
    Effect.runSync(
      Devtools.mountPanels({
        root,
        panels: missingPanels,
        selectedPanelId: "diagnostics",
        includeStyles: false,
      }).pipe(Scope.provide(mountScope)),
    );

    expect(duplicateHtml).toContain("Panel contract error");
    expect(duplicateHtml).toContain("Duplicate panel id");
    expect(duplicateHtml).not.toContain("GET /projects/atlas");
    expect(missingHtml).toContain("Panel contract error");
    expect(missingHtml).toContain("Missing required panel");
    expect(missingHtml).not.toContain("GET /projects/atlas");
    expect(root.innerHTML).toContain("Panel contract error");
    expect(root.innerHTML).toContain("Missing required panel");
    Effect.runSync(Scope.close(mountScope, Exit.void));
    expect(root.innerHTML).toBe("");
  });

  it("releases devtools panel lifecycle listeners on manual boot interrupt", async () => {
    const { lifecycleWindow, listeners } = makeDevtoolsLifecycleWindow();
    const root = {
      innerHTML: "",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      contains: () => true,
    } as unknown as HTMLElement;
    const boot = Devtools.bootPanels({
      root,
      includeStyles: false,
      lifecycleWindow,
    });

    expect(listeners.get("pagehide")?.size).toBe(1);
    expect(listeners.get("beforeunload")?.size).toBe(1);

    boot.interrupt();

    expectNoDevtoolsLifecycleListeners(listeners);
    await Effect.runPromise(Fiber.await(boot.fiber));
  });

  it("releases devtools panel lifecycle listeners when afterMount fails synchronously", async () => {
    const { lifecycleWindow, listeners } = makeDevtoolsLifecycleWindow();
    const root = {
      innerHTML: "",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      contains: () => true,
    } as unknown as HTMLElement;
    const boot = Devtools.bootPanels({
      root,
      includeStyles: false,
      lifecycleWindow,
      afterMount: () => Effect.die(new Error("after mount failed")),
    });

    await Effect.runPromise(Fiber.await(boot.fiber));

    expectNoDevtoolsLifecycleListeners(listeners);
  });

  it("releases devtools panel lifecycle listeners when mount fails synchronously", async () => {
    const { lifecycleWindow, listeners } = makeDevtoolsLifecycleWindow();
    const root = {
      innerHTML: "",
      addEventListener: () => {
        throw new Error("mount failed");
      },
      removeEventListener: () => undefined,
      contains: () => true,
    } as unknown as HTMLElement;
    const boot = Devtools.bootPanels({
      root,
      includeStyles: false,
      lifecycleWindow,
    });

    await Effect.runPromise(Fiber.await(boot.fiber));

    expectNoDevtoolsLifecycleListeners(listeners);
  });

  it("derives a deterministic causal graph from routes, resources, actions, and runtime events", async () => {
    const UserTag = Resource.tag<{ readonly id: string }>("User.causal-devtools", {
      key: ({ id }) => id,
    });
    const User = Resource.define({
      name: "User.causal-devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (user) => [UserTag({ id: user.id })],
    });
    const UserRoute = Route.define("/users/:id", {
      preload: ({ params }) => Resource.preload(User(params.id)),
    });
    const ref = User("1");

    await Effect.runPromise(Resource.preload(ref));

    const routePlan = describeRoutePlan(
      await Effect.runPromise(Route.planNavigation([UserRoute] as const, "/users/1")),
    );
    const invalidationPlan = describeInvalidationPlan(
      Effect.runSync(Resource.planInvalidation(UserTag({ id: "1" }))),
    );
    const summary = Devtools.describeSummary({
      snapshot: {
        resources: [
          {
            key: ref.key,
            state: "Success",
          },
        ],
        actions: [
          {
            name: "User.rename",
            state: "Success",
            invalidationIndexes: [0],
          },
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
              previous: false,
            },
          },
          {
            _tag: "ActionState",
            sequence: 1,
            action: "User.rename",
            state: "Success",
            input: { id: "1" },
            invalidationIndexes: [0],
          },
          {
            _tag: "Invalidation",
            sequence: 2,
            action: "User.rename",
            plan: invalidationPlan,
          },
        ],
      },
    });
    const graph = summary.causalGraph;
    const nodeKinds = new Set(graph.nodes.map((node) => node.kind));
    const edgeKinds = new Set(graph.edges.map((edge) => edge.kind));

    expect(summary.overview).toMatchObject({
      runtimeEventCount: 3,
      causalNodeCount: graph.nodes.length,
      causalEdgeCount: graph.edges.length,
    });
    expect(nodeKinds).toEqual(
      new Set([
        "Action",
        "InvalidationPlan",
        "Resource",
        "ResourceTag",
        "Route",
        "RoutePlan",
        "RuntimeEvent",
      ]),
    );
    expect(edgeKinds).toEqual(
      new Set([
        "Causes",
        "Emits",
        "Hydrates",
        "Invalidates",
        "Matches",
        "Observes",
        "Preloads",
        "Targets",
      ]),
    );
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: `resource:${ref.key}`,
        kind: "Resource",
        label: "User.causal-devtools",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Emits",
        source: "action:User.rename",
        target: "invalidation:0",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:2:Invalidation",
        target: "invalidation:0",
      }),
    );
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
    expect(Devtools.describeCausalGraph()).toEqual({ version: 1, nodes: [], edges: [] });
  });

  it("links route hydration edges only to hydrated resources", () => {
    const routePlan: Devtools.RoutePlan = {
      _tag: "Matched",
      href: "/projects/atlas",
      match: {
        path: "/projects/:id",
        href: "/projects/atlas",
        params: { id: "atlas" },
        search: {},
      },
      resources: [
        {
          key: "Project:atlas",
          family: "Project",
          input: { id: "atlas" },
        },
        {
          key: "Owner:ada",
          family: "Owner",
          input: { id: "ada" },
        },
      ],
      hydration: {
        resourceCount: 1,
        resourceKeys: ["Project:atlas"],
      },
    };
    const summary = Devtools.describeSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [routePlan],
      },
    });

    expect(summary.routes.plans[0]?.hydratedResourceKeys).toEqual(["Project:atlas"]);
    expect(
      summary.causalGraph.edges
        .filter((edge) => edge.kind === "Hydrates")
        .map((edge) => edge.target),
    ).toEqual(["resource:Project:atlas"]);
  });

  it("does not infer hydration identity from count-only route-plan facts", () => {
    const routePlan: Devtools.RoutePlan = {
      _tag: "Matched",
      href: "/projects/atlas",
      match: {
        path: "/projects/:id",
        href: "/projects/atlas",
        params: { id: "atlas" },
        search: {},
      },
      resources: [
        {
          key: "Project:atlas",
          family: "Project",
          input: { id: "atlas" },
        },
      ],
      hydration: {
        resourceCount: 1,
      },
    };
    const summary = Devtools.describeSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [routePlan],
      },
    });

    expect(summary.routes.plans[0]?.hydrationResourceCount).toBe(1);
    expect(summary.routes.plans[0]?.hydratedResourceKeys).toEqual([]);
    expect(summary.causalGraph.edges.some((edge) => edge.kind === "Hydrates")).toBe(false);
  });

  it("keeps Ref invalidation targets under the Resource causal node kind", () => {
    const invalidationPlan: Devtools.InvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "project:atlas",
          family: "Project",
          input: {
            id: "atlas",
          },
        },
      ],
      entries: [],
    };
    const graph = Devtools.describeCausalGraph({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [invalidationPlan],
        routePlans: [],
      },
    });

    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "resource:project:atlas",
        kind: "Resource",
      }),
    );
    expect(graph.nodes).not.toContainEqual(
      expect.objectContaining({
        id: "resource:project:atlas",
        kind: "InvalidationTarget",
      }),
    );
  });

  it("links runtime events to existing invalidation and route-plan facts", async () => {
    const RuntimeTargetTag = Resource.tag("Runtime.target-devtools");
    const RuntimeTargetRoute = Route.define("/runtime-targets/:id", {});
    const routePlan = describeRoutePlan(
      await Effect.runPromise(
        Route.planNavigation([RuntimeTargetRoute] as const, "/runtime-targets/1"),
      ),
    );
    const invalidationPlan = describeInvalidationPlan(
      Effect.runSync(Resource.planInvalidation(RuntimeTargetTag)),
    );
    const summary = Devtools.describeSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [invalidationPlan],
        routePlans: [routePlan],
        events: [
          {
            _tag: "Custom",
            sequence: 0,
            name: "before",
          },
          {
            _tag: "Invalidation",
            sequence: 1,
            plan: invalidationPlan,
          },
          {
            _tag: "RoutePlan",
            sequence: 2,
            plan: routePlan,
          },
        ],
      },
    });

    expect(summary.runtime.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "Invalidation",
          target: {
            kind: "InvalidationPlan",
            id: "invalidation:0",
          },
        }),
        expect.objectContaining({
          _tag: "RoutePlan",
          target: {
            kind: "RoutePlan",
            id: "route-plan:0:/runtime-targets/1",
          },
        }),
      ]),
    );
    expect(summary.causalGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Observes",
          source: "runtime-event:1:Invalidation",
          target: "invalidation:0",
        }),
        expect.objectContaining({
          kind: "Observes",
          source: "runtime-event:2:RoutePlan",
          target: "route-plan:0:/runtime-targets/1",
        }),
      ]),
    );
    expect(
      summary.causalGraph.edges.filter(
        (edge) => edge.kind === "Matches" && edge.source === "route-plan:0:/runtime-targets/1",
      ),
    ).toHaveLength(1);
    expect(summary.causalGraph.nodes).not.toContainEqual(
      expect.objectContaining({ id: "invalidation:1" }),
    );
    expect(summary.causalGraph.nodes).not.toContainEqual(
      expect.objectContaining({ id: "route-plan:2:/runtime-targets/1" }),
    );
  });

  it("allocates unmatched runtime event fact targets after recorded facts", async () => {
    const FirstTag = Resource.tag("Runtime.recorded-target-devtools");
    const SecondTag = Resource.tag("Runtime.recorded-other-devtools");
    const MissingTag = Resource.tag<{ readonly id: string }>("Runtime.unrecorded-target-devtools", {
      key: ({ id }) => id,
    });
    const MissingResource = Resource.define({
      name: "Runtime.unrecorded-resource-devtools",
      load: (id: string) => Effect.succeed({ id }),
      provides: (value) => [MissingTag({ id: value.id })],
    });
    const FirstRoute = Route.define("/runtime-recorded/:id", {});
    const SecondRoute = Route.define("/runtime-recorded-other/:id", {});
    const MissingRoute = Route.define("/runtime-unrecorded/:id", {
      preload: ({ params }) => Resource.preload(MissingResource(params.id)),
    });
    const recordedRoutePlans = await Effect.runPromise(
      Effect.all([
        Route.planNavigation([FirstRoute] as const, "/runtime-recorded/1"),
        Route.planNavigation([SecondRoute] as const, "/runtime-recorded-other/2"),
      ]),
    );
    const missingRoutePlan = await Effect.runPromise(
      Route.planNavigation([MissingRoute] as const, "/runtime-unrecorded/3"),
    );
    const missingInvalidationPlan = describeInvalidationPlan(
      Effect.runSync(Resource.planInvalidation(MissingTag({ id: "3" }))),
    );
    const missingRouteSummary = describeRoutePlan(missingRoutePlan);
    const missingResourceKey = MissingResource("3").key;
    const missingResourceId = `resource:${missingResourceKey}`;
    const missingTargetId = `resource-tag:${missingInvalidationPlan.targets[0]!.key}`;
    const recordedInvalidations = [
      describeInvalidationPlan(Effect.runSync(Resource.planInvalidation(FirstTag))),
      describeInvalidationPlan(Effect.runSync(Resource.planInvalidation(SecondTag))),
    ];
    const summary = Devtools.describeSummary({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: recordedInvalidations,
        routePlans: recordedRoutePlans.map(describeRoutePlan),
        events: [
          {
            _tag: "Invalidation",
            sequence: 0,
            plan: missingInvalidationPlan,
          },
          {
            _tag: "RoutePlan",
            sequence: 1,
            plan: missingRouteSummary,
          },
        ],
      },
    });

    expect(summary.runtime.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "Invalidation",
          target: {
            kind: "InvalidationPlan",
            id: "invalidation:2",
          },
        }),
        expect.objectContaining({
          _tag: "RoutePlan",
          target: {
            kind: "RoutePlan",
            id: "route-plan:3:/runtime-unrecorded/3",
          },
        }),
      ]),
    );
    expect(summary.resources).toEqual([
      {
        key: missingResourceKey,
        family: "Runtime.unrecorded-resource-devtools",
        input: "3",
        state: null,
        sources: ["Invalidation", "RoutePlan"],
        routeHrefs: ["/runtime-unrecorded/3"],
        invalidationIndexes: [2],
      },
    ]);
    expect(
      Devtools.describePanels({ summary }).panels.find((panel) => panel.id === "resources"),
    ).toMatchObject({
      items: [
        expect.objectContaining({
          id: missingResourceId,
          label: "Runtime.unrecorded-resource-devtools",
          detail: "unknown",
          metrics: [
            { label: "routes", value: 1 },
            { label: "invalidations", value: 1 },
          ],
        }),
      ],
    });
    expect(summary.causalGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Targets",
          source: "invalidation:2",
          target: missingTargetId,
        }),
        expect.objectContaining({
          kind: "Invalidates",
          source: "invalidation:2",
          target: missingResourceId,
        }),
        expect.objectContaining({
          kind: "Causes",
          source: missingTargetId,
          target: missingResourceId,
        }),
        expect.objectContaining({
          kind: "Matches",
          source: "route-plan:3:/runtime-unrecorded/3",
          target: "route:/runtime-unrecorded/:id",
        }),
        expect.objectContaining({
          kind: "Preloads",
          source: "route-plan:3:/runtime-unrecorded/3",
          target: missingResourceId,
        }),
        expect.objectContaining({
          kind: "Hydrates",
          source: "route-plan:3:/runtime-unrecorded/3",
          target: missingResourceId,
        }),
      ]),
    );
  });

  it("links request-embedded route plans to matching recorded route-plan facts", async () => {
    const OtherRoute = Route.define("/request-route-other/:id", {});
    const RequestTargetRoute = Route.define("/request-route-targets/:a/:b", {});
    const otherPlan = describeRoutePlan(
      await Effect.runPromise(
        Route.planNavigation([OtherRoute] as const, "/request-route-other/1"),
      ),
    );
    const routePlan = describeRoutePlan(
      await Effect.runPromise(
        Route.planNavigation([RequestTargetRoute] as const, "/request-route-targets/1/2"),
      ),
    );
    const requestRoutePlan: Devtools.RoutePlan =
      routePlan._tag === "Matched" && routePlan.match !== undefined
        ? {
            ...routePlan,
            match: {
              ...routePlan.match,
              params: { b: "2", a: "1" },
            },
          }
        : routePlan;
    const summary = Devtools.describeSummary({
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
              transport: "ssr",
            },
            response: { status: 200 },
            services: [],
            routePlan: requestRoutePlan,
            resources: [],
            serverFunctions: [],
            actions: [],
            fibers: [],
            streams: [],
            status: "success",
          },
        ],
      },
    });

    expect(summary.causalGraph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:req-route-target",
        target: "route-plan:1:/request-route-targets/1/2",
      }),
    );
    expect(summary.causalGraph.nodes).not.toContainEqual(
      expect.objectContaining({ id: "route-plan:0:/request-route-targets/1/2" }),
    );
  });

  it("keeps request-embedded route-plan identity disjoint from recorded plans with the same href", () => {
    const recordedPlan: Devtools.RoutePlan = {
      _tag: "Matched",
      href: "/same-route",
      match: {
        path: "/same-route",
        href: "/same-route",
        params: {},
        search: {},
      },
      resources: [
        {
          key: "Recorded:1",
          family: "Recorded",
          input: null,
        },
      ],
      hydration: {
        resourceCount: 0,
      },
    };
    const embeddedPlan: Devtools.RoutePlan = {
      ...recordedPlan,
      resources: [
        {
          key: "Embedded:1",
          family: "Embedded",
          input: null,
        },
      ],
    };
    const summary = Devtools.describeSummary({
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
              transport: "ssr",
            },
            services: [],
            routePlan: embeddedPlan,
            resources: [],
            serverFunctions: [],
            actions: [],
            fibers: [],
            streams: [],
            status: "success",
          },
        ],
      },
    });

    expect(summary.causalGraph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "route-plan:0:/same-route" }),
        expect.objectContaining({ id: "route-plan:1:/same-route" }),
      ]),
    );
    expect(summary.causalGraph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Records",
        source: "request-trace:request-with-colliding-plan",
        target: "route-plan:1:/same-route",
      }),
    );
    expect(summary.causalGraph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Preloads",
        source: "route-plan:1:/same-route",
        target: "resource:Embedded:1",
      }),
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
            timestamp: 1,
          },
        },
      ],
    };
    const baseGraph = Devtools.describeCausalGraph({ snapshot });
    const graphWithUnrelatedFacts = Devtools.describeCausalGraph({
      snapshot: {
        ...snapshot,
        actions: [{ name: "Unrelated.edge-devtools", state: "Success" }],
      },
    });
    const observedEdge = {
      kind: "Observes",
      source: "runtime-event:0:ResourceStoreEvent",
      target: "resource:Stable.edge-devtools:1",
    } as const;

    const baseId = baseGraph.edges.find(
      (edge) =>
        edge.kind === observedEdge.kind &&
        edge.source === observedEdge.source &&
        edge.target === observedEdge.target,
    )?.id;
    const graphWithUnrelatedFactsId = graphWithUnrelatedFacts.edges.find(
      (edge) =>
        edge.kind === observedEdge.kind &&
        edge.source === observedEdge.source &&
        edge.target === observedEdge.target,
    )?.id;

    expect(baseId).toBeDefined();
    expect(graphWithUnrelatedFactsId).toBe(baseId);
  });

  it("frames causal edge id parts so source and target delimiters cannot collide", () => {
    const requestTrace = (id: string, resourceKey: string): Devtools.RequestTrace => ({
      request: {
        id,
        method: "GET",
        url: `https://example.test/${id}`,
        path: `/${id}`,
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [
        {
          key: resourceKey,
          family: "Project",
          state: "Success",
        },
      ],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    });
    const graph = Devtools.describeCausalGraph({
      snapshot: {
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        requestTraces: [requestTrace("a", "b->resource:c"), requestTrace("a->resource:b", "c")],
      },
    });
    const collidingRecordsEdges = graph.edges.filter(
      (edge) =>
        edge.kind === "Records" &&
        edge.source.startsWith("request-trace:") &&
        edge.target.startsWith("resource:"),
    );

    expect(collidingRecordsEdges).toHaveLength(2);
    expect(new Set(collidingRecordsEdges.map((edge) => edge.id)).size).toBe(2);
  });

  it("normalizes non-JSON values before they reach the summary", () => {
    const circular: Record<string, unknown> = {
      z: 1,
      a: undefined,
      nested: [Number.NaN, 1n, new Date("2026-05-13T12:00:00.000Z")],
    };
    circular.self = circular;

    expect(Devtools.toSerializable(circular)).toEqual({
      a: {
        _tag: "Undefined",
      },
      nested: [
        {
          _tag: "NonFiniteNumber",
          value: "NaN",
        },
        {
          _tag: "BigInt",
          value: "1",
        },
        {
          _tag: "Date",
          value: "2026-05-13T12:00:00.000Z",
        },
      ],
      self: {
        _tag: "Circular",
      },
      z: 1,
    });
  });

  it("applies a safe serialization policy to complex values", () => {
    const throwingGetter: Record<string, unknown> = {};
    Object.defineProperty(throwingGetter, "bad", {
      enumerable: true,
      get() {
        throw new Error("getter exploded");
      },
    });

    expect(Devtools.toSerializable(new Map([["a", 1]]))).toEqual({
      _tag: "Map",
      size: 1,
      entries: [["a", 1]],
    });
    expect(Devtools.toSerializable(new Set(["x"]))).toEqual({
      _tag: "Set",
      size: 1,
      values: ["x"],
    });
    expect(Devtools.toSerializable(new Error("boom"))).toMatchObject({
      _tag: "Error",
      name: "Error",
      message: "boom",
    });
    expect(Devtools.toSerializable(throwingGetter)).toEqual({
      bad: {
        _tag: "Accessor",
      },
    });
    const hostileRecord = new Proxy<Record<string, unknown>>(
      {},
      {
        ownKeys: () => {
          throw new Error("own keys failed");
        },
      },
    );
    const hostileMap = new Proxy(new Map([["a", 1]]), {
      get: (target, property, receiver) => {
        if (property === "size") {
          throw new Error("map size failed");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const hostileArray = new Proxy(["a"], {
      get: (target, property, receiver) => {
        if (property === "0") {
          throw new Error("array item failed");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() => Devtools.toSerializable(hostileRecord)).not.toThrow();
    expect(Devtools.toSerializable(hostileRecord)).toMatchObject({
      _tag: "UninspectableObject",
      message: "own keys failed",
    });
    expect(() => Devtools.toSerializable(hostileMap)).not.toThrow();
    expect(Devtools.toSerializable(hostileMap)).toMatchObject({
      _tag: "UninspectableObject",
    });
    expect(() => Devtools.toSerializable(hostileArray)).not.toThrow();
    expect(Devtools.toSerializable(hostileArray)).toMatchObject({
      _tag: "UninspectableObject",
      message: "array item failed",
    });
    expect(Devtools.toSerializable(["a", "b", "c"], { maxEntries: 2 })).toEqual([
      "a",
      "b",
      {
        _tag: "Truncated",
        remaining: 1,
      },
    ]);
    const accessed: Array<string> = [];
    const boundedArray = new Proxy(["a", "b", "c"], {
      get: (target, property, receiver) => {
        accessed.push(String(property));
        if (property === "1") {
          throw new Error("serializer crossed the entry bound");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(Devtools.toSerializable(boundedArray, { maxEntries: 1 })).toEqual([
      "a",
      {
        _tag: "Truncated",
        remaining: 2,
      },
    ]);
    expect(accessed).not.toContain("1");
    expect(Devtools.toSerializable("abcdef", { maxStringLength: 3 })).toEqual({
      _tag: "TruncatedString",
      length: 6,
      value: "abc",
    });
  });

  it("normalizes unsafe serialization policy bounds", () => {
    const longArray = Array.from({ length: 55 }, (_, index) => index);

    expect(Devtools.toSerializable({ nested: { value: 1 } }, { maxDepth: 1.8 })).toEqual({
      nested: {
        _tag: "MaxDepth",
      },
    });
    expect(Devtools.toSerializable(["a", "b", "c"], { maxEntries: 1.8 })).toEqual([
      "a",
      {
        _tag: "Truncated",
        remaining: 2,
      },
    ]);
    expect(Devtools.toSerializable("abcdef", { maxStringLength: 3.8 })).toEqual({
      _tag: "TruncatedString",
      length: 6,
      value: "abc",
    });
    expect(Devtools.toSerializable("abcdef", { maxStringLength: -1 })).toBe("abcdef");
    expect(Devtools.toSerializable(longArray, { maxEntries: Number.POSITIVE_INFINITY })).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      {
        _tag: "Truncated",
        remaining: 5,
      },
    ]);
    expect(Devtools.toSerializable({ nested: { value: 1 } }, { maxDepth: Number.NaN })).toEqual({
      nested: {
        value: 1,
      },
    });
  });

  it("detaches stored Error and byte-view payloads before serialization", () => {
    const store = Devtools.makeStore();
    const error = new TypeError("before");
    (error as Error & { extra?: { readonly nested: { value: number } } }).extra = {
      nested: { value: 1 },
    };
    const bytes = new Uint8Array([1, 2, 3]);
    const buffer = Buffer.from([4, 5, 6]);

    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "Devtools.detached-payload",
        payload: {
          error,
          bytes,
          buffer,
        },
      }),
    );

    error.message = "after";
    (error as Error & { extra: { nested: { value: number } } }).extra.nested.value = 2;
    bytes[0] = 9;
    buffer[0] = 9;

    const event = Effect.runSync(store.getSnapshot()).events?.[0];
    expect(event?._tag).toBe("Custom");
    const payload =
      event?._tag === "Custom"
        ? (event.payload as {
            readonly error: {
              readonly name: string;
              readonly message: string;
              readonly extra: { readonly nested: { readonly value: number } };
            };
            readonly bytes: Uint8Array;
            readonly buffer: Buffer;
          })
        : undefined;

    expect(payload?.error).toMatchObject({
      name: "TypeError",
      message: "before",
      extra: {
        nested: { value: 1 },
      },
    });
    expect([...payload!.bytes]).toEqual([1, 2, 3]);
    expect([...payload!.buffer]).toEqual([4, 5, 6]);
    expect(Devtools.toSerializable(payload?.error)).toMatchObject({
      name: "TypeError",
      message: "before",
      extra: {
        nested: { value: 1 },
      },
    });
  });

  it("guards hostile array proxies while detaching stored payloads", () => {
    const store = Devtools.makeStore();
    const hostileArray = new Proxy(["a"], {
      get: (target, property, receiver) => {
        if (property === "0") {
          throw new Error("array item failed");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() =>
      Effect.runSync(
        store.recordRuntimeEvent({
          _tag: "Custom",
          name: "Devtools.hostile-array",
          payload: hostileArray,
        }),
      ),
    ).not.toThrow();

    const event = Effect.runSync(store.getSnapshot()).events?.[0];
    expect(event).toMatchObject({
      _tag: "Custom",
      payload: {
        _tag: "UninspectableObject",
      },
    });
  });

  it("bounds deeply nested custom runtime payloads while detaching", () => {
    const store = Devtools.makeStore();
    let payload: Record<string, unknown> = { value: "leaf" };
    for (let index = 0; index < 20_000; index++) {
      payload = { child: payload };
    }

    expect(() =>
      Effect.runSync(
        store.recordRuntimeEvent({
          _tag: "Custom",
          name: "Devtools.deep-payload",
          payload,
        }),
      ),
    ).not.toThrow();

    const event = Effect.runSync(store.getSnapshot()).events?.[0];
    expect(event?._tag).toBe("Custom");
    let cursor = event?._tag === "Custom" ? event.payload : undefined;
    for (let depth = 0; depth < 8; depth++) {
      cursor = (cursor as { readonly child?: unknown }).child;
    }
    expect(cursor).toEqual({
      _tag: "MaxDepth",
    });
  });

  it("truncates large arrays and maps while detaching stored payloads", () => {
    const store = Devtools.makeStore();
    const accessedArrayIndexes: Array<string> = [];
    const largeArray = new Proxy(
      Array.from({ length: 55 }, (_, index) => index),
      {
        get: (target, property, receiver) => {
          accessedArrayIndexes.push(String(property));
          if (property === "50") {
            throw new Error("array copy crossed the entry bound");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
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
          [Symbol.iterator]: () => guardedIterator,
        };
        return guardedIterator;
      },
    });

    expect(() =>
      Effect.runSync(
        store.recordRuntimeEvent({
          _tag: "Custom",
          name: "Devtools.large-payload",
          payload: {
            largeArray,
            largeMap,
          },
        }),
      ),
    ).not.toThrow();

    const event = Effect.runSync(store.getSnapshot()).events?.[0];
    const payload =
      event?._tag === "Custom"
        ? (event.payload as {
            readonly largeArray: ReadonlyArray<unknown>;
            readonly largeMap: Map<number, number>;
          })
        : undefined;

    expect(payload?.largeArray).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      {
        _tag: "Truncated",
        remaining: 5,
      },
    ]);
    expect(Devtools.toSerializable(payload?.largeArray)).toEqual([
      ...Array.from({ length: 50 }, (_, index) => index),
      {
        _tag: "Truncated",
        remaining: 5,
      },
    ]);
    expect(accessedArrayIndexes).not.toContain("50");
    expect(payload?.largeMap).toBeInstanceOf(Map);
    expect([...(payload?.largeMap.entries() ?? [])]).toEqual(
      Array.from({ length: 50 }, (_, index) => [index, index]),
    );
    expect(pulledMapEntries).toBe(50);
    expect(Devtools.toSerializable(payload?.largeMap)).toEqual({
      _tag: "Map",
      size: 55,
      entries: [
        ...Array.from({ length: 50 }, (_, index) => [index, index]),
        {
          _tag: "Truncated",
          remaining: 5,
        },
      ],
    });
  });

  it("copies ArrayBuffer payloads and serializes inspectable bytes", () => {
    const store = Devtools.makeStore();
    const buffer = new ArrayBuffer(3);
    const bytes = new Uint8Array(buffer);
    bytes.set([4, 5, 6]);

    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "Devtools.array-buffer",
        payload: {
          buffer,
        },
      }),
    );
    bytes[0] = 9;

    const event = Effect.runSync(store.getSnapshot()).events?.[0];
    const copiedBuffer =
      event?._tag === "Custom"
        ? (event.payload as { readonly buffer: ArrayBuffer }).buffer
        : undefined;

    expect(copiedBuffer).toBeInstanceOf(ArrayBuffer);
    expect(copiedBuffer).not.toBe(buffer);
    expect([...new Uint8Array(copiedBuffer!)]).toEqual([4, 5, 6]);
    expect(Devtools.toSerializable(copiedBuffer)).toEqual({
      _tag: "ArrayBuffer",
      byteLength: 3,
      bytes: [4, 5, 6],
    });
    expect(Effect.runSync(store.getSummary()).runtime.events[0]?.data).toEqual({
      name: "Devtools.array-buffer",
      payload: {
        buffer: {
          _tag: "ArrayBuffer",
          byteLength: 3,
          bytes: [4, 5, 6],
        },
      },
    });
  });

  it("projects resource failure causes and interruptions into resource state facts", () => {
    const store = Devtools.makeStore();

    Effect.runSync(
      store.recordResourceEvent({
        _tag: "ResourceFailure",
        name: "Project.failed-resource",
        key: "Project.failed-resource:atlas",
        cause: Cause.die(new Error("loader crashed")),
        previous: false,
      }),
    );
    Effect.runSync(
      store.recordResourceEvent({
        _tag: "ResourceInterrupted",
        name: "Project.interrupted-resource",
        key: "Project.interrupted-resource:atlas",
      }),
    );

    expect(Effect.runSync(store.getSummary()).resources).toEqual([
      expect.objectContaining({
        key: "Project.failed-resource:atlas",
        state: "Failure",
        sources: ["RuntimeEvent"],
      }),
      expect.objectContaining({
        key: "Project.interrupted-resource:atlas",
        state: "Interrupted",
        sources: ["RuntimeEvent"],
      }),
    ]);
  });

  it("projects resource runtime events into their panel", () => {
    const store = Devtools.makeStore();

    Effect.runSync(
      store.recordResourceEvent({
        _tag: "ResourceSuccess",
        name: "Project.runtime-resource",
        key: "Project.runtime-resource:atlas",
        timestamp: 1,
      }),
    );
    const summary = Effect.runSync(store.getSummary());
    expect(summary.resources).toEqual([
      expect.objectContaining({
        key: "Project.runtime-resource:atlas",
        family: "Project.runtime-resource",
        state: "Success",
        sources: ["RuntimeEvent"],
      }),
    ]);

    const panels = Effect.runSync(store.getPanels());
    expect(panels.panels.find((panel) => panel.id === "resources")).toMatchObject({
      severity: "ok",
      items: [
        expect.objectContaining({
          id: "resource:Project.runtime-resource:atlas",
          label: "Project.runtime-resource",
          detail: "Success",
        }),
      ],
    });
  });

  it("redacts sensitive request trace URL queries, headers, and cookies before storage and projection", () => {
    const store = Devtools.makeStore({
      serializationPolicy: {
        redactKeys: ["tenantPrivate"],
      },
    });
    const trace: Devtools.RequestTrace = {
      request: {
        id: "req-sensitive",
        method: "POST",
        url: "https://example.test/projects/secret?tab=activity&accessToken=raw-url-token&tenantPrivate=raw-url-tenant&api_key=raw-url-api-key",
        path: "/projects/secret?tab=activity&password=raw-path-password&tenantPrivate=raw-path-tenant",
        transport: "rpc",
        headers: [
          { name: "accept", value: "application/json" },
          { name: "authorization", value: "Bearer raw-secret" },
          { name: "cookie", value: "sid=raw-cookie; theme=dark" },
          { name: "x-api-key", value: "raw-api-key" },
        ],
        cookies: [
          { name: "theme", value: "dark" },
          { name: "session", value: "raw-session" },
          { name: "csrfToken", value: "raw-csrf" },
        ],
      },
      response: {
        status: 200,
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "set-cookie", value: "sid=raw-set-cookie; Path=/" },
          { name: "x-api-key", value: "raw-response-key" },
        ],
      },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      routePlan: {
        _tag: "Matched",
        href: "/projects/secret?accessToken=raw-route-token&tenantPrivate=raw-route-tenant",
        match: {
          path: "/projects/:id",
          href: "/projects/secret?password=raw-route-password&tenantPrivate=raw-route-tenant",
          params: { id: "secret" },
          search: {
            accessToken: "raw-search-token",
            tab: "activity",
          },
        },
        resources: [],
        hydration: {
          resourceCount: 0,
        },
      },
      status: "success",
    };

    Effect.runSync(store.recordRequestTrace(trace));

    const snapshot = Effect.runSync(store.getSnapshot());
    const storedTrace = snapshot.requestTraces?.[0];
    expect(storedTrace?.request.url).toContain("tab=activity");
    expect(storedTrace?.request.url).toContain("[redacted]=[redacted]");
    expect(storedTrace?.request.path).toContain("tab=activity");
    expect(storedTrace?.request.path).toContain("[redacted]=[redacted]");
    expect(storedTrace?.request.headers).toEqual(
      expect.arrayContaining([
        { name: "accept", value: "application/json" },
        { name: "[redacted]", value: "[redacted]" },
      ]),
    );
    expect(
      storedTrace?.request.headers?.filter((header) => header.name === "[redacted]"),
    ).toHaveLength(3);
    expect(storedTrace?.response?.headers).toEqual(
      expect.arrayContaining([
        { name: "content-type", value: "application/json" },
        { name: "[redacted]", value: "[redacted]" },
      ]),
    );
    expect(
      storedTrace?.response?.headers?.filter((header) => header.name === "[redacted]"),
    ).toHaveLength(2);
    expect(storedTrace?.request.cookies).toEqual(
      expect.arrayContaining([
        { name: "theme", value: "[redacted]" },
        { name: "[redacted]", value: "[redacted]" },
      ]),
    );
    expect(storedTrace?.request.cookies?.every((cookie) => cookie.value === "[redacted]")).toBe(
      true,
    );
    expect(
      storedTrace?.request.cookies?.filter((cookie) => cookie.name === "[redacted]"),
    ).toHaveLength(2);

    const projections = [
      snapshot,
      Effect.runSync(store.getSummary()),
      Effect.runSync(store.getPanels()),
      Effect.runSync(store.getCausalGraph()),
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
        "raw-csrf",
        "raw-url-token",
        "tenantprivate",
        "raw-url-tenant",
        "api_key",
        "raw-url-api-key",
        "password",
        "raw-path-password",
        "raw-path-tenant",
        "raw-route-token",
        "raw-route-password",
        "raw-route-tenant",
        "raw-search-token",
      ]) {
        expect(projected).not.toContain(raw);
      }
    }
  });

  it("records structured request traces and links them into the causal graph", async () => {
    const store = Devtools.makeStore();
    const trace: Devtools.RequestTrace = {
      request: {
        id: "req-project-atlas",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        method: "GET",
        url: "https://example.test/projects/atlas?tab=activity",
        path: "/projects/atlas",
        transport: "rpc",
        headers: [
          { name: "accept", value: "application/json" },
          { name: "x-sunfall-arc-request-id", value: "req-project-atlas" },
        ],
        cookies: [{ name: "[redacted]", value: "[redacted]" }],
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: [{ name: "content-type", value: "application/json" }],
        setCookieCount: 1,
      },
      services: ["Clock", "ProjectApi"],
      routePlan: {
        _tag: "Matched",
        href: "/projects/atlas?tab=activity",
        match: {
          path: "/projects/:id",
          href: "/projects/atlas?tab=activity",
          params: { id: "atlas" },
          search: { tab: "activity" },
        },
        resources: [
          {
            key: "Project.byId:atlas",
            family: "Project.byId",
            input: { id: "atlas" },
          },
        ],
        hydration: {
          resourceCount: 1,
          resourceKeys: ["Project.byId:atlas"],
        },
      },
      resources: [
        {
          key: "Project.byId:atlas",
          family: "Project.byId",
          input: { id: "atlas" },
          state: "Success",
        },
      ],
      serverFunctions: [
        {
          name: "Project.load",
          status: "success",
        },
      ],
      actions: [
        {
          name: "Project.rename",
          state: "Success",
          invalidationIndexes: [0],
        },
      ],
      fibers: [
        {
          name: "render",
          status: "done",
        },
      ],
      streams: [
        {
          name: "html",
          state: "closed",
          chunkCount: 3,
        },
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
          tagCount: 1,
        },
        afterDispose: {
          fiberCount: 0,
          familyCount: 1,
          moduleCount: 0,
          tagCount: 1,
        },
      },
    };

    await Effect.runPromise(store.recordRequestTrace(trace));

    const snapshot = Effect.runSync(store.getSnapshot());
    const summary = Effect.runSync(store.getSummary());
    const graph = Effect.runSync(store.getCausalGraph());

    expect(snapshot.requestTraces).toEqual([trace]);
    expect(snapshot.events).toEqual([
      {
        _tag: "RequestTrace",
        sequence: 0,
        trace,
      },
    ]);
    expect(summary.overview).toMatchObject({
      requestTraceCount: 1,
      runtimeEventCount: 1,
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
          tagCount: 1,
        },
        afterDispose: {
          fiberCount: 0,
          familyCount: 1,
          moduleCount: 0,
          tagCount: 1,
        },
        beforeDisposeFiberCount: 2,
        afterDisposeFiberCount: 0,
        cleanupFailure: null,
        serverFunctions: [
          {
            name: "Project.load",
            status: "success",
            failureKind: null,
          },
        ],
        actions: [
          {
            name: "Project.rename",
            state: "Success",
            failureKind: null,
            invalidationIndexes: [0],
          },
        ],
        routeHref: "/projects/atlas?tab=activity",
      },
    ]);
    const panels = Effect.runSync(store.getPanels());
    const requestPanel = panels.panels.find((panel) => panel.id === "requests");
    expect(requestPanel).toMatchObject({
      severity: "ok",
      metrics: expect.arrayContaining([
        {
          label: "average duration",
          value: 23,
          unit: "ms",
        },
      ]),
      items: [
        expect.objectContaining({
          id: "request:req-project-atlas",
          label: "GET /projects/atlas",
          detail: "rpc success",
          metrics: expect.arrayContaining([
            {
              label: "before fibers",
              value: 2,
            },
            {
              label: "after fibers",
              value: 0,
            },
            {
              label: "before families",
              value: 1,
            },
            {
              label: "after modules",
              value: 0,
            },
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
              tagCount: 1,
            },
            afterDispose: {
              fiberCount: 0,
              familyCount: 1,
              moduleCount: 0,
              tagCount: 1,
            },
            serverFunctions: [
              {
                name: "Project.load",
                status: "success",
                failureKind: null,
              },
            ],
            actions: [
              {
                name: "Project.rename",
                state: "Success",
                failureKind: null,
                invalidationIndexes: [0],
              },
            ],
          }),
        }),
      ],
    });
    await expect(Effect.runPromise(store.getPanels())).resolves.toMatchObject({
      panels: expect.arrayContaining([expect.objectContaining({ id: "requests" })]),
    });
    expect(summary.runtime.events).toEqual([
      expect.objectContaining({
        _tag: "RequestTrace",
        label: "GET /projects/atlas",
        target: {
          kind: "RequestTrace",
          id: "request-trace:req-project-atlas",
        },
      }),
    ]);
    expect(summary.resources).toEqual([
      {
        key: "Project.byId:atlas",
        family: "Project.byId",
        input: { id: "atlas" },
        state: "Success",
        sources: ["RequestTrace"],
        routeHrefs: ["/projects/atlas?tab=activity"],
        invalidationIndexes: [],
      },
    ]);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "request-trace:req-project-atlas", kind: "RequestTrace" }),
        expect.objectContaining({ id: "endpoint:rpc", kind: "Endpoint" }),
        expect.objectContaining({ id: "route:/projects/:id", kind: "Route" }),
        expect.objectContaining({ id: "resource:Project.byId:atlas", kind: "Resource" }),
        expect.objectContaining({ id: "server-function:Project.load", kind: "ServerFunction" }),
        expect.objectContaining({ id: "action:Project.rename", kind: "Action" }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "UsesEndpoint",
          source: "request-trace:req-project-atlas",
          target: "endpoint:rpc",
        }),
        expect.objectContaining({
          kind: "Records",
          source: "request-trace:req-project-atlas",
          target: "route-plan:0:/projects/atlas?tab=activity",
        }),
        expect.objectContaining({
          kind: "Matches",
          source: "route-plan:0:/projects/atlas?tab=activity",
          target: "route:/projects/:id",
        }),
        expect.objectContaining({
          kind: "Preloads",
          source: "route-plan:0:/projects/atlas?tab=activity",
          target: "resource:Project.byId:atlas",
        }),
        expect.objectContaining({
          kind: "Records",
          source: "request-trace:req-project-atlas",
          target: "resource:Project.byId:atlas",
        }),
        expect.objectContaining({
          kind: "Records",
          source: "request-trace:req-project-atlas",
          target: "server-function:Project.load",
        }),
        expect.objectContaining({
          kind: "Records",
          source: "request-trace:req-project-atlas",
          target: "action:Project.rename",
        }),
        expect.objectContaining({
          kind: "Observes",
          source: "runtime-event:0:RequestTrace",
          target: "request-trace:req-project-atlas",
        }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Hydrates",
          source: "route-plan:0:/projects/atlas?tab=activity",
          target: "resource:Project.byId:atlas",
        }),
      ]),
    );
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("preserves bounded request runtime cleanup failures in snapshots, summaries, and panels", () => {
    const store = Devtools.makeStore();
    const trace: Devtools.RequestTrace = {
      request: {
        id: "req-cleanup-failure",
        method: "GET",
        url: "https://example.test/projects/cleanup",
        path: "/projects/cleanup",
        transport: "ssr",
      },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "failure",
      teardown: {
        runtimeDisposed: false,
        reason: "cleanup-failed",
        cleanupFailure: {
          _tag: "Failure",
          message: "cleanup-failed",
        },
      },
    };

    Effect.runSync(store.recordRequestTrace(trace));

    expect(
      Effect.runSync(store.getSnapshot()).requestTraces?.[0]?.teardown?.cleanupFailure,
    ).toEqual({
      _tag: "Failure",
      message: "cleanup-failed",
    });
    expect(Effect.runSync(store.getSummary()).requests.traces[0]?.cleanupFailure).toEqual({
      _tag: "Failure",
      message: "cleanup-failed",
    });
    expect(
      Effect.runSync(store.getPanels()).panels.find((panel) => panel.id === "requests")?.items[0]
        ?.data,
    ).toMatchObject({
      cleanupFailure: {
        _tag: "Failure",
        message: "cleanup-failed",
      },
    });
  });

  it("projects runtime-only request trace events into request facts and causal records", () => {
    const store = Devtools.makeStore();
    const trace: Devtools.RequestTrace = {
      request: {
        id: "req-runtime-only",
        method: "GET",
        url: "https://example.test/projects/runtime-only",
        path: "/projects/runtime-only",
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [
        {
          key: "Project.runtime-only:1",
          family: "Project.runtime-only",
          input: { id: "1" },
          state: "Success",
        },
      ],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    };

    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "RequestTrace",
        trace,
      }),
    );

    const summary = Effect.runSync(store.getSummary());
    const requestPanel = Effect.runSync(store.getPanels()).panels.find(
      (panel) => panel.id === "requests",
    );
    const graph = Effect.runSync(store.getCausalGraph());

    expect(summary.requests.traces).toEqual([
      expect.objectContaining({
        id: "req-runtime-only",
        method: "GET",
        path: "/projects/runtime-only",
        resourceCount: 1,
      }),
    ]);
    expect(requestPanel?.items).toEqual([
      expect.objectContaining({
        id: "request:req-runtime-only",
        label: "GET /projects/runtime-only",
      }),
    ]);
    expect(summary.resources).toEqual([
      expect.objectContaining({
        key: "Project.runtime-only:1",
        family: "Project.runtime-only",
        state: "Success",
        sources: ["RequestTrace"],
      }),
    ]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Records",
          source: "request-trace:req-runtime-only",
          target: "resource:Project.runtime-only:1",
        }),
        expect.objectContaining({
          kind: "Observes",
          source: "runtime-event:0:RequestTrace",
          target: "request-trace:req-runtime-only",
        }),
      ]),
    );
  });

  it("preserves request owner failures in summaries and panels", async () => {
    const store = Devtools.makeStore();
    const trace: Devtools.RequestTrace = {
      request: {
        id: "req-project-failure",
        method: "POST",
        url: "https://example.test/__sunfall-arc/action",
        path: "/__sunfall-arc/action",
        transport: "action",
      },
      services: ["ProjectApi"],
      resources: [],
      serverFunctions: [
        {
          name: "Project.load",
          status: "failure",
          failureKind: "domain",
        },
      ],
      actions: [
        {
          name: "Project.rename",
          state: "Failure",
          failureKind: "validation",
          invalidationIndexes: [2],
        },
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
          tagCount: 4,
        },
        afterDispose: {
          fiberCount: 0,
          familyCount: 2,
          moduleCount: 1,
          tagCount: 4,
        },
      },
    };

    await Effect.runPromise(store.recordRequestTrace(trace));

    const summary = Effect.runSync(store.getSummary());
    expect(summary.requests.traces[0]).toMatchObject({
      failureKind: "validation",
      beforeDispose: {
        fiberCount: 1,
        familyCount: 2,
        moduleCount: 3,
        tagCount: 4,
      },
      afterDispose: {
        fiberCount: 0,
        familyCount: 2,
        moduleCount: 1,
        tagCount: 4,
      },
      serverFunctions: [
        {
          name: "Project.load",
          status: "failure",
          failureKind: "domain",
        },
      ],
      actions: [
        {
          name: "Project.rename",
          state: "Failure",
          failureKind: "validation",
          invalidationIndexes: [2],
        },
      ],
    });

    const requestPanel = Effect.runSync(store.getPanels()).panels.find(
      (panel) => panel.id === "requests",
    );
    expect(requestPanel?.items[0]).toMatchObject({
      detail:
        "action failure (validation) server:Project.load:domain, action:Project.rename:validation",
      metrics: expect.arrayContaining([
        {
          label: "server failures",
          value: 1,
        },
        {
          label: "action failures",
          value: 1,
        },
        {
          label: "before modules",
          value: 3,
        },
        {
          label: "after modules",
          value: 1,
        },
      ]),
      data: expect.objectContaining({
        serverFunctions: [
          {
            name: "Project.load",
            status: "failure",
            failureKind: "domain",
          },
        ],
        actions: [
          {
            name: "Project.rename",
            state: "Failure",
            failureKind: "validation",
            invalidationIndexes: [2],
          },
        ],
      }),
    });
  });

  it("stamps id-less request traces before runtime-event summarization", () => {
    const store = Devtools.makeStore();
    const trace: Devtools.RequestTrace = {
      request: {
        method: "GET",
        url: "https://example.test/projects/atlas",
        path: "/projects/atlas",
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    };

    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        sequence: 0,
        name: "before-trace",
      }),
    );
    Effect.runSync(store.recordRequestTrace(trace));

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(snapshot.requestTraces?.[0]?.request.id).toBe("trace:0");
    expect(snapshot.events?.[1]).toMatchObject({
      _tag: "RequestTrace",
      sequence: 1,
      trace: {
        request: {
          id: "trace:0",
        },
      },
    });

    const graph = Effect.runSync(store.getCausalGraph());
    expect(graph.nodes.filter((node) => node.kind === "RequestTrace")).toEqual([
      expect.objectContaining({ id: "request-trace:trace:0" }),
    ]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:RequestTrace",
        target: "request-trace:trace:0",
      }),
    );
  });

  it("normalizes direct id-less request traces before runtime-event graph projection", () => {
    const trace: Devtools.RequestTrace = {
      request: {
        method: "GET",
        url: "https://example.test/projects/direct",
        path: "/projects/direct",
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    };
    const graph = Devtools.describeCausalGraph({
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
            name: "before",
          },
          {
            _tag: "RequestTrace",
            sequence: 1,
            trace,
          },
        ],
      },
    });

    expect(graph.nodes.filter((node) => node.kind === "RequestTrace")).toEqual([
      expect.objectContaining({ id: "request-trace:trace:0" }),
    ]);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:RequestTrace",
        target: "request-trace:trace:0",
      }),
    );
  });

  it("seeds runtime trace id allocation from caller-supplied trace ids", () => {
    const store = Devtools.makeStore();
    const requestTrace = (path: string, id?: string): Devtools.RequestTrace => ({
      request: {
        ...(id === undefined ? {} : { id }),
        method: "GET",
        url: `https://example.test${path}`,
        path,
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    });

    Effect.runSync(store.recordRequestTrace(requestTrace("/projects/existing", "trace:1")));
    Effect.runSync(store.recordRequestTrace(requestTrace("/projects/runtime")));

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(snapshot.requestTraces?.map((trace) => trace.request.id)).toEqual([
      "trace:1",
      "trace:2",
    ]);
    expect(
      snapshot.events?.map((event) =>
        event._tag === "RequestTrace" ? event.trace.request.id : null,
      ),
    ).toEqual(["trace:1", "trace:2"]);
  });

  it("normalizes imported id-less request traces before allocating new trace ids", () => {
    const store = Devtools.makeStore();
    const requestTrace = (path: string, id?: string): Devtools.RequestTrace => ({
      request: {
        ...(id === undefined ? {} : { id }),
        method: "GET",
        url: `https://example.test${path}`,
        path,
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    });
    const importedTrace = requestTrace("/projects/imported");

    Effect.runSync(
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        requestTraces: [importedTrace, requestTrace("/projects/existing", "trace:7")],
        events: [
          {
            _tag: "RequestTrace",
            sequence: 3,
            trace: importedTrace,
          },
        ],
      }),
    );
    Effect.runSync(store.recordRequestTrace(requestTrace("/projects/runtime")));

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(snapshot.requestTraces?.map((trace) => trace.request.id)).toEqual([
      "trace:8",
      "trace:7",
      "trace:9",
    ]);
    expect(
      snapshot.events?.map((event) =>
        event._tag === "RequestTrace" ? event.trace.request.id : null,
      ),
    ).toEqual(["trace:8", "trace:9"]);

    expect(Effect.runSync(store.getSummary()).requests.traces.map((trace) => trace.id)).toEqual([
      "trace:8",
      "trace:7",
      "trace:9",
    ]);
    expect(
      Effect.runSync(store.getCausalGraph())
        .nodes.filter((node) => node.kind === "RequestTrace")
        .map((node) => node.id),
    ).toEqual(["request-trace:trace:7", "request-trace:trace:8", "request-trace:trace:9"]);
    expect(Effect.runSync(store.getCausalGraph()).edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Observes",
          source: "runtime-event:3:RequestTrace",
          target: "request-trace:trace:8",
        }),
        expect.objectContaining({
          kind: "Observes",
          source: "runtime-event:4:RequestTrace",
          target: "request-trace:trace:9",
        }),
      ]),
    );
  });

  it("normalizes id-less request traces before applying import trace limits", () => {
    const store = Devtools.makeStore({
      requestTraceLimit: 1,
      eventLimit: 2,
    });
    const requestTrace = (resourceKey: string): Devtools.RequestTrace => ({
      request: {
        method: "GET",
        url: "https://example.test/projects/atlas",
        path: "/projects/atlas",
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [
        {
          key: resourceKey,
          family: "Project",
          input: { id: resourceKey },
          state: "Success",
        },
      ],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    });
    const droppedTrace = requestTrace("Project:dropped");
    const retainedTrace = requestTrace("Project:retained");

    Effect.runSync(
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
            trace: droppedTrace,
          },
          {
            _tag: "RequestTrace",
            sequence: 1,
            trace: retainedTrace,
          },
        ],
      }),
    );

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(
      snapshot.requestTraces?.map((trace) => ({
        id: trace.request.id,
        resourceKey: trace.resources[0]?.key,
      })),
    ).toEqual([
      {
        id: "trace:1",
        resourceKey: "Project:retained",
      },
    ]);
    expect(
      snapshot.events
        ?.filter((event) => event._tag === "RequestTrace")
        .map((event) =>
          event._tag === "RequestTrace"
            ? {
                id: event.trace.request.id,
                resourceKey: event.trace.resources[0]?.key,
              }
            : undefined,
        ),
    ).toEqual([
      {
        id: "trace:0",
        resourceKey: "Project:dropped",
      },
      {
        id: "trace:1",
        resourceKey: "Project:retained",
      },
    ]);

    const graph = Effect.runSync(store.getCausalGraph());
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RequestTrace",
        target: "request-trace:trace:0",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:RequestTrace",
        target: "request-trace:trace:1",
      }),
    );
    expect(graph.edges).not.toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RequestTrace",
        target: "request-trace:trace:1",
      }),
    );
  });

  it("does not detach request traces dropped by import limits", () => {
    const store = Devtools.makeStore({
      requestTraceLimit: 1,
    });
    const droppedTrace: Devtools.RequestTrace = {
      request: {
        method: "GET",
        url: "https://example.test/dropped",
        path: "/dropped",
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    };
    Object.defineProperty(droppedTrace, "resources", {
      get() {
        throw new Error("dropped trace should not be detached");
      },
    });
    const retainedTrace: Devtools.RequestTrace = {
      request: {
        method: "GET",
        url: "https://example.test/retained",
        path: "/retained",
        transport: "ssr",
      },
      response: { status: 200 },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [],
      fibers: [],
      streams: [],
      status: "success",
    };

    expect(() =>
      Effect.runSync(
        store.setSnapshot({
          resources: [],
          actions: [],
          invalidations: [],
          routePlans: [],
          requestTraces: [droppedTrace, retainedTrace],
        }),
      ),
    ).not.toThrow();
    expect(
      Effect.runSync(store.getSnapshot()).requestTraces?.map((trace) => trace.request.path),
    ).toEqual(["/retained"]);
  });

  it("applies store limits and fact rebasing when importing snapshots", () => {
    const store = Devtools.makeStore({
      invalidationLimit: 1,
      routePlanLimit: 1,
      requestTraceLimit: 1,
      eventLimit: 2,
    });
    const firstInvalidation: Devtools.InvalidationPlan = {
      targets: [{ _tag: "Tag", key: "First", name: "First" }],
      entries: [],
    };
    const secondInvalidation: Devtools.InvalidationPlan = {
      targets: [{ _tag: "Tag", key: "Second", name: "Second" }],
      entries: [],
    };
    const firstRoutePlan: Devtools.RoutePlan = {
      _tag: "Matched",
      href: "/first",
      match: {
        path: "/first",
        href: "/first",
        params: {},
        search: {},
      },
      resources: [],
      hydration: { resourceCount: 0 },
    };
    const secondRoutePlan: Devtools.RoutePlan = {
      ...firstRoutePlan,
      href: "/second",
      match: {
        path: "/second",
        href: "/second",
        params: {},
        search: {},
      },
    };
    const requestTrace = (id: string): Devtools.RequestTrace => ({
      request: {
        id,
        method: "GET",
        url: `https://example.test/${id}`,
        path: `/${id}`,
        transport: "ssr",
      },
      services: [],
      resources: [],
      serverFunctions: [],
      actions: [
        {
          name: "Project.rename",
          invalidationIndexes: [0, 1],
        },
      ],
      fibers: [],
      streams: [],
      status: "success",
    });

    Effect.runSync(
      store.setSnapshot({
        resources: [],
        actions: [
          {
            name: "Project.rename",
            state: "Success",
            invalidationIndexes: [0, 1],
          },
        ],
        invalidations: [firstInvalidation, secondInvalidation],
        routePlans: [firstRoutePlan, secondRoutePlan],
        requestTraces: [requestTrace("trace:0"), requestTrace("trace:1")],
        events: [
          {
            _tag: "Custom",
            sequence: 0,
            name: "dropped",
          },
          {
            _tag: "ActionState",
            sequence: 1,
            action: "Project.rename",
            state: "Success",
            invalidationIndexes: [0, 1],
          },
          {
            _tag: "RoutePlan",
            sequence: 2,
            routePlanIndex: 1,
            plan: secondRoutePlan,
          },
        ],
      }),
    );

    const snapshot = Effect.runSync(store.getSnapshot());
    expect(snapshot.invalidations).toEqual([secondInvalidation]);
    expect(snapshot.routePlans).toEqual([secondRoutePlan]);
    expect(snapshot.requestTraces?.map((trace) => trace.request.id)).toEqual(["trace:1"]);
    expect(snapshot.actions[0]?.invalidationIndexes).toEqual([0]);
    expect(snapshot.requestTraces?.[0]?.actions[0]?.invalidationIndexes).toEqual([0]);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        _tag: "ActionState",
        sequence: 1,
        invalidationIndexes: [0],
      }),
      expect.objectContaining({
        _tag: "RoutePlan",
        sequence: 2,
        routePlanIndex: 0,
      }),
    ]);
  });

  it("returns retained route plan indexes so runtime events can observe duplicate route facts", () => {
    const store = Devtools.makeStore();
    const plan: Devtools.RoutePlan = {
      _tag: "Matched",
      href: "/duplicate",
      match: {
        path: "/duplicate",
        href: "/duplicate",
        params: {},
        search: {},
      },
      resources: [],
      hydration: {
        resourceCount: 0,
      },
    };
    const invalidationIndex = Effect.runSync(
      store.recordSerializedInvalidation({
        targets: [{ _tag: "Tag", key: "Duplicate.Project", name: "Duplicate.Project" }],
        entries: [],
      }),
    );
    const firstRoutePlanIndex = Effect.runSync(store.recordSerializedRoutePlan(plan));
    const secondRoutePlanIndex = Effect.runSync(store.recordSerializedRoutePlan(plan));

    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "RoutePlan",
        routePlanIndex: secondRoutePlanIndex,
        plan,
      }),
    );

    expect(invalidationIndex).toBe(0);
    expect(firstRoutePlanIndex).toBe(0);
    expect(secondRoutePlanIndex).toBe(1);
    expect(Effect.runSync(store.getSnapshot()).events).toEqual([
      expect.objectContaining({
        _tag: "RoutePlan",
        sequence: 0,
        routePlanIndex: 1,
      }),
    ]);

    const summary = Effect.runSync(store.getSummary());
    expect(summary.routes.plans.map((routePlan) => routePlan.index)).toEqual([0, 1]);
    expect(summary.runtime.events[0]).toMatchObject({
      _tag: "RoutePlan",
      target: {
        kind: "RoutePlan",
        id: "route-plan:1:/duplicate",
      },
      routePlan: {
        index: 1,
        href: "/duplicate",
      },
    });
    expect(Effect.runSync(store.getCausalGraph()).edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:0:RoutePlan",
        target: "route-plan:1:/duplicate",
      }),
    );
  });

  it("applies import limits before detaching dropped runtime event payloads", () => {
    const store = Devtools.makeStore({ eventLimit: 1 });
    const droppedPayload: Record<string, unknown> = {};
    Object.defineProperty(droppedPayload, "explode", {
      enumerable: true,
      get() {
        throw new Error("dropped payload should not be inspected");
      },
    });

    expect(() =>
      Effect.runSync(
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
              payload: droppedPayload,
            },
            {
              _tag: "Custom",
              sequence: 1,
              name: "kept",
              payload: { ok: true },
            },
          ],
        }),
      ),
    ).not.toThrow();

    expect(Effect.runSync(store.getSnapshot()).events).toEqual([
      {
        _tag: "Custom",
        sequence: 1,
        name: "kept",
        payload: { ok: true },
      },
    ]);
  });

  it("seeds runtime event sequence ids from imported snapshots", () => {
    const store = Devtools.makeStore();

    Effect.runSync(
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        events: [
          {
            _tag: "Custom",
            sequence: 4,
            name: "imported",
          },
        ],
      }),
    );
    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "runtime",
      }),
    );

    expect(Effect.runSync(store.getSnapshot()).events).toEqual([
      {
        _tag: "Custom",
        sequence: 4,
        name: "imported",
      },
      {
        _tag: "Custom",
        sequence: 5,
        name: "runtime",
      },
    ]);
    expect(Effect.runSync(store.getCausalGraph()).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime-event:4:Custom",
          kind: "RuntimeEvent",
          label: "imported",
        }),
        expect.objectContaining({
          id: "runtime-event:5:Custom",
          kind: "RuntimeEvent",
          label: "runtime",
        }),
      ]),
    );
  });

  it("rebases duplicate runtime event sequences imported from snapshots", () => {
    const store = Devtools.makeStore();

    Effect.runSync(
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [],
        events: [
          {
            _tag: "Custom",
            sequence: 0,
            name: "first",
          },
          {
            _tag: "Custom",
            sequence: 0,
            name: "second",
          },
        ],
      }),
    );
    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "runtime",
      }),
    );

    expect(Effect.runSync(store.getSnapshot()).events).toEqual([
      {
        _tag: "Custom",
        sequence: 0,
        name: "first",
      },
      {
        _tag: "Custom",
        sequence: 1,
        name: "second",
      },
      {
        _tag: "Custom",
        sequence: 2,
        name: "runtime",
      },
    ]);
  });

  it("rebases duplicate caller-supplied runtime event sequences", () => {
    const store = Devtools.makeStore();

    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        sequence: 0,
        name: "first",
      }),
    );
    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        sequence: 0,
        name: "second",
      }),
    );

    expect(Effect.runSync(store.getSnapshot()).events).toEqual([
      {
        _tag: "Custom",
        sequence: 0,
        name: "first",
      },
      {
        _tag: "Custom",
        sequence: 1,
        name: "second",
      },
    ]);
    expect(Effect.runSync(store.getCausalGraph()).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "runtime-event:0:Custom" }),
        expect.objectContaining({ id: "runtime-event:1:Custom" }),
      ]),
    );
  });

  it("matches route-plan facts with stable serialized fingerprints", () => {
    const routePlan: Devtools.RoutePlan = {
      _tag: "Matched",
      href: "/ordered",
      match: {
        path: "/ordered",
        href: "/ordered",
        params: { a: "1", b: "2" },
        search: { x: "1", y: "2" },
      },
      resources: [],
      hydration: { resourceCount: 0 },
    };
    const reorderedRoutePlan: Devtools.RoutePlan = {
      ...routePlan,
      match: {
        path: "/ordered",
        href: "/ordered",
        params: { b: "2", a: "1" },
        search: { y: "2", x: "1" },
      },
    };
    const store = Devtools.makeStore();

    Effect.runSync(
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [],
        routePlans: [routePlan],
      }),
    );
    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "RoutePlan",
        plan: reorderedRoutePlan,
      }),
    );

    expect(Effect.runSync(store.getSnapshot()).events?.[0]).toMatchObject({
      _tag: "RoutePlan",
      routePlanIndex: 0,
    });
    expect(Effect.runSync(store.getSummary()).runtime.events[0]?.target).toEqual({
      kind: "RoutePlan",
      id: "route-plan:0:/ordered",
    });
  });

  it("keeps structural route-plan fact identity bounded", () => {
    const accessedIndexes: Array<string> = [];
    const resources = new Proxy(
      Array.from({ length: 55 }, (_, index) => ({
        key: `Project:${index}`,
        family: "Project",
        input: { id: String(index) },
      })),
      {
        get: (target, property, receiver) => {
          accessedIndexes.push(String(property));
          if (property === "50") {
            throw new Error("fact identity crossed the entry bound");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    ) as Devtools.RoutePlan["resources"];
    const routePlan: Devtools.RoutePlan = {
      _tag: "Matched",
      href: "/bounded",
      match: {
        path: "/bounded",
        href: "/bounded",
        params: {},
        search: {},
      },
      resources,
      hydration: { resourceCount: 55 },
    };

    const fingerprint = stableFactFingerprint({
      _tag: "RoutePlan",
      plan: routePlan,
    });

    expect(fingerprint).toBeDefined();
    expect(accessedIndexes).not.toContain("50");
  });

  it("matches invalidation facts through the bounded serialization policy", () => {
    const store = Devtools.makeStore();
    const accessedIndexes: Array<string> = [];
    const largeInput = new Proxy(
      Array.from({ length: 55 }, (_, index) => index),
      {
        get: (target, property, receiver) => {
          accessedIndexes.push(String(property));
          if (property === "50") {
            throw new Error("fact identity crossed the entry bound");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const plan: Devtools.InvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "Project:bounded",
          family: "Project",
          input: largeInput,
        },
      ],
      entries: [],
    };

    Effect.runSync(
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [plan],
        routePlans: [],
      }),
    );
    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Invalidation",
        plan,
      }),
    );

    expect(accessedIndexes).not.toContain("50");
    expect(Effect.runSync(store.getSnapshot()).events?.[0]).toMatchObject({
      _tag: "Invalidation",
      invalidationIndex: 0,
    });
  });

  it("detaches caller snapshots at the store seam", () => {
    const store = Devtools.makeStore();
    const input = { id: "atlas" };
    const plan: Devtools.InvalidationPlan = {
      targets: [
        {
          _tag: "Ref",
          key: "project:atlas",
          family: "Project",
          input,
        },
      ],
      entries: [],
    };

    Effect.runSync(
      store.setSnapshot({
        resources: [],
        actions: [],
        invalidations: [plan],
        routePlans: [],
      }),
    );
    input.id = "changed-after-set";

    const firstSnapshot = Effect.runSync(store.getSnapshot());
    const firstTarget = firstSnapshot.invalidations[0]?.targets[0];
    expect(firstTarget).toMatchObject({
      _tag: "Ref",
      input: {
        id: "atlas",
      },
    });
    if (firstTarget?._tag === "Ref") {
      (firstTarget.input as { id: string }).id = "changed-after-read";
    }

    expect(Effect.runSync(store.getSnapshot()).invalidations[0]?.targets[0]).toMatchObject({
      _tag: "Ref",
      input: {
        id: "atlas",
      },
    });
  });

  it("detaches live invalidation and route-plan descriptions at serialization time", async () => {
    const input = { id: "atlas" };
    const Project = Resource.define({
      name: "Devtools.detached-ref",
      load: (projectInput: typeof input) => Effect.succeed(projectInput),
    });
    const routeDefinition = Route.define("/detached-route/:id", {
      search: Schema.Struct({
        tab: Schema.String,
      }),
    });
    const ref = Project(input);
    const invalidationPlan = describeInvalidationPlan(
      Effect.runSync(Resource.planInvalidation(ref)),
    );
    const navigationPlan = await Effect.runPromise(
      Route.planNavigation([routeDefinition] as const, "/detached-route/atlas?tab=activity"),
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
        id: "atlas",
      },
    });
    expect(routePlan.match).toMatchObject({
      params: {
        id: "atlas",
      },
      search: {
        tab: "activity",
      },
    });
  });

  it("detaches recorded runtime event payloads at the store seam", () => {
    const store = Devtools.makeStore();
    const payload = {
      nested: {
        count: 1,
      },
    };

    Effect.runSync(
      store.recordRuntimeEvent({
        _tag: "Custom",
        name: "custom",
        payload,
      }),
    );
    payload.nested.count = 2;

    const firstEvent = Effect.runSync(store.getSnapshot()).events?.[0];
    expect(firstEvent).toMatchObject({
      _tag: "Custom",
      payload: {
        nested: {
          count: 1,
        },
      },
    });
    if (firstEvent?._tag === "Custom") {
      (firstEvent.payload as { nested: { count: number } }).nested.count = 3;
    }

    expect(Effect.runSync(store.getSnapshot()).events?.[0]).toMatchObject({
      _tag: "Custom",
      payload: {
        nested: {
          count: 1,
        },
      },
    });
  });

  it("lets adapters observe snapshots, summaries, events, and causal graphs through Effect", async () => {
    const store = Devtools.makeStore({ eventLimit: 1 });

    const [snapshot, summary, graph] = await Effect.runPromise(
      Effect.gen(function* () {
        yield* store.recordRuntimeEvent({
          _tag: "Custom",
          name: "first",
          payload: {
            ignored: true,
          },
        });
        yield* store.recordResourceEvent({
          _tag: "ResourceSuccess",
          name: "User.effect-devtools",
          key: "User.effect-devtools:1",
          timestamp: 1,
        });

        return yield* Effect.all([store.getSnapshot(), store.getSummary(), store.getCausalGraph()]);
      }),
    );

    expect(snapshot.events).toEqual([
      {
        _tag: "ResourceStoreEvent",
        sequence: 1,
        event: {
          _tag: "ResourceSuccess",
          name: "User.effect-devtools",
          key: "User.effect-devtools:1",
          timestamp: 1,
        },
      },
    ]);
    expect(summary.runtime.events).toEqual([
      expect.objectContaining({
        _tag: "ResourceStoreEvent",
        sequence: 1,
        target: {
          kind: "Resource",
          id: "resource:User.effect-devtools:1",
        },
      }),
    ]);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "runtime-event:1:ResourceStoreEvent",
        kind: "RuntimeEvent",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        kind: "Observes",
        source: "runtime-event:1:ResourceStoreEvent",
        target: "resource:User.effect-devtools:1",
      }),
    );
  });

  it("explains the golden path across route, action, resource, and invalidation facts", async () => {
    const runtime = makeRuntime();
    const store = Devtools.makeStore();
    const ProjectId = Schema.Struct({ id: Schema.String });
    const Project = Schema.Struct({ id: Schema.String, name: Schema.String });
    const ProjectsTag = Resource.tag("Golden.Projects");
    const ProjectTag = Resource.tag<{ readonly id: string }>("Golden.Project", {
      key: ({ id }) => id,
    });
    const ProjectById = Resource.define({
      name: "Golden.Project.byId",
      input: ProjectId,
      output: Project,
      load: ({ id }: { readonly id: string }) =>
        Effect.succeed({ id, name: id === "atlas" ? "Atlas" : id }),
      provides: (project) => [ProjectTag({ id: project.id })],
    });
    const RenameProject = Action.define<
      { readonly id: string; readonly name: string },
      { readonly id: string; readonly name: string }
    >({
      name: "Golden.Project.rename",
      input: Project,
      output: Project,
      run: (input) => Effect.succeed(input),
      invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
    });
    const ProjectRoute = Route.define("/projects/:id", {
      params: ProjectId,
      search: Schema.Struct({ tab: Schema.optional(Schema.String) }),
      preloadResources: [ProjectById],
      preload: ({ params }) => Resource.preload(ProjectById({ id: params.id })),
    });
    const ref = ProjectById({ id: "atlas" });
    const action = Action.use(RenameProject, { runtime });

    const [summary, graph] = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* runtime.provide(
            Effect.scoped(
              Effect.gen(function* () {
                const resourceSubscription = yield* Resource.subscribeEvents();
                const routePlan = yield* Route.planNavigation(
                  [ProjectRoute] as const,
                  "/projects/atlas?tab=activity",
                );

                yield* store.recordRoutePlan(routePlan);
                yield* store.recordResourceEvent(yield* PubSub.take(resourceSubscription));
                yield* store.recordResourceEvent(yield* PubSub.take(resourceSubscription));

                yield* action.submit({ id: "atlas", name: "Atlas Prime" });
                const invalidationPlan = action.invalidationPlan.get();
                const actionState = action.state.get();

                if (invalidationPlan === undefined) {
                  expect.fail("Expected the golden-path action to expose an invalidation plan.");
                }

                yield* store.recordResourceEvent(yield* PubSub.take(resourceSubscription));
                yield* store.recordResourceEvent(yield* PubSub.take(resourceSubscription));
                yield* store.recordResourceEvent(yield* PubSub.take(resourceSubscription));
                yield* store.recordInvalidation(invalidationPlan);
                yield* store.recordRuntimeEvent({
                  _tag: "ActionState",
                  action: RenameProject.name,
                  state: actionState.result._tag,
                  waiting: actionState.result.waiting,
                  input: { id: "atlas" },
                  invalidationIndexes: [0],
                });

                const snapshot = yield* store.getSnapshot();
                yield* store.setSnapshot({
                  ...snapshot,
                  resources: [
                    {
                      key: ref.key,
                      state: "Success",
                    },
                  ],
                  actions: [
                    {
                      name: RenameProject.name,
                      state: actionState.result._tag,
                      waiting: actionState.result.waiting,
                      invalidationIndexes: [0],
                    },
                  ],
                });
              }),
            ),
          );

          return yield* Effect.all([store.getSummary(), store.getCausalGraph()]);
        }),
      ).pipe(Effect.ensuring(Effect.orDie(runtime.dispose))),
    );

    expect(summary.overview).toMatchObject({
      runtimeResourceCount: 1,
      runtimeActionCount: 1,
      invalidationPlanCount: 1,
      routePlanCount: 1,
      runtimeEventCount: 6,
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
            input: { id: "atlas" },
          },
        ],
      }),
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
            name: "Golden.Projects",
          },
          {
            _tag: "Tag",
            key: "Golden.Project:atlas",
            name: "Golden.Project",
          },
        ],
      }),
    ]);
    expect(summary.resources).toEqual([
      {
        key: ref.key,
        family: "Golden.Project.byId",
        input: { id: "atlas" },
        state: "Success",
        sources: ["Invalidation", "RoutePlan", "RuntimeEvent", "Snapshot"],
        routeHrefs: ["/projects/atlas?tab=activity"],
        invalidationIndexes: [0],
      },
    ]);
    expect(summary.runtime.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "ResourceStoreEvent",
          label: "ResourcePending",
          target: {
            kind: "Resource",
            id: `resource:${ref.key}`,
          },
        }),
        expect.objectContaining({
          _tag: "ResourceStoreEvent",
          label: "ResourceSuccess",
          target: {
            kind: "Resource",
            id: `resource:${ref.key}`,
          },
        }),
        expect.objectContaining({
          _tag: "ResourceStoreEvent",
          label: "ResourceInvalidated",
          target: {
            kind: "Resource",
            id: `resource:${ref.key}`,
          },
        }),
        expect.objectContaining({
          _tag: "ActionState",
          label: "Golden.Project.rename Success",
          target: {
            kind: "Action",
            id: "action:Golden.Project.rename",
          },
        }),
      ]),
    );
    expect(
      summary.runtime.events.filter((event) => event.label === "ResourcePending").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      summary.runtime.events.filter((event) => event.label === "ResourceSuccess").length,
    ).toBeGreaterThanOrEqual(1);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "route:/projects/:id", kind: "Route" }),
        expect.objectContaining({ id: "action:Golden.Project.rename", kind: "Action" }),
        expect.objectContaining({ id: "resource-tag:Golden.Projects", kind: "ResourceTag" }),
        expect.objectContaining({ id: `resource:${ref.key}`, kind: "Resource" }),
        expect.objectContaining({ id: "invalidation:0", kind: "InvalidationPlan" }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Matches",
          source: "route-plan:0:/projects/atlas?tab=activity",
          target: "route:/projects/:id",
        }),
        expect.objectContaining({
          kind: "Preloads",
          source: "route-plan:0:/projects/atlas?tab=activity",
          target: `resource:${ref.key}`,
        }),
        expect.objectContaining({
          kind: "Hydrates",
          source: "route-plan:0:/projects/atlas?tab=activity",
          target: `resource:${ref.key}`,
        }),
        expect.objectContaining({
          kind: "Targets",
          source: "invalidation:0",
          target: "resource-tag:Golden.Projects",
        }),
        expect.objectContaining({
          kind: "Targets",
          source: "invalidation:0",
          target: "resource-tag:Golden.Project:atlas",
        }),
        expect.objectContaining({
          kind: "Invalidates",
          source: "invalidation:0",
          target: `resource:${ref.key}`,
        }),
        expect.objectContaining({
          kind: "Causes",
          source: "resource-tag:Golden.Project:atlas",
          target: `resource:${ref.key}`,
        }),
        expect.objectContaining({
          kind: "Emits",
          source: "action:Golden.Project.rename",
          target: "invalidation:0",
        }),
        expect.objectContaining({
          kind: "Observes",
          source: "runtime-event:5:ActionState",
          target: "action:Golden.Project.rename",
        }),
      ]),
    );
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});
