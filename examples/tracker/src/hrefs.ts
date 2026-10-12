import { Route } from "@sunfall/arc-core";
import type { IssueId, IssueListSearch, IssueStatus, ProjectKey } from "./model.js";
import { route as IssueRoute } from "./routes/issues/$id.js";
import { route as BoardRoute } from "./routes/projects/$key/index.js";
import { route as IssueListRoute } from "./routes/projects/$key/issues.js";
import { route as NewIssueRoute } from "./routes/projects/$key/new.js";

export { safeRedirect } from "./session.js";

export const issueHref = (id: IssueId): string => Route.href(IssueRoute, { params: { id } });

export const boardHref = (key: ProjectKey): string => Route.href(BoardRoute, { params: { key } });

export const issueListHref = (key: ProjectKey, search: IssueListSearch = {}): string =>
  Route.href(IssueListRoute, { params: { key }, search });

export const newIssueHref = (key: ProjectKey, status?: IssueStatus): string =>
  Route.href(NewIssueRoute, {
    params: { key },
    ...(status === undefined ? {} : { search: { status } }),
  });
