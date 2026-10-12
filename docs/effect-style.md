# Effect Style Guide

Sunfall Arc APIs should be Effect-first and browser-friendly second.

This file is the daily engineering bar: code should look like idiomatic Effect
code, preserve typed services and failures, and keep Promise interop at the
edge.

## Rules

- Public async APIs expose Effect v4 values; Promise interop belongs only at explicit compatibility host/runtime boundaries.
- Framework callbacks should return `Effect` or a pure value, not `Promise`. Use `Effect.tryPromise` at the edge that talks to a Promise-shaped host API.
- `async` framework callbacks are a type error for states, resources, actions, route preloads, Start renderers, server implementations, query callbacks, and form validators; an Effect service's `use` callback must return an Effect.
- State is the one writable client state. Its `on` handlers are pure and return plain models or `State.next(...)`; Effect work goes in commands. `State.emit(...)` is the one command constructor: a message, an Effect that produces one, or an Effect that completes with `void` for work without a message. Public Signals are read-only.
- Domain failures use tagged errors so callers can recover with `Effect.catchTag`.
- Server request data is provided through Effect services, not globals.
- Signals are latest-value cells. Use `Signal.values` / `Signal.changes` when temporal semantics matter.
- Resource and action state may use signals internally, but side effects should be modeled as `Effect`.
- Route preload should return Effect values, usually `Resource.preload(...)`, so stale navigations can be interrupted.
- Retry, cancellation, scheduling, and cleanup should delegate to Effect primitives such as `Schedule`, fiber interruption, and scopes.
- Resource lifetime work, including GC, should use `Effect.sleep` and fibers rather than host timers.
- Promise interop is allowed only at UI/runtime boundaries such as Suspense, Web Streams, executable CLIs, and compatibility host adapters.
- `createRequestHandler(app, { server, implementations })` is the server-side dependency provider for SSR/request work, and the app's `client` Layer is the browser's (`App.define({ client })`). Prefer Effect `Layer`s there; the server Layer must provide everything the root and the implementations need, the client Layer everything the root needs in the browser.
- Start request work uses a fresh Request Runtime with the app services, a request-local `ResourceStore`, and a request-local `Server.localClient(...)`; do not share resource cache state or remote browser RPC clients across SSR requests.
- Start streamed responses keep the Request Runtime open until the response body closes or is cancelled.
- Start action requests run served Actions' `Action.implement` bodies through the Request Runtime; do not create separate mutation handlers that bypass Effect services, schemas, retries, or invalidation.
- Run application work through `SunfallArcRuntime`; use raw `Effect.runPromise` only in tests or in the runtime implementation itself.
- Treat `Resource.define(...)` as a Resource Definition. Runtime/request state belongs to `ResourceStore`, reached through the Runtime Spine.
- Use `Effect.catch`, not the Effect 3 name `catchAll`.
- Prefer explicit `Resource` / `Action` state and Effect recovery combinators over component-level `try` syntax for first-class APIs.
- Solid UI is typed `Component`s: runtime state comes from setup-time bindings (`Component.resource`, `action`, `state`, `stream`, `callback`, `router`, and `LiveQuery.bind` from `@sunfall/arc-solid/live-query`) whose services join the Component's `R`, and each instance owns an Effect `Scope`. Use Solid `createEffect` only for imperative DOM sinks; there is no generic `useEffect`.
- Server reads and writes are served definitions. Shared code declares a Resource without `load` (`input` and `output` schemas) or an Action without `run` (an `input` schema); `.server.ts` modules implement them with `Resource.implement(definition, load)` and `Action.implement(definition, run)` and are never imported by the browser graph.
- A server call that is neither a Resource load nor an Action is a server function: shared code defines a `Server.contract` (an `effect/rpc` `Rpc`, with required `input` and `output` schemas) and exports `Server.client(contract)`; a `.server.ts` module calls `Server.implement(contract, handler)`.
- Prefer `Schema.TaggedError` for the `error` schemas of served definitions and server functions because it is a yieldable Effect error and a wire schema at the same time.
- Mock the wire with `Server.mockLayer(...)`, given `Server.mock(...)` handlers or test implementations (`Resource.implement(definition, testLoad)`); do not import `.server.ts` just to test shared resources and actions.
- Prefer named Effect services (`Context.Service`) for app features. Server implementations should usually depend on `ProjectStore.use(...)`, which the server Layer provides; test doubles are Layers behind the same service.
- Configure browser transport concerns (auth headers, retries, a custom fetch) on the `HttpClient` the client Layer provides; Start's `RpcClient` and action transport both post through it.
- Model mutation dependencies with typed `Resource.tag` values. Actions should invalidate domain facts, not string cache keys.
- Use `Schema.brand` for domain ids and generated framework ids that cross API seams. A route param, server function input, resource key, action input, or manifest id should be a decoded `ProjectId`, `ServerFunctionId`, `ActionId`, or `FileRouteId`, not a plain `string`.
- Add type tests for API rules that should fail at compile time. A passing runtime test is not enough when the framework can reject the mistake earlier.
- Host adapters should expose Effect-native handlers. If a platform contract requires a Promise, the app entrypoint should call through the active `SunfallArcRuntime`.

