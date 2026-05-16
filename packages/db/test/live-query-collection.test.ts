import { EffectInputCallbackError, makeRuntime, runWithRuntime } from "@effect-ui/core";
import { Collection, CollectionSnapshotCodecError, Query, QueryEvaluationError, ReadonlyCollectionMutation, eq } from "@effect-ui/db";
import { Effect, Exit, Option, PubSub } from "effect";
import { describe, expect, it, vi } from "vitest";
import { markStoreExplicitCollectionSnapshotDefinition } from "../src/collection-definition-snapshot.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked";
  readonly progress: number;
}

interface ProjectCard {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
}

interface NestedProjectCard {
  readonly id: string;
  readonly meta: {
    readonly labels: Array<string>;
  };
}

describe("Collection.liveQuery", () => {
  it("reports synchronous query callback throws as typed evaluation errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.query-evaluation-errors",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
          ]
        });
        const Cards = Collection.define<ProjectCard>({
          name: "ProjectCards.query-evaluation-errors",
          getKey: (card) => card.id,
          initialData: [
            { id: "atlas", name: "Atlas", progress: 72 }
          ]
        });
        const throwError = (message: string): never => {
          throw new Error(message);
        };
        const cases = [
          {
            operation: "filter",
            effect: Query.onceEffect((query) =>
              query
                .from({ project: Projects })
                .where(() => throwError("filter failed"))
            )
          },
          {
            operation: "projection",
            effect: Query.onceEffect((query) =>
              query
                .from({ project: Projects })
                .select(() => throwError("projection failed"))
            )
          },
          {
            operation: "order",
            effect: Query.onceEffect((query) =>
              query
                .from({ project: Projects })
                .orderBy(() => throwError("order failed"))
            )
          },
          {
            operation: "join",
            effect: Query.onceEffect((query) =>
              query
                .from({ project: Projects })
                .join("card", Cards, () => throwError("join failed"), (card) => card.id)
            )
          },
          {
            operation: "aggregate",
            effect: Query.onceEffect((query) =>
              query
                .from({ project: Projects })
                .groupBy(
                  ({ project }) => ({ status: project.status }),
                  { total: Query.sum(() => throwError("aggregate failed")) }
                )
            )
          }
        ] as const;

        for (const entry of cases) {
          const failure = yield* Effect.flip(entry.effect);
          yield* Effect.sync(() => {
            expect(failure).toBeInstanceOf(QueryEvaluationError);
            expect(failure).toMatchObject({ operation: entry.operation });
          });
        }
      })
    ));

  it("represents live query evaluation failures in state without throwing from data", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-evaluation-state",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(() => {
          throw new Error("filter failed");
        })
        .select(({ project }) => project.name)
    );

    expect(() => live.data.get()).not.toThrow();
    expect(live.data.get()).toEqual([]);
    expect(live.state.get()).toMatchObject({
      _tag: "Failure",
      waiting: false,
      error: { _tag: "QueryEvaluationError", operation: "filter" },
      data: []
    });
  });

  it("keeps last successful live query data across later evaluation failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-evaluation-last-good",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const live = Query.live((query) =>
          query
            .from({ project: Projects })
            .select(({ project }) => {
              if (project.name === "Broken") {
                throw new Error("projection failed");
              }
              return project.name;
            })
        );

        expect(live.data.get()).toEqual(["Atlas"]);

        yield* Projects.writeUpdateEffect("atlas", { name: "Broken" });

        expect(() => live.data.get()).not.toThrow();
        expect(live.data.get()).toEqual(["Atlas"]);
        expect(live.state.get()).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: { _tag: "QueryEvaluationError", operation: "projection" },
          data: ["Atlas"]
        });

        yield* Projects.writeUpdateEffect("atlas", { name: "Atlas Reloaded" });

        expect(live.state.get()).toMatchObject({
          _tag: "Success",
          waiting: false,
          data: ["Atlas Reloaded"]
        });
      })
    ));

  it("keeps reusable live query evaluation state local to each Collection Store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-store-local",
          getKey: (project) => project.id
        });
        const live = Query.live((query) =>
          query
            .from({ project: Projects })
            .select(({ project }) => project.name)
        );

        try {
          yield* firstRuntime.provide(Projects.writeInsertEffect({
            id: "atlas",
            name: "Atlas",
            status: "active",
            progress: 72
          }));
          yield* secondRuntime.provide(Projects.writeInsertEffect({
            id: "lumen",
            name: "Lumen",
            status: "blocked",
            progress: 34
          }));

          expect(runWithRuntime(firstRuntime, () => live.data.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.data.get())).toEqual(["Lumen"]);
          expect(runWithRuntime(firstRuntime, () => live.state.get())).toMatchObject({
            _tag: "Pending",
            data: ["Atlas"]
          });
          expect(runWithRuntime(secondRuntime, () => live.state.get())).toMatchObject({
            _tag: "Pending",
            data: ["Lumen"]
          });
        } finally {
          yield* firstRuntime.disposeEffect;
          yield* secondRuntime.disposeEffect;
        }
      })
    ));

  it("keeps live query subscriptions local to the subscribed Collection Store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-store-local-subscription",
          getKey: (project) => project.id
        });
        const live = Query.live((query) =>
          query
            .from({ project: Projects })
            .select(({ project }) => project.name)
        );
        let unsubscribe = (): void => {};

        try {
          yield* firstRuntime.provide(Projects.writeInsertEffect({
            id: "atlas",
            name: "Atlas",
            status: "active",
            progress: 72
          }));
          yield* secondRuntime.provide(Projects.writeInsertEffect({
            id: "lumen",
            name: "Lumen",
            status: "blocked",
            progress: 34
          }));

          unsubscribe = runWithRuntime(firstRuntime, () => live.data.subscribe(() => {}));

          expect(runWithRuntime(firstRuntime, () => live.data.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.data.get())).toEqual(["Lumen"]);

          yield* secondRuntime.provide(Projects.writeUpdateEffect("lumen", { name: "Lumen Prime" }));

          expect(runWithRuntime(firstRuntime, () => live.data.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.data.get())).toEqual(["Lumen Prime"]);
        } finally {
          unsubscribe();
          yield* firstRuntime.disposeEffect;
          yield* secondRuntime.disposeEffect;
        }
      })
    ));

  it("keeps reusable live query collection state local to each Collection Store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection-store-local",
          getKey: (project) => project.id
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection-store-local",
          getKey: (card) => card.id,
          indexes: {
            id: (card) => card.id
          },
          query: (query) =>
            query
              .from({ project: Projects })
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });
        let firstNotifications = 0;
        let unsubscribe = (): void => {};

        try {
          yield* firstRuntime.provide(Projects.writeInsertEffect({
            id: "atlas",
            name: "Atlas",
            status: "active",
            progress: 72
          }));
          yield* secondRuntime.provide(Projects.writeInsertEffect({
            id: "lumen",
            name: "Lumen",
            status: "blocked",
            progress: 34
          }));

          const firstVersion = runWithRuntime(firstRuntime, () => ProjectCards.version().get());
          const secondVersion = runWithRuntime(secondRuntime, () => ProjectCards.version().get());
          unsubscribe = runWithRuntime(firstRuntime, () =>
            ProjectCards.version().subscribe(() => {
              firstNotifications++;
            })
          );

          expect(runWithRuntime(firstRuntime, () => ProjectCards.rows().map((card) => card.name))).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => ProjectCards.rows().map((card) => card.name))).toEqual(["Lumen"]);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.get("atlas")?.name)).toBe("Atlas");
          expect(runWithRuntime(firstRuntime, () => ProjectCards.index("id", "atlas").map((card) => card.name))).toEqual(["Atlas"]);

          yield* secondRuntime.provide(Projects.writeUpdateEffect("lumen", { name: "Lumen Prime" }));

          expect(firstNotifications).toBe(0);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.version().get())).toBe(firstVersion);
          expect(runWithRuntime(secondRuntime, () => ProjectCards.version().get())).toBeGreaterThan(secondVersion);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.rows().map((card) => card.name))).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => ProjectCards.rows().map((card) => card.name))).toEqual(["Lumen Prime"]);

          yield* firstRuntime.provide(Projects.writeUpdateEffect("atlas", { name: "Atlas Prime" }));

          expect(firstNotifications).toBe(1);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.version().get())).toBeGreaterThan(firstVersion);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.rows().map((card) => card.name))).toEqual(["Atlas Prime"]);
        } finally {
          unsubscribe();
          yield* firstRuntime.disposeEffect;
          yield* secondRuntime.disposeEffect;
        }
      })
    ));

  it("folds source collection failures into live query state with current data", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let loads = 0;
        const Projects = Collection.define<Project, string, string>({
          name: "Projects.live-query-source-failure",
          getKey: (project) => project.id,
          load: () =>
            Effect.gen(function* () {
              loads++;
              if (loads > 1) {
                return yield* Effect.fail("offline");
              }
              return [
                { id: "atlas", name: "Atlas", status: "active", progress: 72 }
              ];
            })
        });
        const live = Query.live((query) =>
          query
            .from({ project: Projects })
            .select(({ project }) => project.name)
        );

        yield* live.preloadEffect();

        expect(live.state.get()).toMatchObject({
          _tag: "Success",
          waiting: false,
          data: ["Atlas"]
        });

        const failure = yield* Effect.flip(live.refetchEffect());

        expect(failure).toBe("offline");
        expect(live.state.get()).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: "offline",
          data: ["Atlas"]
        });
      })
    ));

  it("exposes live query results as a read-only collection", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.live-query-collection",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => eq(project.status, "active"))
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress
          }))
          .orderBy(({ project }) => project.name)
    });

    expect(ActiveProjectCards.rows()).toMatchObject([
      {
        id: "atlas",
        name: "Atlas",
        progress: 72,
        $key: "atlas",
        $collection: "ProjectCards.live-query-collection",
        $synced: true,
        $origin: "remote"
      }
    ]);

    return Effect.runPromise(
      Projects.writeUpdateEffect("lumen", { status: "active", progress: 48 }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas", "lumen"]);
            expect(ActiveProjectCards.get("lumen")).toMatchObject({
              name: "Lumen",
              progress: 48,
              $key: "lumen"
            });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("detaches live query collection rows from cached materialized values", () => {
    const Projects = Collection.define<NestedProjectCard>({
      name: "Projects.live-query-collection.detached-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", meta: { labels: ["remote"] } }
      ]
    });
    const ProjectCards = Collection.liveQuery<NestedProjectCard, string>({
      name: "ProjectCards.live-query-collection.detached",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => ({
            id: project.id,
            meta: project.meta
          }))
    });

    const row = ProjectCards.rows()[0] as NestedProjectCard | undefined;
    if (!row) {
      expect.fail("Expected a projected row.");
    }
    row.meta.labels.push("mutated");

    expect(ProjectCards.rows()[0]?.meta.labels).toEqual(["remote"]);
    expect(ProjectCards.snapshot().rows[0]?.value.meta.labels).toEqual(["remote"]);
  });

  it("materializes duplicate derived keys with normal collection last-write semantics", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.duplicate-key-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "active", progress: 34 }
      ]
    });
    const ProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.live-query-collection.duplicate-key",
      getKey: (project) => project.id,
      indexes: {
        byName: (project) => project.name
      },
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => eq(project.status, "active"))
          .select(({ project }) => ({
            id: "active",
            name: project.name,
            progress: project.progress
          }))
          .orderBy(({ project }) => project.name)
    });

    expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Lumen"]);
    expect(ProjectCards.get("active")?.name).toBe("Lumen");
    expect(ProjectCards.index("byName", "Atlas")).toEqual([]);
    expect(ProjectCards.index("byName", "Lumen").map((project) => project.$key)).toEqual(["active"]);
    expect(ProjectCards.snapshot().rows.map((row) => row.key)).toEqual(["active"]);
  });

  it("does not advance version or updatedAt for hidden duplicate-key row changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.hidden-duplicate-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "active", progress: 34 }
          ]
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.hidden-duplicate",
          getKey: (project) => project.id,
          indexes: {
            byName: (project) => project.name
          },
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => eq(project.status, "active"))
              .select(({ project }) => ({
                id: "active",
                name: project.name,
                progress: project.progress
              }))
              .orderBy(({ project }) => project.name)
        });
        const version = ProjectCards.version();
        const state = ProjectCards.state();
        const firstVersion = version.get();
        const firstState = state.get();
        if (firstState._tag !== "Ready") {
          expect.fail("Expected live query collection to be ready.");
        }

        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Lumen"]);
        expect(ProjectCards.get("active")?.progress).toBe(34);

        yield* Projects.writeUpdateEffect("atlas", { progress: 90 });

        const unchangedState = state.get();
        if (unchangedState._tag !== "Ready") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(version.get()).toBe(firstVersion);
        expect(unchangedState.updatedAt).toBe(firstState.updatedAt);
        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Lumen"]);
        expect(ProjectCards.get("active")?.progress).toBe(34);
        expect(ProjectCards.index("byName", "Lumen").map((project) => project.$key)).toEqual(["active"]);
        expect(ProjectCards.snapshot().rows.map((row) => row.value.progress)).toEqual([34]);
      })
    ));

  it("returns stable state and version signals for live query collections", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.stable-signals-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.stable-signals",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => eq(project.status, "active"))
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });
        const state = ActiveProjectCards.state();
        const version = ActiveProjectCards.version();
        const firstVersion = version.get();

        expect(ActiveProjectCards.state()).toBe(state);
        expect(ActiveProjectCards.version()).toBe(version);
        expect(state.get()).toMatchObject({ _tag: "Ready", waiting: false });

        yield* Projects.writeUpdateEffect("atlas", { progress: 80 });

        expect(version.get()).not.toBe(firstVersion);
        expect(ActiveProjectCards.rows().map((project) => project.progress)).toEqual([80]);
      })
    ));

  it("keeps Ready.updatedAt stable until live query collection output changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.stable-ready-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.stable-ready",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => eq(project.status, "active"))
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: 0
              }))
        });
        const state = ActiveProjectCards.state();
        const first = state.get();
        const second = state.get();

        expect(first).toMatchObject({ _tag: "Ready", waiting: false });
        expect(second).toMatchObject({ _tag: "Ready", waiting: false });
        if (first._tag !== "Ready" || second._tag !== "Ready") {
          expect.fail("Expected live query collection to be ready.");
        }
        expect(second.updatedAt).toBe(first.updatedAt);

        yield* Projects.writeUpdateEffect("atlas", { progress: 80 });
        const unchanged = state.get();
        if (unchanged._tag !== "Ready") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(unchanged.updatedAt).toBe(first.updatedAt);

        yield* Projects.writeUpdateEffect("atlas", { name: "Atlas Prime" });
        const changed = state.get();
        if (changed._tag !== "Ready") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(changed.updatedAt).toBeGreaterThan(first.updatedAt);
      })
    ));

  it("uses monotonic versions when materialized rows change across hash-collision-like values", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.monotonic-version-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "FB", status: "active", progress: 72 }
          ]
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.monotonic-version",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });
        const Downstream = Query.live((query) =>
          query
            .from({ card: ProjectCards })
            .select(({ card }) => card.name)
        );
        const firstVersion = ProjectCards.version().get();

        expect(Downstream.data.get()).toEqual(["FB"]);

        yield* Projects.writeUpdateEffect("atlas", { name: "Ea" });

        expect(ProjectCards.version().get()).toBeGreaterThan(firstVersion);
        expect(Downstream.data.get()).toEqual(["Ea"]);
      })
    ));

  it("dehydrates live query collections through the Collection Definition snapshot interface", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.dehydrate-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
          ]
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.dehydrate",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => eq(project.status, "active"))
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });

        const snapshot = yield* ActiveProjectCards.snapshotEffect();
        const payload = yield* Collection.dehydrateEffect([ActiveProjectCards]);

        expect(snapshot.rows.map((row) => row.key)).toEqual(["atlas"]);
        expect(payload.collections).toHaveLength(1);
        expect(payload.collections[0]?.name).toBe("ProjectCards.live-query-collection.dehydrate");
        expect(payload.collections[0]?.rows.map((row) => row.key)).toEqual(["atlas"]);
        expect(payload.collections[0]?.rows.map((row) => row.value)).toEqual(snapshot.rows.map((row) => row.value));
      })
    ));

  it("uses the provided runtime store when snapshotting, dehydrating, and persisting live query collections", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const storage = Collection.memoryStorage();
        const firstKey = "live-query-collection-runtime-local-first";
        const secondKey = "live-query-collection-runtime-local-second";
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.runtime-local-snapshot",
          getKey: (project) => project.id
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.runtime-local-snapshot",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => eq(project.status, "active"))
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });

        try {
          yield* firstRuntime.provide(Projects.writeInsertEffect([
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "first-blocked", name: "First Blocked", status: "blocked", progress: 12 }
          ]));
          yield* secondRuntime.provide(Projects.writeInsertEffect([
            { id: "lumen", name: "Lumen", status: "active", progress: 34 },
            { id: "second-blocked", name: "Second Blocked", status: "blocked", progress: 18 }
          ]));

          const firstSnapshot = yield* firstRuntime.provide(ActiveProjectCards.snapshotEffect());
          const secondSnapshot = yield* secondRuntime.provide(ActiveProjectCards.snapshotEffect());
          const firstPayload = yield* firstRuntime.provide(Collection.dehydrateEffect([ActiveProjectCards]));
          const secondPayload = yield* secondRuntime.provide(Collection.dehydrateEffect([ActiveProjectCards]));

          yield* firstRuntime.provide(ActiveProjectCards.persistEffect(storage, { key: firstKey }));
          yield* secondRuntime.provide(ActiveProjectCards.persistEffect(storage, { key: secondKey }));

          const persistedFirst = JSON.parse(storage.values.get(firstKey) ?? "{}") as Collection.Snapshot<ProjectCard, string>;
          const persistedSecond = JSON.parse(storage.values.get(secondKey) ?? "{}") as Collection.Snapshot<ProjectCard, string>;

          expect(firstSnapshot.rows.map((row) => row.key)).toEqual(["atlas"]);
          expect(secondSnapshot.rows.map((row) => row.key)).toEqual(["lumen"]);
          expect(firstPayload.collections[0]?.rows.map((row) => row.key)).toEqual(["atlas"]);
          expect(secondPayload.collections[0]?.rows.map((row) => row.key)).toEqual(["lumen"]);
          expect(persistedFirst.rows.map((row) => row.key)).toEqual(["atlas"]);
          expect(persistedSecond.rows.map((row) => row.key)).toEqual(["lumen"]);
        } finally {
          yield* firstRuntime.disposeEffect;
          yield* secondRuntime.disposeEffect;
        }
      })
    ));

  it("rejects incomplete store-explicit snapshot markers instead of using the ambient store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.incomplete-store-explicit-snapshot",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        markStoreExplicitCollectionSnapshotDefinition(Projects);

        const failure = yield* Effect.flip(Collection.dehydrateEffect([Projects]));

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          operation: "snapshot",
          path: "$"
        });
        expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStore");
        expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStoreEffect");
        expect((failure as CollectionSnapshotCodecError).reason).toContain("hydratePreflightEffect");
        expect((failure as CollectionSnapshotCodecError).reason).toContain("hydrateWithStoreEffect");
      })
    ));

  it("rejects incomplete store-explicit snapshot markers during hydrate preflight without mutating rows", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.incomplete-store-explicit-hydrate",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        markStoreExplicitCollectionSnapshotDefinition(Projects);

        const snapshot: Collection.Snapshot<Project, string> = {
          name: Projects.name,
          rows: [
            {
              key: "lumen",
              value: { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
              synced: true,
              origin: "remote"
            }
          ],
          pendingMutations: [],
          updatedAt: 1
        };
        const failure = yield* Effect.flip(Projects.hydrateEffect(snapshot));

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          operation: "hydrate",
          path: "$"
        });
        expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStore");
        expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStoreEffect");
        expect((failure as CollectionSnapshotCodecError).reason).toContain("hydratePreflightEffect");
        expect((failure as CollectionSnapshotCodecError).reason).toContain("hydrateWithStoreEffect");
        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
      })
    ));

  it("publishes CollectionPersisted when persisting live query collections", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const storage = Collection.memoryStorage();
          const key = "live-query-collection-persist-event-cache";
          const Projects = Collection.define<Project>({
            name: "Projects.live-query-collection.persist-event-source",
            getKey: (project) => project.id,
            initialData: [
              { id: "atlas", name: "Atlas", status: "active", progress: 72 },
              { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
            ]
          });
          const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
            name: "ProjectCards.live-query-collection.persist-event",
            getKey: (project) => project.id,
            query: (query) =>
              query
                .from({ project: Projects })
                .where(({ project }) => eq(project.status, "active"))
                .select(({ project }) => ({
                  id: project.id,
                  name: project.name,
                  progress: project.progress
                }))
          });
          const subscription = yield* Collection.subscribeEventsEffect();

          yield* ActiveProjectCards.persistEffect(storage, { key });

          const event = yield* PubSub.take(subscription);
          const persisted = JSON.parse(storage.values.get(key) ?? "{}") as Collection.Snapshot<ProjectCard, string>;

          expect(event).toMatchObject({
            _tag: "CollectionPersisted",
            collection: "ProjectCards.live-query-collection.persist-event",
            key,
            count: 1
          });
          expect(persisted.rows.map((row) => row.key)).toEqual(["atlas"]);
        })
      )
    ));

  it("reports live query collection persistence storage throws as EffectInput callback errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const thrown = new Error("storage unavailable");
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.persist-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.persist",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });
        const error = yield* Effect.flip(
          ActiveProjectCards.persistEffect({
            getItem: () => null,
            setItem: () => {
              throw thrown;
            }
          })
        );

        expect(error).toBeInstanceOf(EffectInputCallbackError);
        expect((error as EffectInputCallbackError).cause).toBe(thrown);
      })
    ));

  it("reports live query collection snapshot getKey throws as EffectInput callback errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const thrown = new Error("key failed");
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.snapshot-key-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.snapshot-key",
          getKey: () => {
            throw thrown;
          },
          query: (query) =>
            query
              .from({ project: Projects })
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });

        const snapshotFailure = yield* Effect.flip(ActiveProjectCards.snapshotEffect());
        const persistFailure = yield* Effect.flip(
          ActiveProjectCards.persistEffect(Collection.memoryStorage())
        );

        for (const failure of [snapshotFailure, persistFailure]) {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
        }
      })
    ));

  it("rejects non-finite derived live query collection keys before rows are visible", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.nan-key-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, number>({
          name: "ProjectCards.live-query-collection.nan-key",
          getKey: () => Number.NaN,
          query: (query) =>
            query
              .from({ project: Projects })
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });

        expect(ActiveProjectCards.rows()).toEqual([]);
        expect(ActiveProjectCards.get(Number.NaN)).toBeUndefined();
        expect(ActiveProjectCards.state().get()).toMatchObject({
          _tag: "Failure",
          error: {
            _tag: "CollectionSnapshotCodecError",
            operation: "load"
          }
        });

        const snapshotFailure = yield* Effect.flip(ActiveProjectCards.snapshotEffect());
        const persistFailure = yield* Effect.flip(
          ActiveProjectCards.persistEffect(Collection.memoryStorage())
        );

        for (const failure of [snapshotFailure, persistFailure]) {
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "snapshot"
          });
        }
      })
    ));

  it("retains the last-good live query collection projection when getKey fails after success", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.key-failure-last-good-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 }
          ]
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.key-failure-last-good",
          getKey: (project) => {
            if (project.name === "Broken") {
              throw new Error("key failed");
            }
            return project.id;
          },
          indexes: {
            byName: (project) => project.name
          },
          query: (query) =>
            query
              .from({ project: Projects })
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });
        const version = ProjectCards.version();
        const state = ProjectCards.state();
        const firstVersion = version.get();
        const firstState = state.get();
        if (firstState._tag !== "Ready") {
          expect.fail("Expected live query collection to start ready.");
        }

        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Atlas"]);
        expect(ProjectCards.get("atlas")?.name).toBe("Atlas");
        expect(ProjectCards.index("byName", "Atlas").map((project) => project.$key)).toEqual(["atlas"]);

        yield* Projects.writeUpdateEffect("atlas", { name: "Broken" });

        expect(state.get()).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: {
            operation: "Collection.getKey(ProjectCards.live-query-collection.key-failure-last-good)"
          }
        });
        expect(version.get()).toBe(firstVersion);
        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Atlas"]);
        expect(ProjectCards.get("atlas")?.name).toBe("Atlas");
        expect(ProjectCards.index("byName", "Atlas").map((project) => project.$key)).toEqual(["atlas"]);

        yield* Projects.writeUpdateEffect("atlas", { name: "Atlas" });

        const recovered = state.get();
        if (recovered._tag !== "Ready") {
          expect.fail("Expected live query collection to recover.");
        }
        expect(version.get()).toBe(firstVersion);
        expect(recovered.updatedAt).toBe(firstState.updatedAt);
        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Atlas"]);
      })
    ));

  it("fails live query collection hydrate and restore with typed snapshot codec errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.readonly-hydrate-source",
          getKey: (project) => project.id
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
          name: "ProjectCards.live-query-collection.readonly-hydrate",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress
              }))
        });
        const snapshot: Collection.Snapshot<ProjectCard, string> = {
          name: "ProjectCards.live-query-collection.readonly-hydrate",
          rows: [],
          pendingMutations: [],
          updatedAt: 1
        };

        const hydrateFailure = yield* Effect.flip(ActiveProjectCards.hydrateEffect(snapshot));
        const restoreFailure = yield* Effect.flip(
          ActiveProjectCards.restoreEffect(Collection.memoryStorage(), { key: "readonly-hydrate-cache" })
        );

        expect(hydrateFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(hydrateFailure).toMatchObject({
          operation: "hydrate",
          path: "$"
        });
        expect(restoreFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(restoreFailure).toMatchObject({
          operation: "restore",
          path: "$"
        });
      })
    ));

  it("supports indexes on derived live query collections", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.index-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    let indexEvaluations = 0;
    const ProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.live-query-collection.indexed",
      getKey: (project) => project.id,
      indexes: {
        progressBand: (project) => {
          indexEvaluations++;
          return project.progress >= 50 ? "high" : "low";
        }
      },
      query: (query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress
          }))
          .orderBy(({ project }) => project.name)
    });

    expect(ProjectCards.index("progressBand", "high").map((project) => project.id)).toEqual(["atlas"]);
    expect(indexEvaluations).toBe(2);
    expect(ProjectCards.firstByIndex("progressBand", "low")).toMatchObject({
      id: "lumen",
      $collection: "ProjectCards.live-query-collection.indexed"
    });
    expect(indexEvaluations).toBe(2);

    return Effect.runPromise(
      Projects.writeUpdateEffect("lumen", { progress: 58 }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            expect(ProjectCards.index("progressBand", "high").map((project) => project.id)).toEqual(["atlas", "lumen"]);
            expect(indexEvaluations).toBe(4);
            expect(ProjectCards.firstByIndex("progressBand", "high")).toMatchObject({ id: "atlas" });
            expect(indexEvaluations).toBe(4);
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("can be used as a source for another live query", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.nested-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.live-query-collection.nested",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => eq(project.status, "active"))
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress
          }))
    });
    const Names = Query.live((query) =>
      query
        .from({ card: ActiveProjectCards })
        .select(({ card }) => card.name)
        .orderBy(({ card }) => card.name)
    );

    expect(Names.evaluate()).toEqual(["Atlas"]);

    return Effect.runPromise(
      Projects.writeUpdateEffect("lumen", { status: "active" }).pipe(
        Effect.tap(() => Effect.sync(() => expect(Names.evaluate()).toEqual(["Atlas", "Lumen"]))),
        Effect.asVoid
      )
    );
  });

  it("preloads source collections before materializing rows", () => {
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ])
    );
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.preload-source",
      getKey: (project) => project.id,
      load
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.live-query-collection.preload",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress
          }))
    });

    return Effect.runPromise(
      ActiveProjectCards.preloadEffect().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            expect(load).toHaveBeenCalledTimes(1);
            expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas"]);
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("rejects namespace change application because derived collections are read-only", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Projects = Collection.define<Project>({
            name: "Projects.live-query-collection.readonly-apply-source",
            getKey: (project) => project.id,
            initialData: [
              { id: "atlas", name: "Atlas", status: "active", progress: 72 }
            ]
          });
          const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
            name: "ProjectCards.live-query-collection.readonly-apply",
            getKey: (project) => project.id,
            query: (query) =>
              query
                .from({ project: Projects })
                .select(({ project }) => ({
                  id: project.id,
                  name: project.name,
                  progress: project.progress
                }))
          });
          const subscription = yield* Collection.subscribeEventsEffect();

          const failure = yield* Effect.flip(Collection.applyChangesEffect(ActiveProjectCards, [
            {
              _tag: "Upsert",
              value: { id: "orion", name: "Orion", progress: 20 }
            },
            {
              _tag: "Delete",
              key: "atlas"
            }
          ]));
          const event = yield* PubSub.take(subscription).pipe(
            Effect.timeoutOption("20 millis")
          );

          expect(failure).toBeInstanceOf(ReadonlyCollectionMutation);
          expect(failure).toMatchObject({
            collection: "ProjectCards.live-query-collection.readonly-apply",
            operation: "applyChangesEffect"
          });
          expect(Option.isNone(event)).toBe(true);
          expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas"]);
          expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
        })
      )
    ));

  it("rejects local mutations because derived collections are read-only", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.readonly-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 }
      ]
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.live-query-collection.readonly",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress
          }))
    });

    return Effect.runPromise(
      Effect.exit(
        ActiveProjectCards.updateEffect("atlas", { progress: 90 })
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const failure = Exit.isFailure(exit)
              ? exit.cause.reasons.find((reason) => reason._tag === "Fail")
              : undefined;
            expect(failure?.error).toBeInstanceOf(ReadonlyCollectionMutation);
          })
        ),
        Effect.asVoid
      )
    );
  });
});
