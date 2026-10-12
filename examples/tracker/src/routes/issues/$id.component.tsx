import { State, type Route } from "@sunfall/arc-core";
import { Component, RouterLink, useRouter } from "@sunfall/arc-solid";
import { Cause, Effect } from "effect";
import { For, Show, untrack } from "solid-js";
import { AddComment, DeleteIssue, MoveIssue, UpdateIssue } from "../../actions.js";
import { boardHref } from "../../hrefs.js";
import { Markdown } from "../../markdown.js";
import {
  describeError,
  issuePriorities,
  issueStatuses,
  priorityLabel,
  projectOf,
  statusLabel,
  type Activity,
  type Comment,
  type CommentId,
  type IssueId,
  type IssuePriority,
  type IssueStatus,
  type LabelId,
  type User,
  type UserId,
} from "../../model.js";
import {
  ActivityLog,
  Comments,
  CurrentUser,
  IssueById,
  Labels,
  Projects,
  Team,
} from "../../resources.js";
import { useShell } from "../../shell.js";
import { Avatar, PriorityIcon, StatusIcon, formatDate, formatDateTime } from "../../ui.js";
import { route as BoardRoute } from "../projects/$key/index.js";
import type { route } from "./$id.js";

type EditorModel = {
  readonly editing: "title" | "description" | null;
  readonly comment: string;
};

/** The page's own UI state: which field is being edited, and the comment draft. */
const IssueEditor = State.define({
  name: "Issue.editor",
  initial: { editing: null, comment: "" } as EditorModel,
  on: {
    Edit: (model, message: { readonly field: "title" | "description" }) => ({
      ...model,
      editing: message.field,
    }),
    StopEditing: (model) => ({ ...model, editing: null }),
    Draft: (model, message: { readonly text: string }) => ({ ...model, comment: message.text }),
    ClearDraft: (model) => ({ ...model, comment: "" }),
  },
});

const newCommentId = (): CommentId => `c_${crypto.randomUUID().replaceAll("-", "")}` as CommentId;

type Entry =
  | { readonly _tag: "Comment"; readonly at: string; readonly comment: Comment }
  | { readonly _tag: "Activity"; readonly at: string; readonly activity: Activity };

