import { Action, ActionResult, makeRuntime, Resource, runWithRuntime } from "@sunfall/arc-core";
import { Query } from "@sunfall/arc-db";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { type Project, type ProjectWorkItem } from "./domain.contract.js";
import {
  makeProjectId,
  makeProjectReturnTo,
  makeWorkItemId,
  preloadProjectRouteEffect,
  projectNameActionTarget,
  ProjectApi,
  ProjectById,
  ProjectsRef,
  SubmitProjectName,
  SubmitProjectNameInput,
} from "./domain.js";
import {
  MoveWorkItem,
  ProjectSummaries,
  ProjectWorkItems,
  projectWorkQueueQuery,
} from "./project-collections.js";
import { defaultRuntime } from "@sunfall/arc-core/internal";

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

describe("project console contract mocks", () => {
  const ProjectApiTest = ProjectApi.layer({
    list: () => Effect.succeed([]),
    listWorkItems: () => Effect.succeed([]),
    get: (id) => Effect.succeed(mockProject({ id, name: "Mocked Resource" })),
    submitName: ({ id, name }) => Effect.succeed(ActionResult.success(mockProject({ id, name }))),
    advance: ({ id }) => Effect.succeed(mockProject({ id, progress: 51 })),
    updateWorkItemStatus: ({ id, status }) => Effect.succeed(mockWorkItem({ id, status })),
  });

  it("loads resources without importing server handlers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const value = yield* Effect.provide(
          Resource.refresh(ProjectById(makeProjectId("mocked"))),
          ProjectApiTest,
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
          ProjectApiTest,
        );

        expect(collected.refs.map((ref) => ref.key)).toEqual([
          ProjectsRef.key,
          ProjectById(id).key,
        ]);
        expect((yield* Effect.provide(Resource.read(ProjectById(id)), ProjectApiTest)).name).toBe(
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

    expect(target).toMatchObject({
      method: "post",
      action: "/__sunfall-arc/action",
    });
    expect(input).toBeDefined();
    expect(JSON.parse(input?.value ?? "{}")).toEqual({
      id: "mocked",
      redirectTo: "/projects/mocked?tab=activity",
    });
  });

  it("materializes an indexed live-query work queue without server handlers", () => {
    const id = makeProjectId("mocked");
    const ProjectApiWorkQueue = ProjectApi.layer({
      list: () => Effect.succeed([mockProject({ id, name: "Mocked Project" })]),
      listWorkItems: () => Effect.succeed(mockWorkItems()),
      get: (projectId) => Effect.succeed(mockProject({ id: projectId })),
      submitName: ({ id: projectId, name }) =>
        Effect.succeed(ActionResult.success(mockProject({ id: projectId, name }))),
      advance: ({ id: projectId }) => Effect.succeed(mockProject({ id: projectId, progress: 51 })),
      updateWorkItemStatus: ({ id: workItemId, status }) =>
        Effect.succeed(mockWorkItem({ id: workItemId, status })),
    });
    const runtime = makeRuntime(ProjectApiWorkQueue);

    return Effect.runPromise(
      runtime.provide(Query.once(projectWorkQueueQuery(id))).pipe(
        Effect.tap((rows) =>
          Effect.sync(() => {
            expect(rows).toEqual([
              expect.objectContaining({
                id: makeWorkItemId("mocked-task"),
                projectName: "Mocked Project",
                status: "queued",
                synced: true,
              }),
            ]);
          }),
        ),
        Effect.ensuring(runtime.dispose.pipe(Effect.catchCause(() => Effect.void))),
      ),
    );
  });

  it("keeps progressive validation in the success channel", () => {
    const ProjectApiValidation = ProjectApi.layer({
      list: () => Effect.succeed([]),
      listWorkItems: () => Effect.succeed([]),
      get: (id) => Effect.succeed(mockProject({ id })),
      submitName: () =>
        Effect.succeed(
          ActionResult.validation<typeof SubmitProjectNameInput.Type, string>({
            fieldErrors: {
              name: ["Use at least three meaningful characters."],
            },
            formErrors: [],
          }),
        ),
      advance: ({ id }) => Effect.succeed(mockProject({ id, progress: 51 })),
      updateWorkItemStatus: ({ id, status }) => Effect.succeed(mockWorkItem({ id, status })),
    });
    const action = Action.use(SubmitProjectName, { runtime: defaultRuntime });

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.provide(
          action.submit({ id: makeProjectId("mocked"), name: "At" }),
          ProjectApiValidation,
        );

        expect(result._tag).toBe("ValidationFailure");
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
    const ProjectApiStateful = ProjectApi.layer({
      list: () => Effect.succeed([mockProject({ name })]),
      listWorkItems: () => Effect.succeed(mockWorkItems()),
      get: (id) => Effect.succeed(mockProject({ id, name })),
      submitName: ({ id, name: nextName }) =>
        Effect.sync(() => {
          name = nextName;
          return ActionResult.success(mockProject({ id, name }));
        }),
      advance: ({ id }) => Effect.succeed(mockProject({ id, name, progress: 51 })),
      updateWorkItemStatus: ({ id, status }) => Effect.succeed(mockWorkItem({ id, status })),
    });
    const ref = ProjectById(makeProjectId("mocked"));
    const action = Action.use(SubmitProjectName, { runtime: defaultRuntime });

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
          ProjectApiStateful,
        );

        expect(result._tag).toBe("Success");
        expect((yield* Effect.provide(Resource.read(ref), ProjectApiStateful)).name).toBe(
          "Mocked Progressive",
        );
        expect(action.invalidationPlan.get()?.entries.map((entry) => entry.ref.key)).toContain(
          ref.key,
        );
      }),
    );
  });

  it("reconciles the sidebar collection from the rename action's invalidations", () => {
    const id = makeProjectId("mocked");
    let name = "Mocked Resource";
    let lists = 0;
    const ProjectApiStateful = ProjectApi.layer({
      list: () =>
        Effect.sync(() => {
          lists++;
          return [mockProject({ id, name })];
        }),
      listWorkItems: () => Effect.succeed(mockWorkItems()),
      get: (projectId) => Effect.succeed(mockProject({ id: projectId, name })),
      submitName: ({ name: nextName, redirectTo }) =>
        Effect.sync(() => {
          name = nextName;
          return redirectTo === undefined
            ? ActionResult.success(mockProject({ id, name }))
            : ActionResult.redirect(redirectTo, { status: 303, replace: true });
        }),
      advance: ({ id: projectId }) =>
        Effect.succeed(mockProject({ id: projectId, name, progress: 51 })),
      updateWorkItemStatus: ({ id: workItemId, status }) =>
        Effect.succeed(mockWorkItem({ id: workItemId, status })),
    });
    const runtime = makeRuntime(ProjectApiStateful);
    const ref = ProjectById(id);
    const action = Action.use(SubmitProjectName, { runtime });
    const rowName = () => runWithRuntime(runtime, () => ProjectSummaries.get(id)?.name);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.all([
            Resource.preload(ProjectsRef),
            Resource.preload(ref),
            ProjectSummaries.preload(),
          ]),
        );
        // The collection loads through the ProjectList Resource: one list fetch.
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
    const ProjectApiWorkItemOptimistic = ProjectApi.layer({
      list: () => Effect.succeed([mockProject({ id, name: "Mocked Project" })]),
      listWorkItems: () => Effect.succeed([mockWorkItem({ id: workItemId, status })]),
      get: (projectId) => Effect.succeed(mockProject({ id: projectId })),
      submitName: ({ id: projectId, name }) =>
        Effect.succeed(ActionResult.success(mockProject({ id: projectId, name }))),
      advance: ({ id: projectId }) => Effect.succeed(mockProject({ id: projectId, progress: 51 })),
      updateWorkItemStatus: ({ id: nextId, status: nextStatus }) =>
        Effect.gen(function* () {
          started = true;
          yield* Deferred.await(release);
          status = nextStatus;
          return mockWorkItem({ id: nextId, status });
        }),
    });
    const runtime = makeRuntime(ProjectApiWorkItemOptimistic);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* runtime.provide(
          Effect.all([ProjectSummaries.preload(), ProjectWorkItems.preload()]),
        );

        const move = Action.use(MoveWorkItem, { runtime });
        const running = runtime.runFork(move.submit({ id: workItemId, status: "running" }));
        submission = running;
        yield* Effect.sleep("10 millis");

        expect(started).toBe(true);
        expect(runWithRuntime(runtime, () => ProjectWorkItems.get(workItemId))).toMatchObject({
          status: "running",
          $synced: false,
        });
        expect(yield* runtime.provide(Query.once(projectWorkQueueQuery(id)))).toEqual([
          expect.objectContaining({
            id: workItemId,
            status: "running",
            synced: false,
          }),
        ]);

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(running);

        // The `WorkItems` invalidation reloaded the list the collection follows.
        expect(runWithRuntime(runtime, () => ProjectWorkItems.get(workItemId))).toMatchObject({
          status: "running",
          $synced: true,
        });
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
