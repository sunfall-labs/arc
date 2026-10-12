import {
  Action,
  EffectInputCallbackError,
  makeRuntime,
  runWithRuntime,
  Signal,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { currentCollectionStore, subscribeCollectionEvents } from "@sunfall/arc-db/internal";
import { Cause, Deferred, Effect, Exit, Fiber, PubSub, Schema } from "effect";
import { describe, expect, it } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked";
  readonly progress: number;
}

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["active", "blocked"]),
  progress: Schema.Number,
});

const atlas: Project = { id: "atlas", name: "Atlas", status: "active", progress: 72 };

/** A submission whose `run` waits on a gate, so tests can look at rows mid-flight. */
interface Gate {
  readonly started: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void, string>;
}

const makeGate = (): Gate => ({
  started: Effect.runSync(Deferred.make<void>()),
  release: Effect.runSync(Deferred.make<void, string>()),
});

const gatedRun = (gate: Gate) =>
  Effect.gen(function* () {
    yield* Deferred.succeed(gate.started, undefined);
    yield* Deferred.await(gate.release);
  });

/** An Action that applies `patch` optimistically and runs `run`. */
const patchAction = (
  name: string,
  patch: (transaction: Action.OptimisticTransaction) => Effect.Effect<void>,
  run: Effect.Effect<void, string> = Effect.void,
  concurrency: Action.Concurrency = "parallel",
) =>
  Action.define({
    name,
    policy: { concurrency },
    optimistic: (_input: void, transaction) => patch(transaction),
    run: (_input: void) => run,
  });

const submit = <E>(
  runtime: SunfallArcRuntime<never, never>,
  action: Action.Definition<void, void, E>,
) => runtime.runFork(Action.use(action, { runtime }).submit(undefined));

const read = <A>(runtime: SunfallArcRuntime<never, never>, f: () => A): A =>
  runWithRuntime(runtime, f);

const withRuntime = async (body: (runtime: SunfallArcRuntime<never, never>) => Promise<void>) => {
  const runtime = makeRuntime();
  try {
    await body(runtime);
  } finally {
    await Effect.runPromise(runtime.dispose);
  }
};

