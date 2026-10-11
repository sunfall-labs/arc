// Component typing: services (R) and typed render failures (E) flow through
// component definitions and `yield*`, never through JSX.
import { Context, Data, Effect, Layer, pipe, Scope } from "effect";
import { Component, Resource } from "@sunfall/arc-solid";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import type { JSX } from "@solidjs/web";

class ProjectApi extends Context.Service<
  ProjectApi,
  { readonly get: (id: string) => Effect.Effect<string, ProjectNotFound | Forbidden> }
>()("type-tests/Component/ProjectApi") {}
class Realtime extends Context.Service<Realtime, { readonly feed: () => ReadonlyArray<string> }>()(
  "type-tests/Component/Realtime",
) {}
class ProjectNotFound extends Data.TaggedError("ProjectNotFound")<{ readonly id: string }> {}
class Forbidden extends Data.TaggedError("Forbidden")<{}> {}
class ConfigMissing extends Data.TaggedError("ConfigMissing")<{}> {}

type Assert<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Parts<C> = C extends Component<infer P, infer E, infer R> ? { P: P; E: E; R: R } : never;

const ProjectById = Resource.family({
  name: "type-tests/Component/ProjectById",
  load: (id: string) => ProjectApi.use((api) => api.get(id)),
});

// Leaf: a service plus a resource whose load error joins E and services join R.
const ProjectCard = Component.make("ProjectCard", function* () {
  const project = yield* Component.resource(ProjectById);
  return (props: { readonly id: string }): JSX.Element => project(props.id);
});
type _card = Assert<
  Eq<
    Parts<typeof ProjectCard>,
    {
      P: { readonly id: string };
      E: Resource.LoadError<ProjectNotFound | Forbidden>;
      R: ProjectApi;
    }
  >
>;

// Leaf with a different service, no props, no failures. Setup finalizers need
// no Scope in R: setup always runs in the runtime-lifetime Scope.
const ActivityFeed = Component.make("ActivityFeed", function* () {
  const realtime = yield* Realtime;
  yield* Effect.addFinalizer(() => Effect.void);
  return () => realtime.feed().join(",");
});
type _feed = Assert<Eq<Parts<typeof ActivityFeed>, { P: {}; E: never; R: Realtime }>>;

// Parent: children's R accumulates, handled tags leave E, yielded children are plain renders.
const Dashboard = Component.make("Dashboard", function* () {
  const Card = yield* ProjectCard.pipe(
    Component.catchTags({
      ProjectNotFound: (error) => `gone ${error.id}`,
      EffectInputCallbackError: (error) => error.operation,
    }),
    Component.loading(() => "loading"),
  );
  const Feed = yield* ActivityFeed;
  type _cardRender = Assert<Eq<typeof Card, Component.Render<{ readonly id: string }>>>;
  return (props: { readonly selected: string }) => [Card({ id: props.selected }), Feed({})];
});
type _dash = Assert<
  Eq<
    Parts<typeof Dashboard>,
    { P: { readonly selected: string }; E: Forbidden; R: ProjectApi | Realtime }
  >
>;

// Nested yields keep inferring through a further level.
const Shell = Component.make("Shell", function* () {
  const Inner = yield* Dashboard;
  return () => Inner({ selected: "atlas" });
});
type _shell = Assert<Eq<Parts<typeof Shell>, { P: {}; E: Forbidden; R: ProjectApi | Realtime }>>;

// Setup failures are render failures.
const Configured = Component.make("Configured", function* () {
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
const embedded: Component.Render<{ readonly selected: string }> = Component.embed(Ok);
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

  // @ts-expect-error embedding also requires a fully handled, fully provided component
  Component.embed(Dashboard);

  Component.make("WrongProps", function* () {
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
