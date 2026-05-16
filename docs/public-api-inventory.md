# Public API Inventory

Last updated: 2026-05-15.

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
| `@effect-ui/start` | `./adapters` | `packages/start/src/adapters.ts` | Public | Keep as the compatibility facade for Node/fetch host integration. |
| `@effect-ui/start` | `./fetch-adapter` | `packages/start/src/fetch-adapter.ts` | Expert public | Keep as the fetch-only host adapter surface for bundle-sensitive hosts. |
| `@effect-ui/start` | `./node-adapter` | `packages/start/src/node-adapter.ts` | Expert public | Keep as the Node HTTP host adapter surface for server integrations. |
| `@effect-ui/start` | `./virtual` | `packages/start/src/virtual-modules.d.ts` | Expert public | Keep as type-only virtual module declarations. |
| `@effect-ui/start` | `effect-ui-start` bin | `packages/start/src/cli.ts` | Expert public | Keep for app graph diagnostics automation. |
| `@effect-ui/start-node` | `.` | `packages/start-node/src/index.ts` | Public | Keep as the Node HTTP adapter facade. |
| `@effect-ui/start-fetch` | `.` | `packages/start-fetch/src/index.ts` | Public | Keep as the generic Fetch-host adapter facade. |
| `@effect-ui/db` | `.` | `packages/db/src/index.ts` | Public | Keep as the collection/live-query surface. |
| `@effect-ui/devtools` | `.` | `packages/devtools/src/index.ts` | Public | Keep as the JSON-safe inspection contract. |
| `@effect-ui/react` | `.` | `packages/react/src/index.ts` | Public | Keep as the React adapter surface. |
| `@effect-ui/react-db` | `.` | `packages/react-db/src/index.ts` | Public | Keep as the React collection adapter surface. |
| `@effect-ui/solid` | `.` | `packages/solid/src/index.ts` | Public | Keep as the Solid adapter surface. |
| `@effect-ui/solid-db` | `.` | `packages/solid-db/src/index.ts` | Public | Keep as the Solid collection adapter surface. |
| `@effect-ui/tsrx` | `.` | `packages/tsrx/src/index.ts` | Public | Keep as the Vite/TSRX preset. |

## Type-Test Coverage

Public import-path type coverage is owned by
`type-tests/public-api.manifest.json`. Each package export maps to its source
file, this inventory, and a focused `type-tests/*.test-d.ts` file; package
bins may omit an import-shaped type test only with an explicit reason. The
public API inventory audit verifies the manifest against package
`exports`/`bin` maps and checks that each focused type-test file imports the
entrypoint it claims to cover. It also checks that every package root barrel's
local re-exported modules are named in that package's Source Surface section so
hover/LSP docs cannot drift from exported source files. The broad
`type-tests/framework.test-d.ts` file remains as cross-package integration
coverage.

## Source Surface By Package

### `@effect-ui/core`

The root export star-exports these modules:

- `action`, `action-result`, `action-submission`, `app`, `capability`
- `browser-router`, `definition-registry`, `effect-like`, `form`, `program`, `read`,
  `request-context`
- `resource`, `resource-registry`, `resource-snapshot-codec`,
  `resource-store`, `resource-ui-binding`, `route`, `route-grammar`
- `runtime`, `scope`, `server`, `signal`, `stable-stringify`

Golden-path public groups:

- `defineApp`, `route`, `Route`, `Resource`, `Action`, `ActionResult`,
  `Program`
- `Server`, `ServerClient`, request/response context services
- `Signal`, `Form`, `Capability`, `UiScope`
- `makeRuntime`, `runWithRuntime`, `runFork`, `EffectUiRuntime.provide(...)`,
  `AnyEffectUiRuntime`
- `Resource.requestFamily` for Resource state backed by Effect
  `RequestResolver` batching/deduping.
- `Resource.deleteEffect(ref)` for explicit Effect-first removal from the
  active Resource Store when tests, adapters, or cache policies need to drop a
  ref before GC.
- `Action.planInvalidationEffect(...)` for adapters/tests that need action
  invalidation planning with synchronous `invalidates` callback throws reported
  as `EffectInputCallbackError`.

Release decisions:

- Type IDs such as `ActionTypeId`, `ResourceTypeId`, and `RuntimeTypeId` are
  expert-public structural markers. They are intended for diagnostics,
  adapter authors, and test utilities that need framework identity checks; app
  code should prefer guards and namespace helpers such as `Action.is`, `Resource`
  APIs, `Signal.isSignal`, and `Form` helpers.
- Type IDs are backed by `Symbol.for(...)` runtime values while preserving
  `unique symbol` declarations through self-type assertions.
- Low-level runtime accessors such as `getCurrentRuntime` are expert public for
  adapter and hook authors that must bridge into the active Runtime Spine. App
  code should use explicit runtime providers, `makeRuntime`, `runWithRuntime`,
  or adapter hooks such as Solid's `useRuntime`.
- `makeRuntimeUiScope(...)` is the expert-public UI lifetime factory for
  framework adapters. It creates a `UiScope` whose late finalizers run through
  the owning Runtime Spine, keeping component, route, and preload cleanup on
  the same Effect runner as the work they own.
- `EffectUiRuntime<R, ER>` is the typed Runtime Spine: `provide(...)` removes
  only services actually present in `R` plus the Resource Store, and
  `runFork(...)`/`runSync(...)` only accept Effects whose requirements are
  satisfied by that runtime. `AnyEffectUiRuntime<ER>` is the explicit Erased
  Runtime Runner host seam for Solid contexts, platform adapters, and ambient
  runtime plumbing where TypeScript cannot name the app's concrete service set.
  Host boundaries that must resolve a platform Promise should call
  `Effect.runPromise(runtime.provide(...))` at the adapter seam rather than
  adding Promise runners to the Runtime Spine.
- `ResourceStore` is an expert-public runtime diagnostic Interface. Use its
  `eventBus`, `moduleRegistry`, `fiberRegistry`, and `diagnostics` seams for
  tests, adapters, and devtools-style inspection. Raw entry, input, cache,
  module, tag index, event queue, and fiber collections are intentionally
  internal implementation state.
- `Route.preloadEffect(...)`, `Route.planPreloadEffect(...)`, and
  `Route.planNavigationEffect(...)` preserve the service requirements declared
  by route preload Effects. Planning Effects also expose
  `ResourceSnapshotCodecError` when touched resources cannot be serialized into
  hydration payloads. Solid and Start adapters may discharge service
  requirements only by running through a Runtime Spine.
- Route grammar parsing rejects invalid and duplicate path parameter names at
  the grammar seam, so match results cannot silently collapse repeated params.
