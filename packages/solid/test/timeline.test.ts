import { makeRuntime, Program, Signal, Timeline } from "@sunfall/arc-core";
import { createComponent, render } from "@solidjs/web";
import { flush } from "solid-js";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RuntimeProvider, useProgram, type ProgramHandle } from "../src/index.js";
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
          yield* Effect.addFinalizer(() => runtime.disposeEffect.pipe(Effect.orDie));
          const recording = yield* Timeline.record();
          const title = Signal.make("Draft", { name: "title" });
          const container = document.createElement("div");
          let program:
            | ProgramHandle<
                { readonly count: number },
                CounterMessage,
                Program.RuntimeError<never>,
                Program.DispatchError<never>
              >
            | undefined;

          const View = () => {
            program = useProgram(CounterProgram);
            const counter = program;
            return reactive(() => `${title.get()}:${counter.model().count}`);
          };
          const dispose = render(
            () =>
              createComponent(RuntimeProvider, {
                runtime,
                get children() {
                  return createComponent(View, {});
                },
              }),
            container,
          );
          yield* Effect.addFinalizer(() => Effect.sync(dispose));
          flush();
          expect(container.textContent).toBe("Draft:0");

          yield* program!.dispatchEffect({ _tag: "Increment" });
          title.set("Published");
          yield* program!.dispatchEffect({ _tag: "Increment" });
          flush();
          expect(container.textContent).toBe("Published:2");

          const [firstIncrement] = Signal.peek(recording.entries);
          yield* recording.travel(firstIncrement!.sequence);
          flush();
          expect(container.textContent).toBe("Draft:1");

          // Live dispatches keep committing to the head while the DOM stays travelled.
          yield* program!.dispatchEffect({ _tag: "Increment" });
          flush();
          expect(container.textContent).toBe("Draft:1");
          expect(Signal.peek(program!.instance.model)).toEqual({ count: 3 });

          yield* recording.resume();
          flush();
          expect(container.textContent).toBe("Published:3");
        }),
      ),
    ));
});
