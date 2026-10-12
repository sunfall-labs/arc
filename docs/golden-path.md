# The Golden Path

Arc gives you Signals, Programs, Resources, Actions, Collections, Components,
and Routes. This page picks the right one for each job, then builds one small
feature end to end with them: a project list, a project page, and a rename.

Every snippet here is compiled. The code lives in
[`type-tests/golden-path/`](../type-tests/golden-path), and `pnpm typecheck`
type-checks it and fails if a snippet on this page no longer matches its file
(`node scripts/verify-doc-snippets.mjs --write` re-syncs them).

## Pick The Tool

| I need to...                                                          | Use                                                                      | Not when                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| read server data                                                      | **Resource**: `Resource.define`, read with `Component.resource`          | the data never leaves the client (Signal), or you edit rows locally (Collection)       |
| change server data                                                    | **Action**: `Action.define` with `invalidates` tags                      | the change is local UI state (Signal), or it is an optimistic row edit (Collection)    |
| hold client-only UI state                                             | **Signal**: `Signal.make` in Component setup                             | it has many messages, transitions, or async follow-ups: use a Program                  |
| run a state machine with many messages                                | **Program**: `Program.define`, bound with `Component.program`            | one or two independent values: use Signals                                             |
| keep normalized rows with optimistic writes, indexes, or live queries | **Collection**: `Collection.define({ sync: ref })`, backed by a Resource | you only render a list you fetched: a Resource is enough                               |
| build a screen or feature that reads or writes state                  | **Component**: `Component.define`                                        | it only renders props: write a plain Solid function                                    |
| map a URL to a screen and its data                                    | **Route**: `Route.define`, or `FileRoute.define` in Start                | the state is not addressable (a modal, a tab): use a Signal                            |
| call a backend or service                                             | **Capability**: `Capability.define` plus a Layer per host                | it is pure computation: write a function                                               |
| wire and start the app                                                | `App.define` (server), `Component.launch` (client)                       | never skip it: `launch` is where missing services and unhandled failures become errors |
| answer "how did the UI get into this state?"                          | **Timeline**: `Timeline.record`, then `travel`                           | production telemetry: use [devtools](devtools.md) summaries                            |

Two defaults settle most arguments:

- **Mutations are Actions.** Reach for a Collection write only when the rows
  themselves must change before the server answers.
- **State that matters has a typed owner.** If rendering, caching, testing, or
  debugging depends on it, it belongs in one of the definitions above, not in
  ad hoc component locals.

## How The Pieces Fit

```text
  Layer ──provides──► Capability (ProjectApi)
                        ▲               ▲
                   load │               │ run
                     Resource ◄──tags── Action
                    ▲   ▲    ▲             ▲
          sync: ref │   │    │ preload     │
           Collection   │    Route         │
                ▲       │      ▲           │
  SolidDb.collection    │      │ Component.router
                │       │      │           │ Component.action
                └─── Component ────────────┘
          (Component.resource / callback / program, Signals in setup)
                         │
    App.define (server) · Component.embed (SSR) · Component.launch (client)

  Timeline.record observes every commit underneath all of it.
```

## Build It

The feature: a sidebar listing projects, a page per project, and a rename form
on that page. New files are shown whole; a file that changes in a later step is
shown as a diff against its earlier version.

### 1. A Resource for each read

A Resource is a named, typed, cached async read. Its `load` is an Effect, so
its typed failures and services show up in its type. Its `provides` tags let
Actions refresh it by meaning instead of by cache key.

`src/projects.ts`:

<!-- snippet: type-tests/golden-path/projects.ts -->

```ts
import { Capability, Resource } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  status: Schema.Literals(["active", "archived"]),
});
export type Project = typeof Project.Type;

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId,
}) {}

// The service boundary. Resources and Actions depend on it; Layers implement it.
export interface ProjectApi {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
  readonly rename: (input: {
    readonly id: ProjectId;
    readonly name: string;
  }) => Effect.Effect<Project, ProjectNotFound>;
}
export const ProjectApi = Capability.define<ProjectApi>("ProjectApi");

// Semantic tags: Resources provide them, Actions invalidate them.
export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

export const ProjectList = Resource.define({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  load: () => ProjectApi.use((api) => api.list()),
  provides: () => [ProjectsTag],
});
export const ProjectsRef = ProjectList("all");

export const ProjectById = Resource.define({
  name: "Projects.byId",
  input: ProjectId,
  output: Project,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});
```

