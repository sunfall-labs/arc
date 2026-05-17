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

function BlogPostView() {
  return (
    <article class="blogPost">
      <header class="pageHeader">
        <p class="eyebrow">Introducing Sunfall Arc</p>
        <h1>Full-stack TypeScript should be easier to reason about.</h1>
        <p>
          Sunfall Arc is an experimental framework for teams who want the ergonomics of a modern app
          stack without losing the ability to see what the app is doing.
        </p>
      </header>

      <section class="recipeBody">
        <p>
          Most full-stack apps begin cleanly. A route loads data, a form mutates it, a component
          renders it, and a server endpoint keeps the sensitive work on the server. Then the app
          grows. Cache keys spread through components. Promise boundaries multiply. Server contracts
          drift from clients. Tests know one version of the app graph, production knows another, and
          diagnostics arrive only after something has already gone sideways.
        </p>
        <p>
          Sunfall Arc is built around a different bet: the framework should preserve the shape of
          the application as typed, inspectable facts. Routes, Resources, Actions, server functions,
          Collections, and Capabilities are not just runtime helpers. They are the vocabulary the
          app uses to explain itself.
        </p>

        <h2>The value is composure</h2>
        <p>
          Arc makes async work explicit without making product code feel ceremonial. Public async
          APIs return Effect values, so failures, dependencies, cancellation, request-local runtime
          state, and cleanup stay part of the program instead of becoming side effects hidden behind
          a Promise chain.
        </p>
        <p>
          That matters when an app crosses boundaries. The same Resource can be preloaded by a
          route, read by a UI adapter, serialized into streamed hydration, invalidated by an Action,
          and inspected by devtools without each layer inventing a private story about it.
        </p>

        <h2>The app graph becomes useful</h2>
        <p>
          Start can emit a deterministic graph of routes, resources, actions, collections, modules,
          and diagnostics. That graph is useful to humans reading a codebase, CI jobs enforcing
          architecture rules, and agents trying to make focused edits without guessing how files fit
          together.
        </p>
        <p>
          Instead of treating diagnostics as an afterthought, Arc tries to make them a native output
          of the framework. The goal is not only to render HTML; it is to explain why the rendered
          app has the shape it has.
        </p>

        <h2>Local-first data gets a framework seam</h2>
        <p>
          Arc Collections give local data the same level of structure as route data. Live queries,
          persistence, optimistic mutation queues, flush policy, and sync adapter boundaries are
          modeled as framework concepts rather than ad hoc stores that every feature has to
          rediscover.
        </p>
        <p>
          That gives product code a quieter job. Components read rows, Actions describe intent, and
          the runtime owns the mechanics of materialization, invalidation, and durable state.
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
