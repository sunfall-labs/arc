# Effect Style Guide

Effect UI APIs should be Effect-first and browser-friendly second.

The broader product strategy is in
[Best Full-Stack Framework Plan](./best-framework-plan.md). This file is the
daily engineering bar for that strategy: code should look like idiomatic Effect
code, preserve typed services and failures, and keep Promise interop at the
edge.

## Rules

- Public async APIs expose Effect v4 values; Promise interop belongs only at explicit compatibility host/runtime boundaries.
- Framework callbacks should return `Effect` or a pure value, not `Promise`. Use `Effect.tryPromise` at the edge that talks to a Promise-shaped host API.
- `async` framework callbacks are a type error for resources, actions, route preloads, Start renderers, server implementations, DB collections, capabilities, and form validators.
- Domain failures use tagged errors so callers can recover with `Effect.catchTag`.
- Server request data is provided through Effect services, not globals.
- Signals are latest-value cells. Use `Signal.values` / `Signal.changes` when temporal semantics matter.
- Resource and action state may use signals internally, but side effects should be modeled as `Effect`.
- Route preload should return Effect values, usually `Resource.prefetchEffect(...)`, so stale navigations can be interrupted.
- Retry, cancellation, scheduling, and cleanup should delegate to Effect primitives such as `Schedule`, fiber interruption, and scopes.
- Resource lifetime work, including GC, should use `Effect.sleep` and fibers rather than host timers.
- Promise interop is allowed only at UI/runtime boundaries such as Suspense, Web Streams, executable CLIs, and compatibility host adapters.
- `defineApp({ server })` is the server-side dependency provider for SSR/request work. Prefer an Effect `Layer` there.
- Start request work uses a fresh Request Runtime with the app services, a request-local `ResourceStore`, and a request-local `Server.localClient(...)`; do not share resource cache state or remote browser RPC clients across SSR requests.
- Start streamed responses keep the Request Runtime open until the response body closes or is cancelled.
- Start action requests should run Action Definitions through the Request Runtime; do not create separate mutation handlers that bypass Capability services, schemas, retries, or invalidation.
- Run application work through `EffectUiRuntime`; use raw `Effect.runPromise` only in tests or in the runtime implementation itself.
- Treat `Resource.family(...)` as a Resource Definition. Runtime/request state belongs to `ResourceStore`, reached through the Runtime Spine.
- Use `Effect.catch`, not the Effect 3 name `catchAll`.
- Prefer explicit `Resource` / `Action` state and Effect recovery combinators over component-level `try` syntax for first-class APIs.
- Components own an Effect `Scope`; use `forkScoped`, `watch`, and `onDispose` instead of a generic `useEffect`.
- Isomorphic server functions should be split into shared contracts and real server handlers. Shared code defines `Server.contract` values and exports `Server.client(contract)`; `.server.ts` modules call `Server.implement(contract, handler)` and are never imported by the browser graph.
- Prefer `Schema.TaggedErrorClass` for server-function errors because it is a yieldable Effect error and a wire schema at the same time.
- Mock server contracts with `Server.mock`, `Server.mockClient`, or `Server.mockLayer`; do not import `.server.ts` just to test shared resources and actions.
- Prefer named `Capability` services for app features. Resources and actions should usually depend on `ProjectApi.use(...)`, while server functions, browser RPC, and test doubles are layers behind that capability.
- Model mutation dependencies with typed `Resource.tag` values. Actions should invalidate domain facts, not string cache keys.
- Use `Schema.brand` for domain ids and generated framework ids that cross API seams. A route param, server function input, resource key, action input, or manifest id should be a decoded `ProjectId`, `ServerFunctionId`, `ActionId`, or `FileRouteId`, not a plain `string`.
- Add type tests for API rules that should fail at compile time. A passing runtime test is not enough when the framework can reject the mistake earlier.
- Host adapters should expose Effect-native handlers. If a platform contract requires a Promise, the app entrypoint should call through the active `EffectUiRuntime`.

## Gold Standard

Framework code should optimize for the caller being able to see the Effect
shape:

- services are named `Context.Service` / `Capability` values, then provided with
  `Layer`;
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

```ts
const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = typeof UserId.Type;

const makeUserId = (id: string): UserId => Schema.decodeUnknownSync(UserId)(id);

const UserById = Resource.family({
  name: "User.byId",
  input: UserId,
  load: (id: UserId) => Effect.succeed({ id }),
});

const ref = UserById(makeUserId("1"));

yield * Resource.prefetchEffect(ref);
```

