# Solid Adapter

Sunfall Arc keeps Resources, Actions, Programs, Routes, Collections, and runtime
ownership in renderer-independent core packages. The Solid 2 adapter bridges
that core model into Solid's fine-grained reactivity and ownership rules.

Use `@sunfall/arc-solid` with `@sunfall/arc-solid-db` for Solid apps.

## Surface

The adapter exposes the golden-path concepts:

- typed `Component` definitions (services and render failures through `yield*`);
- runtime providers and component scopes;
- Signal and Stream subscriptions;
- Resource reads, preload, refresh, and Suspense reads;
- Action submission handles;
- Program handles with a fine-grained model view, failures, timeline, and
  dispatch APIs;
- browser router providers, outlets, links, typed navigation helpers, and route
  preload integration;
- collection and live-query handles through `@sunfall/arc-solid-db`.

## Solid Accessors

Solid hooks expose accessor-shaped values where the renderer expects fine-grain
reactive reads.

```tsx
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Show } from "solid-js";

const project = useResource(() => ProjectById(props.id));
// Current or stale value: the view mounts once and refreshes update it in place.
const current = () => Option.getOrUndefined(AsyncResult.value(project.result()));

return (
  <Show
    when={current()}
    fallback={AsyncResult.builder(project.result())
      .onFailure((cause) => <ProjectError cause={cause} />)
      .orElse(() => (
        <ProjectSkeleton />
      ))}
  >
    {(value) => <ProjectView project={value()} refreshing={project.result().waiting} />}
  </Show>
);
```

### Async state is `AsyncResult`

Every async handle exposes one `result()` accessor holding Effect's
`AsyncResult` (`import { AsyncResult } from "effect/reactivity"`), plus its
Effect-returning methods:

- `useResource(ref)` → `{ ref, result, preloadFailure, refreshEffect, prefetchEffect }`.
  `useResourceResult(ref)` returns just the `result` accessor.
- `useAction(definition)` → `{ result, input, invalidationPlan, submitEffect, resetEffect, reset, instance, definition }`.
  `result()` is `Initial` while idle; `input()` is the latest submission input as an `Option`.
- `useCollection(collection)` → `rows`, `result` (`AsyncResult<void, E>`), lookups, and Effects.
- `useLiveQuery(query)` → `data` (always the last good rows) and `result`
  (`AsyncResult<ReadonlyArray<T>, E>`).

`AsyncResult` answers the common rendering questions directly:
`AsyncResult.value(result)` (current or stale value), `AsyncResult.error(result)`
(typed error), `result.waiting` (load or submission in flight), and
`result._tag`. Loads mark the current result `waiting` instead of switching to a
separate pending tag, so a refresh shows `Success` with `waiting: true` and a
retry after a failure shows `Failure` with `waiting: true`. A `Failure` carries
the full `Cause` (typed errors and defects) and keeps the latest success as
`previousSuccess`. An interrupted load or submission returns to its prior
settled result.

Status UI renders well with `AsyncResult.builder(...)` (exhaustive over
`Initial`, `Success`, each error `_tag`, defects, and interrupts, or coarser
with `onFailure`), `AsyncResult.match(...)`, `AsyncResult.matchWithWaiting(...)`,
or the builder's `.render()` / `.orElse(...)`. Content needs the shape below.

> **Builder ordering gotcha:** `onSuccess` narrows the success type to `never`
> for the branches that follow it, so `failed.previousSuccess` is only typed as
> your value when `onFailure` comes **before** `onSuccess`.

### Keep content mounted across refreshes

