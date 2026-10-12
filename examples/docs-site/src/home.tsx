import { State } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { homeSnippets } from "./snippets.js";
import { BlogPostRoute, CookbookRoute, DocsPageRoute } from "./site-routes.js";
import { ArrowIcon, CodeBlock, GitHubIcon, githubUrl } from "./ui.js";
import { RecipeIndexGrid } from "./recipes.js";

type SampleKey = "resource" | "action" | "component";

interface Sample {
  readonly key: SampleKey;
  readonly concept: string;
  readonly file: string;
  readonly summary: string;
  readonly code: string;
}

const samples: ReadonlyArray<Sample> = [
  {
    key: "resource",
    concept: "Resource",
    file: "projects.ts",
    summary: "A named, cached read. Its failure and the service it needs are in its type.",
    code: homeSnippets.resource,
  },
  {
    key: "action",
    concept: "Action",
    file: "rename.ts",
    summary: "A named mutation. The screen changes at once; a failure rolls it back.",
    code: homeSnippets.action,
  },
  {
    key: "component",
    concept: "Component",
    file: "project-page.tsx",
    summary: "Reads the Resource, submits the Action, and must handle ProjectNotFound to compile.",
    code: homeSnippets.component,
  },
];

// The tab on the model sample: client state, so it lives in a State, and the
// Timeline reads each switch as `State "Home.sample" Show`.
const SampleTab = State.define({
  name: "Home.sample",
  initial: "resource" as SampleKey,
  on: { Show: (_current, message: { readonly key: SampleKey }) => message.key },
});

const concepts: ReadonlyArray<{ readonly name: string; readonly line: string }> = [
  { name: "Resource", line: "Named, cached, typed reads, refreshed by semantic tags." },
  { name: "Action", line: "Named mutations with optimistic patches and a durable outbox." },
  { name: "State", line: "Client state, changed only by its named messages." },
  { name: "Component", line: "Binds Resources, Actions, and States; its errors are in its type." },
  { name: "Route", line: "A URL with decoded params, preload, and a typed failure." },
  { name: "App", line: "One definition for server rendering and browser hydration." },
  { name: "Timeline", line: "Records every commit by name, and travels back to any of them." },
  { name: "Effect services", line: "Your backends as Context.Service, with a Layer per host." },
];

const guarantees: ReadonlyArray<{
  readonly title: string;
  readonly body: string;
  readonly code: string;
}> = [
  {
    title: "Unhandled failures do not compile",
    body: "A Resource's declared error joins the type of every Component that reads it. Launch without handling it, or without a Layer for its services, and TypeScript refuses.",
    code: homeSnippets.unhandled,
  },
  {
    title: "Optimistic, and durable when it matters",
    body: "`optimistic` patches the screen the moment you submit and rolls back on failure. `durable` persists the submission first, so it survives going offline and reloading.",
    code: homeSnippets.durable,
  },
  {
    title: "Replay any state the UI was in",
    body: "Every commit has a name: a State message, an Action, a Resource load, a navigation. `Timeline.record` keeps them, and `travel` re-renders the UI as it was.",
    code: homeSnippets.timeline,
  },
  {
    title: "Refresh never disturbs what did not change",
    body: "Reloads, invalidations, and patches share structure with the value they replace. Unchanged objects keep their identity, so a binding re-runs only when its field changes.",
    code: homeSnippets.refresh,
  },
];

const inlineCode = (text: string) =>
  text
    .split(/(`[^`]+`)/u)
    .map((part) =>
      part.startsWith("`") ? <code class="inlineCode">{part.slice(1, -1)}</code> : part,
    );

const installCommand = "pnpm add @sunfall/arc-core @sunfall/arc-solid @sunfall/arc-start effect";

