import { createEffect, createRoot, createSignal, flush } from "@solidjs/signals";
import { Data, Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { Program, Signal, Timeline } from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";

class Boom extends Data.TaggedError("Boom")<{}> {}

const render = <A>(read: () => A) => {
  const seen: A[] = [];
  const dispose = createRoot((disposeRoot) => {
    createEffect(read, (value) => {
      seen.push(value);
    });
    return disposeRoot;
  });
  flush();
  return { seen, dispose };
};

describe("Signal transactions", () => {
  it("reads its own writes while other fibers see committed state", async () => {
    const count = Signal.make(0);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const midway = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const observer = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Deferred.await(midway);
            const seen = Signal.peek(count);
            yield* Deferred.succeed(release, undefined);
            return seen;
          }),
        );
        const inside = yield* Signal.transaction(
          Effect.gen(function* () {
            count.set((n) => n + 1);
            const own = Signal.peek(count);
            yield* Deferred.succeed(midway, undefined);
            yield* Deferred.await(release);
            return own;
          }),
        );
        return { inside, observed: yield* Fiber.join(observer), after: Signal.peek(count) };
      }),
    );

    expect(result).toEqual({ inside: 1, observed: 0, after: 1 });
  });

  it("notifies subscribers once per commit with every write applied", async () => {
    const a = Signal.make(1);
    const b = Signal.make(1);
    const seen: string[] = [];
    a.subscribe(() => seen.push(`a:${Signal.peek(a)},${Signal.peek(b)}`));
    b.subscribe(() => seen.push(`b:${Signal.peek(a)},${Signal.peek(b)}`));

    await Effect.runPromise(
      Signal.transaction(
        Effect.gen(function* () {
          a.set(2);
          yield* Effect.yieldNow;
          b.set(2);
          a.set(3);
        }),
      ),
    );

    expect(seen).toEqual(["a:3,2", "b:3,2"]);
  });

  it("renders a commit atomically in Solid", async () => {
    const a = Signal.make(1);
    const b = Signal.make(1);
    const { seen, dispose } = render(() => `${a.get()},${b.get()}`);

    await Effect.runPromise(
      Signal.transaction(
        Effect.all([
          Signal.updateAndGet(a, () => 2),
          Effect.yieldNow,
          Signal.updateAndGet(b, () => 2),
        ]),
      ),
    );
    flush();
    dispose();

    expect(seen).toEqual(["1,1", "2,2"]);
  });

  it("commits nothing on failure or interruption", async () => {
    const count = Signal.make(0);
    const failure = await Effect.runPromise(
      Signal.transaction(
        Effect.gen(function* () {
          count.set(99);
          return yield* new Boom();
        }),
      ).pipe(Effect.flip),
    );
    const afterInterrupt = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Signal.transaction(
            Effect.andThen(
              Effect.sync(() => count.set(42)),
              Effect.never,
            ),
          ),
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        return Signal.peek(count);
      }),
    );

    expect({ failure: failure._tag, afterInterrupt }).toEqual({
      failure: "Boom",
      afterInterrupt: 0,
    });
  });

  it("joins nested transactions and batches into the outer one", async () => {
    const count = Signal.make(0);
    const seen: number[] = [];
    count.subscribe(() => seen.push(Signal.peek(count)));

    await Effect.runPromise(
      Signal.transaction(
        Effect.gen(function* () {
          yield* Signal.transaction(Signal.updateAndGet(count, (n) => n + 1));
          Signal.batch(() => count.set((n) => n + 1));
          yield* Signal.updateAndGet(count, (n) => n + 1);
        }),
      ),
    );

    expect(seen).toEqual([3]);
  });

  it("commits concurrent branches atomically with their transaction", async () => {
    const a = Signal.make(0);
    const b = Signal.make(0);
    const seen: string[] = [];
    a.subscribe(() => seen.push(`${Signal.peek(a)},${Signal.peek(b)}`));
    b.subscribe(() => seen.push(`${Signal.peek(a)},${Signal.peek(b)}`));

    const observedMidway = await Effect.runPromise(
      Signal.transaction(
        Effect.gen(function* () {
          yield* Effect.all(
            [
              Effect.andThen(
                Effect.yieldNow,
                Signal.updateAndGet(a, () => 1),
              ),
              Effect.andThen(
                Effect.yieldNow,
                Signal.updateAndGet(b, () => 1),
              ),
            ],
            { concurrency: "unbounded" },
          );
          return seen.length;
        }),
      ),
    );

    expect({ observedMidway, seen }).toEqual({ observedMidway: 0, seen: ["1,1", "1,1"] });
  });

  it("lets a fiber that outlives its transaction commit its own writes", async () => {
    const count = Signal.make(0);
    const release = Effect.runSync(Deferred.make<void>());
    const detached = await Effect.runPromise(
      Signal.transaction(
        Effect.forkDetach(
          Effect.andThen(
            Deferred.await(release),
            Signal.updateAndGet(count, (n) => n + 1),
          ),
        ),
      ),
    );
    const beforeRelease = Signal.peek(count);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(detached));

    expect({ beforeRelease, after: Signal.peek(count) }).toEqual({ beforeRelease: 0, after: 1 });
  });

  it("caches derived reads per transaction write set and committed state", async () => {
    const count = Signal.make(1);
    const other = Signal.make(10);
    let computes = 0;
    const sum = Signal.derive(() => {
      computes++;
      return count.get() + other.get();
    });
    Signal.peek(sum);
    computes = 0;

    const reads = await Effect.runPromise(
      Signal.transaction(
        Effect.sync(() => {
          count.set(2);
          const first = [Signal.peek(sum), Signal.peek(sum)];
          count.set(3);
          const afterWrite = Signal.peek(sum);
          // A separate root fiber has no transaction, so this commits immediately.
          Effect.runSync(Effect.sync(() => other.set(20)));
          const outsideCommitted = Signal.peek(other);
          const afterOutsideCommit = Signal.peek(sum);
          return { first, afterWrite, outsideCommitted, afterOutsideCommit };
        }),
      ),
    );

    expect({ reads, computes }).toEqual({
      reads: { first: [12, 12], afterWrite: 13, outsideCommitted: 20, afterOutsideCommit: 23 },
      computes: 3,
    });
  });

  it("batches synchronous writes and discards them when the batch throws", () => {
    const count = Signal.make(0);
    const seen: number[] = [];
    count.subscribe(() => seen.push(Signal.peek(count)));

    const inside = Signal.batch(() => {
      count.set(1);
      count.set((n) => n + 1);
      return Signal.peek(count);
    });
    expect(() =>
      Signal.batch(() => {
        count.set(100);
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect({ inside, seen, committed: Signal.peek(count) }).toEqual({
      inside: 2,
      seen: [2],
      committed: 2,
    });
  });

  it("derives from the transaction's own writes before commit", () => {
    const count = Signal.make(1);
    const doubled = Signal.derive(() => count.get() * 2);

    const inside = Signal.batch(() => {
      count.set(5);
      return Signal.peek(doubled);
    });

    expect({ inside, after: Signal.peek(doubled) }).toEqual({ inside: 10, after: 10 });
  });

  it("returns the visible value from updateAndGet", async () => {
    const count = Signal.make(0);
    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const lone = yield* Signal.updateAndGet(count, (n) => n + 1);
        const inTransaction = yield* Signal.transaction(Signal.updateAndGet(count, (n) => n + 1));
        return { lone, inTransaction, committed: Signal.peek(count) };
      }),
    );

    expect(values).toEqual({ lone: 1, inTransaction: 2, committed: 2 });
  });

  it("never loses an update dispatched twice from inside a Solid effect", () => {
    const [rawModel, setRawModel] = createSignal(0, { ownedWrite: true });
    const model = Signal.make(0);
    const [trigger, setTrigger] = createSignal(0, { ownedWrite: true });
    const dispose = createRoot((disposeRoot) => {
      createEffect(trigger, (value) => {
        if (value === 1) {
          setRawModel(rawModel() + 1);
          setRawModel(rawModel() + 1);
          model.set((n) => n + 1);
          model.set((n) => n + 1);
        }
      });
      return disposeRoot;
    });
    flush();
    setTrigger(1);
    flush();
    dispose();

    expect({ rawSolid: rawModel(), arc: Signal.peek(model) }).toEqual({ rawSolid: 1, arc: 2 });
  });
});