- `ProjectApi` is a Capability: the boundary every Resource and Action depends
  on. Layers implement it: the fixture's `ProjectApiMemory` is
  `ProjectApi.layer({ list, get, rename })` over a `Map`; a real app's client
  Layer calls server functions (see the
  [Resource from a server function](../examples/docs-site/src/content/cookbook/resource-from-server-function.md)
  recipe).
- `ProjectById` loads one project and can fail with `ProjectNotFound`. That
  failure is part of its type, and every Component that reads it inherits it.

### 2. A Component that reads it

A Component is a setup generator that yields bindings and returns a render
function. The reader is the only way Resource content reaches JSX.

`src/project-page.tsx`:

<!-- snippet: type-tests/golden-path/project-page.step-2.tsx -->

```tsx
import { Component } from "@sunfall/arc-solid";
import { Cause } from "effect";
import { Loading, Show } from "solid-js";
import { ProjectById, type Project, type ProjectId } from "./projects.js";

export const ProjectPage = Component.define(
  "ProjectPage",
  function* (props: { readonly id: ProjectId }) {
    // E += ProjectNotFound (the load error), R += ProjectApi (the load service).
    const project = yield* Component.resource(ProjectById);

    return () => (
      <Loading fallback={<p>Loading project</p>}>
        <article class={{ refreshing: project.waiting(props.id) }}>
          <ProjectHeader project={project(props.id)} />
        </article>
        <Show when={project.failure(props.id)}>
          {(cause) => <p role="alert">Refresh failed: {Cause.pretty(cause())}</p>}
        </Show>
      </Loading>
    );
  },
).pipe(Component.catchTags({ ProjectNotFound: (error) => <p>No project "{error.id}".</p> }));

// A presentational leaf: a plain Solid function, no Effect cost.
function ProjectHeader(props: { readonly project: Project }) {
  return (
    <header>
      <h1>{props.project.name}</h1>
      <p>{props.project.status}</p>
    </header>
  );
}
```

- `project(props.id)` suspends the nearest `<Loading>` on the first load only.
  After that the content stays mounted across refreshes; `waiting` and
  `failure` drive the status chrome around it.
- The load's `ProjectNotFound` joined the Component's error type, so
  `Component.catchTags` must handle it before the app can launch. Remove the
  boundary and `Component.launch` stops compiling.
- `ProjectHeader` is a plain Solid function. Presentational leaves need no
  Component.

### 3. Routes with typed params and a typed error

A Route owns a URL, its decoded params, the data it preloads, and the typed
failure of that preload.

`src/routes.ts`:

<!-- snippet: type-tests/golden-path/routes.step-3.ts -->

```ts
import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { ProjectById, ProjectId, ProjectList, ProjectNotFound, ProjectsRef } from "./projects.js";

export const ProjectsRoute = Route.define("/", {
  preloadResources: [ProjectList],
  preload: () => Resource.preload(ProjectsRef),
});

const preloadProject = (id: ProjectId) =>
  Effect.all([Resource.preload(ProjectsRef), Resource.preload(ProjectById(id))], {
    discard: true,
  }).pipe(
    // A load callback that throws is a bug, not a typed failure.
    Effect.catchTag("EffectInputCallbackError", Effect.die),
  );

export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  // The preload may fail only with this schema's type; Start encodes the
  // failure with it so the hydrating client renders the same failure view.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById],
  preload: ({ params }) => preloadProject(params.id),
});

export const routes = [ProjectsRoute, ProjectRoute] as const;
```

The sidebar reads the list through the same reader pattern; `RouterLink`
checks `params` against the route's schema.

`src/project-list.tsx`:

<!-- snippet: type-tests/golden-path/project-list.step-3.tsx -->

```tsx
import { Component, RouterLink } from "@sunfall/arc-solid";
import { For, Loading } from "solid-js";
import { ProjectList } from "./projects.js";
import { ProjectRoute } from "./routes.js";

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  const projects = yield* Component.resource(ProjectList);

  return () => (
    <Loading fallback={<p>Loading projects</p>}>
      <nav class={{ refreshing: projects.waiting("all") }}>
        <For each={projects("all")} keyed={(project) => project.id}>
          {(project) => (
            <RouterLink route={ProjectRoute} options={{ params: { id: project().id } }}>
              {project().name}
            </RouterLink>
          )}
        </For>
      </nav>
    </Loading>
  );
});
```

The app root yields its router and children. Every route view's services and
failures join `App`, so `Component.launch(App, ...)` checks all of them.

