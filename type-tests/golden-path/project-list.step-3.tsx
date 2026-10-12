import { Component, RouterLink } from "@sunfall/arc-solid";
import { For, Loading } from "solid-js";
import { ProjectList } from "./projects.js";
import { ProjectRoute } from "./routes.js";

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  const projects = yield* Component.resource(ProjectList);

  return () => (
    <Loading fallback={<p>Loading projects</p>}>
      <nav class={{ refreshing: projects.waiting("all") }}>
        <For each={projects("all")} keyed={(project) => project.id}>
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
