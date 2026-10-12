import { Effect, Option, Schema } from "effect";

/*
 * The Tracker's domain vocabulary: branded ids, the rows the screens read,
 * and the typed failures. Browser-safe: no server code imports from here
 * that the browser could not also load.
 */

export const ProjectKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9]{1,9}$/)),
  Schema.brand("ProjectKey"),
);
export type ProjectKey = typeof ProjectKey.Type;

export const IssueId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,6}$/)),
  Schema.brand("IssueId"),
);
export type IssueId = typeof IssueId.Type;

/** The project an issue belongs to: the key its id starts with (`TRK-12` is in `TRK`). */
export const projectOf = (id: IssueId): ProjectKey =>
  id.slice(0, id.lastIndexOf("-")) as ProjectKey;

export const UserId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^u_[a-z0-9]{6,32}$/)),
  Schema.brand("UserId"),
);
export type UserId = typeof UserId.Type;

export const LabelId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^l_[a-z0-9-]{1,40}$/)),
  Schema.brand("LabelId"),
);
export type LabelId = typeof LabelId.Type;

/** Comment ids are minted by the client, so an optimistic comment and the stored one share a key. */
export const CommentId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^c_[a-z0-9]{8,40}$/)),
  Schema.brand("CommentId"),
);
export type CommentId = typeof CommentId.Type;

export const issueStatuses = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
export const IssueStatus = Schema.Literals(issueStatuses);
export type IssueStatus = typeof IssueStatus.Type;

export const issuePriorities = ["urgent", "high", "medium", "low", "none"] as const;
export const IssuePriority = Schema.Literals(issuePriorities);
export type IssuePriority = typeof IssuePriority.Type;

export const issueSorts = ["updated", "created", "priority", "title"] as const;
export const IssueSort = Schema.Literals(issueSorts);
export type IssueSort = typeof IssueSort.Type;

export const statusLabel = (status: IssueStatus): string => {
  switch (status) {
    case "backlog":
      return "Backlog";
    case "todo":
      return "Todo";
    case "in_progress":
      return "In progress";
    case "in_review":
      return "In review";
    case "done":
      return "Done";
  }
};

export const priorityLabel = (priority: IssuePriority): string => {
  switch (priority) {
    case "urgent":
      return "Urgent";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "none":
      return "No priority";
  }
};

export const priorityRank = (priority: IssuePriority): number => issuePriorities.indexOf(priority);

export const User = Schema.Struct({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
});
export type User = typeof User.Type;

export const Label = Schema.Struct({
  id: LabelId,
  projectKey: ProjectKey,
  name: Schema.String,
  color: Schema.String,
});
export type Label = typeof Label.Type;

export const Project = Schema.Struct({
  key: ProjectKey,
  name: Schema.String,
  description: Schema.String,
  openCount: Schema.Number,
});
export type Project = typeof Project.Type;

/** One issue as the board and the list show it. `seq` is the change-log position of its last write. */
export const IssueRow = Schema.Struct({
  id: IssueId,
  projectKey: ProjectKey,
  number: Schema.Number,
  title: Schema.String,
  status: IssueStatus,
  priority: IssuePriority,
  assigneeId: Schema.NullOr(UserId),
  labelIds: Schema.Array(LabelId),
  commentCount: Schema.Number,
  position: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  seq: Schema.Number,
});
export type IssueRow = typeof IssueRow.Type;

export const Issue = Schema.Struct({
  ...IssueRow.fields,
  description: Schema.String,
  reporterId: UserId,
});
export type Issue = typeof Issue.Type;

export const Comment = Schema.Struct({
  id: CommentId,
  issueId: IssueId,
  authorId: UserId,
  body: Schema.String,
  createdAt: Schema.String,
});
export type Comment = typeof Comment.Type;

export const ActivityKind = Schema.Literals([
  "created",
  "status",
  "priority",
  "assignee",
  "title",
  "description",
  "labels",
  "commented",
  "deleted",
  "restored",
]);
export type ActivityKind = typeof ActivityKind.Type;

