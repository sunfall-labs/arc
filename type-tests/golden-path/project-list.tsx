import { Signal } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { SolidDb } from "@sunfall/arc-solid-db";
import { AsyncResult } from "effect/reactivity";
import { For, Show } from "solid-js";
import { Projects } from "./collection.js";
import { ProjectRoute } from "./routes.js";

type Status = "active" | "archived";

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  const projects = yield* SolidDb.collection(Projects);
  // Client-only UI state: a Signal per instance, named for the Timeline.
  const status = Signal.make<Status>("active", { name: "sidebar.status" });

  return () => (
    <nav class={{ refreshing: projects.result().waiting }}>
      <select
        value={status.get()}
        onChange={(event) => status.set(event.currentTarget.value as Status)}
      >
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
      <For each={projects.index("status", status.get())} keyed={(project) => project.id}>
        {(project) => (
          <RouterLink route={ProjectRoute} options={{ params: { id: project().id } }}>
            {project().name}
          </RouterLink>
        )}
      </For>
      <Show when={AsyncResult.isFailure(projects.result())}>
        <p role="alert">Could not load projects.</p>
      </Show>
    </nav>
  );
});
