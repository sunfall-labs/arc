# Solid Adapter

Sunfall Arc keeps States, Resources, Actions, Routes, and runtime
ownership in renderer-independent core packages. The Solid 2 adapter bridges
that core model into Solid's fine-grained reactivity and ownership rules through
one app model: **typed Components**.

Use `@sunfall/arc-solid` for Solid apps. This page is the reference;
[The Golden Path](golden-path.md) is the walkthrough.

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
  const project = yield* Component.resource(ProjectById); // E += load error, R += load services (none if served)
  const rename = yield* Component.action(RenameProject); // R += the action's services
  const refresh = yield* Component.callback("refresh", () =>
    Resource.invalidate(ProjectById(props.id)).pipe(Effect.ignore),
  );
  // `submit` fails with the Action's errors; the callback must handle them.
  // Its own Signal writes would commit as `ProjectPage.rename` on the Timeline.
  const save = yield* Component.callback("rename", (name: string) =>
    rename.submit({ id: props.id, name }).pipe(Effect.ignore),
  );

  return () => (
    <Loading fallback={<ProjectSkeleton />}>
      <ProjectView
        project={project(props.id)}
        refreshing={project.waiting(props.id)}
        saving={rename.waiting()}
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
Anything that reads or writes runtime state (States, Resources, Actions,
Streams, live queries, the router) is a setup-time binding in a `Component`.

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
  Render runs in its own computation, so a render whose first
  Resource read is pending suspends the nearest `<Loading>` and then retries
  only itself: the instance, its setup, and its bindings are kept (also under
  a `<Show>` with function children).
- **Failures**: a failing setup, a failing provided Layer, or a failed first
  Resource load throws to the nearest `<Errored>` when the instance renders;
  `Component.catchTags` / `Component.catchAll` are those boundaries, typed.
- **Disposal**: Solid disposing the instance interrupts a running setup and
  closes the instance Scope, which stops its States, Streams, and callbacks,
  interrupts in-flight Action submissions, and runs `Effect.addFinalizer`
  finalizers.

Per-runtime sharing is by construction, so there is no second "per-runtime
setup" concept: Resources live in the runtime's Resource Store (two
instances reading `ProjectById("atlas")` share one load), and
`Component.provide(layer)` builds its Layer once per runtime.

Children are yielded, not imported into JSX: `const Card = yield* ProjectCard`
returns a plain Solid component `(props) => JSX.Element` whose instances run in
the parent setup's context (including `Component.provide` services), and adds
`ProjectCard`'s `E` and `R` to the parent.

## Bindings

Each binding is an Effect yielded in setup. Its services join the component's
`R`. **The failure rule: a failure that can reach rendering joins `E`; a
failure of work you start is returned to you.** Resource readers (row
lookups included) and live query rows throw a failed first load to `<Errored>`, so their
declared load errors join `E` and `catchTags` handles them; `submit`,
`dispatch`, `preload`, and `refresh` return their failures as Effects, and
`Component.callback` (`E = never`) makes the handler decide. A callback that
breaks its contract (throws, returns a Promise, produces a row its schema
rejects) is a defect, never part of `E`.

