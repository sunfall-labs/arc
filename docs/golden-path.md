# The Golden Path

Arc gives you Signals, Programs, Resources, Actions, Components, and Routes.
This page picks the right one for each job, then builds one small feature end
to end with them: a project list, a project page, and a rename.

Every snippet here is compiled. The code lives in
[`type-tests/golden-path/`](../type-tests/golden-path), and `pnpm typecheck`
type-checks it and fails if a snippet on this page no longer matches its file
(`node scripts/verify-doc-snippets.mjs --write` re-syncs them).

## Pick The Tool

| I need to...                                         | Use                                                                           | Not when                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| read server data, including keyed lists with indexes | **Resource**: `Resource.define` (add `rows` for a list), `Component.resource` | the data never leaves the client: use a Signal                                     |
| change server data                                   | **Action**: `Action.define` with `invalidates` tags                           | the change is local UI state: use a Signal                                         |
| hold client-only state, including local-only rows    | **Signal**: `Signal.make` in setup, written in a named `Component.callback`   | it has many messages, transitions, or async follow-ups: use a Program              |
| run a state machine with many messages               | **Program**: `Program.define`, bound with `Component.program`                 | one or two independent values: use Signals                                         |
| build a screen or feature that reads or writes state | **Component**: `Component.define`                                             | it only renders props: write a plain Solid function                                |
| map a URL to a screen and its data                   | **Route**: `Route.define`                                                     | the state is not addressable (a modal, a tab): use a Signal                        |
| call a backend or service                            | an **Effect service** (`Context.Service`) plus a Layer per host               | it is pure computation: write a function                                           |
| wire and start the app                               | `App.define`, then `createRequestHandler` (server) and `App.launch` (client)  | never skip it: this is where missing services and unhandled failures become errors |
| answer "how did the UI get into this state?"         | **Timeline**: `Timeline.record`, then `travel`                                | production telemetry: use [devtools](devtools.md) summaries                        |

Four defaults settle most arguments:

- **Mutations are Actions.** Every change to server data is an Action. When
  the screen must change before the server answers, the Action's `optimistic`
  patches Signals, Resource entries, and Resource rows, and a failure rolls
  them back.
- **A failure that can reach rendering joins `E`; a failure of work you start
  is yours.** Resource readers add their load errors to the Component's `E`,
  so `catchTags` must handle them before `launch` compiles. `submit`,
  `dispatch`, and `preload` return their failures, and `Component.callback`
  makes the handler deal with them.
- **State that matters has a typed owner.** If rendering, caching, testing, or
  debugging depends on it, it belongs in one of the definitions above, not in
  ad hoc component locals.
- **Every state change has a name.** A Signal changes only inside a named
  transition: a `Component.callback("name", ...)`, an Action, a Program
  message, or a framework event (Resource load, navigation). A write anywhere
  else dies with `SignalWriteOutsideTransition`, so the Timeline reads like a
  message log: `ProjectSidebar.filter`, `Action "Projects.rename" submit`.

## How The Pieces Fit

```text
  Layer ──provides──► Effect service (ProjectApi)
                        ▲               ▲
                   load │               │ run
                     Resource ◄──tags── Action
                     ▲      ▲    patches ▲
                     │      │ preload    │
  Component.resource │      Route        │
                     │      ▲            │
                     │      │ Component.router
                     │      │            │ Component.action
                     └─── Component ─────┘
          (Component.resource / callback / program, Signals in setup)
                         │
    App.define ── createRequestHandler (server) · App.launch (browser)

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

<!-- snippet: type-tests/golden-path/projects.step-1.ts -->

```ts
import { Resource } from "@sunfall/arc-core";
import { Context, Effect, Schema } from "effect";

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
export const ProjectApi = Context.Service<ProjectApi>("ProjectApi");

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
  // The typed failure: a failed read renders it with its fields, also across SSR.
  error: ProjectNotFound,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});
