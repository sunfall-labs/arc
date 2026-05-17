import {
  Resource,
  Route,
  Program,
  Signal,
  RouterLink,
  RouterOutlet,
  RouterProvider,
  createComponentScope,
  read,
  useAction,
  useResource,
  useProgram,
  useSignal,
  useStream,
  useRouter,
  useRuntimeEffect,
  watch
} from "@effect-ui/solid";
import { Form, type EffectUiRuntime } from "@effect-ui/core";
import type { CollectionRow } from "@effect-ui/db";
import { useCollection } from "@effect-ui/solid-db";
import { StartAction, startActionInputField, startActionNameField } from "@effect-ui/start";
import { Effect, Schema } from "effect";
import { For, Show, createEffect, onMount } from "solid-js";
import { isServer } from "solid-js/web";
import {
  AdvanceProject,
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
  type ProjectTab,
  type ProjectStatus,
  type ProjectSummary
} from "./domain.js";
import { HomeRoute, ProjectRoute, ProjectsRoute, app } from "./app-definition.js";
import { ProjectSummaries } from "./project-collections.js";
import { hrefByPath, isRoutePathMatch } from "./routeTree.gen.js";
import { HealthBadge, Metric, PresencePill } from "./ui.tsrx";

const HomeUiRoute = Route.withComponent(HomeRoute, HomeRouteView);
const ProjectsUiRoute = Route.withComponent(ProjectsRoute, ProjectIndexRouteView);
const ProjectUiRoute = Route.withComponent(ProjectRoute, ProjectRouteView);
const routes = [HomeUiRoute, ProjectsUiRoute, ProjectUiRoute] as const;
type AppRoutes = typeof routes;
type AppRuntime = EffectUiRuntime<any, never>;
type ProjectSummaryRow = CollectionRow<ProjectSummary, ProjectId>;
type ProjectNameSubmissionClientResult = StartAction.Result<typeof SubmitProjectName>;

const ProjectNameFormInput = Schema.Struct({
  name: Schema.String
});

const projectHref = (id: ProjectId, tab?: ProjectTab): string =>
  tab === undefined || tab === "overview"
    ? hrefByPath("/projects/:id", { params: { id } })
    : hrefByPath("/projects/:id", { params: { id }, search: { tab } });

export interface AppProps {
  readonly initialHref?: string;
  readonly runtime?: AppRuntime;
}