| Binding                                | Returns                                                                                                              | Joins                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Component.resource(family)`           | `Component.ResourceReader`: `reader(input)`, `waiting`, `failure`; with `rows`, also `get`, `index`                  | load error to `E`, services                                          |
| `Component.action(definition)`         | `Component.ActionHandle`: `waiting`, `failure`, `result`, `input`, `formValues`, `submit` (Effect), `reset` (Effect) | action services                                                      |
| `Component.state(definition, opts?)`   | `Component.StateHandle`: `model` view, `send.<Tag>`, `committed`, `failures`, `dispatch` (Effect), `clearFailures`   | state services                                                       |
| `Component.stream(name, stream, init)` | read-only `Accessor<A>` of the latest element, committed as `<Component>.<name>`                                     | stream services                                                      |
| `Component.callback(name, f)`          | `(...args) => void` that runs non-state Effect work `f(...args)` as the transition `<Component>.<name>`              | callback services                                                    |
| `Component.router(routes, options?)`   | the instance's `BrowserRouter<Routes>`                                                                               | route preload and route Component services, route Component failures |
| `LiveQuery.bind(query, opts?)`         | `LiveQuery.Handle`: `rows`, `waiting`, `failure`, `preload` (Effect), `refresh` (Effect)                             | source load errors to `E`, source services                           |

Handles share one vocabulary. Status is `waiting()` (work in flight) and
`failure()` (the settled `Cause` of the latest load or submission, if it
failed) on every Resource, Action, and live-query handle (a State handle
reports `failures()` instead); a Resource reader takes the input:
`waiting(input)` / `failure(input)`. Content renders through the reader
(`reader(input)`) or `rows()`. Members that run work (`submit`, `dispatch`,
`reset`, `preload`, `refresh`) return Effects; event handlers run them through
`Component.callback`, and send State messages with `send.<Tag>`. An Action's `result()` keeps the full `AsyncResult`,
latest value included. Pure synchronous state writes such as `clearFailures()`
stay synchronous.

Every binding runs with the setup's context: Effects it starts see the
runtime's services and `Component.provide` Layers. `Component.instance` is the
expert seam for writing more bindings (it is how `LiveQuery.bind`, from the
separate `@sunfall/arc-solid/live-query` entry, is
built): it returns the instance's runtime (bound to the setup context), owner,
and Scope, with `run(f)` (Solid primitives under the instance owner),
`fork(effect)` (fibers in the instance Scope), and `fail(cause)` (throws a
render-time read failure to `<Errored>` the way a reader does).

### Resources: the reader is the only way to render content

`Component.resource(family)` returns a reader. `reader(input)` is the only way
to get a Resource value into JSX:

- The first load suspends the nearest `<Loading>` (a route preload or SSR
  hydration makes it synchronous, so hydrated pages render with no fallback
  flash and no refresh).
- Afterwards the reader keeps returning the current value, or the stale value
  after a failed refresh. `<Loading>` shows its fallback only until the first
  value, so **content stays mounted across refreshes**: inputs keep their text,
  focus and scroll stay put, and States or Actions in the subtree keep
  running.
- A failed first load throws to the nearest `<Errored>`; `catchTags` matches
  the family's render failure by `_tag` (`catchAll` handles every typed
  failure). That failure is the type of the family's `error` schema
  (`Resource.define({ ..., error: ProjectNotFound })`, which `load` must fail
  within), or `ResourceUntypedFailure` (the failure's `tag` only) for a family
  without one, on the server, on the client, and after hydration alike. A load
  callback that throws synchronously is a defect: it is re-caused as `Die` and
  never matched by a typed handler.

Status chrome reads value-free accessors, so nothing renders content from a
status: `reader.waiting(input)` (a load or refresh is in flight) and
`reader.failure(input)` (the settled failure `Cause`, with typed failures as the
family renders them, for an inline error beside the stale content).

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

**A refresh never disturbs what didn't change.** Every new value of an entry
(a refresh, an invalidation, the refetch after hydration, an optimistic patch,
its fold or rollback, a `rows.changes` batch) is structurally shared with the
value it replaces, in the Resource Store itself: a part deep-equal to its
previous version is the previous object, and an entirely equal value is the
previous value (`Resource.read` hands Effect code the same object). Plain
objects and arrays are compared field by field; Dates, Maps, Sets, and Schema
or Data classes are kept when they have the same prototype and are `Equal`.
The reader then hands render code a fine-grained view of that value, the same
read-only projection `Component.state` uses: a binding re-runs only when the
field it read changes, and objects keep their view identity, keyed by the
family's `rows.key` (or `"id"`). The view reaches into plain objects and
arrays; a class instance (a Date, a Schema class) is one value, re-notified
only when a refresh replaces it with one that is not `Equal`. Timeline travel shows those same values, so
a jump re-runs only the bindings whose fields differ.

```tsx
// Typing into this input survives any refresh that leaves `name` alone,
// including one that changes a sibling field such as `updatedAt`.
<input name="name" value={props.project.name} />
```

So bind fields directly; no `createMemo` around a field is needed to protect
it from refreshes. Keyed lists (`<For each={rows()} keyed={(row) => row.id}>`)
keep their rows mounted across reloads, inserts, and reorders, and
`reader.get(input, key)` and `reader.index(input, name, value)` return the
same view rows `reader(input)` renders. The view is read-only: change server
data with an Action.

### Actions: one binding, local or remote

`Component.action(definition)` binds an Action to the instance. `submit(input)`
returns the submission Effect, failing with the Action's errors (it composes
into State commands and workflows); an event handler runs it through
`Component.callback`, which requires those failures to be handled (usually
`Effect.ignore`, since `failure()` still shows them). `waiting()` is true while
a submission is in flight and `failure()` holds the latest settled failure's
`Cause`. `result()` is the full `AsyncResult`: `Initial` while idle, `waiting`
while a submission is in flight, then `Success` or `Failure` (full `Cause`,
latest success kept as `previousSuccess`). `reset()` is an Effect too.
Unmounting interrupts in-flight submissions. `formValues()` is the fields of a
no-JavaScript form post the server rendered the page again for (a validation
failure or failure, which `result()` then holds); render them as the inputs'
values so the form keeps what was typed. It is `undefined` otherwise.

Actions are the one way to change server data, including rows the screen must
show before the server answers. `optimistic` patches States (`transaction.set(state, update)` on a
`State.Ref`), Resource entries, and Resource rows through its transaction before the write runs; success folds the
patches in (a patched value stays until the `invalidates` reload replaces it),
and a failure or interruption rolls them back. A patched Resource entry reads
through `Component.resource` like any other value: the reader returns the
patched value and `waiting`/`failure` keep the entry's own status, so the
patch never suspends or flashes a fallback, and a refresh in flight keeps it
on top:

```ts
const RenameProject = Action.define({
  name: "Projects.rename",
  input: RenameInput,
  output: Project,
  optimistic: (input, transaction) =>
    Effect.all([
      transaction.update(ProjectsRef, input.id, { name: input.name }),
      transaction.set(ProjectById(input.id), (project) => ({ ...project, name: input.name })),
    ]),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});
