import { readdirSync } from "node:fs";
import type { ServerFunctionManifestSource } from "@sunfall/arc-start";
import { normalizeDocsSiteBasePath } from "./base-path.js";
import { getRecipe, listRecipeSummaries } from "./content.contract.js";
import { getRecipeServer, listRecipeSummariesServer } from "./content.server.js";
import { docsPages } from "./docs-content.js";

const docsSiteBasePath = normalizeDocsSiteBasePath(
  process.env.DOCS_SITE_BASE_PATH ?? process.env.VITE_DOCS_SITE_BASE_PATH ?? "/",
);
const recipeContentDirectory = new URL("./content/cookbook/", import.meta.url);
const docsSiteRecipePrerenderPages = readdirSync(recipeContentDirectory)
  .filter((fileName) => fileName.endsWith(".md"))
  .sort()
  .map((fileName) => `/cookbook/${fileName.replace(/\.md$/u, "")}`);

export const docsSitePrerenderPages = [
  ...docsPages.map((page) => `/docs/${page.slug}`),
  ...docsSiteRecipePrerenderPages,
];

export const docsSiteServerFunctionSources = [
  {
    fn: listRecipeSummariesServer,
    module: "/src/content.server.ts",
    exportName: "listRecipeSummariesServer",
    clientModule: "/src/content.contract.ts",
    clientExportName: "listRecipeSummaries",
  },
  {
    fn: getRecipeServer,
    module: "/src/content.server.ts",
    exportName: "getRecipeServer",
    clientModule: "/src/content.contract.ts",
    clientExportName: "getRecipe",
  },
] as const satisfies readonly ServerFunctionManifestSource[];

export const docsSiteServerRegistry = {
  actions: [],
  serverFunctions: docsSiteServerFunctionSources.map((source) => source.fn),
} as const;

export const docsSiteStartOptions = {
  serverEntry: "/src/server.tsx",
  serverFunctionSources: docsSiteServerFunctionSources,
  actionSources: [],
  fileRouteOptions: {
    routeDirectory: "src/routes",
  },
  fileRouteGeneration: {
    outputFile: "src/routeTree.gen.ts",
  },
  prerender: {
    enabled: true,
    autoSubfolderIndex: true,
    autoStaticPathsDiscovery: true,
    crawlLinks: docsSiteBasePath === "/",
    pages: docsSitePrerenderPages,
    failOnError: true,
  },
  buildPolicy: {
    staticClient: {
      target: "static",
      forbidBrowserRpc: true,
    },
    diagnostics: {
      routePreloadResources: {
        requireDeclaredForPreload: true,
      },
      routePreloadCollections: {
        requireDeclaredForPreload: true,
      },
    },
  },
} as const;

void getRecipe;
void listRecipeSummaries;
