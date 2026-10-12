import type { Route } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { For, Show } from "solid-js";
import { IssueRowView } from "../issue-row.js";
import { describeError, type User } from "../model.js";
import { CurrentUser, MyIssues, Projects, Team } from "../resources.js";
import { EmptyState } from "../ui.js";
import type { route } from "./index.js";
import { route as BoardRoute } from "./projects/$key/index.js";

/** Home: every project, and the open issues assigned to you. */
export default Component.define("HomePage", function* (_props: Route.Props<typeof route>) {
  const projects = yield* Component.resource(Projects);
  const mine = yield* Component.resource(MyIssues);
  const team = yield* Component.resource(Team);
  const user = yield* Component.resource(CurrentUser);
  const people = () => new Map<string, User>(team("all").map((member) => [member.id, member]));

  return () => (
    <div class="home">
      <header class="pageHeader">
        <div>
          <p class="eyebrow">Welcome back</p>
          <h1>{user("current")?.name.split(" ")[0] ?? "Hello"}</h1>
        </div>
      </header>

      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading" class="sectionTitle">
          Projects
        </h2>
        <div class="projectGrid">
          <For each={projects("all")}>
            {(project) => (
              <RouterLink
                route={BoardRoute}
                options={{ params: { key: project.key } }}
                class="projectCard"
              >
                <span class="projectKey">{project.key}</span>
                <strong>{project.name}</strong>
                <span class="muted">{project.description}</span>
                <span class="projectCount">{project.openCount} open</span>
              </RouterLink>
            )}
          </For>
        </div>
      </section>

      <section aria-labelledby="mine-heading">
        <h2 id="mine-heading" class="sectionTitle">
          Assigned to you
          <span class="count">{mine("open").length}</span>
        </h2>
        <Show
          when={mine("open").length > 0}
          fallback={<EmptyState title="Nothing assigned to you. Enjoy the quiet." />}
        >
          <ul class="issueList" data-testid="my-issues">
            <For each={mine("open")} keyed={(issue) => issue.id}>
              {(issue) => <IssueRowView issue={issue()} people={people()} labels={[]} />}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}).pipe(Component.catchAll((error) => <p role="alert">{describeError(error)}</p>));