```

- `ProjectApi` is an Effect service (`Context.Service`): the boundary every
  Resource and Action depends on. Layers implement it: the fixture's
  `ProjectApiMemory` is `Layer.succeed(ProjectApi, { list, get, rename })`
  over a `Map`; a real app's client Layer calls server functions (see the
  [Resource from a server function](../examples/docs-site/src/content/cookbook/resource-from-server-function.md)
  recipe).
- `ProjectById` loads one project and can fail with `ProjectNotFound`.
  `error: ProjectNotFound` declares that failure as a schema: `load` may fail
  only with it, every Component that reads the Resource inherits it, and when a
  server render shows the failure it crosses to the page encoded by that
  schema, so the hydrating client renders the same typed value. A Resource
  without `error` renders a failed read as `ResourceUntypedFailure`, which
  carries only the failure's `tag`; no other failure data leaves the server.

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
    // E += ProjectNotFound (its `error` schema), R += ProjectApi (the load service).
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
- The Resource's declared `ProjectNotFound` joined the Component's error type,
  so `Component.catchTags` must handle it before the app can launch. Remove the
  boundary and `App.define` stops compiling. During SSR the server and the
  hydrating client both render this fallback from the schema-encoded failure.
- `ProjectHeader` is a plain Solid function. Presentational leaves need no
  Component.

### 3. Routes with typed params and a typed error

A Route owns a URL, its decoded params, the data it preloads, and the typed
failure of that preload.

`src/routes.ts`:

<!-- snippet: type-tests/golden-path/routes.ts -->

```ts
import { Resource, Route } from "@sunfall/arc-core";
import { Schema } from "effect";
import { ProjectById, ProjectId, ProjectList, ProjectNotFound, ProjectsRef } from "./projects.js";

export const ProjectsRoute = Route.define("/", {
  preloadResources: [ProjectList],
  preload: () => Resource.preload(ProjectsRef),
});

export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  // The preload may fail only with this schema's type; Start encodes the
  // failure with it so the hydrating client renders the same failure view.
  error: ProjectNotFound,
  preloadResources: [ProjectList, ProjectById],
  preload: ({ params }) => Resource.preload([ProjectsRef, ProjectById(params.id)]),
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
failures join `App`, so `App.define` checks all of them.

`src/app.tsx`:

<!-- snippet: type-tests/golden-path/app.tsx -->

```tsx
import { Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { ProjectSidebar } from "./project-list.js";
import { ProjectPage } from "./project-page.js";
import { ProjectRoute, ProjectsRoute } from "./routes.js";

const routes = [
  Route.withComponent(ProjectsRoute, () => <p>Pick a project.</p>),
  // The third argument maps the route's params to the page's props.
  Route.withComponent(ProjectRoute, ProjectPage, ({ params }) => ({ id: params.id })),
] as const;

// Start passes the root the href it renders: the request's on the server, the
// page's in the browser.
export const App = Component.define("App", function* (props: { readonly href: string }) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  const Sidebar = yield* ProjectSidebar;

  return () => (
    <RouterProvider router={router}>
      <Sidebar />
      <main>
        <RouterOutlet
          router={router}
          failure={({ error }) =>
            error?._tag === "RoutePreloadError" && error.cause._tag === "ProjectNotFound" ? (
              <p>No project "{error.cause.id}".</p>
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

- `Resource.preload` (like `refresh` and `invalidate`) takes one ref or an
  array; an array loads concurrently. A preload fails only with the
  Resources' declared errors: a load callback that throws is a defect.
- `preload` is inferred from its own body, then checked against `error`: fail
  with anything the schema does not declare and the type error names it
  (`Route.PreloadFailureNotInErrorSchema<...>`).
- `error: ProjectNotFound` makes the preload's failure typed end to end: the
  `RouterOutlet` failure view, typed from its `router`, narrows
  `error.cause._tag` to read `id`, and during SSR the server and the hydrating
  client render that view from the same encoded failure. A route without an
  `error` schema fails with `RoutePreloadUntypedFailure`, which carries only
  the failure's `tag`.
- `Route.withComponent(route, Component, (route) => props)` binds a feature
  Component to a route directly; without the mapper the Component takes
  `Route.Props<typeof route>`. It is the only way to attach a component.
- Preloaded Resources read synchronously in the page, so navigation and
  hydration show no loading flash.
- In a Start app, each route moves to `src/routes/<path>.ts` as
  `export const route = Route.define(path, sameOptions)`, and the Vite
  plugin generates `routeTree.gen.ts`, which fails when the declared path
  differs from the one the file location implies. The app
  still attaches components with `Route.withComponent`, and the plugin
  lazy-loads a page Component imported only for that call, keeping its type.

### 4. An Action for the rename

An Action is a named mutation: typed input and output, Effect execution,
concurrency and retry policy, and the tags it invalidates.

`src/rename.tsx`:

<!-- snippet: type-tests/golden-path/rename.step-4.tsx -->

```tsx
import { Action } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Cause, Effect, Schema } from "effect";
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
    // `submit` fails with the Action's errors; a DOM handler cannot report them,
    // so the callback must handle them. `failure()` still shows the latest one.
    // A named transition: its commits read `RenameForm.save` on the Timeline.
    const save = yield* Component.callback("save", (name: string) =>
      rename.submit({ id: props.project.id, name }).pipe(Effect.ignore),
    );

    return () => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(String(new FormData(event.currentTarget).get("name")));
        }}
      >
        <input name="name" value={props.project.name} />
        <button type="submit" disabled={rename.waiting()}>
          Rename
        </button>
        <Show when={rename.failure()}>
          {(cause) => <p role="alert">Rename failed: {Cause.pretty(cause())}</p>}
        </Show>
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
     // E += ProjectNotFound (its `error` schema), R += ProjectApi (the load service).
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

