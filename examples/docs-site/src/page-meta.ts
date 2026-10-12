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

export const docsPageMeta = (slug: DocsPageSlug): PageMeta => {
  const page = getDocsPage(slug);
  return page === undefined ? notFoundMeta : { title: page.title, description: page.summary };
};
