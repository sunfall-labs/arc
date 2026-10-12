# Solid Adapter

Sunfall Arc keeps Resources, Actions, Programs, Routes, Collections, and runtime
ownership in renderer-independent core packages. The Solid 2 adapter bridges
that core model into Solid's fine-grained reactivity and ownership rules through
one app model: **typed Components**.

Use `@sunfall/arc-solid` with `@sunfall/arc-solid-db` for Solid apps.

## One App Model

JSX erases types (every element is a `JSX.Element`), so a plain Solid component
cannot say which services it needs or which typed failures it can throw. A
`Component<P, E, R>` can: its setup `yield*`s services, bindings, and child
components, and their failures (`E`) and services (`R`) accumulate into the
component type. The entry points (`Component.launch`, `Component.mount`,
`Component.embed`) only accept `Component<P, never, R>` whose `R` the runtime
provides, so a missing service or an unhandled typed failure is a type error,
not a runtime surprise.

```tsx
import { Resource } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { Loading, Show } from "solid-js";

const ProjectPage = Component.define("ProjectPage", function* (props: { readonly id: ProjectId }) {
  const project = yield* Component.resource(ProjectById); // E += load error, R += ProjectApi
  const rename = yield* Component.action(RenameProject); // R += the action's services
  const refresh = yield* Component.callback(() =>
    Resource.invalidate(ProjectById(props.id)).pipe(Effect.ignore),
  );
  // `submit` returns an Effect; its outcome lands in `rename.result()`.
  const save = yield* Component.callback((name: string) =>
    rename.submit({ id: props.id, name }).pipe(Effect.ignore),
  );

  return () => (
    <Loading fallback={<ProjectSkeleton />}>
      <ProjectView
        project={project(props.id)}
        refreshing={project.waiting(props.id)}
        saving={rename.result().waiting}
        onRename={save}
        onRefresh={refresh}
      />
      <Show when={project.failure(props.id)}>{(cause) => <InlineError cause={cause()} />}</Show>
    </Loading>
  );
}).pipe(Component.catchTags({ ProjectNotFound: (error) => <NotFound id={error.id} /> }));

// The app entry point: the runtime must provide every service the tree needs.
Effect.runFork(Component.launch(App, root, { runtime }));
```

Plain Solid function components remain the right tool for presentational
leaves (rows, badges, layout): they take props and render, with no Effect cost.
Anything that reads or writes runtime state (Resources, Actions, Programs,
Streams, Collections, the router) is a setup-time binding in a `Component`.

## Setup And Render

`Component.define(name, function* (props) { ...; return () => <View /> })`:

- **Setup runs once per instance**, with that instance's Solid props, under the
  instance's Solid owner and with an instance `Scope`. Read props in tracked
  code (the render function, accessors) to react to changes; read them in setup
  to seed state.
- **Every setup step runs under the instance owner**, even after an
  asynchronous step, so Solid context reads (`useRouter()`, `useContext`) and
  Solid primitives created in setup attach to the instance.
- **Render** is the returned function; it runs once per instance, like any Solid
  component body.
- **Asynchronous setup** (awaiting a service built by an async Layer, an
  `Effect.sleep`, ...) suspends the nearest `<Loading>`; a synchronous setup
  renders right away, which keeps hydration and preloaded reads synchronous.
  Render runs in a computation of the instance's own, so a render whose first
  Resource read is pending suspends the nearest `<Loading>` and then retries
  only itself: the instance, its setup, and its bindings are kept (also under
  a `<Show>` with function children).
- **Failures**: a failing setup, a failing provided Layer, or a failed first
  Resource load throws to the nearest `<Errored>` when the instance renders;
  `Component.catchTags` / `Component.catchAll` are those boundaries, typed.
- **Disposal**: Solid disposing the instance interrupts a running setup and
  closes the instance Scope, which stops its Programs, Streams, and callbacks,
  interrupts in-flight Action submissions, and runs `Effect.addFinalizer`
  finalizers.

