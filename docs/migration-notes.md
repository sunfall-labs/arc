# Migration Notes

These notes map common full-stack app patterns onto
[the Sunfall Arc golden path](golden-path.md).
They are intentionally conservative: migrate one vertical slice at a time and
keep the old path beside the new path until tests prove the behavior.

## From Effect-Suffixed Names And Path Addressing

This alpha applies three naming rules across every package:

1. Definition constructors are `define`, namespaced: `Resource.define`,
   `Route.define`, `App.define`, `FileRoute.define`, `Component.define`,
   beside `Action.define`, `Program.define`, `Collection.define`, and
   `Capability.define`.
2. Operations that return Effects carry no `Effect` suffix, and each has one
   form: where a synchronous twin existed it is gone. Hosts without an Effect
   context run the Effect (`Effect.runFork(...)` from a cleanup hook starts
   synchronously; `Effect.runSync(...)` reads a value).
3. Routes are addressed by definition only; the path-keyed helpers are gone.

Handles follow the same rule: members that run work (`submit`, `dispatch`,
`reset`, `preload`, `refresh`) return Effects, and UI event handlers run them
through `Component.callback`, which requires failures to be handled:

```tsx
const rename = yield * Component.action(RenameProject);
const save =
  yield *
  Component.callback((name: string) => rename.submit({ id: props.id, name }).pipe(Effect.ignore));
return () => <RenameForm onRename={save} />;
```

A Start client entry is one Effect: it restores the server's payload and
hydrates the root from the app definition:

```ts
Effect.runFork(App.launch(app));
```

