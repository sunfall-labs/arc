import { Signal } from "@sunfall/arc-core";
import { withSignalTransition, SignalWrites } from "@sunfall/arc-core/internal";
import { Effect } from "effect";
import { bench, describe } from "vitest";

// Guards the unrecorded commit path: without `Timeline.record`, solo writes
// (inside a named transition, as a `Component.callback` makes them), batches,
// and reads must cost what they did before the recorder seam existed.
const microBenchOptions = { throws: true, time: 1_000, warmupTime: 250 };

const assertBench = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const counter = SignalWrites.make(0, { name: "counter" });
let notified = 0;
counter.subscribe(() => {
  notified++;
});
const cells = Array.from({ length: 10 }, (_, index) =>
  SignalWrites.make(index, { name: `cell${index}` }),
);

describe("Signal commit path (unrecorded)", () => {
  bench(
    "Signal solo write x1000",
    () => {
      const before = notified;
      Effect.runSync(
        withSignalTransition(
          Effect.sync(() => {
            for (let index = 0; index < 1_000; index++) {
              counter.update((value) => value + 1);
            }
          }),
          { _tag: "Transition", name: "Bench.increment" },
        ),
      );
      assertBench(notified - before === 1_000, "Solo writes skipped a notification.");
    },
    microBenchOptions,
  );

  bench(
    "SignalWrites.batch of 10 writes x100",
    () => {
      for (let round = 0; round < 100; round++) {
        SignalWrites.batch(
          () => {
            for (const cell of cells) {
              cell.update((value) => value + 1);
            }
          },
          { name: "Bench.cells" },
        );
      }
    },
    microBenchOptions,
  );

  bench(
    "Signal read x1000",
    () => {
      let total = 0;
      for (let index = 0; index < 1_000; index++) {
        total += Signal.peek(counter);
      }
      assertBench(total >= 0, "Signal reads drifted.");
    },
    microBenchOptions,
  );
});