`src/app.tsx`:

<!-- snippet: type-tests/golden-path/app.tsx -->

```tsx
import { Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { ProjectSidebar } from "./project-list.js";
import { ProjectPage } from "./project-page.js";
import { ProjectNotFound } from "./projects.js";
import { ProjectRoute, ProjectsRoute } from "./routes.js";

// A route view adapts route params to a feature Component.
const ProjectRouteView = Component.define(
  "ProjectRouteView",
  function* (props: Route.Props<typeof ProjectRoute>) {
    const Page = yield* ProjectPage;
    return () => <Page id={props.params.id} />;
  },
);

const routes = [
  Route.withComponent(ProjectsRoute, () => <p>Pick a project.</p>),
  Route.withComponent(ProjectRoute, ProjectRouteView),
] as const;

export const App = Component.define("App", function* (props: { readonly initialHref?: string }) {
  const router = yield* Component.router(
    routes,
    props.initialHref === undefined ? {} : { initialHref: props.initialHref },
  );
  const Sidebar = yield* ProjectSidebar;

  return () => (
    <RouterProvider router={router}>
      <Sidebar />
      <main>
        <RouterOutlet<typeof routes>
          failure={(state) =>
            state.error?._tag === "RoutePreloadError" &&
            state.error.cause instanceof ProjectNotFound ? (
              <p>No project "{state.error.cause.id}".</p>
            ) : (
              <p>Something went wrong.</p>
            )
          }
        />
      </main>
    </RouterProvider>
  );
});
```

- `error: ProjectNotFound` makes the preload's failure typed end to end: the
  `RouterOutlet` failure view reads `state.error.cause.id`, and during SSR the
  server and the hydrating client render that view from the same encoded
  failure.
- Preloaded Resources read synchronously in the page, so navigation and
  hydration show no loading flash.
- In a Start app, each route moves to `src/routes/<path>.ts` as
  `export const Route = FileRoute.define(path)(sameOptions)`, and the Vite
  plugin generates `routeTree.gen.ts`. The options are identical.

### 4. An Action for the rename

An Action is a named mutation: typed input and output, Effect execution,
concurrency and retry policy, and the tags it invalidates.

`src/rename.tsx`:

<!-- snippet: type-tests/golden-path/rename.tsx -->

```tsx
import { Action } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Show } from "solid-js";
import { Project, ProjectApi, ProjectId, ProjectTag, ProjectsTag } from "./projects.js";

export const RenameProject = Action.define({
  name: "Projects.rename",
  input: Schema.Struct({ id: ProjectId, name: Schema.String }),
  output: Project,
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  // After a success, every Resource that provides these tags reloads.
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});

/** Actions the server serves; the client submits them over the network. */
export const servedActions = [RenameProject] as const;

export const RenameForm = Component.define(
  "RenameForm",
  function* (props: { readonly project: Project }) {
    const rename = yield* Component.action(RenameProject);
    // A DOM handler cannot report a typed failure, so the callback must handle
    // it. The outcome (including the failure) lands in `rename.result()`.
    const save = yield* Component.callback((name: string) =>
      rename.submit({ id: props.project.id, name }).pipe(Effect.ignore),
    );
    const error = () => Option.getOrUndefined(AsyncResult.error(rename.result()));

    return () => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(String(new FormData(event.currentTarget).get("name")));
        }}
      >
        <input name="name" value={props.project.name} />
        <button type="submit" disabled={rename.result().waiting}>
          Rename
        </button>
        <Show when={error()}>{(failure) => <p role="alert">{failure()._tag}</p>}</Show>
      </form>
    );
  },
);
```

The page yields the form like any child Component:

`src/project-page.tsx`:

<!-- snippet: type-tests/golden-path/project-page.step-2.tsx -> type-tests/golden-path/project-page.tsx -->

```diff
@@ -3,4 +3,5 @@
 import { Loading, Show } from "solid-js";
 import { ProjectById, type Project, type ProjectId } from "./projects.js";
+import { RenameForm } from "./rename.js";

 export const ProjectPage = Component.define(
@@ -9,4 +10,5 @@
     // E += ProjectNotFound (the load error), R += ProjectApi (the load service).
     const project = yield* Component.resource(ProjectById);
+    const Rename = yield* RenameForm;

     return () => (
@@ -14,4 +16,5 @@
         <article class={{ refreshing: project.waiting(props.id) }}>
           <ProjectHeader project={project(props.id)} />
+          <Rename project={project(props.id)} />
         </article>
         <Show when={project.failure(props.id)}>
```

