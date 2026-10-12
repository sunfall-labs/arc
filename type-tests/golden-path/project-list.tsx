import { Signal } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { For, Loading } from "solid-js";
import { ProjectList } from "./projects.js";
import { ProjectRoute } from "./routes.js";

type Status = "active" | "archived";

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  const projects = yield* Component.resource(ProjectList);
  // Client-only UI state: a Signal per instance, named for the Timeline.
  const status = Signal.make<Status>("active", { name: "ProjectSidebar.status" });
  // Writes happen in a named transition; the Timeline shows `ProjectSidebar.filter`.
  const filter = yield* Component.callback("filter", (next: Status) =>
    Effect.sync(() => status.set(next)),
  );

  return () => (
    <Loading fallback={<p>Loading projects</p>}>
      <nav class={{ refreshing: projects.waiting("all") }}>
        <select
          value={status.get()}
          onChange={(event) => filter(event.currentTarget.value as Status)}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <For each={projects.index("all", "status", status.get())} keyed={(project) => project.id}>
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
