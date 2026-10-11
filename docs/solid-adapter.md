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
- Program handles with model, failures, timeline, and dispatch APIs;
- browser router providers, outlets, links, typed navigation helpers, and route
  preload integration;
- collection and live-query handles through `@sunfall/arc-solid-db`.

## Solid Accessors

Solid hooks expose accessor-shaped values where the renderer expects fine-grain
reactive reads.

```tsx
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";

const project = useResource(ProjectById("atlas"));

return () =>
  AsyncResult.builder(project.result())
    .onInitial(() => <p>Loading</p>)
    // Handle failure before success when you need `previousSuccess`.
    .onFailure((_cause, failed) =>
      Option.match(failed.previousSuccess, {
        onNone: () => <p>Could not load</p>,
        onSome: (stale) => <ProjectView project={stale.value} stale />,
      }),
    )
    .onSuccess((value, success) => <ProjectView project={value} refreshing={success.waiting} />)
    .exhaustive();
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

Render with `AsyncResult.builder(...)` (exhaustive over `Initial`, `Success`,
each error `_tag`, defects, and interrupts, or coarser with `onFailure`),
`AsyncResult.match(...)`, `AsyncResult.matchWithWaiting(...)`, or the builder's
`.render()` (returns `null` for unhandled cases).

> **Builder ordering gotcha:** `onSuccess` narrows the success type to `never`
> for the branches that follow it, so `failed.previousSuccess` is only typed as
> your value when `onFailure` comes **before** `onSuccess`.

`preloadFailure()` reports failures of the automatic mount-time preload,
including runtime (`ER`) failures that never reach the Resource Store; load
failures also settle into `result()`.

`useResourceSuspense(ref)` reads the value directly: pending reads suspend the
nearest `<Loading>`, and a settled `Failure` throws `ResourceFailure` whose
`result` is the `AsyncResult.Failure` (typed error via
`AsyncResult.error(failure.result)`).

Program and DB handles follow the same shape:

```tsx
const counter = useProgram(CounterProgram);
const projects = useCollection(ProjectCollection);

counter.model();
projects.rows();
```

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
    Component.catchTags({
      ProjectNotFound: (error) => <p>No project {error.id}</p>,
      EffectInputCallbackError: () => <p>Could not load</p>,
    }),
    Component.loading(() => <p>Loading</p>),
  );
  return () => <Card id={selected()} />;
});

Component.mount(App.pipe(Component.provide(AppLive)), root).pipe(
  Effect.andThen(Effect.never),
  Effect.scoped,
  Effect.runFork,
);
```

- `Component.make(name, setup)`: setup runs **once per Arc runtime**; the
  returned render runs **per instance** under a Solid owner. Put services,
  resource bindings, and Layers in setup; put per-instance state in render.
- `Component.resource(family)`: setup-time binding; the load error joins `E`,
  the load's services join `R`. The reader suspends the nearest `<Loading>`
  and throws `ResourceFailure` to the nearest `<Errored>`.
- `Component.catchTags(handlers)`: Solid `<Errored>` matched by `_tag` (a
  `ResourceFailure` matches by the `_tag` of `AsyncResult.error(failure.result)`);
  only tags in `E` are accepted and handled tags leave `E`. Unmatched failures,
  including defects, reach outer boundaries.
- `Component.loading(fallback)`: Solid `<Loading>`; type-neutral.
- `Component.provide(layer)`: built once per runtime in the setup Scope; removes
  provided services from `R`, adds Layer failures to `E`.
- `Component.mount(component, container, options?)`: requires
  `Component<P, never, never>`; scoped acquisition that disposes the tree (and an
  owned runtime) when its Scope closes.
- `Component.embed(component)`: the same fully provided component as a plain
  Solid component for an existing `RuntimeProvider` tree.

## Package And Test Shape

Starters and examples compile Solid components through the `@sunfall/arc-tsrx`
Vite preset. Workspace tests run Solid adapter tests in a browser-build Vitest
project and the remaining package and example tests through the SSR build.
