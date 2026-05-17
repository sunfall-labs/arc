# Effect UI Compared With Top-Tier Frameworks

Effect UI is trying to do something friendly but strict: keep the productive
feel of modern TypeScript app frameworks, while making the important facts
typed, Effect-native, inspectable, and hard to accidentally drift.

It is not trying to replace every good idea in React, Solid, Next, Remix,
TanStack Start, TanStack Query, TanStack DB, Relay, or Jotai. It borrows the
jobs people hire those tools for, then asks one extra question:

> Can the compiler, runtime, server, cache, mutation layer, diagnostics, tests,
> devtools, and agents all agree on the same application graph?

That is the core difference.

## The Short Version

| What teams reach for    | What it does well                      | Effect UI's bet                                                                                                               |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| React / Solid           | Component model and reactive UI        | Keep fine-grained UI ergonomics, but attach async work to Effect scopes and runtime ownership.                                |
| Next / Remix            | Full-stack routes, forms, server work  | Keep progressive enhancement, but make server contracts, schemas, request runtimes, and manifests explicit.                   |
| TanStack Start / Router | Typed routes and full-stack wiring     | Add Schema-branded params, request-local Effect runtimes, app graph diagnostics, and stricter build gates.                    |
| TanStack Query          | Async reads, retries, invalidation     | Replace cache keys with typed resources, semantic tags, Effect `Schedule`, hydration, and public lifecycle events.            |
| TanStack DB             | Normalized local data and live queries | Keep collections and live queries, but make row state runtime-local and integrate persistence, sync, SSR, and devtools facts. |
| Relay                   | Data graph discipline                  | Aim for graph-level discipline without requiring a GraphQL-only architecture.                                                 |
| Jotai / state libraries | Small local reactive state             | Keep local signals, but connect streams, scopes, resources, actions, and tests through one runtime spine.                     |

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

Effect UI wants the same workflow to be a domain graph instead of a string-key
agreement:

```ts
export const ProjectTag = Resource.tag<{ readonly id: ProjectId }>("Project", {
  key: ({ id }) => id,
});

export const ProjectById = Resource.family<ProjectId, Project, ProjectError, ProjectApi>({
  name: "Project.byId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});

export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: ProjectSchema,
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => [ProjectTag({ id: project.id })],
});
```

The difference is not just syntax. The resource owns schemas, retry policy,
semantic tags, hydration state, status, and public lifecycle events. The action
can expose an invalidation plan before refresh happens, so tests and devtools
can explain what changed and why.

## Compared With Next And Remix

Next and Remix made full-stack web apps feel practical again. Their route
handlers and form actions are direct, and that is a good thing.

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

Effect UI keeps the boring, useful progressive-enhancement story, but routes
through one typed action definition:

```ts
export const SubmitProjectName = Action.define({
  name: "Project.name.submit",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  run: (input) => ProjectApi.use((api) => api.submitName(input)),
  invalidates: (result, input) =>
    result._tag === "ValidationFailure" ? [] : projectResourceInvalidations(input.id),
});

export const projectNameActionTarget = (input: {
  readonly id: ProjectId;
  readonly redirectTo?: ProjectReturnTo;
}) => startActionForm(SubmitProjectName, { input });
```

With JavaScript, a component can submit through the Start action client. Without
JavaScript, the same `Action.define` handles the form post. Validation,
redirects, success, domain failures, invalidation, services, retries, and
schemas stay in one path.

## Compared With TanStack Start And Typed Routers

Typed routers help catch bad links. Effect UI leans into that, but keeps schemas
and generated route facts close to the app graph:

```ts
const RouteBuilder = defineFileRoute("/projects/:id");

export const Route = RouteBuilder.preload({
  params: Schema.Struct({ id: ProjectId }),
  search: Schema.Struct({
    tab: Schema.optional(Schema.Literals(["overview", "activity"])),
  }),
  resources: ({ resource }) => [resource(ProjectById, ({ params }) => params.id)],
  collections: [ProjectSummaries],
}).route();
```

The generated route file exposes maps such as `routeById`, `routeByPath`,
direct helpers such as `hrefByPath("/projects/:id", ...)`, params-by-id,
search-by-path, route `Match` aliases, and href options. The Start app graph can
then tell diagnostics and agents which route owns params, search, preload
resources, collections, server functions, actions, schemas, and modules.

That makes "what does this route touch?" a generated fact instead of an import
hunt.

## Compared With TanStack DB

TanStack DB points at an important future: normalized local data with live
queries. Effect UI's DB layer heads in the same direction, but plugs row state
into the active Effect UI runtime/resource store:

```ts
export const ProjectSummaries = Collection.define(
  Collection.serverOptions({
    id: "Projects.collection",
    output: ProjectSummarySchema,
    getKey: (project) => project.id,
    indexes: {
      status: (project) => project.status,
      owner: (project) => project.owner,
    },
    load: () => ProjectApi.use((api) => api.list()),
    update: ({ updates }) =>
      Effect.forEach(
        updates,
        (update) =>
          ProjectApi.use((api) =>
            api.rename({
              id: update.key,
              name: String(update.changes.name),
            }),
          ).pipe(Effect.asVoid),
        { discard: true },
      ),
  }),
);
```

Collections can expose secondary indexes, pending optimistic mutation queues,
rollback rows, persistence snapshots, sync adapters, live query diagnostics,
and SSR hydration payloads. Because the state is runtime/request-local, tests
and SSR requests do not accidentally share rows.

