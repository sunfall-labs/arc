import { Action, Resource } from "@sunfall/arc-core";
import { createRequestHandler } from "@sunfall/arc-start";
import { Context, Effect, Layer } from "effect";
import { app, TodoById, TodoNotFound, ToggleTodo, type Todo } from "./app.js";

// The backend: an Effect service the server Layer provides (a database in a real app).
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

// What the server runs for the Resource and the Action, checked against their schemas.
export const implementations = [
  Resource.implement(TodoById, (id) => Todos.use((todos) => todos.get(id))),
  Action.implement(ToggleTodo, (id) => Todos.use((todos) => todos.toggle(id))),
];

// Server rendering: runs the route's preload, renders, and streams the hydration
// payload; serves the load and the Action. Without TodosMemory, this does not compile.
export const handleRequest = createRequestHandler(app, { server: TodosMemory, implementations });
