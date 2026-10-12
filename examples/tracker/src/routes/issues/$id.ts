import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { IssueId, TrackerError, projectOf } from "../../model.js";
import { ActivityLog, Comments, IssueById, Labels } from "../../resources.js";
import { preloadShell, routeVerdicts } from "../../session.js";

/**
 * One issue with its comments and history. An id that names no issue (or a
 * deleted one) is a 404: the preload's verdict, not a failure.
 */
export const route = Route.define("/issues/:id", {
  params: Schema.Struct({ id: IssueId }),
  error: TrackerError,
  preload: ({ params, href }) =>
    preloadShell(href).pipe(
      Effect.andThen(
        Resource.preload([
          IssueById(params.id),
          Labels(projectOf(params.id)),
          Comments(params.id),
          ActivityLog(params.id),
        ]),
      ),
      routeVerdicts(href),
    ),
  head: ({ params, read }) => {
    const issue = read(IssueById(params.id));
    return { title: issue === undefined ? params.id : `${params.id} ${issue.title}` };
  },
});
