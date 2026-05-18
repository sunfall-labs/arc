# Sunfall Arc Docs Site

This example uses Sunfall Arc as a cookbook/docs app. Recipes are content data
loaded through Start server functions, exposed through a `DocsContentApi`
Capability, read by typed Resources, and declared by file-route preload.

Run it locally:

```sh
pnpm --filter @sunfall/arc-example-docs-site dev
```

Verify it:

```sh
pnpm --filter @sunfall/arc-example-docs-site verify
```

Build it the same way GitHub Pages does:

```sh
pnpm build
DOCS_SITE_BASE_PATH="/<repository-name>/" pnpm --filter @sunfall/arc-example-docs-site build
DOCS_SITE_BASE_PATH="/<repository-name>/" pnpm --filter @sunfall/arc-example-docs-site pages:verify
DOCS_SITE_BASE_PATH="/<repository-name>/" pnpm --filter @sunfall/arc-example-docs-site pages:smoke
```

The Pages workflow derives `DOCS_SITE_BASE_PATH` from the repository name,
uploads `dist` as the artifact, keeps `.nojekyll` in the build, and smoke-tests
the artifact through a local project-site path before deployment.

The example proves:

- browser-safe docs contracts and branded recipe slugs;
- server-only Markdown loading and frontmatter validation;
- `Resource.family(...)` based recipe index and recipe detail reads;
- route-owned Resource preload for the cookbook index and recipe pages;
- Start SSR, streamed hydration chunks, production prerender/static output, and
  a server-only leak scan.
