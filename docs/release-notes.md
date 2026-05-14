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
- 39 root test files / 321 tests;
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
  paths now share the same typed EffectInput helper; DB query filter/order
  variance is expressed through helper types, and the default projector
  boundary is named instead of using a broad inline `unknown` bridge.
- Type-id declarations no longer appear in the broad `as never` cast sweep.
- The latest `pnpm verify` passed after tightening runtime-provided scoped
  Effects and removing Solid/Solid-DB hook call-site requirement erasure.
- Start request-runtime provision, request-handler wrappers, StartAction fiber
  workflows, response stream pull/cancel programs, and hydration sync helpers
  now pass Effects directly through runtime/Effect primitives instead of local
  requirement-erasure casts.
- The latest `pnpm verify` passed after the Start runtime call-site cast
  cleanup.
- Start RPC/action runtime-boundary failures now become explicit defect
  responses, action hydration runtime provision failures are converted through
  Effect error handling, and project-console UI fire-and-forget work no longer
  needs example-local Effect casts.
- The latest `pnpm verify` passed after the Start runtime-boundary and example
  UI effect cleanup.
- The broad sharp-cast grep now reports no source hits after schema,
  EffectInput, Start preload/adapter, DB query variance, and core runtime
  service-erasure cleanup.
- The latest `pnpm verify` passed after the broad sharp-cast cleanup.
- Core runtime service erasure now sits at the `ManagedRuntime<any, ER>` value
  boundary instead of casting provided Effect programs.
- The latest `pnpm verify` passed after the final broad sharp-cast sweep.
- The project-console starter packaging script now handles success/failure
  reporting inside the Effect pipeline, with top-level await kept as the Node
  host boundary.
- The latest `pnpm verify` passed after the starter packaging script entrypoint
  cleanup.
- Explicit `Effect.Effect<..., any>` annotations have been removed from package,
  example, script, and type-test source; Resource invalidation Effects now carry
  a generic requirement parameter for refreshed refs.
- The latest `pnpm verify` passed after the explicit Effect-any cleanup.
- Solid Resource hook requirement defaults now use `unknown`, and route outlet
  UI internals avoid `Component<any>` / `value: any` boundaries.
- `pnpm verify` passed after the Solid UI wildcard cleanup.
- Start action client and hydration runtime options now use opaque
  `EffectUiRuntime<unknown, unknown>` types where the public option only needs a
  runtime boundary, not caller-specific service or error detail.
- `pnpm verify` passed after the opaque runtime option wildcard cleanup.
- Start trace/finalizer helpers and Solid runtime provider/router surfaces now
  use opaque runtime/source types; the only remaining
  `EffectUiRuntime<any, any>` source hits are core ambient runtime accessors
  that preserve caller error typing.
- `pnpm verify` passed after the runtime helper wildcard cleanup.
- Conditional helper types now use inferred placeholder parameters instead of
  ignored `any`, arbitrary route params/search constraints use opaque
  `unknown`, and read-only devtools action recording accepts opaque action
  generics.
- The latest `pnpm verify` passed after the conditional helper and route
  wildcard cleanup.
- `UiScope` now creates its closeable scope through `Scope.make(...)` run by
  Effect rather than calling `Scope.makeUnsafe(...)` directly.
- The latest `pnpm verify` passed after the `UiScope` creation primitive
  cleanup.
- Public type tests now use declared Promise values instead of `async`
  callbacks for negative Promise-return checks, keeping type coverage without
  Promise-shaped callback examples.
- The latest `pnpm verify` passed after the type-test async callback cleanup.
- Arbitrary Action, Server, Resource family, and collection transaction
  wildcard boundaries are now named through local `Any*` aliases instead of
  repeated inline wildcard type applications.
- The latest `pnpm verify` passed after the named arbitrary wildcard boundary
  cleanup.
- DB live-query row/context erasure is now named through local query boundary
  aliases instead of repeated inline wildcard record and builder applications.
- The latest `pnpm verify` passed after the DB query wildcard boundary cleanup.
- Core optimistic signal patch storage, ambient runtime service-erasure, and DB
  collection retry policy wildcard boundaries are now named through local
  aliases.
- The latest `pnpm verify` passed after the core runtime and signal wildcard
  boundary cleanup.
- The broad sharp-cast grep is clean across package, example, script, and
  type-test source after replacing the last two test-only `as Effect.Effect`
  assertions.
- The latest `pnpm verify` passed after the test sharp Effect assertion cleanup.
- Package-source fire-and-forget effects now run as detached fibers rather than
  floating `runPromise(...)` calls; Promise runners remain at Promise-returning
  host/API boundaries.
- The latest `pnpm verify` passed after the package fire-and-forget Promise
  cleanup.
- Example app entrypoints and UI helpers also run fire-and-forget effects as
  fibers; the broad `void runPromise` grep now reports no hits across packages,
  examples, scripts, and type tests.
- The latest `pnpm verify` passed after the example fire-and-forget Promise
  cleanup.
- The latest `pnpm verify` passed after refreshing docs drift for the wildcard
  and fire-and-forget sweeps.
- Start adapter tests now use `Effect.callback(...)`/`Effect.sleep(...)`
  listener and timer helpers instead of raw `new Promise(...)`; the broad raw
  Promise-constructor/method grep reports no hits across packages, examples,
  scripts, and type tests.
- The latest `pnpm verify` passed after the adapter test Promise helper cleanup.
- Solid-DB, UiScope, and Resource Store tests now return `Effect.runPromise(...)`
  programs instead of using async test wrappers for Effect sequencing.
- The latest `pnpm verify` passed after the small async test wrapper cleanup.
- Core Capability, Server contract, and Solid router tests now return Effect
  programs instead of using async wrappers for Effect sequencing; the Solid
  router effect avoids subscribing to its own state updates, and the router test
  explicitly loads the browser Solid build for happy-dom coverage.
- The latest `pnpm verify` passed after the core/Solid async test boundary
  cleanup.
- Core runtime tests now return Effect programs instead of async wrappers while
  preserving the public Promise boundaries they exercise behind
  `Effect.promise(...)`.
- The latest `pnpm verify` passed after the core runtime async test cleanup.
- Core Signal stream tests now return scoped Effect programs instead of async
  wrappers, with stream collection assertions inside `Effect.sync(...)`.
- The latest `pnpm verify` passed after the core Signal async test cleanup.

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
