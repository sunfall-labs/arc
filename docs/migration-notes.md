# Migration Notes

These notes map common full-stack app patterns onto the Effect UI golden path.
They are intentionally conservative: migrate one vertical slice at a time and
keep the old path beside the new path until tests prove the behavior.

## From TanStack Query

TanStack Query usually spreads data behavior across query keys, query functions,
mutation callbacks, and invalidation calls. In Effect UI, move that behavior
behind Resource families and Actions:

- Query keys become `Resource.family({ name, input, load })` refs.
- Query functions become Effect loaders, usually calling a server contract or
  Capability.
- `invalidateQueries(...)` becomes `Resource.invalidateEffect(...)` or an
  Action invalidation plan.
- Mutation callbacks become `Action.define(...)` definitions with retry,
  concurrency, optimistic work, and invalidation metadata attached to the
  definition. Start forms then bind those definitions with `StartAction.use(...)`
  or `startActionForm(...)`.
- Core route loaders can call `Resource.prefetchEffect(...)` and declare
  `preloadResources`; file routes should prefer
  `defineFileRoute(...).preload(...)` so resource selectors, collection preload
  metadata, schemas, and preload Effects are derived from one route-local shape.

Keep Promise-returning query functions at the host boundary only. Inside the
framework slice, prefer Effect loaders so retries, services, scopes, tracing,
and interruption stay visible.

## From TanStack Start

TanStack Start route files often combine route definitions, loaders, server
functions, and generated route typing. Effect UI keeps the same copyable route
shape but makes app graph facts explicit:

- File routes use `defineFileRoute(...)` and generated route maps.
- Server functions use `Server.contract(...)`, `Server.implement(...)`, and
  browser-safe contract imports.
- Request handling starts at `createRequestHandlerEffect(app)`; Promise
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
effects in one request function. In Effect UI, split the contract from the UI
transport:

- Form input schemas live on the Action or Start action definition.
- Validation failures return `ActionResult.validation(...)` with typed field and
  form errors.
- Redirects return `ActionResult.redirect(...)`.
- Browser forms use `startActionForm(...)` for no-JS fallback and hydration
  metadata.
- Client-side submit buttons call `submitEffect(...)`, then fork or run the
  Effect explicitly at the UI boundary.

The migration is done when the same Action definition owns schema validation,
no-JS fallback, optimistic behavior when needed, retry/concurrency policy, and
Resource invalidation.

## From Ad Hoc Service Mocks

Ad hoc mocks usually replace imports directly, which makes SSR, client tests,
and route preloads disagree about the service graph. Effect UI uses
Capabilities and Layers instead:

- Define a `Capability` for each service interface the app owns.
- Provide production behavior through a Layer passed to `defineApp({ server })`
  or `createEffectRuntime(...)`.
- Provide test behavior through `Server.mock(...)`, Capability test Layers, or
  a runtime created for the test.
- Keep server-only implementations in `.server.ts` modules and prove they stay
  out of browser bundles with a leak scan.

Prefer mocking the interface at the Capability or contract level. Avoid mocking
deep modules that callers should not know exist.
