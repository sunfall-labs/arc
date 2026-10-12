// Component typing: services (R) and typed render failures (E) flow through
// component definitions and `yield*`, never through JSX.
import { Cause, Context, Data, Effect, Layer, pipe, Schema, Scope, Stream } from "effect";
import { Component, RouterProvider } from "@sunfall/arc-solid";
import {
  Action,
  Program,
  Resource,
  Route,
  type ActionInterrupted,
  type AnySunfallArcRuntime,
  type EffectInputCallbackError,
  type ResourceUntypedFailure,
  type Server,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import type { JSX } from "@solidjs/web";

class ProjectApi extends Context.Service<
  ProjectApi,
  { readonly get: (id: string) => Effect.Effect<string, ProjectNotFound | Forbidden> }
>()("type-tests/Component/ProjectApi") {}
class Realtime extends Context.Service<Realtime, { readonly feed: () => ReadonlyArray<string> }>()(
  "type-tests/Component/Realtime",
) {}
class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: Schema.String,
}) {}
class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}
class ConfigMissing extends Data.TaggedError("ConfigMissing")<{}> {}

type Assert<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Parts<C> = C extends Component<infer P, infer E, infer R> ? { P: P; E: E; R: R } : never;

const ProjectById = Resource.define({
  name: "type-tests/Component/ProjectById",
  error: Schema.Union([ProjectNotFound, Forbidden]),
  load: (id: string) => ProjectApi.use((api) => api.get(id)),
});

// Leaf: a resource whose typed load error joins E and services join R. A
// throwing load callback (EffectInputCallbackError) is a defect, not part of E.
const ProjectCard = Component.define("ProjectCard", function* (props: { readonly id: string }) {
  const project = yield* Component.resource(ProjectById);
  return (): JSX.Element => project(props.id);
});
type _card = Assert<
  Eq<
    Parts<typeof ProjectCard>,
    {
      P: { readonly id: string };
      E: ProjectNotFound | Forbidden;
      R: ProjectApi;
    }
  >
>;

// Leaf with a different service, no props, no failures. Setup finalizers need
// no Scope in R: setup always runs in the instance Scope.
const ActivityFeed = Component.define("ActivityFeed", function* () {
  const realtime = yield* Realtime;
  yield* Effect.addFinalizer(() => Effect.void);
  return () => realtime.feed().join(",");
});
type _feed = Assert<Eq<Parts<typeof ActivityFeed>, { P: {}; E: never; R: Realtime }>>;

// Parent: children's R accumulates, handled tags leave E, yielded children are plain renders.
const Dashboard = Component.define("Dashboard", function* (props: { readonly selected: string }) {
  const Card = yield* ProjectCard.pipe(
    Component.catchTags({ ProjectNotFound: (error) => `gone ${error.id}` }),
    Component.loading(() => "loading"),
  );
  const Feed = yield* ActivityFeed;
  type _cardRender = Assert<Eq<typeof Card, Component.Solid<{ readonly id: string }>>>;
  return () => [Card({ id: props.selected }), Feed({})];
});
type _dash = Assert<
  Eq<
    Parts<typeof Dashboard>,
    { P: { readonly selected: string }; E: Forbidden; R: ProjectApi | Realtime }
  >
>;

// Nested yields keep inferring through a further level.
const Shell = Component.define("Shell", function* () {
  const Inner = yield* Dashboard;
  return () => Inner({ selected: "atlas" });
});
type _shell = Assert<Eq<Parts<typeof Shell>, { P: {}; E: Forbidden; R: ProjectApi | Realtime }>>;

// Setup failures are render failures.
const Configured = Component.define("Configured", function* () {
  yield* Effect.fail(new ConfigMissing());
  return () => "configured";
});
type _configured = Assert<Eq<Parts<typeof Configured>, { P: {}; E: ConfigMissing; R: never }>>;

const ProjectApiLive = Layer.succeed(ProjectApi, {
  get: (id: string) => Effect.succeed(`project:${id}`),
});
const RealtimeLive = Layer.succeed(Realtime, { feed: () => ["a", "b"] });
const FailingRealtimeLive = Layer.effect(Realtime, Effect.fail(new ConfigMissing()));

// provide removes ROut; Layer failures join E.
const ProvidedFeed = ActivityFeed.pipe(Component.provide(FailingRealtimeLive));
type _providedFeed = Assert<Eq<Parts<typeof ProvidedFeed>, { P: {}; E: ConfigMissing; R: never }>>;

