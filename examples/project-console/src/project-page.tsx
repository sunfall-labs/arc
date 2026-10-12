import { Component, RouterLink, useRouter } from "@sunfall/arc-solid";
import { LiveQuery } from "@sunfall/arc-solid/live-query";
import { ActionResult, Route, State } from "@sunfall/arc-core";
import { StartAction } from "@sunfall/arc-start";
import { Cause, Effect, Schema } from "effect";
import { For, Loading, Show, untrack } from "solid-js";
import {
  ProjectById,
  SubmitProjectName,
  formatProjectError,
  makeProjectReturnTo,
  projectNameActionTarget,
  type Project,
  type ProjectHealth,
  type ProjectId,
  type ProjectNameSubmissionResult,
  type ProjectTab,
  type WorkItemId,
  type WorkItemStatus,
} from "./domain.js";
import {
  AdvanceProject,
  MoveWorkItem,
  projectWorkQueueQuery,
  type ProjectWorkQueueItem,
} from "./project-actions.js";
import { HealthBadge, Metric } from "./ui.tsrx";
import { route as ProjectRoute } from "./routes/projects/$id.js";
import { FailureView, InlineFailure, ProjectSkeleton, statusLabel } from "./project-views.js";

const ProjectNameFormInput = Schema.Struct({
  name: Schema.String,
});

const projectHref = (id: ProjectId, tab?: ProjectTab): string =>
  tab === undefined || tab === "overview"
    ? Route.href(ProjectRoute, { params: { id } })
    : Route.href(ProjectRoute, { params: { id }, search: { tab } });

const healthLabel = (health: ProjectHealth): string => {
  switch (health) {
    case "green":
      return "Green";
    case "amber":
      return "Amber";
    case "red":
      return "Red";
  }
};

const workItemStatusLabel = (status: WorkItemStatus): string => {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
  }
};

const nextWorkItemStatus = (status: WorkItemStatus): WorkItemStatus => {
  switch (status) {
    case "queued":
      return "running";
    case "running":
      return "done";
    case "blocked":
      return "running";
    case "done":
      return "queued";
  }
};

const workItemCommandLabel = (status: WorkItemStatus): string =>
  status === "done" ? "Reopen" : status === "blocked" ? "Resume" : "Advance";

const formatSpend = (spend: number): string => `${spend}%`;

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

const SaveIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </svg>
);

function ProjectTabs(props: { readonly project: Project; readonly selected: ProjectTab }) {
  const tabs: ReadonlyArray<{ readonly id: ProjectTab; readonly label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "tasks", label: "Tasks" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <nav class="tabStrip" aria-label="Project sections">
      <For each={tabs}>
        {(tab) => {
          const options = () =>
            tab.id === "overview"
              ? { params: { id: props.project.id } }
              : { params: { id: props.project.id }, search: { tab: tab.id } };

          return (
            <RouterLink
              route={ProjectRoute}
              options={options()}
              class={{ active: props.selected === tab.id }}
            >
              {tab.label}
            </RouterLink>
          );
        }}
      </For>
    </nav>
  );
}

const WorkQueueSummary = Component.define(
  "WorkQueueSummary",
  function* (props: { readonly projectId: ProjectId }) {
    const queue = yield* LiveQuery.bind((query) => projectWorkQueueQuery(props.projectId)(query));
    const items = () => queue.rows();
    const blocked = () => items().filter((item) => item.status === "blocked").length;
    const running = () => items().filter((item) => item.status === "running").length;

    return () => (
      <section class="workQueueSummary" aria-label="Live work queue summary">
        <div>
          <p class="eyebrow">Live query</p>
          <h3>Indexed work queue</h3>
        </div>
        <div class="queueStats">
          <span>{items().length} open</span>
          <span>{blocked()} blocked</span>
          <span>{running()} running</span>
        </div>
      </section>
    );
  },
).pipe(Component.catchAll((error) => <InlineFailure error={error} />));