export const Activity = Schema.Struct({
  id: Schema.Number,
  issueId: IssueId,
  actorId: UserId,
  kind: ActivityKind,
  /** What changed, already phrased for people: "Todo → In progress". */
  detail: Schema.String,
  createdAt: Schema.String,
});
export type Activity = typeof Activity.Type;

/** The list view's query: every field is addressable in the URL. */
export const IssueQuery = Schema.Struct({
  projectKey: ProjectKey,
  q: Schema.String,
  status: Schema.NullOr(IssueStatus),
  priority: Schema.NullOr(IssuePriority),
  /** `"me"` is resolved on the server against the session's user. */
  assignee: Schema.NullOr(Schema.Union([UserId, Schema.Literals(["me", "none"])])),
  label: Schema.NullOr(LabelId),
  sort: IssueSort,
  page: Schema.Number,
});
export type IssueQuery = typeof IssueQuery.Type;

export const issuePageSize = 20;

export const IssuePage = Schema.Struct({
  rows: Schema.Array(IssueRow),
  total: Schema.Number,
  page: Schema.Number,
  pageCount: Schema.Number,
});
export type IssuePage = typeof IssuePage.Type;

/** A change-feed batch: issues written since `cursor`, and the next cursor. */
export const IssueChanges = Schema.Struct({
  upserts: Schema.Array(IssueRow),
  deletes: Schema.Array(IssueId),
  cursor: Schema.Number,
});
export type IssueChanges = typeof IssueChanges.Type;

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()("Unauthenticated", {}) {}

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  key: Schema.String,
}) {}

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()("IssueNotFound", {
  id: Schema.String,
}) {}

export class InvalidIssue extends Schema.TaggedError<InvalidIssue>()("InvalidIssue", {
  field: Schema.String,
  message: Schema.String,
}) {}

export const TrackerError = Schema.Union([
  Unauthenticated,
  ProjectNotFound,
  IssueNotFound,
  InvalidIssue,
]);
export type TrackerError = typeof TrackerError.Type;

export const describeError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    switch ((error as { readonly _tag: unknown })._tag) {
      case "Unauthenticated":
        return "Your session ended. Sign in again.";
      case "ProjectNotFound":
        return "That project does not exist.";
      case "IssueNotFound":
        return "That issue no longer exists.";
      case "InvalidIssue":
        return (error as InvalidIssue).message;
      case "ActionQueued":
        return "Offline: the change is saved and will sync.";
      case "ActionTransportError":
      case "RpcClientError":
        return "Could not reach the server.";
    }
  }
  return "Something went wrong.";
};

/**
 * A search-param schema that ignores a value it cannot decode, so a stale or
 * hand-edited URL (`?status=bogus`) still opens the page instead of failing
 * the request.
 */
export const lenientSearch = <S extends Schema.Top>(schema: S) =>
  Schema.optional(
    schema.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))) as unknown as S,
  );

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/** The list view's search params. A value that does not decode is ignored. */
export const IssueListSearch = Schema.Struct({
  q: lenientSearch(Schema.String),
  status: lenientSearch(IssueStatus),
  priority: lenientSearch(IssuePriority),
  assignee: lenientSearch(Schema.Union([UserId, Schema.Literals(["me", "none"])])),
  label: lenientSearch(LabelId),
  sort: lenientSearch(IssueSort),
  page: lenientSearch(
    Schema.FiniteFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  ),
});
export type IssueListSearch = typeof IssueListSearch.Type;

/** The server query a list URL names, with every default filled in. */
export const issueQueryOf = (projectKey: ProjectKey, search: IssueListSearch): IssueQuery => ({
  projectKey,
  q: search.q ?? "",
  status: search.status ?? null,
  priority: search.priority ?? null,
  assignee: search.assignee ?? null,
  label: search.label ?? null,
  sort: search.sort ?? "updated",
  page: search.page ?? 1,
});
