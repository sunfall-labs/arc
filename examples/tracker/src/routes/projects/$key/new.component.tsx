import { ActionResult, type Route } from "@sunfall/arc-core";
import { Component, RouterLink, useRouter } from "@sunfall/arc-solid";
import { StartAction } from "@sunfall/arc-start";
import { Cause, Effect } from "effect";
import { For, Show } from "solid-js";
import { CreateIssue } from "../../../actions.js";
import {
  describeError,
  issuePriorities,
  issueStatuses,
  priorityLabel,
  statusLabel,
} from "../../../model.js";
import { CurrentUser, Labels, Projects, Team } from "../../../resources.js";
import { route as BoardRoute } from "./index.js";
import type { route } from "./new.js";

/**
 * The new-issue form. Without JavaScript it posts the CreateIssue Action and
 * the server redirects to the new issue; with it, the same Action submits
 * over the action transport and the router follows the redirect.
 */
export default Component.define("NewIssuePage", function* (props: Route.Props<typeof route>) {
  const create = yield* Component.action(CreateIssue);
  const projects = yield* Component.resource(Projects);
  const team = yield* Component.resource(Team);
  const labels = yield* Component.resource(Labels);
  const user = yield* Component.resource(CurrentUser);
  const router = useRouter();
  const key = () => props.params.key;

  const submit = yield* Component.callback("submit", (form: HTMLFormElement) =>
    StartAction.decodeFormData(CreateIssue, new FormData(form)).pipe(
      Effect.flatMap((input) => create.submit(input)),
      Effect.flatMap((result) =>
        Effect.sync(() => {
          if (ActionResult.isRedirect(result)) {
            router.navigateHref(result.location);
          }
        }),
      ),
      Effect.ignore,
    ),
  );
  const form = () => StartAction.form(CreateIssue, { input: { projectKey: key() } });
  const fieldError = (field: string) => {
    const result = create.result();
    const value = result._tag === "Success" ? result.value : undefined;
    return value !== undefined && ActionResult.isValidationFailure(value)
      ? (value.fieldErrors as Record<string, ReadonlyArray<string> | undefined>)[field]?.[0]
      : undefined;
  };

  return () => (
    <div class="formPage">
      <header class="pageHeader">
        <div>
          <p class="eyebrow">
            <RouterLink route={BoardRoute} options={{ params: { key: key() } }}>
              {projects("all").find((project) => project.key === key())?.name ?? key()}
            </RouterLink>
          </p>
          <h1>New issue</h1>
        </div>
      </header>
      <form
        class="issueForm"
        method={form().method}
        action={form().action}
        onSubmit={(event) => {
          event.preventDefault();
          submit(event.currentTarget);
        }}
      >
        <For each={form().hiddenFields}>
          {(field) => <input type="hidden" name={field.name} value={field.value} />}
        </For>
        <label class="field">
          <span>Title</span>
          <input
            name="title"
            required
            autofocus
            placeholder="What needs doing?"
            aria-invalid={fieldError("title") === undefined ? "false" : "true"}
            aria-describedby="title-error"
          />
          <Show when={fieldError("title")}>
            {(message) => (
              <small class="fieldError" id="title-error">
                {message()}
              </small>
            )}
          </Show>
        </label>
        <label class="field">
          <span>Description</span>
          <textarea
            name="description"
            rows={8}
            placeholder="Markdown works: **bold**, `code`, lists, and links."
          />
        </label>
        <div class="fieldRow">
          <label class="field">
            <span>Status</span>
            <select name="status" value={props.search.status ?? "todo"}>
              <For each={issueStatuses}>
                {(status) => <option value={status}>{statusLabel(status)}</option>}
              </For>
            </select>
          </label>
          <label class="field">
            <span>Priority</span>
            <select name="priority" value="medium">
              <For each={issuePriorities}>
                {(priority) => <option value={priority}>{priorityLabel(priority)}</option>}
              </For>
            </select>
          </label>
          <label class="field">
            <span>Assignee</span>
            <select name="assigneeId" value={user("current")?.id ?? ""}>
              <option value="">Unassigned</option>
              <For each={team("all")}>
                {(member) => <option value={member.id}>{member.name}</option>}
              </For>
            </select>
          </label>
        </div>
        <fieldset class="field labelPicker">
          <legend>Labels</legend>
          <For each={labels(key())}>
            {(label) => (
              <label class="labelOption" style={{ "--label": label.color }}>
                <input type="checkbox" name="labelIds" value={label.id} />
                {label.name}
              </label>
            )}
          </For>
        </fieldset>
        <div class="formActions">
          <RouterLink route={BoardRoute} options={{ params: { key: key() } }} class="ghostButton">
            Cancel
          </RouterLink>
          <button type="submit" class="primaryButton" disabled={create.waiting()}>
            {create.waiting() ? "Creating…" : "Create issue"}
          </button>
        </div>
        <Show when={create.failure()}>
          {(cause) => <p class="formError">{describeError(Cause.squash(cause()))}</p>}
        </Show>
      </form>
    </div>
  );
}).pipe(Component.catchAll((error) => <p role="alert">{describeError(error)}</p>));
