# Effect-First Audit

Last updated: 2026-05-14.

This audit supports the charter rule: push async lifecycle, teardown, tracing,
retry, streaming, and adapter work down into Effect primitives wherever
possible. Promises are acceptable at host boundaries and public convenience
APIs; framework internals should prefer `Effect`, `Fiber`, `Scope`, and
Effect-native interruption.

## Classification

| Class | Rule | Examples |
| --- | --- | --- |
| Host boundary | Promise is acceptable because the platform API requires it. | Web Stream `pull`/`cancel`, Vite middleware, Node/fetch adapters, public browser callbacks. |
| Public convenience | Promise is acceptable when an Effect-first API exists beside it. | `Resource.prefetch(...)` beside `Resource.prefetchEffect(...)`, `createRequestHandler(...)` beside `createRequestHandlerEffect(...)`. |
| Internal follow-up | Convert to Effect unless there is a concrete host-boundary reason. | Promise state machines, `.then(...)` lifecycle sequencing, unstructured async helpers. |

## Current Sweep Results

- `packages/start/src/index.ts`
  - Kept Web Stream `pull` and `cancel` as host-boundary async callbacks.
  - Moved response stream finalization into one Effect program that disposes the
    request runtime and emits request trace facts from the same finalizer.
  - Added trace tests for response stream close, cancellation, and request
    failure paths.
- `packages/core/src/runtime.ts`
  - Replaced Promise `.then(...)` disposal sequencing with a single
    `disposeEffect` run from the public `dispose()` host-boundary method.
- `packages/db/src/index.ts`
  - Replaced live-query collection `Promise.resolve(...)` no-ops with
    `runPromise(definition.*Effect(...))` so public Promise helpers still
    delegate to Effect-native methods.
- `packages/solid/src/index.ts`
  - Replaced unmatched router preload `Promise.resolve()` with
    `runtime.runPromise(Effect.void)` so the public Promise path stays behind
    the runtime boundary.
- `type-tests/framework.test-d.ts`
  - Added structural compatibility coverage from `StartRequestTrace` to
    `DevtoolsRequestTrace`, keeping Start independent of devtools while still
    proving the emitted data contract.

## Remaining Promise Sites To Review

- `packages/core/src/action.ts`
  - Uses a Promise to represent the public `submit(...)` host boundary and
    action concurrency state. Review whether the internal state machine can
    track `Fiber` plus Effect state more directly while keeping `submit(...)` as
    a convenience API.
- `packages/core/src/resource.ts`
  - Uses a Promise to dedupe in-flight resource loads. Review whether the cache
    should hold `Fiber` or an Effect-native deferred primitive instead.
- `packages/solid/src/index.ts`
  - Uses Promises at Solid/browser boundaries for preload, suspense throws, and
    ignored background prefetches. Keep only where Solid expects a Promise.
- `packages/db/src/index.ts`
  - Most Promise methods delegate to `*Effect` APIs. Continue reviewing
    fire-and-forget write helpers for whether they should expose Effect-first
    error observation.
- `packages/start/src/vite.ts` and `packages/start/src/adapters.ts`
  - Promise use is mostly Vite, Node, and fetch host-boundary work. Keep
    auditing any helper that can become an Effect program before it crosses the
    host boundary.

## Verification Evidence

- `pnpm exec vitest run packages/core/test/runtime.test.ts packages/start/test/start.test.ts`
  passed after the first cleanup pass.
- `pnpm exec vitest run packages/db/test/live-query-collection.test.ts packages/solid-db/test/solid-db.test.ts`
  passed after replacing no-op Promise helpers.
- `pnpm verify` passed after Start trace hardening before the core runtime
  disposal cleanup. Re-run it after the next source change before handoff.
