# Public API Inventory

This is the reference list of every import path the framework packages export,
with its classification. It tracks only import paths exported by package
manifests; source files that are not reachable through `package.json#exports`
are internal unless this document explicitly promotes them. `pnpm verify` checks
it against `type-tests/public-api.manifest.json` and the package manifests
(`scripts/audit-public-api-inventory.mjs`), so it cannot drift.

## Classification Rules

- Public: intended for external app code or build configuration.
- Expert public: intended for advanced integrations, diagnostics, tests, or
  adapters; stable enough to document, but not a golden-path API.
- Internal: not reachable from package exports, or exported only through a
  `./internal` subpath for sibling Sunfall Arc adapter packages; not supported
  as an application import path.
- Needs decision: exported today, but should be renamed, hidden, or explicitly
  documented before a public release.

## Package Export Map

| Package                 | Export                  | Source                                     | Classification | Release decision                                                     |
| ----------------------- | ----------------------- | ------------------------------------------ | -------------- | -------------------------------------------------------------------- |
| `@sunfall/arc-core`     | `.`                     | `packages/core/src/index.ts`               | Public         | Keep as the core application/runtime surface.                        |
| `@sunfall/arc-core`     | `./internal`            | `packages/core/src/internal.ts`            | Internal       | Adapter plumbing for Solid/Start/DB; not application API.            |
| `@sunfall/arc-start`    | `.`                     | `packages/start/src/index.ts`              | Public         | Keep as the full-stack runtime surface.                              |
| `@sunfall/arc-start`    | `./vite`                | `packages/start/src/vite.ts`               | Public         | Keep as the build-plugin and diagnostics runner surface.             |
| `@sunfall/arc-start`    | `./diagnostics-report`  | `packages/start/src/diagnostics-report.ts` | Public         | Keep as CI/agent repair report surface.                              |
| `@sunfall/arc-start`    | `./fetch`               | `packages/start/src/fetch.ts`              | Public         | Fetch-host adapter (Workers, edge runtimes, Bun, Deno).              |
| `@sunfall/arc-start`    | `./node`                | `packages/start/src/node.ts`               | Public         | Node HTTP adapter (`IncomingMessage`/`ServerResponse`).              |
| `@sunfall/arc-start`    | `./testing`             | `packages/start/src/testing.ts`            | Expert public  | Test-only wire markers and static-output helpers for app tests.      |
| `@sunfall/arc-start`    | `./internal`            | `packages/start/src/internal.ts`           | Internal       | Imported by Vite-generated diagnostics modules; not application API. |
| `@sunfall/arc-start`    | `./virtual`             | `packages/start/src/virtual-modules.d.ts`  | Expert public  | Keep as type-only virtual module declarations.                       |
| `@sunfall/arc-start`    | `sunfall-arc-start` bin | `packages/start/src/cli.ts`                | Expert public  | Keep for app graph diagnostics automation.                           |
| `@sunfall/arc-db`       | `.`                     | `packages/db/src/index.ts`                 | Public         | Keep as the Query engine over Resource rows.                         |
| `@sunfall/arc-db`       | `./internal`            | `packages/db/src/internal.ts`              | Internal       | Adapter plumbing for `Component.liveQuery`; not application API.     |
| `@sunfall/arc-devtools` | `.`                     | `packages/devtools/src/index.ts`           | Public         | Keep as the JSON-safe inspection contract.                           |
| `@sunfall/arc-solid`    | `.`                     | `packages/solid/src/index.ts`              | Public         | Keep as the Solid adapter surface.                                   |
| `@sunfall/arc-tsrx`     | `.`                     | `packages/tsrx/src/index.ts`               | Public         | Keep as the Vite/TSRX preset.                                        |

## Type-Test Coverage

Public import-path type coverage is owned by
`type-tests/public-api.manifest.json`. Each package export maps to its source
file, this inventory, and a focused `type-tests/*.test-d.ts` file; package
bins may omit an import-shaped type test only with an explicit reason. The
public API inventory audit verifies the manifest against package
`exports`/`bin` maps, checks that Package Export Map Source cells match the
manifest source paths, and checks that each focused type-test file imports the
entrypoint it claims to cover, exercises imported bindings as AST identifiers
outside import declarations, and includes any manifest-listed
`typeTestReferences` for virtual or side-effect declaration surfaces. The
audit checks those references structurally: `virtual:*` entries must appear as
import module specifiers, and symbol entries must be used as identifiers
outside import declarations. Manifest
entries may also list `requiredTypeTestImports` when a public symbol is
important enough to pin as a direct import; the audit rejects entries that are
not directly imported and exercised outside import declarations. It also checks
manifest `sourceSurface` lists for entrypoints against their local
re-exported Modules, rejects missing `sourceSurface` lists for package roots
that re-export local Modules, checks that every package root barrel's local
re-exported modules are named in that package's Source Surface section, and
checks that Source Surface local-module lists do not name Modules the source
file does not export. Declaration-level symbol policy lives in
`scripts/public-api-symbol-policy.mjs`: curated namespace-backed source modules
must have an explicit audit allowance and a root-barrel import, curated hover
declaration groups must be reachable from a package export or re-exported
source module, each declaration must be reachable as an exported package symbol
or explicit namespace alias, and those declarations must keep JSDoc for LSP
hovers. Together these checks keep hover/LSP docs from drifting away from
package Interfaces rather than merely reachable implementation files.
The curated hover declarations currently cover the Core Action, ActionResult,
Capability, Form, Program, and Resource Interfaces,
browser-router/router Adapter, Solid runtime and hook Adapter seams,
Start request/hydration/action seams, fetch, and Node Adapter seams,
Devtools DTO/panel contract seams, the Resource rows contract, and the DB
Query namespace and plan seams. The broad
`type-tests/framework.test-d.ts` file remains as cross-package integration
coverage.

## Source Surface By Package

### `@sunfall/arc-core`

The root export re-exports these local modules:

- `action`, `action-outbox`, `action-result`, `action-submission`,
  `action-transport`, `capability`
- `browser-router-history-adapter`, `browser-router-host-controller`,
  `browser-router-kernel`, `browser-router-state`, `effect-like`, `form`,
  `program`, `request-context`
- `resource`, `resource-store`, `route`, `route-grammar`
- `runtime`, `server`, `signal`, `timeline`

