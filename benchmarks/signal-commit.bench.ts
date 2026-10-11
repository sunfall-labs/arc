import { Signal } from "@sunfall/arc-core";
import { bench, describe } from "vitest";

// Guards the unrecorded commit path: without `Timeline.record`, solo writes,
// batches, and reads must cost what they did before the recorder seam existed.
const microBenchOptions = { throws: true, time: 1_000, warmupTime: 250 };

const assertBench = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const counter = Signal.make(0);
let notified = 0;
counter.subscribe(() => {
  notified++;
});
const cells = Array.from({ length: 10 }, (_, index) => Signal.make(index));

describe("Signal commit path (unrecorded)", () => {
  bench(
    "Signal solo write x1000",
    () => {
      const before = notified;
      for (let index = 0; index < 1_000; index++) {
        counter.set((value) => value + 1);
      }
      assertBench(notified - before === 1_000, "Solo writes skipped a notification.");
    },
    microBenchOptions,
  );

  bench(
    "Signal.batch of 10 writes x100",
    () => {
      for (let round = 0; round < 100; round++) {
        Signal.batch(() => {
          for (const cell of cells) {
            cell.set((value) => value + 1);
          }
        });
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