describe("Program and Action commits", () => {
  it("commits each Program message and failure as one labelled Timeline entry", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        type Message = "increment" | "fail";
        const program = Program.start(
          Program.define<number, Message, string>({
            name: "Counter",
            initial: 0,
            update: (model, message) => (message === "fail" ? Effect.fail("boom") : model + 1),
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch("increment");
        yield* Effect.flip(program.dispatch("fail"));

        expect(
          Signal.peek(recording.entries).map((entry) => ({
            cause: Timeline.describe(entry.cause),
            changed: entry.changes.map((change) => change.name),
          })),
        ).toEqual([
          { cause: 'Program "Counter" message increment', changed: ["Counter.model"] },
          { cause: 'Program "Counter" failure', changed: ["Counter.failures"] },
        ]);
        yield* program.dispose;
      }).pipe(Effect.scoped),
    ));
});

describe("Signal Solid projection", () => {
  it("tracks Arc signals natively in Solid computations", () => {
    const name = Signal.make("a");
    const { seen, dispose } = render(() => name.get());

    name.set("b");
    flush();
    dispose();

    expect(seen).toEqual(["a", "b"]);
  });

  it("tracks derived signals in Solid computations", () => {
    const count = Signal.make(1);
    const doubled = Signal.derive(() => count.get() * 2);
    const { seen, dispose } = render(() => doubled.get());

    count.set(2);
    flush();
    dispose();

    expect(seen).toEqual([2, 4]);
  });

  it("projects function values as values, not computations", () => {
    const first = () => "first";
    const second = () => "second";
    const view = Signal.make<() => string>(first);
    const { seen, dispose } = render(() => view.get());

    view.set(() => second);
    flush();
    dispose();

    expect(seen).toEqual([first, second]);
  });

  it("releases the projection subscription when Solid stops observing", async () => {
    const count = Signal.make(0);
    const subscribers = () => (count as unknown as { listeners: Set<unknown> }).listeners.size;
    const { dispose } = render(() => count.get());
    const whileRendered = subscribers();

    dispose();
    flush();
    await Promise.resolve();

    expect({ whileRendered, afterDispose: subscribers() }).toEqual({
      whileRendered: 1,
      afterDispose: 0,
    });
  });
});
