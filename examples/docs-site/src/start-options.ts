import type { ServerFunctionManifestSource } from "@effect-ui/start";
import { getRecipe, listRecipeSummaries } from "./content.contract.js";
import { getRecipeServer, listRecipeSummariesServer } from "./content.server.js";

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
  buildPolicy: {
    diagnostics: {
      routePreloadResources: {
        requireDeclaredForPreload: true,
      },
    },
  },
} as const;

void getRecipe;
void listRecipeSummaries;
