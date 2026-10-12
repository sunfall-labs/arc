import { Action, makeRuntime, Resource } from "@sunfall/arc-core";
import { QueryEvaluationError } from "@sunfall/arc-db";
import { Cause, Data, Deferred, Effect, Fiber, Schema } from "effect";
import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { bindInInstance } from "./instance-harness.js";

const Project = Schema.Struct({ id: Schema.String, name: Schema.String, active: Schema.Boolean });
type Project = typeof Project.Type;

class ProjectsDown extends Data.TaggedError("ProjectsDown") {}

let families = 0;

/** A rows Resource over a mutable server list, counting loads. */
const projectRows = (initial: ReadonlyArray<Project>) => {
  const server = { rows: initial, loads: 0, fail: false };
  const Projects = Resource.define({
    name: `SolidLiveQuery.projects.${++families}`,
    input: Schema.Literal("all"),
    output: Schema.Array(Project),
    rows: { key: (project) => project.id, indexes: { active: (project) => project.active } },
    load: () =>
      Effect.suspend(() => {
        server.loads++;
        return server.fail ? Effect.fail(new ProjectsDown()) : Effect.succeed(server.rows);
      }),
  });
  return { server, Projects, ref: Projects("all") };
};

const atlas: Project = { id: "atlas", name: "Atlas", active: true };
const lumen: Project = { id: "lumen", name: "Lumen", active: false };

/** Binds a live query in a fresh instance under a Solid root; returns it with the root's dispose. */
const bind = <T, E, R>(
  runtime: object,
  input: Component.LiveQueryInput<T, E, R>,
  options?: Component.LiveQueryOptions,
) =>
  createRoot((dispose) => ({
    handle: bindInInstance(runtime, Component.liveQuery(input, options)),
    dispose,
  }));

describe("Component.liveQuery", () => {
  it("preloads its sources on mount and follows reloads and optimistic row patches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, Projects, ref } = projectRows([atlas, lumen]);
        const runtime = makeRuntime();
        const { handle, dispose } = bind(runtime, (query) =>
          query
            .from({ project: ref })
            .where(({ project }) => project.active)
            .select(({ project }) => project.name)
            .orderBy(({ project }) => project.name),
        );
        yield* Effect.sleep("5 millis");
        expect(server.loads).toBe(1);
        expect(handle.rows()).toEqual(["Atlas"]);
        expect(handle.waiting()).toBe(false);

        server.rows = [atlas, { ...lumen, active: true }];
        yield* runtime.provide(Resource.refresh(Projects("all")));
        flush();
        expect(handle.rows()).toEqual(["Atlas", "Lumen"]);

        const gate = yield* Deferred.make<void>();
        const Archive = Action.define({
          name: `SolidLiveQuery.archive.${families}`,
          optimistic: (id: string, transaction) => transaction.update(ref, id, { active: false }),
          run: () => Deferred.await(gate),
        });
        const submission = runtime.runFork(Action.use(Archive, { runtime }).submit("atlas"));
        yield* Effect.sleep("0 millis");
        flush();
        expect(handle.rows()).toEqual(["Lumen"]);

        yield* Fiber.interrupt(submission);
        flush();
        expect(handle.rows()).toEqual(["Atlas", "Lumen"]);
        dispose();
      }),
    ));

  it("reports a never-loaded source's failure and rebuilds when a factory signal changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { server, ref } = projectRows([atlas, lumen]);
        server.fail = true;
        const runtime = makeRuntime();
        const [onlyActive, setOnlyActive] = createSignal(true);
        const { handle, dispose } = bind(runtime, (query) => {
          const activeOnly = onlyActive();
          return query
            .from({ project: ref })
            .where(({ project }) => !activeOnly || project.active)
            .select(({ project }) => project.name)
            .orderBy(({ project }) => project.name);
        });
        yield* Effect.sleep("5 millis");
        expect(Cause.squash(handle.failure()!)).toBeInstanceOf(ProjectsDown);

        server.fail = false;
        yield* handle.refresh();
        flush();
        expect(handle.failure()).toBeUndefined();
        expect(handle.rows()).toEqual(["Atlas"]);
        setOnlyActive(false);
        flush();
        expect(handle.rows()).toEqual(["Atlas", "Lumen"]);
        dispose();
      }),
    ));

  it("reports an invalid query plan as a defect without loading its sources", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const projects = projectRows([atlas]);
        const tasks = projectRows([lumen]);
        const runtime = makeRuntime();
        const { handle, dispose } = bind(runtime, (query) =>
          query
            .from({ project: projects.ref })
            .joinIndexed("task", tasks.ref, ({ project }) => project.id, "missing" as never)
            .select(({ project }) => project.name),
        );
        yield* Effect.sleep("5 millis");
        expect(Cause.hasDies(handle.failure()!)).toBe(true);
        expect(Cause.squash(handle.failure()!)).toBeInstanceOf(QueryEvaluationError);
        expect(projects.server.loads + tasks.server.loads).toBe(0);
        dispose();
      }),
    ));
});
