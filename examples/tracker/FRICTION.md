# Tracker friction log

What building a real app on Arc (SQLite, sessions, a live board, URL-driven
lists, no-JS forms, offline moves) ran into that the framework's tests and
probes did not. Each entry is **fixed** in the framework (with tests, docs,
and a CHANGELOG entry, in the same branch) or **open** with a proposed fix.
Paths are relative to the repository root.

## Fixed in the framework

### 1. A preload could not say "this record does not exist" (issue #14)

`/issues/TRK-999` matched `/issues/:id`; the only way out of the preload was a
typed failure, so SSR answered 500 and rendered the failure view.

- Fix: `Route.notFound()` ends a preload with a verdict, not a failure.
  `Route.planNavigation` plans `NotFound`, Start answers 404 and starts the
  server's routers `NotFound`, the hydrating client and client navigation
  settle `NotFound` (`packages/core/src/route.ts`,
  `packages/core/src/browser-router-kernel.ts`,
  `packages/start/src/start-request-preload.ts`).
- Tests: `packages/core/test/route-verdicts.test.ts`,
  `packages/start/test/route-verdicts.test.ts`; app:
  `examples/tracker/src/server.test.ts`.

### 2. The 404 page could not render the app's shell

Even with a not-found outcome, nothing the preload loaded (the signed-in user,
the project navigation) reached the page, so the shell around the 404 had no
data.

- Fix: a `NotFound` plan from `Route.notFound()` hydrates the Resources the
  preload loaded before its verdict (`collectResourceExit` in
  `packages/core/src/resource-runtime.ts`). The tracker preloads its shell
  first (`preloadShell` in `src/session.ts`), then the issue.

### 3. No way to redirect from a preload (sign-in)

"Requests without a session go to sign-in" needed either a host wrapper around
the Start handler (untyped, server-only) or a client-side `navigate` after
render.

- Fix: `Route.redirect(href, { status?, replace? })`: Start answers a 302 with
  `Location` and renders nothing; the browser router navigates (replacing the
  entry) and fails a redirect loop after 20 hops. `NavigationPlan` gained a
  `Redirect` variant; devtools' plan DTO follows
  (`packages/devtools/src/devtools-contract.ts`).
- `Route.PreloadVerdict<R>` tracks the verdicts by type, outside `error`, so
  `Route.preload`'s type only changes for routes that use them.

### 4. SSR reads nobody preloaded failed as defects

The shell reads the current user on every page. On an unmatched URL (no
preload ran) that read failed during SSR with `ServerFunctionNotFound`: fibers
the render forked ran on the request runtime without the request's services
(the in-process server-function client, `RequestContext`).

- Fix: `makeServedRequestRuntime` (`packages/start/src/request-runtime.ts`)
  builds the request runtime with those services via the new core
  `withRuntimeServices` (`packages/core/src/runtime.ts`).

### 5. ...and when they did load, the client re-rendered over them

With SQLite (synchronous), such a read completed during the render, but its
value was not in the hydration payload, so the client loaded it again and
Solid reported unclaimed server nodes.

- Fix: after rendering, Start hydrates every Resource the render loaded in one
  more streamed chunk (`renderedResourcesChunk` in
  `packages/start/src/start-app-request-handler.ts`, `storeResourceRefs` in
  core).

### 6. A search box lost focus on every keystroke's URL update

The list keeps `?q=`, filters, sort, and page in the URL. Every navigation
remounted the route component (its render key included the href), so the
search input lost focus, the filter drawer's State reset, and the outlet
flashed its pending view on each debounced update.

- Fix: a navigation to the same page (same route and params, new search) keeps
  the route instance and updates its props in place; the page stays on screen
  while the preload runs (`packages/solid/src/route-render-scope.ts`,
  `browserRouteInstanceKey` in
  `packages/core/src/browser-router-render-decision.ts`). Params changes still
  remount.
- Test: `packages/solid/test/router.test.ts` ("keeps a route instance...").

### 7. A server-rendered board never followed its change feed

`rows.changes` was documented to start "on first read after hydration", but it
only started after a load. A hydrated board (every SSR page) never polled, so
two tabs did not see each other's moves.

