import { createEffect, createRoot, flush } from "@solidjs/signals";
import { Deferred, Effect, Exit, Fiber, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionOptimisticRowsTypeId,
  ActionResult,
  Resource,
  Signal,
  Timeline,
  type ActionOptimisticRows,
} from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
}

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

let families = 0;

/** A server with one project, a Resource over it, and a rename Action whose `run` waits for a gate. */
const makeFixture = () => {
  const suffix = `${++families}`;
  const server = { name: "Atlas", progress: 0, loads: 0 };
  const ProjectById = Resource.define<string, Project>({
    name: `OptimisticResource.ProjectById.${suffix}`,
    load: (id: string) =>
      Effect.sync((): Project => {
        server.loads++;
        return { id, name: server.name, progress: server.progress };
      }),
  });
  const Rename = Action.define({
    name: `OptimisticResource.rename.${suffix}`,
    optimistic: (input: { readonly id: string; readonly name: string }, transaction) =>
      transaction.set(ProjectById(input.id), (project) => ({ ...project, name: input.name })),
    run: (input: {
      readonly id: string;
      readonly name: string;
      readonly gate: Deferred.Deferred<void, string>;
    }) =>
      Effect.gen(function* () {
        yield* Deferred.await(input.gate);
        server.name = input.name;
        return input.name;
      }),
    invalidates: (_name, input) => [ProjectById(input.id)],
  });
  const Advance = Action.define({
    name: `OptimisticResource.advance.${suffix}`,
    optimistic: (input: { readonly id: string }, transaction) =>
      transaction.set(ProjectById(input.id), (project) => ({
        ...project,
        progress: project.progress + 8,
      })),
    run: (input: { readonly id: string; readonly gate: Deferred.Deferred<void, string> }) =>
      Effect.as(Deferred.await(input.gate), input.id),
  });
  const ref = ProjectById("atlas");
  const visible = () => {
    const result = Signal.peek(Resource.result(ref));
    return Option.getOrUndefined(AsyncResult.value(result));
  };
  return { server, ProjectById, Rename, Advance, ref, visible };
};

const submitGated = <I extends object>(
  action: {
    readonly submit: (
      input: I & { readonly gate: Deferred.Deferred<void, string> },
    ) => Effect.Effect<unknown, unknown, unknown>;
  },
  input: I,
) =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void, string>();
    const fiber = yield* Effect.forkDetach(
      action.submit({ ...input, gate }) as Effect.Effect<unknown, unknown>,
    );
    yield* Effect.yieldNow;
    return { gate, fiber };
  });

