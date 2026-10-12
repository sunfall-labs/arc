# Sunfall Arc Compared With Top-Tier Frameworks

Sunfall Arc is trying to do something friendly but strict: keep the productive
feel of modern TypeScript app frameworks, while making the important facts
typed, Effect-native, inspectable, and hard to accidentally drift.

It is not trying to replace every good idea in React, Solid, Next, Remix,
TanStack Start, TanStack Query, TanStack DB, Relay, Jotai, or Foldkit. It
borrows the jobs people hire those tools for, then asks one extra question:

> Can the compiler, runtime, server, cache, mutation layer, diagnostics, tests,
> devtools, and agents all agree on the same application graph?

That is the core difference.

## The Short Version

| What teams reach for    | What it does well                      | Sunfall Arc's bet                                                                                                     |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| React / Solid           | Component model and reactive UI        | Keep fine-grained UI ergonomics, but attach async work to Effect scopes and runtime ownership.                        |
| Foldkit                 | Model/message/update program loop      | Match the loop with `State.define`, `State.step`, and `State.emit`, then run commands through the Arc runtime graph.  |
| Next / Remix            | Full-stack routes, forms, server work  | Keep progressive enhancement, but make server contracts, schemas, request runtimes, and manifests explicit.           |
| TanStack Start / Router | Typed routes and full-stack wiring     | Add Schema-branded params, request-local Effect runtimes, declared preload resources, and stricter build gates.       |
| TanStack Query          | Async reads, retries, invalidation     | Replace cache keys with typed resources, semantic tags, Effect `Schedule`, hydration, and public lifecycle events.    |
| TanStack DB             | Normalized local data and live queries | Keep keyed rows and live queries, but put the rows on Resources so caching, persistence, sync, and SSR stay one copy. |
| Relay                   | Data graph discipline                  | Aim for graph-level discipline without requiring a GraphQL-only architecture.                                         |
| Jotai / state libraries | Small local reactive state             | Keep local signals, but connect streams, scopes, resources, actions, and tests through one runtime spine.             |

## Compared With TanStack Query

TanStack Query is excellent at async reads and mutations. A common pattern is
to coordinate cache keys by convention:

```ts
const project = useQuery({
  queryKey: ["project", id],
  queryFn: () => fetchProject(id),
});

const rename = useMutation({
  mutationFn: renameProject,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["project", id] });
  },
});
```

Sunfall Arc wants the same workflow to be a domain graph instead of a string-key
agreement:

```ts
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

export const ProjectById = Resource.define({
  name: "Project.byId",
  input: ProjectId,
  output: ProjectSchema,
  error: ProjectNotFound,
  provides: (project) => [ProjectTag({ id: project.id })],
});

export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: ProjectSchema,
  error: ProjectNotFound,
  invalidates: (project) => [ProjectTag({ id: project.id })],
});

// projects.server.ts: the server bodies, checked against the schemas above.
export const projectById = Resource.implement(ProjectById, (id) =>
  ProjectStore.use((store) => store.get(id)),
);
export const renameProject = Action.implement(RenameProject, (input) =>
  ProjectStore.use((store) => store.rename(input)),
);
```

The difference is not just syntax. The resource owns schemas, retry policy,
semantic tags, hydration state, status, and public lifecycle events, and its
schemas are the wire contract its server load answers. The action can expose
an invalidation plan before refresh happens, so tests and devtools can explain
what changed and why.

## Compared With Next And Remix

Next and Remix made full-stack web apps feel practical again. Next's App Router
now has a mature Server Action and Form story, and Remix's route action model is
still one of the clearest progressive-enhancement baselines. That is the bar Arc
has to meet. A Remix-style action captures the shape:

```ts
export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const name = String(form.get("name"));

  if (name.length < 3) {
    return json({ fieldErrors: { name: "Too short" } }, { status: 422 });
  }

  await renameProject(name);
  return redirect("/projects");
}
```

Sunfall Arc keeps the boring, useful progressive-enhancement story, but routes
through one typed action definition:

```ts
export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: Schema.Union([ActionResult.Redirect, ActionResult.ValidationFailure]),
  invalidates: (_result, input) => projectResourceInvalidations(input.id),
});

// project.server.ts
export const submitProjectName = Action.implement(SubmitProjectName, (input) =>
  ProjectStore.use((store) => store.submitName(input)),
);

export const projectNameActionTarget = (input: {
  readonly id: ProjectId;
  readonly redirectTo?: ProjectReturnTo;
}) => StartAction.form(SubmitProjectName, { input });
```

With JavaScript, a component submits it through the Start action transport.
Without JavaScript, the form posts to its own page and the same Action handles
it: a redirect answers 303, a success redirects back to the page, and a
validation failure renders the page again (422) with the field errors in the
Action handle's `result()` and the posted fields in its `formValues()`, as a
Remix route re-renders with its action data. Validation, redirects, success,
domain failures, invalidation, services, retries, and schemas stay in one
path.