Per-runtime sharing is by construction, so there is no second "per-runtime
setup" concept: Resources and Collections live in the runtime's stores (two
instances reading `ProjectById("atlas")` share one load), and
`Component.provide(layer)` builds its Layer once per runtime.

Children are yielded, not imported into JSX: `const Card = yield* ProjectCard`
returns a plain Solid component `(props) => JSX.Element` whose instances run in
the parent setup's context (including `Component.provide` services), and adds
`ProjectCard`'s `E` and `R` to the parent.

## Bindings

Each binding is an Effect yielded in setup. Its services join the component's
`R`; typed failures that render join `E`.

| Binding                                 | Returns                                                                                              | Joins                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Component.resource(family)`            | `ResourceReader`: `reader(input)`, `waiting`, `failure`                                              | load error to `E`, services                                          |
| `Component.action(definition)`          | `ActionHandle`: `result`, `input`, `submit` (Effect), `reset` (Effect)                               | action services                                                      |
| `Component.program(definition, opts?)`  | `ProgramHandle`: fine-grained `model`, `committed`, `failures`, `dispatch` (Effect), `clearFailures` | program services                                                     |
| `Component.stream(stream, initial)`     | `Accessor<A>` of the latest element                                                                  | stream services                                                      |
| `Component.callback(f)`                 | `(...args) => void` that forks `f(...args)` (failures handled)                                       | callback services                                                    |
| `Component.router(routes, options?)`    | the instance's `BrowserRouter<Routes>`                                                               | route preload and route Component services, route Component failures |
| `SolidDb.collection(definition, opts?)` | `CollectionHandle`: `rows`, `result`, `get`, `index`, `pendingMutations`, `preloadFailure`           | collection services                                                  |
| `SolidDb.liveQuery(query, opts?)`       | `LiveQueryHandle`: `rows`, `result`, `preload` (Effect), `refresh` (Effect)                          | source services                                                      |

Handles share one vocabulary. Members that run work (`submit`, `dispatch`,
`reset`, `preload`, `refresh`) return Effects; event handlers run them through
`Component.callback`. `result()` is the `AsyncResult` status of actions,
collections, and live queries; row-valued accessors are `rows()`; a Resource
renders through its reader (`reader(input)`, with `waiting(input)` /
`failure(input)` for status). Pure synchronous state writes such as
`clearFailures()` stay synchronous.

Every binding runs with the setup's context: Effects it starts see the
runtime's services and `Component.provide` Layers. `Component.instance` is the
expert seam for writing more bindings (it is how `@sunfall/arc-solid-db` is
built): it returns the instance's runtime (bound to the setup context), owner,
and Scope, with `run(f)` (Solid primitives under the instance owner) and
`fork(effect)` (fibers in the instance Scope).

### Resources: the reader is the only way to render content

`Component.resource(family)` returns a reader. `reader(input)` is the only way
to get a Resource value into JSX:

- The first load suspends the nearest `<Loading>` (a route preload or SSR
  hydration makes it synchronous, so hydrated pages render with no fallback
  flash and no refresh).
- Afterwards the reader keeps returning the current value, or the stale value
  after a failed refresh. `<Loading>` shows its fallback only until the first
  value, so **content stays mounted across refreshes**: inputs keep their text,
  focus and scroll stay put, and Programs or Actions in the subtree keep
  running.
- A failed first load throws `ResourceFailure` to the nearest `<Errored>`;
  `catchTags` matches the typed load error's `_tag` (`catchAll` handles every
  typed failure). A load callback that throws synchronously is a defect: it is
  re-caused as `Die` and never matched by a typed handler.

Status chrome reads value-free accessors, so nothing renders content from a
status: `reader.waiting(input)` (a load or refresh is in flight) and
`reader.failure(input)` (the settled failure `Cause`, for an inline error beside
the stale content).

```tsx
return () => (
  <Loading fallback={<Skeleton />}>
    <article class={{ refreshing: project.waiting(props.id) }}>
      <ProjectView project={project(props.id)} />
    </article>
    <Show when={project.failure(props.id)}>{(cause) => <InlineError cause={cause()} />}</Show>
  </Loading>
);
```

Key lists by identity (`<For each={rows()} keyed={(row) => row.id}>`) so a
refresh that hands back new row objects keeps the same rows mounted.

### Actions: one binding, local or remote

`Component.action(definition)` binds an Action to the instance. `submit(input)`
returns the submission Effect (it composes into Programs and workflows, and its
outcome also lands in `result()`); an event handler runs it through
`Component.callback`, which requires its failures to be handled (usually
`Effect.ignore`, since `result()` carries them). `reset()` is an Effect too.
`result()` is an `AsyncResult`: `Initial` while idle, `waiting` while a
submission is in flight, then `Success` or `Failure` (full `Cause`, latest
success kept as `previousSuccess`). Unmounting interrupts in-flight
submissions.

Whether a submission runs locally or on the server is the runtime's decision,
not the UI's: Core's `ActionTransport` service is looked up on every submission.
In a Start app the client runtime provides it with
`makeActionTransportLayer({ actions })`, listing the Actions the server serves;
those submit over the network and their responses (hydrated Resources and
Collections, Resource invalidations) apply to the submitting runtime. Every
other Action runs its `run` locally. The handle, its result type, and its error
type (the Action's own errors plus `Server.ClientError`) are the same either
way. The no-JS form path is unchanged: `StartAction.form(definition, ...)`
renders the same Action as a progressive `<form method="post">`.

### Programs: fine-grained models

A Program keeps one immutable model, but Solid readers should not all re-run
whenever any part of it changes. `Component.program(...)` reconciles every
committed model into a read-only Solid projection owned by the instance, and
`model()` returns that view:

```tsx
const board = yield * Component.program(BoardProgram);

