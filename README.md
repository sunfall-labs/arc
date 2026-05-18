# Sunfall Arc

Sunfall Arc is an experimental, Effect-native TypeScript framework for
correctness by construction in full-stack apps. It treats application behavior
as typed definitions that humans, tests, devtools, and agents can all inspect.

The front door is small: a model, typed messages, exhaustive message handlers,
and Effect commands.

```ts
type CounterModel = { readonly count: number; readonly loading: boolean };
type CounterMessage =
  | { readonly _tag: "Increment" }
  | { readonly _tag: "Load" }
  | { readonly _tag: "Loaded"; readonly amount: number };

const Counter = Program.define<CounterModel, CounterMessage>({
  initial: { count: 0, loading: false },
  on: {
    Increment: (model) => ({ ...model, count: model.count + 1 }),
    Load: (model) =>
      Program.next(
        { ...model, loading: true },
        Program.emit(Effect.succeed({ _tag: "Loaded", amount: 2 } as const)),
      ),
    Loaded: (model, message) => ({
      count: model.count + message.amount,
      loading: false,
    }),
  },
});
```

That same loop can grow into typed Capabilities, Resources, Actions, Routes,
server contracts, request-scoped runtimes, React and Solid adapters,
local-first Collections, and deterministic app graph diagnostics without
leaving the Effect runtime model.

The project is still pre-release. Framework packages are MIT-licensed and
configured for public alpha publication; the workspace root and copyable
examples/starters remain private so only the library packages are publishable
while examples, diagnostics, and release gates are hardened.

## What This Repo Proves

- A small `Program.define({ initial, on })` loop can be the first stateful unit,
  while serviceful work, subscriptions, timelines, and devtools facts stay
  Effect-owned.
- Humans and agents can co-develop against explicit app structure: typed
  definitions, generated route artifacts, app graph diagnostics, and verification
  gates.
- Effect-first Resources, Actions, Programs, Forms, Routes, Capabilities, and
  server contracts across Solid and React adapters.
- Request-local runtimes and resource stores for SSR, RPC, Start actions, and
  streamed responses.
- Local-first Collections with persistence, sync adapter seams, optimistic
  mutation queues, and live query materialization.
- JSON-safe devtools summaries, causal graphs, Program timelines, request
  traces, panel data models, a browser-embeddable panel renderer, a checked
  panel app shell, and a checked browser-extension shell with an
  inspected-window bridge.
- Deterministic Start manifests and build diagnostics with repair guidance.
- Copyable basic, React, and project console starters with SSR, hydration,
  route-owned Resource preload, checked standalone packaging, and server-only
  leak scans.

## Start Here

Read in this order when you are new to the repo:

1. [Basic, React, and project-console starters](docs/starter.md)
2. [Architecture](docs/architecture.md)
3. [Effect style guide](docs/effect-style.md)
4. [Deployment](docs/deployment.md)
5. [Solid and React adapters](docs/adapter-differences.md)

Useful deeper references:

- [Design reference](Design.md)
- [Framework perfection charter](docs/framework-perfection-charter.md)
- [Migration notes](docs/migration-notes.md)
- [Public API inventory](docs/public-api-inventory.md)
- [Public release readiness](docs/public-release-readiness.md)
- [Release notes draft](docs/release-notes.md)
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
pnpm typecheck
pnpm test
pnpm benchmark
pnpm devtools-panel:verify
pnpm devtools-extension:verify
pnpm starter:verify
pnpm react-starter:verify
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
  Capabilities, and server contracts.
- `@sunfall/arc-start`: SSR, hydration, transports, manifests, diagnostics, and
  Start action clients.
- `@sunfall/arc-start-node`: Node HTTP facade over the tested Start adapters.
- `@sunfall/arc-start-fetch`: Fetch-host facade over the tested Start adapters.
- `@sunfall/arc-db`: Collections, live queries, persistence, and sync adapter
  seams.
- `@sunfall/arc-devtools`: serializable inspection contracts, Program timeline
  panels, and a small browser panel renderer for agents, app panels, and
  extension panels.
- `@sunfall/arc-react`: React runtime provider, router, resource/action/program
  hooks, streams, and component scopes.
- `@sunfall/arc-react-db`: React collection and live query hooks.
- `@sunfall/arc-solid`: Solid runtime provider, router, program/resource/action
  hooks, streams, and component scopes.
- `@sunfall/arc-solid-db`: Solid collection and live query hooks.
- `@sunfall/arc-tsrx`: TSRX/Solid Vite preset for examples and starters.

## Current Release Bar

The current cleanup goal is tracked in
[docs/perfection-progress.md](docs/perfection-progress.md). A release-candidate
handoff requires a green `pnpm verify`, current benchmark baselines, package
dry-run evidence, public API decisions, and no known misleading docs or
Promise-first framework internals.