Every module is selected by name: the root exports each namespace (`Action`,
`ActionResult`, `Capability`, `Form`, `Program`, `Resource`, `Route`,
`Server`, `Signal`, `Timeline`) plus the error classes, Type IDs, guards,
services, and runtime helpers that have no namespace home. Each type has
exactly one public name: types a namespace owns are reachable only as
namespace members (`Action.Definition`, `Resource.Ref`, `Route.Match`,
`Server.Client`), never also as flat `ActionDefinition` / `ResourceRef`
exports. Cross-package plumbing types (the `app` registry requirement types,
the Resource rows plumbing (`resourceRowsGet`, `resourceRowsIndex`, ...),
Resource Store module/event/fiber
seams, `AnySchema`, `RouteWithComponent`, and the `ResourceFamily` class) are
exported only from `@sunfall/arc-core/internal`. Mixed modules' adapter
plumbing, plus `definition-registry`,
`resource-registry`, `resource-ui-binding`, `resource-failure-snapshot` (the
SSR wire codec for failed Resource reads), `action-instance` and
`program-start` (runtime-erased instance constructors for renderer bindings),
`scope` (the ambient `UiScope`), `signal-watch`, `signal-transaction`'s
framework commit seam (`batchSignalWrites` / `signalTransaction` with a
`Timeline.Cause`, `withSignalTransition` for an ambient named transition, and
`writeUntracedSignals` for bookkeeping that is never recorded), and
`stable-stringify` (DB query identity), is exported only from
`@sunfall/arc-core/internal` for sibling Sunfall Arc packages. Each symbol has
exactly one import path; nothing is exported from both entrypoints.

`resource-store` is intentionally selected rather than star-exported so the
public root exposes `ResourceStore`, `makeResourceStore(...)`, and
diagnostics (`Resource.StoreDiagnostics`) without exposing mutable cache
internals.

Golden-path public groups:

- `Route`, `Resource`, `Action`, `ActionResult`, `Program` (the app
  definition, `App`, is Start's)
- `Server`, `Server.Client`, request/response context services
- `Signal`, `Form`, `Capability`
- `Timeline`: `Timeline.record(options?)` is a scoped Effect returning a
  `Timeline.Recording` (`entries`, `position`, `travel(sequence)`, `resume()`)
  over every committed change set; every `Timeline.Entry` has a `cause`, and
  `Timeline.describe(cause)` renders a `Timeline.Cause` (application commits
  are `Timeline.TransitionCause`: `{ _tag: "Transition", name }`).
  `Signal.make(initial, { name })` requires a name. Every write happens in a
  named transition: `Component.callback(name, f)` / `Component.stream(name,
...)` (named `<Component>.<name>`), `Signal.fromStream(stream, initial, {
name })`, `Signal.transaction(effect, { name? })` / `Signal.batch(f, { name?
})` (unnamed ones take the caller's transition), Actions, Programs, and
  framework events. A write outside all of them dies with the
  `SignalWriteOutsideTransition` defect (exported for matching).
  `TimelineEntryUnavailable` and `TimelineAlreadyRecording` are the typed
  failures. `Form.make({ name, ... })` names a form's state and its
  `<name>.setField` / `touchField` / `reset` / `validate` transitions.
- `makeRuntime`, `runWithRuntime`, `SunfallArcRuntime.provide(...)`,
  `AnySunfallArcRuntime`
- `ActionTransport` (with `Action.TransportResponse`): the Action counterpart of
  `Server.Client`. Every Action instance looks it up on submit; Actions it
  serves run remotely and the response applies to the submitting runtime,
  every other Action runs locally. Start's `App.launch(app)` provides it for
  the app's Actions. `Action.TransportSubmission` carries a durable
  submission's id (its idempotency key).
- Durable submissions: `Action.define({ input, durable: { maxAge } })`
  (`Action.DurablePolicy`, schema input required by the types) adds
  `ActionQueued` to the Action's error type. `Action.outboxLayer({
retry? })` (`Action.OutboxOptions`) provides the `ActionOutbox` service over
  the runtime's `effect/persistence` `KeyValueStore` (prefix
  `arc/actions/v1/`); `Action.outbox`
  is its read side (`Action.Outbox`: `pending`, `failures`, `dismiss`,
  with `Action.OutboxEntry` / `Action.OutboxFailure`), empty without an outbox;
  `Action.restoreOutbox(options?)` (`Action.RestoreOutboxOptions`:
  `settled`) restores pending submissions after hydration.
  `ActionSubmissionExpired` and `ActionSubmissionUnrestorable` are the
  outbox's failure vocabulary;
  `isRetryableActionFailure` is the retry classification.
- `Route.View`, `RouteViewTypeId`, and `Route.WithComponent`: route components
  may be renderer component values (Solid's typed `Component`), and
  `Route.withComponent(...)` keeps the attached component's type
  (`Route.ComponentOf<R>`) so adapters can check its requirements.
- `Resource.define(...)` is the one Resource constructor: it loads through
  `load`, or, given `request` and `resolver`, through an Effect
  `RequestResolver` that batches and dedupes sibling loads.
- `Resource.evict(ref)` for explicit Effect-first removal from the
  active Resource Store when tests, adapters, or cache policies need to drop a
  ref before GC.
- Resource namespace members such as `Resource.Tag`, `Resource.TagDefinition`,
  `Resource.InvalidationTarget`, `Resource.InvalidationPlan`,
  `Resource.HydrationPayload`, `Resource.HydrationSuccessState`, and
  `Resource.Status` are the public LSP vocabulary for invalidation, hydration,
  and diagnostics adapters; there are no flat `Resource*` type aliases.
- `Resource.HydrationPayload` is the one name for
  the shared Core/Start payload-only contract. `Resource.hydrate(...)`
  accepts the payload object shape; raw snapshot arrays must be wrapped as
  `{ resources: snapshots }`. `Resource.hydrationPayload(...)` creates
  validated payloads from loaded Resource refs.
- `Action.planInvalidation(...)` for adapters/tests that need action
  invalidation planning with synchronous `invalidates` callback throws reported
  as `EffectInputCallbackError`.
- `Action.planOptimistic(definition, input)` (`Action.OptimisticChange`) is the
  test surface for `optimistic`: it runs the callback against a recording
  transaction and returns the changes it would make (`Set` with the value a
  Signal or loaded Resource entry would read, or a row store plus the
  `Insert`/`Update`/`Delete` change as given) without applying any or calling
  a backend.
- `PlainValue` is the expert-public type vocabulary for non-executable data
  seams. Promise-shaped values must be adapted through `Effect.tryPromise(...)`,
  and direct Effect values are executable work unless wrapped as
  `Effect.succeed(effectValue)` to cross as domain data.
- `isPromiseLikeValue(...)` is the shared runtime probe for Promise-shaped
  values at Core and Start host seams. It treats throwing `then` getters as
  Promise-shaped so each caller can report its typed boundary error instead of
  surfacing the getter throw as a defect.
- Browser router helper types such as `BrowserNavigateArgs` and
  `BrowserRouterError` are Core-owned route helper vocabulary. Adapters do not re-export them; Core is their only import
  path.
- `stableStringify(...)` and the `StableStringify*` errors are internal
  Stable Identity Codec plumbing in `@sunfall/arc-core/internal` (DB query
  identity, join keys, and index keys); apps never call it. The codec supports JSON-compatible data plus Date, URL, Map,
  Set, ArrayBuffer, DataView, typed arrays, bigint, undefined, sparse array
  holes, and tagged non-finite numbers; cycles, invalid Dates, functions,
  symbols, and hostile host object reads fail with typed errors.
- `DurationInput` and `UnsupportedDuration` describe Resource lifecycle policy
  durations for `staleFor` and `gcFor`. Numeric values are milliseconds, and
  string values accept millisecond, second, or minute units before unsupported
  strings fail as `UnsupportedDuration`.
- Action namespace members such as `Action.Policy`, `Action.Definition`,
  `Action.Options`, `Action.Instance`, and `Action.UseOptions`, plus the root
  `ActionTypeId` and `isActionDefinition(...)`, are expert-public LSP
  vocabulary for adapters, generated clients, and tests that need to name the
  Action contract.

Release decisions:

- Type IDs such as `ActionTypeId`, `ResourceTypeId`, and `RuntimeTypeId` are
  expert-public structural markers. They are intended for diagnostics,
  adapter authors, and test utilities that need framework identity checks; app
  code should prefer the guards (`isActionDefinition`, `isResourceRef`,
  `isSignal`, `isForm`) and namespace helpers.
- Type IDs are backed by `Symbol.for(...)` runtime values while preserving
  `unique symbol` declarations through self-type assertions.
- Ambient runtime accessors (`getCurrentRuntime`, `currentOrDefaultRuntime`,
  `defaultRuntime`, `eraseRuntime`, `withResourceStore`, `runFork`) are
  internal adapter plumbing in `@sunfall/arc-core/internal`. App code uses
  `makeRuntime`, `runWithRuntime`, explicit `{ runtime }` options, or renderer
  entry points such as Solid's `Component.launch` / `embed`, which take the
  runtime explicitly.
- The ambient UI scope (`UiScope`, `makeRuntimeUiScope(...)`,
  `makeRuntimeUiScopeFrame(...)`, `scoped`, `runWithScope`, `getCurrentScope`,
  `onDispose`, `forkScoped`, `watch`) is internal adapter plumbing in
  `@sunfall/arc-core/internal`. Frames expose one disposal path,
  `dispose()`, which host cleanup hooks fork on the owning runtime.
- `SunfallArcRuntime<R, ER>` is the typed Runtime Spine: `provide(...)` removes
  only services actually present in `R` plus the Resource Store, and
  `runFork(...)`/`runSync(...)` only accept Effects whose requirements are
  satisfied by that runtime. `AnySunfallArcRuntime<ER>` is the explicit Erased
  Runtime Runner host seam for Solid contexts, platform adapters, and ambient
  runtime plumbing where TypeScript cannot name the app's concrete service set.
  Host boundaries that must resolve a platform Promise should call
  `Effect.runPromise(runtime.provide(...))` at the adapter seam rather than
  adding Promise runners to the Runtime Spine.
- `ResourceStore` is an expert-public runtime diagnostic Interface. Use its
  `eventBus`, `moduleRegistry`, `fiberRegistry`, and `diagnostics` seams for
  tests, adapters, and devtools-style inspection. It is intentionally opaque to
  external structural Adapters; construct stores with `makeResourceStore(...)`
  instead of object literals. Raw entry, input, cache, module, tag index, event
  queue, and fiber collections are intentionally internal implementation state;
  the Core root barrel intentionally does not export `MutableResourceStore`,
  `makeMutableResourceStore(...)`, or `unsafeMutableResourceStore(...)`.
  `fiberRegistry.run(effect)` forks store-owned background work into the
  store's Effect `FiberSet`; disposal closes the store Scope, interrupting it.
- `Route.preload(...)`, `Route.planPreload(...)`, and
  `Route.planNavigation(...)` preserve the service requirements and the
  typed preload failure (`Route.PreloadFailure<R>`) declared by routes. A
  route's `error` option (`Resource.ErrorSchema<E>`, the same service-free Schema codec Resource families use)
  types its preload failure as `RoutePreloadError<E>`; `preload` is inferred
  from its own body and failures the schema does not cover are compile errors
  reported on `error` as `Route.PreloadFailureNotInErrorSchema<Undeclared>`
  (a Promise-returning preload reports `Route.PreloadReturnsPromise`). Without
  an `error` schema a failing preload reports `RoutePreloadUntypedFailure`
  (only the failure's `tag`), on server, client, and after hydration alike. `BrowserRouterError<Routes>` is the typed
  failure union in router `Failure` state. `Route.preloadFailureSnapshot`
  and `Route.preloadFailureCauseFromSnapshot` own the
  `Route.PreloadFailureSnapshot` wire form (`Route.PreloadFailureEncoding`):
  schema-encoded JSON with an `error` schema, the failure `_tag` only without
  one, and a `RoutePreloadFailureCodecError` defect when the failure cannot
  cross with the schema. `Route.DefineOptions<...>` names the options
  `Route.define(path, options)` checks. Planning Effects also expose
  `Resource.SnapshotCodecError` when touched resources cannot be serialized into
  hydration payloads. Solid and Start adapters may discharge service
  requirements only by running through a Runtime Spine.
- `Route.lazyComponent(...)` is Effect-first: the chunk loader is an
  `Effect`, the descriptor exposes `preload()`, and
  `Route.readComponent(...)` reports lazy pending/failure through tagged values.
  The Solid adapter is the only layer that converts pending lazy route loads
  into host Suspense Promise tokens. Lazy component load state is cached on the
  descriptor because UI chunks are app-code assets rather than route
  render-scope resources.
- `Route.ComponentInput<R, E>` and `Route.withComponent(...)` are the public
  component attachment Interface. They accept eager components or typed-error
  lazy descriptors while preserving route params, search, and preload
  requirements.
- Route grammar parsing rejects invalid and duplicate path parameter names at
  the grammar seam, so match results cannot silently collapse repeated params.
- `browser-router` is an expert-public Browser Router Kernel and Browser
  History Adapter Module. The Solid router Adapter uses it for shared
  route matching, preload state, initial matched-state policy, link
  click/preload policy, current-href reads, external history listeners, and
  programmatic history commits. The
  `BrowserRouterHostController` facade binds the Kernel to a History Adapter
  and owns idempotent start/dispose plus commit forwarding; framework adapters
  keep only reactivity projection and host owner cleanup. App code should
  usually use framework router exports, while tests and headless hosts can use
  `createBrowserRouterHostController(...)`,
  `makeMemoryBrowserHistoryAdapter(...)`, and the browser-router types
  directly. The router kernel, window history adapter, initial matched-state
  policy, link decisions, and render decisions are internal adapter plumbing in
  `@sunfall/arc-core/internal`.
- Browser router link decisions and preload identity live in Core internals so
  framework adapters share the same hover/click meaning. App code uses
  framework `RouterLink` components. The
  `makeBrowserRouterLinkPreloader(...)` seam accepts only full preload identity
  facts and requirement-free preload Effects, so framework adapters must
  provide route services before handing hover work to Core.
- `BrowserRouterKernel.dispose()` and
  `BrowserRouterHostController.dispose()` return the Effect that tears down
  route preload lifetimes; there is no synchronous twin. Framework owner hooks
  fork it (`Effect.runFork(controller.dispose())`), which starts synchronously,
  and `start()` returns that same cleanup for headless hosts.
- Browser route render decisions live in Core internals so framework adapters
  share the same outlet state meaning; app code uses framework router outlets.
- `Action.use(definition, { runtime })` is a runtime-bound action instance:
  services provided by the explicit runtime are removed from `submit(...)`
  requirements, and the runtime error channel is added to the action error
  surface. The runtime is required: there is no default-runtime fallback.
  Submissions report `Server.ClientError` beside the Action's own failures,
  because a runtime-provided `ActionTransport` may serve the Action remotely.
  A `run`, `optimistic`, or `invalidates` callback that breaks its contract is
  a defect, not part of the error type.
- Actions are the one mutation path. `optimistic(input, transaction)` patches
  Signals and Resource entries (`transaction.set(signal | ref, update)`, the
  update a value or a pure updater typed by the target) and the rows of a
  Resource with `rows` (`transaction.insert/update/delete(ref, key, ...)`, the
  key typed by `rows.key`) for the life of one submission; the
  transaction commits or rolls back every patch. A Resource patch layers over
  the entry's synced value: readers see it, loads and snapshots do not, and an
  entry that has not loaded is left alone. A run that returns a rejected `ActionResult` (`ValidationFailure`, `Failure`) rolls the patches back as a failure does. Row patches are entry patch
  layers too: an update shares the value's key positions and moves only the
  index buckets the row changed.
- `Resource.define({ ..., rows })` (array `output` only) adds keyed rows:
  `Resource.RowsOptions` (`key`, `indexes`, `changes`), `Resource.RowsRef`,
  `Resource.RowChange`, `Resource.Rows<F>`. `policy.persist`
  (`Resource.PersistOptions`) stores settled values in the runtime's
  `KeyValueStore`.
- The internal Action Execution Workflow Module owns callback normalization,
  retry wrapping, optimistic transaction commit/rollback, stale-submission
  interruption, invalidation planning/execution, and visible submission state
  updates for one `Action.use(...)` instance. The public `Action.use(...)`
  facade keeps runtime binding and requirement subtraction local, so LSP hovers
  still show the action requirements after any explicit Runtime Spine is
  applied.
- `Capability.use(...)` is the one service accessor, with explicit
  Effect-returning and plain-value overloads; Promise-returning callbacks are
  rejected so host async work is routed through Effect primitives, and a
  throwing callback is a defect (as with `Effect.sync`).
- `Program` is the public facade for the headless frontend loop around
  centralized model/message state. `Program.define(...)` takes a plain initial
  model and an exhaustive `on` handler map keyed by every message `_tag`
  (messages are always tagged; there is no `update` callback). Handlers are
  pure and synchronous: they return the next model or `Program.next(model,
commands)`, never an Effect. `Program.emit(...)`
  is the one command constructor: it emits an immediate message, or runs an
  Effect after the model commits and emits the message it produces; an Effect
  that completes with `void` emits nothing, so background work is
  `Program.emit(effect)` too. `Program.commands(...)` batches commands for
  `Program.next(model, ...)`.
  `Program.next(...)` widens variant commands through the Program's message
  union so handlers do not need command-level union generics.
  `Program.start(definition, { runtime })` always takes an explicit runtime
  (there is no default-runtime fallback); it adds runtime startup/provision
  errors to the failure channel and rejects runtimes that do not provide the
  Program's command and subscription requirements. UI code starts
  Programs with Solid's `Component.program(...)`.
  Program models and messages are plain data: Promise-shaped values,
  Effect-shaped values, and `undefined`/`void` messages are rejected. Commands
  that intentionally emit nothing reserve `undefined`/`void` as the no-message
  sentinel; host Promise work belongs inside `Program.emit(...)`, mapped to a
  message or completing with `void`.
  Started Programs report typed update/command/subscription failures through a
  signal. `dispatch(message)` is the one dispatch: an Effect that queues the
  message and completes once its update commits; UI event handlers bridge it
  with Solid's `Component.callback`.
  Programs keep no history of their own: message and failure commits are
  labelled entries on the app `Timeline`. When disposal drops a queued update
  before it commits, `dispatch(...)` fails with a `Program.Failure` whose
  error is `Program.Disposed`; updates that already committed still acknowledge
  successfully. Definitions may set `name`, which labels the Program's signals
  (`<name>.model`, `<name>.failures`) and its `Timeline` causes. The public
  Program facade keeps queue, command, subscription, failure, and disposal
  orchestration. Runtime lifecycle policy also stays internal:
  disposal fails pending or queued `dispatch(...)` acknowledgements with
  `Program.Failure<..., Program.Disposed>` when the update has not committed;
  already committed updates acknowledge successfully. Committed model changes
  own subscription restarts, and stale subscription generations cannot emit
  follow-up messages or timeline facts.
  Internally, Program Contract, Program Primitives, and Program Runtime
  Coordinator Modules separate public data Interfaces, pure
  constructors/normalizers/`Program.step`, and live Queue/Fiber/Scope execution
  while the public export surface stays anchored at `program.ts`.
  `Program.RuntimeError<E, ER = never>` separates Program-domain failures from
  Runtime Spine startup/provision failures. `Program.DispatchError<E, ER>` adds
  `Program.Disposed` for live `dispatch(...)` acknowledgement drops. The
  Solid `Component.program(...)` binding runs on its instance's already-started
  runtime, so its handle carries no `ER`.
  `Program.step(program, model, message)` is the one test surface: a pure,
  synchronous call returning `{ model, commands }` with the commands unrun.
  A command is a description whose `effect` a test runs (with test services)
  to get the message it emits. The runtime applies messages through the same
  function.
- `Form.decodeFormData(...)` decodes browser `FormData` through Effect
  Schema and maps schema failures to typed `Form.ValidationError` values.
  `Form.data(...)` is the explicit intermediate object conversion, preserving
  repeated field names as arrays and allowing framework hidden fields to be
  omitted before decoding.
- `Server.Client.call(...)` preserves the target server function's requirement
  type in its returned Effect. Browser RPC clients can still satisfy that with
  `never`, while local/mock clients can run functions that depend on test or app
  services. `Server` schema encode/decode, RPC envelope parsing, manifest
  schema-presence projection, and defect/server-error serialization now delegate
  to the internal Server Wire Codec Module so local clients, mocks, and Start
  transports share one wire policy. Mock/local clients also round-trip domain
  failures through the function error schema; client-side failures such as
  `EffectInputCallbackError`, schema errors, and transport errors stay in the
  client error channel.
- Resource state, status, `preload(...)`, `refresh(...)`, and Solid resource
  readers fail only with the Resource's declared load error `E`. A `load` or
  `provides` callback that breaks its contract (throws synchronously, returns
  a Promise or invalid tags) is a defect carrying `EffectInputCallbackError`.
  `preload`/`refresh` take one ref or an array of refs (loaded concurrently,
  values in order), the same target shape as `invalidate`.
- `ResourceKeyError` is public hover vocabulary for the default Resource key
  codec. It tells callers when JSON-compatible values plus Date, URL, Map, and
  Set are not enough and an explicit `key` callback is required.
- Resource operations have one Effect form each (`status`, `read`,
  `hydrationPayload`, `hydrate`,
  `planInvalidation`, `invalidate`, `runInvalidationPlan`);
  the synchronous twins that ran on an ambient/default runtime are removed.
  Host seams run them on an explicit runtime (`runtime.runSync(...)`).
- `Resource.diagnostics()` and `Resource.result(...)` are public LSP
  vocabulary for devtools and render seams. Registry lookups (family/tag
  definitions, registry diagnostics, refs for a tag, Action definitions) are
  internal plumbing in `@sunfall/arc-core/internal`.
- `Resource.read(...)` is the public Effect-first read Interface for
  already-loaded refs. Missing, pending, collected, and failed states stay in
  typed Effect failure channels instead of escaping as render-control throws.
- `Resource.collect(...)` is the public preload/read collection seam for
  route planners and adapters that need the value plus touched Resource refs.
  The result type is exposed as `Resource.Collected<A>`; the internal
  `ResourceCollector` service and flat `ResourceCollected` alias are not root
  exports.
- Resource hydration payload Effects now schema-encode inputs and
  success values before they cross snapshot seams, so Start, Solid, and tests
  observe the same wire policy as hydrate.
- `resource-ui-binding` is the internal Resource UI Binding Controller
  Module for framework adapters. It owns Resource ref identity, runtime-bound
  refresh/preload Effects, automatic preload fibers, keyed preload failures,
  observer and host setter failure swallowing, stale preload interruption,
  retained-ref cleanup through `dispose()`, and Suspense preload-token
  dedupe. The Solid adapter still owns host reactivity and host Suspense throwing.
- Async state is Effect's `AsyncResult` (`effect/reactivity`) everywhere:
  `Resource.result(ref)`, `Resource.Status.result`, `Action.State.result`,
  and `Query.Live.state`. Arc publishes no parallel
  state union, match helper, or value/error extractor; the removed
  `ResourceState`, `Resource.State`, `Resource.value`, `Resource.error`,
  `ResourceUi{Success,Pending,Failure}Meta`, `ResourceUiMatch`,
  `resourceUiMatchState`, `resourceUiStateHasValue`, `CollectionLoadState`,
  `Collection.State`, `LiveQueryState`, `Query.LiveState`,
  `collectionStateError`, and `liveQueryStateError` have no aliases.
  `ResourceFailure` carries `result: AsyncResult.Failure` and `ResourcePending`
  carries `reason` plus the current `result`.
- `definition-registry`, `resource-registry`, `resource-ui-binding`, and the
  plumbing halves of `action-submission`, `resource-snapshot-codec`, and
  `route-grammar` are internal Modules exported from
  `@sunfall/arc-core/internal` for sibling adapter packages. App code uses the
  higher-level `Action`, `Resource`, `Route`, and `Server` facades (and
  Start's `App.define`).

### `@sunfall/arc-start`

The root export is the application surface only (about forty names). It
includes:

- Local source modules: `hydration`, `request-trace`, `start-action-client`,
  `start-action-request-codec`, `start-app`, `start-app-request-handler`,
  `start-document`, `start-fetch`,
  `start-request-handler`, `start-transport-endpoints`,
  `start-transport-protocol`, `static-client-navigation`, and `streaming`.
- the app: `App.define({ root, routes, actions?, client? })`
  returns the one `App.Definition` both entries derive from (`App.Any`
  accepts any). The root is a Solid `Component<App.RootProps, never, R>`; the
  client Layer must provide `R` (minus `App.LaunchServices`) or `App.define`
  does not compile. `App.launch(app, options?)` (`App.LaunchOptions`: `href`,
  `hydration`, `transport`) is the browser entry: it builds the runtime from
  the client Layer plus the action transport and (outside static builds) the
  RPC `Server.Client`, restores the server's hydration payload, and hydrates
  the root; it fails with the client Layer's error,
  `StartRootMissing`, or a hydration error (`App.LaunchError`).
- request handling: `createRequestHandler(app, options?)` returns the
  Effect-returning `StartRequestHandler` (one name; there are no
  `createServerHandler*` or `*Effect` aliases). `CreateRequestHandlerOptions`
  holds the server half: `server` (the server Layer, which must provide the
  root's services), `serverFunctions` (implementations served over RPC),
  `document`, `endpoints`, and `onRequestTrace`. Page requests render
  `app.root` into Start's document; there is no render callback and no
  hand-written HTML shell. `StartRequestTrace` and `StartRequestTraceHandler`
  describe the trace hook.
- documents: `document: (context: StartDocumentContext) => StartDocument`
  sets `lang`, `title`, `meta` and `links` (`StartDocumentTagAttributes`,
  HTML-escaped), `clientEntry`, and response `headers`. Start emits the
  doctype, charset and viewport, Solid's hydration bootstrap, the
  `<div id="root">` app markup, the streamed and root hydration payloads, and
  the entry script, in that order. `StartStreamError` names an HTML stream
  failure.
- hydration: `hydrateFromDocument(document?, options?)` (`options.id` selects
  the root payload script) is the document hydration primitive `App.launch`
  runs; there is no positional id and no synchronous facade.
  `StartHydrationPayload`, `StartHydrationDocument`, `StartHydrationError`, and
  the `StartHydration*ParseError` / `StartHydrationPayloadSerializeError`
  classes are public error vocabulary.
- transports: `App.launch` owns the browser RPC client and the action
  transport; `App.LaunchOptions.transport` sets their `endpoints`, `fetch`
  (`StartFetch`, `StartFetchInit`, `StartFetchInput`), and `headers`.
- durable submissions: `App.launch` provides the Action Outbox over the
  browser's one `KeyValueStore` (the client Layer's, else `localStorage`,
  shared with persisted Resources;
  `App.LaunchOptions.outbox` sets `retry`) and restores it after
  hydrating. The action endpoint runs a submission that carries an id as an
  `effect/workflow` Workflow keyed by that id, on the server Layer's
  `WorkflowEngine` (by default a per-handler `WorkflowEngine.layerMemory`
  rotated per Action so records live about `durable.maxAge`). `App.launch`
  mirrors pending submissions into the `sunfall-arc-outbox` cookie and
  restores the ones the server reports settled (`settledSubmissions` in the
  hydration payload) without re-patching them. Start adds no exports for
  either.
- file routes: a route module exports `route = Route.define(path, options)`;
  Start has no route constructor of its own. The generated route tree checks
  the declared `path` against the path derived from the file, as a type error
  and again when the tree loads. Static preload hints use core
  `preloadResources`, and runtime work lives in
  `preload`.
- actions: the app's `actions` are the Actions the server serves; `App.launch`
  routes their submissions from the single UI binding (Solid's
  `Component.action(...)`) over the network with the same result and error
  types, and responses hydrate and invalidate the submitting runtime. The
  `StartAction` namespace keeps only progressive (no-JS) form support:
  `StartAction.form`, `StartAction.decodeFormData`, and
  `StartAction.Form`; plus `StartAction.FormOptions`,
  `StartAction.InvalidationPlan`, `StartActionFormEncodeError`, and
  `StartActionDuplicateName`.
- static sites: `makeStartStaticHistoryAdapter`, `currentStartStaticHref`,
  `normalizeStartStaticBasePath`, `withStartStaticBasePath`,
  `stripStartStaticBasePath`, `StartStaticBasePathError`, and
  `StartStaticNavigationHydrationError`.
- transport configuration: `StartTransportEndpointOverrides`,
  `StartTransportEndpointPathError`, and `StartTransportEndpointConflictError`.
- there are no hand-written manifest sources: the Vite plugin derives the
  server-function and Action manifests from the server entry's
  `createRequestHandler(app, { serverFunctions })`, naming each definition by
  the module export it came from (and a server function's browser client by
  its `Server.client` export of the same name).

Manifest make/serialize/deserialize, stable ids, client-reference
classification, generated route module codegen, transport header constants and
media types, `validateStart*Effect` validators, endpoint guidance, app-graph and
agent-graph diagnostics, request metrics, and hydration chunk primitives are
package-internal. `vite.ts`, `cli.ts`, and tests import them from source.

Subpath exports:

- `./fetch` owns the Fetch-host adapter and carries no Node imports.
  `toFetchHandler(handler)` is the Effect-first adapter and preserves handler
  service requirements; `createFetchHandler(handler, options?)` is the
  Promise-shaped host facade for platforms whose contract is
  `(request) => Promise<Response>`. It merges `request.signal` with
  `options.runOptions.signal`, provides the request `Scope.Scope`, requires a
  typed runtime for remaining services, and holds the Scope until the response
  body closes, errors, or is cancelled.
- `./node` owns the Node HTTP adapter. `createNodeHandler(handler, options?)` is
  the Effect-first adapter; `createNodeServerHandler(handler, options?)` is the
  `node:http.createServer(...)` callback facade. It also exports
  `nodeRequestOrigin`, `nodeRequestToWebRequest`, `writeNodeResponse`, and
  `StartNodeAdapterError`. Manifest-pinned Source Surface Modules:
  `node-web-exchange` and `start-host-runtime-runner`. `trustForwardedHeaders`
  defaults to `false`; enable it only behind a proxy that overwrites
  `x-forwarded-proto` / `x-forwarded-host`.
- `./vite` exports only `sunfallArcStart`, its option types, and its errors.
  Manifest-pinned Source Surface Modules: `app-graph`, `file-routes`,
  `generated-route-definitions`, `start-app-graph-diagnostics-policy`,
  `start-manifest-wall`, `start-prerender`, `start-vite-dev-ssr`, and
  `start-vite-diagnostics-loader`.
- `./diagnostics-report` owns grouped repair reports with owner/edit guidance.
  Manifest-pinned Source Surface Module: `start-diagnostics-contract`.
- `./testing` exposes wire markers and static-output helpers that app tests
  assert against: `hydrationScriptId`, `streamHydrationAttribute`,
  `StartHydrationChunk`, `serverActionPath`, `serverRpcPath`,
  `extractStartStaticHtmlLinks`, and `startStaticPageOutputPath`.
  Manifest-pinned Source Surface Modules: `hydration`, `rpc`, and
  `static-export`.
- `./internal` is imported only by the Vite-generated
  `virtual:sunfall-arc/app-graph/runtime-diagnostics` module. Manifest-pinned
  Source Surface Modules: `app-graph` and `start-app-graph-diagnostics-policy`.
- `./virtual` owns virtual module typings only.
- `sunfall-arc-start` owns diagnostics and agent graph CLI execution
  (`diagnostics`, `graph`, `impact`). There is no programmatic CLI subpath.

Release decisions:

- `StartRequestTrace` is intentionally structural with `Devtools.RequestTrace`,
  and `StartAction.InvalidationPlan` with `Devtools.InvalidationPlan`, so Start
  and Devtools never import each other.
- The root does not re-export Core symbols; import `Action`, `Resource`,
  `Route`, `Server`, and `Signal` from `@sunfall/arc-core`.
- `virtual:sunfall-arc/routes` intentionally exposes broad route maps; apps that
  need exact literal route ids, paths, params, search, or href options import
  the written generated route definitions artifact.
- `virtual:sunfall-arc/app-graph` is a static DTO module; tooling that needs
  runtime route-module/resource diagnostics imports
  `virtual:sunfall-arc/app-graph/runtime-diagnostics` explicitly.

### `@sunfall/arc-db`

The root export includes:

- Local source modules: `query-builder` and `query-plan`.
- Namespace-backed source modules: `query-builder`; the root re-exports no
  flat aliases from it.
- One path per concern: the root exports only the `Query` namespace plus the
  tagged error classes `QueryEvaluationError` and `UnsupportedLiveQuery`.
  `@sunfall/arc-db` is the Query engine: it holds no rows. Rows belong to
  Resources (`Resource.define({ ..., rows })` in `@sunfall/arc-core`).
- Query sources are refs of Resources that declare `rows`
  (`query.from({ project: ProjectsRef })`); a Resource without `rows` does
  not compile as a source. `joinIndexed` index names are checked against the
  joined Resource's `rows.indexes`. A query's `E` and `R` are its sources'
  declared load errors and services.
- `Query.live`, `Query.once`, and `Query.diagnostics`, plus the aggregates
  `Query.count/sum/avg/min/max`. Diagnostics report each source's
  `resource` name and join strategy `"scan"` or `"index"`.
- `@sunfall/arc-db/internal` (adapter plumbing, not public API):
  `buildQuery`, `currentQueryStore`, and `runWithQueryStore`, which
  `Component.liveQuery` uses.

Release decisions:

- Filters, joins, ordering, windows, and grouping run through
  `@tanstack/db-ivm`, which stays out of `@sunfall/arc-core`.
- The internal Query Source Adapter owns how the engine reads a rows Resource:
  the entry's visible value (optimistic patches included) in the query's
  Resource Store, keyed by `rows.key`, with `rows.indexes` buckets for indexed
  joins. Unchanged row objects keep their identity across reloads, so the
  live runtime skips them instead of hashing every row.

### `@sunfall/arc-devtools`

The root export includes:

- Local source modules: `devtools`, `devtools-contract`, and `panel-contract`.
- Namespace-backed source modules: `devtools`; the root re-exports no flat
  aliases from it.
- One path per concern: the root exports only the `Devtools` namespace plus the
  tagged error classes `DevtoolsActionInvalidationPlanConflict` and
  `DevtoolsPanelContractError`.
- `Devtools.makeStore` and the pure projections `Devtools.describeSummary`,
  `Devtools.describeCausalGraph`, and `Devtools.describePanels` (there are no
  trivial `*Effect` wrappers);
- `Devtools.resolveBridgePayload(...)` with `Devtools.BridgePayloadResolution`
  for validating untrusted inspected-window payloads;
- `Devtools.renderPanelsHtml` for deterministic embeddable HTML;
- panel mounting has one scoped Effect and one host facade:
  `Devtools.mountPanels(...)` mounts inside a Scope and unmounts when it
  closes; `Devtools.bootPanels(...)` (with `Devtools.PanelBoot` /
  `Devtools.PanelBootOptions`) runs that Effect in its own fiber for non-Effect
  shells and is stopped with its host `boot.interrupt()`;
- `Devtools.bridgeGlobal` and the scoped `Devtools.installBridge`
  for exposing an inspected-window bridge to browser extension panels;
- `Devtools.toSerializable(...)` and `Devtools.SerializationPolicy`, used to
  bound arbitrary runtime values and redact secret-shaped keys;
- the DTOs adapters and panels exchange: `Devtools.Snapshot`,
  `Devtools.RuntimeEvent`, `Devtools.TimelineCommit`, `Devtools.RoutePlan`,
  `Devtools.InvalidationPlan`, `Devtools.RequestTrace`,
  `Devtools.AppGraphDiagnostics`, `Devtools.Summary`, `Devtools.CausalGraph`,
  `Devtools.Panels`, and `Devtools.Panel`. Their nested shapes (panel items,
  metrics, causal nodes and edges, request-trace parts) are reached through
  these types rather than exported under their own names.

Release decisions:

- `Devtools.RequestTrace` is public as a data contract. Start emits a compatible
  shape through `onRequestTrace`, with cancellation and failure-path coverage in
  Start request tests.
- `devtools-contract` owns the Devtools DTO and Interface vocabulary that
  renderers, stores, summaries, bridges, and agents share. The `Devtools`
  namespace names its public types, while internal Devtools modules import the
  contract directly instead of depending on the root facade. Serialization
  policy belongs to this contract too.
- `Devtools.InvalidationPlan` is public as an inspection data contract. Start
  emits a compatible `StartAction.InvalidationPlan`, and type tests pin the
  structural compatibility so devtools can consume full-stack action metadata
  without importing `@sunfall/arc-start`.
- `Devtools.Summary`, `Devtools.CausalGraph`, and the first `Devtools.Panels`
  model should be treated as stable data contracts for agents and UI panels.
- `Devtools.Store` is an explicit public Interface, not an inferred factory
  return. Route-plan and invalidation record methods return retained fact
  indexes for adapters that emit runtime events against duplicate recorded facts.
- Timeline observation is a first-class store capability:
  `recordTimelineEntry(...)` and
  `trackTimeline(recording)` copy Core `Timeline.Entry` values into
  `TimelineCommit` runtime events (`Devtools.TimelineCommit`), linked to the
  Program, Action, or Resource their cause names. Store
  `serializationPolicy` options apply before those commits enter snapshots.
- The browser panel renderer is public as an embedded UI surface, while
  the bridge helpers are public as the supported app-side handshake for checked
  app or extension shells.
- `Devtools.bootPanels(...)` is the expert-public browser panel boot helper for
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
- Panel guards (`isDevtoolsPanel*`), normalizers, panel-input resolvers, the
  app-graph DTO normalizers, and `devtoolsPanelStyles` are package-internal.
  `Devtools.resolveBridgePayload(...)` is the single public validator
  and returns a valid detached DTO or typed diagnostics.
- Raw Devtools snapshots may contain detached `unknown` inspection facts owned
  by Core, Start, DB, or app code. Summaries, causal graphs, panels, and bridge
  payloads are the JSON-safe projections.
- Summary and causal graph projection share the same internal Devtools Summary
  Input Normalization policy. Explicit input overrides beat snapshot fields,
  optional arrays default to empty arrays, and resource indexes are derived from
  the same summarized invalidation, route, runtime-event, and request facts used
  by panels and causal graphs.
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
- The root Devtools module remains the public facade; internal Panels and Store
  modules own their concrete projection/copy dependencies directly instead of
  exposing single-adapter runtime injection Interfaces.
- Focused Devtools public type coverage lives in `type-tests/devtools.test-d.ts`.
  Keep pure Devtools Store, panel, bridge, serialization, DTO, and lifecycle
  assertions there; `type-tests/framework.test-d.ts` should keep only
  cross-package compatibility checks with Core, DB, or Start.

### `@sunfall/arc-solid`

The root export includes:

- Local source modules: `component`, `link`, and `router`.
- `Component`: the single Solid app model. Typed component definitions whose
  services and render failures flow through `yield*` in setup instead of JSX:
  `Component.define` (per-instance setup receiving props, returning the render
  function), setup-time bindings (`resource`, `action`, `program`, `stream`,
  `callback`, `router`, and the expert `instance` seam for binding authors),
  boundaries (`catchTags`, `catchAll`, `loading`), `provide`, and the entry
  points `launch` (the app entry), `mount` (its composable scoped primitive),
  and `embed` (the server render path, on an explicit runtime);
- router APIs: `RouterProvider` (renders a router from `Component.router`),
  `RouterOutlet`, `RouterLink`, `useRouter`, `isPlainLeftClick`,
  `RouterContextMissing`, `RouterOptions`, and typed route failure renderers.

Release decisions:

- No Core re-exports: `Resource`, `Action`, `Route`, `Signal`, `Program`,
  router state/path types, `RouterRouteNotRegistered`, and `makeRuntime`
  are imported from `@sunfall/arc-core` only.
- There is no hook model and no runtime context: every runtime-backed read or
  write is a setup-time binding whose services join the component's `R`, and
  `launch`/`mount`/`embed` check `R` against the runtime they are given.
  `embed(component, runtime)` takes the runtime explicitly; there is no
  implicit default runtime and no `RuntimeProvider`.
- Setup runs once per instance under the instance's Solid owner (every
  generator step, even after an asynchronous one), with an instance Scope that
  closes when Solid disposes the instance. Per-runtime sharing is by
  construction: Resources live in the runtime's Resource Store, and
  `Component.provide` builds its Layer once per runtime.
- `Component.resource(family)` returns a `ResourceReader`: `reader(input)` is
  the only way to render the value (it suspends the nearest `<Loading>` until
  the first value and keeps the current or stale value across refreshes, so
  content stays mounted), and `waiting(input)` / `failure(input)` are the
  value-free status accessors. For a family with `rows` it is a
  `Component.Reader` that adds `get(input, key)` and `index(input, name,
value)` (`Component.ResourceRowsReader`), typed by `rows`.
- `Component.liveQuery(query, options?)` binds a `Query` over rows Resources
  (`@sunfall/arc-db`) and returns a `Component.LiveQueryHandle` (`rows`,
  `waiting`, `failure`, `preload`, `refresh`); the sources' declared errors
  join `E` and their services join `R`. It replaces the deleted
  `@sunfall/arc-solid-db` package.
- `Component.action(definition)` returns an `ActionHandle` (`waiting`,
  `failure`, `result`, `input`, `submit`, `reset`); `waiting()` / `failure()`
  use the Resource reader's status names, and `result()` keeps the full
  `AsyncResult`. `submit(input)` and `reset()` return Effects, which event
  handlers run through `Component.callback` (handling failures there: a
  submission's failures belong to its caller, never to the Component's `E`). A
  runtime-provided `ActionTransport` (provided by Start's `App.launch` for the
  app's Actions) makes the same handle submit remotely.
- `Component.program(definition, options?)` returns a `ProgramHandle` whose
  `model()` is a fine-grained, deeply read-only Solid projection
  (`Component.ProgramModelView<Model>`) reconciled from the committed model
  (`committed`); `ProgramOptions.key` (default `"id"`, `null` for positional)
  sets the array reconcile identity. `dispatch(message)` returns the Effect that
  completes once the update commits; handlers bridge it with
  `Component.callback`.
- Handle vocabulary is uniform: members that run work (`submit`, `dispatch`,
  `reset`, `preload`, `refresh`) return Effects; `result()` is the
  `AsyncResult` status accessor (actions, live queries);
  row-valued accessors are `rows()`; a Resource renders through its reader
  (`reader(input)`, with `waiting` / `failure`); pure synchronous state writes
  (`clearFailures()`, `Form.setField`) stay synchronous and carry their own
  Timeline causes.
- `Component.callback(name, f)` is the one way component code changes Signals
  it owns: each call forks `f(...args)` in the instance Scope, started
  immediately, as the named transition `<Component>.<name>`; Actions and
  Programs it runs keep their own causes. `Component.stream(name, stream,
initial)` commits each element as `<Component>.<name>`.
  `Component.Instance.name` exposes the component name to setup-time bindings.
- `Component.router(routes, options?)` creates the instance's router with the
  setup's runtime and context. The routes' preload services and route
  Components' services and failures (`RouterServices`, `RouterError`) join the
  component's type, so `launch` checks them. Route components may be plain
  Solid functions or typed `Component`s.
- `RouterProvider` intentionally owns browser `location`, `history`,
  `popstate`, route preload, and route scope lifecycle as one Solid browser
  Adapter (the internal `createBrowserRouter(...)` is not exported). Core remains responsible for route definitions,
  href building, matching, and initial matched-state policy. Solid detects
  existing-DOM hydration by default and also accepts an explicit `hydrating`
  option for tests or custom hosts.
- `RouterOutlet` takes the `router` it renders; `RouterOutletProps<Routes, ER>`
  types its pending, failure, and not-found renderers from that router, so no
  type arguments are needed. `RouterProvider` takes only `router` and
  `children` (defaulting to `<RouterOutlet router={router} />`). Router
  options accept `undefined` as "absent".
- `Route.withComponent(route, component, props?)` attaches a route component:
  without `props` it takes `Route.Props<typeof route>`; with `props` the
  mapper turns route props into the component's props. It is the only
  attachment path (`Route.DefineOptions` has no `component`), and Start's Vite
  plugin code-splits the component it attaches without changing its type, so
  the router's service and failure check covers code-split Components. Router
  membership compares routes by path, like `Route.isMatch`.
- `RouterLink` is the typed anchor path: it builds `Route.href(...)`, preloads on
  hover through the router runtime, preserves modified-click/browser-handled
  behavior, and navigates only plain left clicks. The Solid adapter delegates
  hover/click intent to the Core Browser Router Link Decision policy while
  keeping DOM event wiring local.
- `BrowserRouter` addresses routes by definition only: `href(route, ...)`,
  `navigate(route, ...)`, and `preload(route, ...)` (an Effect), plus
  `navigateHref(href)` for raw hrefs such as Action redirects. `match()` is the
  current match; `Route.isMatch(route, match)` narrows it.
- `RouterOutlet` delegates branch rendering, route-owned UI scope lifetime,
  Solid root cleanup, runtime-bound route finalizers, transition, same-state
  renderer-swap, initial failed-render, and update failed-render disposal
  ordering, stale queued-render suppression, and awaitable internal
  `dispose()` cleanup to the internal Solid Route Render Scope
  Controller. This keeps the public Solid router surface stable while making
  route render lifetime policy local.
- Resource readers consume Core's Resource UI Binding Controller for shared
  Resource ref identity, automatic preload, and Suspense preload-token dedupe.
  Solid remains responsible for Accessor-shaped reactivity, owner cleanup, and
  the async-memo suspension seam.

### `@sunfall/arc-tsrx`

The root export includes:

- `sunfallArcTsrx(options)` and the default export for TSRX/Solid Vite setup.
  Its dependency-discovery policy plugin is scoped to Vite's dev server
  (`apply: "serve"`) so production builds use the transform plugins without
  carrying dev-only optimize-deps policy.

Release decisions:

- Keep `@sunfall/arc-tsrx` as the one-call TSRX/Solid preset for starters and
  examples. Advanced apps can preserve the same ordering manually by composing
  `sunfallArcStart`, `@tsrx/vite-plugin-solid`, and `vite-plugin-solid` when they
  need plugin ordering control.

## Cross-Package Release Notes

- Framework packages under `packages/*` are configured as publishable public
  scoped packages under `@sunfall/arc-*`; the workspace root and copyable
  example/starter source packages remain `private: true`.
- Framework package manifests now include `description`, `license: "MIT"`,
  `author: "Andrew Lee"`, `publishConfig.access: "public"`, `main`, `types`,
  `files`, and `sideEffects` metadata for publish readiness.
- Current package manifests mostly expose one root path per package. This is a
  good default; avoid adding subpath exports unless they reduce build/runtime
  coupling.
- Tests and examples import package roots through workspace aliases. Do not
  document source-file imports as public API.
- Future API-tightening passes should add new open questions as explicit
  release decisions or concrete follow-up work instead of leaving exported
  symbols in an ambiguous state.
