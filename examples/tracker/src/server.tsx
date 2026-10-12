import { Route } from "@sunfall/arc-core";
import { createRequestHandler } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { implementations } from "./api.server.js";
import { TrackerDatabaseLive } from "./db.server.js";
import { route as IssueRoute } from "./routes/issues/$id.js";
import { route as BoardRoute } from "./routes/projects/$key/index.js";
import { route as IssueListRoute } from "./routes/projects/$key/issues.js";
import "./styles.css";

const title = (page: string | undefined): string =>
  page === undefined ? "Tracker" : `${page} · Tracker`;

export const handleRequest = createRequestHandler(app, {
  server: TrackerDatabaseLive,
  implementations,
  document: ({ match }) => ({
    title: title(
      Route.isMatch(IssueRoute, match)
        ? match.params.id
        : Route.isMatch(BoardRoute, match)
          ? `${match.params.key} board`
          : Route.isMatch(IssueListRoute, match)
            ? `${match.params.key} issues`
            : undefined,
    ),
    meta: [{ name: "color-scheme", content: "light dark" }],
  }),
});

export default handleRequest;
