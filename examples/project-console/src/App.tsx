import { Component, RouterLink, RouterOutlet, RouterProvider, useRouter } from "@sunfall/arc-solid";
import { Program, Resource, Route, Signal } from "@sunfall/arc-core";
import type { Collection } from "@sunfall/arc-db";
import { SolidDb } from "@sunfall/arc-solid-db";
import { StartAction } from "@sunfall/arc-start";
import { Cause, Effect, Schema } from "effect";
import { For, Loading, Show, createEffect, onSettled, untrack } from "solid-js";
import {
  ProjectById,
  ProjectsRef,
  SubmitProjectName,
  formatProjectError,
  makeProjectId,
  makeProjectReturnTo,
  makePresenceStream,
  projectNameActionTarget,
  projectSearch,
  type PresenceEvent,
  type Project,
  type ProjectHealth,
  type ProjectId,
  type ProjectNameSubmissionResult,
  type ProjectWorkItem,
  type ProjectTab,
  type ProjectStatus,
  type ProjectSummary,
  type WorkItemId,
  type WorkItemStatus,
} from "./domain.js";
import {
  AdvanceProject,
  MoveWorkItem,
  ProjectSummaries,
  ProjectWorkItems,
  projectWorkQueueQuery,
  type ProjectWorkQueueItem,
} from "./project-collections.js";
import { HealthBadge, Metric, PresencePill } from "./ui.tsrx";
import { routeById } from "./routeTree.gen.js";

const HomeRoute = routeById.route_root;
const ProjectsRoute = routeById.route_projects;
const ProjectRoute = routeById.route_projects_$id;

type ProjectSummaryRow = Collection.Row<ProjectSummary, ProjectId>;
type ProjectWorkItemRow = Collection.Row<ProjectWorkItem, WorkItemId>;

const ProjectNameFormInput = Schema.Struct({
  name: Schema.String,
});

const projectHref = (id: ProjectId, tab?: ProjectTab): string =>
  tab === undefined || tab === "overview"
    ? Route.href(ProjectRoute, { params: { id } })
    : Route.href(ProjectRoute, { params: { id }, search: { tab } });

const initialPresence: PresenceEvent = {
  activeUsers: 4,
  build: "queued",
  latency: 32,
};

const statusLabel = (status: ProjectStatus): string => {
  switch (status) {
    case "tracking":
      return "Tracking";
    case "watch":
      return "Watch";
    case "blocked":
      return "Blocked";
  }
};

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

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m21 21-4.6-4.6" />
    <circle cx="11" cy="11" r="7" />
  </svg>
);

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 0 1-15.1 6.6" />
    <path d="M3 12A9 9 0 0 1 18.1 5.4" />
    <path d="M18 2v4h-4" />
    <path d="M6 22v-4h4" />
  </svg>
);

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

type AppRoutes = typeof routes;

const projectIdFromMatch = (
  match: Route.Match<AppRoutes[number]> | undefined,
): ProjectId | undefined => (Route.isMatch(ProjectRoute, match) ? match.params.id : undefined);

function HomeRouteView() {
  const router = useRouter<AppRoutes>();

  onSettled(() => {
    router.navigate(ProjectUiRoute, { params: { id: makeProjectId("atlas") } }, { replace: true });
  });

  return <ProjectSkeleton />;
}

function ProjectIndexRouteView() {
  return (
    <section class="emptyDetail">
      <p class="eyebrow">Typed route</p>
      <h2>Choose a project</h2>
      <p>The project list is route-preloaded, and each detail page owns its own Effect scope.</p>
    </section>
  );
}

const ProjectRows = Component.define(
  "ProjectRows",
  function* (props: { readonly selectedId: ProjectId | undefined; readonly search: string }) {
    const projects = yield* SolidDb.collection(ProjectSummaries);
    const filteredProjects = (currentProjects: ReadonlyArray<ProjectSummaryRow>) => {
      const query = props.search.trim().toLowerCase();
      if (query.length === 0) {
        return currentProjects;
      }

      return currentProjects.filter((project) =>
        [project.name, project.owner, project.status].some((part) =>
          part.toLowerCase().includes(query),
        ),
      );
    };
    const rows = () => filteredProjects(projects.rows());
    // Rows are their own signal: `waiting` and `failure` only decide the chrome
    // around them, so a refresh never remounts the list. A first load that
    // fails throws to the boundary below instead.
    const hasRows = () => projects.rows().length > 0 || !projects.waiting();

    return () => (
      <div class="projectList">
        <Show when={hasRows()} fallback={<ProjectListSkeleton />}>
          {/* Keyed by id: a refetch hands back new row objects, the same rows stay mounted. */}
          <For each={rows()} keyed={(project) => project.id}>
            {(project) => (
              <ProjectRow project={project()} selected={project().id === props.selectedId} />
            )}
          </For>

          <Show when={rows().length === 0}>
            <p class="emptyState">No projects match that filter.</p>
          </Show>
        </Show>

        <Show when={hasRows() && projects.waiting()}>
          <p class="inlineStatus">Refreshing projects</p>
        </Show>
        <Show when={projects.failure()}>
          {(cause) => <InlineFailure error={Cause.squash(cause())} />}
        </Show>
      </div>
    );
  },
).pipe(Component.catchAll((error) => <InlineFailure error={error} />));

