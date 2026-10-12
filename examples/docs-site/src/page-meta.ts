import type { Route } from "@sunfall/arc-core";
import { getDocsPage, type DocsPageSlug } from "./docs-content.js";

export const siteName = "Sunfall Arc";

export const sitePitch =
  "A full-stack TypeScript framework on Effect and Solid where errors, services, and every state change are typed and named.";

export interface PageMeta {
  readonly title: string;
  readonly description: string;
}

/** `<title>` text: the page's title, then the site name. The homepage leads with the pitch. */
export const documentTitle = (title: string | undefined): string =>
  title === undefined
    ? `${siteName}: full-stack TypeScript, correct by construction`
    : title.includes(siteName)
      ? title
      : `${title} · ${siteName}`;

export const homeMeta: PageMeta = { title: siteName, description: sitePitch };

export const docsOverviewMeta: PageMeta = {
  title: "Documentation",
  description:
    "Learn Arc: the golden path, core concepts, deployment, troubleshooting, and package reference.",
};

export const cookbookMeta: PageMeta = {
  title: "Cookbook",
  description:
    "Small, checked Arc recipes: served Resources, route preload, progressive forms, semantic invalidation, and server mocks.",
};

export const blogPostMeta: PageMeta = {
  title: "Introducing Sunfall Arc",
  description:
    "Why Arc exists: full-stack TypeScript where failures, services, and every state change are part of the type, on Effect and Solid.",
};

export const notFoundMeta: PageMeta = {
  title: "Page not found",
  description: "This page does not exist.",
};

export const failureMeta: PageMeta = {
  title: "Could not load this page",
  description: "A docs Resource failed to load.",
};

export const docsPageMeta = (slug: DocsPageSlug): PageMeta => {
  const page = getDocsPage(slug);
  return page === undefined ? notFoundMeta : { title: page.title, description: page.summary };
};

/** Strips inline Markdown for plain-text uses such as `<title>`. */
export const plainText = (text: string): string =>
  text.replace(/\u0060([^\u0060]+)\u0060/gu, "$1").replace(/\*\*([^*]+)\*\*/gu, "$1");

/** A route head from a page's title and description. */
export const pageHead = (meta: PageMeta): Route.Head => ({
  title: meta.title,
  description: meta.description,
});

/**
 * Every page's head (`App.define({ head })`): the route's title with the site
 * name (the homepage leads with the pitch), its description, and the Open
 * Graph and theme tags every page carries. A route's own `meta` (the blog
 * post's `og:type`) wins over the defaults.
 */
export const docsSiteHead = (page: Route.Head, status: Route.HeadStatus): Route.Head => {
  const meta =
    status === "NotFound"
      ? notFoundMeta
      : status === "Failure"
        ? failureMeta
        : { title: page.title, description: page.description ?? sitePitch };
  const title = documentTitle(meta.title === undefined ? undefined : plainText(meta.title));
  const own = page.meta ?? [];
  const ogType = own.find((tag) => tag.property === "og:type")?.content ?? "website";
  return {
    title,
    description: meta.description,
    meta: [
      { name: "color-scheme", content: "light dark" },
      { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#0c0a09", media: "(prefers-color-scheme: dark)" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: title },
      { property: "og:description", content: meta.description },
      { property: "og:type", content: ogType },
      { name: "twitter:card", content: "summary" },
    ],
  };
};
