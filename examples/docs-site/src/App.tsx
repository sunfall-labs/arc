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
  { blockIndex: 0, level: 2, text: "The problem: agents inherit implicit apps" },
  { blockIndex: 1, level: 2, text: "What agent-native means" },
  { blockIndex: 2, level: 2, text: "Correctness by construction" },
  { blockIndex: 3, level: 2, text: "The hero slice: route, resource, action, graph" },
  { blockIndex: 4, level: 2, text: "What conventional stacks would do" },
  { blockIndex: 5, level: 2, text: "What Arc replaces" },
  { blockIndex: 6, level: 2, text: "Built by an agent, verified in public" },
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
        <p class="eyebrow">Built with Arc</p>
        <h1>Sunfall Arc docs and cookbook.</h1>
        <p>
          This site is a small Arc app: recipes load through server functions, pass through a
          Capability-backed Resource, preload from file routes, and hydrate before the UI mounts.
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
          The first public alpha is about correctness by construction for agent-operated apps:
          routes, resources, actions, server boundaries, and local-first state become typed
          definitions that humans and agents can inspect, edit, and verify.
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
        <h1>Docs for agent-operated TypeScript apps.</h1>
        <p>
          Start here to learn how Arc turns full-stack TypeScript behavior into typed, inspectable
          definitions that humans, CI, and agents can check before release.
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
        <h2>Use the cookbook for working slices</h2>
        <p>
          Each recipe is intentionally small, but the shape is real: Effect-first callbacks, typed
          schemas, route-owned preload, explicit invalidation, and testable boundaries.
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
        <h1>Working Sunfall Arc recipes</h1>
        <p>
          Each recipe is small enough to copy, but it still follows the framework contracts:
          Effect-first callbacks, typed schemas, route-owned data, and checks that explain what
          changed.
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
        <h1>Correctness by construction for agent-operated TypeScript apps.</h1>
        <p>
          Sunfall Arc is an agent-native, Effect-first framework for full-stack TypeScript. It turns
          routes, resources, actions, forms, collections, capabilities, and server contracts into
          typed definitions that can be checked at type time, verified at build time, and explained
          at runtime.
        </p>
      </header>

      <PageRail items={blogRailItems} />

      <section class={articleBodyClass}>
        <p>
          Agents are powerful when the app is explicit. They are risky when the app is a maze of
          conventions: route loaders over here, query keys over there, server-only handlers in
          another directory, form validation in a component, invalidation hidden in a callback, and
          tests rebuilding the missing context by hand.
        </p>
        <p>
          Humans can eventually learn those conventions. Agents have to infer them every time. Arc
          exists to reduce that guessing. If a route loads data, an action mutates it, a server
          boundary protects it, a form submits it, or a collection persists it, Arc wants that
          behavior represented as a typed definition the framework can inspect.
        </p>
        <p>
          That is the meaning of agent-native here: not magic code generation, and not a vague AI
          label. Arc gives humans and agents a typed map of the app, stable definitions to edit, and
          verification gates that can prove the change.
        </p>

        <h2 id={blogHeadingId(0)}>The problem: agents inherit implicit apps</h2>
        <p>
          In a conventional app, the shape of the system is scattered. Next, Remix, TanStack Start,
          TanStack Query, Zustand, Jotai, fetch clients, form libraries, and custom devtools can all
          be good choices on their own. The problem is that each one owns a different piece of the
          truth.
        </p>
        <p>
          A route knows it needs a project. A query key knows how to cache it. A mutation knows how
          to rename it. A store knows what the sidebar selected. A server handler knows the real
          permission boundary. Tests know a mock. Devtools know whatever the runtime happened to
          expose. Those pieces are related, but they usually cannot explain themselves as one
          system.
        </p>
        <p>
          That is where agents get into trouble. If the route, cache, mutation, store, server
          boundary, and test boundary are implicit agreements, an agent has to reverse-engineer them
          before it can make a safe edit.
        </p>

        <h2 id={blogHeadingId(1)}>What agent-native means</h2>
        <p>
          Arc is agent-native because the app is made of named typed definitions. In Arc, a
          definition is a named typed declaration the framework can run and inspect: a Route,
          Resource, Action, Form, Collection, Capability, Signal, or server contract. The app graph
          is the map Arc builds from those definitions.
        </p>
        <p>
          The practical promise is simple: an agent can read what the app owns, change the stable
          definition that owns it, and verify the result through type tests, build diagnostics,
          graph impact output, leak scans, and runtime tests.
        </p>
        <ul>
          <li>Read: generated route trees, Start app graphs, diagnostics reports, and devtools.</li>
          <li>Change: stable Resources, Actions, Forms, Collections, Routes, and Capabilities.</li>
          <li>
            Verify: TypeScript gates, schema checks, build policy, graph impact, and{" "}
            <code class="inlineCode">pnpm verify</code>.
          </li>
        </ul>

        <h2 id={blogHeadingId(2)}>Correctness by construction</h2>
        <p>
          Compile-time correctness is the headline, but Arc's model is broader than TypeScript
          alone. Arc prevents drift where it can, and explains it where it cannot.
        </p>
        <ul>
          <li>
            TypeScript catches invalid route params, field names, branded ids, and callback shapes.
          </li>
          <li>
            Effect keeps async work explicit: services, retries, interruption, scopes, and typed
            errors.
          </li>
          <li>
            Build diagnostics catch duplicate routes, missing schemas, unknown preload ownership,
            and server/client boundary drift.
          </li>
          <li>
            Runtime scopes isolate requests, resources, collections, action submissions, and
            streamed responses.
          </li>
          <li>
            Devtools and graph output explain route plans, invalidation, request traces, and
            resource lifetimes.
          </li>
        </ul>
        <p>
          This is why Arc is not just a nicer fetch wrapper. The core product is a layered
          correctness system: type-time contracts, build-time graph checks, runtime ownership, and
          diagnostics that preserve enough structure for humans and agents to trust.
        </p>

        <h2 id={blogHeadingId(3)}>The hero slice: route, resource, action, graph</h2>
        <p>
          The smallest useful example is a route that owns a Resource, an Action that mutates the
          same domain, and a graph artifact that can explain the relationship.
        </p>
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

        <p>
          The Action keeps write behavior in the same graph. It has a stable name, a schema, an
          Effect, and an invalidation plan expressed as domain tags rather than string cache keys.
        </p>
        <BlogCode code={blogActionExample} />

        <p>
          Now the framework can explain the slice. The graph and impact commands show what a route
          owns and what an action may affect before an agent edits the next file.
        </p>
        <BlogCode code={blogGraphExample} language="shellscript" />

        <h2 id={blogHeadingId(4)}>What conventional stacks would do</h2>
        <p>
          Next, Remix, and TanStack Start make full-stack apps productive. Arc asks for a stricter
          contract: can every route, server boundary, resource, action, collection, and runtime
          effect be typed, generated, inspected, and verified?
        </p>
        <p>
          TanStack Query is excellent at async reads and mutations. A common project page would use
          a query keyed by project id and a mutation that invalidates or updates related query keys.
        </p>
        <BlogCode code={blogTanstackExample} />
        <p>
          That handles the client cache well. Arc pushes the boundary outward: the cache entry,
          route data contract, server function contract, invalidation plan, SSR hydration payload,
          mock boundary, and diagnostic graph all connect through the same typed definitions.
        </p>

        <h2 id={blogHeadingId(5)}>What Arc replaces</h2>
        <p>
          Arc overlaps with state and data libraries, but the honest boundary matters. React state,
          Solid signals, refs, memos, and component props are still right for private UI details.
          Arc starts to earn its keep when state becomes durable app behavior.
        </p>
        <p>
          Zustand and Jotai are productive ways to share domain state, but stores and atoms are
          opaque to the framework unless you build conventions around them. Which route needs this
          value before render? Which server function is browser-safe? Which Resources or Collections
          should refresh after a mutation? Which mock should tests provide?
        </p>
        <BlogCode code={blogStoreExample} />
        <p>
          For durable app behavior - projects, sessions, local-first rows, pending writes, resource
          lifetimes, form submissions, permissioned server calls - Arc wants a typed Signal,
          Resource, Action, Form, Collection, Route, or Capability instead of an opaque global
          store.
        </p>
        <p>
          In practice, Arc replaces much of the glue where teams combine TanStack Query,
          Zustand/Jotai, typed fetch clients, form action plumbing, route preload, SSR hydration,
          optimistic queues, mocks, and custom diagnostics. It does not replace the renderer's local
          state model.
        </p>

        <h2 id={blogHeadingId(6)}>Built by an agent, verified in public</h2>
        <p>
          Arc was built by an agent working inside this model. That is not the headline value; it is
          a proof point for the framework itself. The repo includes generated route artifacts, graph
          diagnostics, public API manifests, type tests, package dry runs, leak scans, architecture
          docs, and release gates because the framework has to stay legible to the next agent that
          edits it.
        </p>
        <p>
          The ambition is not that agents should write code unchecked. It is the opposite: agentic
          development needs stronger structure than human-only development. Arc makes the structure
          public enough that humans, CI, devtools, and agents can all ask the same questions before
          a change ships.
        </p>

        <h2 id={blogHeadingId(7)}>What this alpha does not claim</h2>
        <p>
          Sunfall Arc is not pretending to be a finished ecosystem. Platform-specific packages for
          every host can wait until real deployments demand them. The first public alpha is about
          the core foundation: typed definitions, Effect runtimes, Start SSR and hydration, Solid
          and React adapters, local-first collections, app graph diagnostics, devtools contracts,
          starters, package gates, and docs that are themselves built with the framework.
        </p>
        <p>
          It also should not be read as a mature Next, Remix, or TanStack Start replacement for
          every team today. Those ecosystems have production miles, examples, integrations, and
          hosting stories Arc has not earned yet.
        </p>
        <p>
          The promise is narrower and sharper: correctness by construction for agent-operated
          full-stack TypeScript apps. Prevent drift where the framework can prove it. Explain drift
          where runtime behavior is the only honest source of truth.
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
