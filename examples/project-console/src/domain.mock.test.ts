import { Action, ActionResult, makeRuntime, read, Resource, runWithRuntime } from "@effect-ui/core";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { type Project } from "./domain.contract.js";
import {
  makeProjectId,
  makeProjectReturnTo,
  preloadProjectRouteEffect,
  projectNameActionTarget,
  ProjectApi,
  ProjectById,
  ProjectsRef,
  RenameProject,
  SubmitProjectName,
  SubmitProjectNameInput
} from "./domain.js";
import { ProjectSummaries, RenameProjectFromCollection } from "./project-collections.js";

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
  ...overrides
});

describe("project console contract mocks", () => {
  const ProjectApiTest = ProjectApi.mock({
    list: () => Effect.succeed([]),
    get: (id) => Effect.succeed(mockProject({ id, name: "Mocked Resource" })),
    rename: ({ id, name }) => Effect.succeed(mockProject({ id, name })),
    submitName: ({ id, name }) => Effect.succeed(ActionResult.success(mockProject({ id, name }))),
    advance: ({ id }) => Effect.succeed(mockProject({ id, progress: 51 }))
  });

  it("loads resources without importing server handlers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const value = yield* Effect.provide(
          Resource.refreshEffect(ProjectById(makeProjectId("mocked"))),
          ProjectApiTest
        );

        expect(value.name).toBe("Mocked Resource");
      })
    ));

  it("preloads the branded project route resources without server handlers", () => {
    const id = makeProjectId("mocked");

    return Effect.runPromise(
      Effect.gen(function* () {
        const collected = yield* Effect.provide(
          Resource.collectEffect(preloadProjectRouteEffect({ id })),
          ProjectApiTest
        );

        expect(collected.refs.map((ref) => ref.key)).toEqual([
          ProjectsRef.key,
          ProjectById(id).key
        ]);
        expect(Resource.read(ProjectById(id)).name).toBe("Mocked Resource");
      })
    );
  });

  it("builds a progressive action target with branded hidden input", () => {
    const target = projectNameActionTarget({
      id: makeProjectId("mocked"),
      redirectTo: makeProjectReturnTo("/projects/mocked?tab=activity")
    });
    const input = target.hiddenFields.find((field) => field.name === "__effect_ui_input");

    expect(target).toMatchObject({
      method: "post",
      action: "/__effect-ui/action"
    });
    expect(input).toBeDefined();
    expect(JSON.parse(input?.value ?? "{}")).toEqual({
      id: "mocked",
      redirectTo: "/projects/mocked?tab=activity"
    });
  });

  it("runs actions without importing server handlers", () => {
    const ref = ProjectById(makeProjectId("mocked"));
    const action = Action.use(RenameProject);

    return Effect.runPromise(
      Effect.gen(function* () {
        const value = yield* Effect.provide(
          Effect.gen(function* () {
            yield* Resource.refreshEffect(ref);
            return yield* action.submitEffect({ id: makeProjectId("mocked"), name: "Mocked Action" });
          }),
          ProjectApiTest
        );

        expect(value.name).toBe("Mocked Action");
        expect(read(action.invalidationPlan)?.entries.map((entry) => entry.ref.key)).toContain(ref.key);
      })
    );
  });

  it("keeps progressive validation in the success channel", () => {
    const ProjectApiValidation = ProjectApi.mock({
      list: () => Effect.succeed([]),
      get: (id) => Effect.succeed(mockProject({ id })),
      rename: ({ id, name }) => Effect.succeed(mockProject({ id, name })),
      submitName: () =>
        Effect.succeed(
          ActionResult.validation<typeof SubmitProjectNameInput.Type, string>({
            fieldErrors: {
              name: ["Use at least three meaningful characters."]
            },
            formErrors: []
          })
        ),
      advance: ({ id }) => Effect.succeed(mockProject({ id, progress: 51 }))
    });
    const action = Action.use(SubmitProjectName);

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.provide(
          action.submitEffect({ id: makeProjectId("mocked"), name: "At" }),
          ProjectApiValidation
        );

        expect(result._tag).toBe("ValidationFailure");
        expect(read(action.state)).toMatchObject({
          _tag: "Success",
          value: {
            _tag: "ValidationFailure"
          }
        });
      })
    );
  });

  it("invalidates project resources after progressive success", () => {
    let name = "Mocked Resource";
    const ProjectApiStateful = ProjectApi.mock({
      list: () => Effect.succeed([mockProject({ name })]),
      get: (id) => Effect.succeed(mockProject({ id, name })),
      rename: ({ id, name: nextName }) =>
        Effect.sync(() => {
          name = nextName;
          return mockProject({ id, name });
        }),
      submitName: ({ id, name: nextName }) =>
        Effect.sync(() => {
          name = nextName;
          return ActionResult.success(mockProject({ id, name }));
        }),
      advance: ({ id }) => Effect.succeed(mockProject({ id, name, progress: 51 }))
    });
    const ref = ProjectById(makeProjectId("mocked"));
    const action = Action.use(SubmitProjectName);

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.provide(
          Effect.gen(function* () {
            yield* Resource.refreshEffect(ref);
            return yield* action.submitEffect({ id: makeProjectId("mocked"), name: "Mocked Progressive" });
          }),
          ProjectApiStateful
        );

        expect(result._tag).toBe("Success");
        expect(Resource.read(ref).name).toBe("Mocked Progressive");
        expect(read(action.invalidationPlan)?.entries.map((entry) => entry.ref.key)).toContain(ref.key);
      })
    );
  });

  it("uses the collection action for optimistic client renames", () => {
    const id = makeProjectId("mocked");
    const release = Effect.runSync(Deferred.make<void>());
    let name = "Mocked Resource";
    let started = false;
    let submission: Fiber.Fiber<unknown, unknown> | undefined;
    const ProjectApiOptimistic = ProjectApi.mock({
      list: () => Effect.succeed([mockProject({ id, name })]),
      get: (projectId) => Effect.succeed(mockProject({ id: projectId, name })),
      rename: ({ id: projectId, name: nextName }) =>
        Effect.gen(function* () {
          started = true;
          yield* Deferred.await(release);
          name = nextName;
          return mockProject({ id: projectId, name });
        }),
      submitName: ({ id: projectId, name: nextName }) =>
        Effect.sync(() => {
          name = nextName;
          return ActionResult.success(mockProject({ id: projectId, name }));
        }),
      advance: ({ id: projectId }) => Effect.succeed(mockProject({ id: projectId, name, progress: 51 }))
    });
    const runtime = makeRuntime(ProjectApiOptimistic);
    const ref = ProjectById(id);
    const action = Action.use(RenameProjectFromCollection, { runtime });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.scoped(
          runtime.provide(
            Effect.all([
              Resource.refreshEffect(ref),
              ProjectSummaries.preloadEffect()
            ])
          )
        );

        const running = runtime.runFork(action.submitEffect({
          id,
          name: "Collection Rename",
          redirectTo: makeProjectReturnTo("/projects/mocked?tab=activity")
        }));
        submission = running;
        yield* Effect.sleep("10 millis");

        expect(started).toBe(true);
        expect(runWithRuntime(runtime, () => ProjectSummaries.get(id))).toMatchObject({
          name: "Collection Rename",
          $synced: false
        });

        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(running);

        expect(result).toMatchObject({
          _tag: "Redirect",
          location: "/projects/mocked?tab=activity",
          replace: true
        });
        expect(runWithRuntime(runtime, () => ProjectSummaries.get(id))).toMatchObject({
          name: "Collection Rename",
          $synced: true
        });
        expect(runWithRuntime(runtime, () => Resource.read(ref)).name).toBe("Collection Rename");
        expect(read(action.invalidationPlan)?.entries.map((entry) => entry.ref.key)).toContain(ref.key);
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Deferred.succeed(release, undefined);
            if (submission !== undefined) {
              yield* Fiber.await(submission);
            }
            yield* runtime.disposeEffect;
          })
        )
      )
    );
  });
});
