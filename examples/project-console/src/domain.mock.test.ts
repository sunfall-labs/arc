import { Action, ActionResult, makeRuntime, Resource, Server } from "@sunfall/arc-core";
import { Query } from "@sunfall/arc-db";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeProjectId,
  makeProjectReturnTo,
  makeWorkItemId,
  preloadProjectRouteEffect,
  projectNameActionTarget,
  ProjectById,
  ProjectList,
  ProjectsRef,
  ProjectWorkItemList,
  SubmitProjectName,
  WorkItemsRef,
  type Project,
  type ProjectId,
  type ProjectWorkItem,
} from "./domain.js";
import { MoveWorkItem, projectWorkQueueQuery } from "./project-actions.js";
import { defaultRuntime } from "@sunfall/arc-core/internal";

/*
 * Client-side logic without the server: the served Resources' loads are
 * mocked with test implementations (`Server.mockLayer`), and the served
 * Actions run local test implementations (`Action.implement`), so their
 * optimistic patches and invalidations run as they do in the browser.
 */

const mockProject = (overrides: Partial<Project> = {}): Project => ({
  id: makeProjectId("mocked"),
  name: "Mocked Project",
  owner: "Test",
  status: "tracking",
  health: "green",
  progress: 50,
  spend: 20,
  goal: "Keep framework tests honest.",
  nextMilestone: "Ship typed mocks.",
  updatedAt: "test",
  risks: [],
  ...overrides,
});

const mockWorkItem = (overrides: Partial<ProjectWorkItem> = {}): ProjectWorkItem => ({
  id: makeWorkItemId("mocked-task"),
  projectId: makeProjectId("mocked"),
  title: "Mocked work item",
  owner: "Test",
  status: "queued",
  priority: "high",
  impact: 8,
  updatedAt: "test",
  ...overrides,
});

const mockWorkItems = (): ProjectWorkItem[] => [
  mockWorkItem(),
  mockWorkItem({
    id: makeWorkItemId("mocked-done"),
    title: "Already shipped",
    status: "done",
    priority: "low",
  }),
];

/** The served Resources' loads, mocked: each reads its value when it loads. */
const mockServer = (loads: {
  readonly list?: () => ReadonlyArray<Project>;
  readonly listWorkItems?: () => ReadonlyArray<ProjectWorkItem>;
  readonly get?: (id: ProjectId) => Project;
}) =>
  Server.mockLayer(
    Resource.implement(ProjectList, () => Effect.sync(() => loads.list?.() ?? [])),
    Resource.implement(ProjectWorkItemList, () => Effect.sync(() => loads.listWorkItems?.() ?? [])),
    Resource.implement(ProjectById, (id) =>
      Effect.sync(() => loads.get?.(id) ?? mockProject({ id })),
    ),
  );

