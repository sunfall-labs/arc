import { Component, RouterLink, useRouter } from "@sunfall/arc-solid";
import { LiveQuery } from "@sunfall/arc-solid/live-query";
import { ActionResult, Machine, Message, Model, Route, State } from "@sunfall/arc-core";
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

/**
 * The rename form: Saving owns the submission (started on entry, so a
 * second submit while saving has no transition), and its outcome comes back
 * as a message. The form's fields travel as data, so the message is
 * serializable and replayable.
 */
const RenameModel = Model({
  Editing: { validation: Schema.NullOr(Schema.String), error: Schema.NullOr(Schema.String) },
  Saving: { fields: Schema.Record(Schema.String, Schema.String) },
});
const RenameMessage = Message({
  SubmittedRename: { fields: Schema.Record(Schema.String, Schema.String) },
  ReceivedRenameResult: {
    validation: Schema.NullOr(Schema.String),
    redirect: Schema.NullOr(
      Schema.Struct({ location: Schema.String, replace: Schema.optional(Schema.Boolean) }),
    ),
  },
  RenameFailed: { error: Schema.String },
});

/** The advance button: Advancing owns the durable submission. */
const AdvanceModel = Model({
  Ready: { error: Schema.NullOr(Schema.String) },
  Advancing: {},
});
const AdvanceMessage = Message({
  ClickedAdvance: {},
  AdvanceSettled: {},
  AdvanceFailed: { error: Schema.String },
});

/** A form's fields as data. */
const formFields = (form: HTMLFormElement): Record<string, string> => {
  const fields: Record<string, string> = {};
  new FormData(form).forEach((value, name) => {
    if (typeof value === "string") {
      fields[name] = value;
    }
  });
  return fields;
};

/** The fields back as the FormData the Action's form codec reads. */
const toFormData = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
};

const renameValidationMessage = (result: ProjectNameSubmissionResult): string | undefined =>
  ActionResult.is(result) && ActionResult.isValidationFailure(result)
    ? (result.fieldErrors.name?.[0] ?? result.formErrors[0])
    : undefined;

/**
 * Rename and advance controls for one project. The page keys this component
 * on the project id, so each project gets its own instance, and so its own
 * Actions and States. Both Actions submit the same way: the client runtime's
 * ActionTransport serves the rename on the server (the same Action the no-JS
 * form posts), and the durable advance goes through the Action Outbox. The
 * project itself is read from props: the rename's optimistic patch and
 * invalidations keep it current, so the States hold only each control's
 * status, and each submission is work its pending state owns.
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
    const renameState = yield* Component.state(
      State.define({
        name: "ProjectActions.rename",
        machine: Machine.make({
          state: RenameModel,
          event: RenameMessage,
          initial: RenameModel.Editing({ validation: null, error: null }),
        })
          .on(RenameModel.Editing, RenameMessage.SubmittedRename, ({ event }) =>
            RenameModel.Saving({ fields: event.fields }),
          )
          .task(
            RenameModel.Saving,
            ({ state }) =>
              StartAction.decodeFormData(SubmitProjectName, toFormData(state.fields)).pipe(
                Effect.flatMap((input) => rename.submit(input)),
              ),
            {
              onSuccess: (result) =>
                RenameMessage.ReceivedRenameResult({
                  validation: ActionResult.is(result)
                    ? (renameValidationMessage(result) ?? null)
                    : null,
                  redirect:
                    ActionResult.is(result) && ActionResult.isRedirect(result)
                      ? {
                          location: result.location,
                          ...(result.replace === undefined ? {} : { replace: result.replace }),
                        }
                      : null,
                }),
              onFailure: (error) =>
                RenameMessage.RenameFailed({ error: formatProjectError(error) }),
            },
          )
          .on(RenameModel.Saving, RenameMessage.ReceivedRenameResult, ({ event }) => {
            const editing = RenameModel.Editing({ validation: event.validation, error: null });
            const redirect = event.redirect;
            return redirect === null
              ? editing
              : Effect.sync(() =>
                  router.navigateHref(
                    redirect.location,
                    redirect.replace === undefined ? undefined : { replace: redirect.replace },
                  ),
                ).pipe(Effect.as(editing));
          })
          .on(RenameModel.Saving, RenameMessage.RenameFailed, ({ event }) =>
            RenameModel.Editing({ validation: null, error: event.error }),
          ),
      }),
    );
    const advanceState = yield* Component.state(
      State.define({
        name: "ProjectActions.advance",
        machine: Machine.make({
          state: AdvanceModel,
          event: AdvanceMessage,
          initial: AdvanceModel.Ready({ error: null }),
        })
          .on(AdvanceModel.Ready, AdvanceMessage.ClickedAdvance, () => AdvanceModel.Advancing)
          .task(AdvanceModel.Advancing, () => advance.submit({ id }), {
            onSuccess: () => AdvanceMessage.AdvanceSettled,
            // Offline, the advance waits in the Action Outbox (the top bar
            // counts it) and replays when the browser is back.
            onFailure: (error) =>
              error._tag === "ActionQueued"
                ? AdvanceMessage.AdvanceSettled
                : AdvanceMessage.AdvanceFailed({ error: formatProjectError(error) }),
          })
          .on(AdvanceModel.Advancing, AdvanceMessage.AdvanceSettled, () =>
            AdvanceModel.Ready({ error: null }),
          )
          .on(AdvanceModel.Advancing, AdvanceMessage.AdvanceFailed, ({ event }) =>
            AdvanceModel.Ready({ error: event.error }),
          ),
      }),
    );

    const renaming = () => renameState.model()._tag === "Saving";
    const advancing = () => advanceState.model()._tag === "Advancing";
    const validation = () => {
      const current = renameState.model();
      return current._tag === "Editing" ? (current.validation ?? undefined) : undefined;
    };
    const error = () => {
      const rename = renameState.model();
      const advanceModel = advanceState.model();
      return (
        (rename._tag === "Editing" ? rename.error : null) ??
        (advanceModel._tag === "Ready" ? advanceModel.error : null) ??
        undefined
      );
    };
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
          onSubmit={(event) => {
            event.preventDefault();
            renameState.send.SubmittedRename({ fields: formFields(event.currentTarget) });
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
              aria-invalid={validation() === undefined ? "false" : "true"}
              aria-describedby={validation() === undefined ? undefined : "project-name-error"}
            />
          </label>
          <button class="commandButton" type="submit" disabled={renaming()}>
            <SaveIcon />
            {renaming() ? "Saving" : "Rename"}
          </button>
        </form>

        <button
          class="commandButton secondary"
          type="button"
          disabled={!advanceState.can.ClickedAdvance()}
          onClick={advanceState.send.ClickedAdvance}
        >
          <ArrowIcon />
          {advancing() ? "Advancing" : "Advance"}
        </button>

        <ActionMessage validation={validation()} error={error()} />
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
  readonly error: string | undefined;
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
      <Show when={props.error}>{(error) => <p class="formError">{error()}</p>}</Show>
    </>
  );
}
