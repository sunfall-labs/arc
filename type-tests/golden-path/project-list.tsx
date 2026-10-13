import { Machine, Message, Model, State } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { For, Loading } from "solid-js";
import { Project, ProjectList } from "./projects.js";
import { ProjectRoute } from "./routes.js";

// Client-only UI state: a State, changed only by its named messages. The
// Timeline reads each change as `State "ProjectSidebar.status" ChoseStatus`.
const StatusModel = Model({ Showing: { status: Project.fields.status } });
const StatusMessage = Message({ ChoseStatus: { status: Project.fields.status } });
const SidebarStatus = State.define({
  name: "ProjectSidebar.status",
  machine: Machine.make({
    state: StatusModel,
    event: StatusMessage,
    initial: StatusModel.Showing({ status: "active" }),
  }).onAny(StatusMessage.ChoseStatus, ({ event }) => StatusModel.Showing({ status: event.status })),
});

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  const projects = yield* Component.resource(ProjectList);
  // Each instance owns its own State; it stops when the instance unmounts.
  const status = yield* Component.state(SidebarStatus);

  return () => (
    <Loading fallback={<p>Loading projects</p>}>
      <nav class={{ refreshing: projects.waiting("all") }}>
        <select
          value={status.model().status}
          onChange={(event) =>
            status.send.ChoseStatus({
              status: event.currentTarget.value === "archived" ? "archived" : "active",
            })
          }
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <For
          each={projects.index("all", "status", status.model().status)}
          keyed={(project) => project.id}
        >
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
