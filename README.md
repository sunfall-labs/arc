# Sunfall Arc

Sunfall Arc is an experimental, Effect-native TypeScript framework for
correctness by construction in full-stack apps. It treats application behavior
as typed definitions that humans, tests, devtools, and agents can all inspect.

**Start with [The Golden Path](docs/golden-path.md).** It tells you which tool
to use for each job (Resource for reads, including keyed rows, Action for
writes, Signal or Program for client state, Component for screens, Route for
pages) and builds one feature end to end, from a Resource to SSR,
hydration, and Timeline debugging. Its snippets are type-checked by
`pnpm typecheck`.

The project is still pre-release. Framework packages are MIT-licensed and
configured for public alpha publication; the workspace root and copyable
examples/starters remain private so only the library packages are publishable
while examples, diagnostics, and release gates are hardened.

## What This Repo Proves

- One typed UI model: `Component.define` setups bind Resources, Actions,
  Programs, live queries, and the router, and their services and typed failures
  accumulate into the component type that `Component.launch` checks.
- Humans and agents can co-develop against explicit app structure: typed
  definitions, generated route artifacts, definition diagnostics, and
  verification gates.
- Effect-first Resources, Actions, Programs, Forms, Routes, Effect services,
  and server contracts through the Solid 2 adapter.
- Request-local runtimes and resource stores for SSR, RPC, Start actions, and
  streamed responses.
- One server-data model: Resources with keyed rows, indexes, change feeds,
  persistence, optimistic row patches from Actions, and incremental live
  queries over those rows.
- Whole-app Timeline recording and replay, JSON-safe devtools summaries,
  causal graphs, request
  traces, panel data models, a browser-embeddable panel renderer, a checked
  panel app shell, and a checked browser-extension shell with an
  inspected-window bridge.
- Deterministic Start manifests and build diagnostics with repair guidance.
- Copyable basic and project console starters with SSR, hydration,
  route-owned Resource preload, checked standalone packaging, and server-only
  leak scans.

## Start Here

Read in this order when you are new to the repo:

1. [The Golden Path](docs/golden-path.md): which tool for which job, and one
   feature built end to end
2. [Basic and project-console starters](docs/starter.md)
3. [Solid adapter](docs/solid-adapter.md)
4. [Architecture](docs/architecture.md)
5. [Effect style guide](docs/effect-style.md)
6. [Deployment](docs/deployment.md)

Useful deeper references:

- [Rows and queries](docs/db.md): Resource rows, live queries, change feeds,
  and persistence
- [Devtools](docs/devtools.md)
- [Migration notes](docs/migration-notes.md)
- [Invariants](docs/invariants.md)
- [Public API inventory](docs/public-api-inventory.md)
- [Comparison with other frameworks](docs/comparison.md)
- [Changelog](CHANGELOG.md)
- [Contributing and releasing](CONTRIBUTING.md)
- [Docs site design reference](Design.md)
- [Devtools panel example](examples/devtools-panel/README.md)
- [Devtools extension example](examples/devtools-extension/README.md)
- [Project console example](examples/project-console/README.md)

## License

MIT. See [LICENSE](LICENSE).

## Development

Install dependencies:

```sh
pnpm install
```

Run the full gate:

```sh
pnpm verify
```

Useful focused commands:

```sh
pnpm build
pnpm typecheck        # includes docs:snippets (golden-path snippets match their fixtures)
pnpm test
pnpm benchmark
pnpm devtools-panel:verify
pnpm devtools-extension:verify
pnpm starter:verify
pnpm starter:package
pnpm example:pack-dry-run
pnpm example:typecheck
pnpm example:test
pnpm example:build
pnpm example:leak-scan
```

## Package Map

- `@sunfall/arc-core`: runtime spine, Signals, Programs, Program stories and
  timelines, Resources, Actions, Forms/FormData decoding, Routes,
  and server contracts.
- `@sunfall/arc-start`: SSR, hydration, transports, manifests, diagnostics, and
  Start action clients; host adapters live at `@sunfall/arc-start/fetch` and
  `@sunfall/arc-start/node`.
- `@sunfall/arc-db`: the Query engine: incremental live queries over the rows
  of Resources.
- `@sunfall/arc-devtools`: serializable inspection contracts, Timeline commit
  panels, and a small browser panel renderer for agents, app panels, and
  extension panels.
- `@sunfall/arc-solid`: Solid runtime provider, router, program/resource/action
  hooks, live query bindings, streams, and component scopes.
- `@sunfall/arc-tsrx`: TSRX/Solid Vite preset for examples and starters.

## Release Bar

A release requires a green `pnpm verify`, current benchmark baselines, package
dry-run evidence, and public API decisions recorded in the
[Public API inventory](docs/public-api-inventory.md). See
[CONTRIBUTING.md](CONTRIBUTING.md) for the publishing process.
