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

Package the copyable starter suite:

```sh
pnpm starter:package
```

That command writes `.test-dist/starters/basic`, `.test-dist/starters/react`,
and `.test-dist/starters/project-console` from their example sources. Each
generated starter rewrites workspace protocol dependencies to local
`.effect-ui-packages/*` file dependencies, removes monorepo Vite aliases, writes
a standalone `tsconfig.json`, verifies the app file manifest against the
copyable source manifest, installs outside the workspace, runs the generated
starter's own `verify` script, removes generated install/build/test artifacts,
and rechecks the manifest after verification. Each generated app also carries a
starter-local `.gitignore` for `node_modules`, `dist`, `.test-dist`, build info,
and macOS metadata.