```

`RenameProject` has no `run`: it is a served Action, and the server runs its
`Action.implement`. Whether a submission runs locally or on the server is the
runtime's decision, not the UI's: Core's `ActionTransport` service is looked
up on every submission. In a Start app, `App.launch(app)` provides one that
submits every served Action over the network, and their responses (hydrated
Resources, Resource invalidations) apply to the submitting runtime. An Action
with `run` runs it locally. The handle, its result type, and its error
type (the Action's own errors plus `Action.ClientError`) are the same either
way. Without JavaScript, `StartAction.form(definition, ...)` renders the same
Action as a `<form method="post">` with no `action`: it posts to its page, and
a validation failure or failure renders that page again with the handle
starting from the posted submission (`result()` and `formValues()`).

### States: client state

A State is the one writable client state. `Component.state(Definition)` starts
one State per instance (stopped on unmount) and returns its handle: `model()`
reads it, and `send` has one DOM-ready sender per message tag:

<!-- prettier-ignore -->
```tsx
const MenuModel = Model({ Closed: {}, Open: {} });
const MenuMessage = Message({ ClickedMenu: {} });
const MenuState = State.define({
  name: "Menu",
  machine: Machine.make({ state: MenuModel, event: MenuMessage, initial: MenuModel.Closed })
    .on(MenuModel.Closed, MenuMessage.ClickedMenu, () => MenuModel.Open)
    .on(MenuModel.Open, MenuMessage.ClickedMenu, () => MenuModel.Closed),
});

