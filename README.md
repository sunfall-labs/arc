<p align="center">
  <a href="https://sunfall-labs.github.io/arc/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/arc-banner-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="docs/assets/arc-banner.svg" />
      <img src="docs/assets/arc-banner.svg" alt="Sunfall Arc: a terracotta arc setting into the horizon on warm ivory" width="800" />
    </picture>
  </a>
</p>

<h1 align="center">Sunfall Arc</h1>

<p align="center">
  <strong>Full-stack TypeScript, correct by construction.</strong>
</p>

<p align="center">
  <a href="https://sunfall-labs.github.io/arc/">Website</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/golden-path.md">Golden path</a> ·
  <a href="#packages">Packages</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

Arc is a full-stack framework built on [Effect](https://effect.website) and
[Solid](https://www.solidjs.com). Reads, writes, client state, screens, and
routes are typed, named definitions, so the compiler, your tests, and the
Timeline all see the same app.

| Compile-time confidence                                                                                                                          | Named, durable changes                                                                                                                                 | Effect all the way down                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| A failure that can reach the screen unhandled, or a service no Layer provides, is a type error. The app does not compile until it is dealt with. | Writes are Actions, with optimistic patches and an offline outbox. Every state change has a name (a State message, an Action, a load) on the Timeline. | Services, Layers, Schema, RPC, Workflow, and tracing stay Effect primitives. Arc builds on them rather than wrapping them. |

> [!IMPORTANT]
> **Arc is pre-1.0. The current release is an early public alpha.** APIs can
> still change between alphas; read the [migration notes](docs/migration-notes.md)
> when you upgrade. Arc runs on Solid 2 (release candidate `2.0.0-rc.14`) and Effect
> `4.0.3`; install those exact versions so the app shares one Effect and one
> Solid with the framework.

## Quick start

```sh
pnpm add @sunfall/arc-core @sunfall/arc-solid @sunfall/arc-start \
         effect@4.0.3 solid-js@2.0.0-rc.14 @solidjs/web@2.0.0-rc.14
```

One feature, whole: a Resource and an Action declared once (their schemas are
the contract between browser and server), a Component that must handle the
read's failure, a Route, the app definition both hosts share, and the server
that implements the read and the write over an Effect service. It is compiled
with the framework on every change, so it cannot drift.

`src/app.tsx`:

<!-- snippet: type-tests/readme/app.tsx -->

```tsx
import { Action, Resource, Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { App } from "@sunfall/arc-start";
import { Effect, Schema } from "effect";
import { Loading } from "solid-js";

export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
});
export type Todo = typeof Todo.Type;

export class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
  id: Schema.String,
}) {}

// A Resource: a named, cached, typed read. No `load`: the server loads it,
// and its schemas are the wire contract.
export const TodoById = Resource.define({
  name: "Todos.byId",
  input: Schema.String,
  output: Todo,
  error: TodoNotFound,
});

// An Action: a named write the server runs. The checkbox flips at once; a
// failure rolls it back.
export const ToggleTodo = Action.define({
  name: "Todos.toggle",
  input: Schema.String,
  output: Todo,
  error: TodoNotFound,
  optimistic: (id, transaction) =>
    transaction.set(TodoById(id), (todo) => ({ ...todo, done: !todo.done })),
});

// A Component. Reading TodoById adds TodoNotFound to its type until it is handled.
const TodoPage = Component.define("TodoPage", function* (props: { readonly id: string }) {
  const todo = yield* Component.resource(TodoById);
  const toggle = yield* Component.action(ToggleTodo);
  const flip = yield* Component.callback("flip", () => toggle.submit(props.id).pipe(Effect.ignore));
  return () => (
    <Loading fallback={<p>Loading</p>}>
      <label>
        <input type="checkbox" checked={todo(props.id).done} onChange={() => flip()} />
        {todo(props.id).title}
      </label>
    </Loading>
  );
}).pipe(Component.catchTags({ TodoNotFound: (error) => <p>No todo {error.id}.</p> }));

const TodoRoute = Route.define("/todos/:id", { params: Schema.Struct({ id: Schema.String }) });
const routes = [
  Route.withComponent(TodoRoute, TodoPage, ({ params }) => ({ id: params.id })),
] as const;

const Root = Component.define("Root", function* (props: { readonly href: string }) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  return () => (
    <RouterProvider router={router}>
      <RouterOutlet router={router} />
    </RouterProvider>
  );
});

// One definition for both hosts. Without the catchTags line, this does not compile.
export const app = App.define({ root: Root, routes });
```

The server implements the read and the write, renders the page, and serves
both; the browser hydrates it:

<!-- snippet: type-tests/readme/server.ts -->

```ts
import { Action, Resource } from "@sunfall/arc-core";
import { createRequestHandler } from "@sunfall/arc-start";
import { Context, Effect, Layer } from "effect";
import { app, TodoById, TodoNotFound, ToggleTodo, type Todo } from "./app.js";

// The backend: an Effect service the server Layer provides (a database in a real app).
interface Todos {
  readonly get: (id: string) => Effect.Effect<Todo, TodoNotFound>;
  readonly toggle: (id: string) => Effect.Effect<Todo, TodoNotFound>;
}
const Todos = Context.Service<Todos>("Todos");

const rows = new Map<string, Todo>([["1", { id: "1", title: "Try Arc", done: false }]]);
const find = (id: string): Effect.Effect<Todo, TodoNotFound> => {
  const todo = rows.get(id);
  return todo === undefined ? Effect.fail(new TodoNotFound({ id })) : Effect.succeed(todo);
};
export const TodosMemory = Layer.succeed(Todos, {
  get: find,
  toggle: (id) =>
    find(id).pipe(
      Effect.map((todo) => ({ ...todo, done: !todo.done })),
      Effect.tap((todo) => Effect.sync(() => rows.set(id, todo))),
    ),
});

// What the server runs for the Resource and the Action, checked against their schemas.
export const implementations = [
  Resource.implement(TodoById, (id) => Todos.use((todos) => todos.get(id))),
  Action.implement(ToggleTodo, (id) => Todos.use((todos) => todos.toggle(id))),
];

// Server rendering: runs the route's preload, renders, and sends the hydration
// payload; serves the load and the Action. Without TodosMemory, this does not compile.
export const handleRequest = createRequestHandler(app, { server: TodosMemory, implementations });
```

<!-- snippet: type-tests/readme/main.ts -->

```ts
import { App } from "@sunfall/arc-start";
import { Effect } from "effect";
import { app } from "./app.js";

// The browser: restores the server's data and hydrates its markup.
Effect.runFork(App.launch(app));
```

Delete the `catchTags` line and `App.define` stops compiling; drop
`TodosMemory` and `createRequestHandler` does. The implementations sit in the
server entry, which the browser bundle never includes. For a runnable project with the Vite
plugin, file routes, and a dev server, copy
[`examples/basic-starter`](examples/basic-starter), then read
[The Golden Path](docs/golden-path.md), which builds a fuller feature step by
step.

## Concepts

Seven definitions and your Effect services are the whole vocabulary.

| Concept         | What it is                                                                         | Defined with               |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------- |
| Resource        | A named, cached, typed read; add `rows` for keyed lists with indexes.              | `Resource.define`          |
| Action          | A named write with `optimistic` patches, `invalidates` tags, and `durable` outbox. | `Action.define`            |
| State           | Client state, changed only by its named messages.                                  | `State.define`             |
| Component       | Binds Resources, Actions, and States to the screen; its failures are in its type.  | `Component.define`         |
| Route           | A URL with decoded params, a preload, and a typed failure.                         | `Route.define`             |
| App             | One definition for server rendering and browser hydration.                         | `App.define`               |
| Timeline        | Records every commit by name and travels back to any of them.                      | `Timeline.record`          |
| Effect services | Your backends, provided by a Layer (the server's, for served reads and writes).    | `Context.Service`, `Layer` |

## Packages

| Package                 | What it provides                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@sunfall/arc-core`     | Resources, Actions, States, Routes, the Timeline, Signals, forms, and server contracts.                            |
| `@sunfall/arc-solid`    | `Component`, the router (`RouterProvider`, `RouterOutlet`, `RouterLink`), and Solid bindings for every definition. |
| `@sunfall/arc-start`    | `App`, server rendering, hydration, transports, and the Vite plugin; hosts at `/fetch` and `/node`.                |
| `@sunfall/arc-db`       | Incremental live queries that join and aggregate the rows of Resources.                                            |
| `@sunfall/arc-devtools` | JSON-safe devtools snapshots, summaries, causal graphs, and panels.                                                |
| `@sunfall/arc-tsrx`     | The TSRX and Solid Vite preset used by the starters.                                                               |

All packages are MIT-licensed and published under the `alpha` dist-tag.

## Examples and starters

- [`examples/basic-starter`](examples/basic-starter): the smallest full-stack
  app to copy: one file route, a route-owned Resource preload, SSR, and
  hydration.
- [`examples/project-console`](examples/project-console): the full golden path
  with Resource rows, live queries, forms, and served Resources and Actions.
- [`examples/tracker`](examples/tracker): a team issue tracker on SQLite with
  sessions, a live board, URL-addressable search, and offline moves, with the
  [friction log](examples/tracker/FRICTION.md) building it produced.
- [`examples/docs-site`](examples/docs-site): the
  [website](https://sunfall-labs.github.io/arc/), built with Arc.
- [`examples/devtools-panel`](examples/devtools-panel) and
  [`examples/devtools-extension`](examples/devtools-extension): the devtools
  panel in an app shell and in a browser extension.

## Measured

The same 1,000-row list app, built with Arc, SolidStart, and TanStack Start
and measured in production builds on Node
([methodology, full table, and profiles](docs/benchmarks.md)):

| On the 1,000-row page                   | Arc (first run) |     Arc | SolidStart | TanStack Start |
| --------------------------------------- | --------------: | ------: | ---------: | -------------: |
| JS on first visit (brotli)              |          130 KB |  121 KB |      30 KB |         106 KB |
| First click handled (4x CPU throttle)   |          627 ms |  309 ms |     264 ms |         289 ms |
| Total blocking time (4x CPU throttle)   |          259 ms |   61 ms |       2 ms |           0 ms |
| Server CPU per render                   |         19.6 ms |  5.2 ms |    19.5 ms |         7.8 ms |
| Server CPU, small page (`/items/42`)    |         1.62 ms | 0.51 ms |    0.28 ms |        0.33 ms |
| Toggle a row, settled with revalidation |           61 ms |   25 ms |     131 ms |          35 ms |
| JS heap after load                      |         11.6 MB |  8.0 MB |     6.3 MB |         5.3 MB |

Arc now server-renders the list fastest and settles a mutation fastest. It
still ships the most JavaScript, blocks the main thread longest on load, uses
the most memory, and costs the most server CPU for a small page, each by less
than in the first run. The first run was taken under heavier machine load, so
compare its timings through the ratios; [the benchmark page](docs/benchmarks.md)
has both runs, what changed, and what Arc still pays for.

## Documentation

1. [The Golden Path](docs/golden-path.md): which definition for which job, and
   one feature built end to end. Start here.
2. [Starters](docs/starter.md)
3. [Solid adapter](docs/solid-adapter.md)
4. [Architecture](docs/architecture.md)
5. [Rows and queries](docs/db.md)
6. [Deployment](docs/deployment.md)
7. [Devtools](docs/devtools.md)

Reference: [Effect style guide](docs/effect-style.md) ·
[Invariants](docs/invariants.md) ·
[Public API inventory](docs/public-api-inventory.md) ·
[Migration notes](docs/migration-notes.md) ·
[Comparison](docs/comparison.md) · [Benchmarks](docs/benchmarks.md) ·
[Changelog](CHANGELOG.md)

## Contributing

```sh
pnpm install
pnpm verify
```

`pnpm verify` is the gate for every change: build, format, lint, typecheck
(including the compiled snippets in this README and the docs), tests, audits,
example and starter verifies, and package dry runs.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow and releases.

## License

MIT. See [LICENSE](LICENSE).
