import { Effect, Exit, Layer, Option, Schedule, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionQueued,
  ActionTransport,
  makeRuntime,
  Resource,
  ServerTransportError,
  Signal,
  type SunfallArcRuntime,
} from "../src/index.js";
import { eraseRuntime } from "../src/internal.js";

const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  progress: Schema.Number,
  // Encoded as a string in storage, decoded back into a Date.
  updatedAt: Schema.DateFromString,
});
type Project = typeof Project.Type;

const atlas: Project = {
  id: "atlas",
  name: "Atlas",
  progress: 72,
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
};

let families = 0;

/** One page load's definitions: a persisted rows Resource over a server that can hang. */
const definePage = (name: string, server: { rows: ReadonlyArray<Project>; hang: boolean }) => {
  const loads = { count: 0 };
  const Projects = Resource.define({
    name,
    input: Schema.Literal("all"),
    output: Schema.Array(Project),
    rows: { key: (project) => project.id },
    policy: { persist: { key: "projects", version: 2 } },
    load: () =>
      Effect.suspend(() => {
        loads.count++;
        return server.hang ? Effect.never : Effect.succeed(server.rows);
      }),
  });
  return { Projects, ref: Projects("all"), loads };
};

const visible = <A>(
  runtime: SunfallArcRuntime<any, any>,
  ref: Resource.Ref<"all", A, never, any>,
) =>
  Option.getOrUndefined(
    AsyncResult.value(
      eraseRuntime(runtime).runSync(Effect.sync(() => Signal.peek(Resource.result(ref)))),
    ),
  );

const memoryStore = KeyValueStore.KeyValueStore.pipe(Effect.provide(KeyValueStore.layerMemory));

describe("Resource policy.persist", () => {
  it("restores a persisted value at once, through the output schema, and reloads it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* memoryStore;
        const storeLayer = Layer.succeed(KeyValueStore.KeyValueStore)(store);
        const server = { rows: [atlas] as ReadonlyArray<Project>, hang: false };
        const name = `Persist.projects.${++families}`;

        const first = definePage(name, server);
        const before = makeRuntime(storeLayer);
        yield* before.provide(Resource.preload(first.ref));
        yield* before.dispose;
        expect(yield* store.get(`arc/resources/v2/projects/${first.ref.key}`)).toContain(
          "2026-10-01T00:00:00.000Z",
        );

        // Next page load: the server hangs, but the persisted rows show at once.
        server.hang = true;
        const second = definePage(name, server);
        const after = makeRuntime(storeLayer);
        const restored = yield* after.provide(Resource.preload(second.ref));
        expect(restored).toEqual([atlas]);
        expect(restored[0]!.updatedAt).toBeInstanceOf(Date);
        // ...and a background reload revalidates them.
        yield* Effect.sleep("1 millis");
        expect(second.loads.count).toBe(1);
        const result = eraseRuntime(after).runSync(
          Effect.sync(() => Signal.peek(Resource.result(second.ref))),
        );
        expect(result._tag === "Success" && result.waiting).toBe(true);
        yield* after.dispose;
      }),
    ));

  it("never reads another version's values and ignores unreadable ones", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* memoryStore;
        const server = { rows: [atlas] as ReadonlyArray<Project>, hang: false };
        const name = `Persist.versions.${++families}`;
        const page = definePage(name, server);
        yield* store.set(
          `arc/resources/v1/projects/${page.ref.key}`,
          JSON.stringify({ stale: true }),
        );
        // An unreadable value under the current version is ignored.
        yield* store.set(`arc/resources/v2/projects/${page.ref.key}`, "{not json");
        const runtime = makeRuntime(Layer.succeed(KeyValueStore.KeyValueStore)(store));
        expect(yield* runtime.provide(Resource.preload(page.ref))).toEqual([atlas]);
        expect(page.loads.count).toBe(1);
        yield* runtime.dispose;
      }),
    ));

  it("re-applies a durable Action's pending row patch on top of the restored rows", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        // One in-memory KeyValueStore outlives both page loads.
        const store = yield* memoryStore;
        const storeLayer = Layer.succeed(KeyValueStore.KeyValueStore)(store);
        const network = { online: false, applied: [] as Array<string> };
        const transport = Layer.succeed(ActionTransport)({
          submit: (_definition, input, submission) =>
            Option.some(
              Effect.suspend(() => {
                if (!network.online) {
                  return Effect.fail(
                    new ServerTransportError({ reason: "Network", message: "offline" }),
                  );
                }
                network.applied.push(submission!.id);
                return Effect.succeed({
                  exit: Exit.succeed(input),
                  apply: () => Effect.void,
                } as Action.TransportResponse<any, any>);
              }),
            ),
        });
        const layer = () =>
          Layer.mergeAll(
            storeLayer,
            transport,
            Action.outboxLayer({ retry: Schedule.spaced("5 millis") }).pipe(
              Layer.provide(storeLayer),
            ),
          );
        const server = { rows: [atlas] as ReadonlyArray<Project>, hang: false };
        const name = `Persist.durable.${++families}`;
        const defineAdvance = (ref: Resource.RowsRef<Project, string>) =>
          Action.define({
            name: `${name}.advance`,
            input: Schema.Struct({ id: Schema.String }),
            durable: { maxAge: "1 day" },
            optimistic: ({ id }, transaction) =>
              transaction.update(ref, id, (project) => ({
                ...project,
                progress: project.progress + 8,
              })),
            run: ({ id }) => Effect.succeed(id),
          });

        const first = definePage(name, server);
        const before = makeRuntime(layer());
        yield* before.provide(Resource.preload(first.ref));
        const queued = yield* Effect.flip(
          Action.use(defineAdvance(first.ref), { runtime: before }).submit({ id: "atlas" }),
        );
        expect(queued).toBeInstanceOf(ActionQueued);
        expect(visible(before, first.ref)?.[0]?.progress).toBe(80);
        yield* before.dispose;

        // Reload while still offline: restore the rows, then the outbox.
        server.hang = true;
        const second = definePage(name, server);
        defineAdvance(second.ref);
        const after = makeRuntime(layer());
        yield* after.provide(Resource.preload(second.ref));
        // The persisted value is the synced one: the patch was never stored.
        expect(visible(after, second.ref)?.[0]?.progress).toBe(72);
        yield* after.provide(Action.restoreOutbox());
        expect(visible(after, second.ref)?.[0]?.progress).toBe(80);

        network.online = true;
        const view = yield* after.provide(Action.outbox);
        for (let attempt = 0; attempt < 400 && view.pending.get().length > 0; attempt++) {
          yield* Effect.sleep("2 millis");
        }
        expect(view.pending.get()).toEqual([]);
        expect(network.applied).toHaveLength(1);
        expect(visible(after, second.ref)?.[0]?.progress).toBe(80);
        yield* after.dispose;
      }),
    ));
});
