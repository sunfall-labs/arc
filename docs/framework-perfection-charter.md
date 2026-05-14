# Framework Perfection Charter

This is the several-week cleanup, hardening, and iteration goal for moving
Effect UI from "impressive internal framework" to "basically perfect for a
serious first public release."

The goal is not literal perfection. The goal is that a strong TypeScript team
can build, debug, test, deploy, and extend a real full-stack app without needing
the framework author in the room.

## Mission

Over the next dedicated push, make Effect UI feel coherent, boringly reliable,
and unusually inspectable across its whole surface:

- every public API has a clear reason to exist;
- every async path preserves Effect semantics;
- every major guarantee is covered by behavior tests or type tests;
- every generated artifact is deterministic and useful to humans and agents;
- every example demonstrates the recommended path;
- every doc explains the actual implementation, not an aspiration;
- every remaining sharp edge is either fixed or named honestly.

The output should be a release candidate, not just a cleaner repo.

## Definition Of Basically Perfect

Effect UI is ready when all of these are true:

- `pnpm verify` is green on every working day and before final handoff.
- A new contributor can understand the architecture by reading `CONTEXT.md`,
  `docs/architecture.md`, `docs/effect-style.md`, and the generated app graph.
- The project console app proves the golden path end to end: schema-branded
  routes, resources, collections, actions, forms, SSR, hydration, validation,
  redirects, optimistic work, no-JS fallback, mocks, diagnostics, and leak scan.
- Devtools can explain the causal path from route match to preload, resource,
  collection, action, invalidation, hydration, and request teardown.
- Build diagnostics fail unsafe app graphs with owner-specific repair guidance.
- Package exports, names, errors, and docs are stable enough to support a small
  external app.
- There are no known misleading docs, stale examples, hidden global state leaks,
  accidental Promise-first framework internals, or untested compile-time rules.

## Operating Principles

- Prefer small vertical slices over sweeping rewrites.
- Keep APIs boring unless the extra power is backed by tests and docs.
- Treat type tests as product tests.
- Fix confusing names before external users learn them.
- Keep server-only and browser-safe boundaries explicit.
- Do not add new framework mini-languages when Effect already provides the
  right abstraction.
- Push async lifecycle, teardown, tracing, retries, streams, and host adapter
  work down into Effect primitives wherever possible. Promises should be host
  boundaries only: browser event handlers, Web Stream callbacks, Node/fetch
  adapters, and public convenience APIs.
- Make diagnostics and devtools consume public facts, not private maps.
- Mark uncertainty as unfinished work.

## Current Overnight Operating Requirement

For the current push, keep working until 8:00 AM America/Denver on May 14,
2026, unless blocked by required user input or an environment limitation. The
local timezone is MDT (`America/Denver`, UTC-06:00) on this date; use the
concrete timezone instead of the ambiguous "MST" label when recording evidence.

During this overnight window:

- prioritize implementation slices over prose-only planning;
- keep code Effect-first and move Promise code back to the smallest possible
  host boundary when found;
- run focused tests after each slice and `pnpm verify` after meaningful code
  changes;
- update `docs/perfection-progress.md` with each sweep and remaining concern;
- do not mark the goal complete until the 30 clean-sweep completion gate is
  actually satisfied.

## Team Shape

Run the effort as seven coordinated workstreams:

1. Core Runtime: `packages/core`
2. Start And Server: `packages/start`
3. DB And Local-First: `packages/db`, `packages/solid-db`
4. Devtools And Diagnostics: `packages/devtools`, Start graph diagnostics
5. Solid, TSRX, And Example App: `packages/solid`, `packages/tsrx`,
   `examples/project-console`
6. Docs And Developer Experience: `docs`, generated artifacts, examples
7. Release Engineering: package exports, CI, starters, benchmarks, changelog

Each workstream owns implementation, tests, docs, and checklist evidence for
its changes.

## Several-Week Plan

### Week 1: Audit And Cleanup

Goal: remove ambiguity before adding more surface area.

- Audit every package export and classify it as public, internal, or accidental.
- Remove or rename confusing APIs before they become stable.
- Review all docs against current implementation and file issues for stale
  claims.