return () => (
  <>
    <h1>{board.model().title}</h1>
    <For each={board.model().items}>{(item) => <Row label={item.label} done={item.done} />}</For>
  </>
);
```

Relabelling one item re-runs only the readers of that item's `label`: the
title and every other row stay put, and `<For>` reuses all of its rows (Solid
rc.14 projections still wake `<For>` to re-check row identity whenever an
item object is replaced, an O(rows) diff that renders nothing). The rules:

- **Identity is preserved.** Unchanged subtrees keep their view identity, and
  `model()` itself re-notifies only when the root changes identity (a primitive
  value, an object/array swap, or a different keyed entity).
- **Arrays reconcile by key.** Items are matched by `key`, so inserts, removals,
  and reorders keep surviving items (and their `<For>` rows). The key defaults
  to `"id"`, Solid's projection default; pass
  `Component.program(Program, { key })` with another property name, a key
  function of each plain object, or `null` to match by position. Items without
  the key fall back to position, and an object whose key changes is a new
  entity.
- **Plain data is deep; everything else is a leaf.** Plain objects and arrays
  reconcile field by field. `Date`, `Map`, `Set`, frozen objects, and other
  values Solid stores do not wrap are leaves replaced by reference.
- **The view is read-only and deeply typed as such.**
  `Component.ProgramModelView<Model>` makes every object and array `readonly`
  (`Map`/`Set` become `ReadonlyMap`/`ReadonlySet`). Change the model by
  dispatching messages.
- **Updates land with Solid's flush.** Arc commits are transactional, and the
  projection catches up atomically at Solid's next flush like every Arc signal
  rendered in Solid. Effect-side code reads `handle.committed`, the plain
  committed model and the source of truth (`Signal.peek(...)`,
  `Signal.changes(...)`).
- **Server rendering** uses Solid's server projection: it renders the model as
  of setup, with no reactivity, and hydrates like any other synchronous
  projection.

Because setup runs per instance, a Program can close over the instance's other
bindings: a form Program that submits `rename.submit(...)` from a command
gets its own Action and Program per mounted form.

### Streams and callbacks

`Component.stream(stream, initial)` runs a `Stream<A, never, R>` for the
instance and returns its latest element as an accessor.
`Component.callback(f)` turns an Effect-returning function into a plain DOM
event handler; each call forks the Effect in the instance Scope with the setup
context. Callbacks must handle their own failures (`E = never`): an event
handler has nowhere to report a typed failure, so the type makes you decide.

```tsx
const presence = yield * Component.stream(presenceStream, initialPresence);
const move =
  yield *
  Component.callback((id: WorkItemId, status: WorkItemStatus) =>
    WorkItems.update(id, { status }).pipe(Effect.ignore),
  );
