import { Action, makeRuntime, Resource } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Context, Effect, Schema, Stream } from "effect";
import { KeyValueStore } from "effect/persistence";

type Assert<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const Todo = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  done: Schema.Boolean,
  labels: Schema.Array(Schema.String),
});
type Todo = typeof Todo.Type;

interface TodoApi {
  readonly list: (owner: string) => Effect.Effect<ReadonlyArray<Todo>, "offline">;
}
const TodoApi = Context.Service<TodoApi>("type-tests/TodoApi");
interface TodoFeed {
  readonly changes: (
    owner: string,
  ) => Stream.Stream<ReadonlyArray<Resource.RowChange<Todo, number>>, "dropped">;
}
const TodoFeed = Context.Service<TodoFeed>("type-tests/TodoFeed");

// `rows` callbacks are typed by the output's element; the key type is inferred.
const Todos = Resource.define({
  name: "type-tests/rows/todos",
  input: Schema.String,
  output: Schema.Array(Todo),
  rows: {
    key: (todo) => todo.id,
    indexes: {
      done: (todo) => todo.done,
      label: (todo) => todo.labels,
    },
    // The change feed's services join the family's R.
    changes: (owner) => Stream.unwrap(TodoFeed.use((feed) => Effect.succeed(feed.changes(owner)))),
  },
  load: (owner) => TodoApi.use((api) => api.list(owner)),
});

type TodosRows = Resource.Rows<typeof Todos>;
type _rowsRow = Assert<Eq<TodosRows["row"], Todo>>;
type _rowsKey = Assert<Eq<TodosRows["key"], number>>;
type _rowsIndexes = Assert<Eq<keyof TodosRows["indexes"], "done" | "label">>;
type _rowsFeed = Assert<Eq<TodosRows["feed"], true>>;

// The ref carries the rows spec, and R covers both the load and the feed.
type TodosRef = ReturnType<typeof Todos>;
type _refR = Assert<
  Eq<TodosRef extends Resource.Ref<any, any, any, infer R> ? R : never, TodoApi | TodoFeed>
>;
type _refError = Assert<
  Eq<TodosRef extends Resource.Ref<any, any, infer E, any> ? E : never, "offline">
>;

// A family without `rows` records none.
const TodoCount = Resource.define({
  name: "type-tests/rows/count",
  input: Schema.String,
  output: Schema.Number,
  load: () => Effect.succeed(0),
});
type _noRows = Assert<Eq<Resource.Rows<typeof TodoCount>, never>>;

// An output-only family (input from `load`) takes `rows` too.
const Recent = Resource.define({
  name: "type-tests/rows/recent",
  output: Schema.Array(Todo),
  rows: { key: (todo) => String(todo.id) },
  load: (_: void) => Effect.succeed([] as ReadonlyArray<Todo>),
});
type _recentKey = Assert<Eq<Resource.Rows<typeof Recent>["key"], string>>;
// Without `rows.changes` the family records no feed.
type _recentFeed = Assert<Eq<Resource.Rows<typeof Recent>["feed"], false>>;

// A feed that needs no services still records one, and adds nothing to R.
const Pushed = Resource.define({
  name: "type-tests/rows/pushed",
  output: Schema.Array(Todo),
  rows: {
    key: (todo) => todo.id,
    changes: () => Stream.empty as Stream.Stream<ReadonlyArray<Resource.RowChange<Todo, number>>>,
  },
  load: (_: void) => Effect.succeed([] as ReadonlyArray<Todo>),
});
type _pushedFeed = Assert<Eq<Resource.Rows<typeof Pushed>["feed"], true>>;
type _pushedR = Assert<
  Eq<ReturnType<typeof Pushed> extends Resource.Ref<any, any, any, infer R> ? R : never, never>
>;
type _recentR = Assert<
  Eq<ReturnType<typeof Recent> extends Resource.Ref<any, any, any, infer R> ? R : never, never>
