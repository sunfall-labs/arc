import { DocsContentApi } from "./content.js";
import { getRecipe, listRecipeSummaries } from "./content.contract.js";

export const DocsContentApiLive = DocsContentApi.layer({
  listRecipes: () => listRecipeSummaries.effect("all"),
  getRecipe: (slug) => getRecipe.effect({ slug }),
});