- `browser-router` is an expert-public Browser Router Kernel and Browser
  History Adapter Module. React and Solid router Adapters use it for shared
  route matching, preload state, link click/preload policy, current-href reads,
  external history listeners, and programmatic history commits. The
  `BrowserRouterHostController` facade binds the Kernel to a History Adapter
  and owns idempotent start/dispose plus commit forwarding; framework adapters
  keep only reactivity projection and host owner cleanup. App code should
  usually use framework router exports, while tests and future adapters can use
  `createBrowserRouterHostController(...)`,
  `makeMemoryBrowserHistoryAdapter(...)`,
  `makeWindowBrowserHistoryAdapter(...)`, and the browser-router types directly.
- Browser router link decisions live in Core so framework adapters share the
  same hover/click meaning. `browserRouterLinkPreloadDecision(...)`,
  `browserRouterLinkClickDecision(...)`, `BrowserRouterLinkPreloadDecision`,
  `BrowserRouterLinkClickDecision`, and `BrowserRouterLinkIgnoreReason` are
  expert-public for React, Solid, tests, and future adapters; app code should
  normally keep using framework `RouterLink` components.
- Browser route render decisions live in Core so framework adapters share the
  same outlet state meaning. `browserRouteRenderDecision(...)`,
  `browserRouteRenderKey(...)`, `BrowserRouteOutletRenderers`,
  `BrowserRouteReadyRenderProps`, and `BrowserRouteRenderDecision` are
  expert-public for React, Solid, tests, and future adapters; app code should
  normally keep using framework router outlets.
- `Action.use(definition, { runtime })` is a runtime-bound action instance:
  services provided by the explicit runtime are removed from `submitEffect(...)`
  requirements, and the runtime error channel is added to the action error
  surface. Calling `Action.use(definition)` without an explicit runtime
  preserves the action's original requirements.
- The internal Action Execution Workflow Module owns callback normalization,
  retry wrapping, optimistic transaction commit/rollback, stale-submission
  interruption, invalidation planning/execution, and visible submission state
  updates for one `Action.use(...)` instance. The public `Action.use(...)`
  facade keeps runtime binding and requirement subtraction local, so LSP hovers
  still show the action requirements after any explicit Runtime Spine is
  applied.
- `Capability.useEffect(...)` is public with explicit pure-value and
  Effect-returning overloads; Promise-returning callbacks remain rejected so
  host async work is routed through Effect primitives.
- `Program` is the public headless frontend loop for centralized model/message
  state. `Program.define(...)` accepts a pure initial model, an
  Effect-returning `update(model, message)` callback, Effect commands, and
  Stream subscriptions. `Program.start(...)` runs against the active Runtime
  Spine and UI scope, reports typed update/command/subscription failures through
  a signal, exposes a bounded `timeline` signal for message, command,
  subscription, failure, and disposal events, and keeps `dispatchEffect(...)`
  composable for tests and workflows. Definitions may set `name` and
  `timeline.limit` for devtools-friendly retention.
  `Program.RuntimeError<E, ER = never>` separates Program-domain failures from
  Runtime Spine startup/provision failures; Solid and React adapters expose the
  same `ER` parameter on `useProgram(...)`.
  `Program.step(...)` and `Program.story(...)` are the deterministic test
  surface: they run updates as Effects, expose returned commands without running
  them implicitly, and let tests resolve commands back into typed messages.
- `Form.decodeFormDataEffect(...)` decodes browser `FormData` through Effect
  Schema and maps schema failures to typed `Form.ValidationError` values.
  `Form.data(...)` is the explicit intermediate object conversion, preserving
  repeated field names as arrays and allowing framework hidden fields to be
  omitted before decoding.
- `ServerClient.call(...)` preserves the target server function's requirement
  type in its returned Effect. Browser RPC clients can still satisfy that with
  `never`, while local/mock clients can run functions that depend on test or app
  services. `Server` schema encode/decode, RPC envelope parsing, manifest
  schema-presence projection, and defect/server-error serialization now delegate
  to the internal Server Wire Codec Module so local clients, mocks, and Start
  transports share one wire policy. Mock/local clients also round-trip domain
  failures through the function error schema; client-side failures such as
  `EffectInputCallbackError`, schema errors, and transport errors stay in the
  client error channel.
- `Resource.LoadError<E>` is public hover vocabulary for Resource state,
  status, `prefetchEffect(...)`, `refreshEffect(...)`, and Solid/React
  resource handles. It means the declared load error `E` plus
  `EffectInputCallbackError` from synchronous `load`/`provides` callback
  throws.
- `ResourceKeyError` is public hover vocabulary for the default Resource key
  codec. It tells callers when JSON-compatible values plus Date, URL, Map, and
  Set are not enough and an explicit `key` callback is required.
- Synchronous Resource `status(...)` and `read(...)` helpers are public
  render-seam APIs, but stale/GC decisions use the active Runtime Spine clock
  so they agree with Effect reads under custom `Clock` services.
- `Resource.readEffect(...)` is the public Effect-first read Interface for
  already-loaded refs. Missing, pending, collected, and failed states stay in
  typed Effect failure channels instead of escaping as render-control throws.
- Resource dehydrate and hydration payload Effects now schema-encode inputs and
  success values before they cross snapshot seams, so Start, Solid, and tests
  observe the same wire policy as hydrate.
- `resource-ui-binding` is an expert-public Resource UI Binding Controller
  Module for framework adapters. It owns Resource ref identity, runtime-bound
  refresh/prefetch Effects, automatic preload fibers, keyed preload failures,
  observer failure swallowing, stale preload interruption, and Suspense
  preload-token dedupe. React and Solid still own host reactivity and host
  Suspense throwing.
- `action-submission`, `definition-registry`, `resource-registry`,
  `resource-snapshot-codec`, `resource-ui-binding`, and `route-grammar` are
  expert-public Modules.
  They are stable enough for adapters, diagnostics, generated manifests, and
  tests to import from `@effect-ui/core`, while app code should generally use
  the higher-level `Action`, `Resource`, `Route`, `Server`, and `defineApp`
  facades.

### `@effect-ui/start`

The root export includes:

- Local source modules: `action-manifest`, `agent-graph`, `app-graph`,
  `diagnostics-report`, `effect-rpc-compat`, `file-route`,
  `file-route-modules`, `file-routes`, `hydration`, `render-hydration-plan`,
  `request-trace`, `rpc`, `server-function-manifest`,
  `start-action-client`, `start-action-request-codec`,
  `start-collection-resolution`, `start-fetch`, `start-request-handler`,
  `start-rpc-client`, `start-transport-endpoints`,
  `start-transport-protocol`, and `streaming`.
- hydration, streaming, server-function manifest, action manifest, app graph,
  agent graph, diagnostics report, file-route module helpers, and file-route
  definitions;
- hydration error contracts: `StartHydrationError`,
  `StartHydrationChunkParseError`, `StartHydrationPayloadParseError`, and
  `StartHydrationPayloadSerializeError`;
- hydration DOM Adapter contracts: script ids, streamed chunk marker
  attributes, minimal document/element shapes, raw script readers, and consumed
  chunk marking helpers used by the Effect-first hydration workflow;
