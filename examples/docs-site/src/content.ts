import { Capability, Resource } from "@sunfall/arc-core";
import type { Server } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import {
  RecipeSchema,
  RecipeSlug,
  RecipeSummarySchema,
  type Recipe,
  type RecipeContentError,
  type RecipeSlug as RecipeSlugType,
  type RecipeSummary,
} from "./content.contract.js";

export {
  RecipeCategory,
  RecipeContentErrorSchema,
  RecipeMarkdownParseError,
  RecipeFrontmatterDecodeError,
  RecipeNotFound,
  RecipeRouteParams,
  RecipeSchema,
  RecipeSlug,
  RecipeSummarySchema,
  makeRecipeSlug,
} from "./content.contract.js";

export type { Recipe, RecipeBlock, RecipeContentError, RecipeSummary } from "./content.contract.js";

export interface DocsContentApi {
  readonly listRecipes: () => Effect.Effect<
    RecipeSummary[],
    RecipeContentError | Server.ClientError
  >;
  readonly getRecipe: (
    slug: RecipeSlugType,
  ) => Effect.Effect<Recipe, RecipeContentError | Server.ClientError>;
}

export const DocsContentApi = Capability.define<DocsContentApi>(
  "@sunfall/arc-example-docs-site/DocsContentApi",
);

const staticContentUnavailable = (operation: string): Effect.Effect<never, never> =>
  Effect.die(
    new Error(
      `Docs static client cannot ${operation}. Static navigation must hydrate prerendered route data before Resource preload runs.`,
    ),
  );

export const DocsContentApiStaticClient = DocsContentApi.layer({
  listRecipes: () => staticContentUnavailable("load the recipe index"),
  getRecipe: (slug) => staticContentUnavailable(`load recipe ${slug}`),
});

export const RecipesTag = Resource.tag("Docs.recipes");
export const RecipeTag = Resource.tag<{ readonly slug: RecipeSlugType }>("Docs.recipe", {
  key: ({ slug }) => slug,
});

export const RecipeIndex = Resource.family({
  name: "Docs.recipes",
  input: Schema.Literal("all"),
  output: Schema.Array(RecipeSummarySchema),
  load: () => DocsContentApi.use((api) => api.listRecipes()),
  provides: () => [RecipesTag],
  policy: {
    staleFor: "1 minute",
    gcFor: "10 minutes",
  },
});

export const RecipeBySlug = Resource.family({
  name: "Docs.recipe",
  input: RecipeSlug,
  output: RecipeSchema,
  load: (slug) => DocsContentApi.use((api) => api.getRecipe(slug)),
  provides: (recipe) => [RecipeTag({ slug: recipe.slug })],
  policy: {
    staleFor: "1 minute",
    gcFor: "10 minutes",
  },
});

export const RecipeIndexRef = RecipeIndex("all");

export const preloadRecipeIndexEffect = Resource.prefetchEffect(RecipeIndexRef);

export const recipeInvalidations = (slug: RecipeSlugType): readonly Resource.Invalidation[] => [
  RecipesTag,
  RecipeTag({ slug }),
];
