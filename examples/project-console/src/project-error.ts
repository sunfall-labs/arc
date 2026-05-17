import { ResourceFailure } from "@effect-ui/core";
import { Effect, Exit, Schema } from "effect";
import { ProjectErrorSchema, type ProjectError } from "./domain.contract.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const unwrapResourceFailure = (error: unknown): unknown => {
  if (error instanceof ResourceFailure) {
    return unwrapResourceFailure(error.error);
  }

  if (isRecord(error) && error._tag === "ResourceFailure" && "error" in error) {
    return unwrapResourceFailure(error.error);
  }

  return error;
};

/** Decodes class instances and plain transport objects into the ProjectError contract. */
export const normalizeProjectError = (error: unknown): ProjectError | undefined => {
  const decoded = Effect.runSyncExit(
    Schema.decodeUnknownEffect(ProjectErrorSchema)(unwrapResourceFailure(error)),
  );

  return Exit.isSuccess(decoded) ? decoded.value : undefined;
};

export const isInvalidProjectName = (error: unknown): boolean =>
  normalizeProjectError(error)?._tag === "InvalidProjectName";

export const formatProjectError = (error: unknown): string => {
  const projectError = normalizeProjectError(error);

  switch (projectError?._tag) {
    case "ProjectNotFound":
      return `Project "${projectError.id}" was not found.`;
    case "InvalidProjectName":
      return "Project names need at least three meaningful characters.";
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (isRecord(error) && "_tag" in error) {
    return `Unexpected ${String(error._tag)} failure.`;
  }

  return "Something failed while loading this project.";
};
