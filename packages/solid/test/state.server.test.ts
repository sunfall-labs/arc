import { makeRuntime, State } from "@sunfall/arc-core";
import { Effect } from "effect";
import { createComponent, renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";

interface Board {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly id: number; readonly label: string }>;
}

const BoardState = State.define<Board, { readonly _tag: "Noop" }>()({
  name: "BoardState",
  initial: {
    title: "Roadmap",
    items: [
      { id: 1, label: "Plan" },
      { id: 2, label: "Ship" },
    ],
  },
  on: { Noop: (model) => model },
});

const Counter = State.define<number, { readonly _tag: "Noop" }>()({
  name: "Counter",
  initial: 7,
  on: { Noop: (model) => model },
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
        return `${board.model().title}:${rows}#${counter.model()}`;
      };
    });

    const html = renderToString(() => createComponent(Component.embed(BoardView, runtime), {}));

    expect(html.replace(/<!--[^>]*-->/g, "")).toBe("Roadmap:[Plan][Ship]#7");
    await Effect.runPromise(runtime.dispose);
  });
});
