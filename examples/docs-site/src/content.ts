import { Resource } from "@sunfall/arc-core";
import { Schema } from "effect";

export const RecipeSlug = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  Schema.brand("RecipeSlug"),
);

export type RecipeSlug = typeof RecipeSlug.Type;

export const makeRecipeSlug = (slug: string): RecipeSlug =>
  Schema.decodeUnknownSync(RecipeSlug)(slug);

export const RecipeCategory = Schema.Literals(["resources", "routing", "actions", "testing"]);

export type RecipeCategory = typeof RecipeCategory.Type;

export const RecipeRouteParams = Schema.Struct({
  slug: RecipeSlug,
});

export type RecipeRouteParams = typeof RecipeRouteParams.Type;

export class RecipeNotFound extends Schema.TaggedError<RecipeNotFound>()("RecipeNotFound", {
  slug: RecipeSlug,
}) {}

export class RecipeFrontmatterDecodeError extends Schema.TaggedError<RecipeFrontmatterDecodeError>()(
  "RecipeFrontmatterDecodeError",
  {
    file: Schema.String,
    message: Schema.String,
  },
) {}

export class RecipeMarkdownParseError extends Schema.TaggedError<RecipeMarkdownParseError>()(
  "RecipeMarkdownParseError",
  {
    file: Schema.String,
    message: Schema.String,
  },
) {}

export type RecipeContentError =
  | RecipeNotFound
  | RecipeFrontmatterDecodeError
  | RecipeMarkdownParseError;

export const RecipeContentErrorSchema = Schema.Union([
  RecipeNotFound,
  RecipeFrontmatterDecodeError,
  RecipeMarkdownParseError,
]);

export const RecipeBlockSchema = Schema.TaggedUnion({
  Heading: {
    level: Schema.Number,
    text: Schema.String,
  },
  Paragraph: {
    text: Schema.String,
  },
  List: {
    items: Schema.Array(Schema.String),
  },
  Code: {
    language: Schema.String,
    code: Schema.String,
  },
});

export type RecipeBlock = typeof RecipeBlockSchema.Type;

export const RecipeSummarySchema = Schema.Struct({
  slug: RecipeSlug,
  title: Schema.String,
  category: RecipeCategory,
  summary: Schema.String,
  order: Schema.Number,
});

export type RecipeSummary = typeof RecipeSummarySchema.Type;

export const RecipeSchema = Schema.Struct({
  slug: RecipeSlug,
  title: Schema.String,
  category: RecipeCategory,
  summary: Schema.String,
  order: Schema.Number,
  related: Schema.Array(RecipeSlug),
  blocks: Schema.Array(RecipeBlockSchema),
});

export type Recipe = typeof RecipeSchema.Type;

/*
 * The cookbook's reads, as served Resources: declared here (browser-safe:
 * schemas, tags, policy) and loaded on the server by their implementations
 * in `content.server.ts`, which read the Markdown files. In dev the browser
 * loads them over RPC; the static production build reads only prerendered
 * data, and Start compiles the RPC client out of `App.launch`.
 */

export const RecipesTag = Resource.tag("Docs.recipes");
export const RecipeTag = Resource.tag<{ readonly slug: RecipeSlug }>("Docs.recipe", {
  key: ({ slug }) => slug,
});

export const RecipeIndex = Resource.define({
  name: "Docs.recipes",
  input: Schema.Literal("all"),
  output: Schema.Array(RecipeSummarySchema),
  error: RecipeContentErrorSchema,
  provides: () => [RecipesTag],
  policy: {
    staleFor: "1 minute",
    gcFor: "10 minutes",
  },
});

export const RecipeBySlug = Resource.define({
  name: "Docs.recipe",
  input: RecipeSlug,
  output: RecipeSchema,
  error: RecipeContentErrorSchema,
  provides: (recipe) => [RecipeTag({ slug: recipe.slug })],
  policy: {
    staleFor: "1 minute",
    gcFor: "10 minutes",
  },
});

export const RecipeIndexRef = RecipeIndex("all");

export const preloadRecipeIndexEffect = Resource.preload(RecipeIndexRef);

export const recipeInvalidations = (slug: RecipeSlug): readonly Resource.Invalidation[] => [
  RecipesTag,
  RecipeTag({ slug }),
];