- hydration serialization and read helpers keep their synchronous exports for
  browser boot scripts, but those exports are facades over the Effect-first
  parse/decode/encode/read transport helpers so sync and Effect APIs share the
  same typed error policy.
- streaming helpers include `responseWithStreamFinalizer(...)` plus
  `StartResponseStreamFinalizeEvent` for adapters that need to observe Web
  response body close/error/cancel without mixing `ReadableStream` mechanics
  into request-runtime lifecycle code.
- streamed render helpers include `StartRenderHydrationPlan` and
  `createStartRenderHydrationPlanEffect(...)`, the supported Interface for
  root hydration payload/script plus streamed resource chunks.
  `createStartStreamedHtmlResponseEffect(...)` is the starter/doc helper that
  appends those streamed hydration chunks before the response tail.
- `StartRenderContext.hydrationRootScript` is the streamed renderer's root-only
  script from `StartRenderHydrationPlan.root.script`; `legacyHydrationScript`
  is the explicit full non-streaming payload for renderers that are not
  emitting streamed hydration chunks. `hydrationScript` remains as a deprecated
  compatibility alias.
- request handler APIs: `createRequestHandler`, `createRequestHandlerEffect`,
  `createServerHandler`, `preloadRequest`, `preloadRequestEffect`, and the
  `onRequestTrace` hook;
- request preload and handler Effects preserve route preload service
  requirements that are not supplied by the app server Runtime Spine. The
  Effect-first fetch and Node adapters infer and keep those requirements visible
  until a host runtime or callback/Promise facade explicitly owns the seam;
  partial adapter generics are rejected rather than defaulting missing
  requirements to `unknown`.
- The internal Request Runtime Lifecycle Module owns the completion policy after
  a Start response Effect is selected: failure/interruption teardown,
  ResponseContext application, request trace emission, Request Runtime disposal,
  and streamed response finalization. It is not exported; public access remains
  `createRequestHandler`, `createRequestHandlerEffect`, and the host adapters.
- The internal Start Host Runtime Runner owns the final Effect-to-host runtime
  seams for Promise-shaped Fetch/Vite facades and callback-shaped Node/Vite
  facades. It is not exported; public host adapter APIs remain unchanged, and
  `StartForkRuntime` stays re-exported from the Node adapter for callback
  hosts.
- transport APIs: RPC/action paths, request-id and trace headers, media-type
  helpers, and browser RPC/action clients;
- expert-public transport validators and endpoint builders:
  `validateStartRpcRequestEffect`, `validateStartRpcResponseEffect`,
  `validateStartActionRequestEffect`, `validateStartTransport*Effect`,
  `startTransportDiagnosticsEffect`, `startTransportEndpointEnvelopeEffect`,
  `withStartTransportDiagnostics`, `resolveStartTransportEndpoints`,
  `resolveStartRpcEndpoint`,
  `resolveStartActionEndpoint`, `isStartRpcEndpointRequest`, and
  `isStartActionEndpointRequest`,
  `createServerRpcResponseEffect`, and `createServerActionResponseEffect`.
  These are for adapters, tests, and diagnostics that need the same transport
  policy as Start internals; normal apps should use `Server.fn(...)`,
  `StartAction`, `makeRpcClient(...)`, and `createRequestHandler(...)`.
- `startTransportEndpointEnvelopeEffect(...)` is expert public for adapters and
  tests that need the same request-id, transport-kind, trace-header, and
  diagnostics-header policy as the built-in RPC/action endpoints. Request traces
  and response diagnostics consume this one envelope so generated request ids
  stay aligned.
- `StartFetch<E, R>` preserves both the fetch error and fetch Effect
  requirements. Browser/action clients can receive `runtime` or
  `transportRuntime` when auth, tracing, or tests provide transport services.
- RPC clients/layers cannot expose fetch requirements through the core
  `ServerClient` Interface, so a service-backed `StartFetch<E, R>` requires an
  explicit `transportRuntime`. Start action submission remains effect-first:
  without a runtime, transport requirements stay in the returned Effect; with
  `runtime` or `transportRuntime`, the returned Effect is requirement-free.
- RPC/action client status validation delegates to the shared Start Transport
  Status Policy so semantic transport bodies and HTTP statuses cannot drift
  between server functions and actions.
- form bridge APIs: `startActionForm`, `StartAction`, and transport result
  types.
- `StartActionFormEncodeError` is public hover vocabulary for the synchronous
  progressive form facade when schema-backed defaults cannot be encoded.
- request trace types: `StartRequestTrace`, request/response/resource/
  collection/action/server-function/fiber/stream trace records, and
  `StartRequestTraceHandler`.
- Effect-native observability metrics:
  `startRequestCountMetric`, `startRequestDurationMetric`, and
  `startRequestStatusMetric`.
- Effect RPC compatibility descriptors:
  `serverFunctionToEffectRpc`, `makeStartEffectRpcGroup`, and
  `makeStartEffectRpcCompatibilityArtifact`.
- Generated route artifact helpers:
  `createFileRouteDefinitionsModule`, `createFileRouteModuleReferences`,
  `createFileRouteCompanionModuleReferences`,
  `defaultGeneratedFileRouteDefinitionsHeader`, and related file-route manifest
  types. The written `routeTree.gen.ts` file is the app-specific LSP surface
  for literal route ids, route paths, route-specific match types, direct
  `hrefById(...)` / `hrefByPath(...)` helpers, the `isRoutePathMatch(...)`
  guard, layout/error/metadata companion maps, and href option maps.
- File-route authoring helpers: `defineFileRoute`,
  `DefineFileRouteBuilder`, `FileRoutePreloadResource`, and
  `FileRoutePreloadOptions`. The builder keeps schema params/search, resource
  preload selectors, collection preload metadata, and custom preload Effects in
  one route-local API. `defineFileRoute(path).preload(...).route(...)` is the
  spread-free authoring path; the preload object remains spreadable for existing
  modules. Collection preload metadata accepts concrete definitions or stable
  collection names; request preload and hydration resolve those names through
  `StartCollectionResolutionOptions` (`collections`, `resolveCollection`, or
  `collectionRegistry`) without falling back to process globals implicitly.

Subpath exports:

- `./vite` owns `effectUiStart`, file route discovery, virtual module creation,
  build-policy validation, app graph diagnostics loading, and SSR dev handling.
  `effectUiStart` returns the concrete `EffectUiStartPlugin` interface rather
  than a broad Vite `PluginOption`, and its SSR module handler type is named
  `StartSsrRequestHandler` so it cannot be confused with the root Effect
  request handler. Dev SSR handler Effects must be fully provided before they
  are returned to Vite because the dev middleware does not own app services; the
  default Vite loader surface is requirement-free after request Scope
  provisioning, while expert `StartDevServer<R>` helpers preserve remaining app
  service requirements until the caller provides them. It also exports the
  generated route definitions file writer:
  `writeFileRouteDefinitionsFile(...)` for Vite sync hooks and
  `writeFileRouteDefinitionsFileEffect(...)` plus
  `FileRouteDefinitionsFileWriteFailure` for typed route-generation and
  filesystem diagnostics. Its diagnostics loading exports are implemented by
  the internal Start Vite Diagnostics Loader Module, so CLI/CI/build-gate
  temporary Vite server lifetime and diagnostics DTO decoding share one
  Effect-first policy while the public `./vite` Interface stays stable.
