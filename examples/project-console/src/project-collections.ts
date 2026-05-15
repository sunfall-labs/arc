import { Action, ActionResult, Server } from "@effect-ui/core";
import { Collection, CollectionRowKeyChanged, CollectionRowNotFound, CollectionSnapshotCodecError } from "@effect-ui/db";
import { Effect, Schedule, Schema } from "effect";
import {
  ProjectApi,
  ProjectNameSubmissionResultSchema,
  ProjectNotFound,
  ProjectSummarySchema,
  SubmitProjectNameInput,
  normalizeProjectError,
  projectResourceInvalidations,
  type ProjectId,
  type ProjectNameSubmissionResult,
  type ProjectRemoteError,
  type ProjectSummary
} from "./domain.js";

export const ProjectSummaries = Collection.define(Collection.serverOptions<ProjectSummary, ProjectId, ProjectRemoteError, ProjectApi>({
  id: "Projects.collection",
  output: ProjectSummarySchema,
  getKey: (project) => project.id,
  indexes: {
    status: (project) => project.status,
    owner: (project) => project.owner
  },
  policy: {
    retry: Schedule.exponential("50 millis").pipe(Schedule.take(2))
  },
  load: () => ProjectApi.use((api) => api.list()),
  update: ({ updates }) =>
    Effect.forEach(
      updates,
      (update) =>
        typeof update.changes.name === "string"
          ? ProjectApi.use((api) =>
              api.rename({
                id: update.key,
                name: update.changes.name as string
              })
            ).pipe(Effect.asVoid)
          : Effect.void,
      { discard: true }
    )
}));

type ProjectNameSubmissionInput = typeof SubmitProjectNameInput.Type;

const validationMessage = "Use at least three meaningful characters.";

const toProjectNameResultError = (
  input: ProjectNameSubmissionInput,
  error: ProjectRemoteError | CollectionRowKeyChanged | CollectionRowNotFound | CollectionSnapshotCodecError
): Effect.Effect<ProjectNameSubmissionResult, Server.ClientError | CollectionSnapshotCodecError> => {
  const projectError = normalizeProjectError(error);

  if (error instanceof CollectionRowNotFound) {
    return ActionResult.failureEffect(new ProjectNotFound({ id: input.id }));
  }

  if (error instanceof CollectionRowKeyChanged) {
    return ActionResult.validationEffect<ProjectNameSubmissionInput, string>({
      fieldErrors: {
        name: ["Project identity cannot be changed from this form."]
      },
      formErrors: [],
      cause: error
    });
  }

  if (error instanceof CollectionSnapshotCodecError) {
    return Effect.fail(error);
  }

  if (projectError?._tag === "InvalidProjectName") {
    return ActionResult.validationEffect<ProjectNameSubmissionInput, string>({
      fieldErrors: {
        name: [validationMessage]
      },
      formErrors: [],
      cause: error
    });
  }

  if (projectError !== undefined) {
    return ActionResult.failureEffect(projectError);
  }

  return Effect.fail(error as Server.ClientError);
};

export const RenameProjectFromCollection = Action.define({
  name: "Project.collection.rename",
  input: SubmitProjectNameInput,
  output: ProjectNameSubmissionResultSchema,
  error: Schema.Unknown,
  policy: {
    concurrency: "latest",
    retry: Schedule.recurs(1)
  },
  run: (input) => {
    const name = input.name.trim();

    if (name.length < 3) {
      return ActionResult.validationEffect<ProjectNameSubmissionInput, string>({
        fieldErrors: {
          name: [validationMessage]
        },
        formErrors: []
      });
    }

    return Effect.gen(function* () {
      yield* ProjectSummaries.preloadEffect();
      yield* ProjectSummaries.updateEffect(input.id, { name });

      if (input.redirectTo) {
        return ActionResult.redirect(input.redirectTo, {
          status: 303,
          replace: true,
          invalidates: projectResourceInvalidations(input.id)
        });
      }

      const project = yield* ProjectApi.use((api) => api.get(input.id));
      return ActionResult.success(project, {
        invalidates: projectResourceInvalidations(input.id)
      });
    }).pipe(
      Effect.catch((error: ProjectRemoteError | CollectionRowKeyChanged | CollectionRowNotFound | CollectionSnapshotCodecError) =>
        toProjectNameResultError(input, error)
      )
    );
  }
});
