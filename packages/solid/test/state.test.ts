import {
  Action,
  Message,
  Machine,
  makeRuntime,
  Model,
  State,
  StateRefTypeId,
  Signal,
} from "@sunfall/arc-core";
import { Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { createEffect, createRoot, flush, mapArray } from "solid-js";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { reactive } from "./component-ssr-fixture.js";
import { bindInInstance } from "./instance-harness.js";

const Item = Schema.Struct({ id: Schema.Finite, label: Schema.String });
type Item = typeof Item.Type;

const items = (...ids: ReadonlyArray<number>): ReadonlyArray<Item> =>
  ids.map((id) => ({ id, label: `item ${id}` }));

const BoardModel = Model({
  Board: { title: Schema.String, count: Schema.Finite, items: Schema.Array(Item) },
});
const BoardEvent = Message({
  RenamedBoard: { title: Schema.String },
  Incremented: {},
  RelabeledItem: { id: Schema.Finite, label: Schema.String },
  ReplacedItems: { items: Schema.Array(Item) },
});

const BoardState = State.define({
  name: "BoardState",
  machine: Machine.make({
    state: BoardModel,
    event: BoardEvent,
    initial: BoardModel.Board({ title: "Board", count: 0, items: items(1, 2, 3) }),
  })
    .onAny(BoardEvent.RenamedBoard, ({ state, event }) =>
      BoardModel.Board({ ...state, title: event.title }),
    )
    .onAny(BoardEvent.Incremented, ({ state }) =>
      BoardModel.Board({ ...state, count: state.count + 1 }),
    )
    .onAny(BoardEvent.RelabeledItem, ({ state, event }) =>
      BoardModel.Board({
        ...state,
        items: state.items.map((item) =>
          item.id === event.id ? { ...item, label: event.label } : item,
        ),
      }),
    )
    .onAny(BoardEvent.ReplacedItems, ({ state, event }) =>
      BoardModel.Board({ ...state, items: event.items }),
    ),
});

type Handle<Model extends State.Tagged, Message extends State.Tagged> = Component.StateHandle<
  Model,
  Message
>;

interface Mounted<Model extends State.Tagged, Message extends State.Tagged> {
  readonly handle: Handle<Model, Message>;
  /** Dispatches, waits for the commit, and flushes Solid. */
  readonly send: (message: Message) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

/** Binds `Component.state` in an instance under a Solid root, running `setup` in the same owner. */
const mount = <Model extends State.Tagged, Message extends State.Tagged, R>(
  definition: State.Definition<Model, Message, R>,
  setup: (handle: Handle<Model, Message>) => void = () => {},
  options?: Component.StateOptions,
): Mounted<Model, Message> => {
  const runtime = makeRuntime();
  let disposeRoot: () => void = () => {};
  const handle = createRoot((dispose) => {
    disposeRoot = dispose;
    const handle = bindInInstance(runtime, Component.state(definition, options));
    setup(handle);
    return handle;
  });
  flush();
  return {
    handle,
    send: async (message) => {
      await Effect.runPromise(handle.dispatch(message));
      flush();
    },
    dispose: async () => {
      disposeRoot();
      await Effect.runPromise(runtime.dispose);
    },
  };
};

/** Counts tracked runs of `read`. */
const counter = (read: () => unknown): (() => number) => {
  let runs = 0;
  createEffect(
    () => {
      runs++;
      return read();
    },
    () => {},
  );
  return () => runs;
};

describe("Component.state fine-grained model", () => {
  it("re-runs a reader only when the field it reads changes", async () => {
    let titleRuns = () => 0;
    let countRuns = () => 0;
    let rootRuns = () => 0;
    const { handle, send, dispose } = mount(BoardState, (handle) => {
      titleRuns = counter(() => handle.model().title);
      countRuns = counter(() => handle.model().count);
      rootRuns = counter(() => handle.model());
    });
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([1, 1, 1]);

    await send(BoardEvent.Incremented);
    expect(handle.model().count).toBe(1);
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([1, 2, 1]);

    await send(BoardEvent.RenamedBoard({ title: "Roadmap" }));
    expect(handle.model().title).toBe("Roadmap");
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([2, 2, 1]);

    await send(BoardEvent.RelabeledItem({ id: 2, label: "two" }));
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([2, 2, 1]);
    await dispose();
  });

  it("re-runs only the list items that changed and keeps item identity by key", async () => {
    const labelRuns = new Map<number, number>();
    let mapped = 0;
    const { handle, send, dispose } = mount(BoardState, (handle) => {
      const rows = mapArray(
        () => handle.model().items,
        (item) => {
          mapped++;
          createEffect(
            () => {
              labelRuns.set(item.id, (labelRuns.get(item.id) ?? 0) + 1);
              return item.label;
            },
            () => {},
          );
          return item;
        },
      );
      createEffect(rows, () => {});
    });
    const [first, second, third] = handle.model().items;
    expect(mapped).toBe(3);

    await send(BoardEvent.RelabeledItem({ id: 2, label: "two" }));
    expect(handle.model().items[1]?.label).toBe("two");
    expect(handle.model().items[1]).toBe(second);
    expect([...labelRuns]).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);

    // Reorder: surviving items keep their view identity, nothing re-renders.
    await send(BoardEvent.ReplacedItems({ items: [...handle.committed.get().items].reverse() }));
    expect(handle.model().items).toEqual([third, second, first]);
    expect(handle.model().items[0]).toBe(third);
    expect(mapped).toBe(3);

    // Insert and remove by key: survivors keep identity, only the new item maps.
    await send(BoardEvent.ReplacedItems({ items: [...items(4), ...items(3, 1)] }));
    expect(handle.model().items.map((item) => item.id)).toEqual([4, 3, 1]);
    expect(handle.model().items[1]).toBe(third);
    expect(mapped).toBe(4);
    expect(labelRuns.get(3)).toBe(1);
    await dispose();
  });

  it("isolates instances of one State", async () => {
    let secondRuns = () => 0;
    const first = mount(BoardState);
    const second = mount(BoardState, (handle) => {
      secondRuns = counter(() => handle.model().items[0]?.label);
    });
    await first.send(BoardEvent.RelabeledItem({ id: 1, label: "first only" }));
    expect(first.handle.model().items[0]?.label).toBe("first only");
    expect(second.handle.model().items[0]?.label).toBe("item 1");
    expect(secondRuns()).toBe(1);
    await first.dispose();
    await second.dispose();
  });

  it("reconciles by a configured key, or positionally with key null", async () => {
    const Tag = Schema.Struct({ slug: Schema.String, label: Schema.String });
    const TagsModel = Model({ Tags: { tags: Schema.Array(Tag) } });
    const TagsEvent = Message({ ReplacedTags: { tags: Schema.Array(Tag) } });
    const Tags = State.define({
      name: "Tags",
      machine: Machine.make({
        state: TagsModel,
        event: TagsEvent,
        initial: TagsModel.Tags({
          tags: [
            { slug: "a", label: "A" },
            { slug: "b", label: "B" },
          ],
        }),
      }).onAny(TagsEvent.ReplacedTags, ({ event }) => TagsModel.Tags({ tags: event.tags })),
    });
    const reversed = [
      { slug: "b", label: "B" },
      { slug: "a", label: "A" },
    ];

    const bySlug = mount(Tags, undefined, { key: "slug" });
    const [a, b] = bySlug.handle.model().tags;
    await bySlug.send(TagsEvent.ReplacedTags({ tags: reversed }));
    expect(bySlug.handle.model().tags[0]).toBe(b);
    expect(bySlug.handle.model().tags[1]).toBe(a);
    await bySlug.dispose();

    const byPosition = mount(Tags, undefined, { key: null });
    const [first] = byPosition.handle.model().tags;
    await byPosition.send(TagsEvent.ReplacedTags({ tags: reversed }));
    expect(byPosition.handle.model().tags[0]).toBe(first);
    expect(byPosition.handle.model().tags[0]?.slug).toBe("b");
    await byPosition.dispose();
  });

  it("re-runs a variant reader only when the variant changes", async () => {
    const MenuModel = Model({ Closed: {}, Open: {} });
    const MenuEvent = Message({ ClickedMenu: {} });
    const Menu = State.define({
      name: "Menu",
      machine: Machine.make({ state: MenuModel, event: MenuEvent, initial: MenuModel.Closed })
        .on(MenuModel.Closed, MenuEvent.ClickedMenu, () => MenuModel.Open)
        .on(MenuModel.Open, MenuEvent.ClickedMenu, () => MenuModel.Closed),
    });
    let tagRuns = () => 0;
    const menu = mount(Menu, (handle) => {
      tagRuns = counter(() => handle.model()._tag);
    });
    await menu.send(MenuEvent.ClickedMenu);
    await menu.send(MenuEvent.ClickedMenu);
    expect(menu.handle.model()._tag).toBe("Closed");
    expect(tagRuns()).toBe(3);
    await menu.dispose();
  });

  it("stops projecting when the owning component is disposed", async () => {
    let countRuns = () => 0;
    const { handle, send, dispose } = mount(BoardState, (handle) => {
      countRuns = counter(() => handle.model().count);
    });
    await send(BoardEvent.Incremented);
    expect(countRuns()).toBe(2);

    await dispose();
    const exit = await Effect.runPromiseExit(handle.dispatch(BoardEvent.Incremented));
    flush();
    expect(Exit.isFailure(exit)).toBe(true);
    expect(countRuns()).toBe(2);
    expect(Signal.peek(handle.committed).count).toBe(1);
  });
});

/** Waits for queued `send` messages to commit, then flushes Solid. */
const settle = async (): Promise<void> => {
  await Effect.runPromise(Effect.sleep("5 millis"));
  flush();
};

describe("Component.state send and can", () => {
  const MenuModel = Model({ Closed: {}, Open: {} });
  const MenuEvent = Message({ ClickedMenu: {}, PressedEscape: {} });
  const Menu = State.define({
    name: "Menu",
    machine: Machine.make({ state: MenuModel, event: MenuEvent, initial: MenuModel.Closed })
      .on(MenuModel.Closed, MenuEvent.ClickedMenu, () => MenuModel.Open)
      .on(MenuModel.Open, MenuEvent.ClickedMenu, () => MenuModel.Closed)
      .on(MenuModel.Open, MenuEvent.PressedEscape, () => MenuModel.Closed),
  });

  it("binds a message without fields straight to an event, ignoring the event", async () => {
    const { handle, dispose } = mount(Menu);
    expect(handle.model()._tag).toBe("Closed");
    handle.send.ClickedMenu(new Event("click"));
    await settle();
    expect(handle.model()._tag).toBe("Open");
    handle.send.ClickedMenu();
    await settle();
    expect(handle.model()._tag).toBe("Closed");
    expect(handle.failures()).toEqual([]);
    await dispose();
  });

  it("answers can per message, reactively, from the machine's transitions", async () => {
    let escapeRuns: Array<boolean> = [];
    const { handle, dispose } = mount(Menu, (handle) => {
      createEffect(
        () => handle.can.PressedEscape(),
        (can) => {
          escapeRuns.push(can);
        },
      );
    });
    expect(handle.can.ClickedMenu()).toBe(true);
    expect(handle.can.PressedEscape()).toBe(false);
    handle.send.ClickedMenu();
    await settle();
    expect(handle.can.PressedEscape()).toBe(true);
    expect(escapeRuns).toEqual([false, true]);
    escapeRuns = [];
    await dispose();
  });

  it("sends a message's fields", async () => {
    const SearchModel = Model({ Editing: { query: Schema.String } });
    const SearchEvent = Message({ TypedQuery: { text: Schema.String }, ClearedQuery: {} });
    const Search = State.define({
      name: "Search",
      machine: Machine.make({
        state: SearchModel,
        event: SearchEvent,
        initial: SearchModel.Editing({ query: "" }),
      })
        .onAny(SearchEvent.TypedQuery, ({ event }) => SearchModel.Editing({ query: event.text }))
        .onAny(SearchEvent.ClearedQuery, () => SearchModel.Editing({ query: "" })),
    });
    const { handle, dispose } = mount(Search);
    handle.send.TypedQuery({ text: "atlas" });
    await settle();
    expect(handle.model().query).toBe("atlas");
    expect(Signal.peek(handle.committed).query).toBe("atlas");
    handle.send.ClearedQuery();
    await settle();
    expect(handle.model().query).toBe("");
    await dispose();
  });

  it("reports a message its schema rejects through failures()", async () => {
    const { handle, dispose } = mount(Menu);
    await Effect.runPromiseExit(handle.dispatch({ _tag: "Nope" } as never));
    expect(handle.failures()).toHaveLength(1);
    expect(handle.failures()[0]).toMatchObject({ _tag: "StateFailure", phase: "Update" });
    await dispose();
  });
});

describe("Component.state with an app State", () => {
  const ToastModel = Model({ Hidden: {}, Showing: { text: Schema.String } });
  const ToastEvent = Message({ Notified: { text: Schema.String }, ToastExpired: {} });

  const makeToast = () =>
    State.define({
      name: "Shell.toast",
      scope: "app",
      machine: Machine.make({ state: ToastModel, event: ToastEvent, initial: ToastModel.Hidden })
        .reenter([ToastModel.Hidden, ToastModel.Showing], ToastEvent.Notified, ({ event }) =>
          ToastModel.Showing({ text: event.text }),
        )
        .on(ToastModel.Showing, ToastEvent.ToastExpired, () => ToastModel.Hidden)
        // The Showing variant owns its expiry: it must outlive the binding that sent Notified.
        .timeout(ToastModel.Showing, { duration: "20 millis", event: ToastEvent.ToastExpired }),
    });

  /** Binds `definition` in a new instance under its own Solid root. */
  const bind = (runtime: object, definition: ReturnType<typeof makeToast>) => {
    let dispose: () => void = () => {};
    const handle = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return bindInInstance(runtime, Component.state(definition));
    });
    flush();
    return { handle, dispose };
  };

  it("shares one instance per runtime that outlives its bindings", async () => {
    const Toast = makeToast();
    const runtime = makeRuntime();
    const board = bind(runtime, Toast);
    const shell = bind(runtime, Toast);
    expect(board.handle[StateRefTypeId]).toBe(shell.handle[StateRefTypeId]);

    board.handle.send.Notified({ text: "Issue deleted" });
    await settle();
    expect(shell.handle.model()).toMatchObject({ _tag: "Showing", text: "Issue deleted" });

    // Unmounting the binding that sent the message neither stops the State
    // nor interrupts the work its variant owns.
    board.dispose();
    await Effect.runPromise(Effect.sleep("60 millis"));
    flush();
    expect(shell.handle.model()._tag).toBe("Hidden");

    // Another runtime (another request, another app) has its own instance.
    const other = makeRuntime();
    const elsewhere = bind(other, Toast);
    expect(elsewhere.handle[StateRefTypeId]).not.toBe(shell.handle[StateRefTypeId]);
    expect(elsewhere.handle.model()._tag).toBe("Hidden");

    // Disposing the runtime stops it.
    shell.dispose();
    await Effect.runPromise(runtime.dispose);
    const exit = await Effect.runPromiseExit(
      shell.handle.dispatch(ToastEvent.Notified({ text: "late" })),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    elsewhere.dispose();
    await Effect.runPromise(other.dispose);
  });

  it("is an optimistic overlay every binding sees until the submission settles", async () => {
    const Toast = makeToast();
    const runtime = makeRuntime();
    const first = bind(runtime, Toast);
    const second = bind(runtime, Toast);
    const release = Effect.runSync(Deferred.make<void>());
    const Remove = Action.define({
      name: "AppState.remove",
      input: Schema.String,
      optimistic: (text, transaction) =>
        transaction.set(first.handle, ToastModel.Showing({ text })),
      run: () => Deferred.await(release),
    });
    const submission = runtime.runFork(Action.use(Remove, { runtime }).submit("Undo?"));
    await settle();
    expect(second.handle.model()).toMatchObject({ _tag: "Showing", text: "Undo?" });

    // Settled: the overlay is gone; the State changes only through its messages.
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(submission));
    flush();
    expect(second.handle.model()._tag).toBe("Hidden");
    first.dispose();
    second.dispose();
    await Effect.runPromise(runtime.dispose);
  });
});

