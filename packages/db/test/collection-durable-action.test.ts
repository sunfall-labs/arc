import {
  Action,
  ActionQueued,
  ActionTransport,
  makeRuntime,
  runWithRuntime,
  ServerTransportError,
  type ActionTransportResponse,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Effect, Exit, Layer, Option, Schedule, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { describe, expect, it } from "vitest";

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  progress: Schema.Number,
});
type Project = typeof ProjectSchema.Type;

const atlas: Project = { id: "atlas", name: "Atlas", progress: 72 };

/** A server that is offline until `online` flips, and counts what it applies. */
const fakeServer = () => {
  const state = { online: false, applied: [] as Array<string> };
  const layer = Layer.succeed(ActionTransport)({
    submit: (_definition, input, submission) =>
      Option.some(
        Effect.suspend(() => {
          if (!state.online) {
            return Effect.fail(new ServerTransportError({ reason: "Network", message: "offline" }));
          }
          state.applied.push(submission!.id);
          return Effect.succeed({
            exit: Exit.succeed(input),
            apply: () => Effect.void,
          } as ActionTransportResponse<any, any>);
        }),
      ),
  });
  return { state, layer };
};

/** One page load: the collection definition and the durable Action patching it. */
const defineApp = (suffix: string) => {
  const Projects = Collection.define({
    name: `Projects.durable.${suffix}`,
    output: ProjectSchema,
    getKey: (project: Project) => project.id,
  });
  const Advance = Action.define({
    name: `Projects.durable.${suffix}.advance`,
    input: Schema.Struct({ id: Schema.String }),
    durable: { maxAge: "1 day" },
    optimistic: ({ id }, transaction) =>
      transaction.update(Projects, id, (project) => ({
        ...project,
        progress: project.progress + 8,
      })),
    run: ({ id }) => Effect.succeed(id),
  });
  return { Projects, Advance };
};

const read = <A>(runtime: SunfallArcRuntime<any, any>, f: () => A): A => runWithRuntime(runtime, f);

describe("durable Actions over Collections", () => {
  it("re-applies a pending row patch on top of hydrated rows after a reload", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        // One in-memory KeyValueStore outlives both page loads.
        const store = yield* KeyValueStore.KeyValueStore.pipe(
          Effect.provide(KeyValueStore.layerMemory),
        );
        const server = fakeServer();
        const outbox = () =>
          Action.outboxLayer({ retry: Schedule.spaced("5 millis") }).pipe(
            Layer.provide(Layer.succeed(KeyValueStore.KeyValueStore)(store)),
          );
        const snapshot = {
          name: "",
          rows: [{ key: "atlas", value: atlas, synced: true, origin: "remote" as const }],
          updatedAt: 1,
        };

        const first = defineApp("reload");
        const before = makeRuntime(Layer.mergeAll(server.layer, outbox()));
        yield* before.provide(
          first.Projects.hydrate({ ...snapshot, name: first.Projects.name } as never),
        );
        const queued = yield* Effect.flip(
          Action.use(first.Advance, { runtime: before }).submit({ id: "atlas" }),
        );
        expect(queued).toBeInstanceOf(ActionQueued);
        expect(read(before, () => first.Projects.get("atlas"))).toMatchObject({
          progress: 80,
          $synced: false,
        });
        // Snapshots carry the synced base only.
        expect((yield* before.provide(first.Projects.snapshot())).rows[0]!.value.progress).toBe(72);
        yield* before.dispose;

        // Reload: hydrate the server's rows, then restore the outbox.
        const second = defineApp("reload");
        const after = makeRuntime(Layer.mergeAll(server.layer, outbox()));
        yield* after.provide(
          second.Projects.hydrate({ ...snapshot, name: second.Projects.name } as never),
        );
        yield* after.provide(Action.restoreOutbox());
        expect(read(after, () => second.Projects.get("atlas"))).toMatchObject({
          progress: 80,
          $synced: false,
        });

        server.state.online = true;
        const view = yield* after.provide(Action.outbox);
        for (let attempt = 0; attempt < 400 && view.pending.get().length > 0; attempt++) {
          yield* Effect.sleep("2 millis");
        }
        expect(view.pending.get()).toEqual([]);
        expect(server.state.applied).toHaveLength(1);
        expect(read(after, () => second.Projects.get("atlas"))).toMatchObject({
          progress: 80,
          $synced: true,
        });
        yield* after.dispose;
      }),
    ));

  it("persists the queue through KeyValueStore.layerStorage (Web Storage)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const memory = new Map<string, string>();
        const webStorage = {
          get length() {
            return memory.size;
          },
          clear: () => memory.clear(),
          getItem: (key: string) => memory.get(key) ?? null,
          key: (index: number) => Array.from(memory.keys())[index] ?? null,
          removeItem: (key: string) => void memory.delete(key),
          setItem: (key: string, value: string) => void memory.set(key, value),
        } satisfies Storage;
        const server = fakeServer();
        const { Projects, Advance } = defineApp("memory");
        const runtime = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer().pipe(Layer.provide(KeyValueStore.layerStorage(() => webStorage))),
          ),
        );
        yield* runtime.provide(
          Projects.hydrate({
            name: Projects.name,
            rows: [{ key: "atlas", value: atlas, synced: true, origin: "remote" }],
            updatedAt: 1,
          } as never),
        );
        yield* Effect.flip(Action.use(Advance, { runtime }).submit({ id: "atlas" }));
        const stored = JSON.parse(memory.get("arc/actions/v1/queue")!);
        expect(stored.submissions).toMatchObject([
          { action: Advance.name, input: { id: "atlas" }, attempts: 1 },
        ]);
        yield* runtime.dispose;
      }),
    ));
});
