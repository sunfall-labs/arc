import { Server } from "@sunfall/arc-core";
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

export class RecipeNotFound extends Schema.TaggedErrorClass<RecipeNotFound>()("RecipeNotFound", {
  slug: RecipeSlug,
}) {}

export class RecipeFrontmatterDecodeError extends Schema.TaggedErrorClass<RecipeFrontmatterDecodeError>()(
  "RecipeFrontmatterDecodeError",
  {
    file: Schema.String,
    message: Schema.String,
  },
) {}

export class RecipeMarkdownParseError extends Schema.TaggedErrorClass<RecipeMarkdownParseError>()(
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

export const ListRecipeSummariesContract = Server.contract<
  "all",
  RecipeSummary[],
  RecipeContentError
>("Docs.recipes.list", {
  input: Schema.Literal("all"),
  output: Schema.Array(RecipeSummarySchema),
  error: RecipeContentErrorSchema,
});

export const GetRecipeContract = Server.contract<
  { readonly slug: RecipeSlug },
  Recipe,
  RecipeContentError
>("Docs.recipe.get", {
  input: Schema.Struct({ slug: RecipeSlug }),
  output: RecipeSchema,
  error: RecipeContentErrorSchema,
});

export const listRecipeSummaries = Server.client(ListRecipeSummariesContract);
export const getRecipe = Server.client(GetRecipeContract);
