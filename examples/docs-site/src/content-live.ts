import { Layer } from "effect";
import { DocsContentApi } from "./content.js";
import { getRecipe, listRecipeSummaries } from "./content.contract.js";

export const DocsContentApiLive = Layer.succeed(DocsContentApi, {
  listRecipes: () => listRecipeSummaries.effect("all"),
  getRecipe: (slug) => getRecipe.effect({ slug }),
});