- Fix: hydrating an entry starts its feed (`packages/core/src/resource-runtime.ts`).

### 8. A change feed could not know where to resume

The feed polls the server's change log from a cursor, but `changes(input)`
received only the input, not the rows it was supposed to continue from.

- Fix: `changes(input, rows)` receives the synced rows the feed starts from;
  the tracker resumes from the newest `seq` among them (`src/resources.ts`).

### 9. A rejected `ActionResult` still reloaded everything

`CreateIssue` returns `ActionResult.validation(...)` for an empty title; the
definition's `invalidates` still ran, reloading the board and the project
list for a change that did not happen (the project console guarded this by
hand in `invalidates`).

- Fix: a `ValidationFailure`/`Failure` result skips the definition's
  `invalidates` (the result's own `invalidates` still run)
  (`packages/core/src/action-execution-workflow.ts`); the project console's
  guard is gone.

### 10. The enhanced form and the no-JS post decoded differently

`StartAction.form(CreateIssue, { input: { projectKey } })` puts `projectKey` in
a hidden JSON field. The server merges it under the visible fields;
`StartAction.decodeFormData` dropped it, so the enhanced submit failed to
decode and did nothing.

- Fix: `decodeStartActionFormData` merges the encoded defaults like the server
  (`packages/start/src/start-action-request-codec.ts`).

### 11. A missing database Layer compiled

`createRequestHandler(app, { server: Layer.empty, serverFunctions })` compiled
although every server function needs `SqlClient`. Two bugs: the server Layer
was only checked against the root's services, and `Server.Client` was a
structural `{ call }` type, so every callable service (an Effect `SqlClient`
is a template-tag function, and every function has `call`) was excluded from
requirements as if it were the server-function client.

- Fix: `createRequestHandler` checks served server functions and Actions too;
  `Server.Client` is branded, built with `Server.makeClient(call)`
  (`packages/core/src/server.ts`). Type test:
  `examples/tracker/type-tests/app-runtime.typecheck.ts`.

### 12. Dev SSR failures printed nothing

A render error in dev printed `[vite] Internal server error:` and a stack: the
wrapping tagged errors had no message.

- Fix: `StartDevServerError` and `StartRequestHandlerError` describe the
  operation and the wrapped failure.

### 20. No production SSR server

Start's Vite plugin served the handler in dev and prerendered static sites,
but there was no server build or runner for a dynamic SSR app: the document's
entry script was `/src/main.tsx` unless prerendering rewrote it. The tracker
ran in dev only.

- Fix: `vite build` of an app that does not prerender builds the client into
  `dist/client` (with its manifest), then the server into `dist/server`,
  whose `index.js` runs `serveMain` from `@sunfall/arc-start/node`: it serves
  the client build's files and renders documents that reference the built
  entry, its stylesheets, and `modulepreload` links for the entry and the
  matched route's lazy chunk (`packages/start/src/start-server-build.ts`,
  `start-client-assets.ts`, `start-node-serve.ts`). `serve` is the same
  server as a scoped Effect for hosts that manage their own process.
- The tracker runs with `pnpm build && pnpm start`; `pnpm verify` builds it
  and runs `scripts/production-smoke.mjs` against the production server.

## Open

### 13. Every server write needs four definitions

A write is a `Server.contract`, its `Server.client`, its `Server.implement`,
and an `Action` whose `run` calls the client (`src/contracts.ts`,
`src/api.server.ts`, `src/actions.ts`). Served Actions only ever run `run` on
the server, but `run` must stay browser-safe, so it hops through a server
function even in-process.

- Proposal: `Action.implement(definition, run)` in a `*.server.ts` module, like
  `Server.implement`, so a served Action's server body is registered directly
  and the shared definition carries only schemas, `optimistic`, and
  `invalidates`.

### 14. Declaring a Resource `error` schema means wrapping every load

A Resource's `error` must cover what `load` fails with, but a server-function
call also fails with `Server.ClientError` (transport). Every load goes through
`domainOnly` (`src/resources.ts`) to turn transport failures into defects.

