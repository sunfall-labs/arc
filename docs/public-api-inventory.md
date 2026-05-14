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

Needs release decision:

- Type IDs such as `ActionTypeId`, `ResourceTypeId`, and `RuntimeTypeId` are
  useful for diagnostics, but should be documented as expert public or hidden.
- Low-level mutable runtime accessors such as `getCurrentRuntime` should stay
  expert public only if docs explain when library authors need them.

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
- `./diagnostics-report` owns grouped repair reports with owner/edit guidance.
- `./adapters` owns Node/fetch adapter conversion and response writing.
- `./virtual` owns virtual module typings only.

Needs release decision:

- `./vite` exports many low-level manifest and virtual-module helpers. Keep
  them public only if CI, starters, or agent tooling are expected to call them
  directly.
- `StartRequestHandler` exists in both root and `./vite` with different return
  shapes. Rename or scope one before public release if this causes confusion.
- `StartRequestTrace` is intentionally structural with
  `DevtoolsRequestTrace`. Keep type-test coverage so Start can emit devtools
  facts without depending on `@effect-ui/devtools`.

### `@effect-ui/db`

The root export includes:

- `Collection`, `Query`, live query types, collection snapshots, hydration, and
  persistence configuration;
- sync adapters, server collection helpers, SQLite persistence helpers, and
  background flush policies;
- collection store diagnostics and events for devtools.

Needs release decision:

- SQLite helper names currently expose implementation detail. Keep them as
  expert public if local-first recipes depend on them.
- Mutation and transaction types are valuable for tests and sync adapters, but
  docs should distinguish app-facing calls from adapter-author contracts.

### `@effect-ui/devtools`

The root export includes:

- `makeDevtoolsStore`, snapshot APIs, summary APIs, causal graph APIs, and
  panel APIs with Effect wrappers;
- JSON-safe serialization helpers;
- invalidation plans, route plans, app graph diagnostics summaries, runtime
  event models, collection event models, and request trace models.

Needs release decision:

- The newly added `DevtoolsRequestTrace` model is public as a data contract.
  Start now emits a compatible shape through `onRequestTrace`; cancellation and
  failure-path hardening remain release-candidate follow-up work.
- `DevtoolsSummary`, `DevtoolsCausalGraph`, and the first `DevtoolsPanels`
  model should be treated as stable data contracts for agents and UI panels.

### `@effect-ui/solid`

The root export includes:

- `RuntimeProvider`, `createEffectRuntime`, `useRuntime`, component scopes, and
  core re-exports used by Solid apps;
- router APIs: `createBrowserRouter`, `RouterProvider`, `RouterOutlet`,
  `useRouter`;
- hooks for signals, streams, resources, suspense, and actions.

Needs release decision:

- Core re-exports are ergonomic, but docs should name `@effect-ui/core` as the
  owner of those APIs to avoid adapter lock-in.

### `@effect-ui/solid-db`

The root export includes:

- `useCollection`, `useLiveQuery`, collection/live-query handles, and preload
  options;
- `Collection` and `Query` re-exports for adapter-local ergonomics.

Needs release decision:

- Keep the re-exports if docs present this as the Solid DB entrypoint; otherwise
  direct users to import data primitives from `@effect-ui/db`.

### `@effect-ui/tsrx`

The root export includes:

- `effectUiTsrx(options)` and the default export for TSRX/Solid Vite setup.

Needs release decision:

- This package is intentionally small. Before release, document when to use
  `@effect-ui/tsrx` versus composing `effectUiStart` and `vite-plugin-solid`
  manually.

## Cross-Package Release Notes

- Every package is still marked `"private": true`; publication work must decide
  which packages become public and whether names stay under `@effect-ui/*`.
- Package manifests now include `main`, `types`, `files`, and `sideEffects`
  metadata for publish readiness while retaining `private: true`.
- Current package manifests mostly expose one root path per package. This is a
  good default; avoid adding subpath exports unless they reduce build/runtime
  coupling.
- Tests and examples import package roots through workspace aliases. Do not
  document source-file imports as public API.
- The next API-tightening pass should convert each "needs decision" note into
  either a docs paragraph, a rename, or an internal-only removal.