const AppShell = Component.define("AppShell", function* () {
  const presence = yield* Component.stream(makePresenceStream(), initialPresence);
  // ProjectSummaries follows ProjectsRef, so refreshing the Resource refreshes
  // the sidebar rows too.
  const refresh = yield* Component.callback((id: ProjectId | undefined) =>
    Resource.invalidate(id ? [ProjectsRef, ProjectById(id)] : ProjectsRef).pipe(Effect.ignore),
  );
  const Rows = yield* ProjectRows;

  return () => {
    const router = useRouter<AppRoutes>();
    const selectedId = () => projectIdFromMatch(router.match());
    const title = Signal.derive(() => {
      const id = selectedId();
      return id ? `${id} · Sunfall Arc Project Console` : "Projects · Sunfall Arc Project Console";
    });

    // Solid effects run only in the browser, after render.
    createEffect(
      () => title.get(),
      (nextTitle) => {
        document.title = nextTitle;
      },
    );

    return (
      <main class="appShell">
        <aside class="sideNav" aria-label="Workspace navigation">
          <div class="brandBlock">
            <div class="brandMark">E</div>
            <div>
              <p class="eyebrow">Sunfall Arc</p>
              <h1>Project Console</h1>
            </div>
          </div>

          <section class="projectRail" aria-label="Projects">
            <label class="searchField">
              <SearchIcon />
              <input
                type="search"
                placeholder="Filter projects"
                value={projectSearch.get()}
                onInput={(event) => projectSearch.set(event.currentTarget.value)}
              />
            </label>

            <Rows selectedId={selectedId()} search={projectSearch.get()} />
          </section>
        </aside>

        <section class="workbench">
          <header class="topBar">
            <div>
              <p class="eyebrow">Full stack vertical slice</p>
              <h2>Resource cache and action state</h2>
            </div>
            <div class="topBarActions">
              <PresencePill presence={presence()} />
              <button
                class="iconButton"
                type="button"
                title="Refresh"
                onClick={() => refresh(selectedId())}
              >
                <RefreshIcon />
              </button>
            </div>
          </header>

          <RouterOutlet
            router={router}
            pending={() => <ProjectSkeleton />}
            failure={(state) => <FailureView error={state.error} />}
            notFound={() => <NotFoundView />}
          />
        </section>
      </main>
    );
  };
});

function ProjectRow(props: { readonly project: ProjectSummaryRow; readonly selected: boolean }) {
  return (
    <RouterLink
      route={ProjectUiRoute}
      options={{ params: { id: props.project.id } }}
      class={["projectRow", { selected: props.selected, syncing: !props.project.$synced }]}
    >
      <span class={`healthDot ${props.project.health}`} />
      <span class="projectRowMain">
        <strong>{props.project.name}</strong>
        <span>
          {props.project.owner} · {statusLabel(props.project.status)}
        </span>
      </span>
      <span class="projectRowMeta">
        <span class="projectProgress">{props.project.progress}%</span>
        <Show when={!props.project.$synced}>
          <span class="syncBadge">Saving</span>
        </Show>
      </span>
    </RouterLink>
  );
}

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
              route={ProjectUiRoute}
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
    const queue = yield* SolidDb.liveQuery((query) =>
      projectWorkQueueQuery(props.projectId)(query),
    );
    const items = () => queue.rows();
    const blocked = () => items().filter((item) => item.status === "blocked").length;
    const unsynced = () => items().filter((item) => !item.synced).length;

    return () => (
      <section class="workQueueSummary" aria-label="Live work queue summary">
        <div>
          <p class="eyebrow">Live query</p>
          <h3>Indexed work queue</h3>
        </div>
        <div class="queueStats">
          <span>{items().length} open</span>
          <span>{blocked()} blocked</span>
          <span>{unsynced()} syncing</span>
        </div>
      </section>
    );
  },
).pipe(Component.catchAll((error) => <InlineFailure error={error} />));

