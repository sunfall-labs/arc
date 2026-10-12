import { Effect, Schema } from "effect";
import {
  Resource,
  Route,
  type RoutePreloadError,
  RoutePreloadUntypedFailure,
} from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <T extends true>(): T => true as T;

class TaskNotFound extends Schema.TaggedError<TaskNotFound>()("TaskNotFound", {
  id: Schema.String,
}) {}
class TaskForbidden extends Schema.TaggedError<TaskForbidden>()("TaskForbidden", {}) {}
class Flaky extends Schema.TaggedError<Flaky>()("Flaky", {}) {}

const TaskId = Schema.String.pipe(Schema.brand("TaskId"));
type TaskId = typeof TaskId.Type;

const TaskById = Resource.define({
  name: "RouteInference.task",
  input: TaskId,
  output: Schema.Struct({ id: TaskId, title: Schema.String }),
  load: (id: TaskId) =>
    id.length === 0 ? Effect.fail(new TaskNotFound({ id })) : Effect.succeed({ id, title: "" }),
});
const TaskList = Resource.define({
  name: "RouteInference.list",
  input: Schema.Literal("all"),
  output: Schema.Array(Schema.String),
  load: () => Effect.succeed([] as ReadonlyArray<string>),
});

// Resource.preload/refresh take one ref or an array: values come back in order,
// and the error is the union of the refs' declared errors (no callback error).
const preloadOne = Resource.preload(TaskById("a" as TaskId));
expectType<
  Equal<
    typeof preloadOne,
    Effect.Effect<{ readonly id: TaskId; readonly title: string }, TaskNotFound>
  >
>();
const preloadMany = Resource.preload([TaskList("all"), TaskById("a" as TaskId)]);
expectType<
  Equal<
    typeof preloadMany,
    Effect.Effect<
      [ReadonlyArray<string>, { readonly id: TaskId; readonly title: string }],
      TaskNotFound
    >
  >
>();
const refreshMany = Resource.refresh([TaskList("all")]);
expectType<Equal<typeof refreshMany, Effect.Effect<[ReadonlyArray<string>], never>>>();

// `preload` is inferred from its own body: an inline pipeline keeps typed
// params and its narrowed error is checked against `error`.
const TaskRoute = Route.define("/tasks/:id", {
  params: Schema.Struct({ id: TaskId }),
  error: TaskNotFound,
  preload: ({ params }) => {
    expectType<Equal<typeof params, { readonly id: TaskId }>>();
    return Effect.fail(new Flaky()).pipe(
      Effect.catchTag("Flaky", () => Resource.preload(TaskById(params.id))),
    );
  },
});
expectType<Equal<Route.PreloadFailure<typeof TaskRoute>, TaskNotFound>>();
expectType<Equal<Route.Params<typeof TaskRoute>, { readonly id: TaskId }>>();

const TaskOrForbidden = Schema.Union([TaskNotFound, TaskForbidden]);
const WideRoute = Route.define("/wide/:id", {
  error: TaskOrForbidden,
  preload: ({ params }) => Resource.preload(TaskById(params.id as TaskId)),
});
expectType<Equal<Route.PreloadFailure<typeof WideRoute>, TaskNotFound | TaskForbidden>>();

Route.define("/narrow/:id", {
  // @ts-expect-error the preload can fail with Flaky, which `error` does not declare
  error: TaskNotFound,
  preload: ({ params }) =>
    Effect.all([Resource.preload(TaskById(params.id as TaskId)), Effect.fail(new Flaky())]),
});

declare const pendingWork: Promise<void>;
Route.define("/promise", {
  // @ts-expect-error route preloads return void or an Effect, never a Promise
  preload: () => pendingWork,
});

// Without an `error` schema only the failure's tag crosses the wire, so the
// route reports `RoutePreloadUntypedFailure`; a preload that cannot fail has
// `never`, and so does a route without preload.
const UntypedRoute = Route.define("/untyped/:id", {
  preload: ({ params }) => Resource.preload(TaskById(params.id as TaskId)),
});
expectType<Equal<Route.PreloadFailure<typeof UntypedRoute>, RoutePreloadUntypedFailure>>();
const InfallibleRoute = Route.define("/infallible", {
  preload: () => Resource.preload(TaskList("all")),
});
expectType<Equal<Route.PreloadFailure<typeof InfallibleRoute>, never>>();
const StaticRoute = Route.define("/static");
expectType<Equal<Route.PreloadFailure<typeof StaticRoute>, never>>();
expectType<Equal<Route.PreloadFailure<typeof StaticRoute>, never>>();
const VoidRoute = Route.define("/void", { preload: () => undefined });
expectType<Equal<Route.PreloadFailure<typeof VoidRoute>, never>>();

// A feature component binds to a route directly; `props` maps the route props.
const TaskPage = Component.define("TaskPage", function* (props: { readonly id: TaskId }) {
  const task = yield* Component.resource(TaskById);
  return () => <p>{task(props.id).title}</p>;
});
const TaskUiRoute = Route.withComponent(TaskRoute, TaskPage, ({ params }) => ({ id: params.id }));
// @ts-expect-error without `props`, the component must take the route's own props
Route.withComponent(TaskRoute, TaskPage);
// @ts-expect-error the mapped props must match the component's props
Route.withComponent(TaskRoute, TaskPage, ({ params }) => ({ taskId: params.id }));
const UntypedUiRoute = Route.withComponent(
  UntypedRoute,
  (props: Route.Props<typeof UntypedRoute>) => <p>{props.params.id}</p>,
);

// A file route declares a plain render function inline (Start code-splits
// it); it takes the route's own props. Typed Components go through withComponent.
const InlineRoute = Route.define("/inline/:id", {
  params: Schema.Struct({ id: TaskId }),
  component: ({ params }) => {
    expectType<Equal<typeof params, { readonly id: TaskId }>>();
    return <p>{params.id}</p>;
  },
});
expectType<Equal<Route.Params<typeof InlineRoute>, { readonly id: TaskId }>>();
Route.define("/inline-wrong/:id", {
  // @ts-expect-error an inline component takes the route's own props
  component: (props: { readonly slug: string }) => <p>{props.slug}</p>,
});
Route.define("/inline-component/:id", {
  // @ts-expect-error a typed Component's services must reach the router: use withComponent
  component: TaskPage,
});

const routes = [TaskUiRoute, UntypedUiRoute] as const;

// Router options accept `undefined` as "absent", and the outlet's failure view
// is typed from its `router`: a switch on the preload failure's `_tag` is exhaustive.
export const TaskApp = Component.define(
  "TaskApp",
  function* (props: { readonly initialHref?: string }) {
    const router = yield* Component.router(routes, { initialHref: props.initialHref });
    return () => (
      <RouterProvider router={router}>
        <RouterOutlet
          router={router}
          failure={({ error }) => {
            if (error?._tag !== "RoutePreloadError") {
              return <p>Navigation failed.</p>;
            }
            const cause = error.cause;
            switch (cause._tag) {
              case "TaskNotFound":
                return <p>No task "{cause.id}".</p>;
              case "RoutePreloadUntypedFailure":
                return <p>Failed: {cause.tag}</p>;
              default: {
                const exhaustive: never = cause;
                return exhaustive;
              }
            }
          }}
        />
      </RouterProvider>
    );
  },
);
declare const taskPreloadError: RoutePreloadError<Route.PreloadFailure<(typeof routes)[number]>>;
expectType<Equal<typeof taskPreloadError.cause, TaskNotFound | RoutePreloadUntypedFailure>>();
void RoutePreloadUntypedFailure;
