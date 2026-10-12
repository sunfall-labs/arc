import { EffectInputCallbackError, makeRuntime, runWithRuntime } from "@sunfall/arc-core";
import {
  Collection,
  CollectionRowKeyChanged,
  CollectionRowNotFound,
  CollectionSnapshotCodecError,
  Query,
  QueryEvaluationError,
  ReadonlyCollectionMutation,
} from "@sunfall/arc-db";
import {
  collectCollectionsEffect,
  dehydrateCollectionsEffect,
  subscribeCollectionEventsEffect,
  validateCollectionsHydrationEffect,
} from "@sunfall/arc-db/internal";
import { Cause, Deferred, Effect, Exit, Fiber, Option, PubSub } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import {
  collectionDurableSnapshotPermitSources,
  markStoreExplicitCollectionSnapshotDefinition,
} from "../src/collection-definition-snapshot.js";

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

interface FunctionProjectCard {
  readonly id: string;
  readonly name: string;
  readonly render: () => string;
}

/** Flattens an `AsyncResult` into matchable facts: tag, waiting, value/timestamp, typed error, defect, and previous success value. */
const asyncResultFacts = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
  switch (result._tag) {
    case "Initial":
      return { _tag: result._tag, waiting: result.waiting };
    case "Success":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        value: result.value,
        timestamp: result.timestamp,
      };
    case "Failure":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        error: Option.getOrUndefined(AsyncResult.error(result)),
        defect: result.cause.reasons.find(Cause.isDieReason)?.defect,
        previous: Option.getOrUndefined(AsyncResult.value(result)),
        cause: result.cause,
      };
  }
};