const IssueView = Component.define("IssueView", function* (props: { readonly id: IssueId }) {
  const issue = yield* Component.resource(IssueById);
  const comments = yield* Component.resource(Comments);
  const activity = yield* Component.resource(ActivityLog);
  const team = yield* Component.resource(Team);
  const labels = yield* Component.resource(Labels);
  const projects = yield* Component.resource(Projects);
  const user = yield* Component.resource(CurrentUser);
  const editor = yield* Component.state(IssueEditor);
  const update = yield* Component.action(UpdateIssue);
  const move = yield* Component.action(MoveIssue);
  const comment = yield* Component.action(AddComment);
  const remove = yield* Component.action(DeleteIssue);
  const router = useRouter();
  const shell = useShell();
  const id = untrack(() => props.id);
  const projectKey = projectOf(id);

  const people = () => new Map<string, User>(team("all").map((member) => [member.id, member]));
  const person = (userId: UserId | null) => (userId === null ? undefined : people().get(userId));

  const patch = yield* Component.callback(
    "update",
    (fields: {
      readonly title?: string;
      readonly description?: string;
      readonly priority?: IssuePriority;
      readonly assigneeId?: UserId | null;
      readonly labelIds?: ReadonlyArray<LabelId>;
    }) =>
      editor
        .dispatch({ _tag: "StopEditing" })
        .pipe(Effect.andThen(update.submit({ id, ...fields })), Effect.ignore),
  );
  const setStatus = yield* Component.callback("status", (status: IssueStatus) =>
    move.submit({ id, status, position: issue(id).position }).pipe(Effect.ignore),
  );
  const postComment = yield* Component.callback("comment", (body: string) =>
    body.trim() === ""
      ? Effect.void
      : editor
          .dispatch({ _tag: "ClearDraft" })
          .pipe(
            Effect.andThen(comment.submit({ id: newCommentId(), issueId: id, body })),
            Effect.ignore,
          ),
  );
  const deleteIssue = yield* Component.callback("delete", () => {
    const title = issue(id).title;
    return remove.submit({ id }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          shell.deleted({ id, title });
          router.navigateHref(boardHref(projectKey));
        }),
      ),
      Effect.ignore,
    );
  });

  const entries = (): ReadonlyArray<Entry> =>
    [
      ...comments(id).map(
        (entry): Entry => ({ _tag: "Comment", at: entry.createdAt, comment: entry }),
      ),
      ...activity(id)
        .filter((entry) => entry.kind !== "commented")
        .map((entry): Entry => ({ _tag: "Activity", at: entry.createdAt, activity: entry })),
    ]
      .slice()
      .sort((left, right) => left.at.localeCompare(right.at));

  const toggleLabel = (labelId: LabelId) => {
    const current = issue(id).labelIds;
    patch({
      labelIds: current.includes(labelId)
        ? current.filter((existing) => existing !== labelId)
        : [...current, labelId],
    });
  };

  const failure = () => update.failure() ?? move.failure() ?? comment.failure() ?? remove.failure();

  return () => (
    <article class={["issuePage", { refreshing: issue.waiting(id) }]} data-testid="issue-page">
      <div class="issueMain">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <RouterLink route={BoardRoute} options={{ params: { key: projectKey } }}>
            {projects("all").find((project) => project.key === projectKey)?.name ?? projectKey}
          </RouterLink>
          <span aria-hidden="true">/</span>
          <span>{id}</span>
        </nav>

        <Show
          when={editor.model().editing === "title"}
          fallback={
            <h1 class="issueHeading">
              <button
                type="button"
                class="editable"
                title="Edit title"
                onClick={() => editor.send.Edit({ field: "title" })}
              >
                {issue(id).title}
              </button>
            </h1>
          }
        >
          <form
            class="inlineForm"
            onSubmit={(event) => {
              event.preventDefault();
              patch({ title: String(new FormData(event.currentTarget).get("title") ?? "") });
            }}
          >
            <input name="title" value={issue(id).title} aria-label="Title" autofocus />
            <button type="submit" class="primaryButton small">
              Save
            </button>
            <button type="button" class="ghostButton small" onClick={editor.send.StopEditing}>
              Cancel
            </button>
          </form>
        </Show>

        <section class="description" aria-label="Description">
          <Show
            when={editor.model().editing === "description"}
            fallback={
              <>
                <Show
                  when={issue(id).description !== ""}
                  fallback={<p class="muted">No description yet.</p>}
                >
                  <Markdown source={issue(id).description} />
                </Show>
                <button
                  type="button"
                  class="linkButton"
                  onClick={() => editor.send.Edit({ field: "description" })}
                >
                  Edit description
                </button>
              </>
            }
          >
            <form
              class="stackForm"
              onSubmit={(event) => {
                event.preventDefault();
                patch({
                  description: String(new FormData(event.currentTarget).get("description") ?? ""),
                });
              }}
            >
              <textarea name="description" rows={10} aria-label="Description">
                {issue(id).description}
              </textarea>
              <div class="formActions">
                <button type="button" class="ghostButton small" onClick={editor.send.StopEditing}>
                  Cancel
                </button>
                <button type="submit" class="primaryButton small">
                  Save
                </button>
              </div>
            </form>
          </Show>
        </section>

        <Show when={failure()}>
          {(cause) => (
            <p class="banner" role="status">
              {describeError(Cause.squash(cause()))}
            </p>
          )}
        </Show>

        <section class="activity" aria-label="Activity">
          <h2 class="sectionTitle">Activity</h2>
          <ol class="timeline" data-testid="activity">
            <For
              each={entries()}
              keyed={(entry) =>
                entry._tag === "Comment" ? entry.comment.id : `a${entry.activity.id}`
              }
            >
              {(entry) => <EntryView entry={entry()} person={person} />}
            </For>
          </ol>

          <form
            class="composer"
            onSubmit={(event) => {
              event.preventDefault();
              postComment(editor.model().comment);
            }}
          >
            <Avatar user={user("current") ?? undefined} />
            <textarea
              name="body"
              rows={3}
              placeholder="Leave a comment. Markdown works."
              aria-label="Comment"
              value={editor.model().comment}
              onInput={(event) => editor.send.Draft({ text: event.currentTarget.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  postComment(editor.model().comment);
                }
              }}
            />
            <button
              type="submit"
              class="primaryButton small"
              disabled={editor.model().comment.trim() === ""}
            >
              Comment
            </button>
          </form>
        </section>
      </div>

      <aside class="issueSide" aria-label="Properties">
        <label class="field">
          <span>Status</span>
          <span class="selectWithIcon">
            <StatusIcon status={issue(id).status} />
            <select
              name="status"
              value={issue(id).status}
              onChange={(event) => setStatus(event.currentTarget.value as IssueStatus)}
            >
              <For each={issueStatuses}>
                {(status) => <option value={status}>{statusLabel(status)}</option>}
              </For>
            </select>
          </span>
        </label>
        <label class="field">
          <span>Priority</span>
          <span class="selectWithIcon">
            <PriorityIcon priority={issue(id).priority} />
            <select
              name="priority"
              value={issue(id).priority}
              onChange={(event) => patch({ priority: event.currentTarget.value as IssuePriority })}
            >
              <For each={issuePriorities}>
                {(priority) => <option value={priority}>{priorityLabel(priority)}</option>}
              </For>
            </select>
          </span>
        </label>
        <label class="field">
          <span>Assignee</span>
          <span class="selectWithIcon">
            <Avatar user={person(issue(id).assigneeId)} />
            <select
              name="assignee"
              value={issue(id).assigneeId ?? ""}
              onChange={(event) =>
                patch({ assigneeId: (event.currentTarget.value || null) as UserId | null })
              }
            >
              <option value="">Unassigned</option>
              <For each={team("all")}>
                {(member) => <option value={member.id}>{member.name}</option>}
              </For>
            </select>
          </span>
        </label>
        <fieldset class="field labelPicker">
          <legend>Labels</legend>
          <For each={labels(projectKey)}>
            {(label) => (
              <label class="labelOption" style={{ "--label": label.color }}>
                <input
                  type="checkbox"
                  checked={issue(id).labelIds.includes(label.id)}
                  onChange={() => toggleLabel(label.id)}
                />
                {label.name}
              </label>
            )}
          </For>
        </fieldset>
        <dl class="facts">
          <dt>Reporter</dt>
          <dd>{person(issue(id).reporterId)?.name ?? "Someone"}</dd>
          <dt>Created</dt>
          <dd>{formatDate(issue(id).createdAt)}</dd>
          <dt>Updated</dt>
          <dd>{formatDate(issue(id).updatedAt)}</dd>
        </dl>
        <button type="button" class="ghostButton danger" onClick={() => deleteIssue()}>
          Delete issue
        </button>
      </aside>
    </article>
  );
});