- `./diagnostics-report` owns grouped repair reports with owner/edit guidance.
- `createStartAgentGraph(...)`, `queryStartAgentGraph(...)`,
  `createStartAgentGraphImpact(...)`, `formatStartAgentGraphImpact(...)`, and
  `formatStartAgentGraph(...)` project resolved Start diagnostics into typed
  agent-readable route/action/resource/collection/module/finding facts and
  high-signal edit impact briefs. The package binary exposes the same
  projection through `effect-ui-start graph` and `effect-ui-start impact`, with
  concise text by default, raw graph detail behind `--verbose`, and complete
  machine payloads behind `--json`.
- `./adapters` is a compatibility facade that re-exports the host-specific
  fetch and Node adapter Modules.
- `./fetch-adapter` owns fetch-only request handler conversion and carries no
  Node imports. `toFetchHandlerEffect(...)` is the canonical Effect v4 adapter
  and preserves handler service requirements. `createFetchHandler(...)` remains
  a compatibility host facade for Fetch-style platforms that require
  `(request) => Promise<Response>`.
- `./node-adapter` owns Start Node handler invocation and Node HTTP server
  callback wiring. It re-exports expert-public Node Web Exchange helpers for
  compatibility: Node request origin reconstruction, Web Request conversion,
  Web Response writing, and `StartNodeAdapterError` values. Effect-first Node
  handlers preserve Start handler service requirements, and Node server error
  hooks accept pure values or Effects, not Promise-shaped callbacks.
- `./virtual` owns virtual module typings only.
- `effect-ui-start` owns diagnostics and agent graph CLI execution. Its
  bin/host wrapper defines the command tree with Effect v4 `Command`, `Flag`,
  and `Argument` primitives, including graph/impact query-kind subcommands and
  inherited graph `--verbose` shared-flag context. The internal Start
  Diagnostics CLI Contract Module owns the shared query-kind catalog,
  validation text, and shell-safe impact verify commands, while the Start
  Diagnostics CLI Runner Module owns parsed command execution, app graph
  diagnostics loading, agent graph/impact projection, output formatting, and
  failure reporting. The
  diagnostics loader acquires the temporary Vite server with
  `Effect.acquireRelease(...)` inside `Effect.scoped(...)`, so CLI and CI
  diagnostics close the Vite resource on success, typed failure, or
  interruption.
- Start action clients parse and decode action responses through the internal
  Start Action Response Codec Module. It owns wire DTOs, response metadata,
  invalidation metadata serialization, response-mode selection, Exit-to-Response
  encoding, client parsing, and typed result decoding; the internal Start Action
  Response Application Module owns invalidation target validation, Resource
  Tag/Ref resolution, hydration, hydrated-ref filtering, and malformed metadata
  transport errors.
- Start Transport Body Readers own the internal Effect v4 boundary around
  one-shot JSON, form-data, and response-text reads for RPC/action transports.
  Transport Protocol consumes those helpers so body stream failures are typed
  before JSON decoding or action form parsing begins.

Release decisions:

- `./vite` exports low-level manifest and virtual-module helpers as expert
  public because CI scripts, starter generators, and agent tooling need to run
  the same graph and diagnostics code as the plugin.
- `EffectUiStartPlugin` is public because tests, CI helpers, and starter tools
  should be able to call the Start Vite plugin hooks without re-narrowing Vite's
  broad `PluginOption` union.
- The root `StartRequestHandler` is the Effect-returning request handler
  returned by `createRequestHandler`; the Vite-only plain-or-Effect SSR module
  handler is `StartSsrRequestHandler`.
- `./vite` keeps dev SSR helpers public from the same import path, but their
  implementation lives behind the Start Vite Dev SSR Adapter Module rather than
  the plugin assembly code.
- Vite dev SSR request conversion accepts the same Node origin and forwarded
  header policy as the Node adapter through `HandleSsrDevRequestOptions` and
  `EffectUiStartOptions.nodeRequest`, so development and production host
  adapters do not disagree about public request URLs.
- `StartRequestTrace` is intentionally structural with
  `DevtoolsRequestTrace`. Keep type-test coverage so Start can emit devtools
  facts without depending on `@effect-ui/devtools`.
- `StartActionInvalidationPlan` is intentionally structural with
  `DevtoolsInvalidationPlan`. Start owns the action transport metadata and
  devtools consumes the serialized plan through `serializedInvalidationPlan`
  without either package importing the other.
- The root re-exports `Action`, `Resource`, `Route`, `Server`, `Signal`,
  `defineApp`, and related Core helpers as starter convenience aliases. Treat
  them as expert-public compatibility exports in inventory and type tests; docs
  for domain Modules should still import Core concepts from `@effect-ui/core`
  so ownership stays clear.
- `virtual:effect-ui/routes` intentionally exposes broad route maps because it
  must type-check before app-specific route generation. Apps and agents that
  need exact literal route ids, paths, params, search, or href options should
  import the written generated route definitions artifact.
- `virtual:effect-ui/app-graph` is a static DTO module for generated route,
  server-function, and action topology. It intentionally does not import route
  implementations. Tooling that needs runtime route-module/resource/collection
  diagnostics should import
  `virtual:effect-ui/app-graph/runtime-diagnostics` explicitly, making that
  heavier Adapter seam visible in the import graph.

### `@effect-ui/start-node`

The root export includes the Node HTTP adapter facade:

- `createNodeHandlerEffect`, `createNodeHandler`,
  `nodeRequestToWebRequestEffect`, `nodeRequestToWebRequest`,
  `writeNodeResponseEffect`, `writeNodeResponse`, `nodeRequestOrigin`, and the
  related Node adapter types. `StartNodeServerErrorHandler` is an EffectInput
  seam for host error rendering.
- `createNodeServerHandler` is the callback-shaped host Adapter for
  `node:http.createServer(...)`. It owns the void/callback host seam and runs
  the Effect-first handler on the configured runtime with `runFork`. The facade
  provides request `Scope.Scope` itself, but requires a typed runtime when the
  handler still needs non-Scope services.

Release decisions:

- Keep the package as a thin facade over `@effect-ui/start/node-adapter` so
  Node users have an obvious install/import path without duplicating adapter
  logic or pulling Node imports into fetch-only bundles.

### `@effect-ui/start-fetch`

The root export includes the generic Fetch-host adapter facade:

- `toFetchHandlerEffect`, `toFetchHandler`, and the related Effect-shaped Fetch
  handler types.
- `toFetchHandlerEffect` and `toFetchHandler` are the canonical Effect v4
  adapter APIs for Fetch-style hosts.
