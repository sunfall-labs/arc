import { Machine, makeRuntime, Message, Model, State, Signal, Timeline } from "@sunfall/arc-core";
import { createComponent, render } from "@solidjs/web";
import { flush } from "solid-js";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { reactive } from "./component-ssr-fixture.js";

const CounterModel = Model({ Counting: { count: Schema.Finite } });
const CounterMessage = Message({ Incremented: {} });
const CounterState = State.define({
  name: "Counter",
  machine: Machine.make({
    state: CounterModel,
    event: CounterMessage,
    initial: CounterModel.Counting({ count: 0 }),
  }).onAny(CounterMessage.Incremented, ({ state }) =>
    CounterModel.Counting({ count: state.count + 1 }),
  ),
});

const TitleModel = Model({ Titled: { title: Schema.String } });
const TitleMessage = Message({ RenamedTitle: { title: Schema.String } });
const TitleState = State.define({
  name: "Title",
  machine: Machine.make({
    state: TitleModel,
    event: TitleMessage,
    initial: TitleModel.Titled({ title: "Draft" }),
  }).onAny(TitleMessage.RenamedTitle, ({ event }) => TitleModel.Titled({ title: event.title })),
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
            | Component.StateHandle<
                State.Model<typeof CounterState>,
                State.Message<typeof CounterState>
              >
            | undefined;
          let title:
            | Component.StateHandle<
                State.Model<typeof TitleState>,
                State.Message<typeof TitleState>
              >
            | undefined;

          const View = Component.define("View", function* () {
            const counter = yield* Component.state(CounterState);
            instance = counter;
            const named = yield* Component.state(TitleState);
            title = named;
            return () => reactive(() => `${named.model().title}:${counter.model().count}`);
          });
          const dispose = render(
            () => createComponent(Component.embed(View, runtime), {}),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          flush();
          expect(container.textContent).toBe("Draft:0");

          yield* instance!.dispatch(CounterMessage.Incremented);
          yield* title!.dispatch(TitleMessage.RenamedTitle({ title: "Published" }));
          yield* instance!.dispatch(CounterMessage.Incremented);
          flush();
          expect(container.textContent).toBe("Published:2");
          // Every commit reads as a named message.
          expect(
            Signal.peek(recording.entries).map((entry) => Timeline.describe(entry.cause)),
          ).toEqual([
            'State "Counter" start',
            'State "Title" start',
            'State "Counter" Incremented',
            'State "Title" RenamedTitle',
            'State "Counter" Incremented',
          ]);

          const firstIncrement = Signal.peek(recording.entries)[2];
          yield* recording.travel(firstIncrement!.sequence);
          flush();
          expect(container.textContent).toBe("Draft:1");

          // Live dispatches keep committing to the head while the DOM stays travelled.
          yield* instance!.dispatch(CounterMessage.Incremented);
          flush();
          expect(container.textContent).toBe("Draft:1");
          expect(Signal.peek(instance!.committed)).toMatchObject({ count: 3 });

          yield* recording.resume();
          flush();
          expect(container.textContent).toBe("Published:3");
        }),
      ),
    ));
});
