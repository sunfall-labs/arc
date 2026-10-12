import { State, type Route } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { Cause, Effect } from "effect";
import { For, Show } from "solid-js";
import { DeleteIssue, MoveIssue } from "../../../actions.js";
import {
  describeError,
  issueStatuses,
  statusLabel,
  type IssueId,
  type IssueRow,
  type IssueStatus,
  type Label,
  type ProjectKey,
  type User,
} from "../../../model.js";
import { ProjectHeader } from "../../../project-header.js";
import { Board, CurrentUser, Labels, Projects, Team } from "../../../resources.js";
import { useShell } from "../../../shell.js";
import { Avatar, Icon, LabelChips, PriorityIcon } from "../../../ui.js";
import { route as IssueRoute } from "../../issues/$id.js";
import { route as NewIssueRoute } from "./new.js";
import type { route } from "./index.js";

type BoardUiModel = { readonly onlyMine: boolean; readonly dragOver: IssueStatus | null };

/** The board's own UI state: the "only mine" filter and the column a card is dragged over. */
const BoardUi = State.define({
  name: "Board.ui",
  initial: { onlyMine: false, dragOver: null } as BoardUiModel,
  on: {
    ToggleMine: (model) => ({ ...model, onlyMine: !model.onlyMine }),
    DragOver: (model, message: { readonly status: IssueStatus | null }) =>
      model.dragOver === message.status ? model : { ...model, dragOver: message.status },
  },
});

const neighbour = (status: IssueStatus, step: -1 | 1): IssueStatus | undefined =>
  issueStatuses[issueStatuses.indexOf(status) + step];

/**
 * A project's board. Each column reads the board rows' `status` index, so a
 * move (here, in another tab, or replayed after a reload) re-files the card
 * without rebuilding the board.
 */
const BoardView = Component.define(
  "BoardView",
  function* (props: { readonly projectKey: ProjectKey }) {
    const board = yield* Component.resource(Board);
    const projects = yield* Component.resource(Projects);
    const team = yield* Component.resource(Team);
    const labels = yield* Component.resource(Labels);
    const user = yield* Component.resource(CurrentUser);
    const ui = yield* Component.state(BoardUi);
    const move = yield* Component.action(MoveIssue);
    const remove = yield* Component.action(DeleteIssue);
    const shell = useShell();

    const people = () => new Map<string, User>(team("all").map((member) => [member.id, member]));
    const column = (status: IssueStatus): ReadonlyArray<IssueRow> => {
      const me = user("current")?.id;
      return board
        .index(props.projectKey, "status", status)
        .filter((issue) => !ui.model().onlyMine || issue.assigneeId === me)
        .slice()
        .sort((left, right) => left.position - right.position);
    };
    // A moved card goes to the bottom of its new column.
    const lastPosition = () =>
      board(props.projectKey).reduce((max, issue) => Math.max(max, issue.position), 0);

    const moveTo = yield* Component.callback("move", (id: IssueId, status: IssueStatus) =>
      // Offline, the move waits in the outbox (`ActionQueued`): the card stays put.
      move.submit({ id, status, position: lastPosition() + 1 }).pipe(Effect.ignore),
    );
    const deleteIssue = yield* Component.callback("delete", (issue: IssueRow) =>
      remove.submit({ id: issue.id }).pipe(
        Effect.tap(() => Effect.sync(() => shell.deleted({ id: issue.id, title: issue.title }))),
        Effect.ignore,
      ),
    );

    return () => (
      <div class={["boardPage", { refreshing: board.waiting(props.projectKey) }]}>
        <ProjectHeader
          projectKey={props.projectKey}
          project={projects("all").find((project) => project.key === props.projectKey)}
          view="board"
        >
          <button
            type="button"
            class={["ghostButton", { active: ui.model().onlyMine }]}
            aria-pressed={ui.model().onlyMine ? "true" : "false"}
            onClick={ui.send.ToggleMine}
          >
            Only mine
          </button>
        </ProjectHeader>

        <Show when={move.failure() ?? remove.failure()}>
          {(cause) => (
            <p class="banner" role="status">
              {describeError(Cause.squash(cause()))}
            </p>
          )}
        </Show>

        <div class="board" data-testid="board">
          <For each={issueStatuses}>
            {(status) => (
              <section
                class={["column", { dragOver: ui.model().dragOver === status }]}
                data-status={status}
                aria-label={statusLabel(status)}
                onDragOver={(event) => {
                  event.preventDefault();
                  ui.send.DragOver({ status });
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    ui.send.DragOver({ status: null });
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  ui.send.DragOver({ status: null });
                  const id = event.dataTransfer?.getData("text/x-issue-id");
                  const card = column(status).find((issue) => issue.id === id);
                  if (id && card === undefined) {
                    moveTo(id as IssueId, status);
                  }
                }}
              >
                <header class="columnHeader">
                  <span class={["statusIcon", status]} aria-hidden="true" />
                  <h2>{statusLabel(status)}</h2>
                  <span class="count">{column(status).length}</span>
                  <RouterLink
                    route={NewIssueRoute}
                    options={{ params: { key: props.projectKey }, search: { status } }}
                    class="iconButton"
                    aria-label={`New issue in ${statusLabel(status)}`}
                  >
                    <Icon.plus />
                  </RouterLink>
                </header>
                <ol class="cards">
                  <For each={column(status)} keyed={(issue) => issue.id}>
                    {(issue) => (
                      <BoardCard
                        issue={issue()}
                        people={people()}
                        labels={labels(props.projectKey)}
                        onMove={(to) => moveTo(issue().id, to)}
                        onDelete={() => deleteIssue(issue())}
                      />
                    )}
                  </For>
                </ol>
              </section>
            )}
          </For>
        </div>
      </div>
    );
  },
);