## Gold Standard

Framework code should optimize for the caller being able to see the Effect
shape:

- services are named `Context.Service` values, then provided with `Layer`;
- recoverable failures are tagged errors with schemas when they cross the wire;
- retries are `Schedule` values in policy objects, not custom retry flags;
- cancellation is fiber interruption, not boolean flags;
- cleanup is `Scope` finalization, not detached host callbacks;
- streams are `Stream` values until a host adapter turns them into platform
  bytes or events;
- cached async reads use runtime-local Effect cache state and visible resource
  state;
- invalidation is semantic, inspectable, and emitted as runtime facts;
- diagnostics prefer data values over string parsing;
- tests run the same Effects through test runtimes and test layers.

If an implementation starts needing hidden globals, untyped thrown control flow,
manual promise choreography, or out-of-band module mutation, it is probably
fighting the framework's thesis.

## Current API Pattern

<!-- prettier-ignore -->
```ts
const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = typeof UserId.Type;

const makeUserId = (id: string): UserId => Schema.decodeUnknownSync(UserId)(id);

const UserById = Resource.define({
  name: "User.byId",
  input: UserId,
  load: (id: UserId) => Effect.succeed({ id }),
});

const ref = UserById(makeUserId("1"));

yield* Resource.preload(ref);
```

Under the hood, `Resource.define` uses Effect `Cache`: `preload` maps to
cached `get`, `refresh` maps to forced `refresh`, and `gcFor` is the cache
TTL. The cache is owned by the active `ResourceStore`, so separate runtimes,
tests, and SSR requests do not share resource values or tag indexes.
Visible resource entry GC uses immediately-started interruptible Effect fibers,
not raw timers.
Runtime diagnostics use `Resource.subscribeEvents()` and Effect `PubSub`
instead of inspecting Resource Store maps directly.

When a family should batch sibling loads, back it with Effect `Request` and
`RequestResolver` through `Resource.define`. The Resource layer still owns
visible state, TTL, hydration, and invalidation; Effect owns request collection,
batch grouping, resolver delay, resolver cache/dedupe, and completion.

```ts
interface GetUserRequest extends Request.Request<User> {
  readonly _tag: "GetUserRequest";
  readonly id: UserId;
}

const GetUserRequest = Request.tagged<GetUserRequest>("GetUserRequest");

const userResolver = RequestResolver.make<GetUserRequest>((entries) =>
  Effect.gen(function* () {
    const users = yield* getUsersById(entries.map((entry) => entry.request.id));

    for (const entry of entries) {
      yield* Request.succeed(entry, users.get(entry.request.id));
    }
  }),
);

const UserById = Resource.define({
  name: "User.byId",
  input: UserId,
  request: (id: UserId) => GetUserRequest({ id }),
  resolver: userResolver,
});
```

Use this for route preloads and Resources whose service Layer can answer a
batch. Start's RPC transport sends one `effect/rpc` request per HTTP POST, so
for a served Resource put the batched resolver behind its server
implementation's service.

Resources can also publish typed tags into the dependency graph:

```ts
const UsersTag = Resource.tag("Users");
const UserTag = Resource.tag<{ readonly id: UserId }>("User", {
  key: ({ id }) => id,
});

const UserById = Resource.define({
  name: "User.byId",
  input: UserId,
  output: User,
  provides: (user) => [UserTag({ id: user.id })],
});
```

Actions invalidate those facts after a successful mutation:

```ts
const RenameUser = Action.define({
  name: "User.rename",
  input: RenameUserInput,
  output: User,
  invalidates: (user) => [UsersTag, UserTag({ id: user.id })],
});
```

When debugging, ask the runtime for the plan rather than guessing which cache
entries will move:

