import { Effect } from "effect";
import { bench, describe } from "vitest";
import { makeRuntime, Program, Resource, Signal, runWithRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { For, createComponent, createSignal, flush, insert, render } from "./solid-client-shim.js";

// Client render paths: Arc state flowing into DOM updates through the Solid adapter.

interface Row {
  readonly id: number;
  readonly label: string;
}

const makeRows = (count: number, offset = 0): ReadonlyArray<Row> =>
  Array.from({ length: count }, (_, index) => ({ id: offset + index, label: `row ${index}` }));

const mount = (view: () => unknown): { readonly container: HTMLElement; dispose(): void } => {
  const container = document.createElement("div");
  const dispose = render(view as never, container);
  flush();
  return { container, dispose };
};

const textCell = (read: () => string): Node => {
  const element = document.createElement("span");
  insert(element, read as never);
  return element;
};

const expectText = (container: HTMLElement, expected: string): void => {
  if (container.textContent !== expected) {
    throw new Error(`Benchmark rendered unexpected output: ${container.textContent?.slice(0, 80)}`);
  }
};

const runtime = makeRuntime();

describe("Sunfall Arc client render", () => {
  bench("baseline (raw Solid): update every 10th row of 1k", () => {
    const [rows, setRows] = createSignal(makeRows(1000));
    const view = mount(() =>
      createComponent(
        For as never,
        {
          get each() {
            return rows();
          },
          children: (row: Row) => textCell(() => row.label),
        } as never,
      ),
    );
    for (let round = 0; round < 5; round++) {
      setRows((current) =>
        current.map((row, index) =>
          index % 10 === 0 ? { ...row, label: `${row.label} !${round}` } : row,
        ),
      );
      flush();
    }
    expectText(
      view.container,
      rows()
        .map((row) => row.label)
        .join(""),
    );
    view.dispose();
  });

  bench("baseline (raw Solid): 1k readers of one signal, 50 updates", () => {
    const [shared, setShared] = createSignal(0);
    const view = mount(() => Array.from({ length: 1000 }, () => textCell(() => String(shared()))));
    for (let update = 1; update <= 50; update++) {
      setShared(update);
      flush();
    }
    expectText(view.container, "50".repeat(1000));
    view.dispose();
  });

  // Batched variants: real apps write several times per frame and render once.
  // Flushing after every write (above) charges Solid 2's per-flush cost each time.
  bench("baseline (raw Solid): 1k readers of one signal, 50 updates, one flush", () => {
    const [shared, setShared] = createSignal(0);
    const view = mount(() => Array.from({ length: 1000 }, () => textCell(() => String(shared()))));
    for (let update = 1; update <= 50; update++) {
      setShared(update);
    }
    flush();
    expectText(view.container, "50".repeat(1000));
    view.dispose();
  });

  bench("fan-out: 1k components read one shared signal, 50 updates, one flush", () => {
    const shared = Signal.make(0);
    const Reader = () => textCell(() => String(shared.get()));
    const view = mount(() =>
      Array.from({ length: 1000 }, () => createComponent(Reader as never, {})),
    );
    for (let update = 1; update <= 50; update++) {
      shared.set(update);
    }
    flush();
    expectText(view.container, "50".repeat(1000));
    view.dispose();
  });

  bench("keyed list: create 1k rows from an Arc signal", () => {
    const rows = Signal.make(makeRows(1000));
    const view = mount(() => {
      return createComponent(
        For as never,
        {
          get each() {
            return rows.get();
          },
          children: (row: Row) => textCell(() => row.label),
        } as never,
      );
    });
    expectText(
      view.container,
      makeRows(1000)
        .map((row) => row.label)
        .join(""),
    );
    view.dispose();
  });

  bench("keyed list: update every 10th row of 1k", () => {
    const rows = Signal.make(makeRows(1000));
    const view = mount(() => {
      return createComponent(
        For as never,
        {
          get each() {
            return rows.get();
          },
          children: (row: Row) => textCell(() => row.label),
        } as never,
      );
    });
    for (let round = 0; round < 5; round++) {
      rows.set((current) =>
        current.map((row, index) =>
          index % 10 === 0 ? { ...row, label: `${row.label} !${round}` } : row,
        ),
      );
      flush();
    }
    expectText(
      view.container,
      rows
        .get()
        .map((row) => row.label)
        .join(""),
    );
    view.dispose();
  });

  bench("fan-out: 1k components read one shared signal, 50 updates", () => {
    const shared = Signal.make(0);
    const Reader = () => textCell(() => String(shared.get()));
    const view = mount(() =>
      Array.from({ length: 1000 }, () => createComponent(Reader as never, {})),
    );
    for (let update = 1; update <= 50; update++) {
      shared.set(update);
      flush();
    }
    expectText(view.container, "50".repeat(1000));
    view.dispose();
  });

  bench("program: 1k dispatched messages processed and rendered", async () => {
    const Counter = Program.define<number, { readonly _tag: "Increment" }>({
      initial: 0,
      on: { Increment: (model) => model + 1 },
    });
    let counter: Component.ProgramHandle<number, { readonly _tag: "Increment" }, never> | undefined;
    const View = Component.define("CounterView", function* () {
      const handle = yield* Component.program(Counter);
      counter = handle;
      return () => textCell(() => String(handle.model()));
    });
    const view = mount(() => createComponent(Component.embed(View, runtime) as never, {}));
    const dispatchEffect = counter!.dispatch;
    await Effect.runPromise(
      Effect.forEach(Array.from({ length: 1000 }), () => dispatchEffect({ _tag: "Increment" }), {
        discard: true,
      }),
    );
    flush();
    expectText(view.container, "1000");
    view.dispose();
  });

  interface Board {
    readonly rows: ReadonlyArray<Row>;
  }
  type BoardMessage = { readonly _tag: "Relabel"; readonly id: number; readonly label: string };
  const Board = Program.define<Board, BoardMessage>({
    initial: { rows: makeRows(1000) },
    on: {
      Relabel: (model, message) => ({
        rows: model.rows.map((row) =>
          row.id === message.id ? { ...row, label: message.label } : row,
        ),
      }),
    },
  });
  const relabelRounds = 20;
  const expectedBoardText = (): string =>
    makeRows(1000)
      .map((row, index) =>
        index % 50 === 0 && index < relabelRounds * 50 ? `edit ${index}` : row.label,
      )
      .join("");

  type BoardHandle = Component.ProgramHandle<Board, BoardMessage, never>;

  const mountBoard = (
    view: (board: BoardHandle) => unknown,
  ): {
    readonly container: HTMLElement;
    readonly board: BoardHandle;
    dispose(): void;
  } => {
    let board: BoardHandle | undefined;
    const View = Component.define("BoardView", function* () {
      const handle = yield* Component.program(Board);
      board = handle;
      return () => view(handle) as never;
    });
    const mounted = mount(() => createComponent(Component.embed(View, runtime) as never, {}));
    return { ...mounted, board: board! };
  };

  const relabelOneRowPerRound = async (board: BoardHandle): Promise<void> => {
    for (let round = 0; round < relabelRounds; round++) {
      const id = round * 50;
      await Effect.runPromise(board.dispatch({ _tag: "Relabel", id, label: `edit ${id}` }));
      flush();
    }
  };

  bench("program: update one row's field in a 1k-row model, 1k row readers", async () => {
    const view = mountBoard((board) =>
      Array.from({ length: 1000 }, (_, index) => textCell(() => board.model().rows[index]!.label)),
    );
    await relabelOneRowPerRound(view.board);
    expectText(view.container, expectedBoardText());
    view.dispose();
  });

  bench("program: update one row's field in a 1k-row model, keyed <For> rows", async () => {
    const view = mountBoard((board) =>
      createComponent(
        For as never,
        {
          get each() {
            return board.model().rows;
          },
          children: (row: Row) => textCell(() => row.label),
        } as never,
      ),
    );
    await relabelOneRowPerRound(view.board);
    expectText(view.container, expectedBoardText());
    view.dispose();
  });

  const ProjectById = Resource.define<number, Row>({
    name: "ClientBench.project",
    load: (id) => Effect.succeed({ id, label: `project ${id}` }),
  });
  runWithRuntime(runtime, () =>
    Effect.runSync(
      runtime.provide(
        Effect.forEach(makeRows(200), (row) => Resource.preload(ProjectById(row.id)), {
          discard: true,
        }),
      ),
    ),
  );

  bench("resource bindings: mount and dispose 200 Components reading cached Resources", () => {
    const Project = Component.define("ProjectRow", function* (props: { readonly id: number }) {
      const project = yield* Component.resource(ProjectById);
      return () => textCell(() => project(props.id).label);
    });
    const Rows = Component.embed(
      Component.define("ProjectRows", function* () {
        const Row = yield* Project;
        return () => makeRows(200).map((row) => Row({ id: row.id }));
      }),
      runtime,
    );
    const view = mount(() => createComponent(Rows as never, {}));
    expectText(
      view.container,
      makeRows(200)
        .map((row) => `project ${row.id}`)
        .join(""),
    );
    view.dispose();
  });
});
