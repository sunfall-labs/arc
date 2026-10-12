import { Server } from "@sunfall/arc-core";
import { Schema } from "effect";
import {
  Activity,
  Comment,
  CommentId,
  Issue,
  IssueChanges,
  IssueId,
  IssuePage,
  IssuePriority,
  IssueQuery,
  IssueRow,
  IssueStatus,
  Label,
  LabelId,
  Project,
  ProjectKey,
  TrackerError,
  User,
  UserId,
} from "./model.js";

/*
 * The server boundary. Each contract is an `effect/rpc` Rpc: the browser
 * calls it over HTTP, and SSR and the action endpoint call the
 * implementation in-process (`api.server.ts`). Browser-safe.
 */

// --- Reads -----------------------------------------------------------------

export const CurrentUserContract = Server.contract("Tracker.session.current", {
  input: Schema.Literal("current"),
  // `null` when the request has no (valid) session.
  output: Schema.NullOr(User),
});

export const TeamContract = Server.contract("Tracker.team.list", {
  input: Schema.Literal("all"),
  output: Schema.Array(User),
  error: TrackerError,
});

export const ProjectsContract = Server.contract("Tracker.projects.list", {
  input: Schema.Literal("all"),
  output: Schema.Array(Project),
  error: TrackerError,
});

export const LabelsContract = Server.contract("Tracker.labels.list", {
  input: ProjectKey,
  output: Schema.Array(Label),
  error: TrackerError,
});

export const BoardContract = Server.contract("Tracker.issues.board", {
  input: ProjectKey,
  output: Schema.Array(IssueRow),
  error: TrackerError,
});

export const IssueChangesContract = Server.contract("Tracker.issues.changes", {
  input: Schema.Struct({ projectKey: ProjectKey, cursor: Schema.Number }),
  output: IssueChanges,
  error: TrackerError,
});

export const SearchIssuesContract = Server.contract("Tracker.issues.search", {
  input: IssueQuery,
  output: IssuePage,
  error: TrackerError,
});

export const MyIssuesContract = Server.contract("Tracker.issues.mine", {
  input: Schema.Literal("open"),
  output: Schema.Array(IssueRow),
  error: TrackerError,
});

export const IssueContract = Server.contract("Tracker.issue.get", {
  input: IssueId,
  output: Issue,
  error: TrackerError,
});

export const CommentsContract = Server.contract("Tracker.issue.comments", {
  input: IssueId,
  output: Schema.Array(Comment),
  error: TrackerError,
});

export const ActivityContract = Server.contract("Tracker.issue.activity", {
  input: IssueId,
  output: Schema.Array(Activity),
  error: TrackerError,
});

// --- Writes ----------------------------------------------------------------

export const SignInInput = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  redirectTo: Schema.optional(Schema.String),
});
export type SignInInput = typeof SignInInput.Type;

export const SignInContract = Server.contract("Tracker.session.signIn", {
  input: SignInInput,
  output: User,
  error: TrackerError,
});

export const SignOutContract = Server.contract("Tracker.session.signOut", {
  input: Schema.Literal("current"),
  output: Schema.Null,
});

export const CreateIssueInput = Schema.Struct({
  projectKey: ProjectKey,
  title: Schema.String,
  description: Schema.String,
  status: IssueStatus,
  priority: IssuePriority,
  assigneeId: Schema.NullOr(UserId),
  labelIds: Schema.Array(LabelId),
});
export type CreateIssueInput = typeof CreateIssueInput.Type;

export const CreateIssueContract = Server.contract("Tracker.issue.create", {
  input: CreateIssueInput,
  output: Issue,
  error: TrackerError,
});

export const UpdateIssueInput = Schema.Struct({
  id: IssueId,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  priority: Schema.optional(IssuePriority),
  assigneeId: Schema.optional(Schema.NullOr(UserId)),
  labelIds: Schema.optional(Schema.Array(LabelId)),
});
export type UpdateIssueInput = typeof UpdateIssueInput.Type;

export const UpdateIssueContract = Server.contract("Tracker.issue.update", {
  input: UpdateIssueInput,
  output: Issue,
  error: TrackerError,
});

export const MoveIssueInput = Schema.Struct({
  id: IssueId,
  status: IssueStatus,
  /** Sort position within the column; the board puts a moved card last. */
  position: Schema.Number,
});
export type MoveIssueInput = typeof MoveIssueInput.Type;

export const MoveIssueContract = Server.contract("Tracker.issue.move", {
  input: MoveIssueInput,
  output: IssueRow,
  error: TrackerError,
});

export const AddCommentInput = Schema.Struct({
  id: CommentId,
  issueId: IssueId,
  body: Schema.String,
});
export type AddCommentInput = typeof AddCommentInput.Type;

export const AddCommentContract = Server.contract("Tracker.issue.comment", {
  input: AddCommentInput,
  output: Comment,
  error: TrackerError,
});

export const IssueRef = Schema.Struct({ id: IssueId });
export type IssueRef = typeof IssueRef.Type;

export const DeleteIssueContract = Server.contract("Tracker.issue.delete", {
  input: IssueRef,
  output: IssueRow,
  error: TrackerError,
});

export const RestoreIssueContract = Server.contract("Tracker.issue.restore", {
  input: IssueRef,
  output: IssueRow,
  error: TrackerError,
});

// --- Browser-safe clients ----------------------------------------------------

export const currentUser = Server.client(CurrentUserContract);
export const listTeam = Server.client(TeamContract);
export const listProjects = Server.client(ProjectsContract);
export const listLabels = Server.client(LabelsContract);
export const listBoard = Server.client(BoardContract);
export const issueChanges = Server.client(IssueChangesContract);
export const searchIssues = Server.client(SearchIssuesContract);
export const myIssues = Server.client(MyIssuesContract);
export const getIssue = Server.client(IssueContract);
export const listComments = Server.client(CommentsContract);
export const listActivity = Server.client(ActivityContract);
export const signIn = Server.client(SignInContract);
export const signOut = Server.client(SignOutContract);
export const createIssue = Server.client(CreateIssueContract);
export const updateIssue = Server.client(UpdateIssueContract);
export const moveIssue = Server.client(MoveIssueContract);
export const addComment = Server.client(AddCommentContract);
export const deleteIssue = Server.client(DeleteIssueContract);
export const restoreIssue = Server.client(RestoreIssueContract);