```

### Collections and live queries

`@sunfall/arc-solid-db` adds `SolidDb.collection(definition)` and
`SolidDb.liveQuery(query)` as setup-time bindings. Collection handles are
reactive reads (`rows`, `get`, `index`, `pendingMutations`, `result`); writes
run the definition's Effects through `Component.callback`. A live query's
factory runs tracked: a signal or prop it reads (`props.projectId`) rebuilds the
query. Both read the instance runtime's Collection Store.

## Boundaries And Provision

- `Component.catchTags(handlers)`: a Solid `<Errored>` matched by `_tag` (a
  `ResourceFailure` matches by the `_tag` of its typed load error); only tags in
  `E` are accepted, each handler receives exactly that member of `E` plus
  Solid's `reset`, and handled tags leave `E`. Unmatched failures, including
  defects, reach outer boundaries.
- `Component.catchAll(handler)`: one handler for every typed failure; removes
  `E`. Defects still rethrow outward.
- `Component.loading(fallback)`: a Solid `<Loading>` around the instance;
  type-neutral.
- `Component.provide(layer)`: provides services to the component's setup and
  everything it binds or yields, removing `ROut` from `R` and adding Layer
  failures to `E`. The Layer is built once per runtime; scoped services live
  until the runtime is disposed.

## Entry Points

- `Component.launch(component, container, options?)`: **the app entry point**.
  Requires every typed failure handled (`E = never`) and every service
  provided, either by `Component.provide` or by the host runtime passed as
  `{ runtime }` (a `SunfallArcRuntime<RS, ER>` satisfies `RS`; an erased runtime
  satisfies nothing). It starts the runtime (its startup failure `ER` is the
  only failure), keeps the tree mounted until interrupted (like
  `Layer.launch`), then disposes it and any runtime it owns. Run it with
  `Effect.runFork`. `{ props }` passes root props; `{ hydrate: true }` hydrates
  server markup.
- `Component.mount(component, container, options?)`: the composable primitive
  under `launch`: a scoped acquisition (`Effect<void, ER, Scope>`) that disposes
  the tree (and an owned runtime) when its Scope closes. A failed mount releases
  what it acquired immediately. Use it inside larger scoped programs and tests.
- `Component.embed(component, runtime)`: the same fully provided component as a
  plain Solid component on an explicit runtime, checked against that runtime's
  services. It is the server render path.

There is no runtime context and no default runtime: every tree gets its runtime
from one of these entry points, and every binding reads it from its instance.

### Server rendering and hydration

```tsx
// server render (Start request runtime)
renderToString(() => createComponent(Component.embed(App, runtime), { initialHref: href }));

// client entry: restore the Resource snapshot, then hydrate the same tree
Effect.runFork(
  runtime
    .provide(hydrateFromDocument(document))
    .pipe(Effect.andThen(Component.launch(App, root, { runtime, hydrate: root.hasChildNodes() }))),
);
```

`launch` and `embed` render the same tree, so server markup is reused. Each
request runtime runs setup for its own instances (and builds provided Layers
once); request runtime disposal releases them. Route-preloaded and hydrated
Resources read synchronously on both sides, so there is no `<Loading>` flash
and no refresh. An asynchronous setup renders the nearest `<Loading>` fallback
under `renderToString`.

## Routing

`Component.router(routes, options?)` creates the instance's browser router with
the setup's runtime and context; render it with `<RouterProvider router>`.
`RouterOutlet`, `RouterLink`, and `useRouter()` work anywhere below it. The
routes' preload services and route Components' services and failures join the
component that creates the router, so `launch` checks them:

```tsx
const routes = [
  Route.withComponent(HomeRoute, HomeView), // a plain Solid component
  Route.withComponent(ProjectRoute, ProjectPage), // a typed Component
] as const;