const Menu = Component.define("Menu", function* () {
  const menu = yield* Component.state(MenuState);
  return () => <button aria-expanded={menu.model()._tag === "Open"} onClick={menu.send.ClickedMenu}>Menu</button>;
});
```

- **`send.<Tag>` is DOM-ready.** It queues the message within the event (it
  forks like `Component.callback`) and the State's machine processes it; a
  failure lands in `failures()`. A message without fields takes no argument
  and ignores one it is given, so `onClick={menu.send.ClickedMenu}` needs no
  wrapper; a message with fields takes them: `search.send.TypedQuery({ query })`.
- **Tags are PascalCase**, Effect's `_tag` convention: the tag is spelled the
  same in `Message({...})`, `send.ClickedMenu`, `dispatch(MenuMessage.ClickedMenu)`,
  and the Timeline (`State "Menu" ClickedMenu`), with no second spelling to
  map.
- **`dispatch(message)`** is the Effect form, completing once the machine has
  processed the message (applied, or ignored because the current variant does
  not handle it), for Effect code that must wait for it. `can.<Tag>(...)`
  (`menu.can.ClickedMenu()`) reactively says whether it would change the
  State now.
- **Keying gives a fresh State.** Each instance owns its State, so a
  Component keyed on an entity (`<Show when={project.id} keyed>`) gets a
  fresh State per entity and needs no prop-sync message.
- **`scope: "app"` shares one State.** A State the shell renders and the
  pages update (an undo toast) declares `scope: "app"`; every
  `Component.state(UndoToast)` binding then returns a handle on the runtime's
  one instance. The first binding starts it with its services (minus its own
  Scope, so its work outlives it), unmounting a binder never stops it, and
  disposing the runtime does. A server render's request runtime has its own,
  so requests never share one; the browser starts from the server's model
  when it moved away from `initial`.

<!-- prettier-ignore -->
```tsx
const UndoToast = State.define({
  name: "Shell.undoToast",
  scope: "app",
  machine: Machine.make({ state: ToastModel, event: ToastMessage, initial: ToastModel.Hidden })
    .reenter([ToastModel.Hidden, ToastModel.Showing], ToastMessage.DeletedIssue, ({ event }) => ToastModel.Showing({ issue: event.issue }))
    .on(ToastModel.Showing, ToastMessage.ClickedDismiss, () => ToastModel.Hidden)
    .on(ToastModel.Showing, ToastMessage.ToastExpired, () => ToastModel.Hidden)
    .timeout(ToastModel.Showing, { duration: "8 seconds", event: ToastMessage.ToastExpired }),
});

// The board: `toast.send.DeletedIssue({ issue })`; the shell renders the `Showing` variant.
const toast = yield* Component.state(UndoToast);
```

The model is reconciled into a fine-grained read-only
Solid projection owned by the instance, so Solid readers do not all re-run
whenever any part of it changes:

<!-- prettier-ignore -->
```tsx
const board = yield* Component.state(Board);

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
  `Component.state(Definition, { key })` with another property name, a key
  function of each plain object, or `null` to match by position. Items without
  the key fall back to position, and an object whose key changes is a new
  entity.
- **Plain data is deep; everything else is a leaf.** Plain objects and arrays
  reconcile field by field. `Date`, `Map`, `Set`, frozen objects, and other
  values Solid stores do not wrap are leaves replaced by reference.
- **The view is read-only and deeply typed as such.**
  `Component.StateView<Model>` makes every object and array `readonly`
  (`Map`/`Set` become `ReadonlyMap`/`ReadonlySet`). Change the model by
  sending messages.
- **Updates land with Solid's flush.** Arc commits are transactional, and the
  view catches up atomically at Solid's next flush like every Arc signal
  rendered in Solid. Effect-side code reads `handle.committed`, the plain
  committed model and the source of truth (`Signal.peek(...)`,
  `Signal.changes(...)`).
- **Server rendering** uses Solid's server projection: it renders the model as
  of setup, with no reactivity, and hydrates like any other synchronous
  projection.

Because setup runs per instance, a State defined in setup can close over the
instance's other bindings: a form State whose `Saving` variant owns a task that submits
`rename.submit(...)` gets its own Action and State per mounted form.