- Audit error classes and messages for owner, cause, and repair guidance.
- Audit generated artifacts for deterministic ordering and source attribution.
- Run `pnpm verify` daily and record failures in the checklist.

Exit bar:

- Public API inventory exists.
- Docs drift list exists or is fixed.
- All known misleading examples are corrected.
- `pnpm verify` is green.

### Week 2: Runtime Hardening

Goal: make lifecycle behavior boring under stress.

- Audit Promise-shaped internals and push them into Effect programs wherever a
  host boundary does not require Promise callbacks.
- Stress-test resource refresh, stale state, failure, GC, deletion, hydration,
  and invalidation under concurrent reads.
- Stress-test action concurrency, optimistic rollback, retries, interruption,
  validation results, redirects, and Start transport hydration.
- Add leak tests for request-local Resource Store and Collection Store state.
- Add cancellation tests for streamed SSR, Node adapters, and client disconnects.
- Confirm every Promise helper delegates to an Effect-native path.

Exit bar:

- New lifecycle tests cover the risky edge cases found in audit.
- No hidden global mutable runtime state remains.
- Request and component teardown behavior is observable and tested.

### Week 3: App Graph And Diagnostics Wall

Goal: make unsafe app topology fail early with useful repair guidance.

- Tighten app graph diagnostics for route preload resources and collections.
- Harden action behavior metadata and wire schema policy.
- Add checks for manifest drift and unsafe module references.
- Make diagnostics reports clear enough for an AI agent to patch from.
- Ensure generated route maps preserve branded params and search types.

Exit bar:

- Strict diagnostics can be turned on in CI without false positives in the
  project console.
- Every diagnostics failure points to an owner and a concrete edit.
- App graph artifacts remain deterministic in tests.

### Week 4: Devtools Causality

Goal: close the biggest current winning-bar gap.

- Implement `DevtoolsRequestTrace`.
- Wire Start request runtimes to emit request trace facts.
- Include request context, response context, services summary, resources,
  collections, server functions, actions, fibers, streams, cancellation, and
  teardown.
- Add causal graph edges from request traces to routes, resources, collections,
  actions, invalidations, endpoints, and response facts.
- Build the first minimal devtools panel data model against this payload.

Exit bar:

- A failing or stale UI can be explained from public facts.
- Request traces are JSON-safe and deterministic.
- Devtools tests prove the full golden-path causal chain.

### Week 5: Example, Docs, And Starter Quality

Goal: prove that a user can copy the framework's intended path.

- Turn the project console into the canonical starter-quality example.
- Add a minimal starter or starter recipe.
- Add deployment docs for Node/fetch hosts currently supported.
  - Evidence: `docs/deployment.md`.
- Add migration notes from TanStack Query, TanStack Start, Remix-style forms,
  and ad hoc service mocks.
- Ensure every docs code sample is typechecked or explicitly illustrative.

Exit bar:

- A new app can follow the docs without reverse-engineering tests.
- The example app demonstrates every core promise in one coherent workflow.
- Public docs match package exports and generated artifacts.

### Week 6: Release Candidate Polish

Goal: stabilize the thing people will touch first.

- Review package names, exports, README-level install flow, and workspace
  scripts.
- Add benchmark baselines for SSR, route preload, resource cache behavior,
  live queries, and RPC/action transport.
- Add release notes that explain what is stable, experimental, and next.
- Freeze API names unless a change removes real confusion.
- Run a final multi-agent audit against the checklist and docs.

Exit bar:

- `pnpm verify` is green.
- Benchmarks have baseline numbers.
- Release notes and starter docs exist.
- No checked claim lacks evidence.
- Remaining gaps are explicitly listed as post-RC work.

## Cleanup Backlog

Use this as the first pass backlog. Do not treat it as complete; add items as
the audit finds them.

- [x] Public export inventory for every package.
  - Evidence: `docs/public-api-inventory.md`.
- [x] Error message audit with repair guidance.
  - Evidence: `docs/error-message-audit.md`; no raw `Error`/`TypeError` throws
    remain in package source as of the typed-error sweep.