function BoardCard(props: {
  readonly issue: IssueRow;
  readonly people: ReadonlyMap<string, User>;
  readonly labels: ReadonlyArray<Label>;
  readonly onMove: (status: IssueStatus) => void;
  readonly onDelete: () => void;
}) {
  const previous = () => neighbour(props.issue.status, -1);
  const next = () => neighbour(props.issue.status, 1);
  return (
    <li
      class="card"
      draggable="true"
      data-issue={props.issue.id}
      onDragStart={(event) => {
        event.dataTransfer?.setData("text/x-issue-id", props.issue.id);
        event.dataTransfer!.effectAllowed = "move";
      }}
    >
      <div class="cardTop">
        <span class="issueKey">{props.issue.id}</span>
        <Avatar
          user={
            props.issue.assigneeId === null ? undefined : props.people.get(props.issue.assigneeId)
          }
        />
      </div>
      <RouterLink route={IssueRoute} options={{ params: { id: props.issue.id } }} class="cardTitle">
        {props.issue.title}
      </RouterLink>
      <div class="cardBottom">
        <PriorityIcon priority={props.issue.priority} />
        <LabelChips ids={props.issue.labelIds} labels={props.labels} />
        <Show when={props.issue.commentCount > 0}>
          <span class="commentCount" title={`${props.issue.commentCount} comments`}>
            <Icon.comment />
            {props.issue.commentCount}
          </span>
        </Show>
        <span class="cardActions">
          <Show when={previous()}>
            {(status) => (
              <button
                type="button"
                class="iconButton"
                aria-label={`Move ${props.issue.id} to ${statusLabel(status())}`}
                onClick={() => props.onMove(status())}
              >
                <Icon.left />
              </button>
            )}
          </Show>
          <Show when={next()}>
            {(status) => (
              <button
                type="button"
                class="iconButton"
                aria-label={`Move ${props.issue.id} to ${statusLabel(status())}`}
                onClick={() => props.onMove(status())}
              >
                <Icon.right />
              </button>
            )}
          </Show>
          <button
            type="button"
            class="iconButton danger"
            aria-label={`Delete ${props.issue.id}`}
            onClick={() => props.onDelete()}
          >
            <Icon.trash />
          </button>
        </span>
      </div>
    </li>
  );
}

/** The `/projects/:key` page: one board per project, a fresh instance per key. */
export default Component.define("BoardPage", function* (props: Route.Props<typeof route>) {
  const View = yield* BoardView;
  return () => (
    <Show when={props.params.key} keyed>
      {(key) => <View projectKey={key} />}
    </Show>
  );
}).pipe(Component.catchAll((error) => <p role="alert">{describeError(error)}</p>));