None of this is needed to test the logic. A State's transitions are tested
with `Machine.replay(definition.machine, messages)` and an
Action's `optimistic` patch with `Action.planOptimistic(definition, input)`:
no Solid root, DOM, runtime, or timers (see
[Testing](golden-path.md#testing)).

### Streams and callbacks: named transitions

`Component.callback(name, f)` is for Effect work that is not a State change:
submitting an Action, invalidating a Resource, travelling a Timeline. It turns
an Effect-returning function into a plain DOM event handler; each call forks
the Effect in the instance Scope with the setup context, starting it right
away so synchronous work lands within the event, and runs it as the **named
transition** `<Component>.<name>`. The Actions, Resources, and States it
touches commit under their own causes (`Action "Projects.rename" submit`,
`State "Board" Relabel`). Callbacks must handle their own failures
(`E = never`): an event handler has nowhere to report a typed failure, so the
type makes you decide.

`Component.stream(name, stream, initial)` runs a `Stream<A, never, R>` for the
instance and returns its latest element as a read-only accessor; each element
commits as `<Component>.<name>`. It is a read of an external source, like a
Resource, not client state, so nothing can write it. It stays separate from
State subscriptions on purpose: a State re-derives its subscriptions from each
new model, so mirroring a stream through one would restart the source on
every element.

<!-- prettier-ignore -->
```tsx
const presence = yield* Component.stream("presence", presenceStream, initialPresence);
const move =
  yield* Component.callback("move", (id: WorkItemId, status: WorkItemStatus) =>
  moveWorkItem.submit({ id, status }).pipe(Effect.ignore),
  );
```

There is no unnamed state change to guard against: public Signals are
read-only, so every change is a State message, an Action, or a framework event.
A Solid `createEffect` that only mirrors state into other state is a
`Signal.derive`.

### Rows and live queries

A Resource with `rows` gives its reader `get(input, key)` and
`index(input, name, value)`; both suspend and follow reloads like
`reader(input)`. When it declares `rows.changes`, the reader also has
`feed(input)`, the feed's `Resource.FeedStatus` (`Idle`, `Following`,
`Retrying`, `Stopped`), which never suspends or loads: status chrome reads it
to say live updates are paused. Actions patch the rows with
`transaction.insert/update/delete(ref, key, ...)`. `LiveQuery.bind(query)`
binds a live query over the rows of Resources (`Query` from `@sunfall/arc-db`):
its factory runs tracked, so a signal or prop it reads (`props.projectId`)
rebuilds the query, and its sources preload on mount in the browser only (a
hydrating binding waits for the hydration pass to settle). A source that never
loaded throws its failed load to `<Errored>`. See [Rows and Queries](db.md).

## Boundaries And Provision

- `Component.catchTags(handlers)`: a Solid `<Errored>` matched by the typed
  failure's `_tag` (a failed Resource read matches by its render failure); only
  tags in `E` are accepted, each handler receives exactly that member of `E` plus
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
  services. Start's `createRequestHandler` uses it to render the app root.

There is no runtime context and no default runtime: every tree gets its runtime
from one of these entry points, and every binding reads it from its instance.

### Server rendering and hydration

A Start app wires both sides from one definition; Start calls `embed` and
`launch` for it:

```tsx
export const app = App.define({ root: Root, routes, client: AppLive });

// server: renders `Root` with `Component.embed` under each request runtime,
// and serves the served Resources' loads and Actions
export const handleRequest = createRequestHandler(app, { server: AppServerLive, implementations });

// browser: restores the Resource snapshot, then hydrates the same tree
Effect.runFork(App.launch(app));
```

`launch` and `embed` render the same tree, so server markup is reused. Each
request runtime runs setup for its own instances (and builds provided Layers
once); request runtime disposal releases them. Route-preloaded and hydrated
Resources read synchronously on both sides, so there is no `<Loading>` flash
and no refresh. An asynchronous setup renders the nearest `<Loading>` fallback
under `renderToString`.

A failure caught by an `<Errored>` during the server render is serialized into
the page by Solid, so the adapter throws only a safe wire value there: a failed
Resource read encoded with its family's `error` schema (or just its `_tag`
without one), and nothing at all for setup failures and defects. `catchTags`
and `catchAll` decode the typed failure from that value on both sides, so the
hydrating client renders the same fallback (with a real `ProjectNotFound`
instance) without re-running the read. Setup failures are opaque on the server
and no handler matches them there; keep data that can fail during SSR behind a
Resource with an `error` schema.

## Routing

`Component.router(routes, options?)` creates the instance's browser router with
the setup's runtime and context; render it with `<RouterProvider router>` and
place its outlet with `<RouterOutlet router={router}>`. `RouterLink` and
`useRouter()` work anywhere below the provider (and inside the outlet's route
views). The routes' preload services and route Components' services and
failures join the component that creates the router, so `launch` checks them:

```tsx
const routes = [
  Route.withComponent(HomeRoute, HomeView), // a plain Solid component
  // A feature Component: the mapper turns route props into its props.
  Route.withComponent(ProjectRoute, ProjectPage, ({ params }) => ({ id: params.id })),
] as const;

const App = Component.define("App", function* (props: { readonly initialHref?: string }) {
  const router = yield* Component.router(routes, { initialHref: props.initialHref });
  const Nav = yield* AppNav;
  return () => (
    <RouterProvider router={router}>
      <Nav />
      <RouterOutlet router={router} notFound={() => <NotFound />} />
    </RouterProvider>
  );
});
```