const Ok = pipe(
  Dashboard,
  Component.catchTags({ Forbidden: (_error, reset) => (reset(), "no") }),
  Component.provide(Layer.merge(ProjectApiLive, RealtimeLive)),
);
type _ok = Assert<Eq<Parts<typeof Ok>, { P: { readonly selected: string }; E: never; R: never }>>;

declare const root: HTMLElement;

// The binding itself: the reader returns the value; E is the family's typed error only.
const bound = Component.resource(ProjectById);
type _bound = Assert<
  Eq<
    typeof bound,
    Effect.Effect<
      Component.ResourceReader<string, string, ProjectNotFound | Forbidden>,
      ProjectNotFound | Forbidden,
      ProjectApi
    >
  >
>;
// A Resource's `error` schema defines its declared error and the failure its
// reads render; Effects (preloads, actions) see the declared error.
const TypedProject = Resource.define({
  name: "type-tests/Component/TypedProject",
  error: ProjectNotFound,
  load: (id: string): Effect.Effect<string, ProjectNotFound> =>
    Effect.fail(new ProjectNotFound({ id })),
});
type _typedRender = Assert<Eq<Resource.RenderError<typeof TypedProject>, ProjectNotFound>>;
const typedPreload = Resource.preload(TypedProject("atlas"));
type _typedPreload = Assert<Eq<typeof typedPreload, Effect.Effect<string, ProjectNotFound>>>;
// A schema wider than the load's failures widens the declared error.
const WideProject = Resource.define({
  name: "type-tests/Component/WideProject",
  error: Schema.Union([ProjectNotFound, Forbidden]),
  load: (id: string): Effect.Effect<string, ProjectNotFound> =>
    Effect.fail(new ProjectNotFound({ id })),
});
const widePreload = Resource.preload(WideProject("atlas"));
type _widePreload = Assert<
  Eq<typeof widePreload, Effect.Effect<string, ProjectNotFound | Forbidden>>
>;
type _wideRender = Assert<
  Eq<Resource.RenderError<typeof WideProject>, ProjectNotFound | Forbidden>
>;
Resource.define({
  name: "type-tests/Component/UncoveredProject",
  // @ts-expect-error the load can fail with Forbidden, which the schema does not declare
  error: ProjectNotFound,
  load: (_id: string) => Effect.fail(new Forbidden()),
});
Resource.define({
  name: "type-tests/Component/NotASchema",
  // @ts-expect-error `error` must be a Schema codec
  error: ProjectNotFound as unknown as string,
  load: (id: string) => Effect.fail(new ProjectNotFound({ id })),
});

// Without a schema, Effects see the load's own failure, but a render reports
// only its `_tag`: the reader's failure is ResourceUntypedFailure.
class DatabaseDown extends Data.TaggedError("DatabaseDown")<{ readonly secret: string }> {}
const UntypedStats = Resource.define({
  name: "type-tests/Component/UntypedStats",
  load: (_: "all"): Effect.Effect<number, DatabaseDown> =>
    Effect.fail(new DatabaseDown({ secret: "" })),
});
const untypedPreload = Resource.preload(UntypedStats("all"));
type _untypedPreload = Assert<Eq<typeof untypedPreload, Effect.Effect<number, DatabaseDown>>>;
type _untypedRender = Assert<Eq<Resource.RenderError<typeof UntypedStats>, ResourceUntypedFailure>>;
const StatsCard = Component.define("StatsCard", function* () {
  const stats = yield* Component.resource(UntypedStats);
  const failure: Cause.Cause<ResourceUntypedFailure> | undefined = stats.failure("all");
  void failure;
  return () => String(stats("all"));
});
type _statsCard = Assert<Eq<Parts<typeof StatsCard>["E"], ResourceUntypedFailure>>;
const SafeStats = StatsCard.pipe(
  Component.catchTags({ ResourceUntypedFailure: (error) => `stats failed: ${error.tag}` }),
);
type _safeStats = Assert<Eq<Parts<typeof SafeStats>["E"], never>>;
// @ts-expect-error the load's own tag never reaches a render without a schema
StatsCard.pipe(Component.catchTags({ DatabaseDown: () => "down" }));
// A family that cannot fail renders no failure.
const Greeting = Resource.define({
  name: "type-tests/Component/Greeting",
  load: (name: string) => Effect.succeed(`hello ${name}`),
});
type _greetingRender = Assert<Eq<Resource.RenderError<typeof Greeting>, never>>;

// Status chrome carries no value: content renders only through the reader.
declare const reader: Component.ResourceReader<string, string, ProjectNotFound>;
const readerValue: string = reader("atlas");
const readerWaiting: boolean = reader.waiting("atlas");
const readerFailure: Cause.Cause<ProjectNotFound> | undefined = reader.failure("atlas");
void readerValue;
void readerWaiting;
void readerFailure;