const initialPresence: PresenceEvent = {
  activeUsers: 4,
  build: "queued",
  latency: 32
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

export default function App(props: AppProps = {}) {
  const runtime = props.runtime ?? app.runtime;
  const routerProps = props.initialHref === undefined
    ? { routes, runtime }
    : { routes, initialHref: props.initialHref, runtime };

  return (
    <RouterProvider {...routerProps}>
      <AppShell />
    </RouterProvider>
  );
}

const projectIdFromMatch = (
  match: Route.Match<AppRoutes[number]> | undefined
): ProjectId | undefined =>
  isRoutePathMatch("/projects/:id", match) ? match.params.id : undefined;

function HomeRouteView() {
  const router = useRouter<AppRoutes>();

  onMount(() => {
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

function ProjectRouteView(props: Route.Props<typeof ProjectRoute>) {
  return <ProjectDetail id={props.params.id} tab={props.search.tab ?? "overview"} />;
}

function AppShell() {
  return createComponentScope(() => {
    const router = useRouter<AppRoutes>();
    const runEffect = useRuntimeEffect();
    const presence = useStream(makePresenceStream(), initialPresence);
    const title = Signal.make("Effect UI Project Console");

    createEffect(() => {
      const id = projectIdFromMatch(router.match());
      Signal.set(
        title,
        id ? `${id} · Effect UI Project Console` : "Projects · Effect UI Project Console"
      );
    });

    if (!isServer) {
      watch(
        () => read(title),
        (nextTitle) =>
          Effect.sync(() => {
            document.title = nextTitle;
          })
      );
    }

    const refreshVisibleData = () => {
      const id = projectIdFromMatch(router.match());
      runEffect(
        Effect.gen(function* () {
          yield* Resource.invalidateEffect(id ? [ProjectsRef, ProjectById(id)] : ProjectsRef);
          yield* ProjectSummaries.refetchEffect();
        }).pipe(Effect.catch(() => Effect.void))
      );
    };

    return (
      <main class="appShell">
        <aside class="sideNav" aria-label="Workspace navigation">
          <div class="brandBlock">
            <div class="brandMark">E</div>
            <div>
              <p class="eyebrow">Effect UI</p>
              <h1>Project Console</h1>
            </div>
          </div>

          <ProjectListPane selectedId={projectIdFromMatch(router.match())} />
        </aside>

        <section class="workbench">
          <header class="topBar">
            <div>
              <p class="eyebrow">{app.fullStack ? "Full stack" : "Client only"} vertical slice</p>
              <h2>Resource cache and action state</h2>
            </div>
            <div class="topBarActions">
              <PresencePill presence={presence()} />
              <button class="iconButton" type="button" title="Refresh" onClick={refreshVisibleData}>
                <RefreshIcon />
              </button>
            </div>
          </header>

          <RouterOutlet
            pending={() => <ProjectSkeleton />}
            failure={(state) => <FailureView error={state.error} />}
            notFound={() => <NotFoundView />}
          />
        </section>
      </main>
    );
  });
}

function ProjectListPane(props: { readonly selectedId: ProjectId | undefined }) {
  const search = useSignal(projectSearch);

  return (
    <section class="projectRail" aria-label="Projects">
      <label class="searchField">
        <SearchIcon />
        <input
          type="search"
          placeholder="Filter projects"
          value={search()}
          onInput={(event) => Signal.set(projectSearch, event.currentTarget.value)}
        />
      </label>

      <ProjectRows selectedId={props.selectedId} search={search()} />
    </section>
  );
}

function ProjectRows(props: { readonly selectedId: ProjectId | undefined; readonly search: string }) {
  const projects = useCollection(ProjectSummaries, { preload: false });
  const filteredProjects = (currentProjects: ReadonlyArray<ProjectSummaryRow>) => {
    const query = props.search.trim().toLowerCase();
    if (query.length === 0) {
      return currentProjects;
    }

    return currentProjects.filter((project) =>
      [project.name, project.owner, project.status].some((part) =>
        part.toLowerCase().includes(query)
      )
    );
  };
  const renderRows = (items: ReadonlyArray<ProjectSummaryRow>) => {
    const filtered = filteredProjects(items);

    return (
      <>
        <For each={filtered}>
          {(project) => <ProjectRow project={project} selected={project.id === props.selectedId} />}
        </For>

        <Show when={filtered.length === 0}>
          <p class="emptyState">No projects match that filter.</p>
        </Show>
      </>
    );
  };

  return (
    <div class="projectList">
      {(() => {
        const rows = projects.rows();
        const state = projects.state();

        if (state._tag === "Initial") {
          return <ProjectListSkeleton />;
        }

        if (state._tag === "Pending") {
          return rows.length > 0
            ? (
                <>
                  {renderRows(rows)}
                  <p class="inlineStatus">Refreshing projects</p>
                </>
              )
            : <ProjectListSkeleton />;
        }

        if (state._tag === "Failure") {
          return rows.length > 0
            ? (
                <>
                  {renderRows(rows)}
                  <InlineFailure error={state.error} />
                </>
              )
            : <InlineFailure error={state.error} />;
        }

        return renderRows(rows);
      })()}
    </div>
  );
}

function ProjectRow(props: {
  readonly project: ProjectSummaryRow;
  readonly selected: boolean;
}) {
  return (
    <RouterLink
      route={ProjectUiRoute}
      options={{ params: { id: props.project.id } }}
      class="projectRow"
      classList={{ selected: props.selected, syncing: !props.project.$synced }}
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

function ProjectDetail(props: { readonly id: ProjectId; readonly tab: ProjectTab }) {
  const project = useResource(() => ProjectById(props.id));
  const renderProject = (currentProject: Project, refreshing: boolean) => (
    <ProjectDetailContent project={currentProject} tab={props.tab} refreshing={refreshing} />
  );

  return (
    <>
      {project.match({
        initial: () => <ProjectSkeleton />,
        pending: (previous) => previous ? renderProject(previous, true) : <ProjectSkeleton />,
        success: (value) => renderProject(value, false),
        failure: (error, previous) =>
          previous ? (
            <>
              {renderProject(previous, false)}
              <InlineFailure error={error} />
            </>
          ) : (
            <FailureView error={error} />
          )
      })}
    </>
  );
}

function ProjectDetailContent(props: {
  readonly project: Project;
  readonly tab: ProjectTab;
  readonly refreshing: boolean;
}) {
  return (
    <article class="projectDetail" classList={{ refreshing: props.refreshing }}>
      <section class="detailHeader">
        <div>
          <p class="eyebrow">{statusLabel(props.project.status)} project</p>
          <h2>{props.project.name}</h2>
          <p>{props.project.goal}</p>
        </div>
        <HealthBadge health={props.project.health} label={healthLabel(props.project.health)} />
      </section>

      <ProjectTabs project={props.project} selected={props.tab} />

      <section class="metricGrid" aria-label="Project metrics">
        <Metric label="Progress" value={`${props.project.progress}%`} tone="blue" />
        <Metric label="Budget used" value={formatSpend(props.project.spend)} tone="amber" />
        <Metric label="Owner" value={props.project.owner} tone="green" />
        <Metric label="Updated" value={props.project.updatedAt} tone="slate" />
      </section>

      <ProjectTabPanel project={props.project} tab={props.tab} />
    </article>
  );
}

function ProjectTabs(props: { readonly project: Project; readonly selected: ProjectTab }) {
  const tabs: ReadonlyArray<{ readonly id: ProjectTab; readonly label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "settings", label: "Settings" }
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
              classList={{ active: props.selected === tab.id }}
            >
              {tab.label}
            </RouterLink>
          );
        }}
      </For>
    </nav>
  );
}

function ProjectTabPanel(props: { readonly project: Project; readonly tab: ProjectTab }) {
  if (props.tab === "activity") {
    return (
      <section class="activityPanel">
        <h3>Recent activity</h3>
        <p>Route preload refreshed this project at {props.project.updatedAt}.</p>
        <p>{props.project.owner} is clearing the next milestone: {props.project.nextMilestone}</p>
        <p>Health moved to {healthLabel(props.project.health)} with {props.project.progress}% progress.</p>
      </section>
    );
  }

  return (
    <section class="detailLayout">
      <div class="primaryPanel">
        <h3>{props.tab === "settings" ? "Project controls" : "Next milestone"}</h3>
        <p>{props.project.nextMilestone}</p>

        <div class="progressTrack" aria-label={`Progress ${props.project.progress}%`}>
          <span style={{ width: `${props.project.progress}%` }} />
        </div>

        <ProjectActions project={props.project} />
      </div>

      <aside class="riskPanel" aria-label="Current risks">
        <h3>Risk register</h3>
        <For each={props.project.risks}>
          {(risk) => <p>{risk}</p>}
        </For>
      </aside>
    </section>
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
  | { readonly _tag: "RenameFinished"; readonly result: ProjectNameSubmissionClientResult }
  | { readonly _tag: "RenameFailed"; readonly error: unknown }
  | { readonly _tag: "Advance" }
  | { readonly _tag: "AdvanceFinished"; readonly project: Project }
  | { readonly _tag: "AdvanceFailed"; readonly error: unknown };

const projectActionsInitial = (project: Project): ProjectActionsModel => ({
  project,
  renamePending: false,
  advancePending: false
});

const renameValidationMessage = (
  result: ProjectNameSubmissionClientResult
): string | undefined =>
  result._tag === "ValidationFailure"
    ? result.fieldErrors.name?.[0] ?? result.formErrors[0]
    : undefined;

const useProjectActionsProgram = (project: () => Project) => {
  const router = useRouter<AppRoutes>();
  const rename = StartAction.use(SubmitProjectName);
  const advance = useAction(AdvanceProject);
  const actions = useProgram(Program.define<ProjectActionsModel, ProjectActionsMessage>({
    initial: projectActionsInitial(project()),
    update: (model, message) => {
      switch (message._tag) {
        case "ProjectChanged":
          return message.project.id === model.project.id
            ? { ...model, project: message.project }
            : projectActionsInitial(message.project);
        case "SubmitRename":
          if (model.renamePending) {
            return model;
          }

          return Program.next(
            {
              project: model.project,
              renamePending: true,
              advancePending: model.advancePending
            },
            Program.command<ProjectActionsMessage>(
              Form.decodeFormDataEffect(ProjectNameFormInput, message.formData, {
                omitFields: [startActionNameField, startActionInputField]
              }).pipe(
                Effect.flatMap(({ name }) =>
                  rename.submitEffect({
                    id: model.project.id,
                    name,
                    redirectTo: makeProjectReturnTo(projectHref(model.project.id, "activity"))
                  })
                ),
                Effect.match({
                  onFailure: (error): ProjectActionsMessage => ({ _tag: "RenameFailed", error }),
                  onSuccess: (result): ProjectActionsMessage => ({ _tag: "RenameFinished", result })
                })
              )
            )
          );
        case "RenameFinished": {
          const result = message.result;
          switch (result._tag) {
            case "Success":
              return {
                project: result.value,
                renamePending: false,
                advancePending: model.advancePending
              };
            case "ValidationFailure":
              const validation = renameValidationMessage(result);
              return validation === undefined ? {
                project: model.project,
                renamePending: false,
                advancePending: model.advancePending
              } : {
                project: model.project,
                renamePending: false,
                advancePending: model.advancePending,
                validation
              };
            case "Failure":
              return {
                project: model.project,
                renamePending: false,
                advancePending: model.advancePending,
                error: result.error
              };
            case "Redirect":
              return Program.next(
                {
                  project: model.project,
                  renamePending: false,
                  advancePending: model.advancePending
                },
                Program.effect(
                  Effect.sync(() =>
                    router.navigateHref(
                      result.location,
                      result.replace === undefined ? undefined : { replace: result.replace }
                    )
                  )
                )
              );
          }
        }
        case "RenameFailed":
          return {
            project: model.project,
            renamePending: false,
            advancePending: model.advancePending,
            error: message.error
          };
        case "Advance":
          if (model.advancePending) {
            return model;
          }

          return Program.next(
            {
              project: model.project,
              renamePending: model.renamePending,
              advancePending: true
            },
            Program.command<ProjectActionsMessage>(
              advance.submitEffect({ id: model.project.id }).pipe(
                Effect.match({
                  onFailure: (error): ProjectActionsMessage => ({ _tag: "AdvanceFailed", error }),
                  onSuccess: (project): ProjectActionsMessage => ({ _tag: "AdvanceFinished", project })
                })
              )
            )
          );
        case "AdvanceFinished":
          return {
            project: message.project,
            renamePending: model.renamePending,
            advancePending: false
          };
        case "AdvanceFailed":
          return {
            project: model.project,
            renamePending: model.renamePending,
            advancePending: false,
            error: message.error
          };
      }
    }
  }));

  createEffect(() => {
    actions.dispatch({ _tag: "ProjectChanged", project: project() });
  });

  return actions;
};

function ProjectActions(props: { readonly project: Project }) {
  const actions = useProjectActionsProgram(() => props.project);
  const model = actions.model;

  const renameForm = () =>
    projectNameActionTarget({
      id: model().project.id,
      redirectTo: makeProjectReturnTo(projectHref(model().project.id, "activity"))
    });

  return (
    <div class="actionPanel">
      <form
        class="renameForm"
        method={renameForm().method}
        action={renameForm().action}
        onSubmit={(event) => {
          event.preventDefault();
          actions.dispatch({
            _tag: "SubmitRename",
            formData: new FormData(event.currentTarget)
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
        onClick={() => actions.dispatch({ _tag: "Advance" })}
      >
        <ArrowIcon />
        {model().advancePending ? "Advancing" : "Advance"}
      </button>

      <ActionMessage
        validation={model().validation}
        error={model().error}
      />
    </div>
  );
}

function ActionMessage(props: { readonly validation: string | undefined; readonly error: unknown }) {
  return (
    <>
      <Show when={props.validation}>
        {(message) => <p id="project-name-error" class="formError">{message()}</p>}
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
