# The Golden Path

Arc gives you States, Resources, Actions, Components, and Routes, with Signals
as the read side of all of them.
This page picks the right one for each job, then builds one small feature end
to end with them: a project list, a project page, and a rename.

Every snippet here is compiled. The code lives in
[`type-tests/golden-path/`](../type-tests/golden-path), and `pnpm typecheck`
type-checks it and fails if a snippet on this page no longer matches its file
(`node scripts/verify-doc-snippets.mjs --write` re-syncs them).

## Pick The Tool

| I need to...                                         | Use                                                                                                                           | Not when                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| read server data, including keyed lists with indexes | **Resource**: `Resource.define` (add `rows` for a list), `Component.resource`; its load is `Resource.implement` on the server | the data never leaves the client: use a State                                      |
| change server data                                   | **Action**: `Action.define` with `invalidates` tags; its `run` is `Action.implement` on the server                            | the change is local UI state: use a State                                          |
| hold client state                                    | **State**: `State.define` + `Component.state`                                                                                 | it is server data: use a Resource; it is addressable: use a Route                  |
| build a screen or feature that reads or writes state | **Component**: `Component.define`                                                                                             | it only renders props: write a plain Solid function                                |
| map a URL to a screen and its data                   | **Route**: `Route.define`                                                                                                     | the state is not addressable (a modal, a tab): use a State                         |
| call a backend or service                            | an **Effect service** (`Context.Service`) the server Layer provides                                                           | it is pure computation: write a function                                           |
| wire and start the app                               | `App.define`, then `createRequestHandler` (server) and `App.launch` (client)                                                  | never skip it: this is where missing services and unhandled failures become errors |
| answer "how did the UI get into this state?"         | **Timeline**: `Timeline.record`, then `travel`                                                                                | production telemetry: use [devtools](devtools.md) summaries                        |

Four defaults settle most arguments:

- **Mutations are Actions.** Every change to server data is an Action. When
  the screen must change before the server answers, the Action's `optimistic`
  patches States, Resource entries, and Resource rows, and a failure rolls
  them back.
- **Declare once, implement on the server.** A Resource without `load` and an
  Action without `run` are served: their schemas are the contract, their
  server bodies (`Resource.implement`, `Action.implement`) live in
  `*.server.ts` modules the browser bundle never includes, and Start carries
  calls between the two.
- **A failure that can reach rendering joins `E`; a failure of work you start
  is yours.** Resource readers add their load errors to the Component's `E`,
  so `catchTags` must handle them before `launch` compiles. `submit`,
  `dispatch`, and `preload` return their failures, and `Component.callback`
  makes the handler deal with them.
- **State that matters has a typed owner.** If rendering, caching, testing, or
  debugging depends on it, it belongs in one of the definitions above, not in
  ad hoc component locals.
- **Every state change has a name.** This holds by construction: every change
  is a State message, an Action, or a framework event (Resource load,
  navigation, a callback or stream transition). Signals are read-only in the
  public API, so there is no unnamed write to make, and the Timeline reads
  like a message log: `State "ProjectSidebar.status" Filter`,
  `Action "Projects.rename" submit`.

## How The Pieces Fit

```text
  server Layer ──provides──► Effect service (ProjectStore)
                               ▲                 ▲
          Resource.implement   │ load        run │   Action.implement
        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ *.server.ts ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
          shared, browser-safe │ RPC / in-process│ action transport
                            Resource ◄──tags── Action
                            ▲      ▲   patches  ▲
                            │      │ preload    │
         Component.resource │      Route        │
                            │      ▲            │
                            │      │ Component.router
                            │      │            │ Component.action
                            └─── Component ─────┘
                 (Component.resource / state / action / callback)
                                │
    App.define ── createRequestHandler (server, implementations) · App.launch (browser)

  Timeline.record observes every commit underneath all of it.
```

## Build It

The feature: a sidebar listing projects, a page per project, and a rename form
on that page. New files are shown whole; a file that changes in a later step is
shown as a diff against its earlier version.

### 1. A Resource for each read

