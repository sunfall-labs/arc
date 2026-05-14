# Effect UI Winning Spec

## Problem Statement

Effect UI is trying to become the best full-stack framework for agent-operated
applications and compile-time correctness. The current core has a strong
Effect-native Runtime Spine, request-local Resource Stores, typed resources,
actions, routes, capabilities, server contracts, and a developing Start layer.

The remaining problem is not a lack of primitives. The problem is turning those
primitives into a framework-level correctness system where the compiler, build
pipeline, runtime, diagnostics, and documentation all agree on the same app
graph. Agents should not have to infer where code runs, which server functions
exist, which resources a route touches, what mutations invalidate, or which
states can fail. The framework should make those facts explicit, typed,
generated, inspectable, and testable.

## Solution

Effect UI should win by becoming the framework where an agent can safely inspect,
modify, and verify a full-stack app through a single coherent model:

- A typed app graph covering routes, resources, actions, forms, capabilities,
  server functions, schemas, invalidation tags, hydration payloads, and runtime
  ownership.
- A build-time wall that proves client/server boundaries, route manifests,
  server function manifests, schema availability, and duplicate detection before
  production bundling.
- An Effect-native runtime that preserves request isolation, scopes,
  interruption, retries, streaming, resource lifetimes, and event streams across
  client, SSR, server RPC, tests, and adapters.
- Diagnostics and devtools that explain runtime behavior as causal facts instead
  of private framework state.
- Agent-readable conventions and generated artifacts that let agents make small,
  correct changes without reverse-engineering the application.

The strategic bet is narrow: do not chase framework breadth first. Win by making
the app graph explicit, typed, generated, inspectable, and explainable.

The comprehensive product plan lives in
[Best Full-Stack Framework Plan](./best-framework-plan.md). This spec is the
execution contract for that plan: the product only counts as "best in class"
when the strategy is backed by generated artifacts, compile-time rejection,
Effect-native runtime behavior, tests, diagnostics, and a reference app.

## Breakthrough Thesis

Most full-stack frameworks give developers a productive runtime and then ask
tests, conventions, or reviewers to catch architectural drift. Effect UI should
invert that. The framework should make the application graph explicit enough
that drift is visible before production:

- compile-time types reject bad links, bad field names, bad branded ids, bad
  callbacks, and wrong server/client usage;
- build-time diagnostics reject ambiguous routes, missing wire schemas,
  server-only leaks, unknown preload ownership, and unknown action behavior
  when teams opt into strict policy;
- runtime scopes reject leaked async work by tying resources, collections,
  streams, actions, and request fibers to Effect lifetimes;
- devtools reject hand-wavy debugging by showing causal facts from public event
  streams and generated graph data;
- tests reject framework regressions through runtime behavior, integration
  scenarios, manifest snapshots, and negative type tests.

The innovation is not one API. It is making the compiler, runtime, server,
cache, form layer, router, mutation system, hydration, diagnostics, and agent
surface speak the same domain language.

## Experience Promise

The app authoring experience should be calm and compact:

- define schemas and branded ids once;
- define services as capabilities and layers;
- define server contracts in shared modules and handlers in `.server.ts`
  modules;
- define resources for typed async reads and semantic tags;
- define collections for normalized indexed data and live queries;
- define actions for mutations, optimistic updates, retries, typed results, and
  invalidation;
- define routes with schema params/search and declared preload ownership;
- use TSRX/Solid components with fine-grained reads and Effect scopes.

The framework does the bookkeeping: generated route type maps, manifests,
request runtimes, hydration payloads, action transports, server function stubs,
devtools snapshots, diagnostics reports, and testable failure paths.

## User Stories

1. As an app developer, I want routes to be schema-typed, so that invalid params
   and search values fail at compile time.
2. As an app developer, I want file routes to generate typed route modules, so
   that route manifests stay consistent with source files.
3. As an app developer, I want duplicate route paths to fail during build, so
   that ambiguous navigation never reaches production.
4. As an app developer, I want server functions to have stable production ids, so
   that deployments and client references remain deterministic.
5. As an app developer, I want server-only modules blocked from browser graphs,
   so that secrets and server handlers cannot leak into client bundles.
6. As an app developer, I want server contracts split from server handlers, so
   that shared clients remain browser-safe.
7. As an app developer, I want resources to publish semantic domain facts, so
   that mutations invalidate what changed instead of string cache keys.
8. As an app developer, I want actions to expose invalidation plans, so that I
   can understand which live resources will refresh before they do.
9. As an app developer, I want forms to be schema-backed, so that field names and
   field values are typed from the domain model.
10. As an app developer, I want action results to model success, validation
    failure, redirects, and domain failure as data, so that UI and no-JS flows
    are consistent.
11. As an app developer, I want request work to use a fresh Request Runtime, so
    that one SSR or RPC request cannot observe another request's resource state.
