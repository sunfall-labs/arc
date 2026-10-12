# Sunfall Arc Architecture

Sunfall Arc is a client-first, server-capable framework built around Effect v4,
typed application definitions, and TSRX where component templates need it.

The v0 implementation deliberately uses TSRX's Solid target instead of a custom compiler
target. The public API is owned by Sunfall Arc:

- `State` for writable client state: a named model changed only by its
  messages, with Effect-owned work in commands.
- `Signal` for the read side: derived values, peeks, and Streams of changes.
- `Resource` for typed async/cache state; a list Resource declares `rows`
  (key, indexes, change feed) for keyed lookups and row patches. A served
  Resource (no `load`) is loaded on the server by its `Resource.implement`.
- `Query` (`@sunfall/arc-db`) for live materialized queries over the rows of
  Resources.
- `Action` for every change to server data: optimistic State, Resource entry,
  and Resource row patches, the Effect that writes, and invalidation. A served
  Action (no `run`) runs on the server as its `Action.implement`.
- Effect services (`Context.Service`) for named app services, provided by a
  Layer per host or test.
- `Route` (`Route.define`) for typed routes.
- `RouterProvider` / `RouterOutlet` for browser history, route preload, and route-owned scopes.
- `Server.contract` / `Server.client` / `Server.implement` for other schema-described server calls, such as a change-feed poll (each contract is an `effect/rpc` `Rpc`).

Future versions can add a custom TSRX host profile once the runtime semantics are stable.

This architecture document explains the concrete shape of the framework: the
runtime spine, dependency injection, routing, resources, queries, actions,
served definitions, SSR, hydration, diagnostics, and devtools all share one typed
definition vocabulary.

## Target Architecture

The end-state architecture has four layers that intentionally share the same
domain vocabulary.

1. Definition layer: schemas, branded ids, Effect services, server contracts,
   states, resources, actions, forms, and routes are stable typed
   definitions. Definitions are safe to import broadly; server bodies
   (`Resource.implement`, `Action.implement`, `Server.implement`) live in
   `*.server.ts` modules.
2. Generated route layer: file-route manifests and generated route
   definitions turn route files into deterministic machine-readable artifacts.
3. Runtime layer: `SunfallArcRuntime`, request runtimes, `ResourceStore`,
   UI scopes, route scopes, State fibers, action fibers,
   server clients, response context, hydration, and event streams execute the
   graph through Effect services and scopes.
4. Inspection layer: diagnostics, devtools summaries, causal graphs, repair
   reports, the app Timeline, request spans, type tests, integration tests,
   and agent workflows consume public graph/runtime facts rather than private
   maps.

The architectural rule is simple: every important runtime fact should have a
definition-time owner when possible, a generated diagnostic fact when useful, an
Effect event when it changes, and a test that proves the contract.

## Design Pressures

Sunfall Arc should stay unusually strict in these places:

- served definitions and server contracts are shared, their implementations
  are server-only;
- request work gets a fresh runtime and store;
- route preload is typed, interruptible, and declares the resources it loads;
- resources live in the active runtime/store, never global process state;
- State is the one writable client state, and its handlers are pure: they
  return plain model data or `State.next(...)`; async work leaves the handler
  through Effect commands and Stream subscriptions, so `State.step` tests a
  transition with no runtime;
- actions are the one mutation path: they own mutation policy, optimistic
  State, Resource entry, and Resource row patches, invalidation, and result
  shape;
- a failure that can reach rendering joins a Component's `E`; a failure of work
  a caller starts is returned to that caller; a callback that breaks its
  contract is a defect;
- public async APIs return Effect v4 values;
- Promise boundaries are compatibility adapters for host or platform contracts,
  never alternate framework APIs;
- generated artifacts are deterministic and source-attributed;
- devtools use public Effect streams and definition diagnostics;
- tests mock services through layers and contracts.

This strictness is what lets the component API stay simple without losing
correctness.

TSRX needs its own TypeScript tooling in addition to the Vite transform. The
Solid Vite setup is `tsrxSolid()` before `solid()`, and command-line checks use
`tsrx-tsc` with `@tsrx/typescript-plugin` registered in `tsconfig.json`. Do not
replace this with a broad `declare module "*.tsrx"` shim; that makes imports
compile, but it erases the component prop types we want the framework to protect.

Non-TSRX packages use `tsgo` for package build and typecheck work. TSRX projects
still use `tsrx-tsc` because the TSRX command-line path wraps TypeScript through
Volar, registers `.tsrx` as an extra supported extension, and type-checks the
virtual TypeScript generated from TSRX source. Plain `tsgo` does not currently
load that TSRX virtual-file path, so `tsgo` is the right default for ordinary
framework packages and `tsrx-tsc` remains the correctness path for `.tsrx`
projects.

The default UI integration does not require TSRX `try/pending/catch`. A
Component binds a Resource family in setup and reads it in render through a
reader that suspends Solid's `<Loading>`:

```tsx
const ProjectPage = Component.define("ProjectPage", function* (props: { readonly id: ProjectId }) {
  const project = yield* Component.resource(ProjectById);
  return () => (
    <Loading fallback={<ProjectSkeleton />}>
      <ProjectView project={project(props.id)} refreshing={project.waiting(props.id)} />
    </Loading>
  );
}).pipe(Component.catchTags({ ProjectNotFound: (error) => <ProjectMissing id={error.id} /> }));
```