A Resource is a named, typed, cached async read. Its `provides` tags let
Actions refresh it by meaning instead of by cache key. Server data is read on
the server: declare the Resource without `load`, and its `input`, `output`,
and `error` schemas become the contract its server load answers.

`src/projects.ts` (shared by the server and the browser):

<!-- snippet: type-tests/golden-path/projects.step-1.ts -->

```ts
import { Resource } from "@sunfall/arc-core";
import { Schema } from "effect";

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

// Semantic tags: Resources provide them, Actions invalidate them.
export const ProjectsTag = Resource.tag("Projects");
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

// No `load`: the server loads these (`projects.server.ts`). The schemas are
// the wire contract between the two.
export const ProjectList = Resource.define({
  name: "Projects.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  provides: () => [ProjectsTag],
});
export const ProjectsRef = ProjectList("all");

export const ProjectById = Resource.define({
  name: "Projects.byId",
  input: ProjectId,
  output: Project,
  // The typed failure: a failed read renders it with its fields, also across SSR.
  error: ProjectNotFound,
  provides: (project) => [ProjectTag({ id: project.id })],
});
```

The loads live in a server module:

`src/projects.server.ts`:

<!-- snippet: type-tests/golden-path/projects.server.ts -->

```ts
import { Resource } from "@sunfall/arc-core";
import { Context, Effect } from "effect";
import {
  ProjectById,
  ProjectList,
  type Project,
  type ProjectId,
  ProjectNotFound,
} from "./projects.js";

// The server's data access: an Effect service the server Layer provides (a
// database client in a real app). It never reaches the browser bundle.
export interface ProjectStore {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>>;
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
  readonly rename: (input: {
    readonly id: ProjectId;
    readonly name: string;
  }) => Effect.Effect<Project, ProjectNotFound>;
}
export const ProjectStore = Context.Service<ProjectStore>("ProjectStore");

// The loads: each may succeed only with its Resource's `output` and fail only
// with its `error`.
export const projectList = Resource.implement(ProjectList, () =>
  ProjectStore.use((store) => store.list()),
);
export const projectById = Resource.implement(ProjectById, (id) =>
  ProjectStore.use((store) => store.get(id)),
);
```

- `ProjectStore` is an Effect service (`Context.Service`): the server's data
  access, which its Layer provides (the fixture's `ProjectStoreMemory` is a
  `Layer.succeed` over a `Map`; a real app's opens a database).
- `Resource.implement(ProjectById, load)` checks `load` against the
  definition: it may succeed only with `Project` and fail only with
  `ProjectNotFound`. Start serves it; a server render calls it in-process,
  and the browser calls it over RPC. A `*.server.ts` module never reaches the
  browser bundle: the Vite plugin refuses a browser import of one.
- A failure the `error` schema does not declare (a lost connection, a wire
  schema mismatch) is a defect, never a typed failure, so a Resource's type
  says exactly what can render.
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
    // E += ProjectNotFound (its `error` schema), R stays never: the load runs on the server.
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

A Route owns a URL, its decoded params, the data it preloads, the typed
failure of that preload, and the page's head (`title`, `description`,
`meta`) derived from that data.

`src/routes.ts`:

<!-- snippet: type-tests/golden-path/routes.ts -->

```ts
import { Resource, Route } from "@sunfall/arc-core";
import { Schema } from "effect";
import { ProjectById, ProjectId, ProjectNotFound, ProjectsRef } from "./projects.js";

export const ProjectsRoute = Route.define("/", {
  preload: () => Resource.preload(ProjectsRef),
});

export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  // The preload may fail only with this schema's type; Start encodes the
  // failure with it so the hydrating client renders the same failure view.
  error: ProjectNotFound,
  preload: ({ params }) => Resource.preload([ProjectsRef, ProjectById(params.id)]),
  // The tab title, from what the preload loaded; kept current on navigation.
  head: ({ params, read }) => ({ title: read(ProjectById(params.id))?.name }),
});

export const routes = [ProjectsRoute, ProjectRoute] as const;
```

