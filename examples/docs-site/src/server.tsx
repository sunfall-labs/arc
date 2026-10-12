import { createRequestHandler, type StartDocumentContext } from "@sunfall/arc-start";
import { app } from "./app-definition.js";
import { implementations } from "./content.server.js";
import {
  blogPostMeta,
  cookbookMeta,
  docsOverviewMeta,
  docsPageMeta,
  documentTitle,
  homeMeta,
  notFoundMeta,
  siteName,
  type PageMeta,
} from "./page-meta.js";
import type { routes } from "./routeTree.gen.js";
import {
  BlogPostRoute,
  CookbookRoute,
  DocsOverviewRoute,
  DocsPageRoute,
  HomeRoute,
  RecipeRoute,
} from "./site-routes.js";
import "./styles.css";

// Recipe titles and summaries for the head, read from the same Markdown
// frontmatter the recipe Resource decodes.
const recipeSources = import.meta.glob<string>("./content/cookbook/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const frontmatterField = (source: string, field: string): string | undefined =>
  new RegExp(`"${field}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "u").exec(source)?.[1];

const recipeMeta = (slug: string): PageMeta => {
  const source = recipeSources[`./content/cookbook/${slug}.md`];
  const title = source === undefined ? undefined : frontmatterField(source, "title");
  const description = source === undefined ? undefined : frontmatterField(source, "summary");
  return title === undefined || description === undefined ? notFoundMeta : { title, description };
};

const pageMeta = (match: StartDocumentContext<typeof routes>["match"]): PageMeta => {
  switch (match?.route.path) {
    case HomeRoute.path:
      return homeMeta;
    case DocsOverviewRoute.path:
      return docsOverviewMeta;
    case DocsPageRoute.path:
      return docsPageMeta(
        (match.params as { readonly slug: Parameters<typeof docsPageMeta>[0] }).slug,
      );
    case CookbookRoute.path:
      return cookbookMeta;
    case RecipeRoute.path:
      return recipeMeta(String((match.params as { readonly slug: string }).slug));
    case BlogPostRoute.path:
      return blogPostMeta;
    default:
      return notFoundMeta;
  }
};

export const handleRequest = createRequestHandler(app, {
  implementations,
  document: ({ match }) => {
    const meta = pageMeta(match);
    const title = documentTitle(meta === homeMeta ? undefined : meta.title);
    return {
      title,
      meta: [
        { name: "description", content: meta.description },
        { name: "color-scheme", content: "light dark" },
        { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
        { name: "theme-color", content: "#0c0a09", media: "(prefers-color-scheme: dark)" },
        { property: "og:site_name", content: siteName },
        { property: "og:title", content: title },
        { property: "og:description", content: meta.description },
        {
          property: "og:type",
          content: match?.route.path === BlogPostRoute.path ? "article" : "website",
        },
        { name: "twitter:card", content: "summary" },
      ],
      links: [
        { rel: "stylesheet", href: "/src/styles.css", "data-sunfall-arc-docs-dev-style": "" },
      ],
      headers: { "x-sunfall-arc-docs": "cookbook" },
    };
  },
});

export default handleRequest;
