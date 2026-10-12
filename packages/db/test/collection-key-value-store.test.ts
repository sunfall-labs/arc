import {
  Action,
  ActionQueued,
  ActionTransport,
  makeRuntime,
  runWithRuntime,
  ServerTransportError,
} from "@sunfall/arc-core";
import { Collection, CollectionSnapshotCodecError } from "@sunfall/arc-db";
import { Effect, Layer, Option, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { describe, expect, it } from "vitest";
import { collectionStoreKey } from "./key-value-store.js";

const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  dueAt: Schema.Date,
});
type Project = typeof Project.Type;

const atlas: Project = { id: "atlas", name: "Atlas", dueAt: new Date("2026-01-02T03:04:05.000Z") };

/** A Web `Storage` over a Map, for `KeyValueStore.layerStorage`. */
const webStorage = () => {
  const memory = new Map<string, string>();
  const storage = {
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
    getItem: (key: string) => memory.get(key) ?? null,
    key: (index: number) => Array.from(memory.keys())[index] ?? null,
    removeItem: (key: string) => void memory.delete(key),
    setItem: (key: string, value: string) => void memory.set(key, value),
  } satisfies Storage;
  return { memory, storage };
};

const defineProjects = (name: string, persistence: Collection.PersistenceConfig = {}) =>
  Collection.define({
    name,
    output: Project,
    getKey: (project: Project) => project.id,
    persistence,
  });

const ids = (runtime: ReturnType<typeof makeRuntime<any, any>>, projects: Collection.Any) =>
  runWithRuntime(runtime, () => projects.rows().map((row) => row.$key));

describe("Collection persistence on KeyValueStore", () => {
  it("round-trips a snapshot through KeyValueStore.layerMemory, rows through their schema", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        // One memory store outlives both runtimes ("page loads").
        const store = yield* KeyValueStore.KeyValueStore.pipe(
          Effect.provide(KeyValueStore.layerMemory),
        );
        const layer = Layer.succeed(KeyValueStore.KeyValueStore)(store);
        const Projects = defineProjects("Projects.kv.memory");
        const first = makeRuntime(layer);
        const second = makeRuntime(layer);

        yield* first.provide(Projects.applyChanges([{ _tag: "Upsert", value: atlas }]));
        const stored = yield* store.get(collectionStoreKey("Projects.kv.memory"));
        expect(JSON.parse(stored!).rows[0].value.dueAt).toBe("2026-01-02T03:04:05.000Z");

        yield* second.provide(Projects.preload());
        const restored = runWithRuntime(second, () => Projects.get("atlas"));
        expect(restored?.dueAt).toBeInstanceOf(Date);
        expect(restored?.dueAt.toISOString()).toBe(atlas.dueAt.toISOString());

        yield* first.dispose;
        yield* second.dispose;
      }),
    ));

  it("round-trips explicit persist/restore through KeyValueStore.layerStorage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { memory, storage } = webStorage();
        const layer = KeyValueStore.layerStorage(() => storage);
        const Projects = defineProjects("Projects.kv.storage", { restoreOnPreload: false });
        const first = makeRuntime(layer);
        const second = makeRuntime(layer);

        yield* first.provide(
          Projects.hydrate({
            name: Projects.name,
            rows: [{ key: "atlas", value: atlas, synced: true, origin: "remote" }],
            updatedAt: 1,
          }),
        );
        yield* first.provide(Projects.persist({ key: "cache" }));
        expect(Array.from(memory.keys())).toEqual([collectionStoreKey("cache")]);

        yield* second.provide(Projects.restore({ key: "cache" }));
        expect(ids(second, Projects)).toEqual(["atlas"]);

        yield* first.dispose;
        yield* second.dispose;
      }),
    ));

  it("isolates snapshot versions by prefix: a bumped version never reads the old one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { memory, storage } = webStorage();
        const layer = KeyValueStore.layerStorage(() => storage);
        const V1 = defineProjects("Projects.kv.version", { key: "projects" });
        const writer = makeRuntime(layer);
        yield* writer.provide(V1.applyChanges([{ _tag: "Upsert", value: atlas }]));
        yield* writer.dispose;
        expect(memory.has(collectionStoreKey("projects", 1))).toBe(true);

        const V2 = defineProjects("Projects.kv.version", { key: "projects", version: 2 });
        const reader = makeRuntime(layer);
        yield* reader.provide(V2.preload());
        expect(ids(reader, V2)).toEqual([]);
        expect(memory.has(collectionStoreKey("projects", 2))).toBe(false);

        // Explicit options win over the config: version 1 is still readable on purpose.
        yield* reader.provide(V2.restore({ version: 1 }));
        expect(ids(reader, V2)).toEqual(["atlas"]);
        yield* reader.dispose;
      }),
    ));

  it("fails restore with a codec error for an unreadable stored snapshot", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { memory, storage } = webStorage();
        memory.set(collectionStoreKey("Projects.kv.corrupt"), "{not json");
        const Projects = defineProjects("Projects.kv.corrupt", { restoreOnPreload: false });
        const runtime = makeRuntime(KeyValueStore.layerStorage(() => storage));

        const failure = yield* Effect.flip(runtime.provide(Projects.restore()));
        expect(failure).toBeInstanceOf(CollectionSnapshotCodecError);
        expect(failure).toMatchObject({ operation: "decode", path: "$" });
        yield* runtime.dispose;
      }),
    ));

  it("shares one store with the Action Outbox without key collisions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { memory, storage } = webStorage();
        const store = KeyValueStore.layerStorage(() => storage);
        // A collection keyed "queue" next to the outbox's own "queue" record.
        const Projects = defineProjects("Projects.kv.shared", { key: "queue" });
        const Advance = Action.define({
          name: "Projects.kv.shared.advance",
          input: Schema.Struct({ id: Schema.String }),
          durable: { maxAge: "1 day" },
          run: ({ id }) => Effect.succeed(id),
        });
        const offline = Layer.succeed(ActionTransport)({
          submit: () =>
            Option.some(
              Effect.fail(new ServerTransportError({ reason: "Network", message: "offline" })),
            ),
        });
        const runtime = makeRuntime(
          Layer.mergeAll(offline, Action.outboxLayer().pipe(Layer.provide(store)), store),
        );

        yield* runtime.provide(Projects.applyChanges([{ _tag: "Upsert", value: atlas }]));
        const queued = yield* Effect.flip(Action.use(Advance, { runtime }).submit({ id: "atlas" }));
        expect(queued).toBeInstanceOf(ActionQueued);

        expect(Array.from(memory.keys()).sort()).toEqual([
          "arc/actions/v1/queue",
          collectionStoreKey("queue"),
        ]);
        expect(JSON.parse(memory.get("arc/actions/v1/queue")!).submissions).toMatchObject([
          { action: Advance.name, input: { id: "atlas" } },
        ]);
        expect(JSON.parse(memory.get(collectionStoreKey("queue"))!).name).toBe(Projects.name);
        yield* runtime.dispose;
      }),
    ));
});
