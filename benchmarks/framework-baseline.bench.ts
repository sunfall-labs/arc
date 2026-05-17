import { defineApp, makeRuntime, Resource, route, runWithRuntime, Server } from "@sunfall/arc-core";
import { Collection, eq } from "@sunfall/arc-db";
import {
  createServerRpcResponseEffect,
  preloadRequestEffect,
  serverRpcPath,
  startJsonMediaType,
} from "@sunfall/arc-start";
import { Effect, Schema } from "effect";
import { bench, describe } from "vitest";
import { handleRequest } from "../examples/project-console/src/server.js";

const BenchProject = Resource.family({
  name: "Benchmark.Project.byId",
  load: (id: string) => Effect.succeed({ id, name: `Project ${id}` }),
});

const BenchProjectRoute = route("/bench/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.prefetchEffect(BenchProject(params.id)),
});

const benchStartApp = defineApp({
  routes: [BenchProjectRoute] as const,
  client: {},
});

const Echo = Server.contract<{ readonly value: string }, { readonly value: string }>(
  "Benchmark.echo.rpc",
  {
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.Struct({ value: Schema.String }),
  },
);
const echo = Server.implement(Echo, ({ value }) => Effect.succeed({ value: value.toUpperCase() }));

const benchRpcApp = defineApp({
  routes: [route("/", {})] as const,
  client: {},
});

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

const BenchProjects = Collection.define<Project>({
  name: "Benchmark.Projects.collection",
  getKey: (project) => project.id,
  initialData: [
    { id: "atlas", name: "Atlas", status: "active", progress: 72 },
    { id: "kepler", name: "Kepler", status: "active", progress: 58 },
    { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
  ],
});

const BenchProjectCards = Collection.liveQuery<ProjectCard, string>({
  name: "Benchmark.ProjectCards.live-query",
  getKey: (project) => project.id,
  query: (query) =>
    query
      .from({ project: BenchProjects })
      .where(({ project }) => eq(project.status, "active"))
      .select(({ project }) => ({
        id: project.id,
        name: project.name,
        progress: project.progress,
      }))
      .orderBy(({ project }) => project.name),
});

describe("Sunfall Arc release baseline", () => {
  bench("project console streaming SSR", async () => {
    const response = await handleRequest(
      new Request("https://example.test/projects/atlas?tab=activity"),
    );
    await response.text();
  });

  bench("Start route preload request", async () => {
    await Effect.runPromise(
      preloadRequestEffect(benchStartApp, new Request("https://example.test/bench/projects/atlas")),
    );
  });

  bench("Resource cold plus cached prefetch", async () => {
    const runtime = makeRuntime();
    try {
      const ref = BenchProject("atlas");
      await runtime.runPromise(Resource.prefetchEffect(ref));
      await runtime.runPromise(Resource.prefetchEffect(ref));
    } finally {
      await runtime.runPromise(runtime.disposeEffect);
    }
  });

  bench("Collection live query materialization", async () => {
    const runtime = makeRuntime();
    try {
      await runtime.runPromise(BenchProjectCards.preloadEffect());
      runWithRuntime(runtime, () => BenchProjectCards.rows());
    } finally {
      await runtime.runPromise(runtime.disposeEffect);
    }
  });

  bench("Start RPC transport success", async () => {
    const response = await Effect.runPromise(
      createServerRpcResponseEffect(
        benchRpcApp,
        new Request(`https://example.test${serverRpcPath}`, {
          method: "POST",
          headers: {
            accept: startJsonMediaType,
            "content-type": startJsonMediaType,
          },
          body: JSON.stringify({
            name: echo.name,
            input: { value: "atlas" },
          }),
        }),
      ),
    );
    await response.json();
  });
});
