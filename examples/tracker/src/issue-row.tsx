import { RouterLink } from "@sunfall/arc-solid";
import { Show } from "solid-js";
import type { IssueRow, Label, User } from "./model.js";
import { route as IssueRoute } from "./routes/issues/$id.js";
import { Avatar, Icon, LabelChips, PriorityIcon, StatusIcon, formatDate } from "./ui.js";

/** One issue as a row of a list: the home page's and the list view's. */
export function IssueRowView(props: {
  readonly issue: IssueRow;
  readonly people: ReadonlyMap<string, User>;
  readonly labels: ReadonlyArray<Label>;
}) {
  return (
    <li class="issueRow" data-issue={props.issue.id}>
      <PriorityIcon priority={props.issue.priority} />
      <span class="issueKey">{props.issue.id}</span>
      <StatusIcon status={props.issue.status} />
      <RouterLink
        route={IssueRoute}
        options={{ params: { id: props.issue.id } }}
        class="issueTitle"
      >
        {props.issue.title}
      </RouterLink>
      <span class="issueMeta">
        <LabelChips ids={props.issue.labelIds} labels={props.labels} />
        <Show when={props.issue.commentCount > 0}>
          <span class="commentCount" title={`${props.issue.commentCount} comments`}>
            <Icon.comment />
            {props.issue.commentCount}
          </span>
        </Show>
        <span class="issueDate">{formatDate(props.issue.updatedAt)}</span>
        <Avatar
          user={
            props.issue.assigneeId === null ? undefined : props.people.get(props.issue.assigneeId)
          }
        />
      </span>
    </li>
  );
}