const App = Component.define("App", function* (props: { readonly initialHref?: string }) {
  const router = yield* Component.router(
    routes,
    props.initialHref === undefined ? {} : { initialHref: props.initialHref },
  );
  const Shell = yield* AppShell;
  return () => (
    <RouterProvider router={router}>
      <Shell />
    </RouterProvider>
  );
});
```

Route components may be plain Solid functions or typed `Component`s; a
`Component` route view renders with the router's setup context. Router options
are `initialHref` (SSR), `history` (a custom history Adapter, e.g. static
sites), and `hydrating`.

### Route failure views

`RouterOutlet`'s `failure` renderer receives the router's `Failure` state,
including `Cause<BrowserRouterError<Routes> | ER>`. A route that declares an
`error` schema reports its preload failure as `RoutePreloadError<E>` with the
schema's type, so the view reads the failure's fields directly:

```tsx
<RouterOutlet
  failure={(state) =>
    state.error?._tag === "RoutePreloadError" && state.error.cause instanceof ProjectNotFound ? (
      <p>Project "{state.error.cause.id}" was not found.</p>
    ) : (
      <p>Something went wrong.</p>
    )
  }
/>
```

When Start renders a route preload failure, the server and the hydrating client
render this view from the same failure, decoded from the wire with the route's
`error` schema (tag-only without one), so hydration reuses the server markup.

## Async State Is `AsyncResult`

Action, collection, and live-query handles expose one `result()` accessor
holding Effect's `AsyncResult` (`import { AsyncResult } from "effect/reactivity"`):
`AsyncResult.value(result)` (current or stale value), `AsyncResult.error(result)`
(typed error), `result.waiting` (load or submission in flight), and
`result._tag`. Loads mark the current result `waiting` instead of switching to a
separate pending tag, so a refresh shows `Success` with `waiting: true`. A
`Failure` carries the full `Cause` and keeps the latest success as
`previousSuccess`. An interrupted load or submission returns to its prior
settled result. `AsyncResult.builder(...)` is fine for leaf status UI (a
"Saving" label, an error line), where exhaustiveness helps and rebuilding costs
nothing; Resource content always renders through the reader.

> **Builder ordering gotcha:** `onSuccess` narrows the success type to `never`
> for the branches that follow it, so `failed.previousSuccess` is only typed as
> your value when `onFailure` comes **before** `onSuccess`.

## Debugging And Testing With Timeline Replay

The Solid adapter needs nothing extra for replay: `Timeline.record(...)` from
`@sunfall/arc-core` records every commit, and travelling re-renders every Solid
computation that reads an Arc signal, including `Component.program(...)`
models, Resource reads, and Action state, at the travelled commit. Effects keep
running against the live head, so the UI can be inspected in the past while the
app keeps working; `resume()` returns the DOM to the head.

```ts
const recording = yield * Timeline.record();
yield * counter.dispatch({ _tag: "Increment" });
yield * counter.dispatch({ _tag: "Increment" });

const [first] = Signal.peek(recording.entries);
yield * recording.travel(first!.sequence);
flush();
expect(container.textContent).toBe("1"); // the DOM shows the first commit

yield * recording.resume();
flush();
expect(container.textContent).toBe("2");
```

`recording.entries` and `recording.position` are Arc signals, so a debug panel
renders them like any other state. Run `Timeline.record(...)` in the Scope that
owns the debugging session (a test, or a devtools mount); closing it uninstalls
the recorder.

## Package And Test Shape

Starters and examples compile Solid components through the `@sunfall/arc-tsrx`
Vite preset. Workspace tests run Solid adapter tests in a browser-build Vitest
project and the remaining package and example tests through the SSR build.
