# Type-Test Coverage Audit

Last updated: 2026-05-14.

This audit checks compile-time coverage for the public framework contracts that
are easiest to regress while refactoring internals toward Effect primitives.

## Current Sweep Results

- `type-tests/framework.test-d.ts` exercises every public package root used by
  the example path: core routes/resources/actions/forms/capabilities, Start
  request handling and hydration, DB collections and live queries, Solid DB
  hooks, generated file-route types, and devtools invalidation plans.
- Promise-returning callbacks are rejected at the type boundary for routes,
  resources, collections, actions, forms, server implementations, Start render
  callbacks, and now `onRequestTrace`.
- Generated route unions are covered for route ids, route paths, canonical
  params, branded params, href options, and search literal rejection.
- Start request traces remain structurally assignable to
  `DevtoolsRequestTrace`, including the richer teardown timestamps, duration,
  and before/after Resource Store snapshots added during the request trace
  sweep.

## Verification Evidence

- `pnpm typecheck:types` passed after the explicit request-trace teardown and
  Promise-return rejection assertions were added.
- Existing type-test failure expectations cover public compile-time rejection
  rules for route params/search, server contracts, resource inputs, collection
  rows, live-query selectors, capability implementations, action invalidation,
  optimistic rollback effects, and form fields.

## Follow-Up

- Add type assertions with each new public callback to keep Promise-shaped APIs
  out of the framework boundary unless they are intentionally wrapped by
  Effect.
- Keep Start and devtools trace contracts covered together whenever request
  trace payloads grow.