Under the hood, `Resource.family` uses Effect `Cache`: `prefetchEffect` maps to
cached `get`, `refreshEffect` maps to forced `refresh`, and `gcFor` is the cache
TTL. The cache is owned by the active `ResourceStore`, so separate runtimes,
tests, and SSR requests do not share resource values or tag indexes.
Visible resource entry GC uses immediately-started interruptible Effect fibers,
not raw timers.
Runtime diagnostics use `Resource.subscribeEventsEffect()` and Effect `PubSub`
instead of inspecting Resource Store maps directly.

When a family should batch sibling loads, back it with Effect `Request` and
`RequestResolver` through `Resource.requestFamily`. The Resource layer still owns
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

const UserById = Resource.requestFamily({
  name: "User.byId",
  input: UserId,
  request: (id: UserId) => GetUserRequest({ id }),
  resolver: userResolver,
});
```

Use this for route preloads and server-function-backed resources when the
transport or capability layer can answer a batch. Direct server-function RPC
batching is a larger transport concern; until that lands, keep server contracts
as the capability boundary and put the batched resolver behind the resource or
capability implementation.

Resources can also publish typed tags into the dependency graph:

```ts
const UsersTag = Resource.tag("Users");
const UserTag = Resource.tag<{ readonly id: UserId }>("User", {
  key: ({ id }) => id,
});

const UserById = Resource.family({
  name: "User.byId",
  input: UserId,
  load: (id: UserId) => getUser.effect({ id }),
  provides: (user) => [UserTag({ id: user.id })],
});
```

Actions invalidate those facts after a successful mutation:

```ts
const RenameUser = Action.define({
  name: "User.rename",
  run: (input: RenameUserInput) => renameUser.effect(input),
  invalidates: (user) => [UsersTag, UserTag({ id: user.id })],
});
```

When debugging, ask the runtime for the plan rather than guessing which cache
entries will move:

```ts
const plan = yield * Action.planInvalidationEffect(RenameUser, user, input);

for (const entry of plan.entries) {
  console.log(entry.ref.key, entry.causes);
}
```

Use the Effect form for normal debugging and tooling so synchronous
`invalidates` callback failures stay in the typed `EffectInputCallbackError`
channel. The synchronous `Action.planInvalidation(...)` helper is for
already-total callbacks and quick inspection.

SSR hydration must populate both layers:

```ts
yield *
  hydrateStartPayloadEffect(payload, {
    runtime,
    collections: [Projects, Tasks],
  });
```

Start hydration helpers call `Resource.hydrateEffect(payload)` for resource
entries and collection hydration for DB snapshots, so the resource signal used
by components and the Effect cache entry in the active `ResourceStore` update
together. Use `hydrateFromDocumentEffect(...)` for full browser payloads and
`hydrateStartPayloadEffect(...)` for already-parsed payloads; reserve
`Resource.hydrate(payload)` for synchronous host/UI-context facades that are
already inside the current runtime.

```tsx
const user = useResource(() => UserById(props.id));

return user.match({
  initial: () => <UserSkeleton />,
  pending: (previous) => (previous ? <UserView user={previous} refreshing /> : <UserSkeleton />),
  success: (value) => <UserView user={value} />,
  failure: (error, previous) =>
    previous ? <UserView user={previous} error={error} /> : <UserError error={error} />,
});
```

```ts
const UserById = Resource.family({
  name: "User.byId",
  input: UserId,
  load: (id: UserId) => getUser.effect({ id }),
  policy: {
    retry: Schedule.exponential("100 millis").pipe(Schedule.take(3)),
  },
});
```

```ts
const SaveUser = Action.define({
  name: "User.save",
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1),
  },
  optimistic: (input: UserInput, transaction) =>
    Effect.gen(function* () {
      yield* transaction.signal(selectedUserName, input.name);

      return Effect.sync(() => {
        // Optional extra rollback for patches outside the transaction helpers.
        toastQueue.remove(`saving-${input.id}`);
      });
    }),
  run: (input: UserInput) => saveUser(input),
});

const action = Action.use(SaveUser);

yield * action.submitEffect(input);
```

Expose progressive actions to Start when the same mutation should work with
JavaScript disabled:

```ts
const form = startActionForm(SubmitProjectName, {
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

JSON action clients should use the Effect-native transport helper when they want
server-posted mutations to update client resources without a second fetch:

```ts
const result = yield * submitStartActionEffect(RenameUser, input);

if (result._tag === "Success") {
  result.hydration?.resources.map((resource) => resource.key);
}
```

Components can keep Action-like state while still using the Start transport:

```ts
const rename = StartAction.use(RenameUser, { runtime });

yield * rename.submitEffect(input);
rename.invalidation.get()?.entries.map((entry) => entry.ref.key);
rename.hydration.get()?.resources.map((resource) => resource.key);
```

Start action responses include a serializable invalidation plan and a hydration
payload for refreshed resource refs when the action invalidates direct refs.
Plain form posts still receive normal HTTP redirects for no-JS flows.

Forms stay schema-backed and UI-runtime agnostic. `setField` is typed from the
schema, validation is an `Effect`, and domain validation errors can be tagged
values stored on fields. Initial/reset/exposed values share the same snapshot
policy as dirty tracking, so structurally equal object/array fields are not
marked dirty just because callers passed a new object.

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
  schema: RenameProjectInput,
  initial: { id: makeProjectId("atlas"), name: "" },
  validate: (values, validation) =>
    values.name.length < 3
      ? Effect.fail(validation.field("name", new ProjectNameTooShort({ minimum: 3 })))
      : Effect.void,
});

