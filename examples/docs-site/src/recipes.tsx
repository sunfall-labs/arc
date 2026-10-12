import { Route } from "@sunfall/arc-core";
import { Component, RouterLink } from "@sunfall/arc-solid";
import { Loading, Show, createMemo } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  RecipeBySlug,
  RecipeIndex,
  type Recipe,
  type RecipeBlock,
  type RecipeSummary,
} from "./content.js";
import type { RecipeCategory } from "./content.contract.js";
import {
  PageRail,
  createPageRailItems,
  pageRailIdsByBlockIndex,
  type HeadingSource,
  type PageRailItem,
} from "./page-rail.js";
import { RecipeRoute } from "./site-routes.js";
import { FailureView, LoadingView } from "./status-views.js";
import { AnchoredHeading, ArrowIcon, CodeBlock, DocumentTitle, InlineText } from "./ui.js";

export const categoryLabel = (category: RecipeCategory): string => {
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

const recipePageRailItems = (blocks: ReadonlyArray<RecipeBlock>): readonly PageRailItem[] =>
  createPageRailItems(
    blocks.flatMap((block, blockIndex): readonly HeadingSource[] =>
      block._tag === "Heading"
        ? [{ blockIndex, level: block.level <= 2 ? 2 : 3, text: block.text }]
        : [],
    ),
  );

/** The recipe links in the sidebar: suspends until loaded and fails quietly. */
export const RecipeNavList = Component.define(
  "RecipeNavList",
  function* (props: { readonly activeSlug: string | undefined }) {
    const recipes = yield* Component.resource(RecipeIndex);
    return () => (
      <ul class="navList">
        {recipes("all").map((recipe) => (
          <li>
            <RouterLink
              route={RecipeRoute}
              options={{ params: { slug: recipe.slug } }}
              class="navLink"
              aria-current={props.activeSlug === recipe.slug ? "page" : undefined}
            >
              {recipe.title}
            </RouterLink>
          </li>
        ))}
      </ul>
    );
  },
).pipe(
  Component.catchAll(() => <p class="navNote">Recipes unavailable</p>),
  Component.loading(() => <p class="navNote">Loading recipes</p>),
);

/** A recipe grid over the shared recipe index Resource. */
export const RecipeIndexGrid = Component.define(
  "RecipeIndexGrid",
  function* (props: { readonly limit?: number }) {
    const recipes = yield* Component.resource(RecipeIndex);
    return () => <RecipeGrid recipes={recipes("all").slice(0, props.limit)} />;
  },
).pipe(
  Component.catchAll((error) => <FailureView error={error} />),
  Component.loading(() => <RecipeGridSkeleton />),
);

function RecipeGrid(props: { readonly recipes: ReadonlyArray<RecipeSummary> }) {
  return (
    <ul class="cardGrid" aria-label="Recipes">
      {props.recipes.map((recipe) => (
        <li>
          <RouterLink route={RecipeRoute} options={{ params: { slug: recipe.slug } }} class="card">
            <span class="cardMeta">{categoryLabel(recipe.category)}</span>
            <span class="cardTitle">{recipe.title}</span>
            <span class="cardBody">{recipe.summary}</span>
            <span class="cardCta">
              Open recipe
              <ArrowIcon />
            </span>
          </RouterLink>
        </li>
      ))}
    </ul>
  );
}

function RecipeGridSkeleton() {
  return (
    <ul class="cardGrid" aria-label="Loading recipes">
      <li class="card skeleton" />
      <li class="card skeleton" />
      <li class="card skeleton" />
    </ul>
  );
}

/**
 * The recipe route. Content renders only from the reader: the first load
 * suspends the `<Loading>` (route preload and hydration make it synchronous),
 * and refreshes keep the article mounted while `waiting` drives the chrome.
 */
export const RecipeRouteView = Component.define(
  "RecipeRouteView",
  function* (props: Route.Props<typeof RecipeRoute>) {
    const recipe = yield* Component.resource(RecipeBySlug);
    const Related = yield* RelatedRecipes;
    const slug = () => props.params.slug;
    return () => (
      <Loading fallback={<LoadingView />}>
        <RecipeDetail recipe={recipe(slug())} refreshing={recipe.waiting(slug())}>
          <Related recipe={recipe(slug())} />
        </RecipeDetail>
      </Loading>
    );
  },
).pipe(Component.catchAll((error) => <FailureView error={error} />));

function RecipeDetail(props: {
  readonly recipe: Recipe;
  readonly refreshing: boolean;
  readonly children?: JSX.Element;
}) {
  const railItems = createMemo(() => recipePageRailItems(props.recipe.blocks));
  const headingIds = createMemo(() => pageRailIdsByBlockIndex(railItems()));

  return (
    <article class={["docPage", { refreshing: props.refreshing }]}>
      <DocumentTitle title={props.recipe.title} />
      <div class="docColumn">
        <header class="pageHeader">
          <p class="eyebrow">Cookbook · {categoryLabel(props.recipe.category)}</p>
          <h1>{props.recipe.title}</h1>
          <p class="pageLede">{props.recipe.summary}</p>
        </header>

        <div class="prose">
          {props.recipe.blocks.map((block, blockIndex) => (
            <RecipeBlockView block={block} headingId={headingIds().get(blockIndex)} />
          ))}
        </div>

        {props.children}
      </div>

      <PageRail items={railItems()} />
    </article>
  );
}

function RecipeBlockView(props: {
  readonly block: RecipeBlock;
  readonly headingId: string | undefined;
}) {
  // The block is a reactive projection: switch inside JSX so the read is tracked.
  return <>{renderRecipeBlock(props.block, props.headingId)}</>;
}

const renderRecipeBlock = (block: RecipeBlock, headingId: string | undefined) => {
  switch (block._tag) {
    case "Heading":
      return <AnchoredHeading level={block.level <= 2 ? 2 : 3} id={headingId} text={block.text} />;
    case "Paragraph":
      return (
        <p>
          <InlineText text={block.text} />
        </p>
      );
    case "List":
      return (
        <ul>
          {block.items.map((item) => (
            <li>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
    case "Code":
      return <CodeBlock code={block.code} language={block.language} />;
  }
};

/** Related recipes read the shared index; while it loads or if it fails, nothing shows. */
const RelatedRecipes = Component.define(
  "RelatedRecipes",
  function* (props: { readonly recipe: Recipe }) {
    const recipes = yield* Component.resource(RecipeIndex);
    return () => (
      <Show when={props.recipe.related.length > 0}>
        <RelatedRecipeList recipe={props.recipe} recipes={recipes("all")} />
      </Show>
    );
  },
).pipe(
  Component.catchAll(() => undefined),
  Component.loading(() => undefined),
);

function RelatedRecipeList(props: {
  readonly recipe: Recipe;
  readonly recipes: ReadonlyArray<RecipeSummary>;
}) {
  const related = () =>
    props.recipes.filter((recipe) => props.recipe.related.includes(recipe.slug));

  return (
    <Show when={related().length > 0}>
      <nav class="pageFooterNav" aria-label="Related recipes">
        <h2 class="pageFooterTitle">Related recipes</h2>
        <ul class="pagerGrid">
          {related().map((recipe) => (
            <li>
              <RouterLink
                route={RecipeRoute}
                options={{ params: { slug: recipe.slug } }}
                class="pagerLink"
              >
                <span class="pagerLabel">{categoryLabel(recipe.category)}</span>
                <span class="pagerTitle">{recipe.title}</span>
              </RouterLink>
            </li>
          ))}
        </ul>
      </nav>
    </Show>
  );
}