- `rename.submit(...)` returns an Effect. Handle-members that run work return
  Effects, and `Component.callback` is the one bridge from an Effect to a DOM
  handler. It requires the failure to be handled (`E = never`), which is why
  `Effect.ignore` is there: the failure still lands in `rename.result()`.
- On success, `invalidates` reloads every Resource that provided `ProjectsTag`
  or this project's `ProjectTag`. The page keeps its content mounted while
  `waiting` is true, so the form keeps focus.

### 5. Upgrade the list to a Collection

The sidebar wants per-status filtering and, later, optimistic edits. That is
a Collection's job: keyed rows, indexes, and pending writes. Back it with the
Resource you already have, and both stay in sync.

`src/collection.ts`:

<!-- snippet: type-tests/golden-path/collection.ts -->

```ts
import { Collection } from "@sunfall/arc-db";
import { Project, ProjectsRef } from "./projects.js";

// Backed by the Resource: it loads through ProjectsRef and follows it, so the
// rename Action's `ProjectsTag` invalidation reconciles these rows with no
// second fetch.
export const Projects = Collection.define({
  name: "Projects.rows",
  output: Project,
  getKey: (project) => project.id,
  indexes: { status: (project) => project.status },
  sync: ProjectsRef,
});
```

`src/project-list.tsx` now binds the collection and keeps the filter in a
Signal:

<!-- snippet: type-tests/golden-path/project-list.tsx -->

```tsx
import { Signal } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { SolidDb } from "@sunfall/arc-solid-db";
import { AsyncResult } from "effect/reactivity";
import { For, Show } from "solid-js";
import { Projects } from "./collection.js";
import { ProjectRoute } from "./routes.js";

type Status = "active" | "archived";

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  const projects = yield* SolidDb.collection(Projects);
  // Client-only UI state: a Signal per instance, named for the Timeline.
  const status = Signal.make<Status>("active", { name: "sidebar.status" });

  return () => (
    <nav class={{ refreshing: projects.result().waiting }}>
      <select
        value={status.get()}
        onChange={(event) => status.set(event.currentTarget.value as Status)}
      >
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
      <For each={projects.index("status", status.get())} keyed={(project) => project.id}>
        {(project) => (
          <RouterLink route={ProjectRoute} options={{ params: { id: project().id } }}>
            {project().name}
          </RouterLink>
        )}
      </For>
      <Show when={AsyncResult.isFailure(projects.result())}>
        <p role="alert">Could not load projects.</p>
      </Show>
    </nav>
  );
});
```

The routes preload the collection so SSR renders its rows:

`src/routes.ts`:

<!-- snippet: type-tests/golden-path/routes.step-3.ts -> type-tests/golden-path/routes.ts -->

```diff
@@ -1,13 +1,15 @@
 import { Resource, Route } from "@sunfall/arc-core";
 import { Effect, Schema } from "effect";
-import { ProjectById, ProjectId, ProjectList, ProjectNotFound, ProjectsRef } from "./projects.js";
+import { Projects } from "./collection.js";
+import { ProjectById, ProjectId, ProjectList, ProjectNotFound } from "./projects.js";

 export const ProjectsRoute = Route.define("/", {
   preloadResources: [ProjectList],
-  preload: () => Resource.preload(ProjectsRef),
+  preloadCollections: [Projects],
+  preload: () => Projects.preload(),
 });

 const preloadProject = (id: ProjectId) =>
-  Effect.all([Resource.preload(ProjectsRef), Resource.preload(ProjectById(id))], {
+  Effect.all([Projects.preload().pipe(Effect.orDie), Resource.preload(ProjectById(id))], {
     discard: true,
   }).pipe(
@@ -22,4 +24,5 @@
   error: ProjectNotFound,
   preloadResources: [ProjectList, ProjectById],
+  preloadCollections: [Projects],
   preload: ({ params }) => preloadProject(params.id),
 });
```

- The rename Action did not change. Its `ProjectsTag` invalidation reloads
  `ProjectList`, and the collection follows the Resource with no second fetch.
- Collection rows are readable in every load state, so there is no
  `<Loading>`: `result()` drives the chrome. Collection failures stay in
  `result()`; they do not join the Component's error type.

When the rows must change before the server answers, spell the same backing
inline and add `update`. Writes apply immediately, rows report
`$synced: false` until `update` commits, and a failure rolls them back:

