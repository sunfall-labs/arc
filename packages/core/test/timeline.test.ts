import { createEffect, createRoot, flush } from "@solidjs/signals";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  Action,
  Program,
  Resource,
  Signal,
  Timeline,
  TimelineAlreadyRecording,
  TimelineEntryUnavailable,
  type ReadableSignal,
  type TimelineEntry,
} from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";

/** Renders `read` in a Solid root and returns the latest rendered value after each flush. */
const render = <A>(read: () => A) => {
  let latest: A | undefined;
  const dispose = createRoot((disposeRoot) => {
    createEffect(read, (value) => {
      latest = value;
    });
    return disposeRoot;
  });
  flush();
  return {
    current: (): A => {
      flush();
      return latest as A;
    },
    dispose,
  };
};

const summarize = (entries: ReadonlyArray<TimelineEntry>) =>
  entries.map((entry) => ({
    cause: Timeline.describe(entry.cause),
    changes: entry.changes.map((change) => [change.name, change.previous, change.next]),
  }));

const entriesOf = (recording: { readonly entries: ReadableSignal<ReadonlyArray<TimelineEntry>> }) =>
  summarize(Signal.peek(recording.entries));

describe("Timeline recording", () => {
  it("records solo writes, batches, and transactions as labelled change sets", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const count = Signal.make(0, { name: "count" });
        const label = Signal.make("a", { name: "label" });

        count.set(1);
        Signal.batch(
          () => {
            count.set(2);
            label.set("b");
          },
          { cause: { _tag: "User", label: "Batch edit" } },
        );
        yield* Signal.transaction(
          Effect.sync(() => {
            label.set("c");
            // A nested cause names the commit only when the outer has none.
            Signal.batch(() => count.set(3), { cause: { _tag: "User", label: "Inner" } });
          }),
          { cause: { _tag: "User", label: "Rename" } },
        );
        yield* Signal.transaction(
          Effect.sync(() => {
            Signal.batch(() => count.set(4), { cause: { _tag: "User", label: "Adopted" } });
          }),
        );
        // A write that changes nothing commits nothing.
        count.set(4);

        expect(entriesOf(recording)).toEqual([
          { cause: "commit", changes: [["count", 0, 1]] },
          {
            cause: "Batch edit",
            changes: [
              ["count", 1, 2],
              ["label", "a", "b"],
            ],
          },
          {
            cause: "Rename",
            changes: [
              ["label", "b", "c"],
              ["count", 2, 3],
            ],
          },
          { cause: "Adopted", changes: [["count", 3, 4]] },
        ]);
        const [first] = Signal.peek(recording.entries);
        expect(first?.sequence).toBe(1);
        expect(first?.changes[0]?.signal).toBe(count);
      }).pipe(Effect.scoped),
    ));

  it("labels unnamed signals with a stable auto id", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const anonymous = Signal.make(0);
        anonymous.set(1);
        anonymous.set(2);

        const [first, second] = Signal.peek(recording.entries);
        expect(first?.changes[0]?.name).toMatch(/^signal#\d+$/);
        expect(second?.changes[0]?.name).toBe(first?.changes[0]?.name);
      }).pipe(Effect.scoped),
    ));

  it("does not record rolled-back transactions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const count = Signal.make(0, { name: "count" });
        yield* Effect.exit(
          Signal.transaction(
            Effect.sync(() => count.set(1)).pipe(Effect.andThen(Effect.fail("rollback"))),
            { cause: { _tag: "User", label: "Rolled back" } },
          ),
        );
        expect(entriesOf(recording)).toEqual([]);
      }).pipe(Effect.scoped),
    ));

  it("records framework causes from Actions, Programs, and Resources", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const action = Action.use(
          Action.define({
            name: "Project.rename",
            run: (name: string) => Effect.succeed({ name }),
          }),
          { runtime: defaultRuntime },
        );
        yield* action.submit("Atlas");

        const program = Program.start(
          Program.define<number, { readonly _tag: "Increment" }>({
            name: "Board",
            initial: 0,
            update: (model) => model + 1,
          }),
          { runtime: defaultRuntime },
        );
        yield* program.dispatch({ _tag: "Increment" });
        yield* program.dispose;

        const Project = Resource.define({
          name: "Project.get",
          load: (id: string) => Effect.succeed({ id }),
        });
        const ref = Project("atlas");
        yield* Resource.preload(ref);

        expect(Signal.peek(recording.entries).map((entry) => entry.cause)).toEqual([
          { _tag: "Action", action: "Project.rename", event: "submit" },
          { _tag: "Action", action: "Project.rename", event: "success" },
          {
            _tag: "Program",
            program: "Board",
            event: "message",
            message: { _tag: "Increment" },
          },
          { _tag: "Resource", resource: "Project.get", key: ref.key, event: "load" },
          { _tag: "Resource", resource: "Project.get", key: ref.key, event: "success" },
        ]);
        expect(
          Signal.peek(recording.entries).map((entry) => Timeline.describe(entry.cause)),
        ).toEqual([
          'Action "Project.rename" submit',
          'Action "Project.rename" success',
          'Program "Board" message Increment',
          `Resource "Project.get" load ${ref.key}`,
          `Resource "Project.get" success ${ref.key}`,
        ]);
        expect(Signal.peek(recording.entries)[0]?.changes.map((change) => change.name)).toEqual([
          "Project.rename.state",
        ]);
        expect(Signal.peek(recording.entries)[2]?.changes[0]?.name).toBe("Board.model");
        expect(Signal.peek(recording.entries)[3]?.changes[0]?.name).toBe(`Project.get(${ref.key})`);
      }).pipe(Effect.scoped),
    ));

  it("bounds retention and rejects travel to dropped entries", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record({ limit: 3 });
        const count = Signal.make(0, { name: "count" });
        for (let value = 1; value <= 5; value++) {
          count.set(value);
        }

        expect(Signal.peek(recording.entries).map((entry) => entry.sequence)).toEqual([3, 4, 5]);
        const exit = yield* Effect.exit(recording.travel(1));
        expect(exit).toEqual(Exit.fail(new TimelineEntryUnavailable({ sequence: 1 })));
      }).pipe(Effect.scoped),
    ));

  it("uninstalls on scope close and allows only one recording at a time", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const count = Signal.make(0, { name: "count" });
        const recording = yield* Effect.scoped(
          Effect.gen(function* () {
            const recording = yield* Timeline.record();
            const nested = yield* Effect.exit(Effect.scoped(Timeline.record()));
            expect(nested).toEqual(Exit.fail(new TimelineAlreadyRecording()));
            count.set(1);
            expect(Signal.peek(recording.entries)).toHaveLength(1);
            return recording;
          }),
        );

        // Closing the scope drops retained entries and stops recording.
        count.set(2);
        expect(Signal.peek(recording.entries)).toEqual([]);

        const next = yield* Effect.scoped(
          Effect.gen(function* () {
            const next = yield* Timeline.record();
            count.set(3);
            return summarize(Signal.peek(next.entries));
          }),
        );
        expect(next).toEqual([{ cause: "commit", changes: [["count", 2, 3]] }]);
      }),
    ));
});