Route components may be plain Solid functions or typed `Component`s; a
`Component` route view renders with the router's setup context.
`Route.withComponent` is the only way to attach one; pass
`Route.lazyComponent(importer)` to load it as its own chunk (in a Start app,
a sibling `<route>.component.tsx` file route gets this generated); the
router's service and failure check still sees its type. Links may name the route or the
`withComponent` copy: routes compare by path. Without a
mapper the component takes `Route.Props<typeof route>` (`params`, `search`,
`match`); with one, `Route.withComponent(route, component, (route) => props)`
checks the mapped props against the component's props. Router options are
`initialHref` (SSR), `history` (a custom history Adapter, e.g. static sites),
and `hydrating`; each accepts `undefined` as "absent", so optional props pass
straight through. `<RouterProvider router>` without children renders
`<RouterOutlet router={router} />`.

### Same-page navigation

A navigation to the page the outlet already shows (the same route and params,
a new search: a list's `?q=` or `?page=`) keeps the route component's
instance. The outlet keeps the page on screen while the route preloads, then
updates its `search` props (and anything a `withComponent` mapper derives
from them) in place, so the page's States, a focused search box, and its DOM
survive. Read `props.search` in tracked code. A different route or different
params mounts a fresh instance; key a child on an entity for a fresh State
per entity.

### Route preload verdicts

A route preload can end with `Route.notFound()` (the record does not exist:
the outlet renders `notFound`, the server answers 404) or
`Route.redirect(href)` (the router navigates to `href`, the server answers a
redirect). Neither reaches the `failure` view; see
[Architecture](architecture.md#router-runtime).

### Route failure views

`RouterOutlet`'s `pending`, `failure`, and `notFound` renderers are typed from
its `router`, so no type arguments are needed. `failure` receives the router's
`Failure` state, including `Cause<BrowserRouterError<Routes> | ER>`. A route's
preload failure arrives as `RoutePreloadError<E>`: `E` is the route's `error`
schema type, or `RoutePreloadUntypedFailure` (carrying only the failure's
`tag`) for a route that can fail without one. Every case has a `_tag`, so the
view narrows with a `switch` or a comparison instead of `instanceof`:

```tsx
<RouterOutlet
  router={router}
  failure={({ error }) =>
    error?._tag === "RoutePreloadError" && error.cause._tag === "ProjectNotFound" ? (
      <p>Project "{error.cause.id}" was not found.</p>
    ) : (
      <p>Something went wrong.</p>
    )
  }
/>
```

When Start renders a route preload failure, the server and the hydrating client
render this view from the same failure, decoded from the wire with the route's
`error` schema (tag-only `RoutePreloadUntypedFailure` without one), so
hydration reuses the server markup.

## Async State Is `AsyncResult`

Resource and live-query load state and Action submission state
are Effect's `AsyncResult` (`import { AsyncResult } from "effect/reactivity"`);
handles project it to `waiting()` and `failure()`, and an Action handle's
`result()` exposes it whole:
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
computation that reads an Arc signal, including `Component.state(...)`
models, Resource reads, and Action state, at the travelled commit. Effects keep
running against the live head, so the UI can be inspected in the past while the
app keeps working; `resume()` returns the DOM to the head.

<!-- prettier-ignore -->
```ts
const recording = yield* Timeline.record();
yield* counter.dispatch({ _tag: "Increment" });
yield* counter.dispatch({ _tag: "Increment" });

const [first] = Signal.peek(recording.entries);
yield* recording.travel(first!.sequence);
flush();
expect(container.textContent).toBe("1"); // the DOM shows the first commit

yield* recording.resume();
flush();
expect(container.textContent).toBe("2");
```

`recording.entries` and `recording.position` are Arc signals, so a debug panel
renders them like any other state. Every entry's `cause` names the transition
that made it (`Timeline.describe(entry.cause)` reads `ProjectPage.rename`,
`State "Counter" Increment`, ...), so a test can assert the message
log as well as the DOM. Run `Timeline.record(...)` in the Scope that owns the
debugging session (a test, or a devtools mount); closing it uninstalls the
recorder.

## Package And Test Shape

Starters and examples compile Solid components through the `@sunfall/arc-tsrx`
Vite preset. Workspace tests run Solid adapter tests in a browser-build Vitest
project and the remaining package and example tests through the SSR build.