12. As an app developer, I want streamed responses to keep request fibers alive
    until the body closes, so that scoped finalizers and interruptions behave
    correctly.
13. As an app developer, I want hydration to populate both UI signals and Effect
    caches, so that client reads are synchronous and duplicate preloads are
    avoided.
14. As an app developer, I want every async public API to expose an Effect form,
    so that retries, interruption, services, and scopes remain composable.
15. As an app developer, I want Promise APIs only at host and UI boundaries, so
    that framework internals keep Effect semantics.
16. As an app developer, I want deployment adapters for common hosts, so that I
    can ship without rewriting framework integration code.
17. As a tester, I want capabilities and server mocks to replace app behavior, so
    that tests do not import server-only modules.
18. As a tester, I want type tests for API misuse, so that compile-time
    guarantees cannot regress silently.
19. As a tester, I want lifecycle tests for resources, streams, actions, and
    request runtimes, so that runtime guarantees are backed by behavior.
20. As an agent, I want a generated app graph, so that I can discover routes,
    resources, actions, server functions, schemas, and invalidation edges without
    guessing.
21. As an agent, I want diagnostics with source ownership and actionable
    messages, so that I can fix framework mistakes safely.
22. As an agent, I want devtools timelines based on runtime event streams, so
    that I can explain why a resource loaded, failed, refreshed, or was deleted.
23. As an agent, I want route preload and hydration plans to be inspectable, so
    that I can reason about navigation before rendering.
24. As an agent, I want routes to declare expected preload resource families and
    DB collections, so that I can see likely data ownership from the static
    graph and compare it against runtime navigation plans.
25. As an agent, I want server RPC traces to separate domain failures, protocol
    errors, transport errors, defects, and interruption, so that fixes target the
    right layer.
26. As a maintainer, I want one verification command, so that package builds,
    runtime tests, example tests, and type tests form the release bar.

## Implementation Decisions

### Phase 0: Restore Trust

- Fix the currently failing streamed response lifecycle behavior so request
  runtime fibers are interrupted after streamed bodies close.
- Add a single verification command that runs package build, runtime tests,
  typecheck, type-level negative tests, example tests, example typecheck, and
  example build.
- Add continuous integration around that verification command.
- Document the core invariants that must never regress.
- Treat type tests as product tests.

Exit bar: one command proves package build, runtime behavior, example behavior,
and compile-time rejection behavior.

### Phase 1: Compiler And Manifest Wall

- Generate typed file-route modules and route manifests.
- Validate route duplicates and malformed route parameters at build time.
- Harden server function manifests into the bundling boundary, not just an
  inspectable data structure.
- Enforce browser-safe client references and server-only module isolation.
- Generate a machine-readable app graph containing route, resource, collection,
  action, capability, server function, schema, hydration, and invalidation
  metadata.
- Keep resource/collection/action graph facts source-attributable: static
  diagnostics can prove declared resource families, tags, collection schemas and
  persistence policy, retry/stale/GC policy, and action
  invalidation/optimistic/concurrency behavior, while dynamic invalidation
  targets remain runtime plans.
- Expand compile-time tests for every rule that should fail before runtime.

Exit bar: an agent can inspect one generated graph and understand the
application topology.

### Phase 2: Runtime Correctness Spine

- Prove Request Runtime isolation for SSR preload, SSR render, server RPC, and
  tests.
- Harden streaming semantics around shell rendering, resource chunks, finalizers,
  interruption, cancellation, and client disconnects.
- Complete resource lifecycle coverage for stale state, GC, refresh
  interruption, failures, hydration cache population, and event streams.
- Harden action concurrency semantics for latest, parallel, and exhaust modes.
- Ensure optimistic updates commit or roll back correctly under success,
  failure, interruption, and concurrent submissions.
- Separate server RPC domain failures, protocol errors, transport errors,
  defects, and interruption.

Exit bar: every async boundary has an Effect form, a Promise adapter, lifecycle
tests, and observable runtime facts.

### Phase 3: Forms And Progressive Actions

- Complete schema-backed form state, including typed fields, field errors, form
  errors, dirty state, touched state, and submission state.
- Model progressive action results as typed success, validation failure,
  redirect, and domain failure data.
- Support no-JS form/action fallback paths.
- Integrate server actions with resource invalidation and hydration updates.
- Prove create, edit, delete, validation, redirect, and optimistic update flows
  in the reference app.

Exit bar: a boring CRUD application can be built with stronger correctness
guarantees than mainstream full-stack frameworks.

### Phase 4: Devtools And Diagnostics

- Build a resource event timeline.
- Build an invalidation graph explorer that explains which action invalidated
  which tags and refreshed which resource refs.
- Build a route preload and hydration inspector.
- Build a server function and RPC trace viewer.
- Build a request runtime trace covering services, touched resources, fibers,
  interruptions, and stream lifecycle.
