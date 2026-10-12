import { Deferred, Effect, Exit, Fiber, Option, Queue, Schema, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vitest";
import { Action, makeRuntime, Resource, Signal, Timeline } from "../src/index.js";
import {
  defaultRuntime,
  makeRequestResourceStore,
  resourceRowsGet,
  resourceRowsIndex,
  withResourceStore,
} from "../src/internal.js";

const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["active", "archived"]),
  tags: Schema.Array(Schema.String),
});
type Project = typeof Project.Type;

const atlas: Project = { id: "atlas", name: "Atlas", status: "active", tags: ["core"] };
const orion: Project = { id: "orion", name: "Orion", status: "archived", tags: [] };

let families = 0;

/** A rows Resource over a mutable server list. */
const makeFixture = (
  changes?: (
    input: "all",
    rows: ReadonlyArray<Project>,
  ) => Stream.Stream<ReadonlyArray<Resource.RowChange<Project, string>>>,
) => {
  const suffix = `${++families}`;
  const server = { rows: [atlas, orion] as ReadonlyArray<Project>, loads: 0 };
  const ProjectList = Resource.define({
    name: `ResourceRows.list.${suffix}`,
    input: Schema.Literal("all"),
    output: Schema.Array(Project),
    rows: {
      key: (project) => project.id,
      indexes: { status: (project) => project.status, tag: (project) => project.tags },
      ...(changes === undefined ? {} : { changes }),
    },
    load: () =>
      Effect.sync(() => {
        server.loads++;
        return server.rows.map((row) => ({ ...row }));
      }),
  });
  const ref = ProjectList("all");
  const rows = () =>
    Option.getOrUndefined(AsyncResult.value(Signal.peek(Resource.result(ref)))) ?? [];
  const options = ProjectList.family.options.rows!;
  const name = ProjectList.family.options.name;
  return {
    server,
    ProjectList,
    ref,
    rows,
    get: (key: string): Project | undefined => resourceRowsGet(name, options, rows(), key),
    index: (index: string, value: unknown): ReadonlyArray<Project> =>
      resourceRowsIndex(name, options, rows(), index, value),
  };
};

