import { State, type Route } from "@sunfall/arc-core";
import { Component, RouterLink, useRouter } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { For, Show, untrack } from "solid-js";
import { IssueRowView } from "../../../issue-row.js";
import { issueListHref } from "../../../hrefs.js";
import {
  describeError,
  issuePriorities,
  issueQueryOf,
  issueSorts,
  issueStatuses,
  priorityLabel,
  statusLabel,
  type IssueListSearch,
  type User,
} from "../../../model.js";
import { ProjectHeader } from "../../../project-header.js";
import { IssueSearch, Labels, Projects, Team } from "../../../resources.js";
import { EmptyState, Icon } from "../../../ui.js";
import { route as IssueListRoute, type route } from "./issues.js";

const sortLabel: Record<(typeof issueSorts)[number], string> = {
  updated: "Recently updated",
  created: "Newest",
  priority: "Priority",
  title: "Title",
};

type SearchBoxModel = { readonly draft: string };
type SearchBoxMessage =
  | { readonly _tag: "Type"; readonly text: string }
  | { readonly _tag: "Settle"; readonly text: string };

/**
 * The list view. Everything that shapes the list (search, filters, sort, and
 * page) is in the URL: typing updates `?q=` after a pause, and every filter
 * is a navigation, so Back, reload, and a shared link all show this list.
 */
