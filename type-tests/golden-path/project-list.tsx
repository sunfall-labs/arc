import { Signal } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { SolidDb } from "@sunfall/arc-solid-db";
import { Effect } from "effect";
import { For, Show } from "solid-js";
import { Projects } from "./collection.js";
import { ProjectRoute } from "./routes.js";

type Status = "active" | "archived";

export const ProjectSidebar = Component.define("ProjectSidebar", function* () {
  // E += the collection's load error, exactly like a Resource reader (here never).
  const projects = yield* SolidDb.collection(Projects);
  // Client-only UI state: a Signal per instance, named for the Timeline.
  const status = Signal.make<Status>("active", { name: "ProjectSidebar.status" });
  // Writes happen in a named transition; the Timeline shows `ProjectSidebar.filter`.
  const filter = yield* Component.callback("filter", (next: Status) =>
    Effect.sync(() => status.set(next)),
  );

  return () => (
    <nav class={{ refreshing: projects.waiting() }}>
      <select
        value={status.get()}
        onChange={(event) => filter(event.currentTarget.value as Status)}
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
      <Show when={projects.failure()}>
        <p role="alert">Could not refresh projects.</p>
      </Show>
    </nav>
  );
});
