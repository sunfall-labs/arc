# Effect UI

Effect UI is an experimental full-stack TypeScript framework built around
Effect, Solid, TSRX, and deterministic app graph diagnostics.

The project is still pre-release. Packages remain private while the framework
surface, examples, diagnostics, and release gates are being hardened.

## What This Repo Proves

- Effect-first Resources, Actions, Forms, Routes, Capabilities, and server
  contracts.
- Request-local runtimes and resource stores for SSR, RPC, Start actions, and
  streamed responses.
- Local-first Collections with persistence, sync adapter seams, optimistic
  mutation queues, and live query materialization.
- JSON-safe devtools summaries, causal graphs, request traces, panel data
  models, and a browser-embeddable panel renderer.
- Deterministic Start manifests and build diagnostics with repair guidance.
- A copyable project console example and a minimal starter with SSR,
  hydration, route-owned Resource preload, and server-only leak scans.

## Start Here

- [Architecture](docs/architecture.md)
- [Effect style guide](docs/effect-style.md)
- [Deployment](docs/deployment.md)
- [Framework perfection charter](docs/framework-perfection-charter.md)
- [Basic starter](docs/starter.md)
- [Public API inventory](docs/public-api-inventory.md)
- [Project console example](examples/project-console/README.md)

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
pnpm typecheck
pnpm test
pnpm benchmark
pnpm starter:verify
pnpm example:typecheck
pnpm example:test
pnpm example:build
pnpm example:leak-scan
```

## Package Map

- `@effect-ui/core`: runtime spine, Signals, Resources, Actions, Forms,
  Routes, Capabilities, and server contracts.
- `@effect-ui/start`: SSR, hydration, transports, manifests, diagnostics, and
  Start action clients.
- `@effect-ui/start-node`: Node HTTP facade over the tested Start adapters.
- `@effect-ui/start-fetch`: Fetch-host facade over the tested Start adapters.
- `@effect-ui/db`: Collections, live queries, persistence, and sync adapter
  seams.
- `@effect-ui/devtools`: serializable inspection contracts plus a small
  browser panel renderer for agents and UI panels.
- `@effect-ui/solid`: Solid runtime provider, router, resource hooks, action
  hooks, streams, and component scopes.
- `@effect-ui/solid-db`: Solid collection and live query hooks.
- `@effect-ui/tsrx`: TSRX/Solid Vite preset for examples and starters.

## Current Release Bar

The current cleanup goal is tracked in
[docs/perfection-progress.md](docs/perfection-progress.md). A release-candidate
handoff requires a green `pnpm verify`, current benchmark baselines, package
dry-run evidence, public API decisions, and no known misleading docs or
Promise-first framework internals.