export const HomeView = Component.define("HomeView", function* () {
  const Recipes = yield* RecipeIndexGrid;
  const tab = yield* Component.state(SampleTab);
  const selected = () => samples.find((sample) => sample.key === tab.model()) ?? samples[0]!;

  return () => (
    <article class="home">
      <header class="hero">
        <RouterLink route={BlogPostRoute} class="heroBadge">
          <span class="heroBadgeTag">Public alpha</span>
          <span>Why we built Arc</span>
          <ArrowIcon />
        </RouterLink>
        <h1>
          Full-stack TypeScript, <br />
          correct by construction.
        </h1>
        <p class="heroLede">
          Arc is a framework on Effect and Solid where errors, services, and every state change are
          typed and named. If a failure can reach the screen unhandled, or a service is missing, the
          app does not compile.
        </p>
        <div class="heroActions">
          <RouterLink
            route={DocsPageRoute}
            options={{ params: { slug: "golden-path" } }}
            class="button primary"
          >
            Start with the golden path
            <ArrowIcon />
          </RouterLink>
          <a class="button secondary" href={githubUrl} rel="noreferrer">
            <GitHubIcon />
            GitHub
          </a>
        </div>
        <CodeBlock code={installCommand} language="shellscript" class="installCommand" />
      </header>

      <section class="homeSection" aria-labelledby="model-heading">
        <div class="sectionIntro">
          <p class="eyebrow">The model</p>
          <h2 id="model-heading">Three definitions carry a feature.</h2>
          <p>
            A Resource reads, an Action writes, and a Component binds them to the screen. Each is a
            named value the compiler, the tests, and the Timeline can all see.
          </p>
        </div>
        <div class="modelExplorer">
          <div class="modelTabs" role="tablist" aria-label="Model sample">
            {samples.map((sample) => (
              <button
                type="button"
                role="tab"
                id={`model-tab-${sample.key}`}
                aria-controls="model-panel"
                aria-selected={tab.model() === sample.key ? "true" : "false"}
                tabindex={tab.model() === sample.key ? 0 : -1}
                class="modelTab"
                onClick={() => tab.send.Show({ key: sample.key })}
              >
                <span class="modelTabConcept">{sample.concept}</span>
                <span class="modelTabSummary">{sample.summary}</span>
              </button>
            ))}
          </div>
          <div
            class="modelPanel"
            role="tabpanel"
            id="model-panel"
            aria-labelledby={`model-tab-${selected().key}`}
          >
            <CodeBlock code={selected().code} language="tsx" title={selected().file} />
          </div>
        </div>
      </section>

      <section class="homeSection" aria-labelledby="concepts-heading">
        <div class="sectionIntro">
          <p class="eyebrow">Concepts</p>
          <h2 id="concepts-heading">Seven definitions and your Effect services.</h2>
          <p>That is the whole vocabulary. Everything else is TypeScript, Effect, and Solid.</p>
        </div>
        <ul class="conceptGrid">
          {concepts.map((concept) => (
            <li>
              <span class="conceptName">{concept.name}</span>
              <span class="conceptLine">{concept.line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="homeSection" aria-labelledby="guarantees-heading">
        <div class="sectionIntro">
          <p class="eyebrow">Guarantees</p>
          <h2 id="guarantees-heading">What the types and the runtime promise.</h2>
          <p>Every snippet on this page is compiled with the framework, so none of it can drift.</p>
        </div>
        <div class="guaranteeGrid">
          {guarantees.map((guarantee, index) => (
            <section class="guarantee">
              <div class="guaranteeText">
                <span class="guaranteeIndex">0{index + 1}</span>
                <h3>{guarantee.title}</h3>
                <p>{inlineCode(guarantee.body)}</p>
              </div>
              <CodeBlock code={guarantee.code} language="tsx" />
            </section>
          ))}
        </div>
      </section>

      <section class="homeSection" aria-labelledby="dogfood-heading">
        <div class="sectionIntro">
          <p class="eyebrow">Built with Arc</p>
          <h2 id="dogfood-heading">This site is an Arc app.</h2>
          <p>
            The recipes below are served Resources loaded on the server, preload from file routes,
            prerender to static pages, and hydrate without a loading flash.
          </p>
        </div>
        <Recipes limit={3} />
      </section>

      <section class="closingCta">
        <h2>Build one feature, end to end.</h2>
        <p>The golden path picks the right tool for each job, and every snippet in it compiles.</p>
        <div class="heroActions">
          <RouterLink
            route={DocsPageRoute}
            options={{ params: { slug: "golden-path" } }}
            class="button primary"
          >
            Read the golden path
            <ArrowIcon />
          </RouterLink>
          <RouterLink route={CookbookRoute} class="button secondary">
            Browse the cookbook
          </RouterLink>
        </div>
      </section>
    </article>
  );
});