// Actions: the definition's services join R; the handle reports its own,
// callback, and transport failures, and submits with the instance's context.
const Rename = Action.define({
  name: "type-tests/Component/Rename",
  run: (input: { readonly id: string; readonly name: string }) =>
    ProjectApi.use((api) => api.get(input.id)),
});
const renameBinding = Component.action(Rename);
type _renameBinding = Assert<
  Eq<
    typeof renameBinding,
    Effect.Effect<
      Component.ActionHandle<
        { readonly id: string; readonly name: string },
        string,
        ProjectNotFound | Forbidden
      >,
      never,
      ProjectApi
    >
  >
>;
declare const renameHandle: Effect.Success<typeof renameBinding>;
const renameSubmit: Effect.Effect<
  string,
  ProjectNotFound | Forbidden | EffectInputCallbackError | Server.ClientError | ActionInterrupted,
  never
> = renameHandle.submit({ id: "atlas", name: "Atlas" });
void renameSubmit;

// Programs: the definition's services join R.
const Counter = Program.define<number, { readonly _tag: "Load" }, never, ProjectApi>({
  initial: 0,
  update: (model) => model + 1,
});
const counterBinding = Component.program(Counter);
type _counterBinding = Assert<
  Eq<
    typeof counterBinding,
    Effect.Effect<
      Component.ProgramHandle<number, { readonly _tag: "Load" }, never>,
      never,
      ProjectApi
    >
  >
>;

// Streams and callbacks: services join R; callbacks must handle their failures.
const feedBinding = Component.stream(
  Stream.fromEffect(Realtime.use((realtime) => Effect.succeed(realtime.feed().length))),
  0,
);
type _feedBinding = Assert<Eq<typeof feedBinding, Effect.Effect<() => number, never, Realtime>>>;
const openBinding = Component.callback((id: string) =>
  ProjectApi.use((api) => api.get(id)).pipe(Effect.ignore),
);
type _openBinding = Assert<
  Eq<typeof openBinding, Effect.Effect<(id: string) => void, never, ProjectApi>>
>;

// Router: route preload services and route Components' services and failures
// join the component, so `launch` checks them.
const ProjectRoute = Route.define("/projects/:id", {
  preload: ({ params }) => ProjectApi.use((api) => api.get(params.id)),
});
const ProjectPage = Component.define(
  "ProjectPage",
  function* (props: Route.Props<typeof ProjectRoute>) {
    const realtime = yield* Realtime;
    return () => `${props.params.id}:${realtime.feed().length}`;
  },
);
const routes = [Route.withComponent(ProjectRoute, ProjectPage)] as const;
const RoutedApp = Component.define("RoutedApp", function* () {
  const router = yield* Component.router(routes);
  return () => RouterProvider({ router });
});
type _routedApp = Assert<
  Eq<Parts<typeof RoutedApp>, { P: {}; E: never; R: ProjectApi | Realtime }>
>;
const routedLaunch: Effect.Effect<never> = Component.launch(
  RoutedApp.pipe(Component.provide(Layer.merge(ProjectApiLive, RealtimeLive))),
  root,
);
void routedLaunch;

// Fully handled and provided: mounts as a scoped acquisition.
const mounted: Effect.Effect<void, never, Scope.Scope> = Component.mount(Ok, root, {
  props: { selected: "atlas" },
});
const mountedNoProps: Effect.Effect<void, never, Scope.Scope> = Component.mount(
  Shell.pipe(
    Component.catchTags({ Forbidden: () => "no" }),
    Component.provide(Layer.merge(ProjectApiLive, RealtimeLive)),
  ),
  root,
);
class HostStartupError extends Data.TaggedError("HostStartupError")<{}> {}
declare const hostRuntime: SunfallArcRuntime<never, HostStartupError>;
// A host-owned runtime's startup failure is the only way a mount can fail.
const mountedInHost: Effect.Effect<void, HostStartupError, Scope.Scope> = Component.mount(
  Ok,
  root,
  { runtime: hostRuntime, props: { selected: "atlas" } },
);
void mountedInHost;
// The app entry point runs until interrupted and fails only with a host runtime's startup error.
const launched: Effect.Effect<never, never> = Component.launch(Ok, root, {
  props: { selected: "atlas" },
});
const launchedInHost: Effect.Effect<never, HostStartupError> = Component.launch(Ok, root, {
  runtime: hostRuntime,
  props: { selected: "atlas" },
  hydrate: true,
});
void launched;
void launchedInHost;
// A host runtime's services satisfy what the component leaves unprovided.
const HandledDashboard = Dashboard.pipe(Component.catchTags({ Forbidden: () => "no" }));
declare const appRuntime: SunfallArcRuntime<ProjectApi | Realtime, HostStartupError>;
declare const apiRuntime: SunfallArcRuntime<ProjectApi>;
declare const erasedRuntime: AnySunfallArcRuntime;
const mountedOnAppRuntime: Effect.Effect<void, HostStartupError, Scope.Scope> = Component.mount(
  HandledDashboard,
  root,
  { runtime: appRuntime, props: { selected: "atlas" } },
);
const launchedOnAppRuntime: Effect.Effect<never, HostStartupError> = Component.launch(
  HandledDashboard.pipe(Component.provide(RealtimeLive)),
  root,
  { runtime: appRuntime, props: { selected: "atlas" } },
);
void mountedOnAppRuntime;
void launchedOnAppRuntime;
const embedded: Component.Solid<{ readonly selected: string }> = Component.embed(Ok, appRuntime);
void mounted;
void mountedNoProps;
void embedded;