export default Component.define("IssueListPage", function* (props: Route.Props<typeof route>) {
  const issues = yield* Component.resource(IssueSearch);
  const projects = yield* Component.resource(Projects);
  const team = yield* Component.resource(Team);
  const labels = yield* Component.resource(Labels);
  const router = useRouter();
  const key = () => props.params.key;
  const query = () => issueQueryOf(key(), props.search);

  /** Navigates to this list with `change` applied; any change but paging goes back to page 1. */
  const go = (change: IssueListSearch, options: { readonly replace?: boolean } = {}) => {
    const next: Record<string, unknown> = { ...props.search, page: undefined, ...change };
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined || value === "" || value === null) {
        delete next[name];
      }
    }
    router.navigateHref(issueListHref(key(), next as IssueListSearch), options);
  };

  // The search box: keystrokes update the draft at once, and the URL once
  // typing pauses for 250ms (a `Settle` that no longer matches the draft is stale).
  const searchBox = yield* Component.state(
    State.define<SearchBoxModel, SearchBoxMessage>()({
      name: "IssueList.search",
      initial: { draft: untrack(() => props.search.q ?? "") },
      on: {
        Type: (_model, message) =>
          State.next(
            { draft: message.text },
            State.emit(
              Effect.sleep("250 millis").pipe(
                Effect.as({ _tag: "Settle", text: message.text } as const),
              ),
            ),
          ),
        Settle: (model, message) =>
          model.draft !== message.text
            ? model
            : State.next(
                model,
                State.emit(
                  Effect.sync(() =>
                    go(
                      { q: message.text.trim() === "" ? undefined : message.text },
                      { replace: true },
                    ),
                  ),
                ),
              ),
      },
    }),
  );
  const drawer = yield* Component.state(
    State.define({
      name: "IssueList.filters",
      initial: false,
      on: { Toggle: (open) => !open, Close: () => false },
    }),
  );

  const people = () => new Map<string, User>(team("all").map((member) => [member.id, member]));
  const page = () => issues(query());
  const activeFilters = () =>
    [props.search.status, props.search.priority, props.search.assignee, props.search.label].filter(
      (value) => value !== undefined,
    ).length;

  return () => (
    <div class={["listPage", { refreshing: issues.waiting(query()) }]}>
      <ProjectHeader
        projectKey={key()}
        project={projects("all").find((project) => project.key === key())}
        view="list"
      />

      <div class="listToolbar">
        <label class="searchField">
          <Icon.search />
          <input
            id="issue-search"
            type="search"
            placeholder="Search issues  /"
            aria-label="Search issues"
            value={searchBox.model().draft}
            onInput={(event) => searchBox.send.Type({ text: event.currentTarget.value })}
          />
        </label>
        <button
          type="button"
          class={["ghostButton", { active: drawer.model() || activeFilters() > 0 }]}
          aria-expanded={drawer.model() ? "true" : "false"}
          aria-controls="filters"
          onClick={drawer.send.Toggle}
        >
          <Icon.filter />
          Filters
          <Show when={activeFilters() > 0}>
            <span class="count">{activeFilters()}</span>
          </Show>
        </button>
        <label class="sortField">
          <span class="visuallyHidden">Sort by</span>
          <select
            aria-label="Sort by"
            value={query().sort}
            onChange={(event) =>
              go({ sort: event.currentTarget.value as (typeof issueSorts)[number] })
            }
          >
            <For each={issueSorts}>{(sort) => <option value={sort}>{sortLabel[sort]}</option>}</For>
          </select>
        </label>
      </div>

      <Show when={drawer.model()}>
        <div class="filterDrawer" id="filters" role="group" aria-label="Filters">
          <label class="field">
            <span>Status</span>
            <select
              name="status"
              value={props.search.status ?? ""}
              onChange={(event) =>
                go({
                  status: (event.currentTarget.value || undefined) as IssueListSearch["status"],
                })
              }
            >
              <option value="">Any status</option>
              <For each={issueStatuses}>
                {(status) => <option value={status}>{statusLabel(status)}</option>}
              </For>
            </select>
          </label>
          <label class="field">
            <span>Priority</span>
            <select
              name="priority"
              value={props.search.priority ?? ""}
              onChange={(event) =>
                go({
                  priority: (event.currentTarget.value || undefined) as IssueListSearch["priority"],
                })
              }
            >
              <option value="">Any priority</option>
              <For each={issuePriorities}>
                {(priority) => <option value={priority}>{priorityLabel(priority)}</option>}
              </For>
            </select>
          </label>
          <label class="field">
            <span>Assignee</span>
            <select
              name="assignee"
              value={props.search.assignee ?? ""}
              onChange={(event) =>
                go({
                  assignee: (event.currentTarget.value || undefined) as IssueListSearch["assignee"],
                })
              }
            >
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="none">Unassigned</option>
              <For each={team("all")}>
                {(member) => <option value={member.id}>{member.name}</option>}
              </For>
            </select>
          </label>
          <label class="field">
            <span>Label</span>
            <select
              name="label"
              value={props.search.label ?? ""}
              onChange={(event) =>
                go({
                  label: (event.currentTarget.value || undefined) as IssueListSearch["label"],
                })
              }
            >
              <option value="">Any label</option>
              <For each={labels(key())}>
                {(label) => <option value={label.id}>{label.name}</option>}
              </For>
            </select>
          </label>
          <Show when={activeFilters() > 0}>
            <button
              type="button"
              class="linkButton"
              onClick={() =>
                go({
                  status: undefined,
                  priority: undefined,
                  assignee: undefined,
                  label: undefined,
                })
              }
            >
              Clear filters
            </button>
          </Show>
        </div>
      </Show>

      <p class="resultCount" data-testid="result-count">
        {page().total === 1 ? "1 issue" : `${page().total} issues`}
        <Show when={(props.search.q ?? "") !== ""}> matching “{props.search.q}”</Show>
      </p>

      <Show
        when={page().rows.length > 0}
        fallback={<EmptyState title="No issues match. Try fewer filters." />}
      >
        <ul class="issueList" data-testid="issue-list">
          <For each={page().rows} keyed={(issue) => issue.id}>
            {(issue) => <IssueRowView issue={issue()} people={people()} labels={labels(key())} />}
          </For>
        </ul>
      </Show>

      <Show when={page().pageCount > 1}>
        <nav class="pagination" aria-label="Pages">
          <Show
            when={page().page > 1}
            fallback={<span class="ghostButton disabled">Previous</span>}
          >
            <RouterLink
              route={IssueListRoute}
              options={{
                params: { key: key() },
                search: { ...props.search, page: page().page - 1 },
              }}
              class="ghostButton"
              rel="prev"
            >
              Previous
            </RouterLink>
          </Show>
          <span class="pageNumber" data-testid="page-number">
            Page {page().page} of {page().pageCount}
          </span>
          <Show
            when={page().page < page().pageCount}
            fallback={<span class="ghostButton disabled">Next</span>}
          >
            <RouterLink
              route={IssueListRoute}
              options={{
                params: { key: key() },
                search: { ...props.search, page: page().page + 1 },
              }}
              class="ghostButton"
              rel="next"
            >
              Next
            </RouterLink>
          </Show>
        </nav>
      </Show>
    </div>
  );
}).pipe(Component.catchAll((error) => <p role="alert">{describeError(error)}</p>));
