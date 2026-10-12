import { Action, Resource, Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { App } from "@sunfall/arc-start";
import { Context, Effect, Layer, Schema } from "effect";
import { Loading } from "solid-js";

const Todo = Schema.Struct({ id: Schema.String, title: Schema.String, done: Schema.Boolean });
type Todo = typeof Todo.Type;

class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
  id: Schema.String,
}) {}

// The backend boundary: an Effect service. Each host provides it with a Layer.
interface Todos {
  readonly get: (id: string) => Effect.Effect<Todo, TodoNotFound>;
  readonly toggle: (id: string) => Effect.Effect<Todo, TodoNotFound>;
}
const Todos = Context.Service<Todos>("Todos");

const rows = new Map<string, Todo>([["1", { id: "1", title: "Try Arc", done: false }]]);
const find = (id: string): Effect.Effect<Todo, TodoNotFound> => {
  const todo = rows.get(id);
  return todo === undefined ? Effect.fail(new TodoNotFound({ id })) : Effect.succeed(todo);
};
export const TodosMemory = Layer.succeed(Todos, {
  get: find,
  toggle: (id) =>
    find(id).pipe(
      Effect.map((todo) => ({ ...todo, done: !todo.done })),
      Effect.tap((todo) => Effect.sync(() => rows.set(id, todo))),
    ),
});

// A Resource: a named, cached, typed read.
const TodoById = Resource.define({
  name: "Todos.byId",
  input: Schema.String,
  output: Todo,
  error: TodoNotFound,
  load: (id) => Todos.use((todos) => todos.get(id)),
});

// An Action: a named write. The checkbox flips at once; a failure rolls it back.
const ToggleTodo = Action.define({
  name: "Todos.toggle",
  input: Schema.String,
  output: Todo,
  optimistic: (id, transaction) =>
    transaction.set(TodoById(id), (todo) => ({ ...todo, done: !todo.done })),
  run: (id) => Todos.use((todos) => todos.toggle(id)),
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

// One definition for both hosts. Without TodosMemory, this line does not compile.
export const app = App.define({ root: Root, routes, actions: [ToggleTodo], client: TodosMemory });
