import { Machine, makeRuntime, Message, Model, State } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { createComponent, renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";

const BoardModel = Model({
  Board: {
    title: Schema.String,
    items: Schema.Array(Schema.Struct({ id: Schema.Finite, label: Schema.String })),
  },
});
const BoardState = State.define({
  name: "BoardState",
  machine: Machine.make({
    state: BoardModel,
    event: Message({ Renamed: { title: Schema.String } }),
    initial: BoardModel.Board({
      title: "Roadmap",
      items: [
        { id: 1, label: "Plan" },
        { id: 2, label: "Ship" },
      ],
    }),
  }),
});

const CounterModel = Model({ Counting: { count: Schema.Finite } });
const Counter = State.define({
  name: "Counter",
  machine: Machine.make({
    state: CounterModel,
    event: Message({ Incremented: {} }),
    initial: CounterModel.Counting({ count: 7 }),
  }),
});

describe("Component.state on the server", () => {
  it("renders the State model with Solid's server build", async () => {
    const runtime = makeRuntime();
    const BoardView = Component.define("BoardView", function* () {
      const board = yield* Component.state(BoardState);
      const counter = yield* Component.state(Counter);
      return () => {
        const rows = board
          .model()
          .items.map((item) => `[${item.label}]`)
          .join("");
        return `${board.model().title}:${rows}#${counter.model().count}`;
      };
    });

    const html = renderToString(() => createComponent(Component.embed(BoardView, runtime), {}));

    expect(html.replace(/<!--[^>]*-->/g, "")).toBe("Roadmap:[Plan][Ship]#7");
    await Effect.runPromise(runtime.dispose);
  });
});
