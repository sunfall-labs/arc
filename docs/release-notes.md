# Release Notes Draft

This is the current release-candidate snapshot for the pre-release Effect UI
framework. Package manifests remain private, so this is not an npm release note
yet.

## Stable For The First External App

- Core runtime primitives: Signals, Resources, Actions, Forms, Routes,
  Capabilities, server contracts, scoped UI work, and request-local runtimes.
- Start request handling: SSR, RPC, Start actions, hydration payloads, streamed
  HTML responses, request traces, and build diagnostics.
- Node and Fetch host facades: `@effect-ui/start-node` and
  `@effect-ui/start-fetch`.
- Devtools data contracts: snapshots, summaries, causal graphs, request traces,
  panel models, deterministic HTML rendering, and the checked panel app shell.
- Local-first DB surface: Collections, live queries, persistence, sync adapter
  seams, mutation queues, and flush policies.
- Solid adapters: runtime provider, router, Resource hooks, Action hooks,
  stream hooks, and collection hooks.
- Starter paths: `examples/basic-starter` for the smallest full-stack shell and
  `examples/project-console` for the golden-path app.

## Experimental Or Expert-Public

- Start Vite helpers, virtual module helpers, diagnostics loaders, and generated
  app graph artifacts are public for CI, starter tooling, and agent workflows,
  but remain expert-facing.
- DB query builder internals intentionally keep a small cast boundary around
  joined context variance and the default projector.
- Core runtime integration with Effect `ManagedRuntime` keeps a documented
  service-erasure cast boundary.
- Browser extension packaging for devtools is not committed; the checked app
  shell proves the renderer integration first.
- Platform-specific packages beyond Node/fetch should wait for hosts that need
  real behavior beyond the generic facades and documented recipes.

## Verification Snapshot

Latest full gate on May 14, 2026:

- 9 package builds;
- workspace typecheck and public type tests;
- 37 root test files / 310 tests;
- devtools panel verify;
- basic starter verify;
- project console typecheck;
- 4 project console test files / 23 tests;
- project console production build;
- project console server-only leak scan.

## Notable Limits

- Packages are still private and versioned `0.0.0-alpha.0`.
- No browser extension package exists for devtools yet.
- The project console is still an example app, not a packaged rich starter
  template.
- Cloudflare, Vercel, Netlify, Bun, and static deployment currently use recipes
  over Node/fetch facades rather than dedicated packages.
