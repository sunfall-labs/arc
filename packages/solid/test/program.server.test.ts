import { makeRuntime, Program } from "@sunfall/arc-core";
import { Effect } from "effect";
import { createComponent, renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";

interface Board {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly id: number; readonly label: string }>;
}

const BoardProgram = Program.define<Board, { readonly _tag: "Noop" }>({
  initial: {
    title: "Roadmap",
    items: [
      { id: 1, label: "Plan" },
      { id: 2, label: "Ship" },
    ],
  },
  on: { Noop: (model) => model },
});

const Counter = Program.define<number, { readonly _tag: "Noop" }>({
  initial: 7,
  on: { Noop: (model) => model },
});

describe("Component.program on the server", () => {
  it("renders the Program model with Solid's server build", async () => {
    const runtime = makeRuntime();
    const BoardView = Component.make("BoardView", function* () {
      const board = yield* Component.program(BoardProgram);
      const counter = yield* Component.program(Counter);
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
    await Effect.runPromise(runtime.disposeEffect);
  });
});