## Compared With Relay

Relay is strong because it treats data dependencies as a graph with a compiler.
Effect UI agrees with the shape of that lesson, but it does not require the app
to become GraphQL-only.

The graph includes more than fetched fields:

- routes and preload ownership;
- resources and semantic tags;
- collections and indexes;
- actions and invalidation behavior;
- server functions and module boundaries;
- schemas and missing schema diagnostics;
- hydration and runtime facts.

Relay asks GraphQL to be the center. Effect UI asks the TypeScript, Effect, and
Start app graph to be the center.

## Compared With Jotai And Small State Libraries

Small state tools are pleasant because they make local state feel lightweight.
Effect UI keeps that part simple:

```ts
const search = Signal.make("");
const normalized = Signal.derive(() => read(search).trim().toLowerCase());
```

The difference appears when state meets async work. A signal can stream values,
a component can own a scope, a resource can publish lifecycle facts, and an
action can invalidate semantic tags. Local state does not become a separate
mental model from server state and mutation state.

## Compared With Foldkit

Foldkit's strongest product idea is the frontend program loop: one model, typed
messages, an update function, subscriptions, and a view that can stay boring.
Effect UI now keeps that clarity as a headless Core primitive while routing the
hard parts through Effect:

```ts
const ProjectProgram = Program.define({
  initial: { selected: undefined as Project | undefined, loading: false },
  update: (model, message: ProjectMessage) => {
    switch (message._tag) {
      case "Load":
        return Program.next(
          { ...model, loading: true },
          Program.command(
            ProjectApi.use((api) =>
              Effect.map(api.get(message.id), (project) => ({ _tag: "Loaded", project })),
            ),
          ),
        );
      case "Loaded":
        return { selected: message.project, loading: false };
    }
  },
  subscriptions: (model) => (model.selected ? ProjectEvents.changes(model.selected.id) : undefined),
});
```

The Solid adapter is intentionally small:

```tsx
const program = useProgram(ProjectProgram);

return (
  <button onClick={() => program.dispatch({ _tag: "Load", id })}>
    {program.model().loading ? "Loading" : "Open"}
  </button>
);
```

So the public shape is Foldkit-simple, but commands can require app services,
subscriptions are Effect streams, failures are typed state, and cleanup follows
the active UI scope/runtime rather than becoming a separate frontend runtime.

The test shape now follows the same model:

```ts
const story = Program.story(ProjectProgram);
const load = yield * story.send({ _tag: "Load", id: "atlas" });

expect(load.commands).toHaveLength(1);
yield * story.resolve(load.commands[0]!);
expect(read(story.model).selected?.id).toBe("atlas");
```

That keeps Foldkit's "story test" clarity while preserving Effect services and
typed command failures instead of inventing a separate frontend-only test
runtime.

At runtime, the same Program exposes an inspectable timeline:

```ts
program.timeline().map((event) => event._tag);
// ["Message", "CommandStarted", "CommandCompleted", "Message"]
```

That closes the biggest remaining frontend-architecture polish gap: apps and
devtools can watch the Program think without reaching into private state.
Devtools does that through the public Effect API:

```ts
yield * store.trackProgramEffect(program);
```

Those rows go through the same bounded/redacted Devtools serialization contract
as request traces and action inputs.

## Compared With Solid

Solid's fine-grained reactivity is a great fit for this project. Effect UI uses
the Solid target through TSRX today, rather than pretending it needs a custom UI
compiler first.

```tsx
const project = useResource(ProjectById(props.id));
const rename = useAction(RenameProject);
const renameState = useSignal(rename.state);
const runtime = useRuntime();

return (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      void runtime.runFork(rename.submitEffect({ id: props.id, name: nextName() }));
    }}
  >
    <button disabled={renameState()._tag === "Pending"}>Save</button>
  </form>
);
```

Solid gives compact UI updates. Effect UI adds the runtime spine around those
updates: services, scopes, typed resources, actions, invalidation, SSR
hydration, diagnostics, and test layers.

## Where Effect UI Is Already Different

Effect UI already has a few unusually useful proof points:

- `pnpm verify` is the release gate for builds, runtime tests, type tests,
  example tests, example build, and leak scan.
- Framework callbacks reject accidental `Promise` returns in type tests.
- Resources and collections are scoped to the active runtime/request store.
- Start server functions and actions produce deterministic manifests.
- The app graph can drive diagnostics and agent-readable repair reports.
- The example app proves SSR, streamed hydration, branded route params,
  progressive form posts, validation, redirects, collections, optimistic
  mutation, mocking through capabilities, and server-only leak scanning.

## Where The Incumbents Still Deserve Respect

The honest answer is that the mature tools still win on ecosystem size,
templates, third-party examples, hosting guides, and production miles.

Effect UI's advantage is not "more packages." Its advantage is coherence. The
same domain facts can be visible to TypeScript, Effect, the server runtime,
hydration, devtools, tests, diagnostics, and agents.

That is the bet: fewer hidden conventions, more explicit facts, and a framework
that can explain itself when something changes.

## The Friendly Pitch

If your app mostly needs a conventional web stack, the incumbents are good.
Use them happily.

If your app needs typed effects, runtime isolation, semantic invalidation,
mockable services, deterministic generated artifacts, progressive actions, and
agent-readable diagnostics, Effect UI is trying to make that path feel normal.

The goal is not to be magical. The goal is to be inspectable enough that the
magic is optional.
