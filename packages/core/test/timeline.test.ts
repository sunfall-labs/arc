import { createEffect, createRoot, flush } from "@solidjs/signals";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  Action,
  State,
  Resource,
  Signal,
  Timeline,
  TimelineAlreadyRecording,
  TimelineEntryUnavailable,
} from "../src/index.js";
import {
  defaultRuntime,
  withSignalTransition,
  SignalWrites,
  SignalWriteOutsideTransition,
} from "../src/internal.js";

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

const summarize = (entries: ReadonlyArray<Timeline.Entry>) =>
  entries.map((entry) => ({
    cause: Timeline.describe(entry.cause),
    changes: entry.changes.map((change) => [change.name, change.previous, change.next]),
  }));

const entriesOf = (recording: {
  readonly entries: Signal.Readable<ReadonlyArray<Timeline.Entry>>;
}) => summarize(Signal.peek(recording.entries));

describe("Timeline recording", () => {
  it("records solo writes, batches, and transactions as labelled change sets", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const count = SignalWrites.make(0, { name: "count" });
        const label = SignalWrites.make("a", { name: "label" });

        SignalWrites.batch(() => count.set(1), { name: "Counter.increment" });
        SignalWrites.batch(
          () => {
            count.set(2);
            label.set("b");
          },
          { name: "Batch edit" },
        );
        yield* SignalWrites.transaction(
          Effect.sync(() => {
            label.set("c");
            // A nested name names the commit only when the outer has none.
            SignalWrites.batch(() => count.set(3), { name: "Inner" });
          }),
          { name: "Rename" },
        );
        yield* SignalWrites.transaction(
          Effect.sync(() => {
            SignalWrites.batch(() => count.set(4), { name: "Adopted" });
          }),
        );
        // A write that changes nothing commits nothing.
        SignalWrites.batch(() => count.set(4), { name: "Counter.noop" });

        expect(entriesOf(recording)).toEqual([
          { cause: "Counter.increment", changes: [["count", 0, 1]] },
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

  it("fails loudly on a write outside every named transition", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const draft = SignalWrites.make("", { name: "ProjectPage.draft" });
        const message =
          'Signal "ProjectPage.draft" was written outside a named transition. ' +
          "Framework writes must run inside a named transition: a State message, an Action, " +
          "a framework event, or `SignalWrites.batch(f, { name })` / " +
          "`SignalWrites.transaction(effect, { name })`.";

        // An unnamed framework write throws at the write: an internal assertion.
        expect(() => draft.set("Atlas")).toThrow(SignalWriteOutsideTransition);
        expect(() => draft.set("Atlas")).toThrow(message);

        // In an Effect, the write is a defect; an unnamed transaction is no name.
        for (const write of [
          Effect.sync(() => draft.set("Atlas")),
          SignalWrites.transaction(Effect.sync(() => draft.set("Atlas"))),
        ]) {
          const exit = yield* Effect.exit(write);
          expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toEqual(
            new SignalWriteOutsideTransition({ signal: "ProjectPage.draft" }),
          );
        }

        expect(Signal.peek(draft)).toBe("");
        expect(entriesOf(recording)).toEqual([]);
      }).pipe(Effect.scoped),
    ));

  it("commits writes in a named transition under its name, keeping Action and State causes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const draft = SignalWrites.make("", { name: "ProjectPage.draft" });
        const action = Action.use(
          Action.define({
            name: "Project.rename",
            run: (name: string) => Effect.succeed({ name }),
          }),
          { runtime: defaultRuntime },
        );
        const instance = State.start(
          State.define<number, { readonly _tag: "Renamed" }>()({
            name: "Board",
            initial: 0,
            on: { Renamed: (model) => model + 1 },
          }),
          { runtime: defaultRuntime },
        );

        // What `Component.callback("rename", ...)` runs for a `ProjectPage` instance.
        yield* withSignalTransition(
          Effect.gen(function* () {
            draft.set("Atlas");
            // Fibers forked inside the transition commit under it too.
            yield* Effect.forkChild(
              Effect.sync(() => draft.set("Atlas 2")),
              {
                startImmediately: true,
              },
            );
            yield* action.submit("Atlas 2");
            yield* instance.dispatch({ _tag: "Renamed" });
            // An unnamed transaction inside it takes its name.
            yield* SignalWrites.transaction(Effect.sync(() => draft.set("")));
          }),
          { _tag: "Transition", name: "ProjectPage.rename" },
        );
        yield* instance.dispose;

        expect(entriesOf(recording).map((entry) => entry.cause)).toEqual([
          "ProjectPage.rename",
          "ProjectPage.rename",
          'Action "Project.rename" submit',
          'Action "Project.rename" success',
          'State "Board" Renamed',
          "ProjectPage.rename",
        ]);
      }).pipe(Effect.scoped),
    ));

  it("does not record rolled-back transactions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const count = SignalWrites.make(0, { name: "count" });
        yield* Effect.exit(
          SignalWrites.transaction(
            Effect.sync(() => count.set(1)).pipe(Effect.andThen(Effect.fail("rollback"))),
            { name: "Rolled back" },
          ),
        );
        expect(entriesOf(recording)).toEqual([]);
      }).pipe(Effect.scoped),
    ));

  it("records framework causes from Actions, States, and Resources", () =>
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

        const instance = State.start(
          State.define<number, { readonly _tag: "Increment" }>()({
            name: "Board",
            initial: 0,
            on: { Increment: (model) => model + 1 },
          }),
          { runtime: defaultRuntime },
        );
        yield* instance.dispatch({ _tag: "Increment" });
        yield* instance.dispose;

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
            _tag: "State",
            state: "Board",
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
          'State "Board" Increment',
          `Resource "Project.get" load ${ref.key}`,
          `Resource "Project.get" success ${ref.key}`,
        ]);
        expect(Signal.peek(recording.entries)[0]?.changes.map((change) => change.name)).toEqual([
          "Project.rename.state",
        ]);
        expect(Signal.peek(recording.entries)[2]?.changes[0]?.name).toBe("Board");
        expect(Signal.peek(recording.entries)[3]?.changes[0]?.name).toBe(`Project.get(${ref.key})`);
      }).pipe(Effect.scoped),
    ));

  it("bounds retention and rejects travel to dropped entries", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record({ limit: 3 });
        const count = SignalWrites.make(0, { name: "count" });
        for (let value = 1; value <= 5; value++) {
          SignalWrites.batch(() => count.set(value), { name: "count" });
        }

        expect(Signal.peek(recording.entries).map((entry) => entry.sequence)).toEqual([3, 4, 5]);
        const exit = yield* Effect.exit(recording.travel(1));
        expect(exit).toEqual(Exit.fail(new TimelineEntryUnavailable({ sequence: 1 })));
      }).pipe(Effect.scoped),
    ));

  it("uninstalls on scope close and allows only one recording at a time", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const count = SignalWrites.make(0, { name: "count" });
        const recording = yield* Effect.scoped(
          Effect.gen(function* () {
            const recording = yield* Timeline.record();
            const nested = yield* Effect.exit(Effect.scoped(Timeline.record()));
            expect(nested).toEqual(Exit.fail(new TimelineAlreadyRecording()));
            SignalWrites.batch(() => count.set(1), { name: "count" });
            expect(Signal.peek(recording.entries)).toHaveLength(1);
            return recording;
          }),
        );

        // Closing the scope drops retained entries and stops recording.
        SignalWrites.batch(() => count.set(2), { name: "count" });
        expect(Signal.peek(recording.entries)).toEqual([]);

        const next = yield* Effect.scoped(
          Effect.gen(function* () {
            const next = yield* Timeline.record();
            SignalWrites.batch(() => count.set(3), { name: "count" });
            return summarize(Signal.peek(next.entries));
          }),
        );
        expect(next).toEqual([{ cause: "count", changes: [["count", 2, 3]] }]);
      }),
    ));
});

