import { Action, ActionResult, Resource } from "@sunfall/arc-core";
import { DateTime, Effect, Option, Schema } from "effect";
import {
  AddCommentInput,
  type CreateIssueInput,
  IssueRef,
  MoveIssueInput,
  SignInInput,
  UpdateIssueInput,
  addComment,
  createIssue,
  deleteIssue,
  moveIssue,
  restoreIssue,
  signIn,
  signOut,
  updateIssue,
} from "./contracts.js";
import {
  InvalidIssue,
  IssuePriority,
  IssueStatus,
  LabelId,
  ProjectKey,
  UserId,
  projectOf,
  type Issue,
  type IssueRow,
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
  domainOnly,
} from "./resources.js";
import { issueHref, safeRedirect } from "./hrefs.js";

/*
 * Every write is an Action, served by the Start server: the browser submits
 * it over the action transport, and a form without JavaScript posts the same
 * Action. `run` reaches the database through the server functions, which on
 * the server call their implementation in-process.
 */

/** A field-level validation failure becomes a form result instead of an error. */
const asValidation = (error: InvalidIssue) =>
  ActionResult.validation<Record<string, unknown>, string>({
    fieldErrors: { [error.field]: [error.message] },
  });

export const SignIn = Action.define({
  name: "Tracker.signIn",
  input: SignInInput,
  run: (input) =>
    domainOnly(signIn.effect(input)).pipe(
      Effect.map(() => ActionResult.redirect(safeRedirect(input.redirectTo), { replace: true })),
      Effect.catchTag("InvalidIssue", (error) => Effect.succeed(asValidation(error))),
    ),
  invalidates: () => [SessionTag],
});

export const SignOut = Action.define({
  name: "Tracker.signOut",
  input: Schema.Struct({}),
  run: () =>
    domainOnly(signOut.effect("current")).pipe(
      Effect.as(ActionResult.redirect("/signin", { replace: true })),
    ),
  invalidates: () => [SessionTag],
});

/**
 * The new-issue form as the browser posts it: strings only, `assignee` empty
 * for nobody, and `labels` absent, one id, or several. The same shape comes
 * from a no-JavaScript form post and from the enhanced form's `FormData`.
 */
export const CreateIssueForm = Schema.Struct({
  projectKey: ProjectKey,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  status: IssueStatus,
  priority: IssuePriority,
  assignee: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
});
export type CreateIssueForm = typeof CreateIssueForm.Type;

const isUserId = Schema.is(UserId);
const isLabelId = Schema.is(LabelId);

/** The domain input a form names. */
export const createIssueInputOf = (form: CreateIssueForm): CreateIssueInput => ({
  projectKey: form.projectKey,
  title: form.title,
  description: form.description ?? "",
  status: form.status,
  priority: form.priority,
  assigneeId: form.assignee !== undefined && isUserId(form.assignee) ? form.assignee : null,
  labelIds: (form.labels === undefined
    ? []
    : typeof form.labels === "string"
      ? [form.labels]
      : form.labels
  ).filter(isLabelId),
});

export const CreateIssue = Action.define({
  name: "Tracker.createIssue",
  input: CreateIssueForm,
  run: (form) =>
    domainOnly(createIssue.effect(createIssueInputOf(form))).pipe(
      Effect.map((issue: Issue) => ActionResult.redirect(issueHref(issue.id))),
      Effect.catchTag("InvalidIssue", (error) => Effect.succeed(asValidation(error))),
    ),
  invalidates: (_result, input) => [IssuesTag({ projectKey: input.projectKey }), ProjectsTag],
});

/** Patches an issue's fields; the board card and the detail page change at once. */
export const UpdateIssue = Action.define({
  name: "Tracker.updateIssue",
  input: UpdateIssueInput,
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
  run: (input) => domainOnly(updateIssue.effect(input)),
  invalidates: (issue) => [IssueTag({ id: issue.id }), IssuesTag({ projectKey: issue.projectKey })],
});

/**
 * Moves an issue to another column. The card moves at once; the move is
 * durable, so offline it waits in the Action Outbox (the card stays moved,
 * across reloads too) and syncs when the browser is back online.
 */
export const MoveIssue = Action.define({
  name: "Tracker.moveIssue",
  input: MoveIssueInput,
  durable: { maxAge: "1 day" },
  optimistic: ({ id, status, position }, transaction) =>
    Effect.all([
      transaction.update(Board(projectOf(id)), id, { status, position }),
      transaction.update(MyIssuesRef, id, { status, position }),
      transaction.set(IssueById(id), (issue) => ({ ...issue, status, position })),
    ]),
  run: (input) => domainOnly(moveIssue.effect(input)),
  invalidates: (issue) => [IssueTag({ id: issue.id }), IssuesTag({ projectKey: issue.projectKey })],
});

/** Adds a comment. The client mints its id, so the optimistic comment is the stored one. */
export const AddComment = Action.define({
  name: "Tracker.addComment",
  input: AddCommentInput,
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
  run: (input) => domainOnly(addComment.effect(input)),
  invalidates: (comment) => [
    IssueTag({ id: comment.issueId }),
    IssuesTag({ projectKey: projectOf(comment.issueId) }),
  ],
});

/** Deletes an issue (softly: `RestoreIssue` brings it back, which is what Undo sends). */
export const DeleteIssue = Action.define({
  name: "Tracker.deleteIssue",
  input: IssueRef,
  optimistic: ({ id }, transaction) =>
    Effect.all([transaction.delete(Board(projectOf(id)), id), transaction.delete(MyIssuesRef, id)]),
  run: (input) => domainOnly(deleteIssue.effect(input)),
  invalidates: (row) => [IssuesTag({ projectKey: row.projectKey }), ProjectsTag],
});

export const RestoreIssue = Action.define({
  name: "Tracker.restoreIssue",
  input: IssueRef,
  run: (input) => domainOnly(restoreIssue.effect(input)),
  invalidates: (row) => [
    IssuesTag({ projectKey: row.projectKey }),
    IssueTag({ id: row.id }),
    ProjectsTag,
  ],
});

/** The Actions the Start server serves (all of them: every write reaches the database). */
export const trackerActions = [
  SignIn,
  SignOut,
  CreateIssue,
  UpdateIssue,
  MoveIssue,
  AddComment,
  DeleteIssue,
  RestoreIssue,
] as const;