<!-- prettier-ignore -->
```ts
const plan = yield* Action.planInvalidation(RenameUser, user, input);

for (const entry of plan.entries) {
  console.log(entry.ref.key, entry.causes);
}
```

`Action.planInvalidation(...)` keeps synchronous `invalidates` callback
failures in the typed `EffectInputCallbackError` channel.

SSR hydration must populate both layers. `App.launch(app)` runs
`hydrateFromDocument(...)` for the browser payload, and it calls
`Resource.hydrate(payload)` for resource entries (rows included: they are part
of the Resource value), so the resource signal used by components and the
Effect cache entry in the active `ResourceStore` update together. Outside Start,
apply an already-parsed payload with `Resource.hydrate(payload)` directly.

```tsx
const UserCard = Component.define("UserCard", function* (props: { readonly id: UserId }) {
  const user = yield* Component.resource(UserById);
  // The reader suspends until the first value, then keeps the view mounted
  // while refreshes update it in place.
  return () => (
    <Loading fallback={<UserSkeleton />}>
      <UserView user={user(props.id)} refreshing={user.waiting(props.id)} />
    </Loading>
  );
}).pipe(Component.catchAll((error) => <UserError error={error} />));
```

Async state is always Effect's `AsyncResult` (`effect/reactivity`): Resources,
Actions, and Live Queries settle every load or submission from its
`Exit`, stamped with the Effect `Clock`. Typed errors and defects become a
`Failure` carrying the full `Cause`; interruption is cancellation and returns to
the prior settled result. Do not mirror `AsyncResult` into ad hoc flags; read
`AsyncResult.value`, `AsyncResult.error`, and `result.waiting` instead.

```ts
const UserById = Resource.define({
  name: "User.byId",
  input: UserId,
  output: User,
  error: UserUnavailable,
  policy: {
    retry: Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 })),
  },
});
```

<!-- prettier-ignore -->
```ts
const SaveUser = Action.define({
  name: "User.save",
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
  optimistic: (input: UserInput, transaction) =>
    Effect.gen(function* () {
      yield* transaction.set(selectedUserName, input.name);

      return Effect.sync(() => {
        // Optional extra rollback for patches outside the transaction helpers.
        toastQueue.remove(`saving-${input.id}`);
      });
    }),
  run: (input: UserInput) => saveUser(input),
});

// UI binds it in a Component setup. This Action has a `run`, so it runs where
// it is submitted; a served Action (no `run`) submits through the runtime's
// ActionTransport with the same handle.
const save = yield* Component.action(SaveUser);

yield* save.submit(input);
```

Expose progressive actions to Start when the same mutation should work with
JavaScript disabled:

```ts
const form = StartAction.form(SubmitProjectName, {
  input: {
    id: project.id,
    redirectTo: Route.href(ProjectRoute, {
      params: { id: project.id },
      search: { tab: "activity" },
    }),
  },
});
```

```tsx
<form method={form.method} action={form.action}>
  <For each={form.hiddenFields}>
    {(field) => <input type="hidden" name={field.name} value={field.value} />}
  </For>
  <input name="name" value={project.name} />
</form>
```

The server receives a Start Action Request, decodes it with the action input
schema, and maps `ActionResult.redirect` / `ActionResult.validation` to HTTP
without throwing untyped control flow.

With JavaScript, the same Action submits through its Component binding. A
served Action (defined without `run`) runs on the server: `App.launch`
provides Core's `ActionTransport`, which submits every served Action over the
network, and their responses update client Resources without a second fetch:

<!-- prettier-ignore -->
```ts
export const app = App.define({ root: Root, routes });
Effect.runFork(App.launch(app));

// In a Component setup: the same handle, local or remote.
const rename = yield* Component.action(RenameUser);
yield* rename.submit(input);
```

Start action responses include a serializable invalidation plan and a hydration
payload for refreshed resource refs when the action invalidates direct refs.
Plain form posts still receive normal HTTP redirects for no-JS flows.

Forms stay schema-backed and UI-runtime agnostic. `setField` is typed from the
schema, validation is an `Effect`, and domain validation errors can be tagged
values stored on fields. Initial/reset/exposed values share the same snapshot
policy as dirty tracking, so structurally equal object/array fields are not
marked dirty just because callers passed a new object.