`src/collection.ts` (optimistic variant):

<!-- snippet: type-tests/golden-path/collection.optimistic.tsx -->

```tsx
import { Resource } from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { Project, ProjectApi, ProjectTag, ProjectsRef, type ProjectId } from "./projects.js";

// The same Resource-backed collection, spelled inline so it can commit writes.
export const Projects = Collection.define({
  name: "Projects.rows",
  output: Project,
  getKey: (project) => project.id,
  indexes: { status: (project) => project.status },
  sync: {
    load: () => Resource.preload(ProjectsRef),
    refresh: () => Resource.refresh(ProjectsRef),
    follow: () => Resource.changes(ProjectsRef),
    // Runs after the optimistic write; a failure rolls the row back.
    update: ({ updates }) =>
      Effect.forEach(updates, ({ key, value }) =>
        ProjectApi.use((api) => api.rename({ id: key, name: value.name })).pipe(
          Effect.andThen(Resource.invalidate(ProjectTag({ id: key }))),
        ),
      ),
  },
});

export const QuickRename = Component.define(
  "QuickRename",
  function* (props: { readonly id: ProjectId }) {
    // The row changes now (`$synced: false`) and settles when `update` commits.
    const rename = yield* Component.callback((name: string) =>
      Projects.update(props.id, { name }).pipe(Effect.ignore),
    );
    return () => <input onChange={(event) => rename(event.currentTarget.value)} />;
  },
);
```

### 6. Server rendering and hydration with Start

`App.define` is the server's view of the app: routes, the server Layer, and
the Actions the server serves.

`src/app-definition.ts`:

<!-- snippet: type-tests/golden-path/app-definition.ts -->

```ts
import { App } from "@sunfall/arc-core";
import { ProjectApiMemory } from "./projects.memory.js";
import { servedActions } from "./rename.js";
import { routes } from "./routes.js";

export const app = App.define({
  routes,
  client: { name: "BrowserLive" },
  server: ProjectApiMemory,
  registry: { actions: servedActions, serverFunctions: [] },
});
```

The request handler runs the matched route's preload on a request runtime,
then renders the same `App` with `Component.embed`:

`src/server.tsx`:

<!-- snippet: type-tests/golden-path/server.tsx -->

```tsx
import { Component } from "@sunfall/arc-solid";
import {
  createRequestHandler,
  createStartStreamedHtmlResponse,
  htmlChunk,
} from "@sunfall/arc-start";
import { createComponent, generateHydrationScript, renderToString } from "@solidjs/web";
import { Effect, Stream } from "effect";
import { App } from "./app.js";
import { app } from "./app-definition.js";
import { Projects } from "./collection.js";

export const handleRequest = createRequestHandler(app, {
  collections: [Projects],
  // Start has already run the matched route's preload on this request's runtime.
  render: ({ request, hydrationPlan, runtime }) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const body = renderToString(() =>
        createComponent(Component.embed(App, runtime), { initialHref: url.pathname + url.search }),
      );

      return yield* createStartStreamedHtmlResponse({
        shell: htmlChunk(
          `<!doctype html><html><head>${generateHydrationScript()}</head><body><div id="root">`,
        ),
        chunks: Stream.make(htmlChunk(`${body}</div>`)),
        hydrationPlan,
        tail: htmlChunk(
          `${hydrationPlan.root.script}<script type="module" src="/src/main.tsx"></script></body></html>`,
        ),
      });
    }),
});
```

The client restores the server's snapshot, then hydrates with
`Component.launch`:

`src/main.tsx`:

<!-- snippet: type-tests/golden-path/main.tsx -->

```tsx
import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { hydrateFromDocument, makeActionTransportLayer } from "@sunfall/arc-start";
import { Effect, Layer } from "effect";
import { App } from "./app.js";
import { Projects } from "./collection.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { servedActions } from "./rename.js";

const root = document.getElementById("root")!;
const collections = [Projects];

const runtime = makeRuntime(
  Layer.mergeAll(
    ProjectApiMemory, // stand-in: a real client Layer calls server functions
    makeActionTransportLayer({ actions: servedActions, collections }),
  ),
);

// Restore the server's Resource and Collection snapshot, then hydrate the
// server markup with the same tree: preloaded reads render synchronously.
Effect.runFork(
  runtime
    .provide(hydrateFromDocument(document, undefined, { collections }))
    .pipe(Effect.andThen(Component.launch(App, root, { runtime, hydrate: true }))),
);
```