- `createFetchHandler` is kept as a compatibility host Adapter for
  Fetch-native platforms whose exported handler contract is fixed to
  `(request) => Promise<Response>`. It owns the final runtime seam by running
  the Effect-first handler on the configured runtime; library internals should
  continue to use `toFetchHandlerEffect` when they can stay inside Effect. The
  facade provides request `Scope.Scope` itself, but requires a typed runtime
  when the handler still needs non-Scope services.

Release decisions:

- Keep the package as a thin facade over `@effect-ui/start/fetch-adapter` so
  Fetch, edge-style, and test hosts can use a host-shaped import while sharing
  the same tested, Node-free adapter implementation.

### `@effect-ui/db`

The root export includes:

- Local source modules: `change-feed-dispatcher`, `collection-contract`,
  `collection-errors`, `collection-ids`, `collection-index-materialization`,
  `collection-persistence`, `collection-preload`,
  `collection-reactive-binding`, `collection-registry`,
  `collection-snapshot-codec`, `collection-state`, `flush-policy`,
  `live-query-collection`, `query-builder`, `query-plan`, `server-collection`,
  and `sqlite-persistence`.
- `Collection`, `Query`, live query types, collection snapshots, hydration, and
  persistence configuration;
- sync adapters, server collection helpers, SQLite persistence helpers, and
  background flush policies;
- collection store diagnostics and events for devtools.

Release decisions:

- SQLite helper names are expert public storage-adapter APIs. Keep them because
  local-first recipes need a SQLite-shaped seam without a runtime dependency on
  a specific SQLite package. `sqlite-persistence.ts` owns the statement value,
  params, row, database, prepared-statement, and memory contracts; the DB root
  only aliases them under `Collection.*` for namespace ergonomics.
- Mutation, transaction, event, and store diagnostic types are expert public for
  tests, devtools, persistence, and sync adapters. App code should use
  `Collection` namespace operations instead of constructing those records
  manually.
- `persistedCollectionOptions(...)` remains a top-level and
  `Collection.persistedOptions(...)` public helper, but the implementation and
  LSP docs live with `collection-persistence.ts` so persistence storage error
  and requirement channel unioning has one owner.
- `Collection.StoreDiagnostics` and
  `Collection.StoreDiagnosticsSnapshot` are the public runtime-local diagnostic
  view over a Collection Store. They expose counts for registered collections,
  rows, pending/active optimistic mutations, optimistic rows, loading states,
  and failures without exposing mutable row/index maps.
- The Runtime Collection Store Module owns runtime/request-local store creation,
  Resource Store module-registry lookup, initial data materialization,
  diagnostics snapshots, event subscriptions, and synchronous store override
  locality. It remains internal; public access stays through
  `Collection.storeEffect()`, `Collection.currentStore()`, and
  `Collection.subscribeEventsEffect()`.
- Collection Runtime intentionally owns the public Collection facade, direct
  writes, change-feed batch application, row metadata, hydration/persistence
  facades, event publication, and live-query-visible versioning together while
  delegating store lookup/lifecycle to the Runtime Collection Store Module,
  load/refetch ordering to the Collection Sync Load Policy Module, and queued
  optimistic mutation execution to the Collection Mutation Workflow Module. Sync
  adapters emit batches and loader/mutation Effects; they do not own store
  mutation or in-flight load policy.
- The internal Collection Sync Load Policy Module owns `preloadEffect(...)` and
  `refetchEffect(...)` orchestration: in-flight `Deferred` ownership/joining,
  stale generation checks, restore-before-load, load/refetch selection, retry
  scheduling, row replacement, load lifecycle events, and load persistence. It
  is not exported; public access remains the same Collection load/refetch
  Effects.
- The internal Collection Mutation Workflow Module owns `insertEffect(...)`,
  `updateEffect(...)`, `deleteEffect(...)`, and `flushPendingMutationsEffect()`
  orchestration: mutation row ingress, transaction construction, handler DTO
  detachment, active `Deferred` attempt joining, retry scheduling, optimistic
  commit/rollback, mutation lifecycle events, mutation persistence, and restored
  pending replay. It is not exported; public access remains the same Collection
  mutation and flush Effects.
- The internal Collection Change Feed Runtime Module owns scoped feed
  subscription lifecycle, dispatcher consumer fibers, adapter
  subscribe/unsubscribe normalization, default write-option application,
  direct `emit(...)` completion, host-callback `emitChanges(...)` queueing, and
  asynchronous failure publication. It receives store-local row-application and
  event-publication Effects from Collection Runtime, so subscription lifecycle
  is separated from mutable row mutation policy without adding a public API.
- The internal Collection Write Commit Module owns direct-write atomicity:
  snapshot state, apply row changes, persist, restore on persistence failure,
  and publish `CollectionWritten` only after persistence succeeds. The public
  write APIs and `Collection.applyChangesEffect(...)` keep the same facade.
- The internal Live Query Collection Materialization Module owns per-store
  derived projection state for `Collection.liveQuery(...)`: keyed rows, lookup
  maps, secondary-index buckets, state/version signals, `Ready.updatedAt`, and
  snapshots. It is not exported; public access remains the read-only
  `Collection.liveQuery(...)` facade and regular Collection read interfaces.
- The internal Collection Query Source Adapter owns how Query Builder, Query
  Plan, Live Query State, and Live Query Runtime read from Collection
  Definitions and Live Query Collections: rows, row counts, indexes, version
  and state signals, and preload/refetch Effects. It is not exported; public
  query access remains `Query.*`, `Collection.liveQuery(...)`, and regular
  Collection read interfaces.
- The internal Query Execution Plan Module owns query validation entrypoints,
  source adapter selection, source preload/refetch, snapshot execution,
  diagnostics, and projection stages shared by `Query.build(...).execute()`,
  `Query.onceEffect(...)`, `Query.diagnostics(...)`, and live-query state.
  It is not exported; public Query APIs stay unchanged.
- The internal Collection Value Detachment Module owns deep collection value
  cloning, frozen value/transaction copies, mutation and transaction cloning,
  update-draft detachment, value-change diffing, and public row DTO detachment
  before values cross store, snapshot, live-query, mutation, or adapter seams.
  It is not exported; public Collection row and mutation APIs stay unchanged.
- The expert-public Collection Index Materialization Module owns secondary
  index normalization, lookup-key encoding, duplicate-value dedupe,
  runtime/request-local bucket caches, index row reads, indexed join keys, and
  the `UnknownCollectionIndex` error. Keep the error public for tests and
  adapter diagnostics while normal apps continue to use `Collection.index(...)`,
  `Collection.firstByIndex(...)`, and `Query` joins.
- Multi-collection flush and background sync error channels use
  `CollectionRuntimeError<E>` for each collection, so handler failures, snapshot
  codec failures, and synchronous callback failures stay visible through the
  coordination APIs.
