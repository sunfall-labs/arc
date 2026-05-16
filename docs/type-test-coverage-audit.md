# Type-Test Coverage Audit

Last updated: 2026-05-16.

This audit checks compile-time coverage for the public framework contracts that
are easiest to regress while refactoring internals toward Effect primitives.

## Current Sweep Results

- `type-tests/framework.test-d.ts` exercises every public package root used by
  the example path: core routes/resources/actions/forms/capabilities, Start
  request handling and hydration, DB collections and live queries, Solid DB
  hooks, generated file-route types, and devtools invalidation plans.
- Promise-returning callbacks are rejected at the type boundary for routes,
  resources, collections, actions, forms, server implementations, Start render
  callbacks, and `onRequestTrace`. Direct Promise-shaped `EffectInput` values
  are also rejected for `toEffect(...)` and ActionResult conversion helpers.
- Promise-returning negative cases use declared Promise values instead of
  `async` callback syntax, so compile-time coverage stays focused on the public
  boundary rather than embedding Promise-shaped framework callbacks.
- Generated route unions are covered for route ids, route paths, canonical
  params, branded params, href options, and search literal rejection.
- Solid router, resource, and action hooks now have public type pins for typed
  href/navigation/preload, route-specific outlet match renderers, resource
  handles, tagged router errors, and action input/output preservation.
- Core route preload type tests pin that service-backed preload requirements
  flow through `Route.preloadEffect(...)`, `Route.planPreloadEffect(...)`, and
  `Route.planNavigationEffect(...)`, and that resource snapshot serialization
  failures remain visible as `ResourceSnapshotCodecError` on planning Effects.
- Core Resource key and read-boundary type tests pin `ResourceKeyError` as the
  default-key codec failure and allow the generic `read(...)` helper to accept
  serviceful Resource refs. Review 67 adds `Resource.readEffect(...)` and
  schema-backed snapshot error pins so Effect workflows keep read failures and
  dehydrate failures in typed error channels, and Review 68 keeps the
  `Resource.readEffect(...)` public type pinned while runtime tests prove it
  participates in Resource touch collection.
- Core Resource Store type tests pin that the public `ResourceStore` Interface
  can be consumed for diagnostics but not structurally implemented as a fake
  root-exported store, and that mutable store constructors/unsafe accessors stay
  out of the root export. Resource read-boundary type tests also pin
  `ResourcePending.hasPrevious` and `ResourceFailure.hasPrevious` so LSP hovers
  distinguish a successful `undefined` previous value from no previous value.
- Start route preload type tests pin that `preloadRequestEffect(...)` and
  `createRequestHandlerEffect(...)` keep preload services in the requirement
  channel when the app server runtime does not provide them, and remove them
  when it does. Review 68 also pins file-route preload helpers accepting stable
  collection names, while runtime tests cover registry/resolver-only hydration.
- Start render context coverage now pins the non-streaming
  `legacyHydrationScript`, the deprecated `hydrationScript` alias, the
  streamed `hydrationRootScript`, and the `StartRenderHydrationPlan` Interface.
  Type hovers distinguish the full payload from the root-only streamed script
  so renderers can avoid duplicating route resource hydration.
- Effect-first Start fetch and Node adapter type tests pin that route preload
  services remain visible through adapter conversion, including negative tests
  for partial generics that would otherwise collapse requirements to `unknown`;
  they also exercise the low-level request-origin, Node request conversion,
  response writer, Promise facade option, runtime-option, and handler alias
  surfaces from the root compatibility facade, the fetch/node subpaths, and the
  `@effect-ui/start-fetch` / `@effect-ui/start-node` packages.
- The root `@effect-ui/start/adapters` compatibility facade now has an explicit
  `createFetchHandler(...)` type pin and the same serviceful-handler
  runtime-required negative assertion as `@effect-ui/start/fetch-adapter`.
- Promise/callback-shaped Start host facade type tests pin that non-Scope
  handler requirements require a typed runtime, while request Scope remains
  facade-owned.
- Core action type tests pin that `Action.use(definition, { runtime })`
  removes services supplied by the runtime from `submitEffect(...)` and exposes
  runtime startup/acquisition errors in the action error channel.
- Core Program type tests pin the same runtime-error rule for
  `Program.start(...)` and Solid/React `useProgram(...)`: update, command, and
  subscription failures keep the Program error channel, while Runtime Spine
  provision/startup failures flow through the optional `ER` parameter instead
  of widening to `unknown`.
- Core action invalidation type tests pin that `Action.planInvalidation*`,
  `Action.use(...)`, and `ActionResult` invalidation metadata, including
  `withInvalidation(...)` and Effect result helpers, preserve required services
  until an explicit runtime supplies them.
- Start registry type tests pin that app-local action/RPC registry
  requirements and explicit `options.actions` requirements remain visible in
  Start request handler Effects until the server runtime provides them.
