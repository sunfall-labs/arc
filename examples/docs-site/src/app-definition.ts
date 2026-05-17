import { defineApp, type AppDefinitionRegistryInput } from "@sunfall/arc-core";
import { DocsContentApiLive } from "./content.js";
import { routeById, routeTree } from "./routeTree.gen.js";

export const HomeRoute = routeById.route_root;
export const DocsOverviewRoute = routeById.route_docs;
export const DocsPageRoute = routeById.route_docs_$slug;
export const BlogPostRoute = routeById.route_blog_introducing_sunfall_arc;
export const CookbookRoute = routeById.route_cookbook;
export const RecipeRoute = routeById.route_cookbook_$slug;

export const docsSiteAppBaseOptions = {
  routes: routeTree,
  client: { name: "BrowserLive" },
  server: DocsContentApiLive,
} as const;

export const docsSiteEmptyRegistry = {
  actions: [],
  serverFunctions: [],
} as const;

export const createDocsSiteApp = <const RegistryInput extends AppDefinitionRegistryInput>(
  registry: RegistryInput,
) =>
  defineApp({
    ...docsSiteAppBaseOptions,
    registry,
  });

export const app = createDocsSiteApp(docsSiteEmptyRegistry);