- `rename.submit(...)` returns an Effect that fails with the Action's errors.
  Handle-members that run work return Effects, and `Component.callback` is the
  one bridge from an Effect to a DOM handler. It requires the failure to be
  handled (`E = never`), which is why `Effect.ignore` is there.
- `rename.waiting()` and `rename.failure()` drive the chrome, with the same
  names and meaning as the Resource reader's `waiting` and `failure`.
  `rename.result()` holds the full `AsyncResult`, including the latest value.
- On success, `invalidates` reloads every Resource that provided `ProjectsTag`
  or this project's `ProjectTag`. The page keeps its content mounted while
  `waiting` is true, so the form keeps focus.

### 5. Add `rows` and an instant rename

The sidebar wants a per-status filter, and the rename should show at once.
Both need the list's rows: give `ProjectList` a `rows` option, a key and the
indexes to look rows up by. The Resource stays the one copy of the data: the
same load, cache, tags, and hydration.

`src/projects.ts`:

<!-- snippet: type-tests/golden-path/projects.step-1.ts -> type-tests/golden-path/projects.ts -->

```diff
@@ -37,4 +37,7 @@
   input: Schema.Literal("all"),
   output: Schema.Array(Project),
+  // The list's rows: keyed by id, indexed by status. Readers look rows up by
+  // key or index, and an Action patches one row by key.
+  rows: { key: (project) => project.id, indexes: { status: (project) => project.status } },
   load: () => ProjectApi.use((api) => api.list()),
   provides: () => [ProjectsTag],
```

- `rows` is allowed only when `output` is an array, and its callbacks are
  typed by the element (`project` is a `Project` here, no annotation).
- Rows are derived from the loaded value, never stored twice. A reload
  replaces them, and a row that did not change keeps its identity, so a keyed
  `<For>` keeps it mounted.

The reader of a Resource with `rows` adds `get(input, key)` and
`index(input, name, value)`. `src/project-list.tsx` reads the status index
and keeps the filter in a Signal, written only through the named `filter`
callback:

<!-- snippet: type-tests/golden-path/project-list.step-3.tsx -> type-tests/golden-path/project-list.tsx -->

```diff
@@ -1,14 +1,31 @@
+import { Signal } from "@sunfall/arc-core";
 import { Component, RouterLink } from "@sunfall/arc-solid";
+import { Effect } from "effect";
 import { For, Loading } from "solid-js";
 import { ProjectList } from "./projects.js";
 import { ProjectRoute } from "./routes.js";

+type Status = "active" | "archived";
+
 export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
   const projects = yield* Component.resource(ProjectList);
+  // Client-only UI state: a Signal per instance, named for the Timeline.
+  const status = Signal.make<Status>("active", { name: "ProjectSidebar.status" });
+  // Writes happen in a named transition; the Timeline shows `ProjectSidebar.filter`.
+  const filter = yield* Component.callback("filter", (next: Status) =>
+    Effect.sync(() => status.set(next)),
+  );

   return () => (
     <Loading fallback={<p>Loading projects</p>}>
       <nav class={{ refreshing: projects.waiting("all") }}>
-        <For each={projects("all")} keyed={(project) => project.id}>
+        <select
+          value={status.get()}
+          onChange={(event) => filter(event.currentTarget.value as Status)}
+        >
+          <option value="active">Active</option>
+          <option value="archived">Archived</option>
+        </select>
+        <For each={projects.index("all", "status", status.get())} keyed={(project) => project.id}>
           {(project) => (
             <RouterLink route={ProjectRoute} options={{ params: { id: project().id } }}>
```