describe("Collection.liveQuery", () => {
  it("reports synchronous query callback throws as typed evaluation errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.query-evaluation-errors",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
          ],
        });
        const Cards = Collection.define<ProjectCard>({
          name: "ProjectCards.query-evaluation-errors",
          getKey: (card) => card.id,
          initialData: [{ id: "atlas", name: "Atlas", progress: 72 }],
        });
        const throwError = (message: string): never => {
          throw new Error(message);
        };
        const cases: ReadonlyArray<{
          readonly operation: string;
          readonly effect: Effect.Effect<ReadonlyArray<unknown>, unknown>;
        }> = [
          {
            operation: "filter",
            effect: Query.once((query) =>
              query.from({ project: Projects }).where(() => throwError("filter failed")),
            ),
          },
          {
            operation: "projection",
            effect: Query.once((query) =>
              query.from({ project: Projects }).select(() => throwError("projection failed")),
            ),
          },
          {
            operation: "order",
            effect: Query.once((query) =>
              query.from({ project: Projects }).orderBy(() => throwError("order failed")),
            ),
          },
          {
            operation: "join",
            effect: Query.once((query) =>
              query.from({ project: Projects }).join(
                "card",
                Cards,
                () => throwError("join failed"),
                (card) => card.id,
              ),
            ),
          },
          {
            operation: "aggregate",
            effect: Query.once((query) =>
              query
                .from({ project: Projects })
                .groupBy(({ project }) => ({ status: project.status }), {
                  total: Query.sum(() => throwError("aggregate failed")),
                }),
            ),
          },
        ];

        for (const entry of cases) {
          const failure = yield* Effect.flip(entry.effect);
          yield* Effect.sync(() => {
            expect(failure).toBeInstanceOf(QueryEvaluationError);
            expect(failure).toMatchObject({ operation: entry.operation });
          });
        }
      }),
    ));

  it("represents live query evaluation failures in state without throwing from data", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-evaluation-state",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(() => {
          throw new Error("filter failed");
        })
        .select(({ project }) => project.name),
    );

    expect(() => live.rows.get()).not.toThrow();
    expect(live.rows.get()).toEqual([]);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      waiting: false,
      error: { _tag: "QueryEvaluationError", operation: "filter" },
      previous: [],
    });
  });

  it("keeps last successful live query data across later evaluation failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-evaluation-last-good",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => {
            if (project.name === "Broken") {
              throw new Error("projection failed");
            }
            return project.name;
          }),
        );

        expect(live.rows.get()).toEqual(["Atlas"]);

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Broken" } },
        ]);

        expect(() => live.rows.get()).not.toThrow();
        expect(live.rows.get()).toEqual(["Atlas"]);
        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: { _tag: "QueryEvaluationError", operation: "projection" },
          previous: ["Atlas"],
        });

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Atlas Reloaded" } },
        ]);

        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Success",
          waiting: false,
          value: ["Atlas Reloaded"],
        });
      }),
    ));

  it("keeps reusable live query evaluation state local to each Collection Store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-store-local",
          getKey: (project) => project.id,
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => project.name),
        );

        try {
          yield* firstRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  status: "active",
                  progress: 72,
                },
              },
            ]),
          );
          yield* secondRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "lumen",
                  name: "Lumen",
                  status: "blocked",
                  progress: 34,
                },
              },
            ]),
          );

          expect(runWithRuntime(firstRuntime, () => live.rows.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.rows.get())).toEqual(["Lumen"]);
          expect(
            asyncResultFacts(runWithRuntime(firstRuntime, () => live.state.get())),
          ).toMatchObject({
            _tag: "Initial",
            waiting: false,
          });
          expect(
            asyncResultFacts(runWithRuntime(secondRuntime, () => live.state.get())),
          ).toMatchObject({
            _tag: "Initial",
            waiting: false,
          });
        } finally {
          yield* firstRuntime.dispose;
          yield* secondRuntime.dispose;
        }
      }),
    ));

  it("keeps live query subscriptions local to the subscribed Collection Store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-store-local-subscription",
          getKey: (project) => project.id,
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => project.name),
        );
        let unsubscribe = (): void => {};

        try {
          yield* firstRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  status: "active",
                  progress: 72,
                },
              },
            ]),
          );
          yield* secondRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "lumen",
                  name: "Lumen",
                  status: "blocked",
                  progress: 34,
                },
              },
            ]),
          );

          unsubscribe = runWithRuntime(firstRuntime, () => live.rows.subscribe(() => {}));

          expect(runWithRuntime(firstRuntime, () => live.rows.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.rows.get())).toEqual(["Lumen"]);

          yield* secondRuntime.provide(
            Projects.applyChanges([
              { _tag: "Update", key: "lumen", changes: { name: "Lumen Prime" } },
            ]),
          );

          expect(runWithRuntime(firstRuntime, () => live.rows.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.rows.get())).toEqual(["Lumen Prime"]);
        } finally {
          unsubscribe();
          yield* firstRuntime.dispose;
          yield* secondRuntime.dispose;
        }
      }),
    ));

  it("keeps reusable live query collection state local to each Collection Store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection-store-local",
          getKey: (project) => project.id,
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection-store-local",
          getKey: (card) => card.id,
          indexes: {
            id: (card) => card.id,
          },
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              progress: project.progress,
            })),
        });
        let firstNotifications = 0;
        let unsubscribe = (): void => {};

        try {
          yield* firstRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "atlas",
                  name: "Atlas",
                  status: "active",
                  progress: 72,
                },
              },
            ]),
          );
          yield* secondRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: {
                  id: "lumen",
                  name: "Lumen",
                  status: "blocked",
                  progress: 34,
                },
              },
            ]),
          );

          const firstVersion = runWithRuntime(firstRuntime, () => ProjectCards.version().get());
          const secondVersion = runWithRuntime(secondRuntime, () => ProjectCards.version().get());
          unsubscribe = runWithRuntime(firstRuntime, () =>
            ProjectCards.version().subscribe(() => {
              firstNotifications++;
            }),
          );

          expect(
            runWithRuntime(firstRuntime, () => ProjectCards.rows().map((card) => card.name)),
          ).toEqual(["Atlas"]);
          expect(
            runWithRuntime(secondRuntime, () => ProjectCards.rows().map((card) => card.name)),
          ).toEqual(["Lumen"]);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.get("atlas")?.name)).toBe("Atlas");
          expect(
            runWithRuntime(firstRuntime, () =>
              ProjectCards.index("id", "atlas").map((card) => card.name),
            ),
          ).toEqual(["Atlas"]);

          yield* secondRuntime.provide(
            Projects.applyChanges([
              { _tag: "Update", key: "lumen", changes: { name: "Lumen Prime" } },
            ]),
          );

          expect(firstNotifications).toBe(0);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.version().get())).toBe(
            firstVersion,
          );
          expect(runWithRuntime(secondRuntime, () => ProjectCards.version().get())).toBeGreaterThan(
            secondVersion,
          );
          expect(
            runWithRuntime(firstRuntime, () => ProjectCards.rows().map((card) => card.name)),
          ).toEqual(["Atlas"]);
          expect(
            runWithRuntime(secondRuntime, () => ProjectCards.rows().map((card) => card.name)),
          ).toEqual(["Lumen Prime"]);

          yield* firstRuntime.provide(
            Projects.applyChanges([
              { _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } },
            ]),
          );

          expect(firstNotifications).toBe(1);
          expect(runWithRuntime(firstRuntime, () => ProjectCards.version().get())).toBeGreaterThan(
            firstVersion,
          );
          expect(
            runWithRuntime(firstRuntime, () => ProjectCards.rows().map((card) => card.name)),
          ).toEqual(["Atlas Prime"]);
        } finally {
          unsubscribe();
          yield* firstRuntime.dispose;
          yield* secondRuntime.dispose;
        }
      }),
    ));

  it("folds source collection failures into live query state with current data", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let loads = 0;
        const Projects = Collection.define<Project, string, string>({
          name: "Projects.live-query-source-failure",
          getKey: (project) => project.id,
          sync: {
            load: () =>
              Effect.gen(function* () {
                loads++;
                if (loads > 1) {
                  return yield* Effect.fail("offline");
                }
                return [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }];
              }),
          },
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => project.name),
        );

        yield* live.preload();

        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Success",
          waiting: false,
          value: ["Atlas"],
        });

        const failure = yield* Effect.flip(live.refresh());

        expect(failure).toBe("offline");
        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: "offline",
          previous: ["Atlas"],
        });
      }),
    ));

  it("rejects nested Promise-shaped live query collection projections", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.nested-promise-projection",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const promised = <A>(value: A): A => Effect.runPromise(Effect.succeed(value)) as never;
    const ProjectCards = Collection.liveQuery<
      {
        readonly id: string;
        readonly nested: { readonly value: string };
      },
      string,
      never
    >({
      name: "ProjectCards.live-query-collection.nested-promise-projection",
      getKey: (card) => card.id,
      query: (query) =>
        query.from({ project: Projects }).select((({ project }: { readonly project: Project }) => ({
          id: project.id,
          nested: { value: promised(project.name) },
        })) as never),
    });

    expect(ProjectCards.rows()).toEqual([]);
    expect(asyncResultFacts(ProjectCards.result().get())).toMatchObject({
      _tag: "Failure",
      waiting: false,
      error: {
        _tag: "QueryEvaluationError",
        operation: "projection",
      },
    });
  });

  it("rejects nested Effect-shaped live query collection projections", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.nested-effect-projection",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const ProjectCards = Collection.liveQuery<
      {
        readonly id: string;
        readonly nested: { readonly value: string };
      },
      string,
      never
    >({
      name: "ProjectCards.live-query-collection.nested-effect-projection",
      getKey: (card) => card.id,
      query: (query) =>
        query.from({ project: Projects }).select((({ project }: { readonly project: Project }) => ({
          id: project.id,
          nested: { value: Effect.succeed(project.name) },
        })) as never),
    });

    expect(ProjectCards.rows()).toEqual([]);
    expect(asyncResultFacts(ProjectCards.result().get())).toMatchObject({
      _tag: "Failure",
      waiting: false,
      error: {
        _tag: "QueryEvaluationError",
        operation: "projection",
        cause: { _tag: "QueryCallbackEffectRejected" },
      },
    });
  });

  it("exposes live query results as a read-only collection", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
      name: "ProjectCards.live-query-collection",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.status === "active")
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress,
          }))
          .orderBy(({ project }) => project.name),
    });

    expect(ActiveProjectCards.rows()).toMatchObject([
      {
        id: "atlas",
        name: "Atlas",
        progress: 72,
        $key: "atlas",
        $collection: "ProjectCards.live-query-collection",
        $synced: true,
        $origin: "remote",
      },
    ]);

    return Effect.runPromise(
      Projects.applyChanges([
        { _tag: "Update", key: "lumen", changes: { status: "active", progress: 48 } },
      ]).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual([
              "atlas",
              "lumen",
            ]);
            expect(ActiveProjectCards.get("lumen")).toMatchObject({
              name: "Lumen",
              progress: 48,
              $key: "lumen",
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("detaches live query collection rows from cached materialized values", () => {
    const Projects = Collection.define<NestedProjectCard>({
      name: "Projects.live-query-collection.detached-source",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", meta: { labels: ["remote"] } }],
    });
    const ProjectCards = Collection.liveQuery<NestedProjectCard, string, never>({
      name: "ProjectCards.live-query-collection.detached",
      getKey: (project) => project.id,
      query: (query) =>
        query.from({ project: Projects }).select(({ project }) => ({
          id: project.id,
          meta: project.meta,
        })),
    });

    const row = ProjectCards.rows()[0] as NestedProjectCard | undefined;
    if (!row) {
      expect.fail("Expected a projected row.");
    }
    row.meta.labels.push("mutated");

    expect(ProjectCards.rows()[0]?.meta.labels).toEqual(["remote"]);
    expect(Effect.runSync(ProjectCards.snapshot()).rows[0]?.value.meta.labels).toEqual(["remote"]);
  });

  it("materializes duplicate derived keys with normal collection last-write semantics", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.duplicate-key-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "active", progress: 34 },
      ],
    });
    const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
      name: "ProjectCards.live-query-collection.duplicate-key",
      getKey: (project) => project.id,
      indexes: {
        byName: (project) => project.name,
      },
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.status === "active")
          .select(({ project }) => ({
            id: "active",
            name: project.name,
            progress: project.progress,
          }))
          .orderBy(({ project }) => project.name),
    });

    expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Lumen"]);
    expect(ProjectCards.get("active")?.name).toBe("Lumen");
    expect(ProjectCards.index("byName", "Atlas")).toEqual([]);
    expect(ProjectCards.index("byName", "Lumen").map((project) => project.$key)).toEqual([
      "active",
    ]);
    expect(Effect.runSync(ProjectCards.snapshot()).rows.map((row) => row.key)).toEqual(["active"]);
  });

  it("does not advance version or updatedAt for hidden duplicate-key row changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.hidden-duplicate-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "active", progress: 34 },
          ],
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.hidden-duplicate",
          getKey: (project) => project.id,
          indexes: {
            byName: (project) => project.name,
          },
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: "active",
                name: project.name,
                progress: project.progress,
              }))
              .orderBy(({ project }) => project.name),
        });
        const version = ProjectCards.version();
        const state = ProjectCards.result();
        const firstVersion = version.get();
        const firstState = state.get();
        if (firstState._tag !== "Success") {
          expect.fail("Expected live query collection to be ready.");
        }

        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Lumen"]);
        expect(ProjectCards.get("active")?.progress).toBe(34);

        yield* Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: { progress: 90 } }]);

        const unchangedState = state.get();
        if (unchangedState._tag !== "Success") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(version.get()).toBe(firstVersion);
        expect(unchangedState.timestamp).toBe(firstState.timestamp);
        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Lumen"]);
        expect(ProjectCards.get("active")?.progress).toBe(34);
        expect(ProjectCards.index("byName", "Lumen").map((project) => project.$key)).toEqual([
          "active",
        ]);
        expect(
          Effect.runSync(ProjectCards.snapshot()).rows.map((row) => row.value.progress),
        ).toEqual([34]);
      }),
    ));

  it("returns stable state and version signals for live query collections", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.stable-signals-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.stable-signals",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
        });
        const state = ActiveProjectCards.result();
        const version = ActiveProjectCards.version();
        const firstVersion = version.get();

        expect(ActiveProjectCards.result()).toBe(state);
        expect(ActiveProjectCards.version()).toBe(version);
        expect(asyncResultFacts(state.get())).toMatchObject({ _tag: "Success", waiting: false });

        yield* Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: { progress: 80 } }]);

        expect(version.get()).not.toBe(firstVersion);
        expect(ActiveProjectCards.rows().map((project) => project.progress)).toEqual([80]);
      }),
    ));

  it("keeps Ready.updatedAt stable until live query collection output changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.stable-ready-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.stable-ready",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: 0,
              })),
        });
        const state = ActiveProjectCards.result();
        const first = state.get();
        const second = state.get();

        expect(asyncResultFacts(first)).toMatchObject({ _tag: "Success", waiting: false });
        expect(asyncResultFacts(second)).toMatchObject({ _tag: "Success", waiting: false });
        if (first._tag !== "Success" || second._tag !== "Success") {
          expect.fail("Expected live query collection to be ready.");
        }
        expect(second.timestamp).toBe(first.timestamp);

        yield* Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: { progress: 80 } }]);
        const unchanged = state.get();
        if (unchanged._tag !== "Success") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(unchanged.timestamp).toBe(first.timestamp);

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } },
        ]);
        const changed = state.get();
        if (changed._tag !== "Success") {
          expect.fail("Expected live query collection to remain ready.");
        }
        expect(changed.timestamp).toBeGreaterThan(first.timestamp);
      }),
    ));

  it("uses monotonic versions when materialized rows change across hash-collision-like values", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.monotonic-version-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "FB", status: "active", progress: 72 }],
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.monotonic-version",
          getKey: (project) => project.id,
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              progress: project.progress,
            })),
        });
        const Downstream = Query.live((query) =>
          query.from({ card: ProjectCards }).select(({ card }) => card.name),
        );
        const firstVersion = ProjectCards.version().get();

        expect(Downstream.rows.get()).toEqual(["FB"]);

        yield* Projects.applyChanges([{ _tag: "Update", key: "atlas", changes: { name: "Ea" } }]);

        expect(ProjectCards.version().get()).toBeGreaterThan(firstVersion);
        expect(Downstream.rows.get()).toEqual(["Ea"]);
      }),
    ));

  it("dehydrates live query collections through the Collection Definition snapshot interface", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.dehydrate-source",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
          ],
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.dehydrate",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
        });

        const snapshot = yield* ActiveProjectCards.snapshot();
        const payload = yield* dehydrateCollectionsEffect([ActiveProjectCards]);

        expect(snapshot.rows.map((row) => row.key)).toEqual(["atlas"]);
        expect(payload.collections).toHaveLength(1);
        expect(payload.collections[0]?.name).toBe("ProjectCards.live-query-collection.dehydrate");
        expect(payload.collections[0]?.rows.map((row) => row.key)).toEqual(["atlas"]);
        expect(payload.collections[0]?.rows.map((row) => row.value)).toEqual(
          snapshot.rows.map((row) => row.value),
        );
      }),
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
          getKey: (project) => project.id,
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.runtime-local-snapshot",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
        });

        try {
          yield* firstRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: { id: "atlas", name: "Atlas", status: "active", progress: 72 },
              },
              {
                _tag: "Upsert",
                value: {
                  id: "first-blocked",
                  name: "First Blocked",
                  status: "blocked",
                  progress: 12,
                },
              },
            ]),
          );
          yield* secondRuntime.provide(
            Projects.applyChanges([
              {
                _tag: "Upsert",
                value: { id: "lumen", name: "Lumen", status: "active", progress: 34 },
              },
              {
                _tag: "Upsert",
                value: {
                  id: "second-blocked",
                  name: "Second Blocked",
                  status: "blocked",
                  progress: 18,
                },
              },
            ]),
          );

          const firstSnapshot = yield* firstRuntime.provide(ActiveProjectCards.snapshot());
          const secondSnapshot = yield* secondRuntime.provide(ActiveProjectCards.snapshot());
          const firstPayload = yield* firstRuntime.provide(
            dehydrateCollectionsEffect([ActiveProjectCards]),
          );
          const secondPayload = yield* secondRuntime.provide(
            dehydrateCollectionsEffect([ActiveProjectCards]),
          );

          yield* firstRuntime.provide(ActiveProjectCards.persist(storage, { key: firstKey }));
          yield* secondRuntime.provide(ActiveProjectCards.persist(storage, { key: secondKey }));

          const persistedFirst = JSON.parse(
            storage.values.get(firstKey) ?? "{}",
          ) as Collection.Snapshot<ProjectCard, string>;
          const persistedSecond = JSON.parse(
            storage.values.get(secondKey) ?? "{}",
          ) as Collection.Snapshot<ProjectCard, string>;

          expect(firstSnapshot.rows.map((row) => row.key)).toEqual(["atlas"]);
          expect(secondSnapshot.rows.map((row) => row.key)).toEqual(["lumen"]);
          expect(firstPayload.collections[0]?.rows.map((row) => row.key)).toEqual(["atlas"]);
          expect(secondPayload.collections[0]?.rows.map((row) => row.key)).toEqual(["lumen"]);
          expect(persistedFirst.rows.map((row) => row.key)).toEqual(["atlas"]);
          expect(persistedSecond.rows.map((row) => row.key)).toEqual(["lumen"]);
        } finally {
          yield* firstRuntime.dispose;
          yield* secondRuntime.dispose;
        }
      }),
    ));

  it("serializes live query collection snapshots behind source durable writes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = makeRuntime();
        const writeStarted = yield* Deferred.make<void>();
        const releaseWrite = yield* Deferred.make<void>();
        const storage = Collection.memoryStorage();
        const failingStorage: Collection.PersistenceStorage<"persist-failed"> = {
          getItem: () => storage.getItem("source-cache"),
          setItem: (key, value) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(releaseWrite);
              yield* Effect.sync(() => {
                storage.setItem(key, value);
              });
              return yield* Effect.fail("persist-failed" as const);
            }),
        };
        const Projects = Collection.define<Project, string, "persist-failed">({
          name: "Projects.live-query-snapshot-source-durable-write",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
          persistence: {
            storage: failingStorage,
            key: "source-cache",
            persistOnWrite: true,
          },
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, "persist-failed">({
          name: "ProjectCards.live-query-snapshot-source-durable-write",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
        });
        let write:
          | Fiber.Fiber<
              Exit.Exit<void, CollectionRowKeyChanged | CollectionRowNotFound | "persist-failed">,
              never
            >
          | undefined;
        let snapshot:
          | Fiber.Fiber<Exit.Exit<Collection.Snapshot<ProjectCard, string>, unknown>, never>
          | undefined;

        try {
          write = runtime.runFork(
            Projects.applyChanges([
              { _tag: "Update", key: "atlas", changes: { progress: 90 } },
            ]).pipe(Effect.exit),
          );
          yield* Deferred.await(writeStarted);

          snapshot = runtime.runFork(ActiveProjectCards.snapshot().pipe(Effect.exit));
          const earlySnapshot = yield* Fiber.await(snapshot).pipe(
            Effect.timeoutOption("20 millis"),
          );
          expect(Option.isNone(earlySnapshot)).toBe(true);

          yield* Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore);
          const writeExit = yield* Fiber.join(write);
          const snapshotExit = yield* Fiber.join(snapshot);

          expect(Exit.isFailure(writeExit)).toBe(true);
          if (Exit.isFailure(snapshotExit)) {
            expect.fail("Expected live query snapshot to succeed after source write rollback.");
          }
          expect(snapshotExit.value.rows.map((row) => row.value.progress)).toEqual([72]);
        } finally {
          yield* Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore);
          if (write !== undefined) {
            yield* Fiber.await(write).pipe(Effect.timeoutOption("100 millis"), Effect.ignore);
          }
          if (snapshot !== undefined) {
            yield* Fiber.await(snapshot).pipe(Effect.timeoutOption("100 millis"), Effect.ignore);
          }
          yield* runtime.dispose;
        }
      }),
    ));

  it("serializes nested live query collection snapshots behind transitive source durable writes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = makeRuntime();
        const writeStarted = yield* Deferred.make<void>();
        const releaseWrite = yield* Deferred.make<void>();
        const storage = Collection.memoryStorage();
        const failingStorage: Collection.PersistenceStorage<"persist-failed"> = {
          getItem: () => storage.getItem("source-cache"),
          setItem: (key, value) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(writeStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(releaseWrite);
              yield* Effect.sync(() => {
                storage.setItem(key, value);
              });
              return yield* Effect.fail("persist-failed" as const);
            }),
        };
        const Projects = Collection.define<Project, string, "persist-failed">({
          name: "Projects.live-query-nested-snapshot-source-durable-write",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
          persistence: {
            storage: failingStorage,
            key: "source-cache",
            persistOnWrite: true,
          },
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, "persist-failed">({
          name: "ProjectCards.live-query-nested-snapshot-source-durable-write",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
        });
        const ProjectSummaries = Collection.liveQuery<
          ProjectCard,
          string,
          "persist-failed" | QueryEvaluationError | ReadonlyCollectionMutation
        >({
          name: "ProjectSummaries.live-query-nested-snapshot-source-durable-write",
          getKey: (project) => project.id,
          query: (query) =>
            query.from({ card: ActiveProjectCards }).select(({ card }) => ({
              id: card.id,
              name: card.name,
              progress: card.progress,
            })),
        });
        let write:
          | Fiber.Fiber<
              Exit.Exit<void, CollectionRowKeyChanged | CollectionRowNotFound | "persist-failed">,
              never
            >
          | undefined;
        let snapshot:
          | Fiber.Fiber<Exit.Exit<Collection.Snapshot<ProjectCard, string>, unknown>, never>
          | undefined;

        try {
          write = runtime.runFork(
            Projects.applyChanges([
              { _tag: "Update", key: "atlas", changes: { progress: 90 } },
            ]).pipe(Effect.exit),
          );
          yield* Deferred.await(writeStarted);

          snapshot = runtime.runFork(ProjectSummaries.snapshot().pipe(Effect.exit));
          const earlySnapshot = yield* Fiber.await(snapshot).pipe(
            Effect.timeoutOption("20 millis"),
          );
          expect(Option.isNone(earlySnapshot)).toBe(true);

          yield* Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore);
          const writeExit = yield* Fiber.join(write);
          const snapshotExit = yield* Fiber.join(snapshot);

          expect(Exit.isFailure(writeExit)).toBe(true);
          if (Exit.isFailure(snapshotExit)) {
            expect.fail(
              "Expected nested live query snapshot to succeed after source write rollback.",
            );
          }
          expect(snapshotExit.value.rows.map((row) => row.value.progress)).toEqual([72]);
        } finally {
          yield* Deferred.succeed(releaseWrite, undefined).pipe(Effect.ignore);
          if (write !== undefined) {
            yield* Fiber.await(write).pipe(Effect.timeoutOption("100 millis"), Effect.ignore);
          }
          if (snapshot !== undefined) {
            yield* Fiber.await(snapshot).pipe(Effect.timeoutOption("100 millis"), Effect.ignore);
          }
          yield* runtime.dispose;
        }
      }),
    ));

  it("plans live query durable snapshot permit sources once in deterministic order", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-durable-source-plan",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const Tasks = Collection.define<{ readonly id: string; readonly projectId: string }>({
      name: "Tasks.live-query-durable-source-plan",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas" }],
    });
    const ProjectTasks = Collection.liveQuery<
      { readonly id: string; readonly taskId: string },
      string,
      never
    >({
      name: "ProjectTasks.live-query-durable-source-plan",
      getKey: (row) => row.taskId,
      query: (query) =>
        query
          .from({ task: Tasks })
          .join(
            "project",
            Projects,
            ({ task }) => task.projectId,
            (project) => project.id,
          )
          .select(({ project, task }) => ({ id: project.id, taskId: task.id })),
    });

    expect(
      collectionDurableSnapshotPermitSources([ProjectTasks]).map((source) => source.name),
    ).toEqual(["Projects.live-query-durable-source-plan", "Tasks.live-query-durable-source-plan"]);
    expect(
      collectionDurableSnapshotPermitSources([Tasks, ProjectTasks, Projects]).map(
        (source) => source.name,
      ),
    ).toEqual(["Projects.live-query-durable-source-plan", "Tasks.live-query-durable-source-plan"]);
  });

  it("rejects incomplete store-explicit snapshot markers instead of using the ambient store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.incomplete-store-explicit-snapshot",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        markStoreExplicitCollectionSnapshotDefinition(Projects);

        const failure = yield* Effect.flip(dehydrateCollectionsEffect([Projects]));

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          operation: "snapshot",
          path: "$",
        });
        expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStore");
        expect((failure as CollectionSnapshotCodecError).reason).toContain(
          "snapshotWithStoreEffect",
        );
        expect((failure as CollectionSnapshotCodecError).reason).toContain(
          "hydratePreflightEffect",
        );
        expect((failure as CollectionSnapshotCodecError).reason).toContain(
          "hydrateWithStoreEffect",
        );
      }),
    ));

  it("rejects incomplete store-explicit snapshot markers during hydrate preflight without mutating rows", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.incomplete-store-explicit-hydrate",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        markStoreExplicitCollectionSnapshotDefinition(Projects);

        const snapshot: Collection.Snapshot<Project, string> = {
          name: Projects.name,
          rows: [
            {
              key: "lumen",
              value: { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
              synced: true,
              origin: "remote",
            },
          ],
          updatedAt: 1,
        };
        const failure = yield* Effect.flip(Projects.hydrate(snapshot));

        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({
          operation: "hydrate",
          path: "$",
        });
        expect((failure as CollectionSnapshotCodecError).reason).toContain("snapshotWithStore");
        expect((failure as CollectionSnapshotCodecError).reason).toContain(
          "snapshotWithStoreEffect",
        );
        expect((failure as CollectionSnapshotCodecError).reason).toContain(
          "hydratePreflightEffect",
        );
        expect((failure as CollectionSnapshotCodecError).reason).toContain(
          "hydrateWithStoreEffect",
        );
        expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
      }),
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
              { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
            ],
          });
          const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
            name: "ProjectCards.live-query-collection.persist-event",
            getKey: (project) => project.id,
            query: (query) =>
              query
                .from({ project: Projects })
                .where(({ project }) => project.status === "active")
                .select(({ project }) => ({
                  id: project.id,
                  name: project.name,
                  progress: project.progress,
                })),
          });
          const subscription = yield* subscribeCollectionEventsEffect();

          yield* ActiveProjectCards.persist(storage, { key });

          const event = yield* PubSub.take(subscription);
          const persisted = JSON.parse(storage.values.get(key) ?? "{}") as Collection.Snapshot<
            ProjectCard,
            string
          >;

          expect(event).toMatchObject({
            _tag: "CollectionPersisted",
            collection: "ProjectCards.live-query-collection.persist-event",
            key,
            count: 1,
          });
          expect(persisted.rows.map((row) => row.key)).toEqual(["atlas"]);
        }),
      ),
    ));

  it("reports live query collection persistence storage throws as EffectInput callback errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const thrown = new Error("storage unavailable");
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.persist-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.persist",
          getKey: (project) => project.id,
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              progress: project.progress,
            })),
        });
        const error = yield* Effect.flip(
          ActiveProjectCards.persist({
            getItem: () => null,
            setItem: () => {
              throw thrown;
            },
          }),
        );

        expect(error).toBeInstanceOf(EffectInputCallbackError);
        expect((error as EffectInputCallbackError).cause).toBe(thrown);
      }),
    ));

  it("reports live query collection snapshot getKey throws as EffectInput callback errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const thrown = new Error("key failed");
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.snapshot-key-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.snapshot-key",
          getKey: () => {
            throw thrown;
          },
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              progress: project.progress,
            })),
        });

        const snapshotFailure = yield* Effect.flip(ActiveProjectCards.snapshot());
        const persistFailure = yield* Effect.flip(
          ActiveProjectCards.persist(Collection.memoryStorage()),
        );

        for (const failure of [snapshotFailure, persistFailure]) {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).cause).toBe(thrown);
          expect((failure as EffectInputCallbackError).operation).toBe(
            "Collection.getKey(ProjectCards.live-query-collection.snapshot-key)",
          );
        }
      }),
    ));

  it("rejects non-finite derived live query collection keys before rows are visible", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.nan-key-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, number, never>({
          name: "ProjectCards.live-query-collection.nan-key",
          getKey: () => Number.NaN,
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              progress: project.progress,
            })),
        });

        expect(ActiveProjectCards.rows()).toEqual([]);
        expect(ActiveProjectCards.get(Number.NaN)).toBeUndefined();
        expect(asyncResultFacts(ActiveProjectCards.result().get())).toMatchObject({
          _tag: "Failure",
          error: undefined,
          defect: {
            _tag: "CollectionSnapshotCodecError",
            operation: "load",
          },
        });

        const snapshotFailure = yield* Effect.flip(ActiveProjectCards.snapshot());
        const persistFailure = yield* Effect.flip(
          ActiveProjectCards.persist(Collection.memoryStorage()),
        );

        for (const failure of [snapshotFailure, persistFailure]) {
          expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
          expect(failure).toMatchObject({
            _tag: "CollectionSnapshotCodecError",
            operation: "snapshot",
          });
        }
      }),
    ));

  it("reports unsupported live query collection projection fingerprints as EffectInput callback defects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.unsupported-projection-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ProjectCards = Collection.liveQuery<FunctionProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.unsupported-projection",
          getKey: (project) => project.id,
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              render: () => project.name,
            })),
        });

        const state = ProjectCards.result().get();
        expect(asyncResultFacts(state)).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: undefined,
          defect: {
            _tag: "EffectInputCallbackError",
            operation:
              "Collection.materialize(ProjectCards.live-query-collection.unsupported-projection).load",
            cause: {
              _tag: "StableStringifyUnsupportedValue",
              valueType: "function",
            },
          },
        });
        expect(ProjectCards.rows()).toEqual([]);

        const snapshotFailure = yield* Effect.flip(ProjectCards.snapshot());
        expect(snapshotFailure).toBeInstanceOf(EffectInputCallbackError);
        expect(snapshotFailure).toMatchObject({
          _tag: "EffectInputCallbackError",
          operation:
            "Collection.materialize(ProjectCards.live-query-collection.unsupported-projection).snapshot",
          cause: {
            _tag: "StableStringifyUnsupportedValue",
            valueType: "function",
          },
        });
      }),
    ));

  it("retains the last-good live query collection projection when getKey fails after success", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.key-failure-last-good-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.key-failure-last-good",
          getKey: (project) => {
            if (project.name === "Broken") {
              throw new Error("key failed");
            }
            return project.id;
          },
          indexes: {
            byName: (project) => project.name,
          },
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              progress: project.progress,
            })),
        });
        const version = ProjectCards.version();
        const state = ProjectCards.result();
        const firstVersion = version.get();
        const firstState = state.get();
        if (firstState._tag !== "Success") {
          expect.fail("Expected live query collection to start ready.");
        }

        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Atlas"]);
        expect(ProjectCards.get("atlas")?.name).toBe("Atlas");
        expect(ProjectCards.index("byName", "Atlas").map((project) => project.$key)).toEqual([
          "atlas",
        ]);

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Broken" } },
        ]);

        expect(asyncResultFacts(state.get())).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: undefined,
          defect: {
            operation:
              "Collection.getKey(ProjectCards.live-query-collection.key-failure-last-good)",
          },
        });
        const failed = state.get();
        expect(
          failed._tag === "Failure"
            ? Option.map(failed.previousSuccess, (s) => s.timestamp)
            : undefined,
        ).toEqual(Option.some(firstState.timestamp));
        expect(version.get()).toBe(firstVersion);
        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Atlas"]);
        expect(ProjectCards.get("atlas")?.name).toBe("Atlas");
        expect(ProjectCards.index("byName", "Atlas").map((project) => project.$key)).toEqual([
          "atlas",
        ]);

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Atlas" } },
        ]);

        const recovered = state.get();
        if (recovered._tag !== "Success") {
          expect.fail("Expected live query collection to recover.");
        }
        expect(version.get()).toBe(firstVersion);
        expect(recovered.timestamp).toBe(firstState.timestamp);
        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Atlas"]);
      }),
    ));

  it("does not snapshot or persist retained last-good live query rows while failed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const storage = Collection.memoryStorage();
        const key = "live-query-collection-failed-last-good";
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.failed-snapshot-source",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.failed-snapshot",
          getKey: (project) => project.id,
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => {
              if (project.name === "Broken") {
                throw new Error("projection failed");
              }
              return {
                id: project.id,
                name: project.name,
                progress: project.progress,
              };
            }),
        });

        yield* ProjectCards.persist(storage, { key });
        const firstPersisted = storage.values.get(key);
        expect(firstPersisted).toBeDefined();

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Broken" } },
        ]);
        expect(asyncResultFacts(ProjectCards.result().get())).toMatchObject({
          _tag: "Failure",
          waiting: false,
        });
        expect(ProjectCards.rows().map((project) => project.name)).toEqual(["Atlas"]);

        const snapshotFailure = yield* Effect.flip(ProjectCards.snapshot());
        const persistFailure = yield* Effect.flip(ProjectCards.persist(storage, { key }));

        expect(snapshotFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(snapshotFailure).toMatchObject({
          _tag: "CollectionSnapshotCodecError",
          operation: "snapshot",
          path: "$",
        });
        expect(persistFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(storage.values.get(key)).toBe(firstPersisted);
      }),
    ));

  it("fails live query collection hydrate and restore with typed snapshot codec errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.readonly-hydrate-source",
          getKey: (project) => project.id,
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.readonly-hydrate",
          getKey: (project) => project.id,
          query: (query) =>
            query.from({ project: Projects }).select(({ project }) => ({
              id: project.id,
              name: project.name,
              progress: project.progress,
            })),
        });
        const snapshot: Collection.Snapshot<ProjectCard, string> = {
          name: "ProjectCards.live-query-collection.readonly-hydrate",
          rows: [],
          updatedAt: 1,
        };

        const hydrateFailure = yield* Effect.flip(ActiveProjectCards.hydrate(snapshot));
        const restoreFailure = yield* Effect.flip(
          ActiveProjectCards.restore(Collection.memoryStorage(), {
            key: "readonly-hydrate-cache",
          }),
        );

        expect(hydrateFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(hydrateFailure).toMatchObject({
          operation: "hydrate",
          path: "$",
        });
        expect(restoreFailure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(restoreFailure).toMatchObject({
          operation: "restore",
          path: "$",
        });
      }),
    ));

  it("supports indexes on derived live query collections", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.index-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    let indexEvaluations = 0;
    const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
      name: "ProjectCards.live-query-collection.indexed",
      getKey: (project) => project.id,
      indexes: {
        progressBand: (project) => {
          indexEvaluations++;
          return project.progress >= 50 ? "high" : "low";
        },
      },
      query: (query) =>
        query
          .from({ project: Projects })
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress,
          }))
          .orderBy(({ project }) => project.name),
    });

    expect(ProjectCards.index("progressBand", "high").map((project) => project.id)).toEqual([
      "atlas",
    ]);
    expect(indexEvaluations).toBe(2);
    expect(ProjectCards.firstByIndex("progressBand", "low")).toMatchObject({
      id: "lumen",
      $collection: "ProjectCards.live-query-collection.indexed",
    });
    expect(indexEvaluations).toBe(2);

    return Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { progress: 58 } }]).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            expect(ProjectCards.index("progressBand", "high").map((project) => project.id)).toEqual(
              ["atlas", "lumen"],
            );
            expect(indexEvaluations).toBe(4);
            expect(ProjectCards.firstByIndex("progressBand", "high")).toMatchObject({
              id: "atlas",
            });
            expect(indexEvaluations).toBe(4);
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("rejects invalid live query collection secondary index values", () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.invalid-index",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const ProjectCards = Collection.liveQuery<ProjectCard, string, never>({
      name: "ProjectCards.live-query-collection.invalid-index",
      getKey: (project) => project.id,
      indexes: {
        invalidEffect: (() => Effect.succeed("active")) as never,
        invalidDate: (() => invalidDate) as never,
        progressBand: (project) => (project.progress >= 50 ? "high" : "low"),
      },
      query: (query) =>
        query.from({ project: Projects }).select(({ project }) => ({
          id: project.id,
          name: project.name,
          progress: project.progress,
        })),
    });

    expect(() => ProjectCards.index("invalidEffect", "active")).toThrow(EffectInputCallbackError);
    expect(() => ProjectCards.firstByIndex("invalidEffect", "active")).toThrow(
      EffectInputCallbackError,
    );
    expect(() => ProjectCards.index("invalidDate", "active")).toThrow(EffectInputCallbackError);
    expect(() => ProjectCards.firstByIndex("invalidDate", "active")).toThrow(
      EffectInputCallbackError,
    );
    expect(() => ProjectCards.index("progressBand", invalidDate)).toThrow(EffectInputCallbackError);
    expect(() => ProjectCards.firstByIndex("progressBand", invalidDate)).toThrow(
      EffectInputCallbackError,
    );
  });

  it("can be used as a source for another live query", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.nested-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
      name: "ProjectCards.live-query-collection.nested",
      getKey: (project) => project.id,
      query: (query) =>
        query
          .from({ project: Projects })
          .where(({ project }) => project.status === "active")
          .select(({ project }) => ({
            id: project.id,
            name: project.name,
            progress: project.progress,
          })),
    });
    const Names = Query.live((query) =>
      query
        .from({ card: ActiveProjectCards })
        .select(({ card }) => card.name)
        .orderBy(({ card }) => card.name),
    );

    expect(Names.evaluate()).toEqual(["Atlas"]);

    return Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { status: "active" } }]).pipe(
        Effect.tap(() => Effect.sync(() => expect(Names.evaluate()).toEqual(["Atlas", "Lumen"]))),
        Effect.asVoid,
      ),
    );
  });

  it("preloads source collections before materializing rows", () => {
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.preload-source",
      getKey: (project) => project.id,
      sync: {
        load,
      },
    });
    const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
      name: "ProjectCards.live-query-collection.preload",
      getKey: (project) => project.id,
      query: (query) =>
        query.from({ project: Projects }).select(({ project }) => ({
          id: project.id,
          name: project.name,
          progress: project.progress,
        })),
    });

    return Effect.runPromise(
      ActiveProjectCards.preload().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            expect(load).toHaveBeenCalledTimes(1);
            expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas"]);
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("collects live query collection preloads as hydrateable source collections", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = Collection.define<Project>({
          name: "Projects.live-query-collection.collect-source",
          getKey: (project) => project.id,
          sync: {
            load: () =>
              Effect.succeed([
                { id: "atlas", name: "Atlas", status: "active", progress: 72 },
                { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
              ]),
          },
        });
        const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
          name: "ProjectCards.live-query-collection.collect-derived",
          getKey: (project) => project.id,
          query: (query) =>
            query
              .from({ project: Projects })
              .where(({ project }) => project.status === "active")
              .select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
        });

        const collected = yield* collectCollectionsEffect(ActiveProjectCards.preload());
        const payload = yield* dehydrateCollectionsEffect(collected.definitions);

        expect(collected.definitions.map((definition) => definition.name)).toEqual([Projects.name]);
        expect(payload.collections.map((snapshot) => snapshot.name)).toEqual([Projects.name]);
        yield* validateCollectionsHydrationEffect(collected.definitions, payload);
      }),
    ));

  it("rejects empty change application because derived collections are read-only", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Projects = Collection.define<Project>({
            name: "Projects.live-query-collection.readonly-empty-apply-source",
            getKey: (project) => project.id,
            initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
          });
          const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
            name: "ProjectCards.live-query-collection.readonly-empty-apply",
            getKey: (project) => project.id,
            query: (query) =>
              query.from({ project: Projects }).select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
          });
          const subscription = yield* subscribeCollectionEventsEffect();

          const failure = yield* Effect.flip(ActiveProjectCards.applyChanges([]));
          const event = yield* PubSub.take(subscription).pipe(Effect.timeoutOption("20 millis"));

          expect(failure).toBeInstanceOf(ReadonlyCollectionMutation);
          expect(failure).toMatchObject({
            collection: "ProjectCards.live-query-collection.readonly-empty-apply",
            operation: "applyChanges",
          });
          expect(Option.isNone(event)).toBe(true);
          expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas"]);
          expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
        }),
      ),
    ));

  it("rejects namespace change application because derived collections are read-only", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const Projects = Collection.define<Project>({
            name: "Projects.live-query-collection.readonly-apply-source",
            getKey: (project) => project.id,
            initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
          });
          const ActiveProjectCards = Collection.liveQuery<ProjectCard, string, never>({
            name: "ProjectCards.live-query-collection.readonly-apply",
            getKey: (project) => project.id,
            query: (query) =>
              query.from({ project: Projects }).select(({ project }) => ({
                id: project.id,
                name: project.name,
                progress: project.progress,
              })),
          });
          const subscription = yield* subscribeCollectionEventsEffect();

          const failure = yield* Effect.flip(
            ActiveProjectCards.applyChanges([
              {
                _tag: "Upsert",
                value: { id: "orion", name: "Orion", progress: 20 },
              },
              {
                _tag: "Delete",
                key: "atlas",
              },
            ]),
          );
          const event = yield* PubSub.take(subscription).pipe(Effect.timeoutOption("20 millis"));

          expect(failure).toBeInstanceOf(ReadonlyCollectionMutation);
          expect(failure).toMatchObject({
            collection: "ProjectCards.live-query-collection.readonly-apply",
            operation: "applyChanges",
          });
          expect(Option.isNone(event)).toBe(true);
          expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas"]);
          expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
        }),
      ),
    ));
});