describe("Component.state with a persisted State", () => {
  it("restores the model from the runtime's KeyValueStore and saves each change", async () => {
    const DraftModel = Model({ Drafting: { text: Schema.String } });
    const DraftMessage = Message({ TypedDraft: { text: Schema.String } });
    const Draft = State.define({
      name: "Draft",
      persist: { key: "draft" },
      machine: Machine.make({
        state: DraftModel,
        event: DraftMessage,
        initial: DraftModel.Drafting({ text: "" }),
      }).onAny(DraftMessage.TypedDraft, ({ event }) => DraftModel.Drafting({ text: event.text })),
    });
    const runtime = makeRuntime(KeyValueStore.layerMemory);
    const store = await Effect.runPromise(
      runtime.provide(
        Effect.gen(function* () {
          return yield* KeyValueStore.KeyValueStore;
        }),
      ),
    );
    await Effect.runPromise(
      store.set("arc/states/v1/draft", JSON.stringify({ _tag: "Drafting", text: "kept" })),
    );
    let dispose: () => void = () => {};
    const handle = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return bindInInstance(runtime, Component.state(Draft));
    });
    await settle();
    expect(handle.model().text).toBe("kept");
    handle.send.TypedDraft({ text: "kept and more" });
    await settle();
    const saved = await Effect.runPromise(store.get("arc/states/v1/draft"));
    expect(JSON.parse(saved as string)).toEqual({ _tag: "Drafting", text: "kept and more" });
    dispose();
    await Effect.runPromise(runtime.dispose);
  });

  it("restores after hydration settles, so the hydrated markup updates", async () => {
    const DraftModel = Model({ Drafting: { text: Schema.String } });
    const DraftMessage = Message({ TypedDraft: { text: Schema.String } });
    const Draft = State.define({
      name: "HydratedDraft",
      persist: { key: "hydrated-draft" },
      machine: Machine.make({
        state: DraftModel,
        event: DraftMessage,
        initial: DraftModel.Drafting({ text: "" }),
      }),
    });
    const View = Component.define("DraftView", function* () {
      const draft = yield* Component.state(Draft);
      return () => reactive(() => `draft:${draft.model().text}`);
    });
    const runtime = makeRuntime(KeyValueStore.layerMemory);
    await Effect.runPromise(
      runtime.provide(
        Effect.gen(function* () {
          const store = yield* KeyValueStore.KeyValueStore;
          yield* store.set(
            "arc/states/v1/hydrated-draft",
            JSON.stringify({ _tag: "Drafting", text: "kept" }),
          );
        }),
      ),
    );
    const hydrationGlobal = globalThis as { _$HY?: unknown };
    hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
    const container = document.createElement("div");
    // What the server rendered: the initial model.
    container.innerHTML = "draft:";
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Component.mount(View as Component<{}, never, never>, container, {
            runtime: runtime as never,
            hydrate: true,
          });
          yield* Effect.sleep("20 millis");
          flush();
          expect(container.textContent).toBe("draft:kept");
        }),
      ),
    );
    delete hydrationGlobal._$HY;
    await Effect.runPromise(runtime.dispose);
  });
});
