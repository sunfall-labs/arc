import {
  Action,
  createBrowserRouterHostController,
  defineApp,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Resource,
  Route,
  route,
  runWithRuntime,
  Server,
  type BrowserRouterHostController,
} from "@sunfall/arc-core";
import { Collection, eq } from "@sunfall/arc-db";
import {
  createServerRpcResponseEffect,
  createStartHydrationPayload,
  hydrateStartPayloadEffect,
  preloadRequestEffect,
  serverRpcPath,
  startJsonMediaType,
  type StartHydrationPayload,
} from "@sunfall/arc-start";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { handleRequest, serverApp } from "../examples/project-console/src/server.js";

const microBenchOptions = { throws: true, time: 1_000, warmupTime: 250 };
const asyncBenchOptions = { throws: true, time: 1_000, warmupTime: 250 };
const macroBenchOptions = { throws: true, time: 5_000, warmupTime: 500 };

const assertBench = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const BenchProject = Resource.family({
  name: "Benchmark.Project.byId",
  input: Schema.String,
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
  load: (id: string) => Effect.succeed({ id, name: `Project ${id}` }),
});

const BenchProjectTag = Resource.tag<{ readonly id: string }>("Benchmark.Project", {
  key: ({ id }) => id,
});

const BenchTaggedProject = Resource.family({
  name: "Benchmark.TaggedProject.byId",
  input: Schema.String,
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
  load: (id: string) => Effect.succeed({ id, name: `Project ${id}` }),
  provides: (project) => [BenchProjectTag({ id: project.id })],
});

const BenchProjectRoute = route("/bench/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.prefetchEffect(BenchProject(params.id)),
  preloadResources: [BenchProject],
});

const benchStartApp = defineApp({
  routes: [BenchProjectRoute] as const,
  client: {},
});

const routerProjectRoute = route("/bench/router/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.prefetchEffect(BenchProject(params.id)),
  preloadResources: [BenchProject],
});

const routerIssueRoute = route("/bench/router/issues/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.prefetchEffect(BenchProject(params.id)),
  preloadResources: [BenchProject],
});

const routerRoutes = [routerProjectRoute, routerIssueRoute] as const;

const routeTable = [
  route("/bench/routes", {}),
  route("/bench/routes/docs", {}),
  ...Array.from({ length: 48 }, (_, index) =>
    route(`/bench/routes/${index}/:id`, {
      params: Schema.Struct({ id: Schema.String }),
    }),
  ),
] as const;

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
  initialData: Array.from({ length: 1_000 }, (_, index): Project => {
    const id = `project-${String(index).padStart(4, "0")}`;
    return {
      id,
      name: `Project ${String(index).padStart(4, "0")}`,
      status: index % 4 === 0 ? "blocked" : "active",
      progress: index % 100,
    };
  }),
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

const RenameProject = Action.define<{ readonly id: string; readonly name: string }, ProjectCard>({
  name: "Benchmark.Project.rename",
  run: ({ id, name }) => Effect.succeed({ id, name, progress: 100 }),
  invalidates: (project) => [BenchProjectTag({ id: project.id })],
});

const payloadRefs = Array.from({ length: 50 }, (_, index) =>
  BenchTaggedProject(`payload-${String(index).padStart(3, "0")}`),
);

const taggedRefs = Array.from({ length: 50 }, (_, index) =>
  BenchTaggedProject(`tagged-${String(index).padStart(3, "0")}`),
);

let hotRuntime: ReturnType<typeof makeRuntime>;
let hotResourceRef: Resource.Ref<string, { readonly id: string; readonly name: string }>;
let tagRuntime: ReturnType<typeof makeRuntime>;
let hydrationPayload: StartHydrationPayload;
let hydrationRuntime: ReturnType<typeof makeRuntime>;
let routerRuntime: ReturnType<typeof makeRuntime>;
let router: BrowserRouterHostController<typeof routerRoutes>;
let routerHrefIndex = 0;
let actionRuntime: ReturnType<typeof makeRuntime>;
let action: ReturnType<
  typeof Action.use<{ readonly id: string; readonly name: string }, ProjectCard>
>;

const disposeRuntime = async (
  runtime: ReturnType<typeof makeRuntime> | undefined,
): Promise<void> => {
  if (runtime) {
    await Effect.runPromise(runtime.disposeEffect.pipe(Effect.catchCause(() => Effect.void)));
  }
};

