# Release Notes Draft

This is the current release-candidate snapshot for the pre-release Effect UI
framework. Package manifests remain private, so this is not an npm release note
yet.

## Stable For The First External App

- Core runtime primitives: Signals, Resources, Actions, Forms, Routes,
  Capabilities, server contracts, scoped UI work, and request-local runtimes.
- Start request handling: SSR, RPC, Start actions, hydration payloads, streamed
  HTML responses, request traces, and build diagnostics.
- Node and Fetch host facades: `@effect-ui/start-node` and
  `@effect-ui/start-fetch`.
- Devtools data contracts: snapshots, summaries, causal graphs, request traces,
  panel models, deterministic HTML rendering, the checked panel app shell, and
  the checked browser-extension shell with an inspected-window bridge.
- Local-first DB surface: Collections, live queries, persistence, sync adapter
  seams, mutation queues, and flush policies.
- Solid adapters: runtime provider, router, Resource hooks, Action hooks,
  stream hooks, and collection hooks.
- Starter paths: `examples/basic-starter` for the smallest full-stack shell,
  `examples/project-console` for the golden-path app, and
  `pnpm starter:project-console:package` for a generated rich starter payload.

## Experimental Or Expert-Public

- Start Vite helpers, virtual module helpers, diagnostics loaders, and generated
  app graph artifacts are public for CI, starter tooling, and agent workflows,
  but remain expert-facing.
- DB query builder internals intentionally keep a small cast boundary around
  joined context variance and the default projector.
- DB incremental live queries use a named `IOperator` bridge for the custom IVM
  flatMap operator instead of an inline bottom-type cast.
- DB query joins now carry selected projectors with a narrower direct function
  assertion; the remaining broad query casts are limited to predicate/order
  variance and the unprojected identity branch.
- Core and DB type-id declarations preserve `unique symbol` types with
  self-type assertions instead of `as never` bottom casts.
- Core runtime integration with Effect `ManagedRuntime` keeps a documented
  service-erasure boundary centralized behind `provideManagedServices(...)` and
  `provideRuntimeServices(...)`; `EffectUiRuntime.provide(...)` exposes a scoped
  Effect for UI-scope forking.
- Core Capability helpers now use overloads for pure vs Effect-returning
  `useEffect(...)` callbacks and rely on `Effect.provideService(...)` return
  typing directly.
- Browser extension packaging is checked as an example shell, including a live
  inspected-app bridge that reads `globalThis.__EFFECT_UI_DEVTOOLS__`.
- Platform-specific packages beyond Node/fetch should wait for hosts that need
  real behavior beyond the generic facades and documented recipes.

## Verification Snapshot

Latest full gate on May 14, 2026:

- 9 package builds;
- workspace typecheck and public type tests;
- 38 root test files / 320 tests;
- devtools panel verify;
- devtools extension verify;
- basic starter verify;
- project console starter packaging;
- project console typecheck;
- 4 project console test files / 23 tests;
- project console production build;
- project console server-only leak scan.
- `pnpm benchmark` refreshed the SSR, route preload, Resource, live query, and
  RPC transport baselines.
- The latest `pnpm verify` includes the rich project-console starter packaging
  gate and the devtools extension verify gate.
- Package description metadata has been added and package-local dry-run packs
  passed for all 9 framework packages.
- The Start diagnostics CLI now runs its parse/load/render flow through an
  Effect-native runner with Promise helpers kept at the bin boundary.
- The Vite dev SSR middleware now keeps request conversion, handler loading,
  response writing, and error forwarding inside an Effect program.
- The devtools extension now keeps sample data as a fallback and updates from a
  live inspected-page `__EFFECT_UI_DEVTOOLS__` panel payload when present.
- Apps can expose that payload through `installDevtoolsBridgeEffect(...)`, which
  scopes `globalThis.__EFFECT_UI_DEVTOOLS__` setup and cleanup inside Effect.
- The latest devtools extension verify includes 1 extension test file / 6 tests
  plus the Manifest V3 production build.
- The latest `pnpm verify` also covers the private `UNLICENSED` workspace
  metadata sweep, the type-test Promise-method cleanup, and the test
  Promise-catch cleanup.
- The devtools extension now structurally validates inspected-window
  `DevtoolsPanels` bridge payloads before rendering live data.
- `effectUiStart(...)` now returns the concrete `EffectUiStartPlugin` type for
  Start Vite plugin hooks instead of exposing only Vite's broad `PluginOption`
  union.
- Test sources no longer use unknown-to-contract casts; negative
  runtime-validation tests use explicit `@ts-expect-error` assertions, and Start
  Cause helpers use public `cause.reasons` access.
- DB `QueryRoot.from(...)` now constructs its typed `QueryBuilder` directly
  instead of casting the builder through `never`.
- DB incremental live-query custom operators now register through a named
  `IOperator` bridge over `@tanstack/db-ivm`'s class-typed `addOperator(...)`
  surface.
- The latest `pnpm verify` passed after the type ID bottom-cast cleanup.
- Capability implementation casts for `useEffect(...)` and `provide(...)` were
  removed without changing the public pure/Effect callback behavior.
- Runtime run-method service-erasure casts were consolidated behind exact
  ResourceStore provision typing and one named ManagedRuntime boundary.
- Core Action and Resource Promise helpers now delegate workflow fibers,
  `Fiber.join`, stale refresh, and interruption Effects directly to that runtime
  boundary instead of erasing requirements at each call site.
- Core runtime helpers, `UiScope`, and `Signal.watch(...)` now rely on Effect
  primitive typing directly where TypeScript can already prove the scope shape.
- Core server wire helpers now centralize typed schema decoding, and
  `ServerClient.call(...)` preserves server function requirements for local/mock
  Effect execution.
- DB sync, SQLite persistence, flush-policy, and server-collection adapters now
  keep EffectInput conversion in typed helper seams instead of repeated
  adapter-local assertions.
- DB collection persistence, load, mutation, change-feed, and live-query preload
  paths now share the same typed EffectInput helper; remaining DB sharp casts are
  the documented query context-variance bridges.
- The DB query builder projector variance helper no longer uses a broad
  `unknown` bridge.
- Type-id declarations no longer appear in the broad `as never` cast sweep.
- The latest `pnpm verify` passed after tightening runtime-provided scoped
  Effects and removing Solid/Solid-DB hook call-site requirement erasure.
- Start request-runtime provision, request-handler wrappers, StartAction fiber
  workflows, response stream pull/cancel programs, and hydration sync helpers
  now pass Effects directly through runtime/Effect primitives instead of local
  requirement-erasure casts.
- The latest `pnpm verify` passed after the Start runtime call-site cast
  cleanup.

## Notable Limits

- Packages are still private and versioned `0.0.0-alpha.0`.
- Package manifests include pre-release descriptions, `UNLICENSED`, and build
  metadata, but final public npm repository/license decisions are still open.
- The browser extension live bridge expects the inspected app to expose
  `globalThis.__EFFECT_UI_DEVTOOLS__`; automatic injection is not part of the
  checked shell.
- The generated rich starter still uses pre-release `0.0.0-alpha.0`
  `@effect-ui/*` package placeholders until package publication is finalized.
- Cloudflare, Vercel, Netlify, Bun, and static deployment currently use recipes
  over Node/fetch facades rather than dedicated packages.