The reader is the only way to render the value: the first load suspends, and
later refreshes keep the current (or, after a failed refresh, stale) value, so
`ProjectView` stays mounted with whatever forms or States it owns.
`waiting(input)` and `failure(input)` are value-free status accessors for the
chrome. A failed first load throws to the boundary `catchTags` installs, which
matches the family's render failure: its `error` schema's type (here
`ProjectNotFound`), or `ResourceUntypedFailure` (the `tag` only) for a family
without one. See
[Solid Adapter](solid-adapter.md#resources-the-reader-is-the-only-way-to-render-content).

### AsyncResult Is The Async-State Vocabulary

`AsyncResult` (`import { AsyncResult } from "effect/reactivity"`) is Arc's one
async-state vocabulary. Arc signals own it and Solid renders it:

- `Resource.result(ref)` is `Signal.Readable<AsyncResult<A, E>>` (a load or
  `provides` callback that breaks its contract is a defect in the `Cause`, not
  part of `E`);
  `Resource.status(ref)` adds cache-policy facts (`isStale`, `isGcExpired`,
  `staleAt`, `gcAt`, `ageMillis`, `staleInMillis`, `gcInMillis`) beside `result`.
- Action instances expose `state: Signal.Readable<{ result: AsyncResult<A, E>; input: Option<I> }>`
  (idle is `Initial`; a `run`, `optimistic`, or `invalidates` callback that
  breaks its contract is a defect, not part of `E`); the latest invalidation
  plan stays its own signal.
- A live query's `state` is `AsyncResult<ReadonlyArray<T>, E>` beside the
  always-available `rows`. Solid handles project every `AsyncResult` (a
  Resource's or Action's `result`, a live query's `state`) to `waiting()` and
  `failure()`.

Settlement semantics are shared. A load or submission marks the current result
`waiting` without changing its tag, so a refresh is `Success` with
`waiting: true` and a retry after a failure is `Failure` with `waiting: true`.
Every Resource load and Action submission then settles from its `Exit` through
one internal settle step, timestamped with the Effect `Clock` (never
`Date.now()`), inside an uninterruptible region so no outcome can leave an entry
waiting:

- success settles to `Success` with the `Clock` timestamp;
- typed failures, defects, and mixed causes settle to `Failure` carrying the
  full `Cause`, keeping the latest success as `previousSuccess`;
- an interrupt-only exit is cancellation, not an outcome: the result returns to
  its prior settled state with `waiting: false` (a superseding load, hydration,
  or delete writes its own state next). Resources publish `ResourceInterrupted`
  instead of `ResourceFailure` in that case.

The Resource Read Decision derives from the same `AsyncResult`: `Initial` reads
are pending (`ResourcePending` with reason `Initial`, or `Pending` while a first
load is in flight); `Success` returns the value, requests a background refresh
when stale, and resets to pending (`Collected`) past `gcFor`; a settled
`Failure` throws `ResourceFailure` (whose `result` is the `AsyncResult.Failure`;
reach the typed error with `AsyncResult.error(failure.result)`), while a
`Failure` that is `waiting` on a retry returns stale data when present and is
pending otherwise.

TSRX remains the authoring language for component templates, while Effect handles
retry, cancellation, scoped cleanup, error recovery, and server boundaries.

Core owns the Resource UI Binding Controller used by the Solid resource
reader. That Module keeps ref identity, runtime-bound refresh/preload Effects,
automatic preload fibers, keyed preload failures, stale preload interruption,
and Suspense preload-token dedupe adapter-neutral. The Solid adapter still owns
host reactivity and host Suspense thenable throwing.

Framework callbacks are intentionally Effect-typed. Resource loads, Action
runs, `Resource.implement` / `Action.implement` / `Server.implement` bodies,
and route preload should return `Effect` or a pure value. Promise-shaped host work is converted with
`Effect.tryPromise` at the adapter edge, not hidden inside application
definitions.

Schemas carry nominal meaning, not only runtime validation. Domain identifiers
that cross framework seams should use `Schema.brand`, so route params, resource
inputs, action payloads, server contracts, and manifests cannot accept a random
string by structural accident:

```ts
export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const makeProjectId = (id: string): ProjectId => Schema.decodeUnknownSync(ProjectId)(id);
```

## State

A State is the one way to hold writable client state: a named model that
changes only through its messages. Messages are tagged, and `on` holds one pure
handler per `_tag`. The smallest State infers its messages from `on`:

```ts
const MenuOpen = State.define({
  name: "Menu.open",
  initial: false,
  on: { Toggle: (open) => !open },
});

const Search = State.define({
  name: "AppShell.search",
  initial: "",
  // The second parameter types the message's fields: { _tag: "Search"; query: string }.
  on: { Search: (_query, message: { readonly query: string }) => message.query },
});
```

Each key of `on` is a message `_tag`, and a handler's second parameter types
that message's fields. Commands in the inferred form may only emit nothing
(`State.emit(Effect.log(...))`): a command that emits the State's own
messages would make the union circular, so such a State names the union up
front with the explicit form:

```ts
type CounterModel = { readonly count: number; readonly loading: boolean };
type CounterMessage =
  | { readonly _tag: "Increment" }
  | { readonly _tag: "Load" }
  | { readonly _tag: "Loaded"; readonly amount: number };

export const Counter = State.define<CounterModel, CounterMessage>()({
  name: "Counter",
  initial: { count: 0, loading: false },
  on: {
    Increment: (model) => ({ ...model, count: model.count + 1 }),
    Load: (model) =>
      State.next(
        { ...model, loading: true },
        State.emit(Effect.succeed({ _tag: "Loaded", amount: 2 } as const)),
      ),
    Loaded: (model, message) => ({
      count: model.count + message.amount,
      loading: false,
    }),
  },
});
```

`name` is required: it names the model signal and every commit the State
makes. `on` is exhaustive by message `_tag` and is the one way to write a
transition: there is no lower-level `update` callback, and messages are always
tagged (`{ _tag: "Tick" }`, not `"tick"`). Tags are PascalCase, Effect's
`_tag` convention, and are spelled the same in `on`, `send.Tag`,
`dispatch({ _tag })`, `State.step`, and Timeline labels.

A handler is pure and synchronous: it returns a plain model value or
`State.next(model, commandInput)`, and never an Effect.
Commands are Effects that may emit one follow-up message, and `State.emit(...)`
is their one constructor: `State.emit(message)` emits immediately,
`State.emit(effect)` emits the message the Effect produces, and an Effect that
completes with `void` emits nothing (background work). `State.commands(...)`
batches several for `State.next(model, ...)`.
`State.subscription(stream)` connects model-dependent Streams to the same
message loop. Promise-shaped host work belongs inside `Effect.tryPromise(...)`
before the command or subscription emits a plain message.

Because handlers are pure, a transition is tested as a function call.
`State.step(definition, model, message)` returns `{ model, commands }` without
running anything; a command is a description whose `effect` a test runs (with
test services) to get the message it emits:

```ts
const loading = State.step(Counter, Counter.initial, { _tag: "Load" });
expect(loading.model.loading).toBe(true);
expect(loading.commands).toHaveLength(1);
expect(Effect.runSync(loading.commands[0]!.effect)).toEqual({ _tag: "Loaded", amount: 2 });
expect(State.step(Counter, loading.model, { _tag: "Loaded", amount: 2 }).model).toEqual({
  count: 2,
  loading: false,
});
```

The runtime uses the same `State.step`: it commits the model, then runs the
commands on the Runtime Spine.

A running State exposes a readable model signal, a typed `dispatch(message)`
Effect that completes once the update commits, failures, and disposal. UI code
binds a State per Component instance with Solid's `Component.state(Counter)`,
whose services join the component's `R` and whose handle adds one DOM-ready
sender per tag (`onClick={menu.send.Toggle}`). A definition's `scope` says who
owns the bound instance: each Component instance (the default), or, with
`scope: "app"`, the runtime. An app State (an undo toast, a cart) is one
instance per runtime, registered on the runtime's Resource Store: the first
`Component.state` binding starts it with that binding's services, every later
binding shares its model, unmounting a binder never stops it, and disposing
the runtime does. A Start server render's request runtime has its own store,
so each request gets its own app States, never a module-global one; both
sides start from `initial`, like Component States, so there is no model to
hydrate. Its commits are `Timeline.StateCause` entries under its `name`, and
every handle on it is the same `State.Ref`, so an Action's optimistic patch
through any of them is seen by all. Headless code starts a new instance (of
either scope) on an explicit typed runtime (there is no default runtime):

```ts
const counter = State.start(Counter, { runtime });
```

That keeps service requirements visible to TypeScript. A State keeps no
history of its own: each committed message is one entry on the app
[Timeline](#timeline-and-replay), a `Timeline.StateCause`
(`{ _tag: "State", state, event, message }`) labelled `State "Counter" Load`,
so devtools and tests inspect State history the same way as every other state
change.

Every running State (a `State.Instance` or a `Component.state` handle) is a
`State.Ref`, the target an Action's `optimistic` patch takes:
`transaction.set(counter, (model) => ...)`. The patch layers over the model
with the same machinery as a Resource entry patch: a message that arrives while
the patch is in flight applies to the base model and the patch re-applies over
it, success folds the patch in, and a failure drops the patch and keeps the
messages.

The model signal is the Effect-side source of truth: every update commits one
immutable model. Renderers must not turn that single value into coarse
re-renders, so the Solid adapter's `Component.state(...)` reconciles each
commit of an object model into a fine-grained read-only projection: unchanged
subtrees keep their identity, arrays reconcile by key (`"id"` by default), and
a reader re-runs only when the part of the model it read changes. A State
whose initial model is a primitive (a toggle, a search string) skips the
projection and reads the signal directly. Foldkit-style centralized state,
Solid-style granular updates.

Resource values take the same path. The Resource Store shares every new value
of an entry with the one it replaces (deep-equal parts stay the previous
objects, rows match by `rows.key`), so an equal refresh changes nothing Effect
code or live queries can see, and the reader projects the value into the same
kind of read-only view, keyed by `rows.key` or `"id"`. Both halves are needed:
Solid re-applies a DOM binding whenever its computation re-runs, even to an
equal value, so identity alone cannot stop a sibling-field change from
rewriting an `<input>`, and a projection alone would leave Effect consumers
with a new object per refresh.

## Runtime Spine

Every app has an `SunfallArcRuntime`, backed by Effect `ManagedRuntime`. A
client-only app gets the default empty runtime; a full-stack Start app gets a
server runtime from `createRequestHandler(app, { server })` and a browser
runtime from `App.launch(app)`, built from the app's client Layer.

The runtime also owns a `ResourceStore`. `Resource.define(...)` is only the
Resource Definition; live resource entries, Effect `Cache` instances, known
inputs, tag indexes, hydration state, and resource lifetime fibers live in the
current runtime/request store. This is the seam that keeps SSR requests,
browser sessions, and test runtimes from sharing hidden process-global async
state.

Start creates a Request Runtime for every SSR or RPC request. A Request Runtime
shares the app's Effect services but gets a fresh Resource Store and a
request-local `Server.localClient(...)`. Route preload, render, server
functions, hydration payload creation, and Resource reads during render all
run through that request runtime, then the Resource Store is
disposed at request completion to interrupt any lifetime fibers. Internally,
the Request Runtime Lifecycle Module owns failure/interruption teardown,
ResponseContext application, ending the request span, runtime disposal, and
streamed response finalization after the request handler has selected the
response Effect to run.

Request and response facts are ordinary services. `RequestContext` exposes the
current `Request`, parsed `URL`, headers, and cookies. `ResponseContext` lets
preload, render, server functions, and actions set status,
headers, and cookies through Effect:

<!-- prettier-ignore -->
```ts
yield* ResponseContext.use((response) =>
  Effect.gen(function* () {
    yield* response.setHeader("x-project", "atlas");
    yield* response.setCookie("session", token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
  }),
);
```

Start applies the accumulated response context to the final `Response`, including
RPC and progressive action responses, before the host adapter writes it. This
keeps cookies and headers inside the request runtime instead of forcing app code
to thread mutable response objects through every API.

For non-streaming responses, request completion is the moment the handler has
created the `Response`. For streamed responses, Start wraps the response body and
closes the Request Runtime only after the body closes or the browser/server
adapter cancels it. This keeps server render streams, deferred hydration chunks,
resource GC fibers, and request-local services alive for the actual lifetime of
the HTTP response.

The Runtime Spine is the one place where host boundaries are allowed to run Effects:

- Server function host calls run through the current runtime.
- `Resource.preload` / `refresh` use the current runtime.
- `Action.use(definition, { runtime })` and `State.start(definition, { runtime })`
  take an explicit runtime; neither falls back to a default.
- Start request handlers run SSR preload and render on a request runtime
  derived from the server Layer; `App.launch` runs the browser tree on a
  runtime built from the app's client Layer.
- Solid Components get their runtime from their entry point
  (`App.launch` or `createRequestHandler` in a Start app; `Component.launch`,
  `mount`, or `embed` otherwise), which checks the tree's services against it;
  every setup-time binding (resources, actions, states, streams,
  callbacks, live queries, the router and its route preloads) runs on its
  instance's runtime with the setup's context. There is no runtime context and
  no implicit default runtime.

That means services, tagged errors, request context, scopes, retries, and
fibers all flow through one Effect-native execution model instead of being
hand-wired per feature.

## Effect Services

Application features should depend on Effect services, not directly on transport
details. Arc adds no wrapper: a service is a plain `Context.Service`, and each
host or test provides it with a `Layer`:

```ts
export interface ProjectStore {
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
  readonly rename: (input: RenameProjectInput) => Effect.Effect<Project, ProjectNotFound>;
}

export const ProjectStore = Context.Service<ProjectStore>("ProjectStore");

export const ProjectStoreLive = Layer.effect(ProjectStore, openProjectDatabase);
```

Server data is read and written on the server: served Resources and Actions
(see [Served Resources And Actions](#served-resources-and-actions)) declare
their schemas in shared modules, and their `*.server.ts` implementations
depend on `ProjectStore.use(...)`, so the server Layer given to
`createRequestHandler(app, { server })` must provide it. Services the browser
itself needs (a clock, a local store) go in the app's client Layer. Tests
provide `Layer.succeed(ProjectStore, ...)`, or answer served loads with
`Server.mockLayer(...)`, without replacing app code.

## Progressive Actions

A served Action (one defined without `run`) is request-runtime work: its
schemas are the wire contract, and its `Action.implement` in a `*.server.ts`
module is the body the server runs. A form-backed Action declares the
`ActionResult` shapes it answers in its `output`:

```ts
// shared
export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: Schema.Union([ActionResult.Redirect, ActionResult.ValidationFailure]),
});

// project.server.ts
export const submitProjectName = Action.implement(SubmitProjectName, (input) =>
  ProjectStore.use((store) => store.submitName(input)),
);

export const handleRequest = createRequestHandler(app, {
  server: AppServerLive,
  implementations: [submitProjectName],
});
```

`Action.implement` checks `run` against the definition: it may succeed only
with `output` and fail only with `error`, and its services join the server
Layer's requirements. `POST /__sunfall-arc/action` accepts either JSON
(`{ name, input }`) or ordinary form bodies. Start decodes the input with the
Action Definition schema, runs the action through the Request Runtime, and
maps `ActionResult` values to HTTP:

- `ActionResult.redirect(...)` becomes an HTTP redirect for form posts and a
  typed redirect envelope for JSON action clients.
- `ActionResult.validation(...)` becomes a typed `422` JSON payload.
- `ActionResult.success(...)` and non-ActionResult values become typed success JSON.
- Effect failures become typed failure JSON when the action has an error schema;
  protocol and defects stay separate.

When a JSON action produces an invalidation plan, Start dehydrates the refreshed
resource refs from the request-local Resource Store and includes them in the
response metadata.

The client side of that transport is Core's `ActionTransport` service, the
Action counterpart of `Server.Client`. Every Action instance looks it up when it
submits: Actions the transport serves run remotely, and the response (decoded
outcome, hydrated Resources, invalidations) applies to the
submitting runtime; every other Action runs its `run` locally. Start's
`App.launch(app)` provides one that serves exactly the served Actions (those
defined without `run`), next to the server-function `Server.Client`; both
post through the runtime's one `HttpClient`. A served Action submitted on a
runtime with no transport fails with `ActionNotFound`. UI code never chooses: Solid's
`Component.action(definition)` submits the same way either way, with the same
result type and error type (the Action's own errors plus `Action.ClientError`:
`ActionTransportError`, `ActionProtocolError`, `ActionNotFound`).
A superseded `parallel` submission applies only its invalidations, so hydrated
values stay latest-only. The server's action endpoint always runs Actions
locally and never applies `optimistic`: only the submitting client patches its
own state, and the request's store is discarded with the response.

JSON action clients and progressive form helpers share the same Start Action
Request Codec. Schema-backed input encoding happens before values cross the
wire/form seam; synchronous form helpers fail with `StartActionFormEncodeError`
when defaults cannot be encoded.
The action client posts through the same `HttpClient` the server-function
`RpcClient` uses (the client Layer's, else `FetchHttpClient`), so headers,
retries, and trace propagation are configured once, on the `HttpClient`. The
action wire protocol (no-JS forms, redirects, durable submission ids) stays
Start's own.

The small `StartAction.form(action, { input })` helper generates the form method,
action URL, and hidden metadata fields. Visible form controls are merged over
the hidden JSON input before schema decode, so a form can carry stable values
such as `id` and `redirectTo` while the user edits fields like `name`.

This is the progressive enhancement seam: with JavaScript, the Solid handler
intercepts the submit and calls the Component's action handle (which the
transport routes to the server); without JavaScript, the same form posts to
Start and runs the same Action Definition, Effect services, schemas,
retries, and invalidation policy.

### Optimistic Patches

`Action.define({ optimistic })` receives a transaction that owns every patch
for the life of one submission:

```ts
optimistic: (input, transaction) =>
  Effect.all([
    transaction.update(ProjectsRef, input.id, { name: input.name }),
    transaction.set(ProjectById(input.id), (project) => ({ ...project, name: input.name })),
    transaction.set(lastRenamed, input.id),
  ]),
```

The transaction has one verb per kind of state. `set(target, update)` patches a
value: a running State's model (a `State.Ref`: a `State.Instance` or a
`Component.state` handle), or the entry a Resource ref names (`ProjectById(id)`,
from any family). `update` is a plain value or a pure updater of the current
one, typed by the target (the Resource's output type). `insert`, `update`, and
`delete` patch single rows of a Resource that declares `rows`, by key: they
take its ref (`ProjectsRef`), and the key and row are typed by its `rows`.
Every patch applies before `run` (or the remote submission).

A Resource patch is a layer over the entry's synced value in the submitting
runtime's store. Readers (`Resource.result`,
`Resource.read`, the Solid reader with its `waiting` and `failure`) see the
patched value with the entry's own status, so there is no Suspense flash; a
reload during the submission replaces the synced value underneath and the
layer stays on top. Loads (`Resource.preload`, `refresh`, `changes`) and
snapshots see only the synced value.
An entry that has not loaded is left alone: the patch is a no-op.
A State patch is the same kind of layer over the State's model: a message
that arrives during the submission applies to the base model and the patch
re-applies over it, so a rollback drops the patch and keeps the message.

Row patches are the same layers: each is an updater of the entry's rows
array, so a reload replaces the rows underneath and the patch reapplies on
top, and later submissions' layers stack in order. An update shares the
array's key positions and moves only the index buckets the row left or
joined (`resource-rows.ts`), so a patch never rebuilds the lookups; an update
or delete of a missing key is a no-op, and an update that changes the key is
a defect. Success commits the transaction: State and Resource patches fold
into the synced value, where the `invalidates` reload (or, remotely, the
response's invalidations) replaces them. A typed failure, defect, or
interruption rolls the transaction back and rebases every other submission's
patches. So does a rejected `ActionResult`: a run (local, remote, or a
durable replay) that returns `ValidationFailure` or `Failure` means the
change did not happen, so its patches roll back exactly as on a failure,
without folding and without a reload: the definition's `invalidates` does not
run for it (only invalidations the result itself carries do); `Success` and
`Redirect` results commit. Patch, commit, and rollback writes commit under the Action's Timeline
cause (`submit`, `success`, `failure`), so travel shows them. Snapshots (SSR
dehydration, persistence) carry only the synced value: a patch belongs to an
in-flight submission and never crosses a wire.

`Action.planOptimistic(definition, input)` tests a patch without writing
anything or calling a backend: it runs `optimistic` against a recording
transaction and returns the changes it would make, applying none. A `set`
reports `{ _tag: "Set", target, value }` with the value the State or Resource
entry would read, computed from its current value in the caller's runtime (a
Resource entry that has not loaded plans no change); a row change reports the
ref and the change as given (`{ _tag: "Update", target: ProjectsRef, key,
update: { name } }`). It is the optimistic counterpart of
`Action.planInvalidation`.

Resource persistence (`policy.persist: { key, version }`,
`resource-persistence.ts`) uses the same `KeyValueStore` as the Action Outbox
below. A persisted family writes each settled value (loads, hydration,
`rows.changes` batches) at `arc/resources/v<version>/<key>/<ref key>`,
encoded through `output` like a hydration snapshot; optimistic patches are
never persisted. A never-loaded entry restores the persisted value at once
and reloads in the background. `policy.persist` adds `KeyValueStore` to the
family's services, so a runtime without one does not compile; Start provides
one on both sides (the client Layer's or `localStorage` in the browser, a
store that keeps nothing during SSR). Storage or decode failures are logged
rather than failing loads.

A `rows.changes(input, rows)` feed starts with an entry's first load, or when
the entry is hydrated, on the runtime's Resource Store. `rows` are the synced
rows it starts from (the loaded or hydrated value), so a feed resumes from
what they hold, such as the newest version among them. Each batch of
`Upsert`/`Update`/`Delete` changes applies to the synced rows under the
Timeline cause `Resource ... change` and publishes `ResourceRowsChanged`; a
failed feed publishes `ResourceRowsChangesFailure` and stops. Disposing the
runtime or evicting the entry interrupts it. A Start request runtime's store
renders one response and never starts a feed (no wasted work, no server-side
effects of a feed); the browser runtime starts it when it hydrates the entry.

### Durable Submissions

An Action opts into durability with one policy field. It requires an `input`
schema (the types refuse `durable` without one), because a durable submission
is stored schema-encoded:

```ts
export const AdvanceProject = Action.define({
  name: "Project.advance",
  input: AdvanceProjectInput,
  output: ProjectSchema,
  durable: { maxAge: "1 day" },
  optimistic: ({ id }, transaction) =>
    transaction.update(ProjectsRef, id, (project) => ({
      ...project,
      progress: project.progress + 8,
    })),
});
```

`durable` adds `ActionQueued` to the Action's error type, so every handle and
`submit` caller sees it. A submission on a client runtime that has an Action
Outbox (`ActionOutbox`, provided by `Action.outboxLayer()`; Start's
`App.launch` provides one) goes through it:

- **Persist before send.** The outbox applies the optimistic patch, appends
  `{ id, action, input (schema-encoded), createdAt, attempts }` to its queue,
  and only then sends. The queue lives in the runtime's `effect/persistence`
  `KeyValueStore` under the prefix `arc/actions/v1/` (key `queue`), encoded
  with `KeyValueStore.toSchemaStore`. In a Start app it is the browser's one
  store, shared with persisted Resources: the client Layer's, else
  `localStorage`. Elsewhere the runtime's Layer chooses it
  (`KeyValueStore.layerMemory` in tests, `layerSql`/`layerFileSystem`). The
  optimistic intent is the input itself: `optimistic` is a pure
  function of it, so restoring re-runs it instead of serializing patches.
- **`submit` settles or queues.** It succeeds or fails with the outcome when
  the submission settles while the caller waits (online, this is the same
  value or typed failure a non-durable submit returns). A retryable failure
  instead leaves the submission pending and fails the caller with
  `ActionQueued { actionName, id }`; the handle's `failure()` shows it, and
  the patch stays applied. Retryable means a transport failure that says
  nothing about the Action (`isRetryableActionFailure`: `ActionTransportError`
  with reason `Network`/`Interrupted`, or a 408, 429, or 5xx status that is
  not a Start defect). Typed domain failures, protocol failures, and defects
  are final.
- **Global FIFO replay.** One replay loop sends pending submissions in
  submission order, across Actions, because later submissions may depend on
  earlier ones and a retryable failure (connectivity) blocks them all alike.
  It runs on new durable submissions, on the window `online` event, and on
  launch, backing off with the outbox's `retry` schedule (exponential from 1
  second, 10 retries) while the head keeps failing retryably. Every attempt
  sends the submission id.
- **Settling.** Success removes the entry, folds the patch in, and applies the
  response (hydration and invalidations) as any submission does. A final
  failure removes the entry and rolls the patch back. A waiting caller gets
  its own outcome; a submission nobody waits on (queued, or restored) reports
  a final failure in the outbox's `failures` instead.
- **Reloads.** `App.launch` hydrates the root first (so the first client
  render matches the server's), then runs `Action.restoreOutbox`: pending
  submissions are decoded, re-patched in order on top of the hydrated rows,
  Resource entries, and Signals, and replayed. Restoring after hydration is
  what lets a Resource patch apply: before it, the entry has not loaded.
  Submissions the server already settled before rendering the page are not
  re-patched (see below). An entry older than its Action's `durable.maxAge`
  fails with `ActionSubmissionExpired`; one whose Action is no longer defined
  and durable, or whose input no longer decodes, fails with
  `ActionSubmissionUnrestorable`. A durable Action must be defined in a module
  the entry loads, so it is registered before restore.
- **Observing.** `Action.outbox` is the read side: `pending` (entries in
  replay order), `failures`, and `dismiss(id)`. A runtime without an outbox,
  such as a server render, reports nothing pending, so a Component can render
  "3 changes waiting to sync" without a server-side service. The outbox
  commits with Timeline causes `Action "<name>" queue`, `restore`, `replay`,
  `success`, `failure`, and `dismiss`.
- **Client-only.** The endpoint site never consults an outbox, and the server
  render path never persists anything. Non-durable Actions pay nothing: the
  workflow checks `definition.durable` before it looks for an outbox.

On the server, Start's action endpoint runs a submission that carries an id as
an `effect/workflow` Workflow, one per Action
(`sunfall-arc/action/<name>`), keyed by its submitter and submission id (see
Submitter scope below).
Its single Activity decodes the input, runs the Action at the endpoint, and
encodes the response; the response record (status, headers, body: the value or
typed failure encoded with the Action's schemas, plus hydration and
invalidation metadata) is the Workflow's success value, and its error channel
is empty, since typed failures are part of the response. A replayed POST with
the same id from the same browser returns the recorded response without
running `run` again, and a
duplicate that arrives mid-run joins the running execution. The engine is the
server Layer's `WorkflowEngine` when it provides one (a cluster or SQL-backed
engine gives exactly-once across instances and restarts), otherwise the
handler's in-memory engine. Submissions without an id, or for an Action that
is not durable (progressive forms), run directly.

The in-memory engine is `WorkflowEngine.layerMemory`, which never forgets an
execution, so Start rotates it per Action in generations bounded by the
Action's `durable.maxAge`: new submissions go to the newest generation, a
generation stops taking new ones once it is `maxAge` old, and it is closed
with all its records once nothing in it is in flight and its last execution
settled `maxAge` ago. A client replays a submission only within `maxAge` of
creating it (before the server first saw it), so a record lives as long as a
replay can reach it, and memory holds at most about two `maxAge` windows of
submissions. A persistent engine owns its own retention.

A lost response does not double-apply a patch after a reload. `App.launch`
mirrors the outbox's `pending` into the `sunfall-arc-outbox` cookie
(`[action, id]` pairs, oldest 32). A document request that carries it makes
the server poll the engine for those ids after preload, and the root
hydration payload lists the ones that already completed
(`settledSubmissions`). `Action.restoreOutbox({ settled })` restores those
without re-applying their patch, because the rendered state already reflects
their outcome, and their replay only fetches the recorded response. A
submission that settles after the server polls stays patched until its
replay returns, as before.

**Submitter scope.** A recorded response is the original submitter's data, so
an execution belongs to the browser that started it. Start keeps a random
32-byte token in the `sunfall-arc-submitter` cookie (HttpOnly, SameSite=Lax,
Path=/, Secure over https, 400 days), minted with Effect's `Crypto` service
(over Web Crypto) on the first document response of an app that has durable
Actions, or on the first durable submission from a browser that has none (a
static page). A minting response is also marked `Cache-Control: private`, so
no shared cache hands one browser's token to another. The workflow payload
carries the token's SHA-256 digest (the owner key), never the token, and the
idempotency key is owner key plus submission id. So:

- The same browser replaying an id, after a lost response or across reloads,
  gets the recorded response.
- Any other request with that id (another browser, no cookie, a malformed
  token, a cross-site POST, which SameSite=Lax strips of the cookie) is a
  different execution: it runs the Action as a new submission and never sees
  the original response.
- The `settledSubmissions` lookup polls only the requesting browser's own
  executions, so naming another browser's ids in the outbox cookie confirms
  nothing; a document request without a submitter reports none.

Because the document mints the submitter before the page can submit, a
submission whose response is lost replays under the token that recorded it.
A submission from a page that never received a minting response (a static
page whose first durable response is lost) replays under a new token and runs
again; the token is browser state, so any server instance sharing the engine
recognizes it.

## Resource Dependency Graph

Resource dependencies are semantic tags, not string cache keys. Families can say
which domain facts a successful value provides:

```ts
const ProjectsTag = Resource.tag("Projects");
const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

const ProjectById = Resource.define({
  name: "Project.byId",
  input: ProjectId,
  output: Project,
  provides: (project) => [ProjectTag({ id: project.id })],
});
```

Actions can invalidate refs directly or invalidate the tags they changed:

```ts
const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: Project,
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});
```

At runtime, successful resource loads update a tag index from tag key to known
resource refs inside the active Resource Store. Invalidating a tag refreshes
every live resource ref in that store that last provided it. This gives
mutations a typed dependency graph without coupling actions to route shapes,
component trees, or hand-written cache-key strings, and without leaking a server
request's resource graph into another request.

Resource and action definitions also publish static diagnostics for tooling.
`Resource.diagnostics()` reports declared families, tags, schema flags,
tag-providing behavior, stale/GC/retry/persist policy, and declared `rows`
(index names and whether a change feed exists).

The graph is inspectable before it is executed:

<!-- prettier-ignore -->
```ts
const plan = yield* Resource.planInvalidation([ProjectsTag, ProjectTag({ id: project.id })]);

plan.entries.map((entry) => ({
  ref: entry.ref.key,
  causes: entry.causes,
}));
```

An Action instance exposes the latest `invalidationPlan` as a signal, and
`@sunfall/arc-devtools` can serialize the plan into plain data for a panel or
trace view. The intended debugging loop is “this mutation invalidated these
domain facts, which matched these live resource refs, for these causes.”

Requests are traced with Effect's own tracing. Start wraps each request in a
`sunfall-arc.start.request` span (parented on an incoming W3C `traceparent` or
B3 header), with child spans for server RPC and Start action execution, log
annotations for request identity, and Effect metrics for request count,
duration, and status. The request span carries the request's facts as
attributes: the matched route (`http.route`), preloaded and hydrated Resource
keys, the failure kind, the response status, the streamed body's final state,
and request runtime teardown (whether disposal finished, fibers left behind,
any cleanup failure). The span stays open until a streamed body closes, errors,
or is cancelled, so its duration covers the whole response. Any Effect `Tracer`
sees these spans: an OpenTelemetry exporter, or `Devtools.layerTracer(store)`,
which records ended spans for the Requests panel.

## Components

JSX erases types: every element is `JSX.Element`, so services and typed render
failures cannot flow through JSX. `Component` (in `@sunfall/arc-solid`) is the
single Solid app model: it moves them onto component **definitions**, composed
with `yield*` in a per-instance setup generator:

```tsx
const ProjectCard = Component.define("ProjectCard", function* (props: { readonly id: ProjectId }) {
  const project = yield* Component.resource(ProjectById); // E += typed load error, R += its services
  return () => <article>{project(props.id).name}</article>;
});

const Dashboard = Component.define("Dashboard", function* () {
  const Card = yield* ProjectCard.pipe(
    Component.catchTags({ ProjectNotFound: () => <p>Gone</p> }),
    Component.loading(() => <Spinner />),
  );
  return () => <Card id={selected()} />; // Card is a plain Solid component
});
```

A `Component<P, E, R>` is yieldable like an Effect service key: yielding it
adds its `E` and `R` to the parent and returns a plain Solid component whose
instances run in the parent setup's context. `E` is phantom at the Effect
level; setup failures, provided-Layer failures, and failed first Resource loads
surface when the instance renders, by throwing to the nearest Solid `<Errored>`.
`catchTags` installs that boundary and removes handled tags from `E`, and
`catchAll` handles every typed failure; unmatched failures and defects rethrow
outward. `Component.resource` contributes only the family's render failure
(`Resource.RenderError`): the type of its `error` schema, which `load` must
fail within, or `ResourceUntypedFailure` for a family without one, since only a
failure's `_tag` can cross a server render without a schema (see
[SSR Hydration](#ssr-hydration)). A load callback that throws synchronously
(`EffectInputCallbackError`) is a programming defect, re-caused as `Die` so no
handler can (or must) match it.
`LiveQuery.bind` contributes its sources' declared load errors the same way
(rows throw when no source has loaded and the latest load failed), while
`Component.action` contributes nothing: `submit` returns its failures to the
caller, and `Component.callback` requires them handled.
`provide` removes services from `R`; `launch`, `mount`, and `embed` accept only
`Component<P, never, R>` whose `R` their runtime provides.

The cost model:

- **Setup runs once per instance**, with the instance's props, under its Solid
  owner (every generator step, even after an asynchronous one), with an
  instance Scope that closes when Solid disposes the instance. A synchronous
  setup renders in place; an asynchronous one suspends `<Loading>`.
- **Setup-time bindings** add their services to `R`: `Component.resource` (a
  suspending reader plus value-free `waiting`/`failure` status),
  `Component.action` (a submission handle, local or transported),
  `Component.state` (a State per instance, or the runtime's one for
  `scope: "app"`: a read-only model view plus DOM-ready `send.<Tag>`
  senders), `Component.stream` (a Stream's latest
  value, read-only), `Component.callback` (other Effect work from DOM
  handlers, failures handled),
  `Component.router` (routes' preload and route Component services join `R`),
  and `LiveQuery.bind` (a live query over rows Resources).
  `Component.instance` is the seam for writing more.
- **Per-runtime sharing is by construction**: Resources live in the runtime's
  Resource Store, and `Component.provide` builds its Layer once per
  runtime in a host Scope released on runtime disposal. A reader keeps one
  fiber-backed async memo per ref; releasing the last claim defers disposal to
  a microtask, so an owner that recomputes (or a suspended read re-run) in the
  same flush keeps the binding.
- **Plain Solid components** stay the tool for presentational leaves; they cost
  nothing.

`Component.launch(App, root, options?)` is the app entry point: an
`Effect<never, ER>` that starts the runtime and keeps the tree mounted until
interrupted, like `Layer.launch` (`Effect.runFork(Component.launch(App, root))`).
It is `Effect.scoped` over `Component.mount(...)`, the composable scoped
acquisition (`Effect<void, ER, Scope>`): closing the Scope disposes the Solid
tree, then any runtime the mount owns, and a failed mount releases what it
acquired immediately. `Component.embed(App, runtime)` renders the same tree as a
plain Solid component on an explicit runtime.

A Start app does not call these itself. `createRequestHandler(app, ...)` renders
`app.root` with `embed` under each request runtime, so each instance's setup
runs in that runtime and route-preloaded Resources read synchronously.
`App.launch(app)` restores the Resource snapshot into the
browser runtime and then hydrates that markup with
`launch(app.root, root, { runtime, hydrate: true })`, rendering the same tree.
Both pass the root `App.RootProps` (`{ href }`): the request's path and search
on the server, the page's in the browser.

## Component Runtime

Every Component instance owns an Effect `Scope`, and route components rendered
through `RouterOutlet` additionally get a route UI scope. Closing a scope runs
its finalizers and interrupts its fibers: streams from `Component.stream`,
fibers forked by `Component.callback`, States, and in-flight Action
submissions all stop with the instance. Plain Solid components stay unscoped.
Callbacks and streams are named transitions: a stream element commits as
`<Component>.<name>` on the Timeline, while the States, Actions, and Resources
a callback touches commit under their own causes.

```tsx
const PresenceTitle = State.define({
  name: "Presence.title",
  initial: "Sunfall Arc",
  on: { Rename: (_title, message: { readonly title: string }) => message.title },
});

const Presence = Component.define("Presence", function* () {
  // Stream-backed values stop with the instance.
  const presence = yield* Component.stream("presence", presenceStream, initialPresence);
  // Background Effect work forked from handlers is interrupted on unmount.
  const ping = yield* Component.callback("ping", () =>
    Effect.sleep("1 second").pipe(Effect.andThen(Effect.log("still mounted"))),
  );
  const title = yield* Component.state(PresenceTitle);

  // Imperative DOM sinks use Solid effects; Arc state tracks natively.
  createEffect(
    () => title.model(),
    (value) => {
      document.title = value;
    },
  );

  return () => <PresencePill presence={presence()} onClick={ping} />;
});
```

Use Solid effects only for imperative sinks: they read Arc state but never
change it. Use `State`, `Signal.derive`, `Resource`, `Action`, and named
callbacks for application state.

Resource families keep a synchronous signal for UI reads, but their backing
cache is Effect `Cache` stored in the current Resource Store. `preload`
uses `Cache.get`, `refresh` uses `Cache.refresh`, failures are not
retained as cache hits, and `gcFor` is applied as the Effect cache TTL.
In-flight loads are Resource Store-owned: callers join the store fiber, so
interrupting one caller detaches that caller without cancelling work for
navigation or another consumer. Resource deletion, invalidation, and Resource
Store disposal remain the cancellation seams for the underlying load.
Synchronous Resource reads and status checks still stay render-friendly, but
their lifetime decisions use the active Runtime Spine clock so custom Effect
clocks agree with `status(...)`. Missing synchronous reads use a peek-first
path and do not register absent Resource refs as live store facts. Effect code
should use `Resource.read(...)` so missing, pending, collected, and failed
states stay in the typed Effect error channel.

Default Resource keys are encoded through a Resource key codec rather than raw
object stringification. JSON-compatible values plus Date, URL, Map, and Set have
tagged stable encodings; unsupported or circular inputs fail with
`ResourceKeyError` and guidance to provide an explicit `key`.
The more general internal `stableStringify(...)` identity helper (in
`@sunfall/arc-core/internal`, used by DB query identity) follows the same
structured policy for Date, URL, Map, Set, binary values, undefined, sparse
array holes, marker-shaped plain objects, and typed unsupported-value failures.

Visible resource entry GC is also Effect-native. Successful loads fork an
immediately-started, interruptible `Effect.sleep(gcFor)` fiber; refreshes,
failures, hydration, explicit deletion, and Resource Store disposal interrupt the
old lifetime fiber before moving the entry to its next state.

The Resource Store also exposes an Effect `PubSub` event stream. Consumers can
subscribe with `Resource.subscribeEvents()` to observe pending, success,
failure, hydration, deletion, and GC scheduling facts for the active runtime.
This gives devtools and tests a stable Interface for resource behavior without
reading private cache maps.

## Streaming Responses

Start renders every page into one document shell. The app supplies only the
parts it owns through `document`:

```ts
createRequestHandler(app, {
  server: AppServerLive,
  document: ({ match }) => ({
    title: match === undefined ? "Projects" : `Projects · ${match.href}`,
    links: [{ rel: "stylesheet", href: "/src/styles.css" }],
    headers: { "x-app": "projects" },
  }),
});
```

Start writes the doctype, charset and viewport, the escaped `meta`/`link`
tags, Solid's hydration bootstrap, `<div id="root">` with the rendered root,
the streamed Resource chunks, the root hydration payload, and the browser
entry script, in that order. There is no hand-written HTML to drift from what
hydration needs.

Underneath, an internal Effect-native streaming Module builds the response:
`createHtmlStream` returns an Effect `Stream` of bytes, and the Start
render step appends `StartRenderHydrationPlan` streamed chunks before the tail.
Shell, chunk, and tail failures become typed `StartStreamError` values, so
streaming remains Effect-native until the final web platform seam.
When a Start render returns a streamed `Response`, the Request Runtime is held
open until the body is consumed or cancelled, and finalizer/request-trace facts
preserve the stream failure phase for diagnostics.
The render step receives a `StartRenderHydrationPlan` that separates the root
payload script (`hydrationPlan.root.script`, the one name for it) from
streamed resource chunks, so the document never emits a Resource pair twice.

## Router Runtime

Routes are schema-typed values with href generation, matching, and preload:

```ts
export const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  search: Schema.Struct({ tab: Schema.optional(ProjectTab) }),
  preloadResources: [ProjectById],
  preload: ({ params }) => Resource.preload(ProjectById(params.id)),
});

Route.href(ProjectRoute, {
  params: { id: makeProjectId("atlas") },
  search: { tab: "activity" },
});
```

Path params identify the page, so they are part of matching. `Route.match`
tries routes most specific first, and a route matches only when its path
pattern matches and its `params` schema decodes the params; params the schema
rejects identify nothing, so matching moves on to the next route, and a URL no
route accepts is not found. Core matching, Start SSR (status 404,
`notFound: true` in the payload), prerender, static navigation, the browser
router, and devtools route plans all go through `Route.match`, so they agree:
`/projects/Not-An-Id` is the same `NotFound` as `/nowhere`. Search values
refine a page the path already identified, so they decode after the match and
never change which route matched: a `search` schema failure is a typed
`RouteNavigationError` (a failed request, not a 404). A search value with a
sensible default says so in its schema (an optional field, or one with a
decoding default), so every URL for the page decodes.

The Solid adapter owns browser history through the router `Component.router`
creates, provided by `RouterProvider` and rendered by `RouterOutlet`. On navigation it
matches the route, runs `Route.preload` in an interruptible UI scope, then
mounts the matched route component in a fresh route UI scope. A navigation to
the page already on screen (the same route and params, a new search) keeps
that instance: the outlet shows it while the preload runs, then updates its
`search` props in place, so its States, focus, and DOM survive a search
change. Navigating away
runs Solid cleanup inside that route runtime/scope before disposing the route
scope, so cleanup callbacks, streams, watches, actions, and scoped fibers close
with the page they belong to.
A route's component is attached with `Route.withComponent(route, component)`,
where it takes `Route.Props<typeof route>`, or with
`Route.withComponent(route, component, (route) => props)`, which maps the
route props to a feature component's own props (checked against them). It is
the only way to attach one: route options take no `component`. Routes compare by
path, so `RouterLink`, `navigate`, and
`Route.isMatch` given the route reach the copy `withComponent` returned.
A route component loads as its own chunk when it is attached as a lazy
component, `Route.withComponent(route, Route.lazyComponent(importer))`; the
router loads it before rendering and still checks its services and failures
through the loaded module's type. In a Start app the file-route generator
writes that call for you: a sibling `<route>.component.tsx` module (beside
`<route>.ts`) default-exports the route's component, taking
`Route.Props<typeof route>`, and the generated route tree attaches it lazily.
The server preloads a matched route's lazy component before rendering, and
`App.launch` loads the initial route's before hydrating
(`Route.preloadComponent` on a route reaches the components its copies
attach), so both first passes render the same markup.
A route's preload failure is typed. `preload` is inferred from its own body
(params from `params` or the path, services and failures from what it
returns), so inline pipelines keep their types. Like an Effect RPC `error`
schema, a route can declare `error`; the inferred failure must then be covered
by that schema's type (otherwise the type error on `error` names the
undeclared failures as `Route.PreloadFailureNotInErrorSchema<...>`), and the
failure flows into router state as `RoutePreloadError<E>`:

```ts
class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: Schema.String,
}) {}

export const ProjectRoute = Route.define("/projects/:id", {
  error: ProjectNotFound,
  // Fails only with ProjectNotFound: Resource preloads fail only with their declared errors.
  preload: ({ params }) => Resource.preload([ProjectsRef, ProjectById(params.id)]),
});
```

`Resource.preload` and `Resource.refresh` take one ref or an array (loaded
concurrently, values in order), the same target shape as `Resource.invalidate`.

A preload can also end with a verdict instead of a failure. `Route.notFound()`
says the URL names nothing (the record the params identify does not exist),
and `Route.redirect(href, { status?, replace? })` says the page lives
elsewhere (a sign-in page for a request without a session):

```ts
export const IssueRoute = Route.define("/issues/:id", {
  params: Schema.Struct({ id: IssueId }),
  preload: ({ params, href }) =>
    Resource.preload(CurrentUserRef).pipe(
      Effect.flatMap((user) => (user === null ? Route.redirect(signInHref(href)) : Effect.void)),
      Effect.andThen(Resource.preload(IssueById(params.id))),
      Effect.catchTag("IssueNotFound", () => Route.notFound()),
    ),
});
```

`Route.planNavigation` plans them as `NotFound` (with the Resources the
preload loaded before its verdict, so a 404 page still renders the signed-in
shell) and `Redirect` (`location`, `status`; nothing hydrates). Start answers
404 and starts the server's routers `NotFound`, or answers the redirect
without rendering; the browser router settles `NotFound`, or navigates to the
redirect's href (replacing the entry unless `replace: false`; more than 20
consecutive redirects fail as a loop). Verdicts are not failures: they are
outside `error` and `Route.PreloadFailure<R>`. `Route.PreloadVerdict<R>` is
the verdicts a preload can end with, inferred like its failure, and
`Route.preload` fails with `RoutePreloadError<...> | Route.PreloadVerdict<R>`.

`Route.PreloadFailure<R>` is the error schema's type; without `error` it is
`RoutePreloadUntypedFailure` (only the failure's `tag`, which is all that can
cross the wire, so server, client, and hydrated renders agree), and it is
`never` for a preload that cannot fail or a route without preload. The router's
`Failure` state carries `Cause<BrowserRouterError<Routes> | ER>`, where
`BrowserRouterError` is `Route.NavigationPlanError<Routes[number]>` (navigation,
`RoutePreloadError<Route.PreloadFailure<...>>`, resource snapshot codec
failures) plus `RouteLazyComponentFailed` for lazy component loads. Synchronous
throws and Promise returns from `preload` break its contract and are defects.
Router navigation, link preload, and click interception share one route
membership policy: unregistered links are allowed to behave as normal anchors,
while programmatic navigation reports `RouterRouteNotRegistered`.

Links use the same typed route definitions. `RouterLink` builds the href from a
route plus `Route.HrefOptions`, preloads that route on hover or focus in the router
runtime (the preloader is created on the first such intent, and the server
renders a plain anchor), lets modified clicks and external targets behave like normal anchors,
and intercepts only plain left clicks for client navigation. Route grammar
rejects invalid or duplicate parameter names at definition/match planning time
instead of allowing later segments to overwrite earlier params.

Preload is also inspectable as a route data graph:

<!-- prettier-ignore -->
```ts
const plan = yield* Route.planNavigation(routes, "/projects/atlas");

if (plan._tag === "Matched") {
  plan.match.route.path;
  plan.refs.map((ref) => ref.key);
  plan.resources.resources;
}
```

This runs route preload through `Resource.collect`, so the framework can
explain which resources a navigation touched and which hydration entries it
would send before rendering the page. Start uses this same route plan for
SSR preload. If a touched resource cannot be serialized, planning fails through
the typed `Resource.SnapshotCodecError` Effect error channel. Resources with
`rows` are ordinary Resources here: their rows are the preloaded value.

Routes can also declare the resource families their preload is expected to
touch through `preloadResources`. `Route.describePreloadResources(route)`
reports those declarations as static facts (`declared`, `none`, or `unknown`
for a preload without a declaration) and keeps runtime
`Route.planNavigation(...)` as the dynamic proof for a concrete href. In Vite
dev, the Start SSR middleware logs a warning (`Effect.logWarning`) once per
loaded server entry for each route whose preload declares no
`preloadResources`.

File routes are manifest-first. The Start Vite plugin is the filesystem
boundary: when no explicit `fileRoutes` or `fileRouteManifest` is supplied, it
discovers route modules from the Vite root's `src/routes` directory and feeds
that deterministic file list into one validated manifest generator. The
generated artifact is `FileRouteManifest`, a deterministic object with
`version`, `routeDirectory`, sorted route `entries`, and every discovered
`module` (routes plus their component, layout, error boundary, and metadata
modules). Each carries its `routeId`, source `id`, browser/server `moduleId`,
`routePath`, parsed segments, and param metadata.

The supported conventions are intentionally narrow: nested directories, `index`
routes, dynamic `$id` segments, optional `$id?` segments, route groups like
`(app)` ignored in the URL, pathless layout directories beginning with `_`,
layout leaf files named `layout`, `_layout`, `+layout`, or beginning with `_`
ignored entirely, and route component files named `<route>.component`.

Generation rejects files that collapse to the same route path after route
groups and pathless segments are removed, route ids that collide, duplicate
support modules in one scope, and malformed dynamic segments like `$123`,
keeping bad route graphs out of builds. Discovered `.d.ts` files are ignored.
The Start Vite plugin exposes the same artifact as the Vite virtual module
`virtual:sunfall-arc/file-routes`, which exports `manifest`, `entries`,
`modules`, and the default manifest.

The same manifest generates a typed route definition module. On Vite startup and
build, Start writes `src/routeTree.gen.ts` by default, following the file-based
routing convention of keeping generated route types in the project for editors,
agents, and non-Vite tooling. Route files export a named `route` built with
core `Route.define(path, options)`, the same constructor as anywhere else;
static preload hints and preload work stay together, and the component is
attached where the app builds its router, or in a sibling
`$id.component.tsx` module that the generated tree attaches as a lazy chunk:

```ts
export const route = Route.define("/projects/:id", {
  params: ProjectRouteParams,
  search: ProjectRouteSearch,
  preloadResources: [ProjectById, ProjectSummaries],
  preload: ({ params }) => Resource.preload([ProjectById(params.id), ProjectSummaries("all")]),
});
```

The generated file imports those route modules and checks each imported route's
declared `path` against the path derived from its file: a literal-typed
assignment makes a mismatch a type error, and a load-time assertion makes it a
startup and prerender failure for builds that skip type checking. A route with
a sibling component module becomes
`Route.withComponent(route, Route.lazyComponent(Effect.tryPromise(() => import("./routes/projects/$id.component.js"))))`.
It then emits a `routes` tuple and a
`routeById` map of the route definitions (hrefs come from
`Route.href(routeById.route_projects_$id, ...)`, like any definition). The
matching Vite virtual
module `virtual:sunfall-arc/routes` exposes runtime helpers with Vite-root
absolute imports. Precise app-specific route id, params, search, href, and match
type maps live in the written `src/routeTree.gen.ts` module, where editors and
non-Vite tooling can index them without relying on virtual-module inference.
Each concept has one generated name (`FileRouteId`, `FileRouteParamsById`,
`FileRouteHrefOptionsById`, `FileRouteLayouts`, and so on), keyed by route id;
there are no short-name aliases. Apps can disable or move the generated file with
`sunfallArcStart({ fileRouteGeneration: { outputFile: false } })` or a custom
`outputFile`.

Apps that import these virtual modules should opt into their ambient types with
a checked declaration file such as `src/sunfall-arc-start-virtual.d.ts` containing
`import "@sunfall/arc-start/virtual";`, alongside the usual `"types":
["vite/client"]` Vite setting.

## SSR Hydration

Route preload is also the server data graph. For each document request,
`createRequestHandler(app, ...)` matches the route, runs its preload, collects
every resource touched by `Resource.preload`, and serializes the successful
resource cache entries into the document's hydration payload.

The payload includes the resource family name, stable key, and original input
(Arc's envelope) plus `state`: the `AsyncResult.Schema`-style JSON encoding of a
settled `Success`, `{ _tag: "Success", value, waiting: false, timestamp }`, with
`value` encoded through the family's `output` schema when one exists. Hydration
is Success-only: failures can carry server-only causes and are never serialized.
In the browser, `App.launch(app)` applies that payload with
`hydrateFromDocument(...)`, which calls `Resource.hydrate(payload)` so the
visible resource signal and Effect `Cache` entry update in the same Runtime
Spine.

A failed route preload is a render outcome in Start: the request renders with
status 500 and every router on the request runtime starts in the `Failure`
state, so the outlet's failure view renders. The failure crosses to the client
as a `Route.PreloadFailureSnapshot` in the hydration payload, and the hydrating
router starts in the same `Failure` state without re-running the preload. With
an `error` schema, `Route.preloadFailureSnapshot(...)` encodes the
failure as JSON with that schema and `Route.preloadFailureCauseFromSnapshot(...)`
decodes it back into the typed value (a genuine `ProjectNotFound` with its
fields). Both the server render and the client render use the decoded value, so
their output agrees, and only fields the schema declares leave the server.
Without an `error` schema only the failure `_tag` crosses and the rebuilt cause
is `{ _tag }`. A failure that does not encode (or decode) with the schema
renders as a `RoutePreloadFailureCodecError` defect, without its data.

An unmatched URL is a render outcome too: the request renders the router's
`NotFound` state (the app's not-found view) with status 404, and the root
payload carries `notFound: true`. `hydrateFromDocument(...)` records it with
`Route.hydrateNotFound()`, and the hydrating router starts `NotFound` whatever
its href matches, without preloading. That is what lets one document serve
every missing URL: Start's static prerender renders an unmatched URL under
the reserved `/__sunfall-arc/` prefix through the same handler and writes it to
`404.html` at the output root (its `StartPrerenderPageContext.source` is
`"not-found"`, so `filter` can drop it, and an explicit page that writes
`404.html` replaces it). Asset URLs are absolute under Vite's `base`, so the
page works at any depth. On a static host, client navigation keeps the same
meaning: when the target page's HTML answers 404 (the host's `404.html`),
`makeStartStaticHistoryAdapter`'s `prepareHref` succeeds with
`{ _tag: "NotFound" }` and the router settles in `NotFound` without running the
route's preload. The router publishes a navigation's target match (`Pending`)
only after the host prepared its href, and keeps its current state until then:
before that the host may still answer that it has no page, and a static host
has not hydrated the target's route data, so UI rendered for the match (a
sidebar that switches on `router.match()`) would read data nothing can load.
Without host preparation, `Pending` is published as the navigation starts.

A server render can read Resources its route did not preload (a shell that
reads the signed-in user on an unmatched URL). Every fiber on the request
runtime, including those the render forks, runs with the request's services
(`RequestContext`, `ResponseContext`, the in-process server-function client),
so such a read loads like a preload; whatever the render loaded hydrates with
the page in one more streamed chunk after the preload's, so the client starts
from the values the server rendered.

A failure that reaches a Solid `<Errored>` boundary during a server render
follows the same rule. Solid serializes whatever such a boundary catches into
the page so the hydrating client can rethrow it into the same boundary, so the
Solid adapter never throws a raw failure on the server: every failure it throws
to `<Errored>` (Resource reads, setup failures, binding reads, the router's
default failure view) is first turned into a plain wire value, and that value
is all Solid serializes. A failed Resource read crosses as a
`ResourceFailureSnapshot`: encoded with the family's `error` schema when it has
one (only declared fields leave the server), or just the failure's `_tag`
without one. `catchTags` and `catchAll`, on the server and on the hydrating
client, decode the typed failure from that same wire value (a genuine
`ProjectNotFound` instance, or `ResourceUntypedFailure` with the `tag`), so both
renders agree; the hydrating boundary renders its fallback without running its
children, so the Resource is not loaded again. A failure that does not encode
(or decode) with the schema becomes a `ResourceFailureCodecError` defect. Setup
failures and defects carry nothing across: on the server they are opaque, and
no `catchTags` handler matches them there (put failing data behind a Resource
with an `error` schema to render it during SSR). Action failures never throw
to a boundary: `submit` returns them.

`Resource.hydrationPayload(refs)` builds the preload payload as an Effect, read
from the Resource Store the Runtime Spine provides.

Rows need no hydration channel of their own: a Resource with `rows` hydrates
as its value, and the browser rebuilds key positions and index buckets lazily
on first read. `App.launch(app)` runs `hydrateFromDocument(document)`, which
restores every Resource from one script into the browser runtime the UI uses,
before it hydrates the root. Action responses hydrate the same way.
Lower-level hosts run `yield* Resource.hydrate(payload)` on their runtime.

Streamed SSR chunks are emitted as JSON scripts with
`data-sunfall-arc-hydration-chunk`; `hydrateFromDocument(...)` applies the
root payload first and then every
streamed chunk. Streamed chunk hydration is
progressive by design: each parsed Start hydration payload validates before that
payload mutates Resource state, but a later chunk failure does not
roll back chunks that already applied. Consumed DOM chunks are marked with
`data-sunfall-arc-hydration-consumed` only after the full chunk scan succeeds,
making repeated scans skip the same script unless `markConsumed: false` is
passed.
Malformed root hydration payload scripts fail with
`StartHydrationPayloadParseError`; malformed streamed chunk scripts fail with
`StartHydrationChunkParseError`; malformed Resource snapshots fail with
`Resource.SnapshotCodecError`.

The DOM renderer still owns its own hydration bootstrap. Start's document emits
Solid's `generateHydrationScript()` in the head and the Sunfall Arc resource
payload after the root. Those scripts solve different problems: Solid maps the
existing DOM nodes back to computations, while Sunfall Arc restores typed resource
state and Effect `Cache` entries.

`createRequestHandler(app, { server })` is the native Effect request boundary.
Host facades can own the final runtime seam when a platform contract requires
one, so Fetch hosts that require `(request) => Promise<Response>` and ordinary
Node HTTP hosts that require a `createServer` callback do not repeat runtime
launch policy in every deployment file. These facades are compatibility
adapters, not alternate application APIs. The internal Start Host Runtime Runner
is the shared Module for that final Effect-to-host step: Fetch/Vite host
facades and Node/Vite callback facades delegate runtime selection,
`Effect.runPromise(...)`, `runFork(...)`, and response Scope lifetime policy to
it while adapters keep request/response translation local.
Start provides the `server` Layer while running SSR preload and render work,
so app services can be normal Effect `Layer`s; the types require it to provide
everything the app's root needs.
Every request gets a fresh Request Runtime, so SSR behaves like TanStack Start's
isomorphic request model without sharing cache state across users.

Deployment adapters have one import path per host shape:
`@sunfall/arc-start/fetch` for Fetch-style hosts and `@sunfall/arc-start/node`
for Node HTTP. Effect-capable hosts use `toFetchHandler(handler)` or
`createNodeHandler(handler)`. Edge-style hosts that require a Promise-shaped
export wrap `createRequestHandler(app)` with
`createFetchHandler(handler, { runtime })`, while Node HTTP servers use
`createNodeServerHandler(handler, { runtime })`. Host facades provide the
per-request Scope themselves
but require a typed runtime whenever the handler still needs app services. The
Node adapter callback facades delegate the lower Node/Web exchange mechanics to
the internal Start Node Web Exchange Module. That Module converts
`IncomingMessage` to a Web `Request`, makes forwarded-origin trust explicit with
`trustForwardedHeaders` (default `false`), writes Web `Response` headers/status back to
`ServerResponse`, streams response bodies with Node backpressure and Effect
interruption through an `AbortSignal`, preserves multiple `Set-Cookie` headers,
and keeps `HEAD` responses bodyless at the host boundary. Vite dev SSR consumes
the same exchange Module, so production Node and dev middleware share the same
request/response policy while keeping their own handler-selection concerns.

## Served Resources And Actions

Server data is declared once, in shared modules, and implemented on the
server. A Resource defined with `input` and `output` schemas and no `load` is
a served Resource; an Action defined with an `input` schema and no `run` is a
served Action. Their schemas are the wire contract, and their server bodies
live in `*.server.ts` modules:

```ts
// projects.ts (shared, browser-safe)
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: ProjectId,
}) {}

export const ProjectById = Resource.define({
  name: "Project.byId",
  input: ProjectId,
  output: Project,
  error: ProjectNotFound,
  provides: (project) => [ProjectTag({ id: project.id })],
});

export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: Project,
  error: ProjectNotFound,
  invalidates: (project) => [ProjectTag({ id: project.id })],
});
```

```ts
// projects.server.ts
export const projectById = Resource.implement(ProjectById, (id) =>
  ProjectStore.use((store) => store.get(id)),
);

export const renameProject = Action.implement(RenameProject, (input) =>
  ProjectStore.use((store) => store.rename(input)),
);
```

```ts
// server.tsx
export const handleRequest = createRequestHandler(app, {
  server: ProjectStoreLive,
  implementations: [projectById, renameProject],
});
```

An Action's `output` defaults to `Schema.Void` and its `error` to no typed
failure; a Resource's `error` is optional. Each implementation is checked
against its definition: it may succeed only with `output` and fail only with
`error`, and the services it needs become the server Layer's to provide, so
`createRequestHandler` does not compile until `server` provides them.
`Resource.implement` throws for a family that has its own `load`, and
`Action.implement` for an Action that has its own `run`.

A served Resource's load is a server function whose Rpc tag is the family
name: SSR calls the implementation in-process, and the browser calls it over
RPC. A failure the `error` schema does not declare (a lost connection, a wire
schema mismatch, a missing implementation) is a defect, so a served
Resource's error type is exactly its `error` schema. A served Action is
submitted through the `ActionTransport` (see
[Progressive Actions](#progressive-actions)); its typed failures arrive typed
in the browser because the `error` schema encodes them on the wire.

## Isomorphic Server Functions

A server call that is neither a Resource load nor an Action (a change-feed
poll, for example) is a server function. Server functions are
contract-first, and every contract is an `effect/rpc` `Rpc`. Shared modules
define wire schemas, tagged errors, and named `Server.contract` values, then
export browser-safe clients from those contracts:

```ts
export const ProjectChangesContract = Server.contract("Project.changes", {
  input: Schema.Struct({ projectKey: ProjectKey, cursor: Schema.Number }),
  output: ProjectChanges,
  error: ProjectFeedError,
});

export const projectChanges = Server.client(ProjectChangesContract);
```

`input` and `output` are required; `error` defaults to `Schema.Never` (no
typed failures). The contract's types come from the schemas, and
`ProjectChangesContract.rpc` is the `Rpc` (tag `"Project.changes"`) Start
serves. Shared code calls the client the same way on the server and in the
browser, for example from a Resource's `rows.changes` feed:

<!-- prettier-ignore -->
```ts
const batch = yield* projectChanges.effect({ projectKey, cursor });
```

The real handler lives in a `.server.ts` module and implements the shared
contract without repeating the schemas:

```ts
export const projectChangesServer = Server.implement(ProjectChangesContract, (input) =>
  ProjectStore.use((store) => store.changesSince(input)),
);
```

`Server.client(contract)` has no local handler and is safe to import from
shared or browser modules. `Server.implement(contract, handler)` is the server
function; it goes in `implementations` beside the served definitions. The
contract/client/implement pattern is the one way to define a server function,
so the browser graph never imports server handlers and handlers cannot drift
from their public schema.

The transport is `effect/rpc`, end to end, for served Resource loads and
server functions alike:

- **Server.** `createRequestHandler(app, { implementations })` serves
  `POST /__sunfall-arc/rpc`: it builds an `RpcGroup` from the Rpcs of the
  `Resource.implement` and `Server.implement` values and answers with
  `RpcServer.toHttpEffect` and `RpcSerialization.json`. Handlers run in the
  request runtime's fiber context, so `RequestContext`, `ResponseContext`
  (status, headers, cookies), and the server Layer's services are available,
  as in SSR.
- **Browser.** `App.launch` provides `Server.Client` as an `RpcClient` over
  the runtime's `HttpClient` (the client Layer's when it provides one, else
  `FetchHttpClient`), compiled out of static-client builds. `HttpClient`
  propagates the caller's span (`traceparent`), so the server's request span
  continues the client's trace. Configure headers, retries, or a custom fetch
  on that `HttpClient`.
- **SSR.** During request preload and render, Start provides a request-local
  `Server.localClient(...)`: calls run the registered implementation
  in-process (no HTTP), passing the input, output, and typed failures through
  the Rpc's JSON codecs, so SSR sees the values a browser would decode.

Typed failures cross the wire Schema-encoded and decode as the error schema's
values (a `Schema.TaggedError` arrives as an instance). Failures the schema
cannot encode, handler defects, payloads that fail the input schema, and
functions the server does not serve arrive as defects, as `effect/rpc`
reports them; a server-function call's transport failures are
`RpcClientError` in `Server.ClientError`.
Start action clients and progressive forms post to `POST /__sunfall-arc/action`.
Both paths are fixed: the request handler, the Vite dev middleware, and the
clients share them. The resource/action/router code above does not change.

Arc has no separate server-route API: arbitrary HTTP routes belong to
`effect/http` (`HttpRouter`) in the host, next to the Start handler.

The Vite plugin treats `*.server.ts` / `*.server.tsx` as server-only modules.
Client transforms fail if one enters the browser graph. Keep definitions,
schemas, contracts, and clients in shared modules, and import the
`.server.ts` modules only from the server entry, which hands their
implementations to `createRequestHandler`.

Tests mock at the contract, not the module. `Server.mockLayer(...)` takes
`Server.mock(...)` handlers or implementations, such as a served Resource's
test load:

<!-- prettier-ignore -->
```ts
const value =
  yield* Effect.provide(
  Resource.preload(ProjectById(makeProjectId("atlas"))),
  Server.mockLayer(
    Resource.implement(ProjectById, (id) => Effect.succeed({ id, name: "Mock Project" })),
  ),
  );
```

`Server.mock(...)` does not register a global handler and does not import
`.server.ts`. Every double still validates through the wire schemas (the same
JSON codecs the wire uses), so test doubles catch bad inputs and outputs
early. `Server.mockLayer(...)` is the one way to install them: provide it to a
single Effect, or merge it into the runtime Layer for apps and integration
tests that build a runtime with dependency injection.

## Signal And Stream Semantics

Signals are the read side of every Arc state owner. The public `Signal` API is
read-only: a State's `committed` model, `Resource.result(ref)`, an Action's
`state`, and `Signal.derive` values are all `Signal.Readable`. The render
model is latest-value reactive:

```ts
const doubled = Signal.derive(() => counter.committed.get().count * 2);
```

`get()` subscribes the current reactive computation and returns the current value
synchronously. Rendering consumes invalidations and then reads the latest value; it is
not required to replay every intermediate update.

Use `Signal.peek(signal)` or `Signal.untracked(() => ...)` for reads that should not
become render dependencies.

### Writes Are Framework Transactions

Writable signals are internal (`SignalWrites` and `WritableSignal` in
`@sunfall/arc-core/internal`): State, Resource, Action, the router, and
devtools write them, and test fixtures use them. Application state changes
only through State messages, Actions, and framework events. The framework
write model separates committed state from rendered state:

1. Every write is transactional and named. It joins the caller's open
   transaction or commits on its own under the caller's named transition, so
   a write is never half-applied and never anonymous. An unnamed framework
   write is an internal assertion (`SignalWriteOutsideTransition`).
2. Effect and synchronous code read committed state, including their own
   transaction's writes. Solid computations read rendered state, which Solid
   tracks natively and catches up atomically at its next flush.
3. A transaction that fails or is interrupted commits nothing.

Inside a transaction, reads (including `Signal.derive`) see the transaction's own
writes; other fibers, subscribers, and the UI see none of them until commit.
Nested transactions and batches join the outer one. A transaction covers its
whole Effect, including fibers it forks, so concurrent branches
(`Effect.all(..., { concurrency })`) commit atomically with it. A fiber still
running after the transaction ends sees it closed and commits its own writes,
under the transaction's name.

The temporal model is still available through Effect streams:

```ts
Signal.values(counter.committed); // current value, then updates
Signal.changes(counter.committed); // updates only
```

In Solid Components, `Component.stream(name, stream, initial)` reads a Stream's
latest value as a read-only accessor (committing each element as
`<Component>.<name>`); its stream fiber is interrupted when the instance is
disposed. It is a read of an external source, like a Resource, not client
state: nothing can write it.

Fallible streams should first be turned into typed data or represented as `Resource`
state, because a plain `Signal<A>` always has a current `A` and has no error channel.

Effect-first APIs:

- `Resource.preload(ref)` and `Resource.refresh(ref)` load and
  reload resources as Effects.
- `action.submit(input)` runs action workflows, optimistic patches,
  concurrency, and invalidation as an Effect.
- `serverFunction.effect(input)` calls through the provided `Server.Client`
  (the `RpcClient` in the browser, the in-process client during SSR, mocks in
  tests); `serverFunction.local(input)` runs the implementation directly.

Resource retry policy is an Effect `Schedule`, not a framework-specific retry
DSL:

```ts
Resource.define({
  name: "Project.byId",
  input: ProjectId,
  output: Project,
  error: ProjectUnavailable,
  policy: {
    retry: Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 })),
  },
});
```

Action policy is applied inside `submit`, so callers still get the
definition's concurrency semantics while keeping cancellation, timeout, retry,
and race strategy visible in Effect code.

Action policy is part of the definition:

```ts
const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: Project,
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
});
```

`latest` interrupts older event submissions, `exhaust` reuses the in-flight
submission, and `parallel` lets all submissions resolve while keeping the UI
state pointed at the latest input.

## Timeline And Replay

Arc owns application state in internal writable signals, and every committed
change set passes through one seam in `signal-transaction.ts`: the solo-write
path or the transaction/batch commit. `Timeline.record(...)` installs a
recorder on that seam for the life of a Scope, so one recording covers State
models and failures, Resource entries (including `rows.changes` batches),
Action state, and router state. Every change is a State message, an Action,
or a framework event, so every entry reads like a message (Foldkit-style
predictability: no state changes without a name):

<!-- prettier-ignore -->
```ts
const recording = yield* Timeline.record({ limit: 1000 });

yield* board.dispatch({ _tag: "Relabel", id: 1, label: "Done" });

Signal.peek(recording.entries).map((entry) => Timeline.describe(entry.cause));
// ['State "Board" Relabel', 'Resource "Project.get" success atlas', 'Action "Project.rename" submit']

yield* recording.travel(entry.sequence); // render the app as it was after `entry`
yield* recording.resume(); // render the live head again
```

Entries are `{ sequence, at, cause, changes: [{ signal, name, previous, next }] }`.
`at` comes from the recording fiber's `Clock`, so `TestClock` makes timestamps
deterministic.

- **Every commit has a cause; there are no anonymous writes.** A write joins
  the caller's transaction, whose cause names the commit, or commits alone
  under the fiber's named transition. A State commit is a `Timeline.StateCause`
  (`{ _tag: "State", state, event: "message" | "failure" | "clearFailures",
message }`, described as `State "Menu.open" Toggle`). Work started by
  `Component.callback("name", f)` and `Component.stream(name, ...)` elements
  run under a `Transition` cause named `<Component>.<name>`. A nested
  transaction names the commit only when the outer one has none. Framework
  primitives label their own commit points: Action
  submissions (`submit`, `success`, `failure`, `interrupt`, `reset`, and the
  outbox's `queue`, `restore`, `replay`, `dismiss`; optimistic patches carry
  the submission's event), State messages and failures, Resource entry
  loads, settles, hydration, resets, and change-feed batches, and router
  navigation. An explicit cause wins over the ambient transition,
  so an Action submitted from a callback still reads
  `Action "Project.rename" submit`.
- **Named by construction.** Application code cannot write a signal: its
  state changes are State messages and Actions. An unnamed framework write is
  an internal assertion (`SignalWriteOutsideTransition`), always on, costing
  a context lookup on the solo-write path only. `Timeline.Cause` is a closed tagged union,
  `Timeline.Entry.cause` is always present, and `Timeline.describe(cause)`
  renders it.
- **Names** come from the owner: a State's model signal is its `name`
  (failures are `<name>.failures`), and framework signals name themselves
  (`Board`,
  `Project.rename.state`, `Project.get(<key>)`, `Router.state`). A router
  outlet's rendered node is derived
  from recorded router state, so it is bookkeeping, not recorded: travel
  re-renders the travelled route.
- **Travel renders the past; it does not rewrite state.** Committed state stays
  at the live head, so Effects, Actions, States, and watchers keep computing
  from it and their commits keep being recorded: nothing is lost and nothing
  computes from a stale model. Only rendered reads (Solid computations, through
  each signal's projection) see the travelled view, and `Signal.derive` values
  rendered by Solid re-evaluate against it. A signal first written after the
  travelled commit renders the value it had then, so signals created later
  render their initial value, and a signal first written while travelling stays
  frozen at its travelled value until `resume()`. Travel itself writes nothing,
  so it records nothing.
- **State history is a filtered view.** There is one timeline concept: a
  State's history is
  `entries.filter((entry) => entry.changes.some((change) => change.signal === state.model))`.
  Command and subscription lifecycle are not state changes; they belong to
  Effect tracing spans, not to the state timeline.
- **Cost.** With no recording installed, each commit pays one `undefined`
  check and each read one more (`benchmarks/signal-commit.bench.ts` guards
  this). Rendered projections register in a set so travel can refresh them;
  that is per rendered signal, not per write. Retention is bounded (default
  1000 entries); closing the recording Scope uninstalls the recorder, resumes
  the live head, and drops retained entries. One recording is installed at a
  time; a second fails with `TimelineAlreadyRecording`.
- **Limits.** Rows are part of a Resource entry's value, so travel rewinds
  them with the entry; their lookups are derived per value and never
  recorded. Travel does not move the browser URL: a travelled router renders the old route while
  history stays at the head.

A devtools store (`Devtools.makeStore()`) consumes the same entries:
`store.trackTimeline(recording)`
records each entry as a JSON-safe `TimelineCommit` runtime event, linked to the
State, Action, or Resource fact its cause names.

## Progressive Action Results

Progressive forms and actions use typed result data rather than thrown control
flow:

```ts
const result = ActionResult.redirect("/projects/atlas", {
  status: 303,
  replace: true,
});

const validation = ActionResult.validation({
  fieldErrors: { name: [new ProjectNameTooShort({ minimum: 3 })] },
});
```

`ActionResult` can represent success, validation failure, redirect, and domain
failure. `ActionResult.fromValidation(form.validate())` turns a form validation failure
into a success-channel `ValidationFailure`, and `ActionResult.withInvalidation`
lets the result carry Resource invalidation targets into existing action
workflows while preserving any services required by those invalidated Resource
refs.
