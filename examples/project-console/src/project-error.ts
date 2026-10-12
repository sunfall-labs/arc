import { ResourceFailure, RouteNavigationError, RoutePreloadError } from "@sunfall/arc-core";
import { Cause, Effect, Exit, Schema } from "effect";
import { ProjectErrorSchema, type ProjectError } from "./model.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Peels framework wrappers (route preload/navigation, Resource reads) down to the domain error. */
const unwrapFailure = (error: unknown): unknown => {
  if (error instanceof ResourceFailure) {
    // The failure Cause holds the typed error (or a defect); squash picks it.
    return unwrapFailure(Cause.squash(error.result.cause));
  }

  if (error instanceof RoutePreloadError || error instanceof RouteNavigationError) {
    return unwrapFailure(error.cause);
  }

  return error;
};

/** Decodes class instances and plain decoded objects into a `ProjectError`. */
export const normalizeProjectError = (error: unknown): ProjectError | undefined => {
  const decoded = Effect.runSyncExit(
    Schema.decodeUnknownEffect(ProjectErrorSchema)(unwrapFailure(error)),
  );

  return Exit.isSuccess(decoded) ? decoded.value : undefined;
};

export const isInvalidProjectName = (error: unknown): boolean =>
  normalizeProjectError(error)?._tag === "InvalidProjectName";

export const formatProjectError = (failure: unknown): string => {
  const error = unwrapFailure(failure);
  const projectError = normalizeProjectError(error);

  switch (projectError?._tag) {
    case "ProjectNotFound":
      return `Project "${projectError.id}" was not found.`;
    case "InvalidProjectName":
      return "Project names need at least three meaningful characters.";
    case "WorkItemNotFound":
      return `Work item "${projectError.id}" was not found.`;
  }

  if (error instanceof Error && error.message.length > 0) {
    return `${error.name}: ${error.message}`;
  }

  if (isRecord(error) && "_tag" in error) {
    return `Unexpected ${String(error._tag)} failure.`;
  }

  return "Something failed while loading this project.";
};
