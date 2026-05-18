import { Route, RouterOutlet, RouterProvider, useResource } from "@sunfall/arc-solid";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import { createSignal, onCleanup, onMount } from "solid-js";
import {
  BlogPostRoute,
  CookbookRoute,
  DocsOverviewRoute,
  DocsPageRoute,
  HomeRoute,
  RecipeRoute,
  app,
} from "./app-definition.js";
import {
  RecipeBySlug,
  RecipeIndexRef,
  type DocsContentApi,
  type Recipe,
  type RecipeBlock,
  type RecipeSummary,
} from "./content.js";
import {
  docsPages,
  docsPagesBySection,
  docsSections,
  getDocsPage,
  type DocsBlock,
  type DocsPage,
  type DocsSection,
} from "./docs-content.js";
import type { RecipeCategory, RecipeSlug } from "./content.contract.js";
import { codeLanguageLabel, highlightCode } from "./code-highlighting.js";
import "./styles.css";

const HomeUiRoute = Route.withComponent(HomeRoute, HomeView);
const DocsOverviewUiRoute = Route.withComponent(DocsOverviewRoute, DocsOverviewView);
const DocsPageUiRoute = Route.withComponent(DocsPageRoute, DocsPageView);
const BlogPostUiRoute = Route.withComponent(BlogPostRoute, BlogPostView);
const CookbookUiRoute = Route.withComponent(CookbookRoute, CookbookIndexView);
const RecipeUiRoute = Route.withComponent(RecipeRoute, RecipeRouteView);
const routes = [
  HomeUiRoute,
  DocsOverviewUiRoute,
  DocsPageUiRoute,
  BlogPostUiRoute,
  CookbookUiRoute,
  RecipeUiRoute,
] as const;
const articleBodyClass = "recipeBody prose prose-stone max-w-none";
const packageListItemPattern = /^(@sunfall\/[a-z0-9-]+(?: and @sunfall\/[a-z0-9-]+)*):\s(.+)$/u;
interface HeadingSource {
  readonly blockIndex: number;
  readonly level: 2 | 3;
  readonly text: string;
}

interface PageRailItem extends HeadingSource {
  readonly id: string;
}

type DocsSiteRuntime<RuntimeServices = DocsContentApi> = [DocsContentApi] extends [RuntimeServices]
  ? SunfallArcRuntime<RuntimeServices, never>
  : never;

export interface AppProps<RuntimeServices = DocsContentApi> {
  readonly initialHref?: string;
  readonly runtime?: DocsSiteRuntime<RuntimeServices>;
}

const categoryLabel = (category: RecipeCategory): string => {
  switch (category) {
    case "resources":
      return "Resources";
    case "routing":
      return "Routing";
    case "actions":
      return "Actions";
    case "testing":
      return "Testing";
  }
};

const recipeHref = (slug: RecipeSlug): string => `/cookbook/${slug}`;

const slugifyHeading = (text: string): string => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return slug.length > 0 ? slug : "section";
};

const createPageRailItems = (headings: ReadonlyArray<HeadingSource>): readonly PageRailItem[] => {
  const seen = new Map<string, number>();

  return headings.map((heading) => {
    const slug = slugifyHeading(heading.text);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);

    return {
      ...heading,
      id: count === 0 ? slug : `${slug}-${count + 1}`,
    };
  });
};

const pageRailIdsByBlockIndex = (items: ReadonlyArray<PageRailItem>): ReadonlyMap<number, string> =>
  new Map(items.map((item) => [item.blockIndex, item.id] as const));

const docsPageRailItems = (blocks: ReadonlyArray<DocsBlock>): readonly PageRailItem[] =>
  createPageRailItems(
    blocks.flatMap((block, blockIndex): readonly HeadingSource[] =>
      block._tag === "Heading" ? [{ blockIndex, level: 2, text: block.text ?? "Section" }] : [],
    ),
  );

const recipePageRailItems = (blocks: ReadonlyArray<RecipeBlock>): readonly PageRailItem[] =>
  createPageRailItems(
    blocks.flatMap((block, blockIndex): readonly HeadingSource[] =>
      block._tag === "Heading"
        ? [{ blockIndex, level: block.level <= 2 ? 2 : 3, text: block.text }]
        : [],
    ),
  );