export function negatives() {
  // @ts-expect-error R = ProjectApi | Realtime is not never
  Component.mount(Dashboard, root, { props: { selected: "x" } });

  const partiallyProvided = pipe(
    Dashboard,
    Component.catchTags({ Forbidden: () => "no" }),
    Component.provide(ProjectApiLive),
  );
  // @ts-expect-error R = Realtime remains after a partial layer
  Component.mount(partiallyProvided, root, { props: { selected: "x" } });

  const unhandled = pipe(Dashboard, Component.provide(Layer.merge(ProjectApiLive, RealtimeLive)));
  // @ts-expect-error E = Forbidden is unhandled
  Component.mount(unhandled, root, { props: { selected: "x" } });

  // @ts-expect-error a Layer failure must be handled before mounting
  Component.mount(ProvidedFeed, root);

  // @ts-expect-error selected must be a string
  Component.mount(Ok, root, { props: { selected: 1 } });

  // @ts-expect-error required root props must be passed
  Component.mount(Ok, root);

  const HandledDashboard = Dashboard.pipe(Component.catchTags({ Forbidden: () => "no" }));
  // @ts-expect-error R = Realtime is not in the runtime's services
  Component.mount(HandledDashboard, root, { runtime: apiRuntime, props: { selected: "x" } });

  // @ts-expect-error an erased runtime satisfies no requirements
  Component.mount(HandledDashboard, root, { runtime: erasedRuntime, props: { selected: "x" } });

  // @ts-expect-error E = Forbidden is unhandled even when the runtime provides every service
  Component.launch(Dashboard, root, { runtime: appRuntime, props: { selected: "x" } });

  // @ts-expect-error launching also requires a fully handled, fully provided component
  Component.launch(Dashboard, root, { props: { selected: "x" } });

  // @ts-expect-error required root props must be passed to launch too
  Component.launch(Ok, root);

  // @ts-expect-error a throwing load callback is a defect, so it has no handler
  ProjectCard.pipe(Component.catchTags({ EffectInputCallbackError: () => "callback" }));

  // @ts-expect-error embedding also requires a fully handled, fully provided component
  Component.embed(Dashboard, appRuntime);

  // @ts-expect-error embedding checks the runtime's services too
  Component.embed(HandledDashboard, apiRuntime);

  // @ts-expect-error a route's preload services must be provided before launch
  Component.launch(RoutedApp.pipe(Component.provide(RealtimeLive)), root);

  // @ts-expect-error a route Component's services must be provided before launch
  Component.launch(RoutedApp.pipe(Component.provide(ProjectApiLive)), root);

  // @ts-expect-error callbacks must handle their failures
  Component.callback((id: string) => ProjectApi.use((api) => api.get(id)));

  Component.define("WrongProps", function* () {
    const Card = yield* ProjectCard;
    // @ts-expect-error the yielded render keeps its props type
    return () => Card({ id: 1 });
  });

  // @ts-expect-error "Nope" is not a tag the component can fail with
  pipe(ProjectCard, Component.catchTags({ Nope: () => "?" }));

  // @ts-expect-error impossible tags are rejected beside valid ones
  ProjectCard.pipe(Component.catchTags({ ProjectNotFound: () => "gone", Nope: () => "?" }));

  ProjectCard.pipe(
    Component.catchTags({
      // @ts-expect-error handlers receive exactly the matching member of E
      ProjectNotFound: (error: Forbidden) => String(error),
    }),
  );
}