const ProjectWorkQueue = Component.define(
  "ProjectWorkQueue",
  function* (props: { readonly project: Project }) {
    const collection = yield* SolidDb.collection(ProjectWorkItems, { preload: false });
    const queue = yield* SolidDb.liveQuery((query) =>
      projectWorkQueueQuery(props.project.id)(query),
    );
    // The row moves at once (`$synced: false`) and settles with the Action.
    const move = yield* Component.action(MoveWorkItem);
    const moveItem = yield* Component.callback((id: WorkItemId, status: WorkItemStatus) =>
      move.submit({ id, status }).pipe(Effect.ignore),
    );

    return () => (
      <section class="taskPanel">
        <div class="panelHeader">
          <div>
            <p class="eyebrow">Collection + Query.live</p>
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
                source={collection.get(item().id)}
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

function WorkQueueRow(props: {
  readonly item: ProjectWorkQueueItem;
  readonly source: ProjectWorkItemRow | undefined;
  readonly onMove: () => void;
}) {
  return (
    <article class={["taskRow", { syncing: props.source?.$synced === false }]}>
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
  readonly project: Project;
  readonly renamePending: boolean;
  readonly advancePending: boolean;
  readonly validation?: string;
  readonly error?: unknown;
}

type ProjectActionsMessage =
  | { readonly _tag: "ProjectChanged"; readonly project: Project }
  | { readonly _tag: "SubmitRename"; readonly formData: FormData }
  | { readonly _tag: "RenameFinished"; readonly result: ProjectNameSubmissionResult }
  | { readonly _tag: "RenameFailed"; readonly error: unknown }
  | { readonly _tag: "Advance" }
  | { readonly _tag: "AdvanceFinished"; readonly project: Project }
  | { readonly _tag: "AdvanceFailed"; readonly error: unknown };

const projectActionsInitial = (project: Project): ProjectActionsModel => ({
  project,
  renamePending: false,
  advancePending: false,
});

const renameValidationMessage = (result: ProjectNameSubmissionResult): string | undefined =>
  result._tag === "ValidationFailure"
    ? (result.fieldErrors.name?.[0] ?? result.formErrors[0])
    : undefined;

/**
 * Rename and advance controls. Setup runs once per instance, so each mounted
 * form owns its Actions and Program. Both Actions submit the same way: the
 * client runtime's ActionTransport serves the rename on the server (the same
 * Action the no-JS form posts), while advance runs locally.
 */
const ProjectActions = Component.define(
  "ProjectActions",
  function* (props: { readonly project: Project }) {
    // The router only follows redirect hrefs here, so it needs no route typing.
    const router = useRouter();
    // The rename's invalidations refresh the ProjectById header and the
    // ProjectList Resource the sidebar collection follows, so both show the new
    // name before the redirect lands.
    const rename = yield* Component.action(SubmitProjectName);
    const advance = yield* Component.action(AdvanceProject);
    const actions = yield* Component.program(
      Program.define<ProjectActionsModel, ProjectActionsMessage>({
        // Seed once; later project values arrive as ProjectChanged messages.
        initial: projectActionsInitial(untrack(() => props.project)),
        on: {
          ProjectChanged: (model, message) =>
            message.project.id === model.project.id
              ? { ...model, project: message.project }
              : projectActionsInitial(message.project),
          SubmitRename: (model, message) => {
            if (model.renamePending) {
              return model;
            }

            return Program.next(
              {
                project: model.project,
                renamePending: true,
                advancePending: model.advancePending,
              },
              Program.emit(
                StartAction.decodeFormData(ProjectNameFormInput, message.formData).pipe(
                  Effect.flatMap(({ name }) =>
                    rename.submit({
                      id: model.project.id,
                      name,
                      redirectTo: makeProjectReturnTo(projectHref(model.project.id, "activity")),
                    }),
                  ),
                  Effect.match({
                    onFailure: (error): ProjectActionsMessage => ({ _tag: "RenameFailed", error }),
                    onSuccess: (result): ProjectActionsMessage => ({
                      _tag: "RenameFinished",
                      result,
                    }),
                  }),
                ),
              ),
            );
          },
          RenameFinished: (model, message) => {
            const result = message.result;
            switch (result._tag) {
              case "Success":
                return {
                  project: result.value,
                  renamePending: false,
                  advancePending: model.advancePending,
                };
              case "ValidationFailure":
                const validation = renameValidationMessage(result);
                return validation === undefined
                  ? {
                      project: model.project,
                      renamePending: false,
                      advancePending: model.advancePending,
                    }
                  : {
                      project: model.project,
                      renamePending: false,
                      advancePending: model.advancePending,
                      validation,
                    };
              case "Failure":
                return {
                  project: model.project,
                  renamePending: false,
                  advancePending: model.advancePending,
                  error: result.error,
                };
              case "Redirect":
                return Program.next(
                  {
                    project: model.project,
                    renamePending: false,
                    advancePending: model.advancePending,
                  },
                  Program.emit(
                    Effect.sync(() =>
                      router.navigateHref(
                        result.location,
                        result.replace === undefined ? undefined : { replace: result.replace },
                      ),
                    ),
                  ),
                );
            }
          },
          RenameFailed: (model, message) => ({
            project: model.project,
            renamePending: false,
            advancePending: model.advancePending,
            error: message.error,
          }),
          Advance: (model) => {
            if (model.advancePending) {
              return model;
            }

            return Program.next(
              {
                project: model.project,
                renamePending: model.renamePending,
                advancePending: true,
              },
              Program.emit(
                advance.submit({ id: model.project.id }).pipe(
                  Effect.match({
                    onFailure: (error): ProjectActionsMessage => ({ _tag: "AdvanceFailed", error }),
                    onSuccess: (project): ProjectActionsMessage => ({
                      _tag: "AdvanceFinished",
                      project,
                    }),
                  }),
                ),
              ),
            );
          },
          AdvanceFinished: (model, message) => ({
            project: message.project,
            renamePending: model.renamePending,
            advancePending: false,
          }),
          AdvanceFailed: (model, message) => ({
            project: model.project,
            renamePending: model.renamePending,
            advancePending: false,
            error: message.error,
          }),
        },
      }),
    );

    // Program failures land in `actions.failures()`, so handlers ignore them.
    const send = yield* Component.callback((message: ProjectActionsMessage) =>
      actions.dispatch(message).pipe(Effect.ignore),
    );

    createEffect(
      () => props.project,
      (current) => {
        send({ _tag: "ProjectChanged", project: current });
      },
    );

    const model = actions.model;
    const renameForm = () =>
      projectNameActionTarget({
        id: model().project.id,
        redirectTo: makeProjectReturnTo(projectHref(model().project.id, "activity")),
      });

    return () => (
      <div class="actionPanel">
        <form
          class="renameForm"
          method={renameForm().method}
          action={renameForm().action}
          onSubmit={(event) => {
            event.preventDefault();
            send({
              _tag: "SubmitRename",
              formData: new FormData(event.currentTarget),
            });
          }}
        >
          <For each={renameForm().hiddenFields}>
            {(field) => <input type="hidden" name={field.name} value={field.value} />}
          </For>
          <label>
            <span>Name</span>
            <input
              name="name"
              value={model().project.name}
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
          onClick={() => send({ _tag: "Advance" })}
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
const ProjectPage = Component.define(
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

                  <Actions project={panel.project} />
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

const HomeUiRoute = Route.withComponent(HomeRoute, HomeRouteView);
const ProjectsUiRoute = Route.withComponent(ProjectsRoute, ProjectIndexRouteView);
const ProjectUiRoute = Route.withComponent(ProjectRoute, ProjectPage, ({ params, search }) => ({
  id: params.id,
  tab: search.tab ?? "overview",
}));
const routes = [HomeUiRoute, ProjectsUiRoute, ProjectUiRoute] as const;

/**
 * The Project Console root: Start renders it on the server and `App.launch`
 * hydrates it in the browser. Its routes' preload services and route
 * Components' services join its `R`, so `App.define` and
 * `createRequestHandler` check the client and server Layers provide them.
 */
const ProjectConsole = Component.define(
  "ProjectConsole",
  function* (props: { readonly href: string }) {
    const router = yield* Component.router(routes, { initialHref: props.href });
    const Shell = yield* AppShell;
    return () => (
      <RouterProvider router={router}>
        <Shell />
      </RouterProvider>
    );
  },
);

export default ProjectConsole;

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

function FailureView(props: { readonly error: unknown }) {
  return (
    <section class="failureView">
      <h2>Could not load project</h2>
      <p>{formatProjectError(props.error)}</p>
    </section>
  );
}

function NotFoundView() {
  return (
    <section class="failureView">
      <h2>Route not found</h2>
      <p>This workspace only knows about /projects and /projects/:id.</p>
    </section>
  );
}

function InlineFailure(props: { readonly error: unknown }) {
  return <p class="inlineFailure">{formatProjectError(props.error)}</p>;
}

function ProjectSkeleton() {
  return (
    <article class="projectDetail skeletonDetail" aria-label="Loading project">
      <div class="skeletonBlock tall" />
      <div class="metricGrid">
        <div class="skeletonBlock" />
        <div class="skeletonBlock" />
        <div class="skeletonBlock" />
        <div class="skeletonBlock" />
      </div>
      <div class="skeletonBlock body" />
    </article>
  );
}

function ProjectListSkeleton() {
  return (
    <>
      <div class="skeletonRow" />
      <div class="skeletonRow" />
      <div class="skeletonRow" />
      <div class="skeletonRow" />
    </>
  );
}