describe("Action optimistic Resource patches", () => {
  it("shows the patch to readers, keeps loads and snapshots synced, and folds in on success", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, Rename, ref, visible } = makeFixture();
        yield* Resource.preload(ref);
        const rename = Action.use(Rename, { runtime: defaultRuntime });

        const { gate, fiber } = yield* submitGated(rename, { id: "atlas", name: "Atlas 2" });
        // Readers see the patch at once, settled (no waiting flash).
        const result = Signal.peek(Resource.result(ref));
        expect(result).toMatchObject({ _tag: "Success", waiting: false });
        expect(visible()).toEqual({ id: "atlas", name: "Atlas 2", progress: 0 });
        expect(yield* Resource.read(ref)).toMatchObject({ name: "Atlas 2" });
        // Loads and snapshots see the synced value: a patch never crosses a wire.
        expect(yield* Resource.preload(ref)).toMatchObject({ name: "Atlas" });
        const [snapshot] = yield* Resource.dehydrate([ref]);
        expect(snapshot?.state.value).toMatchObject({ name: "Atlas" });

        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(fiber);
        // The `invalidates` reload replaced the folded value with the server's.
        expect(server.loads).toBe(2);
        expect(visible()).toEqual({ id: "atlas", name: "Atlas 2", progress: 0 });
        const [after] = yield* Resource.dehydrate([ref]);
        expect(after?.state.value).toMatchObject({ name: "Atlas 2" });
      }),
    ));

  it("keeps the patch on top of a reload and rolls back to the reloaded value on failure", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, Rename, ref, visible } = makeFixture();
        yield* Resource.preload(ref);
        const rename = Action.use(Rename, { runtime: defaultRuntime });

        const { gate, fiber } = yield* submitGated(rename, { id: "atlas", name: "Atlas 2" });
        server.progress = 40;
        expect(yield* Resource.refresh(ref)).toEqual({ id: "atlas", name: "Atlas", progress: 40 });
        expect(visible()).toEqual({ id: "atlas", name: "Atlas 2", progress: 40 });

        yield* Deferred.fail(gate, "rejected");
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
        expect(visible()).toEqual({ id: "atlas", name: "Atlas", progress: 40 });
      }),
    ));

  it("rebases other submissions' patches when one rolls back, and rolls back on interruption", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Rename, Advance, ref, visible } = makeFixture();
        yield* Resource.preload(ref);
        const rename = Action.use(Rename, { runtime: defaultRuntime });
        const advance = Action.use(Advance, { runtime: defaultRuntime });

        const renaming = yield* submitGated(rename, { id: "atlas", name: "Atlas 2" });
        const advancing = yield* submitGated(advance, { id: "atlas" });
        expect(visible()).toEqual({ id: "atlas", name: "Atlas 2", progress: 8 });

        yield* Deferred.fail(renaming.gate, "rejected");
        yield* Fiber.await(renaming.fiber);
        expect(visible()).toEqual({ id: "atlas", name: "Atlas", progress: 8 });

        yield* Fiber.interrupt(advancing.fiber);
        expect(visible()).toEqual({ id: "atlas", name: "Atlas", progress: 0 });
      }),
    ));

  it("leaves an entry that has not loaded alone", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, Rename, ProjectById, ref, visible } = makeFixture();
        const rename = Action.use(Rename, { runtime: defaultRuntime });

        const { gate, fiber } = yield* submitGated(rename, { id: "atlas", name: "Atlas 2" });
        expect(Signal.peek(Resource.result(ref))._tag).toBe("Initial");
        expect(
          yield* Action.planOptimistic(Rename, { id: "atlas", name: "Atlas 2" } as never),
        ).toEqual([]);

        // A load during the submission shows the server's value, unpatched.
        expect(yield* Resource.preload(ref)).toMatchObject({ name: "Atlas" });
        expect(visible()).toMatchObject({ name: "Atlas" });
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(fiber);
        expect(server.name).toBe("Atlas 2");
        expect(Signal.peek(Resource.result(ProjectById("other")))._tag).toBe("Initial");
      }),
    ));

  it("plans a Set change with the value the entry would read, writing nothing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Rename, ref, visible } = makeFixture();
        yield* Resource.preload(ref);

        const changes = yield* Action.planOptimistic(Rename, {
          id: "atlas",
          name: "Atlas 2",
        } as never);

        expect(changes).toEqual([
          { _tag: "Set", target: ref, value: { id: "atlas", name: "Atlas 2", progress: 0 } },
        ]);
        expect(visible()).toMatchObject({ name: "Atlas" });
      }),
    ));

  it("commits patches under the Action's cause, and travel renders the pre-patch value", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Rename, ref } = makeFixture();
        yield* Resource.preload(ref);
        const recording = yield* Timeline.record();
        const rename = Action.use(Rename, { runtime: defaultRuntime });
        const view = render(
          () => Option.getOrUndefined(AsyncResult.value(Resource.result(ref).get()))?.name,
        );

        const { gate, fiber } = yield* submitGated(rename, { id: "atlas", name: "Atlas 2" });
        expect(view.current()).toBe("Atlas 2");
        yield* Deferred.fail(gate, "rejected");
        yield* Fiber.await(fiber);
        expect(view.current()).toBe("Atlas");

        const entries = Signal.peek(recording.entries);
        const entryName = `${ref.family.options.name}(${ref.key})`;
        const patches = entries.filter((entry) =>
          entry.changes.some((change) => change.name === entryName),
        );
        // Travel to the patch commit, then to the commit before it.
        const patchedAt = entries.indexOf(patches[0]!);
        expect(patchedAt).toBeGreaterThan(0);
        yield* recording.travel(entries[patchedAt]!.sequence);
        expect(view.current()).toBe("Atlas 2");
        yield* recording.travel(entries[patchedAt - 1]!.sequence);
        expect(view.current()).toBe("Atlas");
        yield* recording.resume();
        expect(view.current()).toBe("Atlas");
        view.dispose();

        expect(patches.map((entry) => Timeline.describe(entry.cause))).toEqual([
          `Action "${Rename.name}" submit`,
          `Action "${Rename.name}" failure`,
        ]);
        const [patched, rolledBack] = patches.map(
          (entry) => entry.changes.find((change) => change.name === entryName)!,
        );
        expect(Option.getOrUndefined(AsyncResult.value(patched!.next as never))).toMatchObject({
          name: "Atlas 2",
        });
        expect(Option.getOrUndefined(AsyncResult.value(rolledBack!.next as never))).toMatchObject({
          name: "Atlas",
        });
      }).pipe(Effect.scoped),
    ));
});

