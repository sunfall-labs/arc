import { Data, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vitest";
import { Action, Resource, Signal } from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";
import { shareResourceValue } from "../src/resource-value-sharing.js";

class Point extends Data.Class<{ readonly x: number; readonly y: number }> {}
class Owner extends Schema.Class<Owner>("ResourceValueSharing/Owner")({ name: Schema.String }) {}

describe("shareResourceValue", () => {
  it("returns the previous value when the next one is deep-equal", () => {
    const previous = { id: "a", tags: ["x"], owner: { name: "Ada" }, at: new Date(1) };
    const next = { id: "a", tags: ["x"], owner: { name: "Ada" }, at: new Date(1) };
    expect(shareResourceValue(previous, next)).toBe(previous);
  });

  it("reuses unchanged subtrees of a changed value", () => {
    const previous = { id: "a", name: "A", owner: { name: "Ada" }, tags: ["x", "y"] };
    const shared = shareResourceValue(previous, {
      id: "a",
      name: "B",
      owner: { name: "Ada" },
      tags: ["x", "z"],
    });
    expect(shared).toEqual({ id: "a", name: "B", owner: { name: "Ada" }, tags: ["x", "z"] });
    expect(shared).not.toBe(previous);
    expect(shared.owner).toBe(previous.owner);
    expect(shared.tags).not.toBe(previous.tags);
  });

  it("returns the next value itself when none of its parts can be reused", () => {
    const owner = { name: "Ada" };
    const next = { id: "a", owner };
    // Every part is either new or already the previous object: nothing to splice.
    expect(shareResourceValue<object>({ id: "a", owner, extra: 1 }, next)).toBe(next);
    const fresh = { id: "b", owner: { name: "Grace" } };
    expect(shareResourceValue({ id: "a", owner }, fresh)).toBe(fresh);
  });

  it("keeps Dates, Data classes, and Schema classes that are Equal", () => {
    const previous = {
      at: new Date(5),
      point: new Point({ x: 1, y: 2 }),
      owner: new Owner({ name: "Ada" }),
    };
    const next = {
      at: new Date(5),
      point: new Point({ x: 1, y: 2 }),
      owner: new Owner({ name: "Ada" }),
    };
    expect(shareResourceValue(previous, next)).toBe(previous);

    const moved = shareResourceValue(previous, { ...next, point: new Point({ x: 3, y: 2 }) });
    expect(moved.at).toBe(previous.at);
    expect(moved.owner).toBe(previous.owner);
    expect(moved.point).not.toBe(previous.point);
  });

  it("does not equate values of different prototypes or shapes", () => {
    const previous = { value: new Point({ x: 1, y: 2 }) as unknown };
    const next = { value: { x: 1, y: 2 } as unknown };
    expect(shareResourceValue(previous, next)).toBe(next);
    expect(shareResourceValue<unknown>([1, 2], { 0: 1, 1: 2 })).toEqual({ 0: 1, 1: 2 });
    // A key added with `undefined` is still a change.
    const previousRecord = { a: 1 };
    const added = shareResourceValue<object>(previousRecord, { a: 1, b: undefined });
    expect(added).not.toBe(previousRecord);
    expect("b" in added).toBe(true);
  });
});

interface Project {
  readonly id: string;
  readonly name: string;
  readonly owner: { readonly name: string };
  readonly updatedAt: number;
}

let families = 0;

/** A Project Resource over a mutable server value, loaded as a fresh copy each time. */
const makeFixture = () => {
  const suffix = `${++families}`;
  const server = {
    project: { id: "atlas", name: "Atlas", owner: { name: "Ada" }, updatedAt: 1 } as Project,
  };
  const ProjectById = Resource.define<string, Project>({
    name: `ResourceValueSharing.ProjectById.${suffix}`,
    load: () => Effect.sync(() => structuredClone(server.project)),
  });
  const ref = ProjectById("atlas");
  const shown = (): Project | undefined =>
    Option.getOrUndefined(AsyncResult.value(Signal.peek(Resource.result(ref))));
  return { server, ProjectById, ref, shown, suffix };
};

describe("Resource structural sharing", () => {
  it("keeps the shown value across a refresh that loads an equal one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const first = yield* Resource.preload(fixture.ref);
        expect(yield* Resource.refresh(fixture.ref)).toBe(first);
        expect(fixture.shown()).toBe(first);

        // A sibling change makes a new value that reuses the unchanged owner.
        fixture.server.project = { ...fixture.server.project, updatedAt: 2 };
        const second = yield* Resource.refresh(fixture.ref);
        expect(second).not.toBe(first);
        expect(second.updatedAt).toBe(2);
        expect(second.owner).toBe(first.owner);
        expect(fixture.shown()).toBe(second);
      }),
    ));

  it("keeps a hydrated value when the refetch after hydration loads an equal one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* Resource.hydrate({
          resources: [
            {
              name: fixture.ProjectById.family.options.name,
              key: fixture.ref.key,
              input: "atlas",
              state: {
                _tag: "Success",
                waiting: false,
                value: structuredClone(fixture.server.project),
                timestamp: 0,
              },
            },
          ],
        });
        const hydrated = fixture.shown();
        expect(yield* Resource.refresh(fixture.ref)).toBe(hydrated);
      }),
    ));

  it("shows the synced object again after a rollback, and the shown object after an equal fold", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const Rename = Action.define({
          name: `ResourceValueSharing.rename.${fixture.suffix}`,
          optimistic: (input: { readonly name: string }, transaction) =>
            transaction.set(fixture.ref, (project) => ({ ...project, name: input.name })),
          run: (input: { readonly name: string; readonly gate: Deferred.Deferred<void, string> }) =>
            Deferred.await(input.gate),
        });
        const rename = Action.use(Rename, { runtime: defaultRuntime });
        const synced = yield* Resource.preload(fixture.ref);

        const rejected = yield* Deferred.make<void, string>();
        const failing = yield* Effect.forkChild(rename.submit({ name: "Atlas 2", gate: rejected }));
        yield* Effect.yieldNow;
        const patched = fixture.shown()!;
        expect(patched.name).toBe("Atlas 2");
        expect(patched.owner).toBe(synced.owner);
        yield* Deferred.fail(rejected, "rejected");
        expect(Exit.isFailure(yield* Fiber.await(failing))).toBe(true);
        expect(fixture.shown()).toBe(synced);

        const accepted = yield* Deferred.make<void, string>();
        const succeeding = yield* Effect.forkChild(
          rename.submit({ name: "Atlas 3", gate: accepted }),
        );
        yield* Effect.yieldNow;
        const shown = fixture.shown()!;
        yield* Deferred.succeed(accepted, undefined);
        yield* Fiber.join(succeeding);
        // The fold re-applies the patch to the synced value: equal to what was shown.
        expect(fixture.shown()).toBe(shown);
      }),
    ));
});
