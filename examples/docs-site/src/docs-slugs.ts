// Docs page slugs, importable without page content (the Vite config and file
// routes load this module before Vite plugins such as `?raw` imports run).
import { Schema } from "effect";

export const DocsPageSlug = Schema.Literals([
  "golden-path",
  "getting-started",
  "core-concepts",
  "reference",
  "deployment",
  "troubleshooting",
  "examples",
]);

export type DocsPageSlug = typeof DocsPageSlug.Type;

export const DocsRouteParams = Schema.Struct({
  slug: DocsPageSlug,
});

export type DocsRouteParams = typeof DocsRouteParams.Type;