describe("project console with the server mocked", () => {
  const MockServer = mockServer({
    get: (id) => mockProject({ id, name: "Mocked Resource" }),
  });

  it("loads resources without importing server handlers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const value = yield* Effect.provide(
          Resource.refresh(ProjectById(makeProjectId("mocked"))),
          MockServer,
        );

        expect(value.name).toBe("Mocked Resource");
      }),
    ));

  it("preloads the branded project route resources without server handlers", () => {
    const id = makeProjectId("mocked");

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* Effect.provide(
          Resource.collect(preloadProjectRouteEffect({ id })),
          MockServer,
        );

        expect(collected.refs.map((ref) => ref.key)).toEqual([
          ProjectsRef.key,
          ProjectById(id).key,
        ]);
        expect((yield* Effect.provide(Resource.read(ProjectById(id)), MockServer)).name).toBe(
          "Mocked Resource",
        );
      }),
    );
  });

  it("builds a progressive action target with branded hidden input", () => {
    const target = projectNameActionTarget({
      id: makeProjectId("mocked"),
      redirectTo: makeProjectReturnTo("/projects/mocked?tab=activity"),
    });
    const input = target.hiddenFields.find((field) => field.name === "__sunfall_arc_input");

    // No `action`: the form posts to the page it is on.
    expect(target.method).toBe("post");
    expect("action" in target).toBe(false);
    expect(input).toBeDefined();
    expect(JSON.parse(input?.value ?? "{}")).toEqual({
      id: "mocked",
      redirectTo: "/projects/mocked?tab=activity",
    });
  });

  it("materializes an indexed live-query work queue without server handlers", () => {
    const id = makeProjectId("mocked");
    const runtime = makeRuntime(
      mockServer({
        list: () => [mockProject({ id, name: "Mocked Project" })],
        listWorkItems: mockWorkItems,
      }),
    );

    return Effect.runPromise(
      runtime.provide(Query.once(projectWorkQueueQuery(id))).pipe(
        Effect.tap((rows) =>
          Effect.sync(() => {
            expect(rows).toEqual([
              expect.objectContaining({
                id: makeWorkItemId("mocked-task"),
                projectName: "Mocked Project",
                status: "queued",
              }),
            ]);
          }),
        ),
        Effect.ensuring(runtime.dispose.pipe(Effect.catchCause(() => Effect.void))),
      ),
    );
  });

  it("keeps progressive validation in the success channel", () => {
    const action = Action.use(
      Action.implement(SubmitProjectName, () =>
        Effect.succeed(
          ActionResult.validation<Record<string, unknown>, string>({
            fieldErrors: {
              name: ["Use at least three meaningful characters."],
            },
            formErrors: [],
          }),
        ),
      ),
      { runtime: defaultRuntime },
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.provide(
          action.submit({ id: makeProjectId("mocked"), name: "At" }),
          mockServer({}),
        );

        expect(result).toMatchObject({ _tag: "ValidationFailure" });
        expect(action.state.get().result).toMatchObject({
          _tag: "Success",
          waiting: false,
          value: {
            _tag: "ValidationFailure",
          },
        });
      }),
    );
  });

  it("invalidates project resources after progressive success", () => {
    let name = "Mocked Resource";
    const MockServerStateful = mockServer({
      list: () => [mockProject({ name })],
      get: (id) => mockProject({ id, name }),
    });
    const ref = ProjectById(makeProjectId("mocked"));
    const action = Action.use(
      Action.implement(SubmitProjectName, ({ id, name: nextName }) =>
        Effect.sync(() => {
          name = nextName;
          return mockProject({ id, name });
        }),
      ),
      { runtime: defaultRuntime },
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.provide(
          Effect.gen(function* () {
            yield* Resource.refresh(ref);
            return yield* action.submit({
              id: makeProjectId("mocked"),
              name: "Mocked Progressive",
            });
          }),
          MockServerStateful,
        );

        expect(result).toMatchObject({ name: "Mocked Progressive" });
        expect((yield* Effect.provide(Resource.read(ref), MockServerStateful)).name).toBe(
          "Mocked Progressive",
        );
        expect(action.invalidationPlan.get()?.entries.map((entry) => entry.ref.key)).toContain(
          ref.key,
        );
      }),
    );
  });

  it("patches the sidebar row at once and reloads it from the rename's invalidations", () => {
    const id = makeProjectId("mocked");
    let name = "Mocked Resource";
    let lists = 0;
    const runtime = makeRuntime(
      mockServer({
        list: () => {
          lists++;
          return [mockProject({ id, name })];
        },
        get: (projectId) => mockProject({ id: projectId, name }),
      }),
    );
    const ref = ProjectById(id);
    const action = Action.use(
      Action.implement(SubmitProjectName, ({ name: nextName, redirectTo }) =>
        Effect.sync(() => {
          name = nextName;
          return redirectTo === undefined
            ? mockProject({ id, name })
            : ActionResult.redirect(redirectTo, { status: 303, replace: true });
        }),
      ),
      { runtime },
    );
    const rowName = () =>
      runtime.runSync(Resource.read(ProjectsRef)).find((project) => project.id === id)?.name;

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Effect.all([Resource.preload(ProjectsRef), Resource.preload(ref)]));
        expect(lists).toBe(1);
        expect(rowName()).toBe("Mocked Resource");

        const result = yield* runtime.provide(
          action.submit({
            id,
            name: "Renamed Once",
            redirectTo: makeProjectReturnTo("/projects/mocked?tab=activity"),
          }),
        );

        expect(result).toMatchObject({
          _tag: "Redirect",
          location: "/projects/mocked?tab=activity",
        });
        expect(runtime.runSync(Resource.read(ref)).name).toBe("Renamed Once");
        for (let attempt = 0; attempt < 50 && rowName() !== "Renamed Once"; attempt++) {
          yield* Effect.sleep("1 millis");
        }
        expect(rowName()).toBe("Renamed Once");
        expect(lists).toBe(2);
      }).pipe(Effect.ensuring(runtime.dispose.pipe(Effect.catchCause(() => Effect.void)))),
    );
  });

  it("shows a work-item Action's optimistic row in the live query until it settles", () => {
    const id = makeProjectId("mocked");
    const workItemId = makeWorkItemId("mocked-task");
    const release = Effect.runSync(Deferred.make<void>());
    let status: ProjectWorkItem["status"] = "queued";
    let started = false;
    let submission: Fiber.Fiber<unknown, unknown> | undefined;
    const runtime = makeRuntime(
      mockServer({
        list: () => [mockProject({ id, name: "Mocked Project" })],
        listWorkItems: () => [mockWorkItem({ id: workItemId, status })],
      }),
    );
    const moveWorkItem = Action.implement(MoveWorkItem, ({ id: nextId, status: nextStatus }) =>
      Effect.gen(function* () {
        started = true;
        yield* Deferred.await(release);
        status = nextStatus;
        return mockWorkItem({ id: nextId, status });
      }),
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(Resource.preload([ProjectsRef, WorkItemsRef]));
        const workItem = () =>
          runtime.runSync(Resource.read(WorkItemsRef)).find((item) => item.id === workItemId);

        const move = Action.use(moveWorkItem, { runtime });
        const running = runtime.runFork(move.submit({ id: workItemId, status: "running" }));
        submission = running;
        yield* Effect.sleep("10 millis");

        expect(started).toBe(true);
        expect(workItem()).toMatchObject({ status: "running" });
        expect(yield* runtime.provide(Query.once(projectWorkQueueQuery(id)))).toEqual([
          expect.objectContaining({ id: workItemId, status: "running" }),
        ]);

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(running);

        // The `WorkItems` invalidation reloaded the server's row underneath.
        expect(workItem()).toMatchObject({ status: "running" });
        expect(status).toBe("running");
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Deferred.succeed(release, undefined);
            if (submission !== undefined) {
              yield* Fiber.await(submission);
            }
            yield* runtime.dispose.pipe(Effect.catchCause(() => Effect.void));
          }),
        ),
      ),
    );
  });
});
