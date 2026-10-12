import { RouterLink } from "@sunfall/arc-solid";
import { PageRail, createPageRailItems } from "./page-rail.js";
import { DocsPageRoute } from "./site-routes.js";
import { goldenPathSnippets, homeSnippets } from "./snippets.js";
import { AnchoredHeading, ArrowIcon, CodeBlock, InlineText } from "./ui.js";

const sections = [
  "The problem: facts scattered across libraries",
  "Correct by construction",
  "Failures are part of the type",
  "Services are Effect services",
  "Every change has a name",
  "What conventional stacks would do",
  "What Arc replaces",
  "Legible to people, CI, and agents",
  "What this alpha does not claim",
] as const;

const railItems = createPageRailItems(
  sections.map((text, blockIndex) => ({ blockIndex, level: 2, text })),
);

const sectionId = (index: number): string => railItems[index]?.id ?? `section-${index}`;

function SectionHeading(props: { readonly index: number }) {
  return (
    <AnchoredHeading level={2} id={sectionId(props.index)} text={sections[props.index] ?? ""} />
  );
}

// Other libraries' code: illustrative, so it is not compiled with Arc.
const tanstackExample = `function ProjectPage({ id }: { readonly id: string }) {
  const queryClient = useQueryClient();
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => fetchProject(id),
  });
  const rename = useMutation({
    mutationFn: renameProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return <ProjectView project={project.data} onRename={rename.mutate} />;
}`;

const storeExample = `const useProjectStore = create<ProjectStore>((set) => ({
  projectsById: {},
  pendingById: {},
  renameStarted(id, name) {
    set((state) => ({
      projectsById: { ...state.projectsById, [id]: { ...state.projectsById[id], name } },
      pendingById: { ...state.pendingById, [id]: true },
    }));
  },
  renameSucceeded(project) {
    set((state) => ({
      projectsById: { ...state.projectsById, [project.id]: project },
      pendingById: { ...state.pendingById, [project.id]: false },
    }));
  },
}));`;

const p = (text: string) => (
  <p>
    <InlineText text={text} />
  </p>
);