/** One line of the activity timeline: a comment card or a change. */
function EntryView(props: {
  readonly entry: Entry;
  readonly person: (id: UserId | null) => User | undefined;
}) {
  return (
    <Show
      when={props.entry._tag === "Comment" ? props.entry.comment : undefined}
      fallback={
        <ActivityItem
          activity={(props.entry as Extract<Entry, { _tag: "Activity" }>).activity}
          person={props.person}
        />
      }
    >
      {(comment) => <CommentItem comment={comment()} person={props.person} />}
    </Show>
  );
}

function CommentItem(props: {
  readonly comment: Comment;
  readonly person: (id: UserId | null) => User | undefined;
}) {
  return (
    <li class="commentCard" data-comment={props.comment.id}>
      <header>
        <Avatar user={props.person(props.comment.authorId)} />
        <strong>{props.person(props.comment.authorId)?.name ?? "Someone"}</strong>
        <time class="muted">{formatDateTime(props.comment.createdAt)}</time>
      </header>
      <Markdown source={props.comment.body} />
    </li>
  );
}

function ActivityItem(props: {
  readonly activity: Activity;
  readonly person: (id: UserId | null) => User | undefined;
}) {
  return (
    <li class="activityLine">
      <Avatar user={props.person(props.activity.actorId)} />
      <span>
        <strong>{props.person(props.activity.actorId)?.name ?? "Someone"}</strong>{" "}
        {props.activity.detail}
      </span>
      <time class="muted">{formatDate(props.activity.createdAt)}</time>
    </li>
  );
}

/** The `/issues/:id` page: a fresh view (and editor State) per issue. */
export default Component.define("IssuePage", function* (props: Route.Props<typeof route>) {
  const View = yield* IssueView;
  return () => (
    <Show when={props.params.id} keyed>
      {(id) => <View id={id} />}
    </Show>
  );
}).pipe(Component.catchAll((error) => <p role="alert">{describeError(error)}</p>));
