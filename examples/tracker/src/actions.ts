import { Action, ActionResult, Resource } from "@sunfall/arc-core";
import { DateTime, Effect, Option, Schema } from "effect";
import {
  Comment,
  CommentId,
  Issue,
  IssueId,
  IssuePriority,
  IssueRow,
  IssueStatus,
  LabelId,
  ProjectKey,
  TrackerError,
  UserId,
  projectOf,
} from "./model.js";
import {
  Board,
  Comments,
  CurrentUserRef,
  IssueById,
  IssueTag,
  IssuesTag,
  MyIssuesRef,
  ProjectsTag,
  SessionTag,
} from "./resources.js";

/*
 * Every write is a served Action: declared here (browser-safe: schemas,
 * optimistic patches, invalidations) and run on the server by its
 * implementation in `api.server.ts`. The browser submits it over the action
 * transport; a form without JavaScript posts the same Action.
 */

/** What a form-backed Action answers: where to go next, or the form's errors. */
const FormOutcome = Schema.Union([ActionResult.Redirect, ActionResult.ValidationFailure]);

export const SignInInput = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  redirectTo: Schema.optional(Schema.String),
});
export type SignInInput = typeof SignInInput.Type;

export const SignIn = Action.define({
  name: "Tracker.signIn",
  input: SignInInput,
  output: FormOutcome,
  invalidates: () => [SessionTag],
});

export const SignOut = Action.define({
  name: "Tracker.signOut",
  input: Schema.Struct({}),
  output: ActionResult.Redirect,
  invalidates: () => [SessionTag],
});

/**
 * A new issue. The form posts it as is: the empty "Unassigned" option decodes
 * to `null`, and the label checkboxes to an array of none, one, or several.
 */
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

/** Creates an issue and goes to it; an invalid title comes back as a field error. */
export const CreateIssue = Action.define({
  name: "Tracker.createIssue",
  input: CreateIssueInput,
  output: FormOutcome,
  error: TrackerError,
  invalidates: (_result, input) => [IssuesTag({ projectKey: input.projectKey }), ProjectsTag],
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

/** Patches an issue's fields; the board card and the detail page change at once. */
export const UpdateIssue = Action.define({
  name: "Tracker.updateIssue",
  input: UpdateIssueInput,
  output: Issue,
  error: TrackerError,
  optimistic: ({ id, ...patch }, transaction) => {
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<Issue>;
    return Effect.all([
      transaction.update(Board(projectOf(id)), id, fields as Partial<IssueRow>),
      transaction.update(MyIssuesRef, id, fields as Partial<IssueRow>),
      transaction.set(IssueById(id), (issue) => ({ ...issue, ...fields })),
    ]);
  },
  invalidates: (issue) => [IssueTag({ id: issue.id }), IssuesTag({ projectKey: issue.projectKey })],
});

export const MoveIssueInput = Schema.Struct({
  id: IssueId,
  status: IssueStatus,
  /** Sort position within the column; the board puts a moved card last. */
  position: Schema.Number,
});
export type MoveIssueInput = typeof MoveIssueInput.Type;

/**
 * Moves an issue to another column. The card moves at once; the move is
 * durable, so offline it waits in the Action Outbox (the card stays moved,
 * across reloads too) and syncs when the browser is back online.
 */
export const MoveIssue = Action.define({
  name: "Tracker.moveIssue",
  input: MoveIssueInput,
  output: IssueRow,
  error: TrackerError,
  durable: { maxAge: "1 day" },
  optimistic: ({ id, status, position }, transaction) =>
    Effect.all([
      transaction.update(Board(projectOf(id)), id, { status, position }),
      transaction.update(MyIssuesRef, id, { status, position }),
      transaction.set(IssueById(id), (issue) => ({ ...issue, status, position })),
    ]),
  invalidates: (issue) => [IssueTag({ id: issue.id }), IssuesTag({ projectKey: issue.projectKey })],
});

export const AddCommentInput = Schema.Struct({
  id: CommentId,
  issueId: IssueId,
  body: Schema.String,
});
export type AddCommentInput = typeof AddCommentInput.Type;

/** Adds a comment. The client mints its id, so the optimistic comment is the stored one. */
export const AddComment = Action.define({
  name: "Tracker.addComment",
  input: AddCommentInput,
  output: Comment,
  error: TrackerError,
  optimistic: (input, transaction) =>
    Effect.gen(function* () {
      const user = yield* Resource.read(CurrentUserRef).pipe(Effect.option);
      const author = Option.flatMap(user, Option.fromNullishOr);
      if (Option.isNone(author)) {
        return;
      }
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* transaction.insert(Comments(input.issueId), {
        id: input.id,
        issueId: input.issueId,
        authorId: author.value.id,
        body: input.body.trim(),
        createdAt,
      });
      yield* transaction.update(Board(projectOf(input.issueId)), input.issueId, (row) => ({
        ...row,
        commentCount: row.commentCount + 1,
      }));
    }),
  invalidates: (comment) => [
    IssueTag({ id: comment.issueId }),
    IssuesTag({ projectKey: projectOf(comment.issueId) }),
  ],
});

export const IssueRef = Schema.Struct({ id: IssueId });
export type IssueRef = typeof IssueRef.Type;

/** Deletes an issue (softly: `RestoreIssue` brings it back, which is what Undo sends). */
export const DeleteIssue = Action.define({
  name: "Tracker.deleteIssue",
  input: IssueRef,
  output: IssueRow,
  error: TrackerError,
  optimistic: ({ id }, transaction) =>
    Effect.all([transaction.delete(Board(projectOf(id)), id), transaction.delete(MyIssuesRef, id)]),
  invalidates: (row) => [IssuesTag({ projectKey: row.projectKey }), ProjectsTag],
});

export const RestoreIssue = Action.define({
  name: "Tracker.restoreIssue",
  input: IssueRef,
  output: IssueRow,
  error: TrackerError,
  invalidates: (row) => [
    IssuesTag({ projectKey: row.projectKey }),
    IssueTag({ id: row.id }),
    ProjectsTag,
  ],
});
