import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { IssueStatus, ProjectKey, TrackerError, lenientSearch } from "../../../model.js";
import { Labels } from "../../../resources.js";
import { preloadShell, routeVerdicts } from "../../../session.js";

/** The new-issue form. It works without JavaScript: the form posts the CreateIssue Action. */
export const route = Route.define("/projects/:key/new", {
  params: Schema.Struct({ key: ProjectKey }),
  search: Schema.Struct({ status: lenientSearch(IssueStatus) }),
  error: TrackerError,
  preload: ({ params, href }) =>
    preloadShell(href).pipe(
      Effect.andThen(Resource.preload(Labels(params.key))),
      routeVerdicts(href),
    ),
});
