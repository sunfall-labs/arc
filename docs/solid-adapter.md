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
const project = useResource(ProjectById("atlas"));

return project.match({
  initial: () => <p>Loading</p>,
  pending: (previous) => <p>{previous?.name ?? "Loading"}</p>,
  success: (value) => <h1>{value.name}</h1>,
  failure: (error) => <p>{String(error)}</p>,
});
```

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
  `ResourceFailure`'s inner `error._tag`); only tags in `E` are accepted and
  handled tags leave `E`. Unmatched failures reach outer boundaries.
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
