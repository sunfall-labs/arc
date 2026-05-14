import { Collection, Query, ReadonlyCollectionMutation, eq } from "@effect-ui/db";
import { Effect } from "effect";
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
  it("exposes live query results as a read-only collection", async () => {
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

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { status: "active", progress: 48 }));

    expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas", "lumen"]);
    expect(ActiveProjectCards.get("lumen")).toMatchObject({
      name: "Lumen",
      progress: 48,
      $key: "lumen"
    });
  });

  it("supports indexes on derived live query collections", async () => {
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

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { progress: 58 }));

    expect(ProjectCards.index("progressBand", "high").map((project) => project.id)).toEqual(["atlas", "lumen"]);
  });

  it("can be used as a source for another live query", async () => {
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

    await Effect.runPromise(Projects.writeUpdateEffect("lumen", { status: "active" }));

    expect(Names.evaluate()).toEqual(["Atlas", "Lumen"]);
  });

  it("preloads source collections before materializing rows", async () => {
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

    await ActiveProjectCards.preload();

    expect(load).toHaveBeenCalledTimes(1);
    expect(ActiveProjectCards.rows().map((project) => project.id)).toEqual(["atlas"]);
  });

  it("rejects local mutations because derived collections are read-only", async () => {
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

    await expect(ActiveProjectCards.update("atlas", { progress: 90 }))
      .rejects
      .toBeInstanceOf(ReadonlyCollectionMutation);
  });
});
