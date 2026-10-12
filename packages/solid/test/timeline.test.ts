import { makeRuntime, Program, Signal, Timeline } from "@sunfall/arc-core";
import { createComponent, render } from "@solidjs/web";
import { flush } from "solid-js";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { reactive } from "./component-ssr-fixture.js";

type CounterMessage = { readonly _tag: "Increment" };

const CounterProgram = Program.define<{ readonly count: number }, CounterMessage>({
  name: "Counter",
  initial: { count: 0 },
  on: {
    Increment: (model) => ({ count: model.count + 1 }),
  },
});

describe("Timeline in the Solid DOM", () => {
  it("renders the travelled commit and returns to the live head on resume", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
          const recording = yield* Timeline.record();
          const title = Signal.make("Draft", { name: "title" });
          const container = document.createElement("div");
          let program:
            | Component.ProgramHandle<{ readonly count: number }, CounterMessage, never>
            | undefined;

          const View = Component.define("View", function* () {
            const counter = yield* Component.program(CounterProgram);
            program = counter;
            return () => reactive(() => `${title.get()}:${counter.model().count}`);
          });
          const dispose = render(
            () => createComponent(Component.embed(View, runtime), {}),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          flush();
          expect(container.textContent).toBe("Draft:0");

          yield* program!.dispatch({ _tag: "Increment" });
          title.set("Published");
          yield* program!.dispatch({ _tag: "Increment" });
          flush();
          expect(container.textContent).toBe("Published:2");

          const [firstIncrement] = Signal.peek(recording.entries);
          yield* recording.travel(firstIncrement!.sequence);
          flush();
          expect(container.textContent).toBe("Draft:1");

          // Live dispatches keep committing to the head while the DOM stays travelled.
          yield* program!.dispatch({ _tag: "Increment" });
          flush();
          expect(container.textContent).toBe("Draft:1");
          expect(Signal.peek(program!.committed)).toEqual({ count: 3 });

          yield* recording.resume();
          flush();
          expect(container.textContent).toBe("Published:3");
        }),
      ),
    ));
});
