import { Route, RouterOutlet, RouterProvider, useResource } from "@effect-ui/solid";
import type { EffectUiRuntime } from "@effect-ui/core";
import { CookbookRoute, HomeRoute, RecipeRoute, app } from "./app-definition.js";
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
const CookbookUiRoute = Route.withComponent(CookbookRoute, CookbookIndexView);
const RecipeUiRoute = Route.withComponent(RecipeRoute, RecipeRouteView);
const routes = [HomeUiRoute, CookbookUiRoute, RecipeUiRoute] as const;
type DocsSiteRuntime<RuntimeServices = DocsContentApi> = [DocsContentApi] extends [RuntimeServices]
  ? EffectUiRuntime<RuntimeServices, never>
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
  const runtime = (props.runtime ?? app.runtime) as EffectUiRuntime<
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
            <strong>Effect UI</strong>
            <small>Cookbook</small>
          </span>
        </a>
        <RecipeNav />
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
        <h1>Cookbook recipes backed by Effect UI Resources.</h1>
        <p>
          This docs site is itself a Start app: content is loaded through server functions, exposed
          through a Capability, preloaded by file routes, and hydrated before the UI mounts.
        </p>
        <a href={Route.href(CookbookUiRoute)} class="primaryLink">
          Browse cookbook
        </a>
      </header>

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
        <h1>Idiomatic Effect UI examples</h1>
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