A builder or `match` returns new JSX for every result transition, and a refresh
is two transitions (`Success` → `Success` with `waiting` → `Success`). Content
rendered inside a branch is disposed and rebuilt on every refresh: inputs lose
their text, focus and scroll reset, and Programs or Actions owned by that
subtree are disposed mid-flight (a rename whose invalidation refetches the
page's Resource is torn down before it can follow its redirect). So:

- **Render content from the value, not from the transition.** Gate it on having
  a value with a non-keyed `<Show when={current()}>` over
  `AsyncResult.value(result)` (current or stale), as above, or read it with
  `useResourceSuspense` inside `<Loading>` / `<Errored>`. Either way the
  subtree mounts once and new values flow in through props.
- **Drive status chrome separately** from `result()`: `result().waiting` for a
  refreshing class or label, `AsyncResult.cause(result)` (or a settled
  `Failure`) for an inline error beside the stale content, and the `<Show>`
  fallback for the first load or a failure with nothing to show.
- **Key lists by identity.** A refetch hands back new row objects, so use
  `<For each={rows()} keyed={(row) => row.id}>` to keep rows mounted.
- **Read props reactively** in content components (Solid's usual rule): the
  same instance sees each refreshed value.
- **Builders are fine for leaf status UI**: a skeleton, an error line, a
  "Saving" label, where rebuilding costs nothing and exhaustiveness helps.
  Keep stateful subtrees out of their branches.

`preloadFailure()` reports failures of the automatic mount-time preload,
including runtime (`ER`) failures that never reach the Resource Store; load
failures also settle into `result()`.

`useResourceSuspense(ref)` reads the value directly: pending reads suspend the
nearest `<Loading>` (which shows its fallback only until the first value, so
its content stays mounted across refreshes), and a settled `Failure` throws
`ResourceFailure` whose
`result` is the `AsyncResult.Failure` (typed error via
`AsyncResult.error(failure.result)`).

Program and DB handles follow the same shape:

```tsx
const counter = useProgram(CounterProgram);
const projects = useCollection(ProjectCollection);

counter.model();
projects.rows();
```

### Program models are fine-grained

A Program keeps one immutable model, but Solid readers should not all re-run
whenever any part of it changes. `useProgram(...)` reconciles every committed
model into a read-only Solid projection owned by the component, and
`model()` returns that view:

```tsx
const board = useProgram(BoardProgram);

<h1>{board.model().title}</h1>
<For each={board.model().items}>{(item) => <Row label={item.label} done={item.done} />}</For>
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
  to `"id"`, Solid's projection default; pass `useProgram(Program, { key })` with
  another property name, a key function of each plain object, or `null` to
  match by position. Items without the key fall back to position, and an
  object whose key changes is a new entity.
- **Plain data is deep; everything else is a leaf.** Plain objects and arrays
  reconcile field by field. `Date`, `Map`, `Set`, frozen objects, and other
  values Solid stores do not wrap are leaves replaced by reference, so a reader
  re-runs when the model holds a new instance. Primitive, nullable, and union
  models work the same way: `model()` is the value.
- **The view is read-only and deeply typed as such.** `ProgramModelView<Model>`
  makes every object and array `readonly` (`Map`/`Set` become
  `ReadonlyMap`/`ReadonlySet`). Change the model by dispatching messages.
- **Updates land with Solid's flush.** Arc commits are transactional, and the
  projection catches up atomically at Solid's next flush like every Arc signal
  rendered in Solid. Effect-side code reads `program.instance.model`, the
  plain committed model and the source of truth (`Signal.peek(...)`,
  `Signal.changes(...)`).
- **Server rendering** uses Solid's server projection: it renders the model as
  of component setup, with no reactivity, and hydrates like any other
  synchronous projection.

## Components

`Component` carries services (`R`) and typed render failures (`E`) through
component definitions, because JSX erases both. Setup is a generator that
`yield*`s services, resources, and child components; it returns the render
function.

```tsx
const ProjectCard = Component.make("ProjectCard", function* () {
  const project = yield* Component.resource(ProjectById);
  return (props: { readonly id: ProjectId }) => <article>{project(props.id).name}</article>;
});

const App = Component.make("App", function* () {
  const Card = yield* ProjectCard.pipe(
    Component.catchTags({ ProjectNotFound: (error) => <p>No project {error.id}</p> }),
    Component.loading(() => <p>Loading</p>),
  );
  return () => <Card id={selected()} />;
});

// The app entry point: mounted until the fiber is interrupted.
Effect.runFork(Component.launch(App.pipe(Component.provide(AppLive)), root));
```

- `Component.make(name, setup)`: setup runs **once per Arc runtime**; the
  returned render runs **per instance** under a Solid owner. Put services,
  resource bindings, and Layers in setup; put per-instance state in render.
- `Component.resource(family)`: setup-time binding; the family's typed load
  error joins `E`, the load's services join `R`. The reader suspends the
  nearest `<Loading>` and throws `ResourceFailure` to the nearest `<Errored>`.
  A load callback that throws synchronously (`EffectInputCallbackError`) is a
  defect: it is re-caused as `Die`, needs no handler, and reaches outer
  boundaries untyped. Preloaded or hydrated values read synchronously.
  Readers share one binding per ref per runtime; releasing the last reader
  defers disposal to a microtask, so recomputes and suspended reads that
  re-run in the same flush keep the binding.
- `Component.catchTags(handlers)`: Solid `<Errored>` matched by `_tag` (a
  `ResourceFailure` matches by the `_tag` of `AsyncResult.error(failure.result)`);
  only tags in `E` are accepted and handled tags leave `E`. Unmatched failures,
  including defects, reach outer boundaries.
- `Component.loading(fallback)`: Solid `<Loading>`; type-neutral.
- `Component.provide(layer)`: built once per runtime in the setup Scope; removes
  provided services from `R`, adds Layer failures to `E`.
- `Component.launch(component, container, options?)`: **the app entry point**.
  Requires every typed failure handled (`E = never`) and every service
  provided, either by `Component.provide` or by the host runtime passed as
  `{ runtime }` (a `SunfallArcRuntime<RS, ER>` satisfies `RS`; an erased runtime
  satisfies nothing). It is an `Effect<never, ER>` that keeps the
  tree mounted until interrupted (like `Layer.launch`), then disposes it and any
  runtime it owns. Run it with `Effect.runFork`.
- `Component.mount(component, container, options?)`: the composable primitive
  under `launch`: a scoped acquisition (`Effect<void, ER, Scope>`) that disposes
  the tree (and an owned runtime) when its Scope closes. A failed mount
  (runtime startup, interruption, or a throwing render) releases what it
  acquired immediately. Use it inside larger scoped programs and tests.
- `Component.embed(component)`: the same fully provided component as a plain
  Solid component for an existing `RuntimeProvider` tree, sharing the
  per-runtime setup.

### Server rendering and hydration

Setup is memoized per runtime, so a Start request runtime runs setup (and
builds provided Layers) once per request; request runtime disposal closes the
setup Scope. Render with `embed` inside the request runtime; reads of
route-preloaded Resources are synchronous. An asynchronous setup renders the
nearest `<Loading>` fallback under `renderToString`.

```tsx
// server render (Start request runtime)
const AppRoot = Component.embed(App);
renderToString(() => (
  <RuntimeProvider runtime={runtime}>
    <AppRoot />
  </RuntimeProvider>
));

// client entry: restore the Resource snapshot, then hydrate the same tree
hydrateFromDocument(document, undefined, { runtime });
Effect.runFork(Component.launch(App, root, { runtime, hydrate: true }));
```

`hydrate: true` uses Solid's `hydrate` and renders the exact tree `embed`
renders, so server markup is reused; client setup runs once, and hydrated
Resources read synchronously (no `<Loading>` flash, no refetch).

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

## Package And Test Shape

Starters and examples compile Solid components through the `@sunfall/arc-tsrx`
Vite preset. Workspace tests run Solid adapter tests in a browser-build Vitest
project and the remaining package and example tests through the SSR build.
