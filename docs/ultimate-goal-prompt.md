# Ultimate Goal Prompt

Use this prompt to run a multi-day human and AI engineering push on Effect UI.
The team must keep the separate checklist in
[`docs/ultimate-goal-checklist.md`](./ultimate-goal-checklist.md) updated as
work is completed.

```md
# Ultimate Goal: Build Effect UI Into The Best Full-Stack Framework

You are working in the `effect-ui` repository. Your mission is to realize Effect
UI as a groundbreaking full-stack TypeScript framework built around Effect v4,
TSRX, fine-grained UI reactivity, compile-time correctness, runtime
observability, and agent-native architecture.

This is not a clone of React, Solid, Next, Remix, TanStack Start, TanStack
Query, TanStack DB, Jotai, or Relay. It should absorb the useful work those
tools do, then surpass them with stronger compile-time guarantees,
Effect-native runtime semantics, better testing seams, request isolation,
semantic invalidation, progressive enhancement, and causal devtools.

## Required Reading

Before implementing, read and use these docs as the source of truth:

- `CONTEXT.md`
- `docs/best-framework-plan.md`
- `docs/winning-spec.md`
- `docs/architecture.md`
- `docs/effect-style.md`
- `docs/invariants.md`
- `docs/competitiveness.md`
- `docs/devtools.md`
- `docs/db.md`
- `docs/ultimate-goal-checklist.md`

Treat these as product and architecture contracts. Update them when decisions
change.

## Required Tracking Artifact

Maintain `docs/ultimate-goal-checklist.md` throughout the work.

Rules:

- Do not mark a checkbox complete until the implementation, tests, docs, and
  verification evidence for that item exist.
- Add short evidence notes under completed items: package/file paths, test names,
  command output summary, diagnostics output, or example flows.
- If an item splits into smaller work, add nested checklist items under it.
- If a decision changes the plan, update the checklist and the relevant source
  docs in the same pull request or work session.
- At the end of each day, update the "Daily Checkpoints" section with completed
  work, verification status, blockers, and next owners.
- The final handoff is not done until every completed claim in the summary maps
  to checked checklist evidence.

## North Star

Build the framework where TypeScript, Effect, the compiler, runtime, server,
router, resources, collections, actions, forms, hydration, tests, devtools,
diagnostics, and agents all agree on one application graph.

The framework should make the correct path the ergonomic path:

- schemas and branded types define domain truth;
- resources model typed async reads;
- collections model normalized indexed local data;
- actions model typed mutations, retries, optimistic work, invalidation, and
  results;
- routes model typed navigation and preload ownership;
- server contracts split browser-safe clients from server-only handlers;
- capabilities/layers make services easy to mock;
- generated manifests and app graphs make the app inspectable;
- devtools explain causal runtime behavior;
- `pnpm verify` proves the release bar.

## Non-Negotiables

- Effect-first APIs. Promise helpers only at host/UI boundaries.
- No hidden bare Promise callbacks in framework definitions.
- Use Effect services, `Layer`, `Context`, `Scope`, `Schedule`, `Stream`,
  fibers, and tagged errors idiomatically.
- Runtime state must be scoped to the active runtime, route, component, request,
  or test.
- Server-only code must never leak into browser bundles.
- Invalidation must use semantic `Resource.tag` values or direct resource refs,
  never route names or string cache keys.
- Hydration must populate both visible UI state and Effect-backed
  cache/collection state.
- Compile-time rejection rules need type tests.
- Runtime guarantees need behavioral tests.
- Generated artifacts must be deterministic and source-attributed.
- Devtools and diagnostics must consume public facts, not private implementation
  maps.
- Keep `pnpm verify` green.

## Workstreams

Organize work into parallel teams or agents. Each team should own a clear slice,
avoid overlapping edits when possible, and leave docs/tests with every
meaningful change.

### 1. Core Runtime And Reactivity

Own `@effect-ui/core`.

Goals:

- make `Signal`, `Resource`, `Action`, `Route`, `Server`, `Capability`, and
  `Form` feel coherent and beautiful;
- keep resources backed by runtime-local Effect cache/store semantics;
- deepen resource lifecycle correctness: stale, refreshing, previous value, GC,
  failure, retry, hydration, event stream, invalidation;
- deepen action correctness: concurrency, interruption, optimistic
  commit/rollback, retries, typed results, invalidation planning;
- ensure every async public API has an Effect form;
- add type tests for every rule that should fail at compile time.

Checklist owner: update `docs/ultimate-goal-checklist.md` under "Core Runtime
And Reactivity".

### 2. Full-Stack Start Layer

Own `@effect-ui/start`.

Goals:

- make Start a true TanStack Start competitor, but safer;
- harden SSR request runtimes, request isolation, streaming, hydration, server
  functions, progressive actions, response context, and deployment adapters;
- strengthen file-route generation and route type maps;
- enforce browser/server boundaries;
- improve server action transport, invalidation metadata, hydration replay,
  redirects, validation, and no-JS form support;
- keep server functions contract-first and handler modules server-only.

Checklist owner: update `docs/ultimate-goal-checklist.md` under "Full-Stack
Start Layer".

### 3. Data Layer And Local-First Foundation

Own `@effect-ui/db` and `@effect-ui/solid-db`.

Goals:

- make collections and live queries feel like a better TanStack DB;
- support normalized rows, secondary indexes, live query diagnostics, optimistic
  queues, rollback rows, persistence, sync adapters, background flush policy,
  and Start hydration;
- keep all state runtime/request-local;
- expose public event streams and diagnostics;
- build toward local-first/offline-first without compromising Effect-native
  architecture.

Checklist owner: update `docs/ultimate-goal-checklist.md` under "Data Layer And
Local-First Foundation".

### 4. Compiler, Manifests, And App Graph

Own generated route files, manifests, diagnostics, and build policy.

Goals:

- make the app graph the central machine-readable truth;
- include routes, resources, collections, actions, server functions, schemas,
  endpoints, modules, preload declarations, behavior metadata, and ownership;
- make diagnostics actionable for humans and agents;
- support strict build policy for missing schemas, unknown preload ownership,
  unknown action behavior, unsafe imports, duplicate routes, malformed params,
  and manifest drift;
- ensure generated artifacts are deterministic and covered by tests.

Checklist owner: update `docs/ultimate-goal-checklist.md` under "Compiler,
Manifests, And App Graph".

### 5. Devtools And Observability

Own `@effect-ui/devtools`.

Goals:

- build the causal observability substrate;
- consume app graph diagnostics, route plans, resource events, collection
  events, action state, invalidation plans, Start action metadata, server
  traces, and request runtime traces;
- produce deterministic summaries and causal graphs;
- design target panels for app graph, routes, resources, actions, collections,
  requests, diagnostics, and repair guidance;
- never depend on private runtime maps.

Checklist owner: update `docs/ultimate-goal-checklist.md` under "Devtools And
Observability".

### 6. UI Adapter, TSRX, And Example App

Own `@effect-ui/solid`, `@effect-ui/tsrx`, and `examples/project-console`.

Goals:

- make the example app prove the golden path;
- use TSRX correctly with `tsrx-tsc` and the Solid target;
- keep UI code ergonomic and compact;
- demonstrate schema-branded params, resources, collections, actions, forms,
  SSR, hydration, validation, redirects, optimistic updates, invalidation,
  request isolation, and no-JS fallback;
- ensure the built client does not leak server-only data or modules.

Checklist owner: update `docs/ultimate-goal-checklist.md` under "UI Adapter,
TSRX, And Example App".

### 7. Docs, Product, And Developer Experience

Own all docs.

Goals:

- keep `docs/best-framework-plan.md` as the north-star plan;
- keep `docs/winning-spec.md` as the execution contract;
- keep `docs/architecture.md` accurate with implementation reality;
- keep `docs/effect-style.md` as the idiomatic coding guide;
- keep `docs/invariants.md` as the non-negotiable behavior contract;
- keep examples copyable and aligned with tests;
- write docs that help both humans and AI agents make correct changes.

Checklist owner: update `docs/ultimate-goal-checklist.md` under "Docs, Product,
And Developer Experience".

## Operating Mode

Work for several days as a serious engineering push.

At the start:

1. Read the required docs.
2. Inspect the current repo state.
3. Identify the highest-leverage gaps against `docs/best-framework-plan.md`.
4. Split work into independent workstreams.
5. Assign ownership by package/file area.
6. Create or update checklist items in `docs/ultimate-goal-checklist.md`.
7. Add acceptance criteria and expected verification for each slice.

During implementation:

- Prefer small vertical slices.
- Add tests with each behavior change.
- Add type tests with each compile-time guarantee.
- Update docs when architecture or public APIs change.
- Update `docs/ultimate-goal-checklist.md` as items move from pending to done.
- Keep APIs idiomatic to Effect v4.
- Avoid plain Promise internals.
- Avoid hidden global mutable state.
- Avoid broad refactors unless they directly serve the goal.
- Run focused tests after each slice.
- Run `pnpm verify` before considering the work complete.

Daily checkpoint:

- What got better?
- Which checklist items were checked off?
- What evidence proves each completed item?
- Which guarantees are now enforced earlier?
- Which runtime behavior is now more observable?
- Which docs/tests prove it?
- What remains before Effect UI beats the incumbent frameworks?

## Definition Of Done

The project is materially closer to "best full-stack framework" only when:

- `pnpm verify` passes;
- new behavior has tests;
- new compile-time guarantees have type tests;
- public APIs are documented;
- examples demonstrate the intended ergonomic path;
- generated artifacts remain deterministic;
- devtools/diagnostics can inspect the new facts where relevant;
- no server-only leaks are introduced;
- no Effect-native semantics are replaced with ad hoc Promise logic;
- `docs/ultimate-goal-checklist.md` has been updated with checked items and
  evidence notes for everything claimed complete.

## Final Deliverable

At the end of the multi-day push, produce:

1. A summary of shipped capabilities.
2. A list of changed packages/docs/examples.
3. Verification results.
4. A link to the updated `docs/ultimate-goal-checklist.md`.
5. Remaining unchecked competitive-bar items.
6. Remaining unchecked winning-bar items.
7. The next recommended workstreams.
8. Any architectural decisions that should become ADRs or docs updates.
9. A friendly Markdown blog post comparing Effect UI with top-tier frameworks,
   using concrete code examples and honest tradeoffs.

Before final handoff, perform a completion audit:

- map every explicit prompt requirement and checklist claim to real evidence;
- inspect the relevant files, tests, docs, generated artifacts, and command
  output;
- keep future-looking or weakly verified items unchecked;
- record remaining gaps as next work rather than overstating completion.

The standard is high: Effect UI should feel innovative, principled, ergonomic,
inspectable, type-safe, mockable, and deeply Effect-native. Build the system so
a human team or AI agent can safely understand it, extend it, test it, and trust
it.
```
