import {
  Action,
  createBrowserRouterHostController,
  makeMemoryBrowserHistoryAdapter,
  makeRuntime,
  Resource,
  Route,
  runWithRuntime,
  Server,
  type BrowserRouterHostController,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { eraseRuntime, resourceRowsGet, resourceRowsIndex } from "@sunfall/arc-core/internal";
import { Query } from "@sunfall/arc-db";
import type { StartHydrationPayload } from "@sunfall/arc-start";
import { createServerRpcResponse } from "../packages/start/src/start-request-endpoints.js";
import {
  createStartHydrationPayload,
  hydrateStartPayload,
} from "../packages/start/src/hydration.js";
import { preloadRequest } from "../packages/start/src/start-request-preload.js";
import { makeStartServerApp } from "../packages/start/src/start-server-app.js";
import { serverRpcPath, startJsonMediaType } from "../packages/start/src/rpc.js";
import { Effect, Schema } from "effect";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { handleRequest } from "../examples/project-console/src/server.js";

const microBenchOptions = { throws: true, time: 1_000, warmupTime: 250 };
const asyncBenchOptions = { throws: true, time: 1_000, warmupTime: 250 };
const macroBenchOptions = { throws: true, time: 5_000, warmupTime: 500 };

const assertBench = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const BenchProject = Resource.define({
  name: "Benchmark.Project.byId",
  input: Schema.String,
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
  load: (id: string) => Effect.succeed({ id, name: `Project ${id}` }),
});

const BenchProjectTag = Resource.tag<{ readonly id: string }>("Benchmark.Project", {
  key: ({ id }) => id,
});

const BenchTaggedProject = Resource.define({
  name: "Benchmark.TaggedProject.byId",
  input: Schema.String,
  output: Schema.Struct({ id: Schema.String, name: Schema.String }),
  load: (id: string) => Effect.succeed({ id, name: `Project ${id}` }),
  provides: (project) => [BenchProjectTag({ id: project.id })],
});

const BenchProjectRoute = Route.define("/bench/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.preload(BenchProject(params.id)),
  preloadResources: [BenchProject],
});

const benchStartApp = makeStartServerApp({
  routes: [BenchProjectRoute] as const,
});

const routerProjectRoute = Route.define("/bench/router/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.preload(BenchProject(params.id)),
  preloadResources: [BenchProject],
});

const routerIssueRoute = Route.define("/bench/router/issues/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.preload(BenchProject(params.id)),
  preloadResources: [BenchProject],
});

const routerRoutes = [routerProjectRoute, routerIssueRoute] as const;