const blogRailItems = createPageRailItems([
  { blockIndex: 0, level: 2, text: "The comparison in one sentence" },
  { blockIndex: 1, level: 2, text: "What TanStack Query would do" },
  { blockIndex: 2, level: 2, text: "What React, Solid, Zustand, and Jotai would do" },
  { blockIndex: 3, level: 2, text: "What Arc gives you instead" },
  { blockIndex: 4, level: 2, text: "A guided slice: route, resource, and UI" },
  { blockIndex: 5, level: 2, text: "Mutations, forms, and local-first state" },
  { blockIndex: 6, level: 2, text: "The graph becomes a release artifact" },
  { blockIndex: 7, level: 2, text: "What this alpha does not claim" },
]);

const blogHeadingId = (index: number): string =>
  blogRailItems[index]?.id ?? `blog-section-${index}`;

export default function App<RuntimeServices = DocsContentApi>(
  props: AppProps<RuntimeServices> = {},
) {
  const runtime = (props.runtime ?? app.runtime) as SunfallArcRuntime<
    DocsContentApi | RuntimeServices,
    never
  >;
  const routerProps =
    props.initialHref === undefined
      ? { routes, runtime }
      : { routes, runtime, initialHref: props.initialHref };

  return (
    <RouterProvider {...routerProps}>
      <DocsShell />
    </RouterProvider>
  );
}

function DocsShell() {
  return (
    <main class="docsShell">
      <aside class="docsSidebar">
        <a href={Route.href(HomeUiRoute)} class="brandLink">
          <span class="brandMark">A</span>
          <span>
            <strong>Sunfall Arc</strong>
            <small>Docs</small>
          </span>
        </a>
        <DocsNav />
        <RecipeNav />
        <a href={Route.href(BlogPostUiRoute)} class="navSectionLink">
          Why Sunfall Arc
        </a>
      </aside>

      <section class="docsMain">
        <RouterOutlet
          pending={() => <LoadingView />}
          failure={(state) => <FailureView error={state.error} />}
          notFound={() => <NotFoundView />}
        />
      </section>
    </main>
  );
}

function DocsNav() {
  return (
    <nav class="sidebarSection" aria-label="Documentation">
      <p class="navHeading">Docs</p>
      <a href={Route.href(DocsOverviewUiRoute)} class="navSectionLink">
        Overview
      </a>
      <div class="navList">
        {docsPages.map((page) => (
          <a
            href={Route.href(DocsPageUiRoute, { params: { slug: page.slug } })}
            class="navRecipeLink"
          >
            <span>{page.title}</span>
            <small>{page.section}</small>
          </a>
        ))}
      </div>
    </nav>
  );
}

function RecipeNav() {
  const recipes = useResource(RecipeIndexRef);

  return (
    <nav class="sidebarSection" aria-label="Cookbook recipes">
      <p class="navHeading">Cookbook</p>
      {recipes.match({
        initial: () => <p class="muted">Loading recipes</p>,
        pending: (previous) =>
          previous ? <RecipeNavList recipes={previous} /> : <p class="muted">Loading recipes</p>,
        success: (value) => <RecipeNavList recipes={value} />,
        failure: () => <p class="muted">Recipe index unavailable</p>,
      })}
    </nav>
  );
}

function RecipeNavList(props: { readonly recipes: ReadonlyArray<RecipeSummary> }) {
  return (
    <>
      <a href={Route.href(CookbookUiRoute)} class="navSectionLink">
        All recipes
      </a>
      <div class="navList">
        {props.recipes.map((recipe) => (
          <a
            href={Route.href(RecipeUiRoute, { params: { slug: recipe.slug } })}
            class="navRecipeLink"
          >
            <span>{recipe.title}</span>
            <small>{categoryLabel(recipe.category)}</small>
          </a>
        ))}
      </div>
    </>
  );
}

