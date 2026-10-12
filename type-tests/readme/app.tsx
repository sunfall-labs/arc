import { Action, Resource, Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { App } from "@sunfall/arc-start";
import { Effect, Schema } from "effect";
import { Loading } from "solid-js";

export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  done: Schema.Boolean,
});
export type Todo = typeof Todo.Type;

export class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
  id: Schema.String,
}) {}

// A Resource: a named, cached, typed read. No `load`: the server loads it,
// and its schemas are the wire contract.
export const TodoById = Resource.define({
  name: "Todos.byId",
  input: Schema.String,
  output: Todo,
  error: TodoNotFound,
});

// An Action: a named write the server runs. The checkbox flips at once; a
// failure rolls it back.
export const ToggleTodo = Action.define({
  name: "Todos.toggle",
  input: Schema.String,
  output: Todo,
  error: TodoNotFound,
  optimistic: (id, transaction) =>
    transaction.set(TodoById(id), (todo) => ({ ...todo, done: !todo.done })),
});

// A Component. Reading TodoById adds TodoNotFound to its type until it is handled.
const TodoPage = Component.define("TodoPage", function* (props: { readonly id: string }) {
  const todo = yield* Component.resource(TodoById);
  const toggle = yield* Component.action(ToggleTodo);
  const flip = yield* Component.callback("flip", () => toggle.submit(props.id).pipe(Effect.ignore));
  return () => (
    <Loading fallback={<p>Loading</p>}>
      <label>
        <input type="checkbox" checked={todo(props.id).done} onChange={() => flip()} />
        {todo(props.id).title}
      </label>
    </Loading>
  );
}).pipe(Component.catchTags({ TodoNotFound: (error) => <p>No todo {error.id}.</p> }));

const TodoRoute = Route.define("/todos/:id", { params: Schema.Struct({ id: Schema.String }) });
const routes = [
  Route.withComponent(TodoRoute, TodoPage, ({ params }) => ({ id: params.id })),
] as const;

const Root = Component.define("Root", function* (props: { readonly href: string }) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  return () => (
    <RouterProvider router={router}>
      <RouterOutlet router={router} />
    </RouterProvider>
  );
});

// One definition for both hosts. Without the catchTags line, this does not compile.
export const app = App.define({ root: Root, routes });