`head` runs once the preload succeeded: on the server for the rendered
document, and in the browser after each navigation, where Start keeps
`document.title` and the head's `<meta>` tags in step. `read(ref)` returns
what the preload loaded, and the head follows it: rename the project and the
tab title changes.

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
  still attaches components with `Route.withComponent`; a page Component in a
  sibling `src/routes/<path>.component.tsx` (default export, taking
  `Route.Props<typeof route>`) is attached by the generated tree as a lazy
  chunk, keeping its type.

### 4. An Action for the rename

An Action is a named mutation: typed input, output, and error, concurrency
and retry policy, and the tags it invalidates. Like the Resources, it is
declared once without `run`, and the server implements it.

`src/rename.tsx`:

<!-- snippet: type-tests/golden-path/rename.step-4.tsx -->

```tsx
import { Action } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Cause, Effect, Schema } from "effect";
import { Show } from "solid-js";
import { Project, ProjectId, ProjectNotFound, ProjectTag, ProjectsTag } from "./projects.js";

// No `run`: the server runs it (`rename.server.ts`). Its schemas are the wire
// contract, so the typed failure arrives typed in the browser.
export const RenameProject = Action.define({
  name: "Projects.rename",
  input: Schema.Struct({ id: ProjectId, name: Schema.String }),
  output: Project,
  error: ProjectNotFound,
  // After a success, every Resource that provides these tags reloads.
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});

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

Its server body:

`src/rename.server.ts`:

<!-- snippet: type-tests/golden-path/rename.server.ts -->

```ts
import { Action } from "@sunfall/arc-core";
import { ProjectStore } from "./projects.server.js";
import { RenameProject } from "./rename.js";

// The rename's server body: it may succeed only with `Project` and fail only
// with `ProjectNotFound`, as the definition declares.
export const renameProject = Action.implement(RenameProject, (input) =>
  ProjectStore.use((store) => store.rename(input)),
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
     // E += ProjectNotFound (its `error` schema), R stays never: the load runs on the server.
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

- The browser submits `RenameProject` over Start's action transport, and the
  server runs `renameProject`. `ProjectNotFound` arrives typed, because the
  `error` schema encodes it on the wire.
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
@@ -28,4 +28,7 @@
   input: Schema.Literal("all"),
   output: Schema.Array(Project),
+  // The list's rows: keyed by id, indexed by status. Readers look rows up by
+  // key or index, and an Action patches one row by key.
+  rows: { key: (project) => project.id, indexes: { status: (project) => project.status } },
   provides: () => [ProjectsTag],
 });
```

- `rows` is allowed only when `output` is an array, and its callbacks are
  typed by the element (`project` is a `Project` here, no annotation).
- Rows are derived from the loaded value, never stored twice. A reload
  replaces them, and a row that did not change keeps its identity, so a keyed
  `<For>` keeps it mounted.

The reader of a Resource with `rows` adds `get(input, key)` and
`index(input, name, value)`. `src/project-list.tsx` reads the status index
and keeps the filter in a State, changed only by its `Filter` message:

<!-- snippet: type-tests/golden-path/project-list.step-3.tsx -> type-tests/golden-path/project-list.tsx -->

```diff
@@ -1,2 +1,3 @@
+import { State } from "@sunfall/arc-core";
 import { Component, RouterLink } from "@sunfall/arc-solid";
 import { For, Loading } from "solid-js";
@@ -4,11 +5,30 @@
 import { ProjectRoute } from "./routes.js";

+type Status = "active" | "archived";
+
+// Client-only UI state: a State, changed only by its named messages. The
+// Timeline reads each change as `State "ProjectSidebar.status" Filter`.
+const SidebarStatus = State.define({
+  name: "ProjectSidebar.status",
+  initial: "active" as Status,
+  on: { Filter: (_status, message: { readonly status: Status }) => message.status },
+});
+
 export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
   const projects = yield* Component.resource(ProjectList);