- `CollectionOptions.refetch` is public as the forced-refresh companion to
  `load`. The Collection Runtime owns the first preload versus forced refetch
  selection so shared Collection Definitions remain runtime/request-local.
- Collection and Live Query Collection persistence share the same snapshot
  storage callback policy: synchronous storage throws become
  `EffectInputCallbackError`, while codec failures remain
  `CollectionSnapshotCodecError`.
- Collection hydration helpers share one validation wall: `dehydrateEffect(...)`
  validates the produced payload through the snapshot codec, and
  `validateHydrationPayloadEffect(...)` runs the same definition-owned and
  target-store preflight as `hydratePayloadEffect(...)` without applying rows.
- Collection hydration validation and application share one Collection
  Hydration Plan internally, so validation-only callers and mutating hydration
  callers cannot drift on definition lookup, read-only collection preflight, or
  target-store preflight.
- Live Query Collections materialize through one internal keyed projection for
  rows, lookups, indexes, state, version, and snapshots. Duplicate source rows
  with the same output key follow the public collection last-write semantics,
  and hidden duplicate changes do not bump `version()`/`Ready.updatedAt`.
- Live Query Collections are read-only at the Collection Contract seam.
  `Collection.applyChangesEffect(...)` fails with `ReadonlyCollectionMutation`
  before mutating rows, writing persistence, or publishing write events. Their
  persistence path still shares the normal snapshot helper and emits
  `CollectionPersisted` for devtools and sync observers.
- Change-feed host callbacks run through scoped dispatchers owned by the
  Collection Change Feed Runtime. After the subscription scope releases, late
  `emitChanges(...)` calls are deterministically dropped instead of enqueueing
  into an unconsumed runtime queue.
- SQLite persistence helpers wrap `prepare`/`run`/`all`, statement database,
  driver, storage, and clock callbacks before execution. Their public storage
  error channel therefore includes `EffectInputCallbackError` even for
  synchronous in-memory adapters.
- SQLite statement, prepared-statement, and memory helpers stay colocated as a
  dependency-free helper family. Splitting the file would not create a new
  package seam because public access remains through the DB root and
  `Collection.sqlite*` helpers.
- `Collection.resourceSyncAdapter(...)` returns a sync adapter whose load and
  refetch errors use `Resource.LoadError<E>`, because Resource callbacks can
  fail before the underlying user error channel `E` is reached.
- Collection projection callbacks used by Effect APIs, including `getKey` and
  functional `CollectionUpdate` bodies, fail through `EffectInputCallbackError`
  instead of defects. Synchronous read helpers stay synchronous and should only
  use pure, total projection callbacks.
- Public `Query.Factory<TResult>` annotations default error and requirement
  channels to `never`, not `any`. Serviceful query factories must spell their
  `E`/`R` parameters so `Query.onceEffect(...)`, `Query.live(...)`, and live
  query collections cannot hide collection failures or service requirements.
- The collection reactive binding helpers exported from the DB root are
  expert-public Adapter helpers for React DB, Solid DB, and future framework
  adapters. They own collection source subscription, runtime-bound Effects,
  preload controller generation checks, live-query state error extraction, and
  live-query input/dependency selection; app code should prefer the framework
  adapter hooks.

### `@effect-ui/devtools`

The root export includes:

- Local source modules: `app-graph-normalizer`, `bridge`,
  `devtools-contract`, `panel-contract`, `panel-renderer`, `serialization`,
  and `summary`.
- `makeDevtoolsStore`, snapshot APIs, summary APIs, causal graph APIs, and
  panel APIs with Effect wrappers;
- panel contract ids, severities, guards, and bridge payload normalization:
  `devtoolsPanelIds`, `devtoolsPanelSeverities`, `isDevtoolsPanelId(...)`,
  `isDevtoolsPanelSeverity(...)`, `isDevtoolsSerializableValue(...)`,
  `isDevtoolsPanelMetric(...)`, `isDevtoolsPanelItem(...)`,
  `isDevtoolsPanelOverflowItem(...)`, `isDevtoolsPanel(...)`,
  `isDevtoolsPanels(...)`, and `normalizeDevtoolsPanels(...)` plus
  `normalizeEffectUiDevtoolsBridgePayload(...)`;
- panel contract resolvers and typed diagnostics:
  `resolveDevtoolsPanelContract(...)`, `resolveDevtoolsPanelsInput(...)`,
  `resolveEffectUiDevtoolsBridgePayload(...)`,
  `DevtoolsPanelContractError`, `DevtoolsPanelContractErrorReason`,
  `DevtoolsPanelContractResolution`, and
  `DevtoolsBridgePayloadContractResolution`;
- `renderDevtoolsPanelsHtml`, `renderDevtoolsPanelsHtmlEffect`,
  `mountDevtoolsPanels`, `mountDevtoolsPanelsEffect`, and
  `devtoolsPanelStyles` for dependency-light browser panel rendering;
- `bootDevtoolsPanels(...)`, `interruptDevtoolsPanelBoot(...)`,
  `DevtoolsPanelBoot`, and `DevtoolsPanelBootOptions` for app and extension
  shells that want panel mount, bridge polling, and cleanup managed as
  Effect/Fiber-owned lifecycle work;
- `effectUiDevtoolsBridgeGlobal`, `installDevtoolsBridge`, and
  `installDevtoolsBridgeEffect` for exposing a scoped inspected-window bridge
  to browser extension panels;
- JSON-safe serialization helpers, including the public
  `DevtoolsSerializationPolicy` used to bound arbitrary runtime values and
  redact secret-shaped keys;
- invalidation plans, route plans, app graph diagnostics summaries, runtime
  event models, Program event models, collection event models, and request
  trace models.

Release decisions:

- `DevtoolsRequestTrace` is public as a data contract. Start emits a compatible
  shape through `onRequestTrace`, with cancellation and failure-path coverage in
  Start request tests.
- `devtools-contract` owns the public Devtools DTO and Interface vocabulary
  that renderers, stores, summaries, bridges, and agents share. The root
  import path re-exports it, while internal Devtools modules import the
  contract directly instead of depending on the root facade. Serialization
  policy belongs to this contract too; `serialization.ts` re-exports
  `DevtoolsSerializationPolicy` only as a compatibility alias.
- `DevtoolsInvalidationPlan` is public as an inspection data contract. Start
  emits a compatible `StartActionInvalidationPlan`, and type tests pin the
  structural compatibility so devtools can consume full-stack action metadata
  without importing `@effect-ui/start`.
- `DevtoolsSummary`, `DevtoolsCausalGraph`, and the first `DevtoolsPanels`
  model should be treated as stable data contracts for agents and UI panels.
- `DevtoolsStore` is an explicit public Interface, not an inferred factory
  return. Route-plan and invalidation record methods return retained fact
  indexes for adapters that emit runtime events against duplicate recorded facts.