function PageRail(props: { readonly items: ReadonlyArray<PageRailItem> }) {
  const [activeId, setActiveId] = createSignal(props.items[0]?.id ?? "");

  onMount(() => {
    const headings = props.items
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => heading !== null);

    if (headings.length === 0) {
      return;
    }

    const firstHeading = headings[0];

    if (firstHeading === undefined) {
      return;
    }

    const updateActiveHeading = () => {
      const current = headings.reduce<HTMLElement>((active, heading) => {
        const top = heading.getBoundingClientRect().top;
        return top <= 128 ? heading : active;
      }, firstHeading);

      setActiveId(current.id);
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);

    onCleanup(() => {
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    });
  });

  if (props.items.length === 0) {
    return null;
  }

  return (
    <aside class="pageRail" aria-label="On this page">
      <p class="pageRailTitle">On this page</p>
      <nav class="pageRailNav">
        {props.items.map((item) => (
          <a
            href={`#${item.id}`}
            class="pageRailLink"
            classList={{
              active: activeId() === item.id,
              nested: item.level > 2,
            }}
            aria-current={activeId() === item.id ? "location" : undefined}
          >
            {item.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}

function HomeView() {
  const recipes = useResource(RecipeIndexRef);

  return (
    <article class="pageStack">
      <header class="heroBand">
        <p class="eyebrow">Dogfooded docs</p>
        <h1>Cookbook recipes backed by Sunfall Arc Resources.</h1>
        <p>
          This docs site is itself a Start app: content is loaded through server functions, exposed
          through a Capability, preloaded by file routes, and hydrated before the UI mounts.
        </p>
        <a href={Route.href(CookbookUiRoute)} class="primaryLink">
          Browse cookbook
        </a>
        <a href={Route.href(DocsOverviewUiRoute)} class="secondaryLink">
          Read the docs
        </a>
      </header>

      <section class="featureCallout" aria-label="Introduction">
        <p class="eyebrow">From the blog</p>
        <h2>Why Sunfall Arc exists</h2>
        <p>
          The first public alpha is about making full-stack TypeScript feel inspectable: data
          loading, mutations, routing, server boundaries, and local state all become named typed
          definitions instead of scattered conventions.
        </p>
        <a href={Route.href(BlogPostUiRoute)} class="primaryLink">
          Read the introduction
        </a>
      </section>

      {recipes.match({
        initial: () => <RecipeGridSkeleton />,
        pending: (previous) =>
          previous ? <RecipeGrid recipes={previous.slice(0, 3)} /> : <RecipeGridSkeleton />,
        success: (value) => <RecipeGrid recipes={value.slice(0, 3)} />,
        failure: (error) => <FailureView error={error} />,
      })}
    </article>
  );
}

const docsPageHref = (page: DocsPage): string =>
  Route.href(DocsPageUiRoute, { params: { slug: page.slug } });

const docsSectionLabel = (section: DocsSection): string => section;

function DocsOverviewView() {
  return (
    <article class="pageStack">
      <header class="pageHeader">
        <p class="eyebrow">Documentation</p>
        <h1>Public alpha docs for Arc's typed app definitions.</h1>
        <p>
          Start here when you want to understand what Arc is, how to try it, and where each core
          concept fits before reaching for the cookbook.
        </p>
      </header>

      <section class="docsSectionGrid" aria-label="Documentation sections">
        {docsSections.map((section) => (
          <div class="docsSection">
            <h2>{docsSectionLabel(section)}</h2>
            <div class="docsCardList">
              {docsPagesBySection(section).map((page) => (
                <a href={docsPageHref(page)} class="docsCard">
                  <span>{page.title}</span>
                  <p>{page.summary}</p>
                </a>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section class="featureCallout" aria-label="Cookbook next step">
        <p class="eyebrow">Next step</p>
        <h2>Use the cookbook once the concepts click</h2>
        <p>
          The cookbook recipes are intentionally small, but each one follows the same public
          contracts: Effect-first callbacks, typed schemas, route-owned preload, and explicit
          invalidation.
        </p>
        <a href={Route.href(CookbookUiRoute)} class="primaryLink">
          Browse cookbook
        </a>
      </section>
    </article>
  );
}

function DocsPageView(props: Route.Props<typeof DocsPageRoute>) {
  const page = getDocsPage(props.params.slug);

  if (!page) {
    return <NotFoundView />;
  }

  const railItems = docsPageRailItems(page.blocks);
  const headingIds = pageRailIdsByBlockIndex(railItems);

  return (
    <article class="recipeDetail articleWithRail">
      <header class="pageHeader">
        <p class="eyebrow">{page.section}</p>
        <h1>{page.title}</h1>
        <p>{page.summary}</p>
      </header>

      <PageRail items={railItems} />

      <section class={articleBodyClass}>
        {page.blocks.map((block, blockIndex) => (
          <DocsBlockView block={block} headingId={headingIds.get(blockIndex)} />
        ))}
      </section>
    </article>
  );
}

function DocsBlockView(props: {
  readonly block: DocsBlock;
  readonly headingId: string | undefined;
}) {
  switch (props.block._tag) {
    case "Heading":
      return <h2 id={props.headingId}>{props.block.text ?? "Section"}</h2>;
    case "Paragraph":
      return <p>{props.block.text}</p>;
    case "List":
      return (
        <ul>
          {(props.block.items ?? []).map((item) => (
            <DocsListItem item={item} />
          ))}
        </ul>
      );
    case "Code":
      return <CodeBlock code={props.block.code ?? ""} language={props.block.language} />;
  }
}

function DocsListItem(props: { readonly item: string }) {
  const match = packageListItemPattern.exec(props.item);
  if (!match) {
    return <li>{props.item}</li>;
  }

  const packageNames = match[1]?.split(" and ") ?? [];
  const description = match[2] ?? "";

  return (
    <li>
      {packageNames.map((packageName, index) => (
        <>
          {index > 0 ? " and " : null}
          <code class="inlineCode">{packageName}</code>
        </>
      ))}
      : {description}
    </li>
  );
}

function CookbookIndexView() {
  const recipes = useResource(RecipeIndexRef);

  return (
    <article class="pageStack">
      <header class="pageHeader">
        <p class="eyebrow">Cookbook</p>
        <h1>Idiomatic Sunfall Arc examples</h1>
        <p>
          Each recipe is intentionally small enough to copy, but still follows the framework rules:
          Effect-first callbacks, typed schemas, and explicit route data ownership.
        </p>
      </header>

      {recipes.match({
        initial: () => <RecipeGridSkeleton />,
        pending: (previous) =>
          previous ? <RecipeGrid recipes={previous} /> : <RecipeGridSkeleton />,
        success: (value) => <RecipeGrid recipes={value} />,
        failure: (error) => <FailureView error={error} />,
      })}
    </article>
  );
}

const blogContractExample = `export const GetProject = Server.contract<
  { readonly id: ProjectId },
  Project,
  ProjectError
>("Project.get", {
  input: Schema.Struct({ id: ProjectId }),
  output: ProjectSchema,
  error: ProjectErrorSchema,
});`;

const blogResourceExample = `export const ProjectApi = Capability.define<ProjectApi>("ProjectApi");

export const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});`;

const blogRouteExample = `const RouteBuilder = defineFileRoute("/projects/:id");

export const Route = RouteBuilder.preload({
  params: ProjectRouteParams,
  resources: ({ resource }) => [
    resource(ProjectById, ({ params }) => params.id),
  ],
}).route();`;

const blogUiExample = `function ProjectPage(props: Route.Props<typeof ProjectRoute>) {
  const project = useResource(() => ProjectById(props.params.id));

  return project.match({
    success: (value) => <ProjectView project={value} />,
    pending: (previous) => previous ? <ProjectView project={previous} refreshing /> : <Skeleton />,
    failure: (error) => <ProjectError error={error} />,
  });
}`;

const blogTanstackExample = `function ProjectPage({ id }: { readonly id: ProjectId }) {
  const queryClient = useQueryClient();
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => fetchProject(id),
  });
  const rename = useMutation({
    mutationFn: renameProject,
    onSuccess: (project) =>
      queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
  });

  return <ProjectView project={project.data} rename={rename.mutate} />;
}`;

const blogStoreExample = `const useProjectStore = create<ProjectStore>((set, get) => ({
  projectsById: {},
  pendingById: {},
  async loadProject(id) {
    set((state) => ({ pendingById: { ...state.pendingById, [id]: true } }));
    const project = await fetchProject(id);
    set((state) => ({
      projectsById: { ...state.projectsById, [id]: project },
      pendingById: { ...state.pendingById, [id]: false },
    }));
  },
  async renameProject(input) {
    const project = await renameProject(input);
    set((state) => ({
      projectsById: { ...state.projectsById, [project.id]: project },
    }));
  },
}));`;

const blogActionExample = `export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: ProjectSchema,
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});`;

const blogGraphExample = `sunfall-arc-start graph route /projects/:id
sunfall-arc-start impact action Project.rename --json`;

function BlogCode(props: { readonly code: string; readonly language?: string }) {
  return <CodeBlock code={props.code} language={props.language ?? "tsx"} />;
}

function BlogPostView() {
  return (
    <article class="blogPost articleWithRail">
      <header class="pageHeader">
        <p class="eyebrow">Introducing Sunfall Arc</p>
        <h1>One typed graph for your full-stack TypeScript app.</h1>
        <p>
          Sunfall Arc is easiest to understand by comparing it to the stack it can collapse:
          TanStack Query for server state, React or Solid primitives for local reactivity, Zustand
          or Jotai for shared app state, route preload glue, form action plumbing, typed API
          clients, and a pile of diagnostics that usually arrive too late.
        </p>
      </header>

      <PageRail items={blogRailItems} />

      <section class={articleBodyClass}>
        <p>
          Modern TypeScript apps do not lack good libraries. TanStack Query is excellent at server
          state. React and Solid have strong local reactivity stories. Zustand and Jotai are small,
          productive ways to share client state. The hard part is that each tool owns a different
          map of the app.
        </p>
        <p>
          A route knows it needs a project. A query key knows how to cache it. A mutation knows how
          to rename it. A store knows what the sidebar has selected. A server handler knows the real
          permission boundary. Tests know a mock. Devtools know whatever the runtime exposes. Those
          pieces are related, but in most apps they are not one thing.
        </p>
        <p>
          Arc is built around a different bet: framework behavior should be modeled as typed
          definitions the runtime and tooling can both understand. Routes, Resources, Actions,
          server functions, Collections, Forms, and Capabilities are not just helpers. They are the
          nouns the app uses to explain itself to the renderer, the server, tests, devtools, CI, and
          agents.
        </p>

        <h2 id={blogHeadingId(0)}>The comparison in one sentence</h2>
        <p>
          If a value is a private UI detail, keep using React state, Solid signals, or ordinary
          component state. If it is domain state or behavior that loads, mutates, hydrates,
          persists, invalidates, crosses the server boundary, or needs to be inspected by tooling,
          Arc wants a named definition for it.
        </p>
        <p>
          In Arc, a definition is a named typed declaration the framework can run and inspect: a
          Route, Resource, Action, Form, Collection, Capability, Signal, or server contract. The app
          graph is the map Arc builds from those definitions.
        </p>
        <p>That means Arc is trying to replace much of the glue where teams normally combine:</p>
        <ul>
          <li>TanStack Query for async server data and invalidation.</li>
          <li>Zustand or Jotai for shared domain state that outgrows component state.</li>
          <li>Hand-rolled typed fetch clients and server-only handler conventions.</li>
          <li>Route preload, SSR hydration, action forms, optimistic queues, and test mocks.</li>
          <li>Ad hoc diagnostics that have to rediscover the app after it has already shipped.</li>
        </ul>
        <p>
          The point is not that those tools are weak. The point is that Arc gives the important
          definitions one typed owner before they scatter.
        </p>

        <h2 id={blogHeadingId(1)}>What TanStack Query would do</h2>
        <p>
          In a TanStack Query app, the project read would usually be a query keyed by project id,
          and the rename would be a mutation that invalidates or updates related query keys.
        </p>
        <BlogCode code={blogTanstackExample} />
        <p>
          That is a good model for server state. It handles the hard client cache problems:
          asynchronous fetches, staleness, request deduping, refetching, mutation state, retries,
          cache garbage collection, and render optimization.
        </p>
        <p>
          Arc overlaps with that job, but pushes the boundary outward. A Resource is not only a
          cache entry. It is a named, schema-checked, Effect-powered graph node that can be
          preloaded by a route, hydrated through Start, invalidated by an Action, tested through a
          Capability, and emitted as a build artifact.
        </p>
        <p>
          In other words: TanStack Query is a superb server-state cache. Arc wants the server-state
          cache, the route data contract, the server function contract, the invalidation plan, and
          the diagnostic graph to be connected through the same typed definitions.
        </p>

        <h2 id={blogHeadingId(2)}>What React, Solid, Zustand, and Jotai would do</h2>
        <p>
          With vanilla React or Solid, you would keep local UI state close to the component:
          selected tabs, open panels, draft text, hover intent, optimistic disclosure state. That is
          still the right place for local state.
        </p>
        <p>
          When the same project data has to be read across distant screens, updated by multiple
          actions, persisted, hydrated, and tested, teams often reach for Zustand or Jotai. A store
          or atom graph can centralize state and reduce prop drilling.
        </p>
        <BlogCode code={blogStoreExample} />
        <p>
          That works, but now the store owns some behavior the framework cannot understand. Which
          route needs this data before render? Which server function is safe to call from the
          browser? Which Resources or Collections should refresh after a mutation? What does SSR
          need to serialize? Which mock should tests provide? The store can answer these questions
          only if you build more conventions around it.
        </p>
        <p>
          Arc is meant to replace Zustand and Jotai for domain state, not for every tiny UI toggle.
          If the state represents durable app behavior - projects, sessions, local-first rows,
          pending writes, resource lifetimes, form submissions, permissioned server calls - Arc
          wants a typed Signal, Resource, Action, Form, Collection, Route, or Capability instead of
          an opaque global store.
        </p>

        <h2 id={blogHeadingId(3)}>What Arc gives you instead</h2>
        <p>
          Arc turns the full-stack app into a typed graph that can execute, hydrate, invalidate,
          persist, and explain itself. That graph has a few core concepts:
        </p>
        <ul>
          <li>Signals are named pieces of app state when a value needs framework visibility.</li>
          <li>Resources are named, schema-checked units of async or external data.</li>
          <li>Actions are named mutations with typed input, output, effects, and invalidation.</li>
          <li>Forms bind progressive submissions to the same Action definition.</li>
          <li>Capabilities are dependency seams for live services, server clients, and tests.</li>
          <li>Routes declare the Resources and Collections they own before render.</li>
          <li>
            Collections model local-first data, persistence, optimistic queues, and live queries.
          </li>
          <li>
            Start emits deterministic route, resource, action, collection, endpoint, and module
            metadata.
          </li>
        </ul>
        <p>
          The result is composure. The same Resource can be preloaded by a route, read by a UI
          adapter, serialized into streamed hydration, invalidated by an Action, mocked through a
          Capability, and inspected by devtools without each layer inventing a private story about
          it.
        </p>

        <h2 id={blogHeadingId(4)}>A guided slice: route, resource, and UI</h2>
        <p>
          Start with the browser-safe contract. The client can import the schema and typed handle;
          the handler stays in a server-only module.
        </p>
        <BlogCode code={blogContractExample} />

        <p>
          Expose that contract through a Capability, then define a Resource around the domain value
          the UI needs. The Resource owns the input schema, output schema, loading Effect, cache
          identity, and semantic tags it provides.
        </p>
        <BlogCode code={blogResourceExample} />

        <p>
          A file route declares that it owns that Resource. During SSR, Start runs the preload in
          the request runtime, renders with the Resource available, and streams hydration data for
          the client runtime.
        </p>
        <BlogCode code={blogRouteExample} />

        <p>
          The component reads the same Resource. It does not need to know whether the value came
          from SSR preload, client navigation, a refresh, or a hydrated action response.
        </p>
        <BlogCode code={blogUiExample} />

        <h2 id={blogHeadingId(5)}>Mutations, forms, and local-first state</h2>
        <p>
          Actions keep write behavior in the same graph. A mutation has a stable name, a schema, an
          Effect, and an invalidation plan expressed as domain tags rather than stringly cache keys.
        </p>
        <BlogCode code={blogActionExample} />
        <p>
          Start action forms can submit through enhanced clients or plain form posts. Either path
          runs the same Action through the request runtime and can return refreshed Resource
          payloads to the browser.
        </p>
        <p>
          Collections extend the same treatment to local-first data. Live queries, persistence,
          optimistic row mutations, flush policy, and sync adapter boundaries are framework concepts
          rather than store conventions every feature has to reinvent.
        </p>
        <p>
          This is where Arc most directly competes with global state libraries. For domain state, it
          should feel more useful to define a Collection or Resource than to build a Zustand slice
          or atom family, because Arc can also connect that state to routing, hydration,
          invalidation, tests, and graph output.
        </p>

        <h2 id={blogHeadingId(6)}>The graph becomes a release artifact</h2>
        <p>
          Because routes, Resources, Actions, server functions, Collections, and modules are named
          definitions, Start can emit a deterministic graph. Humans can read it, CI can enforce it,
          and agents can use it to make focused edits without guessing how files fit together.
        </p>
        <BlogCode code={blogGraphExample} language="shellscript" />
        <p>
          This is the part that makes Arc unusual. The framework is not only trying to render HTML
          or give components nice hooks. It is trying to make the shape of the app available as a
          public, typed artifact before something breaks.
        </p>

        <h2 id={blogHeadingId(7)}>What this alpha does not claim</h2>
        <p>
          Sunfall Arc is not pretending to be a finished ecosystem. Platform-specific packages for
          every host can wait until real deployments demand them. The first public alpha is about
          the core spine: typed resources and actions, Start SSR and hydration, Solid and React
          adapters, local-first collections, devtools contracts, starters, package gates, and docs
          that are themselves built with the framework.
        </p>
        <p>
          It also should not replace every primitive your renderer already gives you. React state,
          Solid signals, refs, memos, and ordinary component props are still perfect for local UI.
          Arc starts to earn its keep when the state is no longer merely local.
        </p>
        <p>
          The promise is simple: keep the best ideas from modern state tools, but stop forcing the
          application to explain itself in five disconnected dialects. Fewer invisible seams, more
          typed boundaries, and a framework that can tell you what it knows.
        </p>
      </section>
    </article>
  );
}

function RecipeGrid(props: { readonly recipes: ReadonlyArray<RecipeSummary> }) {
  return (
    <section class="recipeGrid" aria-label="Recipes">
      {props.recipes.map((recipe) => (
        <a href={Route.href(RecipeUiRoute, { params: { slug: recipe.slug } })} class="recipeCard">
          <span class="recipeCategory">{categoryLabel(recipe.category)}</span>
          <h2>{recipe.title}</h2>
          <p>{recipe.summary}</p>
          <span class="recipeCta">Open recipe</span>
        </a>
      ))}
    </section>
  );
}

function RecipeRouteView(props: Route.Props<typeof RecipeRoute>) {
  const recipe = useResource(() => RecipeBySlug(props.params.slug));

  return recipe.match({
    initial: () => <LoadingView />,
    pending: (previous) =>
      previous ? <RecipeDetail recipe={previous} refreshing /> : <LoadingView />,
    success: (value) => <RecipeDetail recipe={value} refreshing={false} />,
    failure: (error, previous) =>
      previous ? (
        <>
          <RecipeDetail recipe={previous} refreshing={false} />
          <FailureView error={error} />
        </>
      ) : (
        <FailureView error={error} />
      ),
  });
}

function RecipeDetail(props: { readonly recipe: Recipe; readonly refreshing: boolean }) {
  const railItems = recipePageRailItems(props.recipe.blocks);
  const headingIds = pageRailIdsByBlockIndex(railItems);

  return (
    <article class="recipeDetail articleWithRail" classList={{ refreshing: props.refreshing }}>
      <header class="pageHeader">
        <p class="eyebrow">{categoryLabel(props.recipe.category)}</p>
        <h1>{props.recipe.title}</h1>
        <p>{props.recipe.summary}</p>
      </header>

      <PageRail items={railItems} />

      <section class={articleBodyClass}>
        {props.recipe.blocks.map((block, blockIndex) => (
          <RecipeBlockView block={block} headingId={headingIds.get(blockIndex)} />
        ))}
      </section>

      <RelatedRecipes recipe={props.recipe} />
    </article>
  );
}

function RecipeBlockView(props: {
  readonly block: RecipeBlock;
  readonly headingId: string | undefined;
}) {
  switch (props.block._tag) {
    case "Heading":
      return props.block.level <= 2 ? (
        <h2 id={props.headingId}>{props.block.text}</h2>
      ) : (
        <h3 id={props.headingId}>{props.block.text}</h3>
      );
    case "Paragraph":
      return <p>{props.block.text}</p>;
    case "List":
      return (
        <ul>
          {props.block.items.map((item) => (
            <li>{item}</li>
          ))}
        </ul>
      );
    case "Code":
      return <CodeBlock code={props.block.code} language={props.block.language} />;
  }
}

function CodeBlock(props: { readonly code: string; readonly language?: string | undefined }) {
  const [copied, setCopied] = createSignal(false);
  let copiedTimeout: number | undefined;

  const copyCodeWithSelection = () => {
    const textarea = document.createElement("textarea");
    textarea.value = props.code;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  };

  const copyCode = async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(props.code);
    } else if (typeof document !== "undefined") {
      if (!copyCodeWithSelection()) {
        return;
      }
    } else {
      return;
    }

    window.clearTimeout(copiedTimeout);
    setCopied(true);
    copiedTimeout = window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <figure class="codeFrame not-prose" data-language={codeLanguageLabel(props.language)}>
      <figcaption class="codeToolbar">
        <span>{codeLanguageLabel(props.language)}</span>
        <button type="button" class="codeCopyButton" onClick={copyCode}>
          {copied() ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <div class="codeBlock" innerHTML={highlightCode(props.code, props.language)} />
    </figure>
  );
}

function RelatedRecipes(props: { readonly recipe: Recipe }) {
  const recipes = useResource(RecipeIndexRef);

  if (props.recipe.related.length === 0) {
    return null;
  }

  return recipes.match({
    initial: () => null,
    pending: (previous) =>
      previous ? <RelatedRecipeList recipe={props.recipe} recipes={previous} /> : null,
    success: (value) => <RelatedRecipeList recipe={props.recipe} recipes={value} />,
    failure: () => null,
  });
}

function RelatedRecipeList(props: {
  readonly recipe: Recipe;
  readonly recipes: ReadonlyArray<RecipeSummary>;
}) {
  const related = props.recipes.filter((recipe) => props.recipe.related.includes(recipe.slug));

  if (related.length === 0) {
    return null;
  }

  return (
    <aside class="relatedPanel" aria-label="Related recipes">
      <h2>Related recipes</h2>
      <div class="relatedList">
        {related.map((recipe) => (
          <a
            href={Route.href(RecipeUiRoute, { params: { slug: recipe.slug } })}
            class="relatedLink"
          >
            {recipe.title}
          </a>
        ))}
      </div>
    </aside>
  );
}

function RecipeGridSkeleton() {
  return (
    <section class="recipeGrid" aria-label="Loading recipes">
      <div class="recipeCard skeleton" />
      <div class="recipeCard skeleton" />
      <div class="recipeCard skeleton" />
    </section>
  );
}

function LoadingView() {
  return (
    <section class="statusView">
      <h1>Loading cookbook</h1>
      <p>The route-owned Resource preload is still resolving.</p>
    </section>
  );
}

function FailureView(props: { readonly error: unknown }) {
  return (
    <section class="statusView failure">
      <h1>Could not load docs</h1>
      <p>{props.error instanceof Error ? props.error.message : "The docs Resource failed."}</p>
    </section>
  );
}

function NotFoundView() {
  return (
    <section class="statusView">
      <h1>Page not found</h1>
      <p>Try the cookbook index or one of the recipe links.</p>
    </section>
  );
}

export const docsSiteRecipeHref = recipeHref;
