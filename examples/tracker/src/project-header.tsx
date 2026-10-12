import { RouterLink } from "@sunfall/arc-solid";
import type { JSX } from "@solidjs/web";
import type { Project, ProjectKey } from "./model.js";
import { route as BoardRoute } from "./routes/projects/$key/index.js";
import { route as IssueListRoute } from "./routes/projects/$key/issues.js";
import { route as NewIssueRoute } from "./routes/projects/$key/new.js";
import { Icon } from "./ui.js";

/** The header every project page shares: name, view switch, and "New issue". */
export function ProjectHeader(props: {
  readonly projectKey: ProjectKey;
  readonly project: Project | undefined;
  readonly view: "board" | "list";
  readonly children?: JSX.Element;
}) {
  return (
    <header class="pageHeader">
      <div>
        <p class="eyebrow">{props.projectKey}</p>
        <h1>{props.project?.name ?? props.projectKey}</h1>
      </div>
      <div class="pageActions">
        {props.children}
        <nav class="segmented" aria-label="View">
          <RouterLink
            route={BoardRoute}
            options={{ params: { key: props.projectKey } }}
            class={{ active: props.view === "board" }}
            aria-current={props.view === "board" ? "page" : undefined}
          >
            <Icon.board />
            Board
          </RouterLink>
          <RouterLink
            route={IssueListRoute}
            options={{ params: { key: props.projectKey } }}
            class={{ active: props.view === "list" }}
            aria-current={props.view === "list" ? "page" : undefined}
          >
            <Icon.list />
            List
          </RouterLink>
        </nav>
        <RouterLink
          route={NewIssueRoute}
          options={{ params: { key: props.projectKey } }}
          class="primaryButton"
          title="New issue (c)"
        >
          <Icon.plus />
          New issue
        </RouterLink>
      </div>
    </header>
  );
}