const waitForRouterReady = (
  controller: BrowserRouterHostController<typeof routerRoutes>,
  href: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const current = controller.state.get();
    if (current._tag === "Ready" && current.href === href) {
      resolve();
      return;
    }

    let unsubscribe = (): void => undefined;
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Router did not reach Ready for ${href}`));
    }, 1_000);
    unsubscribe = controller.state.subscribe(() => {
      const state = controller.state.get();
      if (state._tag === "Ready" && state.href === href) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
        return;
      }
      if (state._tag === "Failure" && state.href === href) {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error(`Router navigation failed for ${href}`));
      }
    });
  });

beforeAll(async () => {
  hotRuntime = makeRuntime();
  hotResourceRef = BenchProject("atlas");
  await Effect.runPromise(hotRuntime.provide(Resource.prefetchEffect(hotResourceRef)));

  tagRuntime = makeRuntime();
  await Effect.runPromise(
    tagRuntime.provide(
      Effect.all(
        [...payloadRefs, ...taggedRefs].map((ref) => Resource.prefetchEffect(ref)),
        { concurrency: "unbounded", discard: true },
      ),
    ),
  );
  const resources = await Effect.runPromise(
    tagRuntime.provide(Resource.hydrationPayloadEffect(payloadRefs)),
  );
  hydrationPayload = createStartHydrationPayload(resources);

  hydrationRuntime = makeRuntime();

  routerRuntime = makeRuntime();
  await Effect.runPromise(
    routerRuntime.provide(
      Effect.all(
        [BenchProject("atlas"), BenchProject("kepler")].map((ref) => Resource.prefetchEffect(ref)),
        { discard: true },
      ),
    ),
  );
  router = createBrowserRouterHostController(routerRoutes, {
    history: makeMemoryBrowserHistoryAdapter({ initialHref: "/bench/router/projects/atlas" }),
    initialHref: "/bench/router/projects/atlas",
    runtime: routerRuntime,
  });
  router.start();
  await waitForRouterReady(router, "/bench/router/projects/atlas");

  actionRuntime = makeRuntime();
  action = Action.use(RenameProject, { runtime: actionRuntime });
});

afterAll(async () => {
  await Effect.runPromise(router.disposeEffect().pipe(Effect.catchCause(() => Effect.void)));
  await Promise.all([
    disposeRuntime(hotRuntime),
    disposeRuntime(tagRuntime),
    disposeRuntime(hydrationRuntime),
    disposeRuntime(routerRuntime),
    disposeRuntime(actionRuntime),
  ]);
});

describe("Sunfall Arc release baseline", () => {
  bench(
    "Route href construction and 50-route match table x100",
    () => {
      let matched = 0;
      for (let index = 0; index < 100; index++) {
        const routeIndex = index % 48;
        const href = Route.href(routeTable[routeIndex + 2]!, {
          params: { id: `project-${routeIndex}` },
        });
        const match = Route.match(routeTable, href);
        if (match?.route.path === `/bench/routes/${routeIndex}/:id`) {
          matched++;
        }
      }
      assertBench(matched === 100, "Route matching drifted during benchmark.");
    },
    microBenchOptions,
  );

  bench(
    "Runtime create and dispose",
    async () => {
      const runtime = makeRuntime();
      await Effect.runPromise(runtime.disposeEffect);
    },
    asyncBenchOptions,
  );

  bench(
    "Resource hot cached read x100",
    () => {
      let seen = "";
      runWithRuntime(hotRuntime, () => {
        for (let index = 0; index < 100; index++) {
          seen = Resource.read(hotResourceRef).id;
        }
      });
      assertBench(seen === "atlas", "Hot cached resource read returned the wrong value.");
    },
    microBenchOptions,
  );

  bench(
    "Resource cold plus cached prefetch",
    async () => {
      const runtime = makeRuntime();
      try {
        const ref = BenchProject("cold");
        const first = await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));
        const second = await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));
        assertBench(first.id === "cold" && second === first, "Resource cache did not reuse data.");
      } finally {
        await Effect.runPromise(runtime.disposeEffect);
      }
    },
    asyncBenchOptions,
  );

  bench(
    "Resource semantic tag invalidation plan over 50 refs",
    async () => {
      const plan = await Effect.runPromise(
        tagRuntime.provide(Resource.planInvalidationEffect(BenchProjectTag({ id: "tagged-025" }))),
      );
      assertBench(plan.entries.length === 1, "Semantic tag plan should target one cached ref.");
    },
    asyncBenchOptions,
  );

  bench(
    "Start hydration payload apply for 50 resource snapshots",
    async () => {
      await Effect.runPromise(
        hydrationRuntime.provide(hydrateStartPayloadEffect(hydrationPayload)),
      );
    },
    asyncBenchOptions,
  );

  bench(
    "Browser router cached navigation with route preload",
    async () => {
      routerHrefIndex++;
      const href =
        routerHrefIndex % 2 === 0 ? "/bench/router/projects/atlas" : "/bench/router/issues/kepler";
      router.navigateHref(href);
      await waitForRouterReady(router, href);
    },
    asyncBenchOptions,
  );

  bench(
    "Action submit with typed invalidation callback",
    async () => {
      const value = await Effect.runPromise(
        actionRuntime.provide(action.submitEffect({ id: "atlas", name: "Atlas" })),
      );
      assertBench(value.id === "atlas", "Action submission returned the wrong project.");
    },
    asyncBenchOptions,
  );

  bench(
    "Collection live query materialization over 1k rows",
    async () => {
      const runtime = makeRuntime();
      try {
        await Effect.runPromise(runtime.provide(BenchProjectCards.preloadEffect()));
        const rows = runWithRuntime(runtime, () => BenchProjectCards.rows());
        assertBench(rows.length === 750, "Collection live query should select active projects.");
      } finally {
        await Effect.runPromise(runtime.disposeEffect);
      }
    },
    asyncBenchOptions,
  );

  bench(
    "Start route preload request",
    async () => {
      const result = await Effect.runPromise(
        preloadRequestEffect(
          benchStartApp,
          new Request("https://example.test/bench/projects/atlas"),
        ),
      );
      assertBench(
        result.resources.resources.length === 1,
        "Start route preload should collect one resource.",
      );
    },
    asyncBenchOptions,
  );

  bench(
    "Start RPC transport success",
    async () => {
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
      const body = (await response.json()) as {
        readonly _tag?: string;
        readonly value?: { readonly value?: string };
      };
      assertBench(
        body._tag === "Success" && body.value?.value === "ATLAS",
        "Start RPC response body drifted.",
      );
    },
    asyncBenchOptions,
  );

  bench(
    "project console streaming SSR",
    async () => {
      const response = await Effect.runPromise(
        serverApp.runtime.provide(
          handleRequest(new Request("https://example.test/projects/atlas?tab=activity")),
        ),
      );
      const html = await response.text();
      assertBench(html.includes("Atlas"), "Project console SSR output drifted.");
    },
    macroBenchOptions,
  );
});