describe("Timeline travel", () => {
  it("renders every recorded signal at the travelled commit while Effects read the head", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const first = Signal.make("Ada", { name: "first" });
        const last = Signal.make("Lovelace", { name: "last" });
        const full = Signal.derive(() => `${first.get()} ${last.get()}`);
        const view = render(() => ({ first: first.get(), full: full.get() }));

        Signal.batch(() => {
          first.set("Grace");
          last.set("Hopper");
        });
        first.set("Barbara");
        expect(view.current()).toEqual({ first: "Barbara", full: "Barbara Hopper" });

        const [initial, renamed] = Signal.peek(recording.entries);
        yield* recording.travel(initial!.sequence);
        expect(view.current()).toEqual({ first: "Grace", full: "Grace Hopper" });
        expect(Signal.peek(recording.position)).toBe(initial!.sequence);
        // Committed state stays live for Effects and synchronous code.
        expect(Signal.peek(first)).toBe("Barbara");
        expect(Signal.peek(full)).toBe("Barbara Hopper");

        yield* recording.travel(renamed!.sequence);
        expect(view.current()).toEqual({ first: "Barbara", full: "Barbara Hopper" });

        // Travelling writes nothing, so it records nothing.
        expect(Signal.peek(recording.entries)).toHaveLength(2);

        yield* recording.resume();
        expect(Signal.peek(recording.position)).toBeUndefined();
        view.dispose();
      }).pipe(Effect.scoped),
    ));

  it("keeps live commits off the travelled view and restores them on resume", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const count = Signal.make(0, { name: "count" });
        const view = render(() => count.get());

        count.set(1);
        count.set(2);
        yield* recording.travel(1);
        expect(view.current()).toBe(1);

        // Live work keeps running against the head: no lost updates.
        count.update((value) => value + 1);
        expect(Signal.peek(count)).toBe(3);
        expect(view.current()).toBe(1);
        expect(entriesOf(recording).at(-1)).toEqual({
          cause: "commit",
          changes: [["count", 2, 3]],
        });

        yield* recording.resume();
        expect(view.current()).toBe(3);
        view.dispose();
      }).pipe(Effect.scoped),
    ));

  it("renders signals first written after the travelled commit at their value then", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const count = Signal.make(0, { name: "count" });
        count.set(1);

        const later = Signal.make("initial", { name: "later" });
        later.set("loaded");
        const view = render(() => later.get());
        expect(view.current()).toBe("loaded");

        yield* recording.travel(1);
        expect(view.current()).toBe("initial");

        // A signal first written while travelling stays at its travelled value.
        const fresh = Signal.make("fresh", { name: "fresh" });
        const freshView = render(() => fresh.get());
        fresh.set("changed");
        expect(freshView.current()).toBe("fresh");

        yield* recording.resume();
        expect(view.current()).toBe("loaded");
        expect(freshView.current()).toBe("changed");
        view.dispose();
        freshView.dispose();
      }).pipe(Effect.scoped),
    ));

  it("resumes the live head when the recording scope closes mid-travel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const count = Signal.make(0, { name: "count" });
        const view = render(() => count.get());
        yield* Effect.scoped(
          Effect.gen(function* () {
            const recording = yield* Timeline.record();
            count.set(1);
            count.set(2);
            yield* recording.travel(1);
            expect(view.current()).toBe(1);
          }),
        );
        expect(view.current()).toBe(2);
        view.dispose();
      }),
    ));
});