- Proposal: Resource loads treat `Server.ClientError` as outside the declared
  check (transport failures render as untyped failures, never as typed ones),
  or `Server.client(...).effect` offers a variant without transport errors.

### 15. No-JS validation errors are a JSON page

A no-JS form post whose Action returns `ActionResult.validation(...)` answers
422 JSON (`packages/start/src/start-action-response-codec.ts`). The browser
shows raw JSON instead of the form with its errors. Redirect-mode success
works; validation does not.

- Proposal: in redirect mode, a `ValidationFailure` answers 303 back to the
  referring page with the result in a short-lived, HttpOnly flash cookie that
  the next document request hydrates into the Action's state, so
  `Component.action(...).result()` shows it on both paths.

### 16. Validation failures log console errors

The JSON action client receives 422 for a validation result; browsers log
every 4xx fetch as a console error, so ordinary form validation pollutes the
console (`browser check` filters it).

- Proposal: answer validation results 200 with `_tag: "ValidationFailure"` for
  JSON clients (the body already carries the tag) and keep 422 for no-JS
  posts.

### 17. Forms need a form-shaped Action input

Checkbox groups post nothing, one value, or several; a select posts `""` for
"none". The Action's input schema doubles as the form decoder, so the tracker
declares a string-only `CreateIssueForm` and normalizes it in `run`
(`createIssueInputOf` in `src/actions.ts`).

- Proposal: Start form decoding offers field coercions (`Form.many(schema)` for
  absent/one/many, `Form.optional` for `""`) so a domain schema can decode a
  posted form.

### 18. Change feeds also start in SSR request runtimes (fixed)

A board loaded during SSR started its `rows.changes` poller in the request
runtime, which was interrupted when the response ended. Harmless (the poller
sleeps first) but wasted work, and a feed with side effects would run on the
server.

- Fix: a Start request runtime's Resource Store never follows change feeds
  (`makeRequestResourceStore` in `packages/core/src/resource-store.ts`, used
  by `makeRequestRuntime` in `packages/start/src/request-runtime.ts`);
  hydration (fix 7) starts them in the browser.
- Tests: `packages/start/test/server-render.test.ts`,
  `packages/core/test/resource-rows.test.ts`.

### 19. Sharing a client State across the app needs a Solid context (fixed)

The undo toast is shown by the board and the issue page but owned by the
shell. `Component.state` was per instance and `State.start` is shared across
SSR requests, so the shell passed its handle down through a Solid context.

- Fix: `State.define({ scope: "app", ... })`. Every `Component.state` binding
  of an app State returns the runtime's one instance (one per request during
  SSR), started by the first binding and stopped with the runtime
  (`appStateOnRuntime` in `packages/core/src/state-start.ts`). The shell, the
  board, and the issue page each bind `Component.state(UndoToast)`
  (`src/shell.tsx`); the context is gone.
- Tests: `packages/solid/test/state.test.ts` ("Component.state with an app
  State"), `packages/start/test/server-render.test.ts`.

### 21. `document()` cannot read route data

The tab title for an issue page can only use the URL (`TRK-12 · Tracker`), not
the issue's title: `document` receives `{ request, match }`, not the preloaded
Resources (`src/server.tsx`).

- Proposal: pass `document` a synchronous `read(ref)` over the request's
  preloaded Resources.

### 22. `preloadResources` repeats the preload

Every route lists its Resource families twice: in `preloadResources` and in
`preload` (`src/routes/**`). They drift silently; only a dev warning catches a
missing list.

- Proposal: derive the static list from the families `preload` touches in the
  route plan at build time, or check them against each other in dev.

### 23. The shared client chunk is named after a route file

The production build's 430 kB framework chunk is `_key-*.js`, named after
`routes/projects/$key/index.ts`, which makes bundle reports misleading.

- Proposal: the Start Vite preset names the shared framework chunk (`arc`).

### 24. Framework development: the dev server mixes dist and source

`vite.config.ts` loads `@sunfall/arc-start/vite` from `dist` (Node resolves
it, not Vite's aliases) while the app's SSR modules use the source aliases,
so a framework change needs `pnpm build` and a dev-server restart before the
plugin half of it takes effect. Repository-only; copied apps are unaffected.
