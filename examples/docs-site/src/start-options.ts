import { readdirSync } from "node:fs";
import { normalizeDocsSiteBasePath } from "./base-path.js";
import { DocsPageSlug } from "./docs-slugs.js";

const docsSiteBasePath = normalizeDocsSiteBasePath(
  process.env.DOCS_SITE_BASE_PATH ?? process.env.VITE_DOCS_SITE_BASE_PATH ?? "/",
);
const recipeContentDirectory = new URL("./content/cookbook/", import.meta.url);
const docsSiteRecipePrerenderPages = readdirSync(recipeContentDirectory)
  .filter((fileName) => fileName.endsWith(".md"))
  .sort()
  .map((fileName) => `/cookbook/${fileName.replace(/\.md$/u, "")}`);

export const docsSitePrerenderPages = [
  ...DocsPageSlug.literals.map((slug) => `/docs/${slug}`),
  ...docsSiteRecipePrerenderPages,
];

export const docsSiteStartOptions = {
  serverEntry: "/src/server.tsx",
  fileRouteOptions: {
    routeDirectory: "src/routes",
  },
  fileRouteGeneration: {
    outputFile: "src/routeTree.gen.ts",
  },
  prerender: {
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
