import { State } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { For, Loading } from "solid-js";
import { ProjectList } from "./projects.js";
import { ProjectRoute } from "./routes.js";

type Status = "active" | "archived";

// Client-only UI state: a State, changed only by its named messages. The
// Timeline reads each change as `State "ProjectSidebar.status" Filter`.
const SidebarStatus = State.define({
  name: "ProjectSidebar.status",
  initial: "active" as Status,
  on: { Filter: (_status, message: { readonly status: Status }) => message.status },
});

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  const projects = yield* Component.resource(ProjectList);
  // Each instance owns its own State; it stops when the instance unmounts.
  const status = yield* Component.state(SidebarStatus);

  return () => (
    <Loading fallback={<p>Loading projects</p>}>
      <nav class={{ refreshing: projects.waiting("all") }}>
        <select
          value={status.model()}
          onChange={(event) => status.send.Filter({ status: event.currentTarget.value as Status })}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <For each={projects.index("all", "status", status.model())} keyed={(project) => project.id}>
          {(project) => (
            <RouterLink route={ProjectRoute} options={{ params: { id: project().id } }}>
              {project().name}
            </RouterLink>
          )}
        </For>
      </nav>
    </Loading>
  );
});
