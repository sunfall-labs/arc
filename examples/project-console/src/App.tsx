import { Component, RouterLink, RouterOutlet, RouterProvider, useRouter } from "@sunfall/arc-solid";
import { Action, Resource, Route, Signal } from "@sunfall/arc-core";
import type { Collection } from "@sunfall/arc-db";
import { SolidDb } from "@sunfall/arc-solid-db";
import { Cause, Effect } from "effect";
import { For, Show, createEffect, onSettled } from "solid-js";
import {
  ProjectById,
  ProjectsRef,
  makeProjectId,
  makePresenceStream,
  projectSearch,
  type PresenceEvent,
  type ProjectId,
  type ProjectSummary,
} from "./domain.js";
import { ProjectSummaries } from "./project-collections.js";
import { PresencePill } from "./ui.tsrx";
import { routeById } from "./routeTree.gen.js";
import { ProjectPage } from "./project-page.js";
import { FailureView, InlineFailure, ProjectSkeleton, statusLabel } from "./project-views.js";

const HomeRoute = routeById.route_root;
const ProjectsRoute = routeById.route_projects;
const ProjectRoute = routeById.route_projects_$id;

type ProjectSummaryRow = Collection.Row<ProjectSummary, ProjectId>;

const initialPresence: PresenceEvent = {
  activeUsers: 4,
  build: "queued",
  latency: 32,
};

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
  // Durable submissions (AdvanceProject) waiting to sync. The server render
  // has no outbox, so it reports none.
  const outbox = yield* Action.outbox;

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
              <Show when={outbox.pending.get().length > 0}>
                <span class="syncPill" role="status" data-testid="sync-pending">
                  {outbox.pending.get().length === 1
                    ? "1 change waiting to sync"
                    : `${outbox.pending.get().length} changes waiting to sync`}
                </span>
              </Show>
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

function NotFoundView() {
  return (
    <section class="failureView">
      <h2>Route not found</h2>
      <p>This workspace only knows about /projects and /projects/:id.</p>
    </section>
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