describe("Action optimistic Collection patches", () => {
  it("shows a patch as unsynced while the Action runs and folds it into the base on success", () =>
    withRuntime(async (runtime) => {
      const gate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-commit",
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      const submission = submit(
        runtime,
        patchAction(
          "Projects.optimistic-commit.advance",
          (transaction) => transaction.update(Projects, "atlas", { progress: 80 }),
          gatedRun(gate),
        ),
      );
      await Effect.runPromise(Deferred.await(gate.started));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: false,
        $origin: "local",
      });
      expect((await Effect.runPromise(runtime.provide(Projects.snapshot()))).rows).toMatchObject([
        { key: "atlas", value: { progress: 72 }, synced: true },
      ]);

      Effect.runSync(Deferred.succeed(gate.release, undefined));
      await Effect.runPromise(Fiber.join(submission));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: true,
        $origin: "local",
      });
    }));

  it("rolls a patch back when the Action fails", () =>
    withRuntime(async (runtime) => {
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-failure",
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      const exit = await Effect.runPromise(
        Fiber.await(
          submit(
            runtime,
            patchAction(
              "Projects.optimistic-failure.advance",
              (transaction) => transaction.update(Projects, "atlas", { progress: 80 }),
              Effect.fail("nope"),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 72,
        $synced: true,
        $origin: "remote",
      });
    }));

  it("rolls a patch back when a newer `latest` submission interrupts it", () =>
    withRuntime(async (runtime) => {
      const gate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-interrupt",
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      const Rename = Action.define({
        name: "Projects.optimistic-interrupt.rename",
        policy: { concurrency: "latest" },
        optimistic: (input: { readonly name: string }, transaction) =>
          transaction.update(Projects, "atlas", { name: input.name }),
        run: (input: { readonly name: string }) =>
          input.name === "First" ? gatedRun(gate) : Effect.fail("second failed"),
      });
      const rename = Action.use(Rename, { runtime });
      const first = runtime.runFork(rename.submit({ name: "First" }));
      await Effect.runPromise(Deferred.await(gate.started));
      expect(read(runtime, () => Projects.get("atlas")?.name)).toBe("First");

      await Effect.runPromise(Fiber.await(runtime.runFork(rename.submit({ name: "Second" }))));
      const firstExit = await Effect.runPromise(Fiber.await(first));

      expect(Exit.isFailure(firstExit)).toBe(true);
      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas",
        $synced: true,
      });
    }));

  it("rebases a later patch when an earlier same-row submission fails", () =>
    withRuntime(async (runtime) => {
      const firstGate = makeGate();
      const secondGate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-overlap-earlier-fails",
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      const first = submit(
        runtime,
        patchAction(
          "Projects.optimistic-overlap-earlier-fails.first",
          (transaction) => transaction.update(Projects, "atlas", { progress: 80 }),
          gatedRun(firstGate),
        ),
      );
      await Effect.runPromise(Deferred.await(firstGate.started));
      const second = submit(
        runtime,
        patchAction(
          "Projects.optimistic-overlap-earlier-fails.second",
          (transaction) => transaction.update(Projects, "atlas", { name: "Atlas Second" }),
          gatedRun(secondGate),
        ),
      );
      await Effect.runPromise(Deferred.await(secondGate.started));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Second",
        progress: 80,
        $synced: false,
      });

      Effect.runSync(Deferred.fail(firstGate.release, "first failed"));
      await Effect.runPromise(Fiber.await(first));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Second",
        progress: 72,
        $synced: false,
      });

      Effect.runSync(Deferred.fail(secondGate.release, "second failed"));
      await Effect.runPromise(Fiber.await(second));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas",
        progress: 72,
        $synced: true,
        $origin: "remote",
      });
    }));

  it("keeps a committed earlier patch when a later same-row submission fails", () =>
    withRuntime(async (runtime) => {
      const firstGate = makeGate();
      const secondGate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-overlap-later-fails",
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      const first = submit(
        runtime,
        patchAction(
          "Projects.optimistic-overlap-later-fails.first",
          (transaction) => transaction.update(Projects, "atlas", { progress: 80 }),
          gatedRun(firstGate),
        ),
      );
      await Effect.runPromise(Deferred.await(firstGate.started));
      const second = submit(
        runtime,
        patchAction(
          "Projects.optimistic-overlap-later-fails.second",
          (transaction) => transaction.update(Projects, "atlas", { progress: 90 }),
          gatedRun(secondGate),
        ),
      );
      await Effect.runPromise(Deferred.await(secondGate.started));

      Effect.runSync(Deferred.succeed(firstGate.release, undefined));
      await Effect.runPromise(Fiber.join(first));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 90,
        $synced: false,
      });

      Effect.runSync(Deferred.fail(secondGate.release, "second failed"));
      await Effect.runPromise(Fiber.await(second));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 80,
        $synced: true,
        $origin: "local",
      });
    }));

  it("keeps a patch on top of a refreshed remote base row", () =>
    withRuntime(async (runtime) => {
      const gate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-refresh-base",
        getKey: (project) => project.id,
        initialData: [atlas],
        sync: {
          refresh: () => Effect.succeed([{ ...atlas, name: "Atlas Remote", progress: 88 }]),
        },
      });
      const submission = submit(
        runtime,
        patchAction(
          "Projects.optimistic-refresh-base.advance",
          (transaction) => transaction.update(Projects, "atlas", { progress: 90 }),
          gatedRun(gate),
        ),
      );
      await Effect.runPromise(Deferred.await(gate.started));
      await Effect.runPromise(runtime.provide(Projects.refresh()));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 90,
        $synced: false,
      });

      Effect.runSync(Deferred.fail(gate.release, "update failed"));
      await Effect.runPromise(Fiber.await(submission));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 88,
        $synced: true,
        $origin: "remote",
      });
    }));

  it("keeps a pending delete hidden across a refresh and restores the row on failure", () =>
    withRuntime(async (runtime) => {
      const gate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-delete-refresh-base",
        getKey: (project) => project.id,
        initialData: [atlas],
        sync: {
          refresh: () => Effect.succeed([{ ...atlas, name: "Atlas Remote", progress: 88 }]),
        },
      });
      const submission = submit(
        runtime,
        patchAction(
          "Projects.optimistic-delete-refresh-base.delete",
          (transaction) => transaction.delete(Projects, "atlas"),
          gatedRun(gate),
        ),
      );
      await Effect.runPromise(Deferred.await(gate.started));

      expect(read(runtime, () => Projects.get("atlas"))).toBeUndefined();
      await Effect.runPromise(runtime.provide(Projects.refresh()));
      expect(read(runtime, () => Projects.get("atlas"))).toBeUndefined();

      Effect.runSync(Deferred.fail(gate.release, "delete failed"));
      await Effect.runPromise(Fiber.await(submission));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Remote",
        progress: 88,
        $synced: true,
      });
    }));

  it("inserts rows that disappear on failure and stay on success", () =>
    withRuntime(async (runtime) => {
      const Projects = Collection.define({
        name: "Projects.optimistic-insert",
        output: ProjectSchema,
        getKey: (project) => project.id,
      });
      const lumen: Project = { id: "lumen", name: "Lumen", status: "blocked", progress: 4 };

      await Effect.runPromise(
        Fiber.await(
          submit(
            runtime,
            patchAction(
              "Projects.optimistic-insert.failed",
              (transaction) => transaction.insert(Projects, lumen),
              Effect.fail("nope"),
            ),
          ),
        ),
      );
      expect(read(runtime, () => Projects.get("lumen"))).toBeUndefined();

      await Effect.runPromise(
        Fiber.join(
          submit(
            runtime,
            patchAction("Projects.optimistic-insert.committed", (transaction) =>
              transaction.insert(Projects, [lumen]),
            ),
          ),
        ),
      );
      expect(read(runtime, () => Projects.get("lumen"))).toMatchObject({
        name: "Lumen",
        $synced: true,
      });
    }));

  it("applies draft updaters to the visible row and ignores rows the store does not hold", () =>
    withRuntime(async (runtime) => {
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-draft",
        getKey: (project) => project.id,
        initialData: [atlas],
      });

      await Effect.runPromise(
        Fiber.join(
          submit(
            runtime,
            patchAction("Projects.optimistic-draft.bump", (transaction) =>
              Effect.all([
                transaction.update(Projects, "atlas", (draft) => ({
                  ...draft,
                  progress: draft.progress + 8,
                })),
                transaction.update(Projects, "missing", { progress: 1 }),
                transaction.delete(Projects, "missing"),
              ]),
            ),
          ),
        ),
      );

      expect(read(runtime, () => Projects.rows())).toMatchObject([{ id: "atlas", progress: 80 }]);
    }));

  it("makes a patch that changes the key or fails the output schema a defect", () =>
    withRuntime(async (runtime) => {
      const Projects = Collection.define({
        name: "Projects.optimistic-defects",
        output: ProjectSchema,
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      let ran = false;
      const keyChange = await Effect.runPromise(
        Fiber.await(
          submit(
            runtime,
            patchAction(
              "Projects.optimistic-defects.key",
              (transaction) => transaction.update(Projects, "atlas", { id: "lumen" }),
              Effect.sync(() => {
                ran = true;
              }),
            ),
          ),
        ),
      );
      const badRow = await Effect.runPromise(
        Fiber.await(
          submit(
            runtime,
            patchAction("Projects.optimistic-defects.schema", (transaction) =>
              transaction.update(Projects, "atlas", { progress: "high" as never }),
            ),
          ),
        ),
      );

      for (const exit of [keyChange, badRow]) {
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
        expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(false);
      }
      expect(Exit.isFailure(keyChange) && Cause.squash(keyChange.cause)).toBeInstanceOf(
        EffectInputCallbackError,
      );
      expect(ran).toBe(false);
      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        progress: 72,
        $synced: true,
      });
    }));

  it("runs draft updaters on a detached copy: a throwing updater is a defect and leaves the row", () =>
    withRuntime(async (runtime) => {
      const Projects = Collection.define<{ readonly id: string; readonly labels: Array<string> }>({
        name: "Projects.optimistic-detached-draft",
        getKey: (project) => project.id,
        initialData: [{ id: "atlas", labels: ["initial"] }],
      });

      const exit = await Effect.runPromise(
        Fiber.await(
          submit(
            runtime,
            patchAction("Projects.optimistic-detached-draft.label", (transaction) =>
              transaction.update(Projects, "atlas", (draft) => {
                draft.labels.push("callback-mutated");
                throw new Error("update failed");
              }),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(
        EffectInputCallbackError,
      );
      expect(read(runtime, () => Projects.get("atlas")?.labels)).toEqual(["initial"]);
    }));

  it("counts an optimistic row in the loaded row count a refresh reports", () =>
    withRuntime(async (runtime) => {
      const gate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-loaded-count",
        getKey: (project) => project.id,
        initialData: [atlas],
        sync: {
          refresh: () => Effect.succeed([{ ...atlas, name: "Atlas Remote" }]),
        },
      });
      const submission = submit(
        runtime,
        patchAction(
          "Projects.optimistic-loaded-count.insert",
          (transaction) =>
            transaction.insert(Projects, {
              id: "nova",
              name: "Nova",
              status: "blocked",
              progress: 1,
            }),
          gatedRun(gate),
        ),
      );
      await Effect.runPromise(Deferred.await(gate.started));

      const event = await Effect.runPromise(
        runtime.provide(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* subscribeCollectionEvents();
              yield* Projects.refresh();
              return yield* PubSub.take(subscription);
            }),
          ),
        ),
      );

      expect(event).toMatchObject({ _tag: "CollectionLoaded", count: 2 });
      expect(read(runtime, () => Projects.rows().map((row) => row.id))).toEqual(["atlas", "nova"]);

      Effect.runSync(Deferred.succeed(gate.release, undefined));
      await Effect.runPromise(Fiber.join(submission));
    }));

  it("rejects patches to derived live-query collections as defects", () =>
    withRuntime(async (runtime) => {
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-live-source",
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      const Names = Collection.liveQuery({
        name: "Projects.optimistic-live-names",
        getKey: (row: { readonly id: string; readonly name: string }) => row.id,
        query: (query) =>
          query
            .from({ project: Projects })
            .select(({ project }) => ({ id: project.id, name: project.name })),
      });

      const exit = await Effect.runPromise(
        Fiber.await(
          submit(
            runtime,
            patchAction("Projects.optimistic-live-names.rename", (transaction) =>
              transaction.update(Names, "atlas", { name: "Renamed" }),
            ),
          ),
        ),
      );

      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }));

  it("keeps patches on top of a replacing hydration and out of snapshots", () =>
    withRuntime(async (runtime) => {
      const gate = makeGate();
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-hydrate",
        getKey: (project) => project.id,
        initialData: [atlas],
      });
      const submission = submit(
        runtime,
        patchAction(
          "Projects.optimistic-hydrate.rename",
          (transaction) => transaction.update(Projects, "atlas", { name: "Atlas Local" }),
          gatedRun(gate),
        ),
      );
      await Effect.runPromise(Deferred.await(gate.started));

      const snapshot = await Effect.runPromise(runtime.provide(Projects.snapshot()));
      expect(snapshot.rows).toMatchObject([{ key: "atlas", value: { name: "Atlas" } }]);
      expect(snapshot).not.toHaveProperty("pendingMutations");

      await Effect.runPromise(
        runtime.provide(
          Projects.hydrate({
            ...snapshot,
            rows: [
              {
                key: "atlas",
                value: { ...atlas, progress: 99 },
                synced: true,
                origin: "remote",
              },
            ],
          }),
        ),
      );

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas Local",
        progress: 99,
        $synced: false,
      });
      expect(
        read(runtime, () => Effect.runSync(currentCollectionStore().diagnostics.snapshot)),
      ).toMatchObject({ pendingMutationCount: 1, optimisticRowCount: 1 });

      Effect.runSync(Deferred.fail(gate.release, "nope"));
      await Effect.runPromise(Fiber.await(submission));

      expect(read(runtime, () => Projects.get("atlas"))).toMatchObject({
        name: "Atlas",
        progress: 99,
        $synced: true,
      });
      expect(
        read(runtime, () => Effect.runSync(currentCollectionStore().diagnostics.snapshot)),
      ).toMatchObject({ pendingMutationCount: 0, optimisticRowCount: 0 });
    }));

  it("patches Signals and rows in one transaction that settles together", () =>
    withRuntime(async (runtime) => {
      const lastRenamed = Signal.make<string | undefined>(undefined, { name: "lastRenamed" });
      const Projects = Collection.define<Project>({
        name: "Projects.optimistic-signal-and-rows",
        getKey: (project) => project.id,
        initialData: [atlas],
      });

      await Effect.runPromise(
        Fiber.await(
          submit(
            runtime,
            patchAction(
              "Projects.optimistic-signal-and-rows.rename",
              (transaction) =>
                Effect.all([
                  transaction.update(Projects, "atlas", { name: "Renamed" }),
                  transaction.signal(lastRenamed, "atlas"),
                ]),
              Effect.fail("nope"),
            ),
          ),
        ),
      );

      expect(Signal.peek(lastRenamed)).toBeUndefined();
      expect(read(runtime, () => Projects.get("atlas")?.name)).toBe("Atlas");
    }));
});

describe("Action.planOptimistic with Collection patches", () => {
  it("reports row changes without touching any store", () => {
    const Projects = Collection.define<Project>({
      name: "Projects.plan-optimistic",
      getKey: (project) => project.id,
      initialData: [atlas],
    });
    const orion: Project = { id: "orion", name: "Orion", status: "blocked", progress: 0 };
    const Rework = Action.define({
      name: "Projects.plan-optimistic.rework",
      optimistic: (name: string, transaction) =>
        Effect.gen(function* () {
          yield* transaction.update(Projects, "atlas", { name });
          yield* transaction.insert(Projects, orion);
          yield* transaction.delete(Projects, "atlas");
        }),
      run: (_name: string) => Effect.void,
    });

    const changes = Effect.runSync(Action.planOptimistic(Rework, "Atlas 2"));

    expect(changes).toEqual([
      { _tag: "Update", rows: Projects, key: "atlas", update: { name: "Atlas 2" } },
      { _tag: "Insert", rows: Projects, values: [orion] },
      { _tag: "Delete", rows: Projects, key: "atlas" },
    ]);
  });
});