describe("Resource rows", () => {
  it("looks rows up by key and by index, in value order", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* Resource.preload(fixture.ref);
        expect(fixture.get("orion")).toEqual(orion);
        expect(fixture.get("vega")).toBeUndefined();
        expect(fixture.index("status", "active").map((row) => row.id)).toEqual(["atlas"]);
        expect(fixture.index("status", "archived").map((row) => row.id)).toEqual(["orion"]);
        // A selector that returns several values puts the row in several buckets.
        expect(fixture.index("tag", "core").map((row) => row.id)).toEqual(["atlas"]);
        expect(fixture.index("tag", "none")).toEqual([]);
        expect(() => fixture.index("owner", "x")).toThrow();
      }),
    ));

  it("keeps the identity of unchanged rows across reloads", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const first = yield* Resource.preload(fixture.ref);
        // Nothing changed: the reload returns new objects, the value keeps the old array.
        const same = yield* Resource.refresh(fixture.ref);
        expect(same).toBe(first);

        fixture.server.rows = [{ ...atlas, name: "Atlas 2" }, orion];
        const next = yield* Resource.refresh(fixture.ref);
        expect(next).not.toBe(first);
        expect(next[0]).toEqual({ ...atlas, name: "Atlas 2" });
        expect(next[1]).toBe(first[1]);
        // A changed row still reuses its unchanged parts.
        expect(next[0]!.tags).toBe(first[0]!.tags);

        // Rows match by key, not position: a reorder keeps every row.
        fixture.server.rows = [orion, { ...atlas, name: "Atlas 2" }];
        const reordered = yield* Resource.refresh(fixture.ref);
        expect(reordered).not.toBe(next);
        expect(reordered[0]).toBe(next[1]);
        expect(reordered[1]).toBe(next[0]);
      }),
    ));

  it("patches one row by key, follows reloads underneath, and folds on success", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const Rename = Action.define({
          name: `ResourceRows.rename.${families}`,
          optimistic: (input: { readonly name: string }, transaction) =>
            transaction.update(fixture.ref, "atlas", { name: input.name }),
          run: (input: { readonly name: string; readonly gate: Deferred.Deferred<void> }) =>
            Effect.as(Deferred.await(input.gate), input.name),
        });
        const before = yield* Resource.preload(fixture.ref);
        // Build the status index so the patch derives it instead of rebuilding.
        expect(fixture.index("status", "active")[0]?.name).toBe("Atlas");

        const gate = yield* Deferred.make<void>();
        const rename = Action.use(Rename, { runtime: defaultRuntime });
        const fiber = yield* Effect.forkChild(rename.submit({ name: "Atlas 2", gate }));
        yield* Effect.yieldNow;
        expect(fixture.get("atlas")?.name).toBe("Atlas 2");
        expect(fixture.index("status", "active")[0]?.name).toBe("Atlas 2");
        // The untouched row keeps its identity through the patch.
        expect(fixture.get("orion")).toBe(before[1]);

        // A reload replaces the rows underneath; the patch stays on top.
        fixture.server.rows = [atlas, { ...orion, name: "Orion 2" }];
        yield* Resource.refresh(fixture.ref);
        expect(fixture.get("atlas")?.name).toBe("Atlas 2");
        expect(fixture.get("orion")?.name).toBe("Orion 2");

        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(fiber);
        // Success folds the patch into the synced rows until the next reload.
        expect(fixture.get("atlas")?.name).toBe("Atlas 2");
        yield* Resource.refresh(fixture.ref);
        expect(fixture.get("atlas")?.name).toBe("Atlas");
      }),
    ));

  it("rolls inserts, deletes, and updates back on failure and rebases later patches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const vega: Project = { id: "vega", name: "Vega", status: "active", tags: [] };
        const Edit = Action.define({
          name: `ResourceRows.edit.${families}`,
          policy: { concurrency: "parallel" },
          optimistic: (input: { readonly fail: boolean; readonly step: number }, transaction) =>
            input.step === 1
              ? Effect.all([
                  transaction.insert(fixture.ref, vega),
                  transaction.delete(fixture.ref, "orion"),
                ])
              : transaction.update(fixture.ref, "vega", (row) => ({ ...row, name: "Vega 2" })),
          run: (input: {
            readonly fail: boolean;
            readonly step: number;
            readonly gate: Deferred.Deferred<void>;
          }) =>
            Effect.flatMap(Deferred.await(input.gate), () =>
              input.fail ? Effect.fail("rejected") : Effect.succeed(input.step),
            ),
        });
        yield* Resource.preload(fixture.ref);
        const edit = Action.use(Edit, { runtime: defaultRuntime });
        const firstGate = yield* Deferred.make<void>();
        const secondGate = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(
          edit.submit({ fail: true, step: 1, gate: firstGate }),
        );
        yield* Effect.yieldNow;
        const second = yield* Effect.forkChild(
          edit.submit({ fail: false, step: 2, gate: secondGate }),
        );
        yield* Effect.yieldNow;
        expect(fixture.rows().map((row) => row.name)).toEqual(["Atlas", "Vega 2"]);

        // The first submission fails: its insert and delete roll back, and the
        // second's update of a row that no longer exists does nothing.
        yield* Deferred.succeed(firstGate, undefined);
        expect(Exit.isFailure(yield* Fiber.await(first))).toBe(true);
        expect(fixture.rows().map((row) => row.name)).toEqual(["Atlas", "Orion"]);

        yield* Deferred.succeed(secondGate, undefined);
        yield* Fiber.join(second);
        expect(fixture.rows().map((row) => row.name)).toEqual(["Atlas", "Orion"]);
      }),
    ));

  it("makes an update that changes a row's key a defect", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const Rekey = Action.define({
          name: `ResourceRows.rekey.${families}`,
          optimistic: (_: void, transaction) =>
            transaction.update(fixture.ref, "atlas", { id: "atlas-2" }),
          run: () => Effect.void,
        });
        yield* Resource.preload(fixture.ref);
        const exit = yield* Effect.exit(Action.use(Rekey, { runtime: defaultRuntime }).submit());
        expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true);
        expect(fixture.get("atlas")?.name).toBe("Atlas");
      }),
    ));

  it("reports row changes from planOptimistic without touching the entry", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const Archive = Action.define({
          name: `ResourceRows.archive.${families}`,
          optimistic: (id: string, transaction) =>
            transaction.update(fixture.ref, id, { status: "archived" }),
          run: () => Effect.void,
        });
        yield* Resource.preload(fixture.ref);
        const changes = yield* Action.planOptimistic(Archive, "atlas");
        expect(changes).toEqual([
          { _tag: "Update", target: fixture.ref, key: "atlas", update: { status: "archived" } },
        ]);
        expect(fixture.get("atlas")?.status).toBe("active");
      }),
    ));

  it("applies a change feed to the synced rows under a `change` commit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ReadonlyArray<Resource.RowChange<Project, string>>>();
        const fixture = makeFixture(() => Stream.fromQueue(queue));
        const runtime = makeRuntime();
        const recording = yield* Timeline.record();
        yield* runtime.provide(Resource.preload(fixture.ref));
        const read = () =>
          runtime.runSync(Resource.read(fixture.ref)).map((row) => `${row.id}:${row.name}`);

        yield* Queue.offer(queue, [
          { _tag: "Update", key: "atlas", changes: { name: "Atlas 2" } },
          { _tag: "Upsert", value: { id: "vega", name: "Vega", status: "active", tags: [] } },
          { _tag: "Delete", key: "orion" },
        ]);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
        expect(read()).toEqual(["atlas:Atlas 2", "vega:Vega"]);
        expect(
          Signal.peek(recording.entries).some(
            (entry) => entry.cause._tag === "Resource" && entry.cause.event === "change",
          ),
        ).toBe(true);

        // The feed belongs to the runtime's store: disposing it stops the feed.
        yield* runtime.dispose;
        yield* Queue.offer(queue, [{ _tag: "Delete", key: "atlas" }]);
        expect(fixture.server.loads).toBe(1);
      }).pipe(Effect.scoped),
    ));
  it("starts a change feed from the rows it loaded", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started: Array<ReadonlyArray<string>> = [];
        const fixture = makeFixture((_input, rows) => {
          started.push(rows.map((row) => row.id));
          return Stream.never;
        });
        const runtime = makeRuntime();
        yield* runtime.provide(Resource.preload(fixture.ref));
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
        expect(started).toEqual([["atlas", "orion"]]);
        yield* runtime.dispose;
      }),
    ));

  it("starts a hydrated entry's change feed from the hydrated rows, without loading", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ReadonlyArray<Resource.RowChange<Project, string>>>();
        const started: Array<ReadonlyArray<string>> = [];
        const fixture = makeFixture((_input, rows) => {
          started.push(rows.map((row) => row.id));
          return Stream.fromQueue(queue);
        });
        // A server request's store loads and hydrates but never follows the feed.
        const server = withResourceStore(makeRuntime(), makeRequestResourceStore());
        yield* server.provide(Resource.preload(fixture.ref));
        const payload = yield* server.provide(Resource.hydrationPayload([fixture.ref]));
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
        expect(started).toEqual([]);
        yield* server.dispose;

        const browser = makeRuntime();
        yield* browser.provide(Resource.hydrate(payload));
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
        // Only the hydrated browser entry follows the feed.
        expect(started).toEqual([["atlas", "orion"]]);
        yield* Queue.offer(queue, [{ _tag: "Delete", key: "orion" }]);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
        expect(browser.runSync(Resource.read(fixture.ref)).map((row) => row.id)).toEqual(["atlas"]);
        expect(fixture.server.loads).toBe(1);
        yield* browser.dispose;
      }),
    ));
});
