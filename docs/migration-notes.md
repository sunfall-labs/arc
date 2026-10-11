# Migration Notes

These notes map common full-stack app patterns onto the Sunfall Arc golden path.
They are intentionally conservative: migrate one vertical slice at a time and
keep the old path beside the new path until tests prove the behavior.

## From Reducers And Effect Queues

Reducer loops often split model transitions, async work queues, and component
effects across several files. In Sunfall Arc, move that loop into a Program:

- The reducer state becomes `initial`.
- The action union becomes a Program message union, preferably tagged with
  `_tag`.
- The reducer switch becomes `Program.define({ initial, on })` for tagged
  messages, or `Program.update(handlers)` when an existing definition still
  wants an `update(model, message)` callback.
- A handler returns the next model directly, or `Program.next(model, commands)`
  when work should run after the model commits.
- Work that always emits a follow-up message uses `Program.emit(message)` or
  `Program.emit(Effect.tryPromise(...).pipe(Effect.map(...)))`.
- Work that intentionally emits no message uses `Program.effect(...)`; reserve
  lower-level `Program.command(...)` for Effects that may emit a message or may
  complete empty.
- Long-lived external inputs become `Stream` subscriptions attached to the
  Program definition.

The migration is done when models and messages are plain values, Promise work is
wrapped at the Effect edge before a follow-up message is emitted, and
`Program.story(...)` can exercise the transitions without mounting a UI.

## From Solid Hooks To Components

Earlier alphas offered two Solid models: hooks under a `RuntimeProvider`
(`useResource`, `useAction`, `useProgram`, `useStream`, `useRuntimeEffect`,
`useCollection`, `useLiveQuery`) and typed `Component`s. Components are now the
only model:

- A component that called hooks becomes
  `Component.make(name, function* (props) { ...; return () => <View /> })`.
  Setup runs once per instance, like a hook-calling component body.
- `useResource` / `useResourceSuspense` become `yield* Component.resource(Family)`
  and render `reader(input)` under `<Loading>`; status UI reads
  `reader.waiting(input)` / `reader.failure(input)` instead of `result()`.
- `useAction(Definition)` and `StartAction.use(Definition)` become
  `yield* Component.action(Definition)`; a Start client runtime adds
  `makeActionTransportLayer({ actions })` for the Actions the server serves.
- `useProgram`, `useStream`, and `useRuntimeEffect` become `Component.program`,
  `Component.stream`, and `Component.callback`.
- `useCollection` / `useLiveQuery` become `SolidDb.collection` /
  `SolidDb.liveQuery`.
- `<RuntimeProvider runtime>` plus `<RouterProvider routes>` become
  `yield* Component.router(routes)` and `<RouterProvider router={router}>`, and
  the client entry becomes `Effect.runFork(Component.launch(App, root,
{ runtime, hydrate: root.hasChildNodes() }))`; the server renders
  `Component.embed(App, runtime)`.

The migration is done when every service the tree needs is in its root
component's `R`, and `Component.launch` type-checks against the runtime.

## From TanStack Query

TanStack Query usually spreads data behavior across query keys, query functions,
mutation callbacks, and invalidation calls. In Sunfall Arc, move that behavior
behind Resource families and Actions:

- Query keys become `Resource.family({ name, input, load })` refs.
- Query functions become Effect loaders, usually calling a server contract or
  Capability.
- `invalidateQueries(...)` becomes `Resource.invalidateEffect(...)` or an
  Action invalidation plan.
- Mutation callbacks become `Action.define(...)` definitions with retry,
  concurrency, optimistic work, and invalidation metadata attached to the
  definition. UI binds them with Solid's `Component.action(...)`; a Start client
  runtime provides `makeActionTransportLayer(...)` so served Actions submit over
  the network through the same handle, and `StartAction.form(...)` renders them
  as progressive no-JS forms.
- Route loaders call `Resource.prefetchEffect(...)` in `preload` and declare
  `preloadResources` / `preloadCollections`; file routes use
  `defineFileRoute(path)(options)` with exactly the same options as core
  `route(path, options)`.

Keep Promise-returning query functions at the host boundary only. Inside the
framework slice, prefer Effect loaders so retries, services, scopes, tracing,
and interruption stay visible.

## From TanStack Start

TanStack Start route files often combine route definitions, loaders, server
functions, and generated route typing. Sunfall Arc keeps the same copyable route
shape but makes app graph facts explicit:

- File routes use `defineFileRoute(...)` and generated route maps.
- Server functions use `Server.contract(...)`, `Server.implement(...)`, and
  browser-safe contract imports.
- Request handling starts at `createRequestHandler(app)`; Promise
  handlers are host convenience boundaries.
- SSR routes should emit streamed Start hydration through
  `createStartStreamedHtmlResponseEffect(...)`; lower-level
  `createHtmlResponseEffect(...)` and `streamHydrationChunk(...)` remain
  available for custom stream adapters.
- Build diagnostics should run with declared route preload ownership and schema
  metadata before a route leaves the starter stage.

When moving a route, migrate the route path, schemas, Resource preloads, and
server contracts together. A route that compiles but hides preload ownership is
not migrated yet.

## From Remix-Style Forms

Remix-style actions commonly encode validation, redirects, and mutation side
effects in one request function. In Sunfall Arc, split the contract from the UI
transport:

- Form input schemas live on the Action or Start action definition.
- Validation failures return `ActionResult.validation(...)` with typed field and
  form errors.
- Redirects return `ActionResult.redirect(...)`.
- Browser forms use `StartAction.form(...)` for no-JS fallback and hydration
  metadata.
- Client-side submits call the Component's action handle (`submit(input)` from
  a handler, or `submitEffect(input)` inside a Program or workflow).

The migration is done when the same Action definition owns schema validation,
no-JS fallback, optimistic behavior when needed, retry/concurrency policy, and
Resource invalidation.

## From Ad Hoc Service Mocks

Ad hoc mocks usually replace imports directly, which makes SSR, client tests,
and route preloads disagree about the service graph. Sunfall Arc uses
Capabilities and Layers instead:

- Define a `Capability` for each service interface the app owns.
- Provide production behavior through a Layer passed to `defineApp({ server })`
  or `makeRuntime(...)`.
- Provide test behavior through `Server.mock(...)`, Capability test Layers, or
  a runtime created for the test.
- Keep server-only implementations in `.server.ts` modules and prove they stay
  out of browser bundles with a leak scan.

Prefer mocking the interface at the Capability or contract level. Avoid mocking
deep modules that callers should not know exist.