>;
// Typed failures retry until the feed recovers: only a defect stops it.
type _stoppedReason = Assert<
  Eq<Extract<Resource.FeedStatus, { readonly _tag: "Stopped" }>["reason"], "Defect">
>;
const pushedFeed: ReturnType<typeof Resource.feed> = Resource.feed(Pushed());
void pushedFeed;

// Reader lookups: keys and index values come from `rows`.
Component.define("TodoRows", function* () {
  const todos = yield* Component.resource(Todos);
  return () => {
    const first: Todo | undefined = todos.get("me", 1);
    const done: ReadonlyArray<Todo> = todos.index("me", "done", true);
    const urgent: ReadonlyArray<Todo> = todos.index("me", "label", "urgent");
    // @ts-expect-error keys are numbers
    todos.get("me", "1");
    // @ts-expect-error "done" holds booleans
    todos.index("me", "done", "yes");
    // The feed status joins the reader only for a family with `rows.changes`.
    const feed: Resource.FeedStatus = todos.feed("me");
    const paused = feed._tag === "Retrying" ? feed.attempt : feed._tag === "Stopped";
    return [first?.title, done.length, urgent.length, paused].join();
  };
});

Component.define("RecentRows", function* () {
  const recent = yield* Component.resource(Recent);
  return () => {
    // @ts-expect-error a family without `rows.changes` has no feed status
    recent.feed();
    return recent().length;
  };
});

// Optimistic row patches: insert full rows, update by key with a partial or
// a pure updater, delete by key.
Action.define({
  name: "type-tests/rows/complete",
  input: Schema.Number,
  run: () => Effect.void,
  optimistic: (id, transaction) =>
    Effect.all([
      transaction.update(Todos("me"), id, { done: true }),
      transaction.update(Todos("me"), id, (todo) => ({ ...todo, title: todo.title.trim() })),
      transaction.insert(Todos("me"), { id: 9, title: "New", done: false, labels: [] }),
      transaction.delete(Todos("me"), id),
      // Whole-value patches work on a rows Resource too.
      transaction.set(Todos("me"), (todos) => todos.filter((todo) => !todo.done)),
      // @ts-expect-error an update cannot add fields the row does not have
      transaction.update(Todos("me"), id, { owner: "me" }),
      // @ts-expect-error a family without rows has no row patches
      transaction.delete(TodoCount("me"), id),
    ]),
});

// `policy.persist` adds the runtime's KeyValueStore to the family's services,
// so a runtime without one does not compile.
const PersistedTodos = Resource.define({
  name: "type-tests/rows/persisted",
  input: Schema.String,
  output: Schema.Array(Todo),
  rows: { key: (todo) => todo.id },
  policy: { persist: { key: "todos" } },
  load: () => Effect.succeed([] as ReadonlyArray<Todo>),
});
type _persistR = Assert<
  Eq<
    ReturnType<typeof PersistedTodos> extends Resource.Ref<any, any, any, infer R> ? R : never,
    KeyValueStore.KeyValueStore
  >
>;
// Persistence on a load-inferred family is typed the same way.
const PersistedCount = Resource.define({
  name: "type-tests/rows/persisted-count",
  input: Schema.String,
  policy: { persist: { key: "count", version: 2 } },
  load: () => Effect.succeed(1),
});
type _persistCountR = Assert<
  Eq<
    ReturnType<typeof PersistedCount> extends Resource.Ref<any, any, any, infer R> ? R : never,
    KeyValueStore.KeyValueStore
  >
>;

const PersistedList = Component.define("PersistedList", function* () {
  const todos = yield* Component.resource(PersistedTodos);
  return () => todos("me").length;
});
declare const root: HTMLElement;
// @ts-expect-error a persisted Resource needs the runtime's KeyValueStore
Component.launch(PersistedList, root, { runtime: makeRuntime() });
Component.launch(PersistedList, root, { runtime: makeRuntime(KeyValueStore.layerMemory) });
