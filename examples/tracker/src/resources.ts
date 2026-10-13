import { Resource, Server } from "@sunfall/arc-core";
import { Duration, Effect, Option, Schema, Stream } from "effect";
import {
  Activity,
  Comment,
  Issue,
  IssueChanges,
  IssueId,
  IssuePage,
  IssueQuery,
  IssueRow,
  Label,
  Project,
  ProjectKey,
  TrackerError,
  User,
  type IssueStatus,
} from "./model.js";

/*
 * Every read the screens make, as served Resources: declared here
 * (browser-safe: schemas, rows, tags) and loaded on the server by their
 * implementations in `api.server.ts`, in-process during SSR and over RPC in
 * the browser. Tags name the facts each read provides, so Actions reload
 * them by meaning.
 */

export const SessionTag = Resource.tag("Session");
export const ProjectsTag = Resource.tag("Projects");
export const IssuesTag = Resource.tag<{ readonly projectKey: ProjectKey }>("Issues", {
  key: ({ projectKey }) => projectKey,
});
export const IssueTag = Resource.tag<{ readonly id: IssueId }>("Issue", { key: ({ id }) => id });

export const CurrentUser = Resource.define({
  name: "Tracker.currentUser",
  input: Schema.Literal("current"),
  // `null` when the request has no (valid) session.
  output: Schema.NullOr(User),
  provides: () => [SessionTag],
});
export const CurrentUserRef = CurrentUser("current");

export const Team = Resource.define({
  name: "Tracker.team",
  input: Schema.Literal("all"),
  output: Schema.Array(User),
  error: TrackerError,
  rows: { key: (user) => user.id },
  provides: () => [SessionTag],
  policy: { staleFor: "5 minutes" },
});
export const TeamRef = Team("all");

export const Projects = Resource.define({
  name: "Tracker.projects",
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  error: TrackerError,
  rows: { key: (project) => project.key },
  provides: () => [ProjectsTag, SessionTag],
});
export const ProjectsRef = Projects("all");

export const Labels = Resource.define({
  name: "Tracker.labels",
  input: ProjectKey,
  output: Schema.Array(Label),
  error: TrackerError,
  rows: { key: (label) => label.id },
  policy: { staleFor: "5 minutes" },
});

/** How often an open board asks the server what changed. */
export const boardPollInterval = Duration.seconds(2);

/** What changed on a board since a cursor: the change feed's poll, not a Resource of its own. */
export const IssueChangesContract = Server.contract("Tracker.issues.changes", {
  input: Schema.Struct({ projectKey: ProjectKey, cursor: Schema.Number }),
  output: IssueChanges,
  error: TrackerError,
});
const issueChanges = Server.client(IssueChangesContract);

/**
 * The board: every live issue of a project, keyed by id and indexed by
 * status (the columns). Its change feed polls the server's change log from
 * the newest `seq` the rows already hold, so another tab's moves, edits,
 * creates, and deletes land here without a reload. A failed poll (offline, a
 * server restart) fails the feed: Arc restarts it with backoff from the rows
 * it holds, and the board shows the paused feed (`board.feed`).
 */
export const Board = Resource.define({
  name: "Tracker.board",
  input: ProjectKey,
  output: Schema.Array(IssueRow),
  error: TrackerError,
  rows: {
    key: (issue) => issue.id,
    indexes: {
      status: (issue): IssueStatus => issue.status,
      assignee: (issue) => issue.assigneeId,
    },
    changes: (projectKey, rows) =>
      Stream.paginate(
        rows.reduce((cursor, row) => Math.max(cursor, row.seq), 0),
        (cursor) =>
          Effect.sleep(boardPollInterval).pipe(
            Effect.andThen(issueChanges.effect({ projectKey, cursor })),
            Effect.map(
              (batch) =>
                [
                  [
                    [
                      ...batch.upserts.map((value) => ({ _tag: "Upsert" as const, value })),
                      ...batch.deletes.map((key) => ({ _tag: "Delete" as const, key })),
                    ],
                  ],
                  Option.some(batch.cursor),
                ] as const,
            ),
          ),
      ).pipe(Stream.filter((batch) => batch.length > 0)),
  },
  provides: (_rows, projectKey) => [IssuesTag({ projectKey })],
});

export const IssueSearch = Resource.define({
  name: "Tracker.issueSearch",
  input: IssueQuery,
  output: IssuePage,
  error: TrackerError,
  provides: (_page, query) => [IssuesTag({ projectKey: query.projectKey })],
  policy: { gcFor: "2 minutes" },
});

export const MyIssues = Resource.define({
  name: "Tracker.myIssues",
  input: Schema.Literal("open"),
  output: Schema.Array(IssueRow),
  error: TrackerError,
  rows: { key: (issue) => issue.id },
  provides: (rows) => [SessionTag, ...rows.map((issue) => IssueTag({ id: issue.id }))],
});
export const MyIssuesRef = MyIssues("open");

export const IssueById = Resource.define({
  name: "Tracker.issue",
  input: IssueId,
  output: Issue,
  error: TrackerError,
  provides: (issue) => [IssueTag({ id: issue.id })],
});

export const Comments = Resource.define({
  name: "Tracker.comments",
  input: IssueId,
  output: Schema.Array(Comment),
  error: TrackerError,
  rows: { key: (comment) => comment.id },
  provides: (_comments, id) => [IssueTag({ id })],
});

export const ActivityLog = Resource.define({
  name: "Tracker.activity",
  input: IssueId,
  output: Schema.Array(Activity),
  error: TrackerError,
  rows: { key: (entry) => entry.id },
  provides: (_entries, id) => [IssueTag({ id })],
});