| Old                                                                                                                          | New                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Resource.family(options)`                                                                                                   | `Resource.define(options)`                                                                      |
| `Resource.requestFamily({ request, resolver, ... })`                                                                         | `Resource.define({ request, resolver, ... })`                                                   |
| `route(path, options)`                                                                                                       | `Route.define(path, options)`                                                                   |
| `defineApp(config)`                                                                                                          | `App.define({ root, routes, ... })` from `@sunfall/arc-start`                                   |
| `defineFileRoute(path)(options)`                                                                                             | `FileRoute.define(path)(options)`                                                               |
| `Component.make(name, setup)`                                                                                                | `Component.define(name, setup)`                                                                 |
| `Resource.prefetchEffect` / `refreshEffect` / `statusEffect` / `readEffect`                                                  | `Resource.preload` / `refresh` / `status` / `read`                                              |
| `Resource.deleteEffect(ref)`                                                                                                 | `Resource.evict(ref)`                                                                           |
| `Resource.collectEffect` / `invalidateEffect` / `planInvalidationEffect` / `runInvalidationPlanEffect`                       | `Resource.collect` / `invalidate` / `planInvalidation` / `runInvalidationPlan`                  |
| `Resource.subscribeEventsEffect` / `dehydrateEffect` / `hydrationPayloadEffect` / `hydrateEffect`                            | `Resource.subscribeEvents` / `dehydrate` / `hydrationPayload` / `hydrate`                       |
| `Resource.encodeHydrationPayloadEffect` / `decodeHydrationPayloadEffect`                                                     | `Resource.encodeHydrationPayload` / `decodeHydrationPayload`                                    |
| `Route.preloadEffect` / `preloadComponentEffect` / `planPreloadEffect` / `planNavigationEffect`                              | `Route.preload` / `preloadComponent` / `planPreload` / `planNavigation`                         |
| `Route.preloadFailureSnapshotEffect` / `hydratePreloadFailureEffect` / `lazyComponentPendingEffect`                          | `Route.preloadFailureSnapshot` / `hydratePreloadFailure` / `lazyComponentPending`               |
| lazy route component `preloadEffect()`, `RouteLazyComponentPending.preloadEffect`                                            | `preload()`, `.preload`                                                                         |
| `isRoutePathMatch(path, match)` (generated)                                                                                  | `Route.isMatch(route, match)`                                                                   |
| `Action.planInvalidationEffect`                                                                                              | `Action.planInvalidation`                                                                       |
| `ActionInstance.submitEffect` / `resetEffect` + sync `reset()`                                                               | `submit` / `reset` (Effects)                                                                    |
| `ActionResult.successEffect` / `failureEffect` / `failEffect` / `redirectEffect` / `validationEffect`                        | return `ActionResult.success(...)` etc. (or `Effect.succeed(...)` of it)                        |
| `ActionResult.fail`                                                                                                          | `ActionResult.failure`                                                                          |
| `ActionResult.validateFormEffect` / `requireSuccessEffect`                                                                   | `ActionResult.validateForm` / `requireSuccess`                                                  |
| `Capability.useEffect(f)` / `Capability.useSync(f)` / `use(f)`                                                               | `Capability.use(f)` (Effect or plain-value callback)                                            |
| `form.validateEffect()`, `Form.validateEffect`, `Form.decodeFormDataEffect`                                                  | `form.validate()`, `Form.validate`, `Form.decodeFormData`                                       |
| root `decodeFormDataEffect`, `formDataToObject`                                                                              | `Form.decodeFormData`, `Form.data`                                                              |
| `Server.handleRouteEffect`, `Signal.fromStreamEffect`                                                                        | `Server.handleRoute`, `Signal.fromStream`                                                       |
| `makeRequestContextEffect` / `applyResponseContextEffect` / `serializeResponseCookieEffect`                                  | `makeRequestContext` / `applyResponseContext` / `serializeResponseCookie`                       |
| `runtime.disposeEffect`, `disposeResourceStoreEffect`, `ResourceStoreModule.disposeEffect`                                   | `runtime.dispose`, `disposeResourceStore`, `ResourceStoreModule.dispose`                        |
| `ResourceStore` `eventBus.publishEffect` / `subscribeEffect` / `shutdownEffect` / `isShutdownEffect` + `isShutdownUnsafe()`  | `publish` / `subscribe` / `shutdown` / `isShutdown`                                             |
| `ResourceStore` registries `size()` + `sizeEffect`, diagnostics `*CountEffect` / `snapshotEffect` + `snapshotUnsafe()`       | `size`, `*Count`, `snapshot` (Effects)                                                          |
| `Program.command(effect)` / `Program.effect(effect)` / `Program.dispatch(message)`                                           | `Program.emit(effect)` / `Program.emit(effect)` / `Program.emit(message)`                       |
| Program instance and Solid handle `dispatch(message)` (sync) + `dispatchEffect(message)`                                     | `dispatch(message)` (Effect)                                                                    |
| Program instance `disposeEffect`                                                                                             | `dispose`                                                                                       |
| Solid `ActionHandle` `submit(input)` (sync) + `submitEffect(input)`, sync `reset()`                                          | `submit(input)`, `reset()` (Effects)                                                            |
| router `hrefByPath` / `navigateByPath` / `matchByPath` / `preloadByPathEffect`                                               | `href(route)` / `navigate(route)` / `Route.isMatch(route, router.match())` / `preload(route)`   |
| router and host controller `preloadEffect`, `disposeEffect` + sync `dispose()`                                               | `preload`, `dispose` (Effect; host cleanup forks it)                                            |
| `BrowserHistoryAdapter.prepareHrefEffect`                                                                                    | `prepareHref`                                                                                   |
| `BrowserRouterPath`, `BrowserRouterRouteForPath`                                                                             | route definitions (`typeof ProjectRoute`)                                                       |
| generated `routeByPath`, `routeIdByPath`, `hrefById`, `hrefByPath`, `layoutsByPath`, `errorBoundaryByPath`, `metadataByPath` | `routeById`, `Route.href(routeById.<id>)`, `layoutsById`, `errorBoundaryById`, `metadataById`   |
| generated `RouteByPath`, `RouteIdByPath`, `FileRoutePath`, `FileRoute*ByPath`, `FileRouteMatch`                              | the id-keyed types (`RouteById`, `FileRouteParamsById`, ...)                                    |
| Collection `preloadEffect` / `refetchEffect`                                                                                 | `preload` / `refresh`                                                                           |
| Collection `insert` / `update` / `delete`, `sync.insert` / `update` / `delete`, `flushPendingMutations`                      | an Action: `optimistic: (input, tx) => tx.update(Collection, key, patch)`, `run`, `invalidates` |
| Collection `applyChangesEffect`                                                                                              | `applyChanges` (remote feeds and local-only collections)                                        |
| Collection `snapshotEffect` + sync `snapshot()`, `hydrateEffect`, `persistEffect`, `restoreEffect`                           | `snapshot`, `hydrate`, `persist`, `restore`                                                     |
| Collection `state()`, `Query.Live` `state` / `data`                                                                          | `result()`, `result` / `rows`                                                                   |
| Collection sync adapter `refetch`                                                                                            | `refresh`                                                                                       |
| `Collection.flushAllPendingMutationsEffect` / `backgroundSyncPendingMutationsEffect`                                         | removed: Actions own writes                                                                     |
| Solid DB handle `result()` / `preloadFailure()`, `onPreloadFailure`, `pendingMutations()`                                    | `waiting()` / `failure()`; a never-loaded failure throws to `<Errored>` (`catchTags`)           |
| `Option.getOrUndefined(AsyncResult.error(action.result()))`, `action.result().waiting`                                       | `action.failure()` (a `Cause`), `action.waiting()`                                              |
| `optimistic: (input, tx) => ... return Effect.void` (rollback Effect)                                                        | `optimistic: (input, tx) => tx.signal(...)` (the transaction owns rollback)                     |
| `Query.onceEffect`, `Query.Live` `preloadEffect` / `refetchEffect`                                                           | `Query.once`, `preload` / `refresh`                                                             |
| Solid DB `LiveQueryHandle` `data` / `preloadEffect` / `refetchEffect`                                                        | `rows` / `preload` / `refresh`                                                                  |
| `createHtmlResponseEffect`, `createStartStreamedHtmlResponseEffect`, hand-written shells                                     | Start's document: `createRequestHandler(app, { document })`                                     |
| `hydrateFromDocument` (sync) + `hydrateFromDocumentEffect`, `HydrateFromDocumentEffectOptions`                               | `hydrateFromDocument` (Effect), `HydrateFromDocumentOptions`                                    |
| `StartAction.decodeFormDataEffect`                                                                                           | `StartAction.decodeFormData`                                                                    |
| Devtools store `getSnapshotEffect`, `recordActionStateEffect`, ... + their sync twins                                        | `getSnapshot`, `recordActionState`, ... (Effects)                                               |
| Devtools `trackActionEffect` / `trackTimelineEffect`                                                                         | `trackAction` / `trackTimeline`                                                                 |
| `installDevtoolsBridge` (sync) + `installDevtoolsBridgeEffect`, `mountDevtoolsPanelsEffect`                                  | `installDevtoolsBridge` (scoped Effect), `mountDevtoolsPanels`                                  |
| `DevtoolsPanelBoot.interruptEffect`                                                                                          | `boot.interrupt()` (the host facade's one stop)                                                 |

The migration is done when no `*Effect`-suffixed Arc name remains in app code,
event handlers reach Effects only through `Component.callback`, and routes are
addressed by their definitions.

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
- Follow-up work is a command from `Program.emit(...)`: `Program.emit(message)`,
  `Program.emit(Effect.tryPromise(...).pipe(Effect.map(...)))`, or an Effect
  that completes with `void` when the work emits no message.
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
  `Component.define(name, function* (props) { ...; return () => <View /> })`.
  Setup runs once per instance, like a hook-calling component body.
- `useResource` / `useResourceSuspense` become `yield* Component.resource(Family)`
  and render `reader(input)` under `<Loading>`; status UI reads
  `reader.waiting(input)` / `reader.failure(input)` instead of `result()`.
- `useAction(Definition)` and `StartAction.use(Definition)` become
  `yield* Component.action(Definition)`; a Start app lists the Actions the
  server serves in `App.define({ actions })`.
- `useProgram`, `useStream`, and `useRuntimeEffect` become `Component.program`,
  `Component.stream`, and `Component.callback`.
- `useCollection` / `useLiveQuery` become `SolidDb.collection` /
  `SolidDb.liveQuery`.
- `<RuntimeProvider runtime>` plus `<RouterProvider routes>` become
  `yield* Component.router(routes)` and `<RouterProvider router={router}>`, and
  a Start app's entries become `createRequestHandler(app, { server })` and
  `Effect.runFork(App.launch(app))` over one `App.define({ root, ... })`.

The migration is done when every service the tree needs is in its root
component's `R`, and `Component.launch` type-checks against the runtime.

## From TanStack Query

TanStack Query usually spreads data behavior across query keys, query functions,
mutation callbacks, and invalidation calls. In Sunfall Arc, move that behavior
behind Resource families and Actions:

- Query keys become `Resource.define({ name, input, load })` refs.
- Query functions become Effect loaders, usually calling a server contract or
  Capability.
- `invalidateQueries(...)` becomes `Resource.invalidate(...)` or an
  Action invalidation plan.
- Mutation callbacks become `Action.define(...)` definitions with retry,
  concurrency, optimistic work, and invalidation metadata attached to the
  definition. UI binds them with Solid's `Component.action(...)`; a Start app
  lists served Actions in `App.define({ actions })` so they submit over the
  network through the same handle, and `StartAction.form(...)` renders them
  as progressive no-JS forms.
- Route loaders call `Resource.preload(...)` in `preload` and declare
  `preloadResources` / `preloadCollections`; file routes use
  `FileRoute.define(path)(options)` with exactly the same options as core
  `Route.define(path, options)`.

Keep Promise-returning query functions at the host boundary only. Inside the
framework slice, prefer Effect loaders so retries, services, scopes, tracing,
and interruption stay visible.

## From TanStack Start

TanStack Start route files often combine route definitions, loaders, server
functions, and generated route typing. Sunfall Arc keeps the same copyable route
shape but makes app graph facts explicit:

- File routes use `FileRoute.define(...)` and generated route maps.
- Server functions use `Server.contract(...)`, `Server.implement(...)`, and
  browser-safe contract imports.
- Request handling starts at `createRequestHandler(app, { server })`; Promise
  handlers are host convenience boundaries.
- Start renders the app root into its own streamed document; a route sets its
  head and headers through the handler's `document` function instead of
  hand-written HTML.
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
- Client-side submits call the Component's action handle: `submit(input)`
  returns the submission Effect, run from a handler through
  `Component.callback` or composed inside a Program or workflow.

The migration is done when the same Action definition owns schema validation,
no-JS fallback, optimistic behavior when needed, retry/concurrency policy, and
Resource invalidation.

## From Ad Hoc Service Mocks

Ad hoc mocks usually replace imports directly, which makes SSR, client tests,
and route preloads disagree about the service graph. Sunfall Arc uses
Capabilities and Layers instead:

- Define a `Capability` for each service interface the app owns.
- Provide production behavior through the server Layer passed to
  `createRequestHandler(app, { server })`, the client Layer in
  `App.define({ client })`, or `makeRuntime(...)`.
- Provide test behavior through `Server.mock(...)`, Capability test Layers, or
  a runtime created for the test.
- Keep server-only implementations in `.server.ts` modules and prove they stay
  out of browser bundles with a leak scan.

Prefer mocking the interface at the Capability or contract level. Avoid mocking
deep modules that callers should not know exist.