export function BlogPostView() {
  return (
    <article class="docPage blogPost">
      <div class="docColumn">
        <header class="pageHeader">
          <p class="eyebrow">Blog · Introducing Sunfall Arc</p>
          <h1>Full-stack TypeScript where failures, services, and state changes are typed.</h1>
          <p class="pageLede">
            Sunfall Arc is a framework on Effect and Solid. Routes, Resources, Actions, States, and
            Components are named, typed definitions, so the compiler checks the parts of an app that
            usually only fail at runtime.
          </p>
          <p class="byline">Published with the first public alpha</p>
        </header>

        <div class="prose">
          {p(
            "Most full-stack TypeScript apps are typed at the edges and untyped in the middle. The props are typed, the API response is typed, but the facts that decide whether the app works live between libraries: which query keys a mutation must refresh, which route needs which data before it renders, which failure a screen forgot to handle, which service a test has to fake.",
          )}
          {p(
            "Arc moves those facts into definitions the compiler can read. When a Resource can fail, every screen that reads it inherits the failure. When a Resource needs a service, the app cannot start without a Layer that provides it. When state changes, the change has a name.",
          )}

          <SectionHeading index={0} />
          {p(
            "A conventional stack splits one feature across tools that are each good at their piece. A route knows it needs a project. A query key knows how to cache it. A mutation knows how to update it. A store holds what the sidebar selected. A server handler knows the real boundary. Tests know a mock. Those pieces are related, but nothing checks that they agree.",
          )}
          {p(
            "The cost shows up as drift: a mutation that forgets an invalidation, a loader that is not awaited during SSR, an error state nobody rendered, a mock that no longer matches the service. Each is a convention a person has to remember.",
          )}

          <SectionHeading index={1} />
          {p(
            "Arc's answer is to make every one of those conventions a typed definition, then let the types refuse the mistakes. It prevents drift where it can prove it, and explains drift at runtime where only runtime behavior is the honest source of truth.",
          )}
          <ul>
            <li>
              <InlineText text="**TypeScript** catches invalid route params, branded ids, unhandled failures, and missing services." />
            </li>
            <li>
              <InlineText text="**Effect** keeps effectful work explicit: services, retries, interruption, scopes, and typed errors." />
            </li>
            <li>
              <InlineText text="**The build** verifies the generated route tree and the server/client boundary." />
            </li>
            <li>
              <InlineText text="**The runtime** scopes requests, Resources, Action submissions, and streamed responses, and records every commit on the Timeline." />
            </li>
          </ul>

          <SectionHeading index={2} />
          {p(
            "A Resource is a named, cached, typed read. Its `load` is an Effect, so the failure it can produce and the service it needs are part of its type. Declaring `error` also gives the failure a schema, so a server-rendered failure crosses to the browser intact.",
          )}
          <CodeBlock code={goldenPathSnippets.projects} language="ts" title="src/projects.ts" />
          {p(
            "Read it in a Component and `ProjectNotFound` joins the Component's error type. Until a boundary handles it, the app does not compile:",
          )}
          <CodeBlock code={homeSnippets.unhandled} language="tsx" />
          {p(
            "Routes work the same way: a Route declares the Resources it preloads and the failure that preload may produce, and Start renders and hydrates exactly that.",
          )}
          <CodeBlock code={goldenPathSnippets.routes} language="ts" title="src/routes.ts" />

          <SectionHeading index={3} />
          {p(
            "Arc's services are plain Effect services: no wrapper and no second container. Services live in a typed Context, Layers implement them per host, and tests swap the Layer without touching the Resource, Action, or Component under test.",
          )}
          {p(
            "The test below runs the real `RenameProject` Action against an in-memory Layer and checks what its optimistic patch would change, without a DOM, a server, or a timer:",
          )}
          <CodeBlock
            code={goldenPathSnippets.renameTest}
            language="ts"
            title="src/rename.test.ts"
          />

          <SectionHeading index={4} />
          {p(
            "Signals are read-only in Arc's public API. Every write is a State message, an Action, or a framework event such as a Resource load or a navigation, so every commit has a name. The Timeline records them, and `travel` re-renders the UI as it was after any of them.",
          )}
          <CodeBlock code={homeSnippets.timeline} language="tsx" />
          {p(
            "Rename a project and the panel reads like a message log: the callback, the Action's submit and success, and the Resource reloads that follow.",
          )}

          <SectionHeading index={5} />
          {p(
            "TanStack Query is excellent at server reads and mutations. A project page would use a query keyed by id and a mutation that invalidates related keys:",
          )}
          <CodeBlock code={tanstackExample} language="tsx" />
          {p(
            "That handles the client cache well. Arc pushes the boundary outward: the cache entry, the route's data, the server contract, the invalidation plan, the SSR payload, and the test seam all connect through the same typed definitions, and invalidation is by meaning (`ProjectTag`) instead of by string key.",
          )}

          <SectionHeading index={6} />
          {p(
            "Solid signals and component props are still right for private UI details. Arc earns its keep when state becomes app behavior that rendering, caching, tests, or debugging depend on.",
          )}
          {p(
            "Global stores are productive, but they are opaque to the framework: nothing knows which route needs a value before render, which writes must roll back, or which reads a mutation should refresh.",
          )}
          <CodeBlock code={storeExample} language="tsx" />
          {p(
            "In practice Arc replaces much of the glue teams write between a query cache, a store, typed fetch clients, form actions, route loaders, SSR hydration, optimistic queues, and mocks. It does not replace the renderer's local state model.",
          )}

          <SectionHeading index={7} />
          {p(
            "Because the app is made of named definitions, the same structure that the compiler checks is what a reviewer reads, what CI verifies, and what a coding agent can edit without reverse-engineering conventions. Arc itself was built that way: the repo carries type tests, public API manifests, compiled doc snippets, leak scans, and release gates, so every change has to keep the framework legible to the next reader.",
          )}

          <SectionHeading index={8} />
          {p(
            "Arc is not a finished ecosystem. It is not yet a drop-in replacement for Next, Remix, or TanStack Start: those have production miles, integrations, and hosting stories Arc has not earned. Platform packages for every host can wait until real deployments ask for them.",
          )}
          {p(
            "The first public alpha is the foundation: typed definitions, Effect runtimes, Start SSR and hydration, the Solid adapter, Resource rows and live queries, the Timeline, devtools contracts, starters, and docs built with the framework itself. The promise is narrow and sharp: correct by construction, wherever the framework can prove it.",
          )}

          <nav class="pageFooterNav" aria-label="Next step">
            <RouterLink
              route={DocsPageRoute}
              options={{ params: { slug: "golden-path" } }}
              class="pagerLink next"
            >
              <span class="pagerLabel">Next</span>
              <span class="pagerTitle">
                Build one feature with the golden path <ArrowIcon />
              </span>
            </RouterLink>
          </nav>
        </div>
      </div>

      <PageRail items={railItems} />
    </article>
  );
}