const ProjectWorkQueue = Component.define(
  "ProjectWorkQueue",
  function* (props: { readonly project: Project }) {
    const queue = yield* LiveQuery.bind((query) => projectWorkQueueQuery(props.project.id)(query));
    // The row moves at once: the Action patches the work item row by key, and
    // the live query follows it; a failure moves it back.
    const move = yield* Component.action(MoveWorkItem);
    const moveItem = yield* Component.callback(
      "moveItem",
      (id: WorkItemId, status: WorkItemStatus) => move.submit({ id, status }).pipe(Effect.ignore),
    );

    return () => (
      <section class="taskPanel">
        <div class="panelHeader">
          <div>
            <p class="eyebrow">Resource rows + Query.live</p>
            <h3>{props.project.name} work queue</h3>
          </div>
          <Show when={queue.waiting()}>
            <p class="inlineStatus">Refreshing work items</p>
          </Show>
        </div>

        <div class="taskList">
          {/* Keyed by id: a recomputed query hands back new row objects for the same items. */}
          <For each={queue.rows()} keyed={(item) => item.id}>
            {(item) => (
              <WorkQueueRow
                item={item()}
                onMove={() => moveItem(item().id, nextWorkItemStatus(item().status))}
              />
            )}
          </For>
          <Show when={queue.rows().length === 0}>
            <p class="emptyState">No open work items for this project.</p>
          </Show>
        </div>
      </section>
    );
  },
).pipe(Component.catchAll((error) => <InlineFailure error={error} />));

function WorkQueueRow(props: { readonly item: ProjectWorkQueueItem; readonly onMove: () => void }) {
  return (
    <article class="taskRow">
      <div>
        <p class="taskMeta">
          {props.item.owner} · {props.item.projectName}
        </p>
        <h4>{props.item.title}</h4>
        <p class="taskMeta">
          Impact {props.item.impact} · updated {props.item.updatedAt}
        </p>
      </div>
      <div class="taskControls">
        <span class={`statusChip ${props.item.status}`}>
          {workItemStatusLabel(props.item.status)}
        </span>
        <span class={`priorityChip ${props.item.priority}`}>{props.item.priority}</span>
        <button class="commandButton secondary" type="button" onClick={props.onMove}>
          {workItemCommandLabel(props.item.status)}
        </button>
      </div>
    </article>
  );
}

interface ProjectActionsModel {
  readonly renamePending: boolean;
  readonly advancePending: boolean;
  readonly validation?: string;
  readonly error?: unknown;
}

type ProjectActionsMessage =
  | { readonly _tag: "SubmitRename"; readonly formData: FormData }
  | { readonly _tag: "RenameFinished"; readonly result: ProjectNameSubmissionResult }
  | { readonly _tag: "RenameFailed"; readonly error: unknown }
  | { readonly _tag: "Advance" }
  | { readonly _tag: "AdvanceFinished" }
  | { readonly _tag: "AdvanceQueued" }
  | { readonly _tag: "AdvanceFailed"; readonly error: unknown };

const projectActionsIdle: ProjectActionsModel = { renamePending: false, advancePending: false };

const renameValidationMessage = (result: ProjectNameSubmissionResult): string | undefined =>
  ActionResult.is(result) && ActionResult.isValidationFailure(result)
    ? (result.fieldErrors.name?.[0] ?? result.formErrors[0])
    : undefined;

/**
 * Rename and advance controls for one project. The page keys this component
 * on the project id, so each project gets its own instance, and so its own
 * Actions and State. Both Actions submit the same way: the client runtime's
 * ActionTransport serves the rename on the server (the same Action the no-JS
 * form posts), and the durable advance goes through the Action Outbox. The
 * project itself is read from props: the rename's optimistic patch and
 * invalidations keep it current, so the State holds only the form's status.
 */
