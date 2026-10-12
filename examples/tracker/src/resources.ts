import { Resource, type Server } from "@sunfall/arc-core";
import { Duration, Effect, Option, Schedule, Schema, Stream } from "effect";
import {
  currentUser,
  getIssue,
  issueChanges,
  listActivity,
  listBoard,
  listComments,
  listLabels,
  listProjects,
  listTeam,
  myIssues,
  searchIssues,
} from "./contracts.js";
import {
  Activity,
  Comment,
  Issue,
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
 * Every read the screens make, as Resources over the server functions. Tags
 * name the facts each read provides, so Actions reload them by meaning.
 */

/**
 * A server-function call whose transport failures are defects: a Resource's
 * `error` schema declares the domain failures that render, and a lost
 * connection is not one of them.
 */
export const domainOnly = <A, E, R>(
  effect: Effect.Effect<A, E | Server.ClientError, R>,
): Effect.Effect<A, Exclude<E, Server.ClientError>, R> =>
  effect.pipe(
    Effect.catchTags({
      RpcClientError: Effect.die,
      ServerFunctionNotFound: Effect.die,
      SchemaError: Effect.die,
      EffectInputCallbackError: Effect.die,
    } as never),
  ) as Effect.Effect<A, Exclude<E, Server.ClientError>, R>;

export const SessionTag = Resource.tag("Session");
export const ProjectsTag = Resource.tag("Projects");
export const IssuesTag = Resource.tag<{ readonly projectKey: ProjectKey }>("Issues", {
  key: ({ projectKey }) => projectKey,
});
export const IssueTag = Resource.tag<{ readonly id: IssueId }>("Issue", { key: ({ id }) => id });

export const CurrentUser = Resource.define({
  name: "Tracker.currentUser",
  input: Schema.Literal("current"),
  output: Schema.NullOr(User),
  load: () => domainOnly(currentUser.effect("current")),
  provides: () => [SessionTag],
});
export const CurrentUserRef = CurrentUser("current");

export const Team = Resource.define({
  name: "Tracker.team",
  input: Schema.Literal("all"),
  output: Schema.Array(User),
  error: TrackerError,
  rows: { key: (user) => user.id },
  load: () => domainOnly(listTeam.effect("all")),
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
  load: () => domainOnly(listProjects.effect("all")),
  provides: () => [ProjectsTag, SessionTag],
});
export const ProjectsRef = Projects("all");

export const Labels = Resource.define({
  name: "Tracker.labels",
  input: ProjectKey,
  output: Schema.Array(Label),
  error: TrackerError,
  rows: { key: (label) => label.id },
  load: (projectKey) => domainOnly(listLabels.effect(projectKey)),
  policy: { staleFor: "5 minutes" },
});

/** How often an open board asks the server what changed. */
export const boardPollInterval = Duration.seconds(2);

/**
 * The board: every live issue of a project, keyed by id and indexed by
 * status (the columns). Its change feed polls the server's change log from
 * the newest `seq` the rows already hold, so another tab's moves, edits,
 * creates, and deletes land here without a reload.
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
            Effect.andThen(domainOnly(issueChanges.effect({ projectKey, cursor }))),
            // A failed poll (offline, a restart) waits and asks again from the same cursor.
            Effect.retry(Schedule.spaced(boardPollInterval)),
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
  load: (projectKey) => domainOnly(listBoard.effect(projectKey)),
  provides: (_rows, projectKey) => [IssuesTag({ projectKey })],
});

export const IssueSearch = Resource.define({
  name: "Tracker.issueSearch",
  input: IssueQuery,
  output: IssuePage,
  error: TrackerError,
  load: (query) => domainOnly(searchIssues.effect(query)),
  provides: (_page, query) => [IssuesTag({ projectKey: query.projectKey })],
  policy: { gcFor: "2 minutes" },
});

export const MyIssues = Resource.define({
  name: "Tracker.myIssues",
  input: Schema.Literal("open"),
  output: Schema.Array(IssueRow),
  error: TrackerError,
  rows: { key: (issue) => issue.id },
  load: () => domainOnly(myIssues.effect("open")),
  provides: (rows) => [SessionTag, ...rows.map((issue) => IssueTag({ id: issue.id }))],
});
export const MyIssuesRef = MyIssues("open");

export const IssueById = Resource.define({
  name: "Tracker.issue",
  input: IssueId,
  output: Issue,
  error: TrackerError,
  load: (id) => domainOnly(getIssue.effect(id)),
  provides: (issue) => [IssueTag({ id: issue.id })],
});

export const Comments = Resource.define({
  name: "Tracker.comments",
  input: IssueId,
  output: Schema.Array(Comment),
  error: TrackerError,
  rows: { key: (comment) => comment.id },
  load: (id) => domainOnly(listComments.effect(id)),
  provides: (_comments, id) => [IssueTag({ id })],
});

export const ActivityLog = Resource.define({
  name: "Tracker.activity",
  input: IssueId,
  output: Schema.Array(Activity),
  error: TrackerError,
  rows: { key: (entry) => entry.id },
  load: (id) => domainOnly(listActivity.effect(id)),
  provides: (_entries, id) => [IssueTag({ id })],
});