form.setField("name", "Atlas Revenue");

const input = yield * form.validateEffect();
```

Start progressive forms reuse the same schema-backed action request codec as JSON
action clients. If a default form input cannot be encoded, the synchronous form
facade raises `StartActionFormEncodeError`; Effect-first code can use the
encoding Effect directly.

```ts
interface ProjectApi {
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectError>;
  readonly rename: (input: RenameProjectInput) => Effect.Effect<Project, ProjectError>;
}

const ProjectApi = Capability.define<ProjectApi>("ProjectApi");

const ProjectApiLive = ProjectApi.layer({
  get: (id) => getProject.effect({ id }),
  rename: renameProject.effect,
});

const ProjectApiTest = ProjectApi.mock({
  get: (id) => Effect.succeed({ id, name: "Mock Project" }),
  rename: (input) => Effect.succeed({ id: input.id, name: input.name }),
});

const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectId,
  load: (id: ProjectId) => ProjectApi.use((api) => api.get(id)),
});
```

```ts
export const GetProject = Server.contract("Project.get", {
  input: Schema.Struct({ id: ProjectId }),
  output: Project,
  error: ProjectNotFound,
});

export const getProject = Server.client(GetProject);
```

```ts
// project.server.ts
export const getProject = Server.implement(GetProject, ({ id }) =>
  Projects.use((projects) => projects.get(id)),
);
```

```ts
const testProject =
  yield *
  Server.provideMocks(
    getProject.effect({ id: makeProjectId("atlas") }),
    Server.mock(GetProject, ({ id }) => Effect.succeed({ id, name: "Test Project" })),
  );

const TestServerLive = Server.mockLayer(
  Server.mock(GetProject, ({ id }) => Effect.succeed({ id, name: "Layered Test Project" })),
);
```

```ts
// Server.fn remains available as a low-level primitive, but contracts avoid
// repeating names and schemas between shared clients and server handlers.
export const getProjectLegacy = Server.fn("Project.get", {
  input: GetProject.input,
  output: GetProject.output,
  error: GetProject.error,
  handler: ({ id }) => Projects.use((projects) => projects.get(id)),
});

yield * getProject.effect({ id: makeProjectId("atlas") });
yield * getProjectLegacy.invoke({ id: makeProjectId("atlas") });
```

```ts
const UserRoute = route("/users/:id", {
  params: Schema.Struct({ id: UserId }),
  preload: ({ params }) => Resource.prefetchEffect(UserById(params.id)),
});

Route.href(UserRoute, { params: { id: makeUserId("1") } });
```

```ts
const result = yield * Resource.collectEffect(Route.preloadEffect(match));
const payload = yield * Resource.hydrationPayloadEffect(result.refs);
```

Prefer route plans when callers need the full navigation data graph:

```ts
const plan = yield * Route.planNavigationEffect(routes, "/users/1");

if (plan._tag === "Matched") {
  plan.refs;
  plan.resources;
}
```

```ts
const UsersLive = Layer.succeed(Users)({
  get: (id: string) => Effect.succeed({ id }),
});

const app = defineApp({
  routes,
  client: BrowserLive,
  server: UsersLive,
});

yield * app.runtime.provide(Users.use((users) => users.get("1")));

const handler = createRequestHandler(app); // native Effect handler
const fetchEffect = toFetchHandler(handler); // fetch-shaped Effect adapter
```

```ts
const count = Signal.make(0);

yield * Signal.values(count).pipe(Stream.runForEach((value) => Effect.log(`count: ${value}`)));
```

```ts
const presence =
  yield *
  Signal.fromStreamEffect(presenceStream, {
    status: "offline",
  });

read(presence);
```

```ts
const title = Signal.make("Effect UI");

watch(
  () => read(title),
  (value) =>
    Effect.sync(() => {
      document.title = value;
    }),
);

forkScoped(Effect.never);

onDispose(() => Effect.log("component disposed"));
```