const routeTable = [
  Route.define("/bench/routes", {}),
  Route.define("/bench/routes/docs", {}),
  ...Array.from({ length: 48 }, (_, index) =>
    Route.define(`/bench/routes/${index}/:id`, {
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

const benchRpcApp = makeStartServerApp({
  routes: [Route.define("/", {})] as const,
  registry: { serverFunctions: [echo] },
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

const BenchProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["active", "blocked"]),
  progress: Schema.Number,
});

const benchProjects: ReadonlyArray<Project> = Array.from({ length: 1_000 }, (_, index): Project => {
  const id = `project-${String(index).padStart(4, "0")}`;
  return {
    id,
    name: `Project ${String(index).padStart(4, "0")}`,
    status: index % 4 === 0 ? "blocked" : "active",
    progress: index % 100,
  };
});

const BenchProjectRows = Resource.define({
  name: "Benchmark.Projects.rows",
  input: Schema.Literal("all"),
  output: Schema.Array(BenchProjectSchema),
  rows: { key: (project) => project.id, indexes: { status: (project) => project.status } },
  load: () => Effect.succeed(benchProjects),
});
const BenchProjectRowsRef = BenchProjectRows("all");
const benchRowsName = BenchProjectRows.family.options.name;
const benchRowsOptions = BenchProjectRows.family.options.rows!;

// Reloads that load fresh copies of the same 1k projects, as a server would.
const BenchProjectRowsReload = Resource.define({
  name: "Benchmark.Projects.rows.reload",
  input: Schema.Literal("all"),
  output: Schema.Array(BenchProjectSchema),
  rows: { key: (project) => project.id },
  load: () => Effect.sync(() => benchProjects.map((project) => ({ ...project }))),
});
const BenchPortfolio = Resource.define<
  "all",
  {
    readonly owner: { readonly id: string; readonly name: string };
    readonly projects: ReadonlyArray<Project>;
  }
>({
  name: "Benchmark.Portfolio",
  load: (_: "all") =>
    Effect.sync(() => ({
      owner: { id: "ada", name: "Ada" },
      projects: benchProjects.map((project) => ({ ...project })),
    })),
});

const BenchProjectCards = Query.live((query) =>
  query
    .from({ project: BenchProjectRowsRef })
    .where(({ project }) => project.status === "active")
    .select(
      ({ project }): ProjectCard => ({
        id: project.id,
        name: project.name,
        progress: project.progress,
      }),
    )
    .orderBy(({ project }) => project.name),
);

/** Patches one row, reads its index bucket and key while patched, then rolls back. */
const ArchiveBenchProject = Action.define({
  name: "Benchmark.Projects.archive",
  optimistic: (id: string, transaction) =>
    transaction.update(BenchProjectRowsRef, id, { status: "blocked" }),
  run: (id: string) =>
    Effect.gen(function* () {
      const rows = yield* Effect.orDie(Resource.read(BenchProjectRowsRef));
      const blocked = resourceRowsIndex(benchRowsName, benchRowsOptions, rows, "status", "blocked");
      const row = resourceRowsGet(benchRowsName, benchRowsOptions, rows, id) as Project | undefined;
      assertBench(
        blocked.length === 251 && row?.status === "blocked",
        "The optimistic row patch should be visible by key and index.",
      );
      return yield* Effect.fail("rolled back" as const);
    }),
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

let hotRuntime: SunfallArcRuntime;
let hotResourceRef: Resource.Ref<string, { readonly id: string; readonly name: string }>;
let tagRuntime: SunfallArcRuntime;
let hydrationPayload: StartHydrationPayload;
let hydrationRuntime: SunfallArcRuntime;
let routerRuntime: SunfallArcRuntime;
let router: BrowserRouterHostController<typeof routerRoutes>;
let routerHrefIndex = 0;
let actionRuntime: SunfallArcRuntime;
let rowsRuntime: SunfallArcRuntime;
let rowsAction: ReturnType<typeof Action.use<string, never, "rolled back">>;
let action: ReturnType<
  typeof Action.use<{ readonly id: string; readonly name: string }, ProjectCard>
>;

const disposeRuntime = async (runtime: SunfallArcRuntime | undefined): Promise<void> => {
  if (runtime) {
    await Effect.runPromise(runtime.dispose.pipe(Effect.catchCause(() => Effect.void)));
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
  await Effect.runPromise(hotRuntime.provide(Resource.preload(hotResourceRef)));

  tagRuntime = makeRuntime();
  await Effect.runPromise(
    tagRuntime.provide(
      Effect.all(
        [...payloadRefs, ...taggedRefs].map((ref) => Resource.preload(ref)),
        { concurrency: "unbounded", discard: true },
      ),
    ),
  );
  const resources = await Effect.runPromise(
    tagRuntime.provide(Resource.hydrationPayload(payloadRefs)),
  );
  hydrationPayload = createStartHydrationPayload(resources);

  hydrationRuntime = makeRuntime();

  routerRuntime = makeRuntime();
  await Effect.runPromise(
    routerRuntime.provide(
      Effect.all(
        [BenchProject("atlas"), BenchProject("kepler")].map((ref) => Resource.preload(ref)),
        { discard: true },
      ),
    ),
  );
  router = createBrowserRouterHostController(routerRoutes, {
    history: makeMemoryBrowserHistoryAdapter({
      initialHref: "/bench/router/projects/atlas",
    }),
    initialHref: "/bench/router/projects/atlas",
    runtime: eraseRuntime(routerRuntime),
  });
  router.start();
  await waitForRouterReady(router, "/bench/router/projects/atlas");

  actionRuntime = makeRuntime();
  action = Action.use(RenameProject, { runtime: actionRuntime });

  rowsRuntime = makeRuntime();
  const rows = await Effect.runPromise(rowsRuntime.provide(Resource.preload(BenchProjectRowsRef)));
  // Build the status index once, as a mounted reader would.
  resourceRowsIndex(benchRowsName, benchRowsOptions, rows, "status", "active");
  rowsAction = Action.use(ArchiveBenchProject, { runtime: rowsRuntime });
});

afterAll(async () => {
  await Effect.runPromise(router.dispose().pipe(Effect.catchCause(() => Effect.void)));
  await Promise.all([
    disposeRuntime(hotRuntime),
    disposeRuntime(tagRuntime),
    disposeRuntime(hydrationRuntime),
    disposeRuntime(routerRuntime),
    disposeRuntime(actionRuntime),
    disposeRuntime(rowsRuntime),
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
      await Effect.runPromise(runtime.dispose);
    },
    asyncBenchOptions,
  );

  bench(
    "Resource hot cached read x100",
    () => {
      let seen = "";
      for (let index = 0; index < 100; index++) {
        seen = hotRuntime.runSync(Resource.read(hotResourceRef)).id;
      }
      assertBench(seen === "atlas", "Hot cached resource read returned the wrong value.");
    },
    microBenchOptions,
  );

  bench(
    "Resource cold plus cached preload",
    async () => {
      const runtime = makeRuntime();
      try {
        const ref = BenchProject("cold");
        const first = await Effect.runPromise(runtime.provide(Resource.preload(ref)));
        const second = await Effect.runPromise(runtime.provide(Resource.preload(ref)));
        assertBench(first.id === "cold" && second === first, "Resource cache did not reuse data.");
      } finally {
        await Effect.runPromise(runtime.dispose);
      }
    },
    asyncBenchOptions,
  );

  bench(
    "Resource semantic tag invalidation plan over 50 refs",
    async () => {
      const plan = await Effect.runPromise(
        tagRuntime.provide(Resource.planInvalidation(BenchProjectTag({ id: "tagged-025" }))),
      );
      assertBench(plan.entries.length === 1, "Semantic tag plan should target one cached ref.");
    },
    asyncBenchOptions,
  );

  bench(
    "Start hydration payload apply for 50 resource snapshots",
    async () => {
      await Effect.runPromise(hydrationRuntime.provide(hydrateStartPayload(hydrationPayload)));
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
        actionRuntime.provide(action.submit({ id: "atlas", name: "Atlas" })),
      );
      assertBench(value.id === "atlas", "Action submission returned the wrong project.");
    },
    asyncBenchOptions,
  );

  bench(
    "Live query over 1k Resource rows",
    async () => {
      const runtime = makeRuntime();
      try {
        await Effect.runPromise(runtime.provide(BenchProjectCards.preload()));
        const rows = runWithRuntime(runtime, () => BenchProjectCards.rows.get());
        assertBench(rows.length === 750, "The live query should select the active projects.");
      } finally {
        await Effect.runPromise(runtime.dispose);
      }
    },
    asyncBenchOptions,
  );

  bench(
    "Resource rows optimistic update over 1k rows",
    async () => {
      const failure = await Effect.runPromise(
        rowsRuntime.provide(Effect.flip(rowsAction.submit("project-0001"))),
      );
      assertBench(failure === "rolled back", "The row patch submission should roll back.");
    },
    asyncBenchOptions,
  );

  bench(
    "Resource rows refresh with an equal 1k-row reload",
    async () => {
      const rows = await Effect.runPromise(
        rowsRuntime.provide(Resource.refresh(BenchProjectRowsReload("all"))),
      );
      assertBench(rows.length === 1_000, "The rows reload returned the wrong rows.");
    },
    asyncBenchOptions,
  );

  bench(
    "Resource refresh with an equal 1k-item nested value",
    async () => {
      const value = await Effect.runPromise(
        rowsRuntime.provide(Resource.refresh(BenchPortfolio("all"))),
      );
      assertBench(value.projects.length === 1_000, "The nested reload returned the wrong value.");
    },
    asyncBenchOptions,
  );

  bench(
    "Start route preload request",
    async () => {
      const result = await Effect.runPromise(
        preloadRequest(benchStartApp, new Request("https://example.test/bench/projects/atlas")),
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
        Effect.scoped(
          createServerRpcResponse(
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
        Effect.scoped(
          handleRequest(new Request("https://example.test/projects/atlas?tab=activity")),
        ),
      );
      const html = await response.text();
      assertBench(html.includes("Atlas"), "Project console SSR output drifted.");
    },
    macroBenchOptions,
  );
});