- `projects.index("all", "status", status.get())` suspends like
  `projects("all")` on the first load, then follows the rows: a reload, a
  patch, and the filter Signal all re-run it. Index names and values are
  checked against `rows.indexes`.
- The routes did not change: `preloadResources: [ProjectList]` already
  preloads (and server renders) the rows.

Make the rename instant on the Action. `optimistic` patches the sidebar row
and the project page before `run` starts.
`transaction.update(ProjectsRef, id, patch)` patches one row of the list by
key (the key is typed by `rows.key`), and `transaction.set` patches the
`ProjectById` entry, so both readers show the new name with no `<Loading>`
flash. Success keeps the new name until the
`ProjectsTag` and `ProjectTag` reloads replace it, and a failure or an
interrupted submission rolls both back. A reload while the rename is in
flight replaces the value underneath and keeps the patch on top. The form did
not change.

`src/rename.tsx`:

<!-- snippet: type-tests/golden-path/rename.step-4.tsx -> type-tests/golden-path/rename.tsx -->

```diff
@@ -3,5 +3,13 @@
 import { Cause, Effect, Schema } from "effect";
 import { Show } from "solid-js";
-import { Project, ProjectApi, ProjectId, ProjectTag, ProjectsTag } from "./projects.js";
+import {
+  Project,
+  ProjectApi,
+  ProjectById,
+  ProjectId,
+  ProjectTag,
+  ProjectsRef,
+  ProjectsTag,
+} from "./projects.js";

 export const RenameProject = Action.define({
@@ -9,4 +17,11 @@
   input: Schema.Struct({ id: ProjectId, name: Schema.String }),
   output: Project,
+  // The sidebar row and the project page show the new name at once; success
+  // keeps it until the reloads land, and a failure rolls both back.
+  optimistic: (input, transaction) =>
+    Effect.all([
+      transaction.update(ProjectsRef, input.id, { name: input.name }),
+      transaction.set(ProjectById(input.id), (project) => ({ ...project, name: input.name })),
+    ]),
   run: (input) => ProjectApi.use((api) => api.rename(input)),
   // After a success, every Resource that provides these tags reloads.
```

### 6. Server rendering and hydration with Start

`App.define` is the one definition both entries derive from: the root
Component, the routes, the Actions the server serves, and the browser's
Layer. Start passes the root the href it renders.

`src/app-definition.ts`:

<!-- snippet: type-tests/golden-path/app-definition.ts -->

```ts
import { App } from "@sunfall/arc-start";
import { App as Root } from "./app.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { servedActions } from "./rename.js";
import { routes } from "./routes.js";

export const app = App.define({
  root: Root,
  routes,
  actions: servedActions,
  client: ProjectApiMemory, // stand-in: a real client Layer calls server functions
});
```

The server adds what only it has: its Layer (and, in a real app, its
server-function implementations). Each request runs the matched route's
preload on a request runtime, renders the root into Start's document, and
streams the hydration payload:

`src/server.tsx`:

<!-- snippet: type-tests/golden-path/server.tsx -->

```tsx
import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { ProjectApiMemory } from "./projects.memory.js";

export const handleRequest = createRequestHandler(app, {
  server: ProjectApiMemory,
  document: ({ match }) => ({
    title: match === undefined ? "Projects" : `Projects · ${match.href}`,
  }),
});
```

The browser entry is one line. `App.launch` builds the runtime from the client
Layer, restores the server's Resource snapshot, and hydrates the
server markup with the same tree, so preloaded reads render synchronously:

`src/main.tsx`:

<!-- snippet: type-tests/golden-path/main.tsx -->

```tsx
import { App } from "@sunfall/arc-start";
import { Effect } from "effect";
import { app } from "./app-definition.js";

Effect.runFork(App.launch(app));
```

- `App.launch` routes the app's Actions over the network. The `RenameForm`
  code is unchanged: whether an Action runs locally or remotely is the
  runtime's decision.
- The root must be fully handled, and each side's Layer must provide what it
  needs: drop `ProjectApi` from the client Layer and `App.define` stops
  compiling; drop it from `server` and `createRequestHandler` does.
- `document` sets the head and response headers. Start writes the rest of the
  page (Solid's hydration bootstrap, the root element, the payload scripts, the
  entry script), so there is no HTML to keep in sync.
