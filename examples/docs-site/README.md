# Sunfall Arc Docs Site

This example dogfoods Sunfall Arc as a cookbook/docs app. Recipes are content
data loaded through Start server functions, exposed through a `DocsContentApi`
capability, read by typed Resources, and declared by file-route preload.

Run it locally:

```sh
pnpm --filter @sunfall/arc-example-docs-site dev
```

Verify it:

```sh
pnpm --filter @sunfall/arc-example-docs-site verify
```

The example proves:

- browser-safe docs contracts and branded recipe slugs;
- server-only Markdown loading and frontmatter validation;
- `Resource.family(...)` based recipe index and recipe detail reads;
- route-owned Resource preload for the cookbook index and recipe pages;
- Start SSR, streamed hydration chunks, production prerender/static output, and
  a server-only leak scan.