const ProjectActions = Component.define(
  "ProjectActions",
  function* (props: { readonly project: Project }) {
    // The router only follows redirect hrefs here, so it needs no route typing.
    const router = useRouter();
    // Fixed for this instance: the page remounts it for another project.
    const id = untrack(() => props.project.id);
    // The rename patches the sidebar row and the ProjectById header at once,
    // and its invalidations reload both before the redirect lands.
    const rename = yield* Component.action(SubmitProjectName);
    const advance = yield* Component.action(AdvanceProject);
    const actions = yield* Component.state(
      State.define<ProjectActionsModel, ProjectActionsMessage>()({
        name: "ProjectActions",
        initial: projectActionsIdle,
        on: {
          SubmitRename: (model, message) =>
            model.renamePending
              ? model
              : State.next(
                  { advancePending: model.advancePending, renamePending: true },
                  State.emit(
                    StartAction.decodeFormData(ProjectNameFormInput, message.formData).pipe(
                      Effect.flatMap(({ name }) =>
                        rename.submit({
                          id,
                          name,
                          redirectTo: makeProjectReturnTo(projectHref(id, "activity")),
                        }),
                      ),
                      Effect.match({
                        onFailure: (error): ProjectActionsMessage => ({
                          _tag: "RenameFailed",
                          error,
                        }),
                        onSuccess: (result): ProjectActionsMessage => ({
                          _tag: "RenameFinished",
                          result,
                        }),
                      }),
                    ),
                  ),
                ),
          RenameFinished: (model, message) => {
            const result = message.result;
            const settled = { advancePending: model.advancePending, renamePending: false };
            if (!ActionResult.is(result)) {
              return settled;
            }
            if (ActionResult.isRedirect(result)) {
              return State.next(
                settled,
                State.emit(
                  Effect.sync(() =>
                    router.navigateHref(
                      result.location,
                      result.replace === undefined ? undefined : { replace: result.replace },
                    ),
                  ),
                ),
              );
            }
            const validation = renameValidationMessage(result);
            return validation === undefined ? settled : { ...settled, validation };
          },
          RenameFailed: (model, message) => ({
            advancePending: model.advancePending,
            renamePending: false,
            error: message.error,
          }),
          Advance: (model) =>
            model.advancePending
              ? model
              : State.next(
                  { renamePending: model.renamePending, advancePending: true },
                  State.emit(
                    advance.submit({ id }).pipe(
                      Effect.match({
                        // Offline, the advance waits in the Action Outbox (the
                        // top bar counts it) and replays when the browser is back.
                        onFailure: (error): ProjectActionsMessage =>
                          error._tag === "ActionQueued"
                            ? { _tag: "AdvanceQueued" }
                            : { _tag: "AdvanceFailed", error },
                        onSuccess: (): ProjectActionsMessage => ({ _tag: "AdvanceFinished" }),
                      }),
                    ),
                  ),
                ),
          AdvanceFinished: (model) => ({
            renamePending: model.renamePending,
            advancePending: false,
          }),
          AdvanceQueued: (model) => ({ renamePending: model.renamePending, advancePending: false }),
          AdvanceFailed: (model, message) => ({
            renamePending: model.renamePending,
            advancePending: false,
            error: message.error,
          }),
        },
      }),
    );

    // State failures land in `actions.failures()`; `send` needs no handling.
    const model = actions.model;
    const renameForm = () =>
      projectNameActionTarget({
        id,
        redirectTo: makeProjectReturnTo(projectHref(id, "activity")),
      });

    return () => (
      <div class="actionPanel">
        <form
          class="renameForm"
          method={renameForm().method}
          action={renameForm().action}
          onSubmit={(event) => {
            event.preventDefault();
            actions.send.SubmitRename({ formData: new FormData(event.currentTarget) });
          }}
        >
          <For each={renameForm().hiddenFields}>
            {(field) => <input type="hidden" name={field.name} value={field.value} />}
          </For>
          <label>
            <span>Name</span>
            <input
              name="name"
              value={props.project.name}
              aria-invalid={model().validation === undefined ? "false" : "true"}
              aria-describedby={model().validation === undefined ? undefined : "project-name-error"}
            />
          </label>
          <button class="commandButton" type="submit" disabled={model().renamePending}>
            <SaveIcon />
            {model().renamePending ? "Saving" : "Rename"}
          </button>
        </form>

        <button
          class="commandButton secondary"
          type="button"
          disabled={model().advancePending}
          onClick={actions.send.Advance}
        >
          <ArrowIcon />
          {model().advancePending ? "Advancing" : "Advance"}
        </button>

        <ActionMessage validation={model().validation} error={model().error} />
      </div>
    );
  },
);