- Solid action hook type tests pin the runtime-bound submit Effect and the
  optional runtime-error generic for apps with a fallible Solid Runtime
  Provider.
- Solid router type tests pin that serviceful route preload definitions require
  a browser router runtime carrying the preload service layer when a runtime is
  passed explicitly, including the `RouterProvider` shorthand.
- Solid resource and Solid DB hook type tests pin runtime-bound returned
  Effects, optional runtime-error generics, and the fact that Solid DB handles
  no longer expose service requirements already provided by the Solid runtime.
  Review 67 also pins runtime-bound Solid DB collection mutation and flush
  Effects plus reactive pending-mutation reads.
- DB live-query collection type tests pin inferred source requirements and
  Solid DB collection handles for derived live-query collections.
- Start/Devtools app graph type tests pin that Start App Graph Diagnostics are
  assignable to the Devtools app graph Interface and can feed store, summary,
  panels, and bridge surfaces without hand-authored drift.
- DB collection hydration type tests pin `Collection.dehydrateEffect(...)`,
  `Collection.hydratePayloadEffect(...)`, and
  `Collection.validateHydrationPayloadEffect(...)` error channels, including
  snapshot codec failures and synchronous callback failures.
- Query factory type tests pin that public `Query.Factory<TResult>` defaults to
  `never` error/requirement channels and rejects serviceful builders unless
  their `E/R` parameters are explicit.
- DB multi-collection flush and background sync type tests pin
  `CollectionSnapshotCodecError` in the coordination error channel.
- Start request traces remain structurally assignable to
  `DevtoolsRequestTrace`, including the richer teardown timestamps, duration,
  and before/after Resource Store snapshots added during the request trace
  sweep.
- Start action invalidation metadata remains structurally assignable to
  `DevtoolsInvalidationPlan` in both directions, so Start transport payloads can
  feed devtools without introducing a package dependency.
- Start endpoint type tests pin the shared transport endpoint helpers used by
  request handlers, RPC clients, action clients, and progressive action forms.
- Start action form type tests pin schema-backed form input encoding and the
  `StartActionFormEncodeError` sync facade.
- Devtools panel contract type tests pin `normalizeDevtoolsPanels(...)`, the
  sync and Effect panel mounts, panel guards, bridge payload normalization, and
  bounded serialization policy values.
- Devtools store type tests pin the explicit `DevtoolsStore` Interface and
  retained fact indexes returned from serialized route-plan recording.
- Devtools causal graph type tests reject the removed
  `InvalidationTarget` node kind; invalidation refs now stay under `Resource`
  nodes and tags under `ResourceTag`.
- Devtools runtime-event and panel contract coverage now pins runtime-only
  route/invalidation fact projection, duplicate panel item rejection, and
  rendered item identity through focused runtime tests.
- Devtools panel contract regressions now cover invalid inspected-window bridge
  payload diagnostics, transport timeouts, and shared app graph normalization
  so extension code consumes the same public `DevtoolsPanels` Interface as
  renderers, summaries, serialization, and causal graph projection.

## Verification Evidence

- `pnpm typecheck:types` passed after the explicit request-trace teardown and
  Promise-return rejection assertions were added.
- `pnpm typecheck:types` and full `pnpm verify` passed after replacing
  type-test `async` negative cases with declared Promise values.
- `pnpm typecheck:types` and full `pnpm verify` passed after adding the Start
  route-preload runtime requirement pins.
- `pnpm typecheck:types` passed after adding the Effect-first adapter
  requirement-preservation pins.
- `pnpm typecheck:types` passed after adding low-level Start host Adapter and
  Devtools Panel Contract coverage.
- `pnpm typecheck:types` and full `pnpm verify` passed after adding action
  invalidation requirement pins and Start registry/`options.actions`
  requirement pins.
- `pnpm typecheck` passed after adding direct Promise `EffectInput`,
  host-facade runtime, Solid/Solid DB runtime-error, and Query Factory default
  pins.
- `pnpm typecheck:types` and full `pnpm verify` passed after adding the Review
  67 Resource read/snapshot pins, Solid DB mutation handle pins, Start/Devtools
  app graph seam pins, and Devtools large-panel contract regressions.
- `pnpm typecheck:types` passed after adding the Review 69 Program runtime
  error pins and Resource Store public seam usage; focused React, Start, DB, and
  Devtools regressions also passed for adapter behaviors that are runtime
  rather than compile-time contracts.
- Existing type-test failure expectations cover public compile-time rejection
  rules for route params/search, server contracts, resource inputs, collection
  rows, live-query selectors, capability implementations, action invalidation,
  optimistic rollback effects, and form fields.

## Follow-Up

- Add type assertions with each new public callback to keep Promise-shaped APIs
  out of the framework boundary unless they are intentionally wrapped by
  Effect.
- Keep Start and devtools trace contracts covered together whenever request
  trace payloads grow.
- Keep Start action invalidation and devtools invalidation DTOs structurally
  covered together whenever either payload grows.