The competitive claim is narrow: Sunfall Arc should not win by merely having
server actions or form posts. It wins only if the action contract, runtime
requirements, typed result, invalidation plan, response facts, and no-JS path
are one inspectable definition instead of adjacent conventions.

## Compared With TanStack Start And Typed Routers

Typed routers help catch bad links. Sunfall Arc leans into that, but keeps schemas
and generated route facts close to the definitions:

```ts
export const route = Route.define("/projects/:id", {
  params: Schema.Struct({ id: ProjectId }),
  search: Schema.Struct({
    tab: Schema.optional(Schema.Literals(["overview", "activity"])),
  }),
  preloadResources: [ProjectById, ProjectSummaries],
  preload: ({ params }) => Resource.preload([ProjectById(params.id), ProjectSummaries("all")]),
});
```

The generated route file exposes the `routeById` map of route definitions
(addressed with `Route.href(...)` like any definition), params-by-id,
search-by-id, and href options, and `preloadResources` declares which
Resource families the route's preload touches (`Route.describePreloadResources`
reports it; Vite dev warns when a preload declares none).

That makes "what does this route touch?" a declared fact instead of an import
hunt.

TanStack Start deserves particular respect here. `createServerFn` gives typed
server functions with validators, serializable boundaries, FormData handling,
redirects, request context helpers, and generated function ids. Sunfall Arc
should not claim "typed RPC" as the differentiator. The differentiator is the
combination of Schema-branded route facts, request-local Effect services,
declared preload ownership, and one Effect runtime from preload to response.

## Compared With TanStack DB

TanStack DB points at an important future: normalized local data with live
queries, sync adapters, and optimistic local writes. Sunfall Arc keeps rows on
the Resource that loads them, so there is no second store to keep in sync:

```ts
export const ProjectSummaries = Resource.define({
  name: "Projects.summaries",
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectSummary),
  rows: {
    key: (project) => project.id,
    indexes: {
      status: (project) => project.status,
      owner: (project) => project.owner,
    },
  },
});
```

The reader adds `get` and `index` lookups, Actions patch rows by key and roll
back on failure, `rows.changes` applies a remote feed, `policy.persist` stores
the value, and `Query.live` joins the rows of several Resources. The rows hydrate
and cache as the Resource does, and because the store is runtime/request-local,
tests and SSR requests do not accidentally share rows.

## Compared With Relay

Relay is strong because it treats data dependencies as a graph with a compiler.
Sunfall Arc agrees with the shape of that lesson, but it does not require the app
to become GraphQL-only.

The graph includes more than fetched fields:

- routes and preload ownership;
- resources and semantic tags;
- keyed rows and indexes;
- actions and invalidation behavior;
- server functions and module boundaries;
- schemas at every wire boundary;
- hydration and runtime facts.

Relay asks GraphQL to be the center. Sunfall Arc asks the TypeScript and Effect
definitions to be the center.

## Compared With Jotai And Small State Libraries

Small state tools are pleasant because they make local state feel lightweight.
Sunfall Arc keeps that part simple:

```ts
const Search = State.define({
  name: "Search.query",
  initial: "",
  on: { Search: (_query, message: { readonly query: string }) => message.query },
});
const search = yield * Component.state(Search); // search.send.Search({ query })
const normalized = Signal.derive(() => search.committed.get().trim().toLowerCase());
```

The difference appears when state meets async work. A State can grow messages
and commands, a signal can stream values,
a component can own a scope, a resource can publish lifecycle facts, and an
action can invalidate semantic tags. Local state does not become a separate
mental model from server state and mutation state.

## Compared With Foldkit

Foldkit's strongest product idea is the frontend program loop: one model, typed
messages, an update function, subscriptions, and a view that can stay boring.
Sunfall Arc meets that surface directly with `State.define({ name, initial, on })`:
one pure handler per message `_tag`, with `State.emit(...)` for immediate or
Effect-produced follow-up messages. State is also Arc's one writable client
state, so the loop is not a second state model next to atoms or signals.

The bet is not to out-Foldkit Foldkit's renderer. It is to make that same loop
the front door to Arc's Effect runtime, resources, actions, SSR, tests, and
devtools:

```ts
const ProjectState = State.define<ProjectModel, ProjectMessage>()({
  name: "Project",
  initial: { selected: undefined, loading: false },
  on: {
    Load: (model, message) =>
      State.next(
        { ...model, loading: true },
        State.emit(
          ProjectApi.use((api) =>
            Effect.map(api.get(message.id), (project) => ({ _tag: "Loaded", project })),
          ),
        ),
      ),
    Loaded: (_model, message) => ({ selected: message.project, loading: false }),
  },
  subscriptions: (model) => (model.selected ? ProjectEvents.changes(model.selected.id) : undefined),
});
```

