import { Collection, Query, ReadonlyCollectionMutation, eq } from "@effect-ui/db";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

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

describe("Collection.liveQuery", () => {
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

  it("supports indexes on derived live query collections", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.live-query-collection.index-source",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 }
      ]
    });
    const ProjectCards = Collection.liveQuery<ProjectCard, string>({
      name: "ProjectCards.live-query-collection.indexed",
      getKey: (project) => project.id,
      indexes: {
        progressBand: (project) => project.progress >= 50 ? "high" : "low"
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
    expect(ProjectCards.firstByIndex("progressBand", "low")).toMatchObject({
      id: "lumen",
      $collection: "ProjectCards.live-query-collection.indexed"
    });

    return Effect.runPromise(
      Projects.writeUpdateEffect("lumen", { progress: 58 }).pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            expect(ProjectCards.index("progressBand", "high").map((project) => project.id)).toEqual(["atlas", "lumen"])
          )
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
