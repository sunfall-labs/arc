import { makeRuntime, Program, Signal } from "@sunfall/arc-core";
import { Effect, Exit } from "effect";
import { createEffect, createRoot, flush, mapArray } from "solid-js";
import { describe, expect, it } from "vitest";
import { useProgram, type ProgramHandle, type UseProgramOptions } from "../src/index.js";
import { withRuntimeContext } from "./with-runtime-context.js";

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

const BoardProgram = Program.define<Board, BoardMessage>({
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

type Handle<Model, Message> = ProgramHandle<
  Model,
  Message,
  Program.RuntimeError<never>,
  Program.DispatchError<never>
>;

interface Mounted<Model, Message> {
  readonly program: Handle<Model, Message>;
  /** Dispatches, waits for the commit, and flushes Solid. */
  readonly send: (message: Parameters<Handle<Model, Message>["dispatch"]>[0]) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

/** Mounts `useProgram` in a Solid root, running `setup` in the same owner. */
const mount = <Model, Message>(
  definition: Program.Definition<Model, Message>,
  setup: (program: Handle<Model, Message>) => void = () => {},
  options?: UseProgramOptions,
): Mounted<Model, Message> => {
  const runtime = makeRuntime();
  let disposeRoot: () => void = () => {};
  const program = createRoot((dispose) =>
    withRuntimeContext(runtime, () => {
      disposeRoot = dispose;
      const handle = useProgram(definition, options);
      setup(handle);
      return handle;
    }),
  );
  flush();
  return {
    program,
    send: async (message) => {
      await Effect.runPromise(program.dispatchEffect(message));
      flush();
    },
    dispose: async () => {
      disposeRoot();
      await Effect.runPromise(runtime.disposeEffect);
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

describe("useProgram fine-grained model", () => {
  it("re-runs a reader only when the field it reads changes", async () => {
    let titleRuns = () => 0;
    let countRuns = () => 0;
    let rootRuns = () => 0;
    const { program, send, dispose } = mount(BoardProgram, (handle) => {
      titleRuns = counter(() => handle.model().title);
      countRuns = counter(() => handle.model().count);
      rootRuns = counter(() => handle.model());
    });
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([1, 1, 1]);

    await send({ _tag: "Increment" });
    expect(program.model().count).toBe(1);
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([1, 2, 1]);

    await send({ _tag: "Rename", title: "Roadmap" });
    expect(program.model().title).toBe("Roadmap");
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([2, 2, 1]);

    await send({ _tag: "Relabel", id: 2, label: "two" });
    expect([titleRuns(), countRuns(), rootRuns()]).toEqual([2, 2, 1]);
    await dispose();
  });

  it("re-runs only the list items that changed and keeps item identity by key", async () => {
    const labelRuns = new Map<number, number>();
    let mapped = 0;
    const { program, send, dispose } = mount(BoardProgram, (handle) => {
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
    const [first, second, third] = program.model().items;
    expect(mapped).toBe(3);
    expect([...labelRuns]).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);

    await send({ _tag: "Relabel", id: 2, label: "two" });
    expect(program.model().items[1]?.label).toBe("two");
    expect(program.model().items[1]).toBe(second);
    expect([...labelRuns]).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);

    // Reorder: surviving items keep their view identity, nothing re-renders.
    await send({ _tag: "Replace", items: [...program.instance.model.get().items].reverse() });
    expect(program.model().items).toEqual([third, second, first]);
    expect(program.model().items[0]).toBe(third);
    expect(program.model().items[2]).toBe(first);
    expect(mapped).toBe(3);
    expect([...labelRuns]).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);

    // Insert and remove by key: survivors keep identity, only the new item maps.
    await send({ _tag: "Replace", items: [...items(4), ...items(3, 1)] });
    expect(program.model().items.map((item) => item.id)).toEqual([4, 3, 1]);
    expect(program.model().items[1]).toBe(third);
    expect(program.model().items[2]).toBe(first);
    expect(mapped).toBe(4);
    expect(labelRuns.get(3)).toBe(1);
    await dispose();
  });

  it("isolates instances of one Program that share model objects", async () => {
    let secondRuns = () => 0;
    const first = mount(BoardProgram);
    const second = mount(BoardProgram, (handle) => {
      secondRuns = counter(() => handle.model().items[0]?.label);
    });
    await first.send({ _tag: "Relabel", id: 1, label: "first only" });
    expect(first.program.model().items[0]?.label).toBe("first only");
    expect(second.program.model().items[0]?.label).toBe("item 1");
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
    const Tags = Program.define<ReadonlyArray<Tag>, TagMessage>({
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
    const [a, b] = bySlug.program.model();
    await bySlug.send({ _tag: "Set", tags: reversed });
    expect(bySlug.program.model()[0]).toBe(b);
    expect(bySlug.program.model()[1]).toBe(a);
    await bySlug.dispose();

    const byPosition = mount(Tags, undefined, { key: null });
    const [first] = byPosition.program.model();
    await byPosition.send({ _tag: "Set", tags: reversed });
    expect(byPosition.program.model()[0]).toBe(first);
    expect(byPosition.program.model()[0]?.slug).toBe("b");
    await byPosition.dispose();
  });

  it("supports primitive and nullable models", async () => {
    const Counter = Program.define<number, { readonly _tag: "Increment" }>({
      initial: 0,
      on: { Increment: (model) => model + 1 },
    });
    let counterRuns = () => 0;
    const counted = mount(Counter, (handle) => {
      counterRuns = counter(handle.model);
    });
    await counted.send({ _tag: "Increment" });
    await counted.send({ _tag: "Increment" });
    expect(counted.program.model()).toBe(2);
    expect(counterRuns()).toBe(3);
    await counted.dispose();

    type Selection = { readonly id: number } | null;
    const Select = Program.define<
      Selection,
      { readonly _tag: "Select"; readonly id: number | null }
    >({
      initial: null,
      on: { Select: (_model, message) => (message.id === null ? null : { id: message.id }) },
    });
    let selectedRuns = () => 0;
    const selected = mount(Select, (handle) => {
      selectedRuns = counter(() => handle.model()?.id);
    });
    expect(selected.program.model()).toBeNull();
    await selected.send({ _tag: "Select", id: 1 });
    expect(selected.program.model()?.id).toBe(1);
    await selected.send({ _tag: "Select", id: null });
    expect(selected.program.model()).toBeNull();
    expect(selectedRuns()).toBe(3);
    await selected.dispose();
  });

  it("serves Dates and Maps as leaves shared with the Arc model", async () => {
    interface Schedule {
      readonly at: Date;
      readonly owners: ReadonlyMap<string, string>;
      readonly note: string;
    }
    const Scheduled = Program.define<Schedule, { readonly _tag: "Note"; readonly note: string }>({
      initial: { at: new Date(0), owners: new Map([["a", "Ada"]]), note: "" },
      on: { Note: (model, message) => ({ ...model, note: message.note }) },
    });
    let atRuns = () => 0;
    const { program, send, dispose } = mount(Scheduled, (handle) => {
      atRuns = counter(() => handle.model().at);
    });
    const committed = Signal.peek(program.instance.model);
    expect(program.model().at).toBe(committed.at);
    expect(program.model().owners).toBe(committed.owners);
    await send({ _tag: "Note", note: "moved" });
    expect(program.model().note).toBe("moved");
    expect(atRuns()).toBe(1);
    await dispose();
  });

  it("stops projecting when the owning component is disposed", async () => {
    let countRuns = () => 0;
    const { program, send, dispose } = mount(BoardProgram, (handle) => {
      countRuns = counter(() => handle.model().count);
    });
    await send({ _tag: "Increment" });
    expect(countRuns()).toBe(2);

    await dispose();
    const exit = await Effect.runPromiseExit(program.dispatchEffect({ _tag: "Increment" }));
    flush();
    expect(Exit.isFailure(exit)).toBe(true);
    expect(countRuns()).toBe(2);
    expect(Signal.peek(program.instance.model).count).toBe(1);
  });
});