- `makeActionTransportLayer` routes the served Actions over the network. The
  `RenameForm` code is unchanged: whether an Action runs locally or remotely
  is the runtime's decision.
- `launch` only accepts a fully handled, fully provided tree: if the runtime
  lacked `ProjectApi`, this line would not compile.
- A real Start app also registers routes, server functions, and action
  sources with the Vite plugin. Copy that wiring from
  [`examples/basic-starter`](../examples/basic-starter) or
  [`examples/project-console`](../examples/project-console).

### 7. Debug with the Timeline

`Timeline.record` records every committed change, whatever owns it: Signals,
Resource entries, Action state, Program models, the router, and Collections.
`travel` re-renders the UI as it was after any entry while Effects keep
running against the live state.

`src/timeline-panel.tsx`:

<!-- snippet: type-tests/golden-path/timeline-panel.tsx -->

```tsx
import { Timeline } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { For } from "solid-js";

export const TimelinePanel = Component.define("TimelinePanel", function* () {
  // Records every commit until this instance unmounts. E += TimelineAlreadyRecording.
  const recording = yield* Timeline.record({ limit: 500 });
  const travel = yield* Component.callback((sequence: number) =>
    recording.travel(sequence).pipe(Effect.ignore),
  );
  const resume = yield* Component.callback(() => recording.resume());

  return () => (
    <aside>
      <button disabled={recording.position.get() === undefined} onClick={() => resume()}>
        Back to live
      </button>
      <ol>
        <For each={recording.entries.get()} keyed={(entry) => entry.sequence}>
          {(entry) => (
            <li>
              <button onClick={() => travel(entry().sequence)}>
                {Timeline.describe(entry().cause)}:{" "}
                {entry()
                  .changes.map((change) => change.name)
                  .join(", ")}
              </button>
            </li>
          )}
        </For>
      </ol>
    </aside>
  );
}).pipe(Component.catchAll(() => <p>Another Timeline recording is running.</p>));

/** Development only: mounts the panel beside the app. Run with `Effect.runFork`. */
export const launchTimelinePanel = (container: HTMLElement) =>
  Component.launch(TimelinePanel, container);
```

Mount it beside the app in development with
`Effect.runFork(launchTimelinePanel(panelElement))`. Rename a project and the
panel lists the Action's submit and success, the Resource reloads that its
tags triggered, and the collection sync that followed; changing the sidebar filter
shows `sidebar.status` because the Signal was named. In tests, record inside the
test's Scope and assert on the DOM after `travel`
([example](solid-adapter.md#debugging-and-testing-with-timeline-replay)).

## Rules Of Thumb

- **Render content from the reader.** `reader(input)` is the only way Resource
  data reaches JSX; `waiting(input)` and `failure(input)` are for chrome.
- **Plain Solid functions for presentational leaves.** A Component earns its
  cost when it binds state, services, or failures.
- **Handle every typed failure.** Resource readers add their load errors to
  the Component; `catchTags` or `catchAll` removes them; `launch` refuses what
  is left. Callbacks must handle their own. Action and Collection failures
  arrive in `result()` instead, so render them.
- **Run work through `Component.callback`.** `submit`, `dispatch`, `preload`,
  `refresh`, and Collection writes return Effects; DOM handlers get them via a
  callback.
- **Invalidate by meaning.** Resources `provide` tags, Actions `invalidate`
  them. Call `Resource.invalidate(ref)` yourself only for an explicit refresh
  button.
- **Preload in the route.** Declare `preloadResources` and
  `preloadCollections` with the preload, and SSR, hydration, and navigation
  render without a fallback flash.
- **Key lists by identity.** `<For each={rows} keyed={(row) => row.id}>` keeps
  rows mounted when a refresh returns new objects.
- **Name the Signals you want to see.** `Signal.make(value, { name })` labels
  Timeline entries; unnamed signals show as `signal#N`.
- **Create per-instance state in setup.** A module-level Signal is shared by
  every request on the server.

## Go Deeper

- [Solid adapter](solid-adapter.md): every binding, boundary, and entry point.
- [Architecture](architecture.md): the runtime, Resources, Actions, Programs,
  and Routes in depth.
- [DB](db.md): Collections, sync adapters, live queries, and persistence.
- [Starters](starter.md): the checked apps to copy.
- [Deployment](deployment.md): fetch and Node hosts.
- [Migration notes](migration-notes.md): coming from TanStack Query, Remix,
  reducers, or earlier Arc alphas.
