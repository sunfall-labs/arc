import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { IssueListSearch, ProjectKey, TrackerError, issueQueryOf } from "../../../model.js";
import { CurrentUser, IssueSearch, Labels, Projects, Team } from "../../../resources.js";
import { preloadShell, routeVerdicts } from "../../../session.js";

/**
 * A project's issues as a list. Search, filters, sort, and page live in the
 * URL, so every view of the list is a link.
 */
export const route = Route.define("/projects/:key/issues", {
  params: Schema.Struct({ key: ProjectKey }),
  search: IssueListSearch,
  error: TrackerError,
  preloadResources: [CurrentUser, Projects, Team, Labels, IssueSearch],
  preload: ({ params, search, href }) =>
    preloadShell(href).pipe(
      Effect.andThen(
        Resource.preload([Labels(params.key), IssueSearch(issueQueryOf(params.key, search))]),
      ),
      routeVerdicts(href),
    ),
});
