import { Action, makeRuntime, State, StateRefTypeId, Signal } from "@sunfall/arc-core";
import { Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { createEffect, createRoot, flush, mapArray } from "solid-js";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { bindInInstance } from "./instance-harness.js";

interface Item {
  readonly id: number;
  readonly label: string;
}

interface Board {
  readonly title: string;
  readonly count: number;
  readonly items: ReadonlyArray<Item>;
}

type BoardMessage =
  | { readonly _tag: "Rename"; readonly title: string }
  | { readonly _tag: "Increment" }
  | { readonly _tag: "Relabel"; readonly id: number; readonly label: string }
  | { readonly _tag: "Replace"; readonly items: ReadonlyArray<Item> };

const items = (...ids: ReadonlyArray<number>): ReadonlyArray<Item> =>
  ids.map((id) => ({ id, label: `item ${id}` }));

const BoardState = State.define<Board, BoardMessage>()({
  name: "BoardState",
  initial: { title: "Board", count: 0, items: items(1, 2, 3) },
  on: {
    Rename: (model, message) => ({ ...model, title: message.title }),
    Increment: (model) => ({ ...model, count: model.count + 1 }),
    Relabel: (model, message) => ({
      ...model,
      items: model.items.map((item) =>
        item.id === message.id ? { ...item, label: message.label } : item,
      ),
    }),
    Replace: (model, message) => ({ ...model, items: message.items }),
  },
});

type Handle<Model, Message extends State.TaggedMessage> = Component.StateHandle<
  Model,
  Message,
  never
>;

interface Mounted<Model, Message extends State.TaggedMessage> {
  readonly handle: Handle<Model, Message>;
  /** Dispatches, waits for the commit, and flushes Solid. */
  readonly send: (message: Parameters<Handle<Model, Message>["dispatch"]>[0]) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

/** Binds `Component.state` in an instance under a Solid root, running `setup` in the same owner. */
const mount = <Model, Message extends State.TaggedMessage>(
  definition: State.Definition<Model, Message>,
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

    await send({ _tag: "Increment" });
    expect(handle.model().count).toBe(1);
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([1, 2, 1]);

    await send({ _tag: "Rename", title: "Roadmap" });
    expect(handle.model().title).toBe("Roadmap");
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([2, 2, 1]);

    await send({ _tag: "Relabel", id: 2, label: "two" });
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
    expect([...labelRuns]).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);

    await send({ _tag: "Relabel", id: 2, label: "two" });
    expect(handle.model().items[1]?.label).toBe("two");
    expect(handle.model().items[1]).toBe(second);
    expect([...labelRuns]).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);

    // Reorder: surviving items keep their view identity, nothing re-renders.
    await send({ _tag: "Replace", items: [...handle.committed.get().items].reverse() });
    expect(handle.model().items).toEqual([third, second, first]);
    expect(handle.model().items[0]).toBe(third);
    expect(handle.model().items[2]).toBe(first);
    expect(mapped).toBe(3);
    expect([...labelRuns]).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);

    // Insert and remove by key: survivors keep identity, only the new item maps.
    await send({ _tag: "Replace", items: [...items(4), ...items(3, 1)] });
    expect(handle.model().items.map((item) => item.id)).toEqual([4, 3, 1]);
    expect(handle.model().items[1]).toBe(third);
    expect(handle.model().items[2]).toBe(first);
    expect(mapped).toBe(4);
    expect(labelRuns.get(3)).toBe(1);
    await dispose();
  });

  it("isolates instances of one State that share model objects", async () => {
    let secondRuns = () => 0;
    const first = mount(BoardState);
    const second = mount(BoardState, (handle) => {
      secondRuns = counter(() => handle.model().items[0]?.label);
    });
    await first.send({ _tag: "Relabel", id: 1, label: "first only" });
    expect(first.handle.model().items[0]?.label).toBe("first only");
    expect(second.handle.model().items[0]?.label).toBe("item 1");
    expect(secondRuns()).toBe(1);
    await first.dispose();
    await second.dispose();
  });

  it("reconciles by a configured key, or positionally with key null", async () => {
    interface Tag {
      readonly slug: string;
      readonly label: string;
    }
    type TagMessage = { readonly _tag: "Set"; readonly tags: ReadonlyArray<Tag> };
    const Tags = State.define<ReadonlyArray<Tag>, TagMessage>()({
      name: "Tags",
      initial: [
        { slug: "a", label: "A" },
        { slug: "b", label: "B" },
      ],
      on: { Set: (_model, message) => message.tags },
    });
    const reversed: ReadonlyArray<Tag> = [
      { slug: "b", label: "B" },
      { slug: "a", label: "A" },
    ];

    const bySlug = mount(Tags, undefined, { key: "slug" });
    const [a, b] = bySlug.handle.model();
    await bySlug.send({ _tag: "Set", tags: reversed });
    expect(bySlug.handle.model()[0]).toBe(b);
    expect(bySlug.handle.model()[1]).toBe(a);
    await bySlug.dispose();

    const byPosition = mount(Tags, undefined, { key: null });
    const [first] = byPosition.handle.model();
    await byPosition.send({ _tag: "Set", tags: reversed });
    expect(byPosition.handle.model()[0]).toBe(first);
    expect(byPosition.handle.model()[0]?.slug).toBe("b");
    await byPosition.dispose();
  });

  it("supports primitive and nullable models", async () => {
    const Counter = State.define<number, { readonly _tag: "Increment" }>()({
      name: "Counter",
      initial: 0,
      on: { Increment: (model) => model + 1 },
    });
    let counterRuns = () => 0;
    const counted = mount(Counter, (handle) => {
      counterRuns = counter(handle.model);
    });
    await counted.send({ _tag: "Increment" });
    await counted.send({ _tag: "Increment" });
    expect(counted.handle.model()).toBe(2);
    expect(counterRuns()).toBe(3);
    await counted.dispose();

    type Selection = { readonly id: number } | null;
    const Select = State.define<
      Selection,
      { readonly _tag: "Select"; readonly id: number | null }
    >()({
      name: "Select",
      initial: null,
      on: { Select: (_model, message) => (message.id === null ? null : { id: message.id }) },
    });
    let selectedRuns = () => 0;
    const selected = mount(Select, (handle) => {
      selectedRuns = counter(() => handle.model()?.id);
    });
    expect(selected.handle.model()).toBeNull();
    await selected.send({ _tag: "Select", id: 1 });
    expect(selected.handle.model()?.id).toBe(1);
    await selected.send({ _tag: "Select", id: null });
    expect(selected.handle.model()).toBeNull();
    expect(selectedRuns()).toBe(3);
    await selected.dispose();
  });

  it("serves Dates and Maps as leaves shared with the Arc model", async () => {
    interface Schedule {
      readonly at: Date;
      readonly owners: ReadonlyMap<string, string>;
      readonly note: string;
    }
    const Scheduled = State.define<Schedule, { readonly _tag: "Note"; readonly note: string }>()({
      name: "Scheduled",
      initial: { at: new Date(0), owners: new Map([["a", "Ada"]]), note: "" },
      on: { Note: (model, message) => ({ ...model, note: message.note }) },
    });
    let atRuns = () => 0;
    const { handle, send, dispose } = mount(Scheduled, (handle) => {
      atRuns = counter(() => handle.model().at);
    });
    const committed = Signal.peek(handle.committed);
    expect(handle.model().at).toBe(committed.at);
    expect(handle.model().owners).toBe(committed.owners);
    await send({ _tag: "Note", note: "moved" });
    expect(handle.model().note).toBe("moved");
    expect(atRuns()).toBe(1);
    await dispose();
  });

  it("stops projecting when the owning component is disposed", async () => {
    let countRuns = () => 0;
    const { handle, send, dispose } = mount(BoardState, (handle) => {
      countRuns = counter(() => handle.model().count);
    });
    await send({ _tag: "Increment" });
    expect(countRuns()).toBe(2);

    await dispose();
    const exit = await Effect.runPromiseExit(handle.dispatch({ _tag: "Increment" }));
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

describe("Component.state send", () => {
  const MenuOpen = State.define({
    name: "Menu.open",
    initial: false,
    on: { Toggle: (open) => !open },
  });

  it("binds a message without fields straight to an event, ignoring the event", async () => {
    let openRuns = () => 0;
    const { handle, dispose } = mount(MenuOpen, (handle) => {
      openRuns = counter(() => handle.model());
    });
    expect(handle.model()).toBe(false);

    handle.send.Toggle(new Event("click"));
    await settle();
    expect(handle.model()).toBe(true);
    expect(openRuns()).toBe(2);

    handle.send.Toggle();
    await settle();
    expect(handle.model()).toBe(false);
    expect(handle.failures()).toEqual([]);
    await dispose();
  });

  it("sends a message's fields", async () => {
    const Search = State.define({
      name: "Search",
      initial: "",
      on: {
        Search: (_query, message: { readonly query: string }) => message.query,
        Clear: () => "",
      },
    });
    const { handle, dispose } = mount(Search);
    handle.send.Search({ query: "atlas" });
    await settle();
    expect(handle.model()).toBe("atlas");
    expect(Signal.peek(handle.committed)).toBe("atlas");
    handle.send.Clear();
    await settle();
    expect(handle.model()).toBe("");
    await dispose();
  });

  it("reports a failing handler through failures()", async () => {
    const Broken = State.define({
      name: "Broken",
      initial: 0,
      on: {
        Break: (): number => {
          throw new Error("boom");
        },
      },
    });
    const { handle, dispose } = mount(Broken);
    handle.send.Break();
    await settle();
    expect(handle.failures()).toHaveLength(1);
    expect(handle.failures()[0]).toMatchObject({ _tag: "StateFailure", phase: "Update" });
    await dispose();
  });
});

describe("Component.state with an app State", () => {
  type Toast = { readonly text: string | null };
  type ToastMessage =
    | { readonly _tag: "Show"; readonly text: string }
    | { readonly _tag: "Expire"; readonly text: string };

  const makeToast = () =>
    State.define<Toast, ToastMessage>()({
      name: "Shell.toast",
      scope: "app",
      initial: { text: null },
      on: {
        // The expiry command must outlive the binding that sent `Show`.
        Show: (_model, message) =>
          State.next(
            { text: message.text },
            State.emit(
              Effect.sleep("20 millis").pipe(
                Effect.as({ _tag: "Expire", text: message.text } as const),
              ),
            ),
          ),
        Expire: (model, message) => (model.text === message.text ? { text: null } : model),
      },
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

    board.handle.send.Show({ text: "Issue deleted" });
    await settle();
    expect(shell.handle.model().text).toBe("Issue deleted");

    // Unmounting the binding that sent the message neither stops the State
    // nor interrupts the command it started.
    board.dispose();
    await Effect.runPromise(Effect.sleep("40 millis"));
    flush();
    expect(shell.handle.model().text).toBeNull();

    // Another runtime (another request, another app) has its own instance.
    const other = makeRuntime();
    const elsewhere = bind(other, Toast);
    expect(elsewhere.handle[StateRefTypeId]).not.toBe(shell.handle[StateRefTypeId]);
    expect(elsewhere.handle.model().text).toBeNull();

    // Disposing the runtime stops it.
    shell.dispose();
    await Effect.runPromise(runtime.dispose);
    const exit = await Effect.runPromiseExit(shell.handle.dispatch({ _tag: "Show", text: "late" }));
    expect(Exit.isFailure(exit)).toBe(true);
    elsewhere.dispose();
    await Effect.runPromise(other.dispose);
  });

  it("is an optimistic patch target every binding sees", async () => {
    const Toast = makeToast();
    const runtime = makeRuntime();
    const first = bind(runtime, Toast);
    const second = bind(runtime, Toast);
    const release = Effect.runSync(Deferred.make<void>());
    const Remove = Action.define({
      name: "AppState.remove",
      input: Schema.String,
      optimistic: (text, transaction) => transaction.set(first.handle, { text }),
      run: () => Deferred.await(release),
    });
    const submission = runtime.runFork(Action.use(Remove, { runtime }).submit("Undo?"));
    await settle();
    expect(second.handle.model().text).toBe("Undo?");

    // Success folds the patch into the shared model.
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(submission));
    flush();
    expect(second.handle.model().text).toBe("Undo?");
    first.dispose();
    second.dispose();
    await Effect.runPromise(runtime.dispose);
  });
});