- Program timeline observation is a first-class store capability:
  `recordProgramEvent(...)`, `recordProgramEventEffect(...)`, and
  `trackProgramEffect(...)` copy public `Program.Event` values into the shared
  runtime event, summary, panel, and causal graph contracts. Store
  `serializationPolicy` options apply before those Program events enter
  snapshots; unnamed tracked Programs receive stable per-store fallback names.
- The browser panel renderer is public as an embedded UI surface, while
  the bridge helpers are public as the supported app-side handshake for checked
  app or extension shells.
- `bootDevtoolsPanels(...)` is the expert-public browser panel boot helper for
  small shells that only want to provide a root element, optional initial panel
  input, and an optional Effectful `afterMount` loop such as extension bridge
  polling. It returns the mounted panel handle plus the boot fiber so shells can
  interrupt cleanup deterministically.
- Panel id/severity guards, finite-number/plain-record JSON validation, bounded
  display and item-data strings, and trap-safe bridge payload normalization live
  in the shared Devtools Panel Contract Module so renderers, app shells, browser
  extensions, tests, and agents do not duplicate runtime validation. The
  contract windows oversized item lists with a deterministic overflow row, so
  valid large app graph panels remain bridgeable.
- `isDevtoolsPanelOverflowItem(...)` is public Panel Contract vocabulary for
  renderers that need to preserve the deterministic overflow row under their
  own display limits without depending on the private id prefix.
- Devtools Panel Contract resolver exports are pinned as public diagnostics
  APIs: `resolveDevtoolsPanelContract(...)`, `resolveDevtoolsPanelsInput(...)`,
  and `resolveEffectUiDevtoolsBridgePayload(...)` return valid DTOs or typed
  diagnostics backed by `DevtoolsPanelContractError` reason/result types instead
  of forcing hosts to collapse malformed panel payloads to `undefined`.
- Raw Devtools snapshots may contain detached `unknown` inspection facts owned
  by Core, Start, DB, or app code. Summaries, causal graphs, panels, and bridge
  payloads are the JSON-safe projections.
- Summary and causal graph projection share the same internal Devtools Summary
  Input Normalization policy. Explicit input overrides beat snapshot fields,
  optional arrays default to empty arrays, and resource indexes are derived from
  the same summarized invalidation, route, runtime-event, and request facts used
  by panels and causal graphs.
- App graph normalizer root exports are expert-public compatibility helpers:
  `normalizeDevtoolsAppGraphDiagnostics(...)`,
  `normalizeRouteModulePreloadCollections(...)`,
  `normalizeAppGraphCollectionDefinitions(...)`, and
  `normalizeAppGraphUnknownRoutePreloadCollections(...)`. Keep them on the
  root import path so extension bridges, generated diagnostics, and tests can
  accept older Start app-graph DTOs while receiving detached current-shape
  copies.
- `normalizeEffectUiDevtoolsBridgePayload(...)` returns detached panel DTOs, not
  inspected-window object references. Hostile getters/proxies can invalidate a
  payload, but a valid normalized payload is bounded and safe for renderers to
  inspect later.
- The checked browser extension example treats inspected-window bridge
  exceptions, invalid bridge payloads, and hung eval callbacks as typed
  transport failures and renders them through the diagnostics panel. Sample
  facts are only the initial/no-bridge fallback, not a replacement for
  transport-error reporting.
- Route-plan causal semantics live behind an internal Route Plan Projection
  Module so standalone route plans and request-embedded route plans produce the
  same `Matches`, `Preloads`, and key-specific `Hydrates` facts.
- Runtime `Invalidation` and `RoutePlan` events target recorded fact indexes
  rather than their own event-array positions, and causal edge ids are derived
  from edge semantics plus duplicate ordinal. Unrelated earlier graph facts
  should not churn stable edge ids or synthesize phantom target nodes.
- Fact Identity stays internal, but Store and Summary share its first-match
  fact index helpers so duplicate invalidation and route-plan facts resolve
  through one Devtools Serialization Policy fingerprint.
- Devtools Store plain methods intentionally remain sync host facades over the
  Effect-first store implementation methods. Do not split them unless a new host
  package needs a distinct seam.
- The root Devtools module remains the public facade; internal Panels and Store
  modules own their concrete projection/copy dependencies directly instead of
  exposing single-adapter runtime injection Interfaces.
- Focused Devtools public type coverage lives in `type-tests/devtools.test-d.ts`.
  Keep pure Devtools Store, panel, bridge, serialization, DTO, and lifecycle
  assertions there; `type-tests/framework.test-d.ts` should keep only
  cross-package compatibility checks with Core, DB, or Start.

### `@effect-ui/react`

The root export includes:

- Local source modules: `hooks`, `link`, `router`, and `runtime`.
- `RuntimeProvider`, `createEffectRuntime`, `useRuntime`, component scopes, and
  core re-exports used by React apps;
- router APIs: `createBrowserRouter`, `RouterProvider`, `RouterOutlet`,
  `RouterLink`, `useRouter`, `BrowserRouterState`, `RouterContextMissing`,
  `RouterRouteNotRegistered`, route/path helper types, and typed route failure
  renderers;
- hooks for signals, streams, programs, resources, suspense, and actions.

Release decisions:

- Keep the first React slice focused on the runtime and data hooks needed to
  make React component ecosystems such as Base UI and shadcn usable inside
  Effect UI apps.
- React hooks expose current values directly, such as `resource.value` and
  `program.model`, instead of Solid-style accessor functions. Effect-returning
  methods remain the shared cross-adapter composition surface.
- React router helpers mirror the Solid route helper surface while exposing
  state through Effect UI `Signal` values that React components consume via
  `useSignal(...)`.
- React router preload matching uses the same ordered route list as navigation,
  so shadowed static/dynamic hrefs preload the route that `RouterProvider`
  renders.
- `RouterOutlet` renders pending, failure, not-found, and matched route
  branches inside the router Runtime Spine and a route-owned `UiScope`, so Core
  render-seam helpers such as `Resource.status(...)`, `read(...)`,
  `onDispose(...)`, and `forkScoped(...)` observe the same ownership as route
  preloads. The internal React Route Render Scope Controller owns this branch
  rendering, keyed route frame remounting, runtime provider re-entry, and route
  finalizer policy while the public router surface stays unchanged.
- `useResource<..., ER>(...)` exposes `preloadFailure` and accepts
  `onPreloadFailure(...)` for automatic mount-time preloads. Returned
  `prefetchEffect(...)` and `refreshEffect(...)` remain Effect-returning and
  runtime-bound; `preloadFailure` is only the observable result of the hook's
  fire-and-forget preload fiber.
- React resource hooks consume Core's Resource UI Binding Controller for shared
  Resource ref identity, automatic preload, preload failure keying, and
  Suspense preload-token dedupe. React remains responsible for
  `useSyncExternalStore(...)`, direct-value handles, and the React Suspense
  thenable throw seam.

### `@effect-ui/react-db`

The root export includes:

- Local source modules: `collection` and `live-query`.
- `useCollection`, `useLiveQuery`, collection/live-query handles, and preload
  options;