The Solid adapter is intentionally small:

```tsx
const OpenProject = Component.define("OpenProject", function* (props: { readonly id: ProjectId }) {
  const project = yield* Component.state(ProjectState); // R += the State's services
  // `send` is DOM-ready; failures land in `project.failures()`.
  return () => (
    <button onClick={() => project.send.Load({ id: props.id })}>
      {project.model().loading ? "Loading" : "Open"}
    </button>
  );
});
```

So the public shape is Foldkit-compact, but commands can require app services,
subscriptions are Effect streams, failures are typed state, and cleanup follows
the active UI scope/runtime rather than becoming a separate frontend runtime.

The test shape now follows the same model:

```ts
const load = State.step(ProjectState, ProjectState.initial, { _tag: "Load", id: "atlas" });
expect(load.model.loading).toBe(true);
expect(load.commands).toHaveLength(1);

const loaded = Effect.runSync(load.commands[0]!.effect.pipe(Effect.provide(ProjectApiTest)));
expect(loaded).toMatchObject({ _tag: "Loaded" });
```

Handlers are pure, so a transition is a function call: no runtime, DOM, or
timers. Commands stay inspectable descriptions whose Effects a test runs with
its own services, instead of a separate frontend-only test runtime.

At runtime, every State commit is an entry on the whole-app Timeline, next to
Resource, Action, and router commits:

<!-- prettier-ignore -->
```ts
const recording = yield* Timeline.record();
Signal.peek(recording.entries).map((entry) => Timeline.describe(entry.cause));
// ['State "Project" Load', 'Resource "Project.get" success atlas', ...]
yield* recording.travel(1); // the UI renders that commit; Effects keep running
```

That closes Foldkit's replay gap for the whole app, not only for one loop:
apps and devtools inspect and travel history without reaching into private
state. Devtools does that through the public Effect API:

<!-- prettier-ignore -->
```ts
yield* store.trackTimeline(recording);
```

Those rows go through the same bounded/redacted Devtools serialization contract
as request spans and action inputs.

## Compared With Solid

Solid's fine-grained reactivity is a great fit for this project. Sunfall Arc uses
the Solid target through TSRX today, rather than pretending it needs a custom UI
compiler first.

```tsx
const RenameForm = Component.define("RenameForm", function* (props: { readonly id: ProjectId }) {
  const project = yield* Component.resource(ProjectById); // E += ProjectNotFound
  const rename = yield* Component.action(RenameProject); // served: submits via ActionTransport
  // The outcome lands in `rename.result()`, so the handler ignores failures.
  const save = yield* Component.callback("save", (name: string) =>
    rename.submit({ id: props.id, name }).pipe(Effect.ignore),
  );

  return () => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(nextName());
      }}
    >
      <input value={project(props.id).name} />
      <button disabled={rename.result().waiting}>Save</button>
    </form>
  );
});
```

Solid gives compact UI updates. Sunfall Arc adds the runtime spine around those
updates: services, scopes, typed resources, actions, invalidation, SSR
hydration, diagnostics, and test layers.

## Where Sunfall Arc Is Already Different

Sunfall Arc already has a few unusually useful proof points:

- `pnpm verify` is the release gate for builds, runtime tests, type tests,
  example tests, example build, and leak scan.
- Framework callbacks reject accidental `Promise` returns in type tests.
- Resources (and their rows) are scoped to the active runtime/request store.
- Start file routes produce a deterministic, validated route manifest and a
  typed `routeTree.gen.ts`.
- The example app proves SSR, streamed hydration, branded route params,
  no-JS form posts (a validation failure renders the page again with its
  errors and posted values), redirects, indexed rows, optimistic
  mutation, mocking through Effect service Layers, and server-only leak scanning.

## Where The Incumbents Still Deserve Respect

The honest answer is that the mature tools still win on ecosystem size,
templates, third-party examples, hosting guides, and production miles. Foldkit
also sets a visible bar for Scene-style UI tests and built-in time travel.
Next.js sets the deployment, RSC, and framework-docs bar. TanStack Start and
Router set the typed routing and server-function ergonomics bar. TanStack DB
sets the normalized live-query and sync-adapter bar.

Sunfall Arc's advantage is not "more packages." Its advantage is coherence. The
same domain facts can be visible to TypeScript, Effect, the server runtime,
hydration, devtools, tests, diagnostics, and agents.

That is the bet: fewer hidden conventions, more explicit facts, and a framework
that can explain itself when something changes.

## The Friendly Pitch

If your app mostly needs a conventional web stack, the incumbents are good.
Use them happily.

If your app needs typed effects, runtime isolation, semantic invalidation,
mockable services, deterministic generated artifacts, progressive actions, and
agent-readable diagnostics, Sunfall Arc is trying to make that path feel normal.

The goal is not to be magical. The goal is to be inspectable enough that the
magic is optional.
