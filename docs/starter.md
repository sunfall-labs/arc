# Starters

The smallest checked starter lives at
[`examples/basic-starter`](../examples/basic-starter). It is a full-stack
starter, not a marketing demo.

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
- browser hydration through `hydrateFromDocument`;
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

See [Solid and React adapters](adapter-differences.md) for the renderer-level
API differences.

Package the richer project-console starter:

```sh
pnpm starter:project-console:package
```

That command writes `.test-dist/starters/project-console` from
`examples/project-console`, rewrites workspace protocol dependencies to the
versions declared by the workspace package manifests, removes monorepo Vite
aliases, writes a standalone `tsconfig.json`, and verifies the generated file
manifest matches the copyable source manifest.