- `Collection` and `Query` re-exports for adapter-local ergonomics.

Release decisions:

- Keep `Collection` and `Query` re-exports because `@effect-ui/react-db` is the
  React DB entrypoint. Domain modules should still import from `@effect-ui/db`
  when they are adapter-independent.
- React DB handles expose current values directly, such as `projects.rows` and
  `query.data`, while returned mutation, preload, and refetch methods remain
  Effect-returning and runtime-bound.
- The shared React DB binding owns runtime capture, collection subscriptions,
  component cleanup, automatic preload, and runtime-bound returned Effects.

### `@effect-ui/solid`

The root export includes:

- Local source modules: `hooks`, `link`, `router`, and `runtime`.
- `RuntimeProvider`, `createEffectRuntime`, `useRuntime`, component scopes, and
  core re-exports used by Solid apps;
- router APIs: `createBrowserRouter`, `RouterProvider`, `RouterOutlet`,
  `RouterLink`, `useRouter`, `BrowserRouterState`, `RouterContextMissing`,
  `RouterRouteNotRegistered`, route/path helper types, and typed route failure
  renderers;
- hooks for signals, streams, programs, resources, suspense, and actions.

Release decisions:

- Keep core re-exports for Solid ergonomics. Documentation should still name
  `@effect-ui/core` as the owner of Resource, Action, Route, Signal, Form,
  Capability, and runtime semantics so app code can move across adapters.
- `createBrowserRouter(...)` and `RouterProvider` intentionally own browser
  `location`, `history`, `popstate`, route preload, and route scope lifecycle as
  one Solid browser Adapter. Core remains responsible for route definitions,
  href building, and matching.
- When callers pass an explicit router runtime, the runtime type must include
  the services required by the route preload definitions. Ambient/default
  runtime fallback remains the host-owned escape hatch for app roots where
  TypeScript cannot observe the provider layer. `RouterProvider` follows the
  same rule: routes with serviceful preloads require a runtime prop.
- `RouterOutletProps<Routes, ER>` preserves route-specific `match` typing for
  pending and failure renderers. The older `RouterOutletProps<ER>` form remains
  usable for broad route-agnostic renderers.
- `RouterLink` is the typed anchor path: it builds `Route.href(...)`, preloads on
  hover through the router runtime, preserves modified-click/browser-handled
  behavior, and navigates only plain left clicks. React and Solid delegate
  hover/click intent to the Core Browser Router Link Decision policy while
  keeping DOM event wiring local.
- `BrowserRouter` mirrors generated route path ergonomics with
  `hrefByPath(...)`, `navigateByPath(...)`, `matchByPath(...)`, and
  `preloadByPathEffect(...)`; route-object helpers remain available for callers
  already holding concrete route definitions.
- `RouterOutlet` delegates branch rendering, route-owned `UiScope` lifetime,
  Solid root cleanup, runtime-bound route finalizers, transition disposal
  ordering, and stale queued-render suppression to the internal Solid Route
  Render Scope Controller. This keeps the public Solid router surface stable
  while making route render lifetime policy local.
- `useAction(...)` binds submissions to the nearest Solid runtime while keeping
  the underlying action definition type intact. Apps with a fallible Solid
  Runtime Provider can pass the hook's `ER` generic to expose the runtime error
  channel on `submitEffect(...)`.
- `useProgram(...)` starts a Core `Program` under the nearest Solid runtime and
  owner scope, exposing `model()`, `state()`, `failures()`, `dispatch(...)`, and
  `dispatchEffect(...)`. This is the simple model/message/update surface for
  views that want Elm/Foldkit-style clarity without giving up Effect services,
  commands, streams, fibers, or scoped cleanup.
- `useResource<..., ER>(...)` follows the same runtime-bound pattern for
  `prefetchEffect(...)` and `refreshEffect(...)`. Automatic prefetches are
  Resource Store-owned; Solid owner cleanup and reactive ref changes detach the
  UI joiner, while Resource deletion/invalidation/runtime disposal cancel the
  underlying load. The handle also exposes `preloadFailure()` and accepts
  `onPreloadFailure(...)`, so automatic preload failures and Runtime Spine
  startup/provision failures are visible without changing the Effect-returning
  public methods.
- Solid resource hooks consume Core's Resource UI Binding Controller for shared
  Resource ref identity, automatic preload, preload failure keying, and
  Suspense preload-token dedupe. Solid remains responsible for Accessor-shaped
  reactivity, owner cleanup hooks, and the Solid Suspense thenable throw seam.

### `@effect-ui/solid-db`

The root export includes:

- Local source modules: `collection` and `live-query`.
- `useCollection`, `useLiveQuery`, collection/live-query handles, and preload
  options;
- `Collection` and `Query` re-exports for adapter-local ergonomics.

Release decisions:

- Keep `Collection` and `Query` re-exports because `@effect-ui/solid-db` is the
  Solid DB entrypoint. Docs should present direct `@effect-ui/db` imports for
  adapter-independent domain modules.
- `useCollection(...)` and `useLiveQuery(...)` share one internal Solid DB
  Reactive Binding Module for runtime capture, source subscriptions, cleanup,
  automatic preload, and runtime-bound returned Effects. The public handles
  remain the supported app surface. Returned `preloadEffect(...)` and
  `refetchEffect(...)` are already bound to the Solid runtime, so they no longer
  expose the collection/query service requirement `R`; pass the optional `ER`
  generic when a fallible Runtime Provider should be reflected in the error
  channel. `useCollection(...)` also exposes reactive `pendingMutations` and
  runtime-bound insert, update, delete, write, and flush Effects, so Solid
  callers do not need to rebind the raw Collection Definition for mutation work.
- Automatic Solid DB preloads are owner-scoped fibers. Disposing the Solid owner
  interrupts any in-flight mount preload before it can report a late failure.

### `@effect-ui/tsrx`

The root export includes:

- `effectUiTsrx(options)` and the default export for TSRX/Solid Vite setup.

Release decisions:

- Keep `@effect-ui/tsrx` as the one-call TSRX/Solid preset for starters and
  examples. Advanced apps can preserve the same ordering manually by composing
  `effectUiStart`, `@tsrx/vite-plugin-solid`, and `vite-plugin-solid` when they
  need plugin ordering control.

## Cross-Package Release Notes

- Every package is still marked `"private": true`; publication work must decide
  which packages become public and whether names stay under `@effect-ui/*`.
- Package manifests now include `description`, `license: "UNLICENSED"`, `main`,
  `types`, `files`, and `sideEffects` metadata for publish readiness while
  retaining `private: true`.
- Current package manifests mostly expose one root path per package. This is a
  good default; avoid adding subpath exports unless they reduce build/runtime
  coupling.
- Tests and examples import package roots through workspace aliases. Do not
  document source-file imports as public API.
- Future API-tightening passes should add new open questions as explicit
  release decisions or concrete follow-up work instead of leaving exported
  symbols in an ambiguous state.