<!-- prettier-ignore -->
```ts
const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
type ProjectId = typeof ProjectId.Type;

const makeProjectId = (id: string): ProjectId => Schema.decodeUnknownSync(ProjectId)(id);

class ProjectNameTooShort extends Data.TaggedError("ProjectNameTooShort")<{
  readonly minimum: number;
}> {}

const RenameProjectInput = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
});

const form = Form.make<typeof RenameProjectInput, ProjectNameTooShort>({
  name: "renameForm",
  schema: RenameProjectInput,
  initial: { id: makeProjectId("atlas"), name: "" },
  validate: (values, validation) =>
    values.name.length < 3
      ? Effect.fail(validation.field("name", new ProjectNameTooShort({ minimum: 3 })))
      : Effect.void,
});

form.setField("name", "Atlas Revenue");

const input = yield* form.validate();
```

Start progressive forms reuse the same schema-backed action request codec as JSON
action clients. If a default form input cannot be encoded, the synchronous form
facade raises `StartActionFormEncodeError`; Effect-first code can use the
encoding Effect directly.

```ts
// projects.ts (shared): the served Resource's schemas are its wire contract.
const ProjectById = Resource.define({
  name: "Project.byId",
  input: ProjectId,
  output: Project,
  error: ProjectNotFound,
});
```

```ts
// projects.server.ts
interface ProjectStore {
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectNotFound>;
}

const ProjectStore = Context.Service<ProjectStore>("ProjectStore");

export const projectById = Resource.implement(ProjectById, (id) =>
  ProjectStore.use((store) => store.get(id)),
);
```

A server call that is neither a load nor an Action is a server function:

```ts
export const ProjectChangesContract = Server.contract("Project.changes", {
  input: Schema.Struct({ id: ProjectId, cursor: Schema.Number }),
  output: ProjectChanges,
});

export const projectChanges = Server.client(ProjectChangesContract);
```

```ts
// project-changes.server.ts
export const projectChangesServer = Server.implement(ProjectChangesContract, (input) =>
  ProjectStore.use((store) => store.changesSince(input)),
);
```

<!-- prettier-ignore -->
```ts
const testProject =
  yield* Effect.provide(
  Resource.preload(ProjectById(makeProjectId("atlas"))),
  Server.mockLayer(
    Resource.implement(ProjectById, (id) => Effect.succeed({ id, name: "Test Project" })),
  ),
  );

const TestServerLive = Server.mockLayer(
  Server.mock(ProjectChangesContract, ({ cursor }) =>
    Effect.succeed({ cursor, upserts: [], deletes: [] }),
  ),
);
```

<!-- prettier-ignore -->
```ts
yield* projectChanges.effect({ id: makeProjectId("atlas"), cursor: 0 });
```

```ts
const UserRoute = Route.define("/users/:id", {
  params: Schema.Struct({ id: UserId }),
  preload: ({ params }) => Resource.preload(UserById(params.id)),
});

Route.href(UserRoute, { params: { id: makeUserId("1") } });
```

<!-- prettier-ignore -->
```ts
const result = yield* Resource.collect(Route.preload(match));
const payload = yield* Resource.hydrationPayload(result.refs);
```

Prefer route plans when callers need the full navigation data graph:

<!-- prettier-ignore -->
```ts
const plan = yield* Route.planNavigation(routes, "/users/1");

if (plan._tag === "Matched") {
  plan.refs;
  plan.resources;
}
```

```ts
const UsersLive = Layer.succeed(Users)({
  get: (id: string) => Effect.succeed({ id }),
});

const app = App.define({ root: Root, routes, client: BrowserLive });

const handler = createRequestHandler(app, { server: UsersLive, implementations: [userById] }); // native Effect handler
const fetchHandler = toFetchHandler(handler); // fetch-shaped Effect adapter
```

<!-- prettier-ignore -->
```ts
const counter = State.start(Counter, { runtime });

yield* Signal.values(counter.model).pipe(
  Stream.runForEach((value) => Effect.log(`count: ${value}`)),
);
```

```tsx
const TitleText = State.define({
  name: "Title.text",
  initial: "Sunfall Arc",
  on: { Rename: (_title, message: { readonly title: string }) => message.title },
});

const Title = Component.define("Title", function* () {
  const title = yield* Component.state(TitleText);
  // Each call forks in the instance Scope (interrupted when it unmounts) as
  // the named transition `Title.keepAlive`.
  const keepAlive = yield* Component.callback("keepAlive", () => Effect.never);

  createEffect(
    () => title.model(),
    (value) => {
      document.title = value;
    },
  );

  return () => <button onClick={keepAlive}>{title.model()}</button>;
});
```
