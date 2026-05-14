import { Action, ActionResult, Server } from "@effect-ui/core";
import { Collection, CollectionRowNotFound, CollectionSnapshotCodecError } from "@effect-ui/db";
import { Effect, Schedule, Schema } from "effect";
import {
  InvalidProjectName,
  ProjectApi,
  ProjectNameSubmissionResultSchema,
  ProjectNotFound,
  ProjectSummarySchema,
  SubmitProjectNameInput,
  projectResourceInvalidations,
  type ProjectError,
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

const hasTag = (value: unknown, tag: string): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly _tag?: unknown })._tag === tag;

const isProjectError = (error: unknown): error is ProjectError =>
  error instanceof ProjectNotFound ||
  error instanceof InvalidProjectName ||
  hasTag(error, "ProjectNotFound") ||
  hasTag(error, "InvalidProjectName");

const toProjectNameResultError = (
  input: ProjectNameSubmissionInput,
  error: ProjectRemoteError | CollectionRowNotFound | CollectionSnapshotCodecError
): Effect.Effect<ProjectNameSubmissionResult, Server.ClientError | CollectionSnapshotCodecError> => {
  if (error instanceof CollectionRowNotFound) {
    return ActionResult.failureEffect(new ProjectNotFound({ id: input.id }));
  }

  if (error instanceof CollectionSnapshotCodecError) {
    return Effect.fail(error);
  }

  if (error instanceof InvalidProjectName || hasTag(error, "InvalidProjectName")) {
    return ActionResult.validationEffect<ProjectNameSubmissionInput, string>({
      fieldErrors: {
        name: [validationMessage]
      },
      formErrors: [],
      cause: error
    });
  }

  if (isProjectError(error)) {
    return ActionResult.failureEffect(error);
  }

  return Effect.fail(error as Server.ClientError);
};

export const RenameProjectFromCollection = Action.define<
  ProjectNameSubmissionInput,
  ProjectNameSubmissionResult,
  Server.ClientError | CollectionSnapshotCodecError,
  ProjectApi
>({
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
      Effect.catch((error: ProjectRemoteError | CollectionRowNotFound | CollectionSnapshotCodecError) =>
        toProjectNameResultError(input, error)
      )
    );
  }
});