+  // Each instance owns its own State; it stops when the instance unmounts.
+  const status = yield* Component.state(SidebarStatus);

   return () => (
     <Loading fallback={<p>Loading projects</p>}>
       <nav class={{ refreshing: projects.waiting("all") }}>
-        <For each={projects("all")} keyed={(project) => project.id}>
+        <select
+          value={status.model()}
+          onChange={(event) => status.send.Filter({ status: event.currentTarget.value as Status })}
+        >
+          <option value="active">Active</option>
+          <option value="archived">Archived</option>
+        </select>
+        <For each={projects.index("all", "status", status.model())} keyed={(project) => project.id}>
           {(project) => (
             <RouterLink route={ProjectRoute} options={{ params: { id: project().id } }}>
```

- `projects.index("all", "status", status.model())` suspends like
  `projects("all")` on the first load, then follows the rows: a reload, a
  patch, and a `Filter` message all re-run it. Index names and values are
  checked against `rows.indexes`.
- The routes did not change: their `preload` already loads (and server
  renders) the rows.

Make the rename instant on the Action. `optimistic` runs in the browser and
patches the sidebar row and the project page before the submission leaves.
`transaction.update(ProjectsRef, id, patch)` patches one row of the list by
key (the key is typed by `rows.key`), and `transaction.set` patches the
`ProjectById` entry, so both readers show the new name with no `<Loading>`
flash. Success keeps the new name until the
`ProjectsTag` and `ProjectTag` reloads replace it, and a failure or an
interrupted submission rolls both back. A reload while the rename is in
flight replaces the value underneath and keeps the patch on top. The form and
the server body did not change.

`src/rename.tsx`:

<!-- snippet: type-tests/golden-path/rename.step-4.tsx -> type-tests/golden-path/rename.tsx -->

```diff
@@ -3,5 +3,13 @@
 import { Cause, Effect, Schema } from "effect";
 import { Show } from "solid-js";
-import { Project, ProjectId, ProjectNotFound, ProjectTag, ProjectsTag } from "./projects.js";
+import {
+  Project,
+  ProjectById,
+  ProjectId,
+  ProjectNotFound,
+  ProjectTag,
+  ProjectsRef,
+  ProjectsTag,
+} from "./projects.js";

 // No `run`: the server runs it (`rename.server.ts`). Its schemas are the wire
@@ -12,4 +20,11 @@
   output: Project,
   error: ProjectNotFound,
+  // The sidebar row and the project page show the new name at once; success
+  // keeps it until the reloads land, and a failure rolls both back.
+  optimistic: (input, transaction) =>
+    Effect.all([
+      transaction.update(ProjectsRef, input.id, { name: input.name }),
+      transaction.set(ProjectById(input.id), (project) => ({ ...project, name: input.name })),
+    ]),
   // After a success, every Resource that provides these tags reloads.
   invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
```

### 6. Server rendering and hydration with Start

`App.define` is the one definition both entries derive from: the root
Component, the routes, and, when the browser has services of its own, its
Layer. Start passes the root the href it renders.

`src/app-definition.ts`:

<!-- snippet: type-tests/golden-path/app-definition.ts -->

```ts
import { App } from "@sunfall/arc-start";
import { App as Root } from "./app.js";
import { routes } from "./routes.js";

// Every read and write runs on the server, so the browser needs no Layer of its own.
export const app = App.define({
  root: Root,
  routes,
  // Every page's head: the route's title with the app's name.
  head: (page) => ({
    ...page,
    title: page.title === undefined ? "Projects" : `${page.title} · Projects`,
  }),
});
```

The server adds what only it has: its Layer and the implementations. Each
request runs the matched route's preload on a request runtime, renders the
root into Start's document, and sends it with the hydration payload; the same
handler answers the browser's loads and Action submissions:

`src/server.tsx`:

<!-- snippet: type-tests/golden-path/server.tsx -->

```tsx
import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { ProjectStoreMemory } from "./projects.memory.js";
import { projectById, projectList } from "./projects.server.js";
import { renameProject } from "./rename.server.js";

export const handleRequest = createRequestHandler(app, {
  // Provides what the implementations need (`ProjectStore`).
  server: ProjectStoreMemory,
  implementations: [projectList, projectById, renameProject],
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

- `App.launch` submits every served Action over the network and loads every
  served Resource over RPC. The Component code is unaware of either: an Action
  with `run` (or a Resource with `load`) runs in the browser instead.
- The root must be fully handled, and each side's Layer must provide what it
  needs: drop `ProjectStore` from `server` and `createRequestHandler` stops
  compiling, because the implementations need it.
- `App.define({ head })` turns a route's head into the page's: the app's
  title suffix, its fallback title (a route without `head`, a not-found page,
  a failed preload), and the `<meta>` tags every page carries. The handler's
  optional `document` adds the language, `<link>` tags, and response
  headers. Start writes the rest of the page (Solid's hydration bootstrap, the
  root element, the payload scripts, the entry script), so there is no HTML to
  keep in sync.
- A real Start app also adds the Vite plugin, which generates file routes and
  serves the handler in dev. Copy that wiring from
  [`examples/basic-starter`](../examples/basic-starter) or
  [`examples/project-console`](../examples/project-console).

### 7. Debug with the Timeline

`Timeline.record` records every committed change, whatever owns it: State
models, Resource entries, Action state, and the router. Every entry has a
name by construction: a State commit names its State and message
(`State "ProjectSidebar.status" Filter`), Actions, Resources, and the router
label their own commits, and work a Component's callback starts commits as
`<Component>.<name>`. `travel`
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
shows `State "ProjectSidebar.status" Filter` changing `ProjectSidebar.status`. In tests,
record inside the test's Scope and assert on the DOM after `travel`
([example](solid-adapter.md#debugging-and-testing-with-timeline-replay)).

## Testing

UI logic is tested as plain functions: no runtime, DOM, or timers.

A State's handlers are pure, so `State.step(definition, model, message)` is
the whole test harness. It returns `{ model, commands }` without running the
commands; each command is a description whose `effect` you run, with test
services, to get the message it emits. Here is a State that loads the
project list (its commands emit its own messages, so it names the message
union up front with `State.define<Model, Message>()`):

<!-- snippet: type-tests/golden-path/project-loader.ts -->

```ts
import { Resource, State } from "@sunfall/arc-core";
import { Effect } from "effect";
import { ProjectsRef, type Project } from "./projects.js";

type Model = {
  readonly status: "idle" | "loading" | "ready";
  readonly projects: ReadonlyArray<Project>;
};
type Message =
  | { readonly _tag: "Load" }
  | { readonly _tag: "Loaded"; readonly projects: ReadonlyArray<Project> };

// Handlers are pure: they return the next model, and Effect work leaves them
// as commands that run after the model commits.
export const ProjectLoader = State.define<Model, Message>()({
  name: "ProjectLoader",
  initial: { status: "idle", projects: [] },
  on: {
    Load: (model) =>
      State.next(
        { ...model, status: "loading" },
        State.emit(
          Resource.preload(ProjectsRef).pipe(
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
import { State } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { ProjectLoader } from "./project-loader.js";
import { ProjectId, type Project } from "./projects.js";
import { ProjectsServerMemory } from "./projects.memory.js";

const atlas: Project = { id: ProjectId.make("atlas"), name: "Atlas", status: "active" };

test("Load starts loading and fetches the projects", () => {
  // One transition is one function call: no runtime, DOM, or timers.
  const loading = State.step(ProjectLoader, ProjectLoader.initial, { _tag: "Load" });
  expect(loading.model.status).toBe("loading");
  expect(loading.commands).toHaveLength(1);

  // A command is a description: run its Effect with test services to get the
  // message it emits.
  const emitted = Effect.runSync(
    loading.commands[0]!.effect.pipe(Effect.provide(ProjectsServerMemory)),
  );
  expect(emitted).toMatchObject({ _tag: "Loaded", projects: [atlas, expect.anything()] });
});

test("Loaded shows the projects", () => {
  const loading = { status: "loading", projects: [] } as const;
  const ready = State.step(ProjectLoader, loading, { _tag: "Loaded", projects: [atlas] });
  expect(ready.model).toEqual({ status: "ready", projects: [atlas] });
  expect(ready.commands).toEqual([]);
});
```

An Action's `optimistic` patch is tested with `Action.planOptimistic(definition,
input)`. It runs the patch against a recording transaction and returns what it
would change, applying nothing: a `set` reports the value its State or
Resource entry would read (so load the entry first), and a row patch reports
its Resource ref and the change. The fixture's `ProjectsServerMemory` answers
the served loads in-process: `Server.mockLayer(projectList, projectById)` over
the memory store.

<!-- snippet: type-tests/golden-path/rename.test.ts -->

```ts
import { Action, Resource } from "@sunfall/arc-core";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { ProjectById, ProjectId, ProjectsRef } from "./projects.js";
import { ProjectsServerMemory } from "./projects.memory.js";
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
    }).pipe(Effect.provide(ProjectsServerMemory)),
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
- **Send State messages from DOM handlers.** `state.send.Toggle` binds to an
  event as-is, and `state.send.Search({ query })` passes a message's fields.
  Other Effect work (`submit`, `preload`, `Resource.invalidate`) runs through
  a named `Component.callback("name", f)`, whose commits read
  `<Component>.<name>` on the Timeline.
- **Change server data with Actions.** `optimistic` patches States, Resource
  entries, and Resource rows for the life of the submission; there is no
  other write path. Add `durable: { maxAge }` when a change must survive going
  offline or reloading; `Action.outbox` counts what is waiting to sync.
- **Declare served definitions once.** A Resource without `load` and an Action
  without `run` are the contract; `Resource.implement` and `Action.implement`
  in `*.server.ts` are their bodies, given to `createRequestHandler(app, {
implementations })`. Declare `output` and `error` schemas: they type the
  browser's handles and encode the wire. A form-backed Action declares
  `ActionResult.Redirect` and `ActionResult.ValidationFailure` in its
  `output`.
- **Forms work without JavaScript.** Render `StartAction.form`'s hidden
  fields in a `<form method="post">` with no `action`: it posts to its page.
  A redirect or success answers 303; a failed post renders the page again,
  with the Action handle's `result()` holding the outcome and `formValues()`
  the posted fields to render as input values.
- **Invalidate by meaning.** Resources `provide` tags, Actions `invalidate`
  them. Call `Resource.invalidate(ref)` yourself only for an explicit refresh
  button.
- **Preload in the route.** What `preload` loads is what Start server renders
  and hydrates, so SSR, hydration, and navigation render without a fallback
  flash. Nothing else declares it.
- **Refresh never disturbs what didn't change.** A reload, invalidation,
  hydration refetch, or optimistic patch shares structure with the value it
  replaces: unchanged objects keep their identity, and a binding re-runs only
  when the field it reads changes. Bind fields directly
  (`<input value={props.project.name} />` keeps typed text across a refresh);
  no memo is needed to guard them.
- **Key lists by identity.** `<For each={rows} keyed={(row) => row.id}>` keeps
  rows mounted across reloads, inserts, and reorders; with `rows`, rows match
  by `rows.key`.
- **Hold client state in a State.** It is the one writable client state:
  `State.define` names it and its messages, and Signals are its read side.
  Test transitions with `State.step`.
- **Bind a State per instance.** `Component.state(Definition)` starts one
  State per Component instance and stops it on unmount; key the Component on
  an entity to get a fresh State per entity.
- **Share a State across pages with `scope: "app"`.** A State the shell and
  the pages both use (an undo toast, a cart) declares `scope: "app"`, and
  every `Component.state(Definition)` binding gets the runtime's one instance:
  it outlives the page that sent its message, and a server render gets one
  per request. No Solid context, no module-level `State.start` (which on the
  server would be shared by every request); `State.start` is for headless
  code and tests.

## Go Deeper

- [Solid adapter](solid-adapter.md): every binding, boundary, and entry point.
- [Architecture](architecture.md): the runtime, Resources, Actions, States,
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
