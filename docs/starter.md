# Starters

Use the smallest starter that proves the path you need:

| Starter                                                   | Use it when                                                                        | Run                      | Verify                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| [`examples/basic-starter`](../examples/basic-starter)     | You want the smallest copyable full-stack app shell.                               | `pnpm starter:dev`       | `pnpm starter:verify`                                       |
| [`examples/react-starter`](../examples/react-starter)     | You want the checked React, Tailwind v4, Base UI, and shadcn-compatible path.      | `pnpm react-starter:dev` | `pnpm react-starter:verify`                                 |
| [`examples/project-console`](../examples/project-console) | You want the golden path with actions, forms, collections, mocks, and diagnostics. | `pnpm example:dev`       | `pnpm --filter @sunfall/arc-example-project-console verify` |
| [`examples/docs-site`](../examples/docs-site)             | You want the cookbook/docs-site dogfood path.                                      | `pnpm docs-site:dev`     | `pnpm docs-site:verify`                                     |

The source examples are workspace packages for framework development.
`pnpm starter:package` writes standalone copies of the basic, React, and
project-console starters under `.test-dist/starters/*`.

The smallest checked starter lives at
[`examples/basic-starter`](../examples/basic-starter). It is the minimal
checked full-stack path: SSR, hydration, route preload, and leak scan.

Run it locally:

```sh
pnpm starter:dev
```

Verify it:

```sh
pnpm starter:verify
```

The basic starter includes:

- one file route generated into `src/routeTree.gen.ts`;
- one route-owned Resource preload declared in route metadata;
- Start SSR through `createRequestHandler`;
- browser hydration through the synchronous `hydrateFromDocument` host facade,
  which runs `hydrateFromDocumentEffect(...)` before the UI mounts;
- a production leak scan for `starter.server` sentinels.

The React starter lives at
[`examples/react-starter`](../examples/react-starter). It keeps the same checked
Start path while swapping the UI adapter to React and using a shadcn-compatible
Vite/Tailwind project shape with a checked Base UI primitive example.

Run it locally:

```sh
pnpm react-starter:dev
```

Verify it:

```sh
pnpm react-starter:verify
```

Use the project console when you need the larger golden path with forms,
actions, local-first collections, mocks, and diagnostics. Use the basic starter
when you need the smallest copyable app shell, and use the React starter when
you need the shadcn/Base UI ecosystem path.

The docs site example lives at
[`examples/docs-site`](../examples/docs-site). It dogfoods the framework as a
cookbook: Markdown recipes are loaded through Start server functions, exposed
through a `DocsContentApi` Capability, read through typed Resources, declared by
file-route preload, SSR-rendered, and hydrated before the UI mounts.

Run it locally:

```sh
pnpm docs-site:dev
```

Verify it:

```sh
pnpm docs-site:verify
```

See [Solid and React adapters](adapter-differences.md) for the renderer-level
API differences.

Package the copyable starter suite when you want standalone payloads outside the
workspace:

```sh
pnpm starter:package
```

That command writes `.test-dist/starters/basic`, `.test-dist/starters/react`,
and `.test-dist/starters/project-console` from their example sources. The
Starter Catalog Manifest in `scripts/starter-catalog.mjs` is the source of
truth for starter ids, source package names, generated package names, generated
Vite/TypeScript/README content, and generated route/virtual artifact lists. Each
generated starter rewrites workspace protocol dependencies to local
`.sunfall-arc-packages/*` file dependencies, removes monorepo Vite aliases, writes
a standalone `tsconfig.json`, verifies the app file manifest against the
copyable source manifest, installs outside the workspace, runs the generated
starter's own `verify` script, rejects generated route/virtual artifact content drift,
removes generated install/build/test artifacts, and rechecks the manifest after
verification. Each generated app also carries a starter-local `.gitignore` for
`node_modules`, `dist`, `.test-dist`, build info, and macOS metadata.
The generated artifact drift check covers `src/routeTree.gen.ts` and
`src/sunfall-arc-start-virtual.d.ts` for every generated starter, plus
`src/virtual-manifest-types.ts` for the project-console starter, so route,
virtual-module, and manifest editor contracts stay source-attributed.
The generated package manifests include `.sunfall-arc-packages`, and the packager
dry-runs each generated starter tarball to prove those local file-package
Adapters are actually included while the non-local tarball app files exactly
match the post-verify generated app file manifest.

Verify package payloads for source examples and starter packages:

```sh
pnpm example:pack-dry-run
```

That gate checks all 11 framework packages plus the basic starter, React
starter, project console, devtools panel, and devtools extension. Framework
packages must contain only `package.json` and `dist/*`; source packages must
contain their required source/config entrypoints, including app, server, route,
virtual-module, leak-scan, panel, extension, and Vite/TypeScript config files
where applicable, local `.gitignore` coverage, and no generated output or
dependency artifacts. The basic, React, and generated project-console starters
are the standalone copyable paths; the devtools panel and extension packages
are workspace examples with source-only package payload gates.