/**
 * The project route. The reader is the only way content gets its value: the
 * first load suspends the `<Loading>` (route preload and hydration make it
 * synchronous), and refreshes keep the same content mounted (the rename form
 * keeps its text) while `waiting`/`failure` drive the status chrome.
 */
export const ProjectPage = Component.define(
  "ProjectPage",
  function* (props: { readonly id: ProjectId; readonly tab: ProjectTab }) {
    const project = yield* Component.resource(ProjectById);
    const Summary = yield* WorkQueueSummary;
    const WorkQueue = yield* ProjectWorkQueue;
    const Actions = yield* ProjectActions;
    const id = () => props.id;
    const tab = () => props.tab;

    const TabPanel = (panel: { readonly project: Project }) => (
      <Show
        when={tab() === "activity"}
        fallback={
          <Show
            when={tab() === "tasks"}
            fallback={
              <section class="detailLayout">
                <div class="primaryPanel">
                  <h3>{tab() === "settings" ? "Project controls" : "Next milestone"}</h3>
                  <p>{panel.project.nextMilestone}</p>

                  <div class="progressTrack" aria-label={`Progress ${panel.project.progress}%`}>
                    <span style={{ width: `${panel.project.progress}%` }} />
                  </div>

                  {/* Keyed by id: each project gets its own controls and State. */}
                  <Show when={panel.project.id} keyed>
                    {(_id) => <Actions project={panel.project} />}
                  </Show>
                </div>

                <aside class="riskPanel" aria-label="Current risks">
                  <h3>Risk register</h3>
                  <For each={panel.project.risks}>{(risk) => <p>{risk}</p>}</For>
                </aside>
              </section>
            }
          >
            <WorkQueue project={panel.project} />
          </Show>
        }
      >
        <section class="activityPanel">
          <h3>Recent activity</h3>
          <p>Route preload refreshed this project at {panel.project.updatedAt}.</p>
          <p>
            {panel.project.owner} is clearing the next milestone: {panel.project.nextMilestone}
          </p>
          <p>
            Health moved to {healthLabel(panel.project.health)} with {panel.project.progress}%
            progress.
          </p>
        </section>
      </Show>
    );

    const Content = (content: { readonly project: Project }) => (
      <article class={["projectDetail", { refreshing: project.waiting(id()) }]}>
        <section class="detailHeader">
          <div>
            <p class="eyebrow">{statusLabel(content.project.status)} project</p>
            <h2>{content.project.name}</h2>
            <p>{content.project.goal}</p>
          </div>
          <HealthBadge
            health={content.project.health}
            label={healthLabel(content.project.health)}
          />
        </section>

        <ProjectTabs project={content.project} selected={tab()} />

        <section class="metricGrid" aria-label="Project metrics">
          <Metric label="Progress" value={`${content.project.progress}%`} tone="blue" />
          <Metric label="Budget used" value={formatSpend(content.project.spend)} tone="amber" />
          <Metric label="Owner" value={content.project.owner} tone="green" />
          <Metric label="Updated" value={content.project.updatedAt} tone="slate" />
        </section>

        <Summary projectId={content.project.id} />

        <TabPanel project={content.project} />
      </article>
    );

    return () => (
      <Loading fallback={<ProjectSkeleton />}>
        <Content project={project(id())} />
        <Show when={project.failure(id())}>
          {(cause) => <InlineFailure error={Cause.squash(cause())} />}
        </Show>
      </Loading>
    );
  },
).pipe(Component.catchAll((error) => <FailureView error={error} />));

function ActionMessage(props: {
  readonly validation: string | undefined;
  readonly error: unknown;
}) {
  return (
    <>
      <Show when={props.validation}>
        {(message) => (
          <p id="project-name-error" class="formError">
            {message()}
          </p>
        )}
      </Show>
      <Show when={props.error}>
        {(error) => <p class="formError">{formatProjectError(error())}</p>}
      </Show>
    </>
  );
}
