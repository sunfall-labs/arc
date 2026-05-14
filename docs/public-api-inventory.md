# Public API Inventory

Last updated: 2026-05-14.

This is the first release-candidate inventory required by the framework
perfection charter. It tracks only import paths exported by package manifests;
source files that are not reachable through `package.json#exports` are internal
unless this document explicitly promotes them.

## Classification Rules

- Public: intended for external app code or build configuration.
- Expert public: intended for advanced integrations, diagnostics, tests, or
  adapters; stable enough to document, but not a golden-path API.
- Internal: not reachable from package exports and not supported as an import
  path.
- Needs decision: exported today, but should be renamed, hidden, or explicitly
  documented before a public release.

## Package Export Map

| Package | Export | Source | Classification | Release decision |
| --- | --- | --- | --- | --- |
| `@effect-ui/core` | `.` | `packages/core/src/index.ts` | Public | Keep as the core application/runtime surface. |
| `@effect-ui/start` | `.` | `packages/start/src/index.ts` | Public | Keep as the full-stack runtime surface. |
| `@effect-ui/start` | `./vite` | `packages/start/src/vite.ts` | Public | Keep as the build-plugin and diagnostics runner surface. |
| `@effect-ui/start` | `./diagnostics-report` | `packages/start/src/diagnostics-report.ts` | Public | Keep as CI/agent repair report surface. |
| `@effect-ui/start` | `./adapters` | `packages/start/src/adapters.ts` | Public | Keep for Node/fetch host integration. |
| `@effect-ui/start` | `./virtual` | `packages/start/src/virtual-modules.d.ts` | Expert public | Keep as type-only virtual module declarations. |
| `@effect-ui/start` | `effect-ui-start` bin | `packages/start/src/cli.ts` | Expert public | Keep for app graph diagnostics automation. |
| `@effect-ui/db` | `.` | `packages/db/src/index.ts` | Public | Keep as the collection/live-query surface. |
| `@effect-ui/devtools` | `.` | `packages/devtools/src/index.ts` | Public | Keep as the JSON-safe inspection contract. |
| `@effect-ui/solid` | `.` | `packages/solid/src/index.ts` | Public | Keep as the Solid adapter surface. |
| `@effect-ui/solid-db` | `.` | `packages/solid-db/src/index.ts` | Public | Keep as the Solid collection adapter surface. |
| `@effect-ui/tsrx` | `.` | `packages/tsrx/src/index.ts` | Public | Keep as the Vite/TSRX preset. |

## Source Surface By Package

### `@effect-ui/core`

The root export star-exports these modules:

- `action`, `action-result`, `app`, `capability`, `effect-like`, `form`
- `read`, `request-context`, `resource`, `resource-store`, `route`
- `runtime`, `scope`, `server`, `signal`, `stable-stringify`

Golden-path public groups:

- `defineApp`, `route`, `Route`, `Resource`, `Action`, `ActionResult`
- `Server`, `ServerClient`, request/response context services
- `Signal`, `Form`, `Capability`, `UiScope`
- `makeRuntime`, `runWithRuntime`, `runPromise`, `runEffectInput`

Release decisions:

- Type IDs such as `ActionTypeId`, `ResourceTypeId`, and `RuntimeTypeId` are
  expert-public structural markers. They are intended for diagnostics,
  adapter authors, and test utilities that need framework identity checks; app
  code should prefer guards and namespace helpers such as `Action.is`, `Resource`
  APIs, `Signal.isSignal`, and `Form` helpers.
- Low-level runtime accessors such as `getCurrentRuntime` are expert public for
  adapter and hook authors that must bridge into the active Runtime Spine. App
  code should use explicit runtime providers, `makeRuntime`, `runWithRuntime`,
  or adapter hooks such as Solid's `useRuntime`.

### `@effect-ui/start`

The root export includes:

- hydration, streaming, server-function manifest, action manifest, app graph,
  diagnostics report, file-route module helpers, and file-route definitions;
- request handler APIs: `createRequestHandler`, `createRequestHandlerEffect`,
  `createServerHandler`, `preloadRequest`, `preloadRequestEffect`, and the
  `onRequestTrace` hook;
- transport APIs: RPC/action paths, request-id and trace headers, media-type
  helpers, and browser RPC/action clients;
- form bridge APIs: `startActionForm`, `StartAction`, and transport result
  types.
- request trace types: `StartRequestTrace`, request/response/resource/
  collection/action/server-function/fiber/stream trace records, and
  `StartRequestTraceHandler`.

Subpath exports:

- `./vite` owns `effectUiStart`, file route discovery, virtual module creation,
  build-policy validation, app graph diagnostics loading, and SSR dev handling.
  Its SSR module handler type is named `StartSsrRequestHandler` so it cannot be
  confused with the root Promise-only `StartRequestHandler`.
- `./diagnostics-report` owns grouped repair reports with owner/edit guidance.
- `./adapters` owns Node/fetch adapter conversion and response writing.
- `./virtual` owns virtual module typings only.
- `effect-ui-start` owns diagnostics CLI execution. The internal runner is
  Effect-native; Promise-returning helpers are bin/host wrappers.

Release decisions:

- `./vite` exports low-level manifest and virtual-module helpers as expert
  public because CI scripts, starter generators, and agent tooling need to run
  the same graph and diagnostics code as the plugin.
- The root `StartRequestHandler` is the Promise host-boundary request handler
  returned by `createRequestHandler`; the Vite-only synchronous-or-async SSR
  module handler is `StartSsrRequestHandler`.
- `StartRequestTrace` is intentionally structural with
  `DevtoolsRequestTrace`. Keep type-test coverage so Start can emit devtools
  facts without depending on `@effect-ui/devtools`.

### `@effect-ui/start-node`

The root export includes the Node HTTP adapter facade:

- `createNodeHandlerEffect`, `createNodeHandler`,
  `nodeRequestToWebRequestEffect`, `nodeRequestToWebRequest`,
  `writeNodeResponseEffect`, `writeNodeResponse`, `nodeRequestOrigin`, and the
  related Node adapter types.

Release decisions:

- Keep the package as a thin facade over `@effect-ui/start/adapters` so Node
  users have an obvious install/import path without duplicating adapter logic.

### `@effect-ui/start-fetch`

The root export includes the generic Fetch-host adapter facade:

- `toFetchHandlerEffect`, `toFetchHandler`, and the related Fetch handler
  types.

Release decisions:

- Keep the package as a thin facade over `@effect-ui/start/adapters` so Fetch,
  edge-style, and test hosts can use a host-shaped import while sharing the
  same tested adapter implementation.

### `@effect-ui/db`

The root export includes:

- `Collection`, `Query`, live query types, collection snapshots, hydration, and
  persistence configuration;
- sync adapters, server collection helpers, SQLite persistence helpers, and
  background flush policies;
- collection store diagnostics and events for devtools.

Release decisions:

- SQLite helper names are expert public storage-adapter APIs. Keep them because
  local-first recipes need a SQLite-shaped seam without a runtime dependency on
  a specific SQLite package.
- Mutation, transaction, event, and store diagnostic types are expert public for
  tests, devtools, persistence, and sync adapters. App code should use
  `Collection` namespace operations instead of constructing those records
  manually.

### `@effect-ui/devtools`

The root export includes:

- `makeDevtoolsStore`, snapshot APIs, summary APIs, causal graph APIs, and
  panel APIs with Effect wrappers;
- `renderDevtoolsPanelsHtml`, `renderDevtoolsPanelsHtmlEffect`,
  `mountDevtoolsPanels`, `mountDevtoolsPanelsEffect`, and
  `devtoolsPanelStyles` for dependency-light browser panel rendering;
- JSON-safe serialization helpers;
- invalidation plans, route plans, app graph diagnostics summaries, runtime
  event models, collection event models, and request trace models.

Release decisions:

- `DevtoolsRequestTrace` is public as a data contract. Start emits a compatible
  shape through `onRequestTrace`, with cancellation and failure-path coverage in
  Start request tests.
- `DevtoolsSummary`, `DevtoolsCausalGraph`, and the first `DevtoolsPanels`
  model should be treated as stable data contracts for agents and UI panels.
- The browser panel renderer is public as an embedded UI surface, while
  dedicated app or extension packaging remains a separate release-engineering
  concern.

### `@effect-ui/solid`

The root export includes:

- `RuntimeProvider`, `createEffectRuntime`, `useRuntime`, component scopes, and
  core re-exports used by Solid apps;
- router APIs: `createBrowserRouter`, `RouterProvider`, `RouterOutlet`,
  `useRouter`;
- hooks for signals, streams, resources, suspense, and actions.

Release decisions:

- Keep core re-exports for Solid ergonomics. Documentation should still name
  `@effect-ui/core` as the owner of Resource, Action, Route, Signal, Form,
  Capability, and runtime semantics so app code can move across adapters.

### `@effect-ui/solid-db`

The root export includes:

- `useCollection`, `useLiveQuery`, collection/live-query handles, and preload
  options;
- `Collection` and `Query` re-exports for adapter-local ergonomics.

Release decisions:

- Keep `Collection` and `Query` re-exports because `@effect-ui/solid-db` is the
  Solid DB entrypoint. Docs should present direct `@effect-ui/db` imports for
  adapter-independent domain modules.

### `@effect-ui/tsrx`

The root export includes:

- `effectUiTsrx(options)` and the default export for TSRX/Solid Vite setup.

Release decisions:

- Keep `@effect-ui/tsrx` as the one-call TSRX/Solid preset for starters and
  examples. Advanced apps can compose `effectUiStart` and `vite-plugin-solid`
  manually when they need plugin ordering control.

## Cross-Package Release Notes

- Every package is still marked `"private": true`; publication work must decide
  which packages become public and whether names stay under `@effect-ui/*`.
- Package manifests now include `description`, `main`, `types`, `files`, and
  `sideEffects` metadata for publish readiness while retaining `private: true`.
- Current package manifests mostly expose one root path per package. This is a
  good default; avoid adding subpath exports unless they reduce build/runtime
  coupling.
- Tests and examples import package roots through workspace aliases. Do not
  document source-file imports as public API.
- Future API-tightening passes should add new open questions as explicit
  release decisions or concrete follow-up work instead of leaving exported
  symbols in an ambiguous state.
