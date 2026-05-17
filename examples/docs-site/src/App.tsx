import { Route, RouterOutlet, RouterProvider, useResource } from "@sunfall/arc-solid";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import { BlogPostRoute, CookbookRoute, HomeRoute, RecipeRoute, app } from "./app-definition.js";
import {
  RecipeBySlug,
  RecipeIndexRef,
  type DocsContentApi,
  type Recipe,
  type RecipeBlock,
  type RecipeSummary,
} from "./content.js";
import type { RecipeCategory, RecipeSlug } from "./content.contract.js";
import "./styles.css";

const HomeUiRoute = Route.withComponent(HomeRoute, HomeView);
const BlogPostUiRoute = Route.withComponent(BlogPostRoute, BlogPostView);
const CookbookUiRoute = Route.withComponent(CookbookRoute, CookbookIndexView);
const RecipeUiRoute = Route.withComponent(RecipeRoute, RecipeRouteView);
const routes = [HomeUiRoute, BlogPostUiRoute, CookbookUiRoute, RecipeUiRoute] as const;
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
          <span class="brandMark">E</span>
          <span>
            <strong>Sunfall Arc</strong>
            <small>Cookbook</small>
          </span>
        </a>
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

function RecipeNav() {
  const recipes = useResource(RecipeIndexRef);

  return (
    <nav class="recipeNav" aria-label="Cookbook recipes">
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
      </header>

      <section class="featureCallout" aria-label="Introduction">
        <p class="eyebrow">From the blog</p>
        <h2>Why Sunfall Arc exists</h2>
        <p>
          The first public alpha is about making full-stack TypeScript feel inspectable: data
          loading, mutations, routing, server boundaries, and local state all become typed framework
          facts instead of scattered conventions.
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

const blogActionExample = `export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: ProjectSchema,
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});`;

const blogGraphExample = `sunfall-arc-start graph route /projects/:id
sunfall-arc-start impact action Project.rename --json`;

function BlogCode(props: { readonly code: string }) {
  return (
    <pre class="codeBlock">
      <code>{props.code}</code>
    </pre>
  );
}

function BlogPostView() {
  return (
    <article class="blogPost">
      <header class="pageHeader">
        <p class="eyebrow">Introducing Sunfall Arc</p>
        <h1>One typed graph for your full-stack TypeScript app.</h1>
        <p>
          Sunfall Arc is an experimental framework for teams who want modern app ergonomics without
          losing the ability to see what the app is doing. The core value is not another cache, not
          another router, and not another local store. It is one shared vocabulary for the important
          facts in your application.
        </p>
      </header>

      <section class="recipeBody">
        <p>
          Most full-stack apps begin with a clean story. A route loads data, a form mutates it, a
          component renders it, and a server endpoint protects the sensitive work. Then the app
          grows. Cache keys spread through components. Promise boundaries hide dependencies and
          failure modes. Server contracts drift from clients. Local stores grow their own
          invalidation rules. Tests know one version of the app, production knows another, and
          diagnostics arrive only after something has already gone sideways.
        </p>
        <p>
          Sunfall Arc is built around a different bet: framework behavior should be preserved as
          typed, inspectable facts. Routes, Resources, Actions, server functions, Collections, and
          Capabilities are not just runtime helpers. They are the nouns the app uses to explain
          itself to the renderer, the server, tests, devtools, CI, and agents.
        </p>

        <h2>The unique value prop</h2>
        <p>
          Arc turns the full-stack app into a typed graph that can execute, hydrate, invalidate, and
          explain itself. That graph has a few core concepts:
        </p>
        <ul>
          <li>Resources are named, schema-checked units of async data.</li>
          <li>Actions are named mutations with typed input, output, and invalidation.</li>
          <li>Capabilities are dependency seams for live services, server calls, and tests.</li>
          <li>File routes declare the Resources they own before render.</li>
          <li>
            Collections model local-first data, persistence, optimistic queues, and live queries.
          </li>
          <li>Start emits deterministic route, resource, action, collection, and module facts.</li>
        </ul>
        <p>
          The result is composure. The same Resource can be preloaded by a route, read by a UI
          adapter, serialized into streamed hydration, invalidated by an Action, mocked through a
          Capability, and inspected by devtools without each layer inventing a private story about
          it.
        </p>

        <h2>A guided slice: route, resource, and UI</h2>
        <p>
          Start with the browser-safe contract. The client can import the schema and typed handle;
          the handler stays in a server-only module.
        </p>
        <BlogCode code={blogContractExample} />

        <p>
          Expose that contract through a Capability, then define a Resource around the domain fact
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

        <h2>Mutations stay attached to meaning</h2>
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

        <h2>The graph becomes a release artifact</h2>
        <p>
          Because routes, Resources, Actions, server functions, Collections, and modules are named
          facts, Start can emit a deterministic graph. Humans can read it, CI can enforce it, and
          agents can use it to make focused edits without guessing how files fit together.
        </p>
        <BlogCode code={blogGraphExample} />
        <p>
          This is the part that makes Arc unusual. The framework is not only trying to render HTML
          or give components nice hooks. It is trying to make the shape of the app available as a
          public, typed artifact before something breaks.
        </p>

        <h2>Local-first data gets the same treatment</h2>
        <p>
          Collections extend the same idea to local data. Live queries, persistence, optimistic row
          mutations, flush policy, and sync adapter boundaries are framework concepts rather than
          stores every feature has to reinvent.
        </p>
        <p>
          Components read rows, Actions describe intent, and the runtime owns materialization,
          invalidation, durable state, and sync edges. The product code gets quieter because the
          framework has more of the domain graph in view.
        </p>

        <h2>This alpha is intentionally honest</h2>
        <p>
          Sunfall Arc is not pretending to be a finished ecosystem. Platform-specific packages for
          every host can wait until real deployments demand them. The first public alpha is about
          the core spine: typed resources and actions, Start SSR and hydration, Solid and React
          adapters, local-first collections, devtools contracts, starters, package gates, and docs
          that are themselves built with the framework.
        </p>
        <p>
          The promise is simple: fewer invisible seams, more typed boundaries, and a framework that
          can tell you what it knows.
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
  return (
    <article class="recipeDetail" classList={{ refreshing: props.refreshing }}>
      <header class="pageHeader">
        <p class="eyebrow">{categoryLabel(props.recipe.category)}</p>
        <h1>{props.recipe.title}</h1>
        <p>{props.recipe.summary}</p>
      </header>

      <section class="recipeBody">
        {props.recipe.blocks.map((block) => (
          <RecipeBlockView block={block} />
        ))}
      </section>

      <RelatedRecipes recipe={props.recipe} />
    </article>
  );
}

function RecipeBlockView(props: { readonly block: RecipeBlock }) {
  switch (props.block._tag) {
    case "Heading":
      return props.block.level <= 1 ? <h2>{props.block.text}</h2> : <h3>{props.block.text}</h3>;
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
      return (
        <pre class="codeBlock">
          <code>{props.block.code}</code>
        </pre>
      );
  }
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