- A real Start app also adds the Vite plugin, which generates file routes and
  serves the handler in dev. Copy that wiring from
  [`examples/basic-starter`](../examples/basic-starter) or
  [`examples/project-console`](../examples/project-console).

### 7. Debug with the Timeline

`Timeline.record` records every committed change, whatever owns it: Signals,
Resource entries, Action state, Program models, and the router. Every entry
has a name, because every write happens inside a named transition: a
Component's callbacks commit as `<Component>.<name>`
(`ProjectSidebar.filter`), and Actions, Programs, Resources, and the router
label their own commits. A write outside all of them fails at the
write with `SignalWriteOutsideTransition`, naming the Signal. `travel`
re-renders the UI as it was after any entry while Effects keep running against
the live state.

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
  const travel = yield* Component.callback("travel", (sequence: number) =>
    recording.travel(sequence).pipe(Effect.ignore),
  );
  const resume = yield* Component.callback("resume", () => recording.resume());

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
panel reads like a message log: `RenameForm.save`, the Action's submit and
success, and the Resource reloads that follow; changing the sidebar filter
shows `ProjectSidebar.filter` changing `ProjectSidebar.status`. In tests,
record inside the test's Scope and assert on the DOM after `travel`
([example](solid-adapter.md#debugging-and-testing-with-timeline-replay)).

## Testing

UI logic is tested as plain functions: no runtime, DOM, or timers.

A Program's handlers are pure, so `Program.step(program, model, message)` is
the whole test harness. It returns `{ model, commands }` without running the
commands; each command is a description whose `effect` you run, with test
services, to get the message it emits. Here is a Program that loads the
project list:

<!-- snippet: type-tests/golden-path/project-loader.ts -->

```ts
import { Program } from "@sunfall/arc-core";
import { Effect } from "effect";
import { ProjectApi, type Project } from "./projects.js";

type Model = {
  readonly status: "idle" | "loading" | "ready";
  readonly projects: ReadonlyArray<Project>;
};
type Message =
  | { readonly _tag: "Load" }
  | { readonly _tag: "Loaded"; readonly projects: ReadonlyArray<Project> };

// Handlers are pure: they return the next model, and Effect work leaves them
// as commands that run after the model commits.
export const ProjectLoader = Program.define<Model, Message, never, ProjectApi>({
  name: "ProjectLoader",
  initial: { status: "idle", projects: [] },
  on: {
    Load: (model) =>
      Program.next(
        { ...model, status: "loading" },
        Program.emit(
          ProjectApi.use((api) => api.list()).pipe(
            Effect.map((projects) => ({ _tag: "Loaded", projects }) as const),
          ),
        ),
      ),
    Loaded: (_model, message) => ({ status: "ready", projects: message.projects }),
  },
});
```

and its tests:

<!-- snippet: type-tests/golden-path/project-loader.test.ts -->

```ts
import { Program } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { ProjectLoader } from "./project-loader.js";
import { ProjectId, type Project } from "./projects.js";
import { ProjectApiMemory } from "./projects.memory.js";

const atlas: Project = { id: ProjectId.make("atlas"), name: "Atlas", status: "active" };

test("Load starts loading and fetches the projects", () => {
  // One transition is one function call: no runtime, DOM, or timers.
  const loading = Program.step(ProjectLoader, ProjectLoader.initial, { _tag: "Load" });
  expect(loading.model.status).toBe("loading");
  expect(loading.commands).toHaveLength(1);

  // A command is a description: run its Effect with test services to get the
  // message it emits.
  const emitted = Effect.runSync(
    loading.commands[0]!.effect.pipe(Effect.provide(ProjectApiMemory)),
  );
  expect(emitted).toMatchObject({ _tag: "Loaded", projects: [atlas, expect.anything()] });
});

test("Loaded shows the projects", () => {
  const loading = { status: "loading", projects: [] } as const;
  const ready = Program.step(ProjectLoader, loading, { _tag: "Loaded", projects: [atlas] });
  expect(ready.model).toEqual({ status: "ready", projects: [atlas] });
  expect(ready.commands).toEqual([]);
});
```

An Action's `optimistic` patch is tested with `Action.planOptimistic(definition,
input)`. It runs the patch against a recording transaction and returns what it
would change, applying nothing: a `set` reports the value its Signal or
Resource entry would read (so load the entry first), and a row patch reports
its Resource ref and the change.

<!-- snippet: type-tests/golden-path/rename.test.ts -->

```ts
import { Action, Resource } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { ProjectById, ProjectId, ProjectsRef } from "./projects.js";
import { ProjectApiMemory } from "./projects.memory.js";
import { RenameProject } from "./rename.js";

test("renaming patches the sidebar row and the project page at once", () => {
  const id = ProjectId.make("atlas");
  const { atlas, changes } = Effect.runSync(
    Effect.gen(function* () {
      // A patch reports the value the entry would read, so load it.
      const atlas = yield* Resource.preload(ProjectById(id));
      // Plans the patch without applying it: nothing is written.
      const changes = yield* Action.planOptimistic(RenameProject, { id, name: "Atlas 2" });
      return { atlas, changes };
    }).pipe(Effect.provide(ProjectApiMemory)),
  );
  expect(changes).toEqual([
    { _tag: "Update", target: ProjectsRef, key: id, update: { name: "Atlas 2" } },
    { _tag: "Set", target: ProjectById(id), value: { ...atlas, name: "Atlas 2" } },
  ]);
});
```

To test what the screen shows, render the Component (see
[Solid adapter](solid-adapter.md#debugging-and-testing-with-timeline-replay)).

## Rules Of Thumb

- **Render content from the reader.** `reader(input)` is the only way Resource
  data reaches JSX; `waiting(input)` and `failure(input)` are for chrome.
- **Plain Solid functions for presentational leaves.** A Component earns its
  cost when it binds state, services, or failures.
- **Handle every typed failure.** Resource readers add their load errors to
  the Component; `catchTags` or `catchAll` removes them;
  `launch` refuses what is left. Work you start (`submit`, `dispatch`,
  `preload`) returns its failures, and callbacks must handle them.
- **Declare `error` where failures render.** A Resource read or route preload
  that fails during SSR crosses to the page only as its `error` schema encodes
  it. Without a schema it renders as `ResourceUntypedFailure` /
  `RoutePreloadUntypedFailure` (the `tag` only), on the server and the client
  alike.
- **One status vocabulary.** Every binding reports `waiting()` and
  `failure()`: readers, live queries, and Actions.
- **Run work through named `Component.callback`s.** `submit`, `dispatch`,
  `preload`, and `refresh` return Effects, and Signal writes need a name; DOM
  handlers get both via `Component.callback("name", f)`, whose commits read
  `<Component>.<name>` on the Timeline.
- **Change server data with Actions.** `optimistic` patches Signals, Resource
  entries, and Resource rows for the life of the submission; there is no
  other write path. Add `durable: { maxAge }` when a change must survive going
  offline or reloading; `Action.outbox` counts what is waiting to sync.
- **Invalidate by meaning.** Resources `provide` tags, Actions `invalidate`
  them. Call `Resource.invalidate(ref)` yourself only for an explicit refresh
  button.
- **Preload in the route.** Declare `preloadResources` with the preload, and
  SSR, hydration, and navigation render without a fallback flash.
- **Key lists by identity.** `<For each={rows} keyed={(row) => row.id}>` keeps
  rows mounted when a refresh returns new objects; with `rows`, unchanged
  rows also keep their object identity.
- **Write Signals only in named transitions.** `Signal.make(value, { name })`
  requires a name for the Signal; writing it outside a callback, Action, or
  Program dies with `SignalWriteOutsideTransition`. Solid effects and bare
  handlers call a named callback instead, and tests wrap direct writes in
  `Signal.batch(f, { name })`.
- **Create per-instance state in setup.** A module-level Signal is shared by
  every request on the server.

## Go Deeper

- [Solid adapter](solid-adapter.md): every binding, boundary, and entry point.
- [Architecture](architecture.md): the runtime, Resources, Actions, Programs,
  and Routes in depth.
- [Rows and queries](db.md): `rows`, change feeds, live queries, and
  persistence.
- [Starters](starter.md): the checked apps to copy.
- [Deployment](deployment.md): fetch and Node hosts.
- [Migration notes](migration-notes.md): coming from TanStack Query, Remix,
  reducers, or earlier Arc alphas.
- [Devtools](devtools.md): runtime facts, causal graphs, and panels.
- [Effect style guide](effect-style.md) and [Invariants](invariants.md): the
  rules framework and app code follow.
- [Public API inventory](public-api-inventory.md): every exported import path.
- [Comparison](comparison.md): how Arc relates to TanStack, Next, Remix, and
  Foldkit.