- Add a diagnostics command that combines static checks with runtime-oriented
  guidance. `effect-ui-start diagnostics` now covers the resolved app graph
  policy gate and prints an agent-readable repair report by default; deeper
  runtime guidance can build on that payload and the exported diagnostics report
  formatter.

Exit bar: when something goes wrong, the framework can explain the causal chain.

### Phase 5: Agent-Native Surface

- Keep domain vocabulary stable and central.
- Make generated artifacts deterministic and machine-readable.
- Write errors for both humans and agents: what happened, where it happened,
  why it happened, and how to fix it.
- Provide predictable code generation for adding routes, server functions,
  resource/action pairs, and form mutations.
- Maintain golden examples that agents can copy safely.
- Provide reference prompts for common framework edits.

Exit bar: an agent can add a feature by following framework affordances instead
of reverse-engineering the app.

### Phase 6: Production Readiness

- Ship Node, serverless, edge-compatible, SPA-only, and custom-server adapters.
- Stabilize package exports and versioning rules.
- Provide a minimal starter template.
- Provide a full-stack reference app.
- Publish migration, comparison, and deployment docs.
- Add benchmarks for SSR, route preload, resource cache behavior, and server RPC.

Exit bar: someone outside the repo can ship a small production app without the
framework author in the room.

## Testing Decisions

- The verification command is the release gate.
- Runtime tests should assert externally visible behavior and framework
  invariants, not private implementation details.
- Type tests should cover every rule where compile-time rejection is part of the
  product promise.
- Manifest and compiler tests should verify deterministic output, duplicate
  detection, unsafe imports, schema flags, route params, and client/server
  references.
- Request runtime tests should prove isolation between concurrent requests.
- Streaming tests should cover normal close, error, cancellation, and interrupted
  request work.
- Resource tests should cover cache hits, forced refresh, stale refresh, GC,
  hydration, failure retention, tag recording, invalidation planning, and event
  publication.
- Action tests should cover concurrency, retry, optimistic commit, optimistic
  rollback, invalidation planning, typed failures, and interruption.
- Form/action tests should cover schema typing, validation failure, redirect
  results, no-JS submissions, pending state, and progressive enhancement.
- Example tests should prove realistic full-stack flows rather than only unit
  behavior.

## Priority Order

1. Fix streamed response lifecycle behavior.
2. Add the verification command.
3. Add continuous integration.
4. Write the invariant document.
5. Land generated file-route manifests.
6. Harden server function manifests into bundling behavior.
7. Generate the app graph.
8. Expand compile-time tests around route, server, resource, action, and form
   misuse.
9. Finish progressive forms and action results.
10. Build runtime event and devtools timelines.
11. Add diagnostics.
12. Ship the reference app as the proof.

## Success Metrics

- The full verification command passes from a clean checkout.
- Every public async API has an Effect form.
- Every host/UI Promise API is documented as an adapter.
- Every generated manifest is deterministic.
- Unsafe client/server imports fail before production.
- Route, server function, resource, action, capability, and form misuse have
  compile-time coverage.
- Request isolation is covered by tests.
- Stream lifecycle and cancellation are covered by tests.
- Devtools can explain resource loads, collection loads/mutations,
  invalidations, route preloads, hydration, server RPC calls, and request
  runtime teardown.
- Resolved app graph diagnostics can flag route preloads whose resource-family
  or DB collection declarations are unknown.
- A new contributor or agent can add a full-stack feature by following documented
  framework conventions.
- A no-JS form post and a JS action submit run the same Action Definition,
  schemas, services, retry policy, typed results, invalidation, and hydration
  path.
- A test suite can replace server behavior with contract mocks and capability
  layers without importing a server handler module.
- A production bundle can be scanned for server-only vocabulary and pass without
  leaking handler code or seed data.
- A developer can inspect one app graph and answer: what routes exist, what they
  preload, which server functions/actions they can call, which resources and
  collections exist, which schemas are missing, and which modules own each
  boundary.
- The reference app demonstrates success, pending, stale refresh, validation
  failure, domain failure, redirect, optimistic update, rollback, hydration, and
  request isolation.

## Out Of Scope

- Replacing TSRX or Solid before the runtime semantics are stable.
- Chasing broad UI component library scope.
- Optimizing for many deployment targets before the core request/runtime
  semantics are proven.
- Building decorative devtools before causal diagnostics exist.
- Supporting every possible data fetching style instead of making Resource,
  Action, Capability, Server, and Route excellent.

## Further Notes

The framework should keep its center of gravity: Effect-native composition,
compile-time rejection, semantic invalidation, request isolation, and
agent-readable structure. The product becomes compelling when those are not
separate features but one system: the same graph that powers the compiler also
powers runtime diagnostics and agent workflows.
