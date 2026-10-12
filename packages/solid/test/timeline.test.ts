import { makeRuntime, State, Signal, Timeline } from "@sunfall/arc-core";
import { createComponent, render } from "@solidjs/web";
import { flush } from "solid-js";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { reactive } from "./component-ssr-fixture.js";

type CounterMessage = { readonly _tag: "Increment" };

const CounterState = State.define<{ readonly count: number }, CounterMessage>()({
  name: "Counter",
  initial: { count: 0 },
  on: {
    Increment: (model) => ({ count: model.count + 1 }),
  },
});

const TitleState = State.define({
  name: "Title",
  initial: "Draft",
  on: { Rename: (_title, message: { readonly title: string }) => message.title },
});

describe("Timeline in the Solid DOM", () => {
  it("renders the travelled commit and returns to the live head on resume", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
          const recording = yield* Timeline.record();
          const container = document.createElement("div");
          let instance:
            | Component.StateHandle<{ readonly count: number }, CounterMessage, never>
            | undefined;
          let title:
            | Component.StateHandle<
                string,
                { readonly _tag: "Rename"; readonly title: string },
                never
              >
            | undefined;

          const View = Component.define("View", function* () {
            const counter = yield* Component.state(CounterState);
            instance = counter;
            const named = yield* Component.state(TitleState);
            title = named;
            return () => reactive(() => `${named.model()}:${counter.model().count}`);
          });
          const dispose = render(
            () => createComponent(Component.embed(View, runtime), {}),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          flush();
          expect(container.textContent).toBe("Draft:0");

          yield* instance!.dispatch({ _tag: "Increment" });
          yield* title!.dispatch({ _tag: "Rename", title: "Published" });
          yield* instance!.dispatch({ _tag: "Increment" });
          flush();
          expect(container.textContent).toBe("Published:2");
          // Every commit reads as a named message.
          expect(
            Signal.peek(recording.entries).map((entry) => Timeline.describe(entry.cause)),
          ).toEqual([
            'State "Counter" Increment',
            'State "Title" Rename',
            'State "Counter" Increment',
          ]);

          const [firstIncrement] = Signal.peek(recording.entries);
          yield* recording.travel(firstIncrement!.sequence);
          flush();
          expect(container.textContent).toBe("Draft:1");

          // Live dispatches keep committing to the head while the DOM stays travelled.
          yield* instance!.dispatch({ _tag: "Increment" });
          flush();
          expect(container.textContent).toBe("Draft:1");
          expect(Signal.peek(instance!.committed)).toEqual({ count: 3 });

          yield* recording.resume();
          flush();
          expect(container.textContent).toBe("Published:3");
        }),
      ),
    ));
});