describe("Timeline travel", () => {
  it("renders every recorded signal at the travelled commit while Effects read the head", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const first = SignalWrites.make("Ada", { name: "first" });
        const last = SignalWrites.make("Lovelace", { name: "last" });
        const full = Signal.derive(() => `${first.get()} ${last.get()}`);
        const view = render(() => ({ first: first.get(), full: full.get() }));

        SignalWrites.batch(
          () => {
            first.set("Grace");
            last.set("Hopper");
          },
          { name: "Person.edit" },
        );
        SignalWrites.batch(() => first.set("Barbara"), { name: "Person.rename" });
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
        const count = SignalWrites.make(0, { name: "count" });
        const view = render(() => count.get());

        SignalWrites.batch(() => count.set(1), { name: "count" });
        SignalWrites.batch(() => count.set(2), { name: "count" });
        yield* recording.travel(1);
        expect(view.current()).toBe(1);

        // Live work keeps running against the head: no lost updates.
        SignalWrites.batch(() => count.update((value) => value + 1), { name: "Counter.increment" });
        expect(Signal.peek(count)).toBe(3);
        expect(view.current()).toBe(1);
        expect(entriesOf(recording).at(-1)).toEqual({
          cause: "Counter.increment",
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
        const count = SignalWrites.make(0, { name: "count" });
        SignalWrites.batch(() => count.set(1), { name: "count" });

        const later = SignalWrites.make("initial", { name: "later" });
        SignalWrites.batch(() => later.set("loaded"), { name: "later" });
        const view = render(() => later.get());
        expect(view.current()).toBe("loaded");

        yield* recording.travel(1);
        expect(view.current()).toBe("initial");

        // A signal first written while travelling stays at its travelled value.
        const fresh = SignalWrites.make("fresh", { name: "fresh" });
        const freshView = render(() => fresh.get());
        SignalWrites.batch(() => fresh.set("changed"), { name: "fresh" });
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
        const count = SignalWrites.make(0, { name: "count" });
        const view = render(() => count.get());
        yield* Effect.scoped(
          Effect.gen(function* () {
            const recording = yield* Timeline.record();
            SignalWrites.batch(() => count.set(1), { name: "count" });
            SignalWrites.batch(() => count.set(2), { name: "count" });
            yield* recording.travel(1);
            expect(view.current()).toBe(1);
          }),
        );
        expect(view.current()).toBe(2);
        view.dispose();
      }),
    ));
});
