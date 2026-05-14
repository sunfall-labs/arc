# Runtime Leak And Teardown Audit

Last updated: 2026-05-14.

This audit checks framework-owned runtime state that can survive request,
component, resource, or test lifetimes if teardown is incomplete.

## Current Sweep Results

- Resource Store disposal already interrupted tracked resource fibers and ran
  registered module finalizers through `disposeResourceStoreEffect`.
- This sweep closed the remaining event-channel gap: Resource Store disposal
  now shuts down its `PubSub` through `Effect.ensuring`, so event subscribers are
  released even when a module finalizer fails.
- Request runtime teardown still records before/after Resource Store snapshots
  before shutdown, so devtools traces keep their teardown evidence while the
  underlying event channel is closed after disposal.

## Verification Evidence

- `pnpm exec vitest run packages/core/test/resource-store.test.ts` passed after
  adding Resource Store event shutdown and failure-path regressions.
- Existing teardown coverage remains relevant:
  - `packages/core/test/resource.test.ts` covers public prefetch dedupe and
    runtime-disposal interruption of in-flight resource fibers.
  - `packages/core/test/scope.test.ts` covers component-scope finalizers and
    scoped fiber interruption.
  - `packages/start/test/start.test.ts` covers request-runtime teardown traces
    for SSR, server RPC, Start actions, stream close, and interruption/failure
    paths.

## Follow-Up

- Add browser-driven leak checks for route navigation and component unmounts
  once the first devtools UI panel exists.
- Keep module finalizers Effect-native so failures can be composed with
  `ensuring` and surfaced without leaking runtime channels.
