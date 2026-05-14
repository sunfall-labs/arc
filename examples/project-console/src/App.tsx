import {
  Resource,
  Route,
  Signal,
  RouterOutlet,
  RouterProvider,
  createComponentScope,
  read,
  useAction,
  useResource,
  useSignal,
  useStream,
  useRouter,
  useRuntime,
  watch
} from "@effect-ui/solid";
import type { EffectUiRuntime } from "@effect-ui/core";
import type { CollectionRow } from "@effect-ui/db";
import { useCollection } from "@effect-ui/solid-db";
import { StartAction } from "@effect-ui/start";
import { Effect } from "effect";
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
import { HealthBadge, Metric, PresencePill } from "./ui.tsrx";

const HomeUiRoute = Route.withComponent(HomeRoute, HomeRouteView);
const ProjectsUiRoute = Route.withComponent(ProjectsRoute, ProjectIndexRouteView);
const ProjectUiRoute = Route.withComponent(ProjectRoute, ProjectRouteView);
const routes = [HomeUiRoute, ProjectsUiRoute, ProjectUiRoute] as const;
type AppRoutes = typeof routes;
type ProjectSummaryRow = CollectionRow<ProjectSummary, ProjectId>;
type ProjectNameSubmissionClientResult = StartAction.Result<typeof SubmitProjectName>;

export interface AppProps {
  readonly initialHref?: string;
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

function runUiEffect<A>(
  runtime: EffectUiRuntime<any, any>,
  effect: Effect.Effect<A, unknown, any>
): void {
  void runtime.runPromise(
    effect.pipe(Effect.catch(() => Effect.void)) as Effect.Effect<A | void, never, any>
  );
}

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
  const routerProps = props.initialHref === undefined
    ? { routes }
    : { routes, initialHref: props.initialHref };

  return (
    <RouterProvider {...routerProps}>
      <AppShell />
    </RouterProvider>
  );
}

const projectIdFromMatch = (
  match: Route.Match<AppRoutes[number]> | undefined
): ProjectId | undefined =>
  match?.route.path === ProjectUiRoute.path ? (match.params as { readonly id: ProjectId }).id : undefined;

const isPlainLeftClick = (event: MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;

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

function ProjectRouteView(props: Route.Props<typeof ProjectUiRoute>) {
  return <ProjectDetail id={props.params.id} tab={props.search.tab ?? "overview"} />;
}

function AppShell() {
  return createComponentScope(() => {
    const router = useRouter<AppRoutes>();
    const runtime = useRuntime();
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
      runUiEffect(
        runtime,
        Effect.gen(function* () {
          yield* Resource.invalidateEffect(id ? [ProjectsRef, ProjectById(id)] : ProjectsRef);
          yield* ProjectSummaries.refetchEffect();
        }) as Effect.Effect<void, unknown, any>
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
  const router = useRouter<AppRoutes>();
  const href = () => router.href(ProjectUiRoute, { params: { id: props.project.id } });

  return (
    <a
      class="projectRow"
      classList={{ selected: props.selected, syncing: !props.project.$synced }}
      href={href()}
      onMouseEnter={() => void router.preload(ProjectUiRoute, { params: { id: props.project.id } })}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) {
          return;
        }

        event.preventDefault();
        router.navigate(ProjectUiRoute, { params: { id: props.project.id } });
      }}
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
    </a>
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
  const router = useRouter<AppRoutes>();
  const tabs: ReadonlyArray<{ readonly id: ProjectTab; readonly label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity" },
    { id: "settings", label: "Settings" }
  ];

  return (
    <nav class="tabStrip" aria-label="Project sections">
      <For each={tabs}>
        {(tab) => {
          const href = () =>
            tab.id === "overview"
              ? router.href(ProjectUiRoute, { params: { id: props.project.id } })
              : router.href(ProjectUiRoute, {
                  params: { id: props.project.id },
                  search: { tab: tab.id }
                });

          return (
            <a
              href={href()}
              classList={{ active: props.selected === tab.id }}
              onClick={(event) => {
                if (!isPlainLeftClick(event)) {
                  return;
                }

                event.preventDefault();
                if (tab.id === "overview") {
                  router.navigate(ProjectUiRoute, { params: { id: props.project.id } });
                } else {
                  router.navigate(ProjectUiRoute, {
                    params: { id: props.project.id },
                    search: { tab: tab.id }
                  });
                }
              }}
            >
              {tab.label}
            </a>
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

function ProjectActions(props: { readonly project: Project }) {
  const router = useRouter<AppRoutes>();
  const runtime = useRuntime();
  const rename = StartAction.use(SubmitProjectName, { runtime });
  const advance = useAction(AdvanceProject);
  const renameState = useSignal(rename.state);
  const advanceState = useSignal(advance.state);

  const renamePending = () => renameState()._tag === "Pending";
  const advancePending = () => advanceState()._tag === "Pending";
  const renameResult = (): ProjectNameSubmissionClientResult | undefined => {
    const state = renameState();
    return state._tag === "Success" ? state.value : undefined;
  };
  const renameError = () => {
    const state = renameState();
    return state._tag === "Failure" ? state.error : undefined;
  };
  const renameValidation = () => {
    const result = renameResult();
    if (result?._tag !== "ValidationFailure") {
      return undefined;
    }

    return result.fieldErrors.name?.[0] ?? result.formErrors[0];
  };
  const renameDomainError = () => {
    const result = renameResult();
    return result?._tag === "Failure" ? result.error : undefined;
  };
  const renameRedirect = () =>
    makeProjectReturnTo(
      router.href(ProjectUiRoute, {
        params: { id: props.project.id },
        search: { tab: "activity" }
      })
    );
  const renameForm = () =>
    projectNameActionTarget({
      id: props.project.id,
      redirectTo: renameRedirect()
    });

  return (
    <div class="actionPanel">
      <form
        class="renameForm"
        method={renameForm().method}
        action={renameForm().action}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          runUiEffect(
            runtime,
            Effect.gen(function* () {
              const result = yield* rename.submitEffect({
                id: props.project.id,
                name: String(form.get("name") ?? ""),
                redirectTo: renameRedirect()
              });
              if (result._tag === "Redirect") {
                yield* Effect.sync(() =>
                  router.navigateHref(
                    result.location,
                    result.replace === undefined ? undefined : { replace: result.replace }
                  )
                );
              }
            })
          );
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
            aria-invalid={renameValidation() === undefined ? "false" : "true"}
            aria-describedby={renameValidation() === undefined ? undefined : "project-name-error"}
          />
        </label>
        <button class="commandButton" type="submit" disabled={renamePending()}>
          <SaveIcon />
          {renamePending() ? "Saving" : "Rename"}
        </button>
      </form>

      <button
        class="commandButton secondary"
        type="button"
        disabled={advancePending()}
        onClick={() => runUiEffect(runtime, advance.submitEffect({ id: props.project.id }))}
      >
        <ArrowIcon />
        {advancePending() ? "Advancing" : "Advance"}
      </button>

      <ActionMessage
        validation={renameValidation()}
        error={renameError() ?? renameDomainError()}
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
