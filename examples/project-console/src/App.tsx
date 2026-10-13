import { Component, RouterLink, RouterOutlet, RouterProvider, useRouter } from "@sunfall/arc-solid";
import { Action, Machine, Message, Model, Resource, Route, State } from "@sunfall/arc-core";
import { Cause, Effect, Schema } from "effect";
import { For, Loading, Show, onSettled } from "solid-js";
import {
  ProjectById,
  ProjectList,
  ProjectsRef,
  makeProjectId,
  makePresenceStream,
  type PresenceEvent,
  type ProjectId,
  type ProjectSummary,
} from "./domain.js";
import { PresencePill } from "./ui.tsrx";
import { routeById } from "./routeTree.gen.js";
import { FailureView, InlineFailure, ProjectSkeleton, statusLabel } from "./project-views.js";

const HomeRoute = routeById.route_root;
const ProjectsRoute = routeById.route_projects;
const ProjectRoute = routeById.route_projects_$id;

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
    router.navigate(ProjectRoute, { params: { id: makeProjectId("atlas") } }, { replace: true });
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
    const projects = yield* Component.resource(ProjectList);
    // A row is saving while a durable submission for its project (a rename or
    // an advance) is pending in the Action Outbox: the Actions' own status,
    // not a flag on the row. The server render has no outbox, so none are.
    const outbox = yield* Action.outbox;
    const saving = (id: ProjectId) =>
      outbox.pending
        .get()
        .some((entry) => (entry.input as { readonly id?: unknown } | undefined)?.id === id);
    const filteredProjects = (currentProjects: ReadonlyArray<ProjectSummary>) => {
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
    // The reader suspends the `<Loading>` on the first load only; after that
    // `waiting` and `failure` decide the chrome, so a refresh never remounts
    // the list. A first load that fails throws to the boundary below.
    const rows = () => filteredProjects(projects("all"));

    return () => (
      <div class="projectList">
        <Loading fallback={<ProjectListSkeleton />}>
          {/* Keyed by id: unchanged rows keep their identity across reloads. */}
          <For each={rows()} keyed={(project) => project.id}>
            {(project) => (
              <ProjectRow
                project={project()}
                selected={project().id === props.selectedId}
                saving={saving(project().id)}
              />
            )}
          </For>

          <Show when={rows().length === 0}>
            <p class="emptyState">No projects match that filter.</p>
          </Show>

          <Show when={projects.waiting("all")}>
            <p class="inlineStatus">Refreshing projects</p>
          </Show>
        </Loading>
        <Show when={projects.failure("all")}>
          {(cause) => <InlineFailure error={Cause.squash(cause())} />}
        </Show>
      </div>
    );
  },
).pipe(Component.catchAll((error) => <InlineFailure error={error} />));

// Client-only UI state: the project filter. The Timeline reads each keystroke
// as `State "AppShell.search" TypedFilter`.
const SearchModel = Model({ Filtering: { query: Schema.String } });
const SearchMessage = Message({ TypedFilter: { query: Schema.String } });
const ProjectSearch = State.define({
  name: "AppShell.search",
  machine: Machine.make({
    state: SearchModel,
    event: SearchMessage,
    initial: SearchModel.Filtering({ query: "" }),
  }).onAny(SearchMessage.TypedFilter, ({ event }) => SearchModel.Filtering({ query: event.query })),
});

const AppShell = Component.define("AppShell", function* () {
  const presence = yield* Component.stream("presence", makePresenceStream(), initialPresence);
  const refresh = yield* Component.callback("refresh", (id: ProjectId | undefined) =>
    Resource.invalidate(id ? [ProjectsRef, ProjectById(id)] : ProjectsRef).pipe(Effect.ignore),
  );
  const search = yield* Component.state(ProjectSearch);
  const Rows = yield* ProjectRows;
  // Durable submissions (AdvanceProject) waiting to sync. The server render
  // has no outbox, so it reports none.
  const outbox = yield* Action.outbox;

  return () => {
    const router = useRouter<AppRoutes>();
    const selectedId = () => projectIdFromMatch(router.match());

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
                value={search.model().query}
                onInput={(event) => search.send.TypedFilter({ query: event.currentTarget.value })}
              />
            </label>

            <Rows selectedId={selectedId()} search={search.model().query} />
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

function ProjectRow(props: {
  readonly project: ProjectSummary;
  readonly selected: boolean;
  readonly saving: boolean;
}) {
  return (
    <RouterLink
      route={ProjectRoute}
      options={{ params: { id: props.project.id } }}
      class={["projectRow", { selected: props.selected, saving: props.saving }]}
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
        <Show when={props.saving}>
          <span class="syncBadge">Saving</span>
        </Show>
      </span>
    </RouterLink>
  );
}

const HomeUiRoute = Route.withComponent(HomeRoute, HomeRouteView);
const ProjectsUiRoute = Route.withComponent(ProjectsRoute, ProjectIndexRouteView);
// The project route's component comes from `routes/projects/$id.component.tsx`,
// which the generated route tree attaches as a lazy chunk.
const routes = [HomeUiRoute, ProjectsUiRoute, ProjectRoute] as const;

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