- [x] Sharp cast audit.
  - Evidence: `docs/sharp-cast-audit.md`; remaining package-source casts are
    named as runtime service-erasure and query context-variance boundaries.
- [x] Docs drift audit.
  - Evidence: `docs/docs-drift-audit.md`; stale teardown and Promise-method
    follow-ups were updated after implementation landed.
- [x] Generated artifact determinism audit.
  - Evidence: `docs/generated-artifact-audit.md`; file route manifests have
    reversed-input serialization regression coverage.
- [x] Type-test coverage audit.
  - Evidence: `docs/type-test-coverage-audit.md`; request trace teardown
    contracts and Promise-returning `onRequestTrace` handlers are covered by
    type tests.
- [x] Runtime leak and teardown audit.
  - Evidence: `docs/runtime-leak-teardown-audit.md`; Resource Store disposal now
    shuts down event channels even when module finalizers fail.
- [x] Example app copyability audit.
  - Evidence: `docs/example-copyability-and-leak-audit.md`; the example now has
    local test/build/leak-scan/verify scripts plus copy guidance.
- [x] Package export and dependency hygiene audit.
  - Evidence: `docs/package-hygiene-audit.md`; `@effect-ui/start` now declares
    its direct `effect` dependency.
- [x] Browser/server leak audit beyond the current example scan.
  - Evidence: `docs/example-copyability-and-leak-audit.md`; leak assertions now
    include server module sentinels in package-local scripts and tests.
- [x] Benchmark baseline audit.
  - Evidence: `docs/benchmark-baseline-audit.md`; `pnpm benchmark` now covers
    SSR, route preload, Resource cache behavior, live query materialization,
    and RPC transport.

## Must-Fix Workstreams

### Devtools Request Trace

This is the highest-leverage remaining win condition.

Progress:

- [x] Devtools-side `DevtoolsRequestTrace` data model, store recording, summary,
  and causal graph integration.
- [x] Start request-runtime emission hook for SSR, server RPC, Start actions,
  and response stream close.
- [x] Start request-runtime trace assertions for stream cancellation and request
  failure paths.
- [x] Richer teardown details beyond runtime disposal, stream state, and reason.
  - Evidence: request traces now include start/completion timestamps, duration,
    and before/after Resource Store teardown snapshots.

Deliver:

- `DevtoolsRequestTrace` data model.
- Start request-runtime instrumentation.
- Tests for SSR render, server RPC, Start actions, streamed response close,
  streamed response cancellation, ResponseContext, Resource events, Collection
  events, and teardown.
- Docs in `docs/devtools.md` and `docs/architecture.md`.

### Public API Tightening

Deliver:

- Public/internal export map for each package.
- Rename/remove list with rationale.
- Type tests for every compile-time rejection rule.
- Migration notes for any changed name.

### Starter-Quality Example

Deliver:

- A project-console walkthrough.
- A minimal starter recipe.
- Copyable examples for resources, actions, forms, collections, server
  contracts, mocks, and deployment.
- Example leak scan and build proof in `pnpm verify`.

### Release Engineering

Deliver:

- Stable package export map.
- CI release gate.
- Benchmark baseline.
- Release notes.
- Known limitations list.

## Daily Loop

Every day:

1. Pick a narrow slice.
2. Confirm the existing test or write the missing failing test.
3. Implement the smallest fix that improves the release candidate.
4. Update docs and checklist evidence in the same change.
5. Run focused tests.
6. Run `pnpm verify` before handoff or before merging.
7. Record what got better, what evidence proves it, and what still worries the
   team.

## Final Completion Audit

Before calling the several-week push done, the team must produce:

- shipped capability summary;
- package/docs/examples changed;
- final `pnpm verify` output summary;
- benchmark baseline summary;
- public API inventory;
- remaining unchecked checklist items;
- known limitations;
- next post-RC roadmap;
- ADR candidates or docs decisions.

The final handoff should be boring: every important claim points to a file,
test, generated artifact, diagnostic output, benchmark, or docs page.