/** A row store that records how its layer settles. */
const recordingRows = () => {
  const settled: Array<"commit" | "rollback"> = [];
  const rows: ActionOptimisticRows<Project, string> = {
    [ActionOptimisticRowsTypeId]: {
      apply: () =>
        Effect.succeed({
          commit: Effect.sync(() => void settled.push("commit")),
          rollback: Effect.sync(() => void settled.push("rollback")),
        }),
    },
  };
  return { rows, settled };
};

describe("Action optimistic patches and rejected ActionResults", () => {
  const defineSave = (
    suffix: string,
    result: (name: string) => ActionResult<string, { readonly name: string }, string, string>,
  ) => {
    const { ref, ProjectById } = makeFixture();
    const draft = Signal.make("Atlas", { name: `RejectedResult.${suffix}.draft` });
    const { rows, settled } = recordingRows();
    const Save = Action.define({
      name: `RejectedResult.${suffix}`,
      optimistic: (name: string, transaction) =>
        Effect.all([
          transaction.set(draft, name),
          transaction.update(rows, "atlas", { name }),
          transaction.set(ProjectById("atlas"), (project) => ({ ...project, name })),
        ]),
      run: (name: string) => Effect.succeed(result(name)),
    });
    return { Save, draft, settled, ref };
  };

  it("rolls back Signal, row, and Resource patches when run returns a ValidationFailure", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Save, draft, settled, ref } = defineSave("validation", () =>
          ActionResult.validation<{ readonly name: string }, string>({
            fieldErrors: { name: ["Too short."] },
          }),
        );
        yield* Resource.preload(ref);
        const recording = yield* Timeline.record();

        const result = yield* Action.use(Save, { runtime: defaultRuntime }).submit("At");

        expect(result._tag).toBe("ValidationFailure");
        expect(Signal.peek(draft)).toBe("Atlas");
        expect(settled).toEqual(["rollback"]);
        expect(yield* Resource.read(ref)).toMatchObject({ name: "Atlas" });
        // Each patch committed on submit; one failure commit undid them all,
        // with no success commit folding them in.
        const entryName = `${ref.family.options.name}(${ref.key})`;
        const patchCommits = Signal.peek(recording.entries).filter((entry) =>
          entry.changes.some(
            (change) =>
              change.name === entryName || change.name === "RejectedResult.validation.draft",
          ),
        );
        expect(patchCommits.map((entry) => Timeline.describe(entry.cause))).toEqual([
          `Action "${Save.name}" submit`,
          `Action "${Save.name}" submit`,
          `Action "${Save.name}" failure`,
        ]);
        expect(
          patchCommits
            .at(-1)!
            .changes.map((change) => change.name)
            .sort(),
        ).toEqual([entryName, "RejectedResult.validation.draft"].sort());
      }).pipe(Effect.scoped),
    ));

  it("rolls back on a Failure result and commits on Success and Redirect results", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failed = defineSave("failure", () => ActionResult.failure("taken"));
        yield* Resource.preload(failed.ref);
        yield* Action.use(failed.Save, { runtime: defaultRuntime }).submit("Atlas 2");
        expect(Signal.peek(failed.draft)).toBe("Atlas");
        expect(failed.settled).toEqual(["rollback"]);

        const saved = defineSave("success", (name) => ActionResult.success(name));
        yield* Resource.preload(saved.ref);
        yield* Action.use(saved.Save, { runtime: defaultRuntime }).submit("Atlas 2");
        expect(Signal.peek(saved.draft)).toBe("Atlas 2");
        expect(saved.settled).toEqual(["commit"]);
        expect(yield* Resource.read(saved.ref)).toMatchObject({ name: "Atlas 2" });

        const redirected = defineSave("redirect", () => ActionResult.redirect("/projects"));
        yield* Resource.preload(redirected.ref);
        yield* Action.use(redirected.Save, { runtime: defaultRuntime }).submit("Atlas 2");
        expect(Signal.peek(redirected.draft)).toBe("Atlas 2");
        expect(redirected.settled).toEqual(["commit"]);
      }),
    ));
});
