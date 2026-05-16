# Architecture Deepening Review

This ledger tracks repeated `$improve-codebase-architecture` reviews. Each
finding uses the project vocabulary from `CONTEXT.md` and the architecture
language of Module, Interface, Implementation, Seam, Adapter, Depth, Leverage,
and Locality.

The goal is not to claim literal perfection from one pass. The goal is to keep
review findings concrete, fix the ones that should move now, and leave only
explicitly scoped future work.

## Current Review Tip

The newest completed focused review and full verification checkpoint is
Review185, the starter catalog typed-error and audit-doc current-gate cleanup
found by the fresh post-Review184 sweep. Some older review entries remain below
this tip from prior ledger merges; use this tip rather than file order alone
when looking for the latest architecture sweep.

The fresh post-Review184 subagent sweep reported no actionable Core/React/Solid
or DB/public API findings after focused verification. The Start/devtools/scripts
pass found the Review185 script-error and audit-doc drift below. Do not start
the clean-sweep counter until a fresh full sweep after Review185 finds no
actionable Module, Interface, Seam, Adapter, Locality, Depth, Leverage, typed
error, or docs drift work.

## Review 185: Starter Catalog Typed Error And Audit Docs Current Gate

Review185 fixed the two actionable findings from the fresh post-Review184
subagent sweep.

1. Starter Catalog Typed Error Seam
   - Status: fixed.
   - Files: `scripts/starter-catalog.mjs`,
     `scripts/package-project-console-starter.mjs`,
     `scripts/verify-package-dry-runs.mjs`,
     `scripts/audit-effect-first.mjs`, `docs/perfection-progress.md`.
   - Problem: `assertStarterCatalogConsistency(...)` ran at module import and
     threw a raw `Error`. That was in the starter packaging and package dry-run
     verification path, while the current ledger claimed package/example/script
     raw throws were clean.
   - Fix: added `StarterCatalogError`, `starterCatalogConsistencyEffect(...)`,
     and `starterCatalogConsistencyFailures(...)`. The Effect-driven starter
     packaging and package dry-run scripts now validate the catalog through the
     typed Effect seam, while the synchronous Effect-first audit reports
     catalog failures without throwing.
   - Benefits: starter catalog validation now has typed error Locality in the
     script Adapter seam, and the raw-throw documentation matches the actual
     source grep.

2. Audit Docs Current-Gate Wording
   - Status: fixed.
   - Files: `docs/effect-first-audit.md`, `docs/sharp-cast-audit.md`,
     `docs/package-hygiene-audit.md`.
   - Problem: current-facing audit docs still called older Review165 and
     Review179 gates "latest" even though Review184 was the current full gate.
     That recreated the docs drift pattern fixed in Review184.
   - Fix: changed those audit docs to name Review184 as the current full gate
     and demoted Review165/179 to historical focused evidence for their slices.
   - Benefits: audit docs now have one current verification story, so future
     sweeps do not need to reconcile competing "latest full gate" claims.

Focused verification after the patch: script syntax checks, raw
package/example/script throw grep, stale "latest" wording grep, `pnpm
starter:package`, `pnpm example:pack-dry-run`, `pnpm audit:effect-first`, and
`git diff --check` passed. Full `pnpm verify` passed after Review185 through
the Effect-driven runner: 11 package builds, workspace typecheck, public type
tests, public API inventory audit, Effect-first audit over 404
physical/virtual files, 53 root test files / 1033 tests, package-level
verifies, generated starter packaging, 16-target package dry-run gate,
project-console checks, and leak scans.

## Review 184: Current Status Docs Drift

Review184 fixed the only actionable finding from the fresh post-Review182
subagent sweep.

1. Current Status Historical Review Wording
   - Status: fixed.
   - Files: `docs/perfection-progress.md`.
   - Problem: the current-status section correctly named Review182 as the
     latest focused slice and full gate, but later bullets still called
     Review166 the "latest" slice and Review165/163 "previous" slices. That
     reintroduced a current-facing docs drift Seam: readers had to reconcile
     competing "latest" narratives before trusting the completion ledger.
   - Fix: demoted those Review166/165/163 and Review167 bullets to historical
     evidence language, leaving the current Review182/Review184 and clean-sweep
     state as the only present-tense readiness narrative.
   - Benefits: readiness docs regain Locality. Future sweeps can trust the
     Current Status block without mentally subtracting old review wording.

Focused verification after the patch: docs drift grep for stale "latest
focused Review16" wording, `pnpm audit:effect-first`, and `git diff --check`
passed. Full `pnpm verify` passed after Review184 through the Effect-driven
runner: 11 package builds, workspace typecheck, public type tests, public API
inventory audit, Effect-first audit over 404 physical/virtual files, 53 root
test files / 1033 tests, package-level verifies, generated starter packaging,
16-target package dry-run gate, project-console checks, and leak scans. The
Core/React/Solid and DB/public API subagents reported no actionable findings
and ran focused typechecks/tests; the Start/devtools/scripts subagent confirmed
Review173 and Review179 remain closed and package dry-runs pass.

## Review 182: DB Hover Docs And Expert Interface Pins

Review182 fixed the DB public Interface and LSP hover-doc findings from the
fresh post-Review180 subagent sweep.

1. DB Public Hover Docs
   - Status: fixed.
   - Files: `packages/db/src/collection-contract.ts`,
     `packages/db/src/query-plan.ts`, `packages/db/src/flush-policy.ts`,
     `packages/db/src/sqlite-persistence.ts`,
     `scripts/public-api-symbol-policy.mjs`, `docs/public-api-inventory.md`.
   - Problem: important public DB contract declarations were exported and
     type-tested, but many of the types users and agents hover in editors did
     not explain their role. Collection keys/origins, pending mutations,
     store/diagnostic records, Query plan diagnostics, flush/background-sync
     result types, and SQLite statement params were public Interfaces without
     enough declaration-site guidance.
   - Fix: added concise JSDoc to the public Collection contract, Query plan,
     flush/background-sync, and SQLite persistence declarations. The public
     symbol policy now curates DB hover-doc groups for Collection contract
     types, Query plan diagnostics, flush/background-sync result types,
     collection reactive binding helpers, server collection adapters, and
     SQLite persistence helpers.
   - Benefits: the DB root has better Locality for LSP documentation. Editors,
     generated docs, and agent tools now see the purpose of the expert-public
     Interfaces at the declaration that owns them.

2. DB Expert-Public Adapter Pins
   - Status: fixed.
   - Files: `type-tests/db.test-d.ts`,
     `type-tests/public-api.manifest.json`, `docs/public-api-inventory.md`.
   - Problem: reactive binding, server collection, background flush, and
     SQLite adapter exports were public enough for integrations, but the
     focused DB type test did not pin the full expert-public surface. That made
     accidental API drift easier than it should be for downstream adapter
     authors.
   - Fix: expanded the DB type test and public API manifest to directly import
     and exercise collection reactive binding helpers, server collection
     helpers/errors/options, flush/background-sync result surfaces, and SQLite
     prepared-statement helpers.
   - Benefits: the DB package now has stronger executable coverage for its
     public Adapter seams. Release decisions in the inventory match the actual
     import surface.

Focused verification passed for Review182: `pnpm audit:public-api`, `pnpm
typecheck:types`, `pnpm --filter @effect-ui/db typecheck`, and `pnpm
audit:effect-first`.

Full `pnpm verify` passed after Review182 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 404 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1033 tests, package-level verifies, generated starter packaging for
basic/react/project-console, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans.

## Review 181: Adapter Runtime Locality

Review181 fixed the Core/React/Solid blockers from the fresh post-Review180
subagent sweep.

1. React Scoped Hook Runtime Spine
   - Status: fixed.
   - Files: `packages/react/src/runtime.ts`,
     `packages/react/test/hooks.test.ts`.
   - Problem: `useScoped(...)` installed only the `UiScope` while constructing
     scoped work. Work created during that synchronous construction could miss
     the React provider's Runtime Spine even though it lived inside the adapter
     scope.
   - Fix: `useScoped(...)` now captures the active React runtime and runs the
     construction callback inside both `runWithRuntime(...)` and
     `runWithScope(...)`. The regression proves a scoped construction can read
     provider-owned Resource state.
   - Benefits: React component scopes now keep runtime ownership local to the
     React Adapter. Callers do not have to re-provide services that the
     provider already owns.

2. Solid Browser Router Server Construction
   - Status: fixed.
   - Files: `packages/solid/src/router.ts`,
     `packages/solid/test/router.test.ts`.
   - Problem: `createBrowserRouter(...)` started navigation/preload work during
     server or non-browser construction. That leaked Browser Router host work
     across the Adapter boundary before a browser host existed.
   - Fix: the Solid adapter starts the browser-router controller only when
     `canUseBrowser()` is true. In non-browser construction the controller
     remains ready and inert, with a no-op stop function.
   - Benefits: browser-only navigation and preload Effects stay local to the
     browser Adapter. Server construction can create router state without
     performing host work.

Focused verification passed for Review181: React and Solid hook/router
regressions with `pnpm exec vitest run packages/react/test/hooks.test.ts
packages/solid/test/router.test.ts`, `pnpm typecheck:types`, React and Solid
package typechecks, and `pnpm audit:effect-first`.

Full `pnpm verify` passed after Review181 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit, 53 root test files / 1033 tests, package-level
verifies, generated starter packaging, 16-target package dry-run gate,
project-console checks, and leak scans.

## Review 180: DB Interface Pins

Review180 fixed the first DB public Interface finding from the fresh
post-Review179 review.

1. DB Namespace Alias Decision
   - Status: fixed.
   - Files: `packages/db/src/index.ts`, `type-tests/db.test-d.ts`,
     `type-tests/public-api.manifest.json`, `docs/public-api-inventory.md`.
   - Problem: `createCollection`, `createLiveQuery`, and
     `createLiveQueryCollection` existed as top-level public aliases, but the
     docs and focused type tests did not clearly classify them. That made the
     DB Interface shallower than the namespace-owned `Collection` and `Query`
     APIs users should discover first.
   - Fix: documented the aliases as compatibility exports with deprecation
     JSDoc pointing to `Collection.define(...)`, `Query.live(...)`, and
     `Collection.liveQuery(...)`. The DB type test and public API manifest now
     pin those aliases directly.
   - Benefits: the namespace-owned APIs keep better Depth and LSP discoverable
     ownership, while existing app code keeps a tested compatibility path.

Focused verification for the DB Interface pins was covered by the public API
audit and type-test gates, and the later Review182 full `pnpm verify` covered
the resulting DB root surface.

## Review 179: Verification Guardrails

Review179 fixed the verification and package-gate findings from the fresh
post-Review178 review.

1. Workspace Verification Plan
   - Status: fixed.
   - Files: `scripts/workspace-verification-plan.mjs`,
     `scripts/verify.mjs`, `docs/public-api-inventory.md`.
   - Problem: the Effect-driven root verifier still hard-coded the list of
     example/starter package verifies. A new copyable package with a local
     `verify` script could be skipped unless the root plan was manually
     updated.
   - Fix: added an Effect-backed Workspace Verification Plan Module that
     discovers package manifests, selects packages with non-empty `verify`
     scripts, applies stable display labels, and feeds that list into
     `scripts/verify.mjs`.
   - Benefits: package-level verification has better Leverage and Locality.
     Adding a package-level verify script now automatically includes the
     package in the root Effect v4 verification command.

2. Package Dry-Run Artifact Guardrails
   - Status: fixed.
   - Files: `scripts/verify-package-dry-runs.mjs`,
     `docs/package-hygiene-audit.md`.
   - Problem: dist package rehearsal checked source stems, but did not require
     concrete `*.js.map` and `*.d.ts.map` artifacts for every source stem.
     Source packages also did not require a local `verify` script, so copyable
     apps could drift outside the main verification command.
   - Fix: the dry-run gate now validates concrete JavaScript, declaration, and
     source-map artifacts for framework packages, keeps explicit allowances for
     copied declarations such as Start's virtual module, and requires
     source-package verify scripts.
   - Benefits: package rehearsal now catches stale or incomplete publication
     payloads earlier, and copyable packages must prove how they are verified.

3. Public API Subpath Surface Guard
   - Status: fixed.
   - Files: `scripts/audit-public-api-inventory.mjs`,
     `type-tests/public-api.manifest.json`, `docs/public-api-inventory.md`.
   - Problem: public subpath entrypoints could re-export local Modules without
     the manifest naming that source surface explicitly. That left expert
     subpaths less auditable than root package barrels.
   - Fix: the public API inventory audit now validates manifest `sourceSurface`
     entries for subpath entrypoints against their local re-exported Modules.
   - Benefits: public subpath Interfaces now have the same executable inventory
     pressure as root package Interfaces.

Focused verification passed for Review179: package dry-runs, public API audit,
Effect-first audit over 404 files, and the updated Effect-driven workspace
verification plan self-test. The later Review182 full `pnpm verify` covered the
same root verification path.

## Review 178: Browser Router Initial Matched State

Review178 fixed the fresh post-Review177 React/Solid hydration policy finding.

1. Browser Router Initial Matched State Policy
   - Status: fixed.
   - Files: `packages/core/src/browser-router-kernel.ts`,
     `packages/core/test/browser-router.test.ts`,
     `packages/react/src/router.ts`, `packages/react/test/router.test.ts`,
     `packages/solid/src/router.ts`, `examples/react-starter/src/App.tsx`,
     `examples/react-starter/src/main.tsx`, `type-tests/core.test-d.ts`,
     `type-tests/react.test-d.ts`, `type-tests/solid.test-d.ts`,
     `scripts/public-api-symbol-policy.mjs`, `docs/public-api-inventory.md`,
     `CONTEXT.md`.
   - Problem: the Browser Router Host Controller exposed an
     `initialMatchedState` Seam, but React and Solid still owned divergent
     initial route-state policy. Solid started existing-DOM hydration ready;
     React started every browser render pending, which could replace SSR-ready
     output during `hydrateRoot` while route preload was unresolved.
   - Fix: added Core `browserRouterInitialMatchedState(...)` plus typed host
     facts for browser/server and hydration. React and Solid now consume the
     shared policy. React exposes an explicit `hydrating` option and the React
     starter passes it from the `hydrateRoot` branch; Solid keeps its existing
     owner hydration detection while using the same Core helper.
   - Benefits: initial route hydration policy now has one Core Interface.
     Framework Adapters keep host detection and reactivity local while Core
     owns the Ready-vs-Pending decision, giving better Locality and Leverage to
     tests for future Adapters.

Focused verification passed for Review178: Core, React, Solid, and React
starter typechecks; public type tests; public API inventory audit; Core browser
router tests 1 file / 15 tests; React router tests 1 file / 15 tests; Solid
router tests 1 file / 31 tests; and React starter tests 1 file / 3 tests.

Full `pnpm verify` passed after Review178 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 403 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1031 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter package generation for basic/react/project-console at
19/24/30 app files with 5/4/6 local packages, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans.

## Review 177: Runtime UI Scope Frame

Review177 fixed the remaining route-owned `UiScope` lifecycle finding from the
fresh post-Review173 architecture sweep.

1. Runtime UI Scope Frame
   - Status: fixed.
   - Files: `packages/core/src/scope.ts`,
     `packages/core/test/scope.test.ts`,
     `packages/react/src/route-render-scope.ts`,
     `packages/react/src/runtime.ts`,
     `packages/solid/src/route-render-scope.ts`,
     `packages/solid/src/runtime.ts`,
     `type-tests/core.test-d.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`,
     `scripts/public-api-symbol-policy.mjs`.
   - Problem: React and Solid route render controllers both had to remember how
     to create a runtime-owned `UiScope`, install runtime and scope during
     synchronous route construction, and dispose finalizers through the owning
     Runtime Spine. Component scopes in the runtime adapters carried the same
     shape.
   - Fix: added the Core `RuntimeUiScopeFrame` Interface and
     `makeRuntimeUiScopeFrame(...)` helper. React and Solid route render
     controllers and component-scope helpers now consume the shared frame while
     keeping host-specific render/error/cleanup ordering local.
   - Benefits: runtime-owned UI lifetimes now have one Core Seam. Adapters get
     better Locality for host behavior, while Core owns the ambient runtime,
     ambient `UiScope`, late finalizer, and runtime-bound disposal policy.

Focused verification passed for Review177: Core, React, and Solid typechecks;
public type tests; public API inventory audit; Core scope tests 1 file / 9
tests; React router tests 1 file / 14 tests; Solid router tests 1 file / 31
tests; React/Solid hook tests 2 files / 40 tests; Effect-first audit over 403
physical/virtual files; and `git diff --check`.

Full `pnpm verify` passed after Review177 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 403 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1029 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter package generation for basic/react/project-console at
19/24/30 app files with 5/4/6 local packages, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans.

## Review 176: Public Hover Symbol Coverage

Review176 fixed the remaining public-symbol/LSP finding from the fresh
post-Review173 architecture sweep.

1. Public Hover Symbol Policy Coverage
   - Status: fixed.
   - Files: `scripts/public-api-symbol-policy.mjs`,
     `packages/core/src/resource-ui-binding.ts`,
     `packages/core/src/browser-router-render-decision.ts`,
     `packages/react/src/runtime.ts`, `packages/solid/src/runtime.ts`.
   - Problem: several expert-public Adapter seams were exported and documented
     in prose, but not listed in the executable hover-doc policy. That left
     Resource UI Binding, Browser Route Render Decision, and React/Solid
     Runtime Adapter declarations dependent on convention instead of the LSP
     audit.
   - Fix: added hover-doc policy groups for those Modules and filled the
     missing declaration-site JSDoc. The public API audit now pins the helper
     functions, controller types, runtime contexts, provider props, and
     route-render identity declarations.
   - Benefits: LSP-facing documentation has stronger Locality. Expert-public
     Adapter authors can discover what each Interface is for directly from
     declarations, and future edits cannot silently drop those hover docs.

Focused verification passed for Review176: Core, React, and Solid typechecks;
public type tests; public API inventory audit; Effect-first audit over 403
physical/virtual files; and `git diff --check`.

Full `pnpm verify` passed after Review176 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 403 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1028 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter package generation for basic/react/project-console at
19/24/30 app files with 5/4/6 local packages, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans.

## Review 175: Browser Router Link Preload Identity

Review175 fixed the Core/React/Solid RouterLink preload identity finding from
the fresh post-Review173 architecture sweep.

1. Browser Router Link Preload Identity
   - Status: fixed.
   - Files: `packages/core/src/browser-router-link.ts`,
     `packages/react/src/link.ts`, `packages/solid/src/link.ts`,
     `packages/core/test/browser-router.test.ts`,
     `type-tests/core.test-d.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`,
     `scripts/public-api-symbol-policy.mjs`.
   - Problem: Core already owned `BrowserRouterLinkPreloadIdentity`, but React
     and Solid still built the identity key and enabled flag themselves. That
     made the Core Interface shallow: adapters had to know the key fields,
     string coercion, delimiter, and event-free enabled decision.
   - Fix: added `browserRouterLinkPreloadIdentity(...)` and
     `BrowserRouterLinkPreloadIdentityOptions` to the Core Browser Router Link
     Decision policy. React and Solid now pass href, preload enablement, active
     router membership, target, and download facts to Core instead of
     reconstructing the key locally.
   - Benefits: RouterLink preload identity has better Depth and Locality. The
     public Core Interface owns the stable key contract, while framework
     Adapters keep DOM events, host reactivity, and owner cleanup local.

Focused verification passed for Review175: Core, React, and Solid typechecks;
Core browser-router tests 1 file / 14 tests; React router tests 1 file / 14
tests; Solid router tests 1 file / 31 tests; public type tests; and public API
inventory audit.

Full `pnpm verify` passed after Review175 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 403 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1028 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter package generation for basic/react/project-console at
19/24/30 app files with 5/4/6 local packages, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans.

## Review 174: Collection Policy Cleanup

Review174 fixed two DB findings from the fresh post-Review173 architecture
sweep.

1. Stale Collection State Implementation
   - Status: fixed.
   - Files: `packages/db/src/collection-state.ts`.
   - Problem: `replaceCollectionRows(...)` was exported but unused after the
     newer Collection Row Ingress and Collection Sync Load Policy Modules took
     over row replacement. Keeping it around created a stale Implementation
     that bypassed schema decode, `EffectInputCallbackError` normalization,
     row-value detachment, and optimistic rebase policy.
   - Fix: deleted the helper. Remote row replacement now stays local to the
     Collection Sync Load Policy path that already ingests, validates, detaches,
     replaces, rebases, persists, and publishes load events.
   - Benefits: Collection State has better Locality. It owns state shape and
     small state mutations, while load-owned remote replacement policy remains
     behind the load Module's Interface.

2. Collection Policy Module
   - Status: fixed.
   - Files: `packages/db/src/collection-policy.ts`,
     `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/src/collection-mutation-workflow.ts`, `CONTEXT.md`,
     `docs/db.md`.
   - Problem: `policy.retry` was documented as one Collection Definition
     execution policy, but load and mutation work each carried a private retry
     wrapper. That shallow duplication made the Interface look unified while
     the Implementation could drift.
   - Fix: added an internal Collection Policy Module that applies
     `policy.retry` to load and mutation Effects. Collection Sync Load Policy
     and Collection Mutation Workflow now consume the same retry Seam.
   - Benefits: retry semantics gain Depth and Locality. The public policy
     Interface has one implementation point, and future load/mutation policy
     changes can be tested through the shared Module instead of paired copies.

Focused verification passed for Review174: `pnpm --filter @effect-ui/db
typecheck`, `pnpm --filter @effect-ui/db build`, and `pnpm exec vitest run
packages/db/test/collection.test.ts` with 139 tests.

Full `pnpm verify` passed after Review174 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 403 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1028 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter package generation for basic/react/project-console at
19/24/30 app files with 5/4/6 local packages, 16-target package dry-run gate
including the 149-file `@effect-ui/db` package rehearsal, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans.

## Review 173: Start Virtual Declaration Artifact Adapter

Review173 fixed a generated-artifact guardrail gap found by the fresh
post-Review171 Start/scripts/docs sweep.

1. Start Virtual Declaration Artifact Adapter
   - Status: fixed.
   - Files: `scripts/verify-package-dry-runs.mjs`,
     `packages/start/src/virtual-modules.d.ts`,
     `docs/generated-artifact-audit.md`, `CONTEXT.md`.
   - Problem: `@effect-ui/start/virtual` is a copied declaration Adapter:
     `packages/start/src/virtual-modules.d.ts` is copied to
     `packages/start/dist/virtual.d.ts`. The package dry-run gate verified that
     the manifest target existed and that dist artifact stems matched source
     stems, but it did not prove the copied public declaration bytes still
     matched the source Interface or that stale `dist/virtual.d.ts.map` files
     were absent.
   - Fix: added explicit declaration artifact policy to the package dry-run
     Module. `@effect-ui/start` now declares the source declaration, copied
     output declaration, and forbidden declaration map. The verifier checks the
     packed output path, compares source/output bytes through Effect, rejects
     stale forbidden files, and self-tests the copied-declaration policy. The
     source virtual declaration indentation was normalized so the public LSP
     surface is readable before and after the build copy.
   - Benefits: generated declaration Adapter policy gains Locality. The
     package rehearsal now catches public virtual declaration drift at the same
     release Seam that already catches package target and stale dist drift.

Focused verification passed for Review173: `node --check
scripts/verify-package-dry-runs.mjs`, `pnpm --filter @effect-ui/start build`,
and `pnpm example:pack-dry-run`.

Full `pnpm verify` passed after Review173 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 402 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1028 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter package generation for basic/react/project-console at
19/24/30 app files with 5/4/6 local packages, 16-target package dry-run gate
including the Start virtual declaration byte check, project-console typecheck,
4 project-console test files / 27 tests, project-console build, and leak scans.

## Review 172: Stale Carry-Forward Docs Cleanup

Review172 fixed current-facing docs that still said broader Review167
candidates remained carried forward after Reviews168-171 had closed them.

1. Review167 Follow-Up Status
   - Status: fixed.
   - Files: `docs/architecture-deepening-review.md`, `docs/release-notes.md`.
   - Problem: old current-facing language still implied the Review167
     starter/catalog, public symbol, docs snippet, Start abort, Devtools graph,
     and Query Execution Plan candidates were open.
   - Fix: updated the Review167 carry-forward section and release notes to
     state that Reviews168-171 closed those candidates or, for the compiled
     Query Execution Plan candidate, re-reviewed it as already handled.
   - Benefits: the review ledger has better Locality for current status: fresh
     sweeps do not have to mentally subtract already-closed follow-ups.

Focused verification passed for Review172: `pnpm audit:effect-first` and
`git diff --check`.

## Review 171: Public API Symbol Policy Module

Review171 fixed the declaration-level public symbol policy Seam that remained
after Review170. The compiled Query Execution Plan candidate was re-reviewed
and closed as already handled by the existing Query Execution Plan Module.

1. Public API Symbol Policy Module
   - Status: fixed.
   - Files: `scripts/public-api-symbol-policy.mjs`,
     `scripts/audit-public-api-inventory.mjs`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: declaration-level public surface policy was split across
     hard-coded hover-doc groups in the audit script, namespace-backed
     source-module allowances in the same script, manifest-local direct
     type-test import pins, and narrative docs. Package export paths and source
     modules were guarded, but the curated public symbol policy had no single
     Module and could point at an internal orphan file without a dedicated
     failure.
   - Fix: added the Public API Symbol Policy Module. It owns curated LSP hover
     declaration groups and namespace-backed source-module allowances. The
     Public API Inventory Audit now imports that policy, enforces the existing
     JSDoc/type-test rules through it, and rejects hover policy files that are
     not reachable from a package export or re-exported public source Module.
   - Benefits: public symbol policy has better Locality and more Depth. Adding
     or promoting a public hover pin now changes one policy Module, and the
     audit proves those pins still describe exported source rather than internal
     implementation files.

2. Compiled Query Execution Plan Candidate
   - Status: closed as no-op.
   - Files reviewed: `packages/db/src/query-execution-plan.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/src/live-query-state.ts`, `packages/db/test/collection.test.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Decision: the existing Query Execution Plan Module already owns source
     Adapter selection, validation, source preload/refetch, snapshot execution,
     diagnostics, stable equal-order tie-break identity, and final projection
     stages. Live Query Runtime still compiles the IVM graph, but that is a
     different runtime mechanics Seam rather than duplicated query execution
     policy. A new compiled immutable plan type would mostly wrap the already
     immutable Query Builder plus cached derived facts, so it would add
     interface cost without enough Leverage right now.

Focused verification passed for Review171: `pnpm audit:public-api` and
`pnpm audit:effect-first` over 402 files.

Full `pnpm verify` passed after Review171 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 402 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1028 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter package generation for basic/react/project-console at
19/24/30 app files with 5/4/6 local packages, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans.

## Review 170: Starter Catalog Manifest And Effect Verify Runner

Review170 fixed the starter/catalog Seam carried forward from Review169 and
adopted the Effect-driven workspace verify runner that was already present in
the worktree.

1. Starter Catalog Manifest Module
   - Status: fixed.
   - Files: `scripts/starter-catalog.mjs`,
     `scripts/package-project-console-starter.mjs`,
     `scripts/verify-package-dry-runs.mjs`,
     `scripts/generated-starter-artifacts.mjs`,
     `scripts/starter-template-content.mjs`,
     `scripts/audit-effect-first.mjs`, `docs/starter.md`, `CONTEXT.md`.
   - Problem: copyable starter identity lived in several shallow
     Implementations: packaging owned generated starter definitions, package
     dry-run verification owned source package payload policy, generated
     artifact drift checks owned route/virtual artifact lists, and the
     Effect-first audit owned generated starter virtual template descriptors.
   - Fix: added the Starter Catalog Manifest Module. It owns starter ids,
     source package names, generated package names, source/output directories,
     generated Vite/tsconfig/README content, source-package required files, and
     generated route/virtual artifacts with a pure consistency self-test.
     Packaging, generated artifact checks, source package dry-runs, and
     Effect-first virtual template audits now consume the catalog Interface.
   - Benefits: the starter/catalog Seam has more Depth and better Locality.
     Adding or renaming a starter changes one catalog Module instead of several
     script-local copies.

2. Effect-Driven Workspace Verify Runner
   - Status: fixed.
   - Files: `package.json`, `scripts/verify.mjs`,
     `scripts/audit-effect-first.mjs`.
   - Problem: the root `verify` command was a long package-script chain, so
     gate grouping, concurrency, output labeling, and failure reporting were
     shell-string policy rather than an Effect Module.
   - Fix: adopted `scripts/verify.mjs` as the root verify runner and kept the
     old chain as `verify:serial`. The runner uses Effect callbacks for host
     process execution, `Effect.all` for source and example lanes, typed
     command failures, prefixed output, and a prebuilt-package Adapter for
     starter packaging after the package build lane. The Effect-first audit
     now treats that runner as an explicit script-runner Adapter seam.
   - Benefits: verification orchestration gets better Leverage from one Effect
     Interface, while the serial shell chain remains available as a fallback.

Focused verification passed for Review170: catalog import self-test,
`pnpm audit:effect-first` over 401 files, `pnpm example:pack-dry-run`, and
`pnpm starter:package`.

Full `pnpm verify` passed after Review170 through the Effect-driven runner: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 401 physical/virtual
package/example/config/script/type-test/generated/docs files, 53 root test
files / 1028 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, starter-suite packaging/verifies for basic/react/project-console
at 19/24/30 app files with 5/4/6 local packages, 16-target package dry-run
gate, project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans.

## Review 169: Start Abort Lifecycle And Host Response Cancellation

Review169 fixed the Start abort/lifecycle Seam that remained after earlier
request-runtime and outbound fetch abort work.

1. Start Abort Signal Lifecycle Module
   - Status: fixed.
   - Files: `packages/start/src/start-abort-lifecycle.ts`,
     `packages/start/src/start-fetch.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/start-host-runtime-runner.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`.
   - Problem: Start Fetch Transport, Fetch host facades, Vite dev SSR body
     readers, and host callback runners each carried a local abort listener
     Implementation. The duplicated Interface made fallback listener cleanup,
     abort reason propagation, already-aborted signals, and host-fiber
     interruption a memory task across Adapters.
   - Fix: added the internal Start Abort Signal Lifecycle Module. It owns
     signal merging, native `AbortSignal.any(...)` delegation, fallback
     listener cleanup, abort reason propagation, scoped abort finalizers, and
     forked host-fiber interruption. The existing Adapters now consume that
     Module instead of carrying their own listener policy.
   - Benefits: abort policy has more Depth at one Interface. Fetch, Vite, and
     Node/Vite callback Adapters get shared Leverage, and future cancellation
     fixes have better Locality.

2. Fetch Host Post-Response Stream Abort
   - Status: fixed.
   - Files: `packages/start/src/streaming.ts`,
     `packages/start/src/response-lifetime.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/test/streaming.test.ts`,
     `packages/start/test/adapters.test.ts`.
   - Problem: `createFetchHandler(...)` connected `Request.signal` to Effect
     execution until the host `Promise<Response>` resolved, but a later request
     abort did not cancel an outstanding streamed response body. Request Runtime
     finalization already closes when the body closes/cancels/errors, so the
     missing Adapter behavior could leave Scope lifetime dependent on whether a
     Fetch host cancelled returned bodies for the library.
   - Fix: `responseWithStreamFinalizer(...)` now accepts an abort signal and
     reports abort-driven cancellation through the same stream finalization
     path, including the pending-read race where cancellation can otherwise
     look like a clean close. `responseWithScopeLifetimeEffect(...)` exposes
     that policy, and the Fetch host Adapter passes the merged
     request/runOptions signal with a stable `request-abort` teardown reason.
   - Benefits: Start Host Response Abort Policy is local to the response
     lifetime Module instead of being left to each host Adapter. Fetch facades
     release request Scopes and upstream streams when the inbound request
     disconnects after response creation.

Focused verification passed for Review169: Start package typecheck,
`pnpm vitest run packages/start/test/streaming.test.ts -t "abort signals|finalizes wrapped"`,
`pnpm vitest run packages/start/test/adapters.test.ts -t "abort|streamed bodies are cancelled"`,
and `pnpm vitest run packages/start/test/adapters.test.ts packages/start/test/streaming.test.ts packages/start/test/rpc.test.ts packages/start/test/start.test.ts`
with 4 files / 211 tests.

Full `pnpm verify` passed after Review169: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 399 physical/virtual package/example/config/script/type-test/generated/docs
files, 53 root test files / 1028 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, starter-suite packaging/verifies for
basic/react/project-console at 19/24/30 app files with 5/4/6 local packages,
16-target package dry-run gate, project-console typecheck, 4 project-console
test files / 27 tests, project-console build, and leak scans.

## Review 168: Docs Snippet Guardrails And Devtools App Graph Normalization

Review168 fixed two carried-forward Review167 findings whose Interfaces were
still shallower than their stated responsibilities.

1. Docs Snippet Effect-First Guardrail
   - Status: fixed.
   - Files: `CONTEXT.md`, `scripts/audit-effect-first.mjs`,
     `scripts/starter-template-content.mjs`, `docs/effect-first-audit.md`.
   - Problem: the Effect-first Source Audit guarded package source, examples,
     scripts, public type tests, and generated Vite templates, but copyable
     Markdown TypeScript/JavaScript snippets and generated starter README
     snippets were outside the audit Seam. A Promise-first docs example could
     drift while `pnpm audit:effect-first` stayed green.
   - Fix: the audit now extracts `ts`, `tsx`, `js`, `jsx`, `mjs`,
     `typescript`, and `javascript` fenced snippets from README, `docs/`, and
     example Markdown, plus generated starter README templates, then runs the
     same Promise/async scanner over those virtual files. The one intentional
     React Router comparison snippet is anchored as an explicit comparison
     Adapter exception.
   - Benefits: the Effect-first Source Audit has more Depth behind one
     Interface, and copyable docs get the same Leverage as implementation
     source without a second checker.

2. Devtools App Graph Summary Input Normalization
   - Status: fixed.
   - Files: `packages/devtools/src/app-graph-normalizer.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: Devtools normalized and detached app graph diagnostics, but still
     trusted supplied route/server/action counts, schema coverage, missing
     schema facts, route param counts, and stale unknown preload arrays from
     public Store or Bridge inputs.
   - Fix: the Devtools App Graph Summary Input Normalization Module now derives
     counts from normalized module arrays, repairs route param counts, derives
     wire `complete`/`missing`, schema coverage, and missing schema facts from
     module wire booleans, and rebuilds unknown preload resource/collection
     facts from route modules while preserving legacy empty collection
     diagnostics behavior.
   - Benefits: Store, panel, summary, and causal graph consumers get coherent
     app graph facts from one normalization Interface, and compatibility repair
     stays local.

Focused verification passed for Review168: Devtools typecheck,
`pnpm vitest run packages/devtools/test/devtools.test.ts -t "repairs stale app graph|legacy app graph|graph-aware summaries"`,
and `pnpm audit:effect-first`.

Full `pnpm verify` passed after Review168: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 398 physical/virtual package/example/config/script/type-test/generated/docs
files, 53 root test files / 1026 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, starter-suite packaging/verifies for
basic/react/project-console at 19/24/30 app files with 5/4/6 local packages,
16-target package dry-run gate, project-console typecheck, 4 project-console
test files / 27 tests, project-console build, and leak scans.

## Review 167: Shared Route Render Identity, Resource Retry Cleanup, Agent Facts, And DB Pins

Review167 fixed a focused set of fresh findings from the post-Review166
subagents across Core/UI, Start, and DB public-surface guardrails. Larger
deepening candidates remain explicitly tracked below rather than being counted
as clean-sweep evidence.

1. Core Route Render Identity And React Parity
   - Status: fixed.
   - Files: `packages/core/src/browser-router-render-decision.ts`,
     `packages/react/src/route-render-scope.ts`,
     `packages/solid/src/route-render-scope.ts`,
     `packages/core/test/browser-router.test.ts`,
     `packages/react/test/router.test.ts`.
   - Problem: Core owned route state identity but not active renderer identity.
     Solid had a local same-state renderer-swap Implementation from Review166,
     while React still keyed route `UiScope` frames by state only.
   - Fix: Core now exposes `browserRouteActiveRenderer(...)` and
     `browserRouteRenderIdentity(...)`, combining the route-state key with the
     active pending/failure/not-found/component renderer. React keys route
     frames from the shared identity, and Solid consumes the same Core
     Interface instead of carrying a private active-renderer policy.
   - Benefits: route `UiScope` lifetime policy has better Locality in the Core
     render-decision Module, and React/Solid Adapters get the same Leverage for
     same-state renderer swaps.

2. Resource UI Manual Retry Clears Stale Preload Failures
   - Status: fixed.
   - Files: `packages/core/src/resource-ui-binding.ts`,
     `packages/core/test/resource-ui-binding.test.ts`.
   - Problem: automatic preload failures were cleared by successful automatic
     preload fibers, but successful manual `prefetchEffect(...)` or
     `refreshEffect(...)` calls could leave a same-ref `preloadFailure` visible
     after the Resource had recovered.
   - Fix: the Resource UI Binding Controller now clears same-ref keyed preload
     failures after successful controller-owned prefetch and refresh Effects.
   - Benefits: the Core Resource UI Binding Module owns retry cleanup once, so
     React and Solid handles do not need Adapter-local failure reset policy.

3. Start Agent Graph Fact Detachment
   - Status: fixed.
   - Files: `packages/start/src/agent-graph.ts`,
     `packages/start/test/app-graph.test.ts`.
   - Problem: `StartAgentGraphNode.facts` promised detached facts, but route,
     action, server function, resource, collection, and finding facts reused
     nested diagnostics records or broad casts.
   - Fix: Start now has one fact-detachment policy at the agent graph projection
     Seam. Every node kind constructs facts through that policy, and regression
     tests mutate returned facts before rebuilding/querying/impacting the graph
     to prove diagnostics remain unchanged.
   - Benefits: agent graph consumers get detached data by contract, and fact
     shape changes stay local to the projection Module.

4. React/Solid DB Adapter Re-Export Pins
   - Status: fixed.
   - Files: `type-tests/react-db.test-d.ts`,
     `type-tests/solid-db.test-d.ts`,
     `type-tests/public-api.manifest.json`.
   - Problem: React DB and Solid DB intentionally re-export `Collection` and
     `Query`, but the adapter-local type tests did not pin those imports, and
     the public API manifest had no required import list for those entrypoints.
   - Fix: both adapter type tests now import and exercise `Collection`,
     `Query`, `useCollection`, `useLiveQuery`, `CollectionHandle`, and
     `LiveQueryHandle`; the public API manifest requires those symbols.
   - Benefits: the Adapter public Interface is guarded where it is declared,
     so accidental removal of the ergonomic DB re-exports fails the audit.

5. Larger Review167 Candidates
   - Status: closed by follow-up Reviews168-171.
   - Files: `scripts/package-project-console-starter.mjs`,
     `scripts/verify-package-dry-runs.mjs`,
     `scripts/generated-starter-artifacts.mjs`,
     `scripts/audit-public-api-inventory.mjs`,
     `scripts/audit-effect-first.mjs`,
     `packages/start/src/start-fetch.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/devtools/src/app-graph-normalizer.ts`,
     `packages/db/src/query-execution-plan.ts`,
     `packages/db/src/query-plan.ts`.
   - Problem: subagents also found broader Module-depth opportunities: one
     starter/catalog manifest, declaration-level public symbol policy, docs
     snippet Effect-first scanning, shared Start abort lifecycle policy,
     Devtools app graph count normalization, and a deeper DB Query Execution
     Plan Module.
   - Follow-up closure: Review168 closed Markdown snippet Effect-first scanning
     and Devtools app graph normalization; Review169 closed the Start abort
     lifecycle policy; Review170 closed the starter/catalog manifest; and
     Review171 closed declaration-level public symbol policy while re-reviewing
     the compiled Query Execution Plan candidate as already handled by the
     existing DB Query Execution Plan Module.

Focused verification passed across the Review167 slices: Core Resource UI
Binding tests 1 file / 2 selected tests; Core/React/Solid router tests 3 files
/ 5 selected tests; Start app graph tests 1 file / 4 selected tests;
Core/React/Solid package typechecks; public type tests; and public API audit.

Full `pnpm verify` passed after Review167: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 1025 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, starter-suite packaging/verifies for
basic/react/project-console at 19/24/30 app files with 5/4/6 local packages,
16-target package dry-run gate, project-console typecheck, 4 project-console
test files / 27 tests, project-console build, and leak scans.

## Review 166: UI Resource Retention, Collection No-Ops, Start Diagnostics, And Guardrails

Review166 fixed fresh findings from the post-Review165 subagents across
Core/UI, DB, Start, starter packaging, public API audit, and Effect-first
guardrails.

1. Resource UI Retention And Solid Route Render Inputs
   - Status: fixed.
   - Files: `packages/core/src/resource-store.ts`,
     `packages/core/src/resource-lifetime.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-ui-binding.ts`,
     `packages/react/test/hooks.test.ts`,
     `packages/solid/src/route-render-scope.ts`,
     `packages/solid/src/router.ts`,
     `packages/solid/test/hooks.test.ts`,
     `packages/solid/test/router.test.ts`.
   - Problem: `gcFor` could collect a successful Resource while a mounted UI
     binding was still visibly reading it, and Solid route render scopes only
     updated on router-state identity, so same-state pending/failure renderer
     changes did not rerender.
   - Fix: Core Resource Store now tracks retained UI refs. The Resource UI
     Binding Controller retains the current ref on bind, releases it on ref
     change/dispose, interrupts active GC while retained, and re-arms GC after
     release. Solid route render updates now carry both state and renderers,
     compare the active renderer identity, and rerender same-state renderer
     swaps synchronously after starting old scope disposal.
   - Benefits: Resource lifetime Locality is owned by the Core binding Module,
     and Solid outlet fallback rendering is a real state-plus-renderer
     Interface instead of constructor-only props.

2. Collection Write No-Ops, Hydration Versioning, And Change-Feed Failures
   - Status: fixed.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-mutation-workflow.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-change-feed-runtime.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/sync-adapter.test.ts`.
   - Problem: empty inserts/change batches and missing-base deletes could still
     publish, persist, invalidate, or bump versions. Snapshot hydration bumped
     collection version twice, and change-feed unsubscribe failures disappeared
     during finalization.
   - Fix: DB write and mutation workflows now return before commit work for
     no-op inputs, hydration relies on the snapshot application tick exactly
     once, and unsubscribe failures publish a typed
     `CollectionChangeFeedFailure` before being swallowed by the finalizer.
   - Benefits: Collection Write Commit and Mutation Workflow semantics now
     match visible data changes, and Adapter finalizer failures stay observable
     without making cleanup unsafe.

3. Start Generated Routes And Diagnostics Coherence
   - Status: fixed.
   - Files: `packages/start/src/start-manifest-wall.ts`,
     `packages/start/src/vite.ts`,
     `packages/start/src/start-vite-diagnostics-loader.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: generated route-definition output could re-enter file-route
     discovery when written under the route directory. Diagnostics loading
     could also strip an inline `effectUiStart(...)` Adapter when no separate
     `start` options were supplied, and decoded diagnostics were not proven
     coherent with the decoded app graph.
   - Fix: Start now computes and ignores the generated route output artifact in
     discovery and Vite hot-update checks. The diagnostics loader preserves an
     inline Start Vite plugin when it is the configured Adapter, then validates
     route paths/modules, action/server function facts, schemas, policy facts,
     and unknown preload facts against the decoded graph.
   - Benefits: generated artifacts stay outside their own source discovery
     loop, and agent-facing diagnostics cannot drift from the graph they claim
     to describe.

4. Public And Starter Guardrails
   - Status: fixed.
   - Files: `scripts/package-project-console-starter.mjs`,
     `scripts/audit-public-api-inventory.mjs`,
     `scripts/audit-effect-first.mjs`,
     `docs/starter.md`, `docs/public-api-inventory.md`,
     `docs/effect-first-audit.md`.
   - Problem: starter package dry-runs proved local packages were present but
     did not prove non-local tarball app files exactly matched the verified
     generated app tree. Public API type-test references were substring-based,
     and the Effect-first audit still missed Promise constructor/statics through
     host-global aliases.
   - Fix: starter packaging compares dry-run app files exactly against
     `verifiedGeneratedAppFiles`; public API type-test references are now
     AST-structural imports or identifier uses with self-tests; and the
     Effect-first scanner tracks host-global aliases, assignment aliases, and
     destructuring through `globalThis`, `window`, and `self`.
   - Benefits: packaging, type-test, and Promise guardrails now enforce the
     intended Interface structurally instead of trusting text adjacency.

Focused verification passed across the Review166 slices: Core, React, Solid,
DB, and Start package typechecks; public API inventory audit; Effect-first
audit over 274 files; Core/React/Solid resource and router tests 5 files / 136
tests; DB collection/sync tests; Start file-route/diagnostics tests; starter
packaging; 16-target dry-run checks; and `git diff --check`.

Full `pnpm verify` passed after Review166: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 1021 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh sweeps still found actionable Module, Interface, Seam,
Adapter, and Locality work, so the Thirty-Sweep clean counter remains unstarted.

## Review 165: Effect-First Seams, Atomic Hydration, Route Identity, And Guardrails

Review165 fixed fresh findings from the post-Review164 clean-sweep subagents
across Core/React, DB, Start, public API pins, and docs guardrails.

1. Program And React Runtime Race Semantics
   - Status: fixed.
   - Files: `packages/core/src/program-runtime.ts`,
     `packages/core/test/program.test.ts`, `packages/react/src/runtime.ts`,
     `packages/react/src/hooks.ts`, `packages/react/test/hooks.test.ts`.
   - Problem: a model subscriber could dispose a Program after the model commit
     but before the `dispatchEffect(...)` acknowledgement completed, and React
     provider-owned runtimes could be disposed when only the disposal observer
     identity changed. Resource preload failure observers could also become
     stale during an in-flight preload.
   - Fix: Program dispatch acknowledgements now distinguish committed from
     uncommitted queued dispatches during disposal. React runtime disposal reads
     the latest observer from a ref without making observer identity a provider
     ownership dependency, and Resource preload reporting uses a stable callback
     that reads the latest observer.
   - Benefits: committed Effect work acknowledges correctly, runtime ownership
     is stable across observer changes, and in-flight preload failures report to
     the current observer without restarting host preload work.

2. DB Snapshot And Hydration Atomicity
   - Status: fixed.
   - Files: `packages/db/src/collection-persistence.ts`,
     `packages/db/src/live-query-collection-materialization.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: multi-collection hydration acquired durable permits one
     collection at a time, and failed live queries could still snapshot or
     persist the last-good materialized rows.
   - Fix: hydration now acquires durable snapshot permits for the full payload
     before applying any collection mutation, and live-query collection
     snapshots fail while the current live state is failed rather than
     serializing retained last-good rows.
   - Benefits: SSR/restore hydration is payload-atomic, and persisted snapshots
     cannot silently turn a failed live projection into stale success data.

3. Start Effect-First CLI And Host Abort Seams
   - Status: fixed.
   - Files: `packages/start/src/cli.ts`,
     `packages/start/src/start-diagnostics-cli-runner.ts`,
     `packages/start/src/start-fetch.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/test/rpc.test.ts`,
     `type-tests/start-cli.test-d.ts`, `type-tests/framework.test-d.ts`.
   - Problem: Start diagnostics CLI output writers were typed as void callbacks
     that could accept ignored async work, default Start fetch fallback abort
     listeners were not cleaned up when `AbortSignal.any` was unavailable, and
     dev SSR abort cancellation still called `reader.cancel(...)` directly.
   - Fix: CLI output writers are `EffectInput` callbacks with typed
     `StartDiagnosticsCliWriteError` failures, fallback abort listeners are
     removed in an `Effect.ensuring(...)` finalizer, and dev SSR reader
     cancellation runs through an Effect-owned forked cancellation program.
   - Benefits: CLI embedding, fetch abort cleanup, and dev SSR cancellation all
     stay inside Effect v4 semantics except at explicit host Promise facades.

4. Start Generated Route And App-Graph Semantics
   - Status: fixed.
   - Files: `packages/start/src/file-route-modules.ts`,
     `packages/start/src/app-graph.ts`,
     `packages/start/test/file-route-modules.test.ts`,
     `packages/start/test/app-graph.test.ts`,
     `docs/generated-artifact-audit.md`.
   - Problem: generated companion module identifiers could collide for sibling
     route groups, and app graph DTO decoding validated only shape while
     trusting semantically impossible counts and coverage numbers.
   - Fix: companion identifiers remain source-compatible by default but gain a
     source-scoped suffix only when route-id-derived names collide. App graph
     diagnostics DTO decoding now rejects mismatched route/server/action counts,
     invalid path-param facts, and impossible schema coverage totals.
   - Benefits: generated modules stay deterministic and readable while sibling
     route groups remain distinguishable, and diagnostics payloads cannot carry
     contradictory topology facts.

5. Public Guardrail And Docs Hardening
   - Status: fixed.
   - Files: `scripts/audit-effect-first.mjs`,
     `type-tests/public-api.manifest.json`,
     `type-tests/start-adapters.test-d.ts`,
     `type-tests/start-fetch-adapter.test-d.ts`,
     `type-tests/start-fetch.test-d.ts`,
     `type-tests/start-node-adapter.test-d.ts`,
     `type-tests/start-node.test-d.ts`,
     `docs/effect-first-audit.md`, `docs/public-api-inventory.md`.
   - Problem: the Effect-first audit could miss expression-position Promise
     static extraction, host adapter error exports were under-pinned by public
     type tests, and the Effect-first audit docs still referenced stale module
     seams.
   - Fix: the audit now catches expression-position Promise static access such
     as `Reflect.apply(Promise.all, ...)`, array/object extraction, and
     host-global static access. Public type tests now directly import and use
     `StartRequestHandlerError`, `StartNodeAdapterError`, and the CLI writer
     error. The audit docs now list the actual Start/React/Solid host seams.
   - Benefits: Promise-first drift, public error export drift, and stale
     Effect-first docs are caught by executable checks rather than memory.

Focused verification passed across the Review165 slices: Core, React, DB, and
Start package typechecks; public type tests; public API inventory audit;
Effect-first audit over 274 files; Core Program focused tests 1 file / 14
tests; React hook/runtime focused tests 1 file / 4 selected tests; DB
collection/live-query focused tests 2 files / 4 selected tests; Start
file-route/app-graph focused tests 2 files / 2 selected tests; Start RPC abort
focused tests 1 file / 2 selected tests; Start dev SSR abort focused tests 1
file / 3 selected tests; and focused Start CLI/type guard checks.

Full `pnpm verify` passed after Review165: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 1010 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 164: Program Disposal, DB Diagnostics, Start Abort Semantics, And Guardrails

Review164 fixed fresh findings from the post-Review163 clean-sweep subagents
across Core/UI, DB, Start, and release guardrails.

1. Program Disposal Contract
   - Status: fixed.
   - Files: `packages/core/src/program-contract.ts`,
     `packages/core/src/program-runtime.ts`, `packages/core/src/program.ts`,
     `packages/core/test/program.test.ts`,
     `packages/react/src/hooks.ts`, `packages/solid/src/hooks.ts`,
     `type-tests/react.test-d.ts`, `type-tests/solid.test-d.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: `dispatchEffect(...)` could be dropped by disposal without an
     explicit dispatch-disposal failure, and React/Solid Program handles
     exposed timeline reads but not the timeline-clearing command.
   - Fix: pending dispatch acknowledgements now fail with
     `ProgramDisposed` when disposal drops the update, committed updates still
     acknowledge successfully, `Program.DispatchError` keeps disposal drops out
     of deterministic step/story errors, and adapter Program handles expose
     `clearTimeline()`.
   - Benefits: Program dispatch remains an Effect-owned workflow with a typed
     disposal outcome, and UI adapters no longer hide timeline management.

2. Provider-Owned Runtime Disposal Observers
   - Status: fixed.
   - Files: `packages/react/src/runtime.ts`,
     `packages/solid/src/runtime.ts`, `packages/react/test/hooks.test.ts`,
     `packages/solid/test/hooks.test.ts`, `type-tests/react.test-d.ts`,
     `type-tests/solid.test-d.ts`.
   - Problem: provider-owned runtime disposal failures had no Effect-shaped
     observer seam, while host-owned runtimes should not gain lifecycle
     callbacks the provider does not own.
   - Fix: React and Solid `RuntimeProvider` accept `onDisposeFailure(...)` only
     when the provider creates/owns the runtime. The observer is an
     `EffectInput<void, unknown>` and Promise-shaped observers remain rejected.
   - Benefits: app roots can report provider-owned teardown failures without
     turning runtime ownership into a Promise callback surface.

3. DB Collection And Query Diagnostics
   - Status: fixed.
   - Files: `packages/db/src/collection-preload.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-registry.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/start/src/app-graph.ts`,
     `packages/devtools/src/app-graph-normalizer.ts`.
   - Problem: nested `Collection.collectEffect(...)` calls could lose preload
     facts, duplicate collection names were under-specified at dehydration, live
     query/read diagnostics could leak raw factory throws, and collection
     diagnostics did not tell tooling whether a definition was read-only.
   - Fix: preload collection now preserves nested facts, dehydration dedupes
     identical definitions while rejecting distinct same-name definitions,
     `Query.live(...)` and `Query.diagnostics(...)` normalize factory throws as
     `QueryEvaluationError`, and collection diagnostics include `readOnly`.
   - Benefits: SSR collection payloads, Start diagnostics, and devtools now
     agree on concrete collection identity and writeability facts.

4. DB Adapter Preload Observers
   - Status: fixed.
   - Files: `packages/db/src/collection-reactive-binding.ts`,
     `packages/react-db/src/shared.ts`, `packages/solid-db/src/shared.ts`,
     `packages/react-db/test/react-db.test.ts`,
     `packages/solid-db/test/solid-db.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: automatic collection/live-query preload observers were still a
     Promise-shaped escape hatch.
   - Fix: shared React/Solid DB preload observers now accept
     `EffectInput<void, unknown>`, run through the DB-owned binding, and swallow
     observer failures after recording the preload failure.
   - Benefits: DB UI adapters match the Resource observer contract and keep
     automatic preload reporting Effect-first.

5. Start Abort And Stream Finalization Semantics
   - Status: fixed.
   - Files: `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/streaming.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/test/adapters.test.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: Fetch host abort signals were not wired into the underlying
     Effect run options, and dev SSR aborts during HTML body reads could be
     reported as transform failures instead of request cancellations.
   - Fix: `createFetchHandler(...)` merges the incoming `Request.signal` with
     host run options and uses the Start host Promise runner once around the
     scoped response Effect. Stream success finalizers can now be replaced by a
     failure event derived from the host Effect exit, so dev SSR reports request
     aborts as cancelled traces.
   - Benefits: Start host facades still return the platform-required Promise at
     the edge, but cancellation, teardown, and traces stay inside Effect v4.

6. Source-Scoped File Route Support Modules
   - Status: fixed.
   - Files: `packages/start/src/file-routes.ts`,
     `packages/start/test/file-routes.test.ts`.
   - Problem: pathless/grouped file-route support modules with the same URL
     prefix could be associated by URL shape alone, making sibling layout,
     error, and metadata scopes ambiguous.
   - Fix: support module identity and manifest description now use the source
     module id scope, sorted by source depth and file path.
   - Benefits: generated route support maps follow file ownership, not only URL
     segments, while allowing valid sibling route groups.

7. Public Guardrail Hardening
   - Status: fixed.
   - Files: `scripts/audit-effect-first.mjs`,
     `scripts/audit-public-api-inventory.mjs`,
     `scripts/verify-package-dry-runs.mjs`,
     `type-tests/start-virtual.test-d.ts`,
     `type-tests/public-api.manifest.json`,
     `docs/public-api-inventory.md`.
   - Problem: Effect-first scanning could miss assignment destructuring aliases,
     public API inventory did not verify manifest source targets against
     package export/bin targets, virtual route type coverage under-pinned
     generated route modules, and package dry-run checks could miss stale
     generated dist artifacts.
   - Fix: the Effect-first audit now catches direct, aliased, nested, and
     computed assignment extraction of Promise constructors/statics; the public
     API audit ties package targets to manifest source entries; virtual route
     types are exhaustively pinned; and package dry-runs compare dist JS/d.ts
     stems to source stems.
   - Benefits: Promise, package export, virtual-module, and dist-artifact drift
     are now checked by executable guardrails instead of release notes memory.

Focused verification passed across the Review164 slices: Core, DB, React,
Solid, Start, Devtools, React-DB, and Solid-DB package typechecks; public type
tests; public API inventory audit; Effect-first audit over 274 files; 16-target
package dry-run gate; Core Program focused tests 1 file / 13 tests; DB
collection focused tests 1 file / 136 tests; React/Solid hook focused tests 2
files / 36 tests; Start adapters/file-routes focused tests 2 files / 39 tests;
Start integration tests 1 file / 160 tests; root tests 53 files / 1003 tests;
package build; and `git diff --check`.

Full `pnpm verify` passed after Review164: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 1003 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 163: Solid Action Handles, Hydrateable DB Snapshots, Vite 8 HMR, And Guardrails

Review163 fixed fresh findings from the post-Review162 clean-sweep subagents
across Core/UI, DB, Start, and public guardrails.

1. Solid Action Handle Adaptation
   - Status: fixed.
   - Files: `packages/solid/src/hooks.ts`,
     `packages/solid/test/hooks.test.ts`, `type-tests/solid.test-d.ts`,
     `type-tests/public-api.manifest.json`,
     `docs/public-api-inventory.md`.
   - Problem: Solid `useAction(...)` returned the raw Core `ActionInstance`,
     exposing Core `Signal` objects where Solid callers expect Accessor-shaped
     state.
   - Fix: Solid now returns an `ActionHandle` with `state()` and
     `invalidationPlan()` accessors, runtime-bound `submitEffect(...)` and
     `resetEffect(...)`, and an explicit `instance` escape hatch for advanced
     integration work.
   - Benefits: React and Solid both adapt Core Action state to their host
     reactivity model while preserving the Effect-first action methods.

2. Resource Preload Failure Observer Shape
   - Status: fixed.
   - Files: `packages/core/src/resource-ui-binding.ts`,
     `packages/core/test/resource-ui-binding.test.ts`,
     `packages/react/src/hooks.ts`, `packages/solid/src/hooks.ts`,
     `type-tests/core.test-d.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`.
   - Problem: `onPreloadFailure(...)` was typed as `void`, which allowed
     Promise-returning observers to sneak into the automatic preload seam.
   - Fix: Core and adapter options now require `EffectInput<void, unknown>`;
     observer callbacks run through the same EffectInput guard as other public
     callbacks, and observer failures are swallowed after the preload failure
     is recorded.
   - Benefits: UI preload observers remain Effect-shaped without making
     observer failures mask the Resource failure they are observing.

3. DB Live Query Collection Snapshot Collection
   - Status: fixed.
   - Files: `packages/db/src/live-query-collection.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: `Collection.collectEffect(...)` could record a derived
     live-query collection definition that `dehydrateEffect(...)` could
     snapshot but `hydrateEffect(...)` intentionally rejects.
   - Fix: live-query collection preload/refetch work delegates collection
     recording to its concrete source collection preloads instead of recording
     the derived collection definition itself.
   - Benefits: SSR collection collection now produces hydrateable source
     collection payloads rather than unhydrateable derived snapshots.

4. Query Factory Error Normalization
   - Status: fixed.
   - Files: `packages/db/src/query-builder.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: synchronous throws while building a `Query.onceEffect(...)`
     factory bypassed the DB query diagnostics seam.
   - Fix: query factory construction is wrapped in Effect and normalized as a
     `QueryEvaluationError` with operation `evaluate`.
   - Benefits: one-shot query callers see the same typed evaluation failure
     shape whether the defect happens while building or evaluating the query.

5. Start Vite 8 Route Hot Updates
   - Status: fixed.
   - Files: `packages/start/src/vite.ts`, `packages/start/test/start.test.ts`,
     `docs/generated-artifact-audit.md`.
   - Problem: the Start Vite plugin refreshed generated route artifacts through
     legacy `handleHotUpdate(...)`, but Vite 8 create/delete notifications use
     the newer `hotUpdate(...)` hook.
   - Fix: the plugin now supports `hotUpdate(...)` for create/delete route
     changes while keeping the legacy hook path, refreshing `routeTree.gen.ts`
     and invalidating route/app-graph virtual modules.
   - Benefits: generated route artifacts and virtual modules stay aligned in
     modern Vite dev sessions.

6. Start Dev SSR Body Read Cancellation
   - Status: fixed.
   - Files: `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: interrupting the dev SSR Effect did not cancel a pending
     `response.text()` Promise while reading the HTML body.
   - Fix: dev SSR HTML reads now use an Effect-owned stream reader that checks
     the request `AbortSignal`, cancels the reader on abort/interruption, and
     reports failures as `StartDevServerError` operation `read-html`.
   - Benefits: Vite dev SSR no longer leaves body reads detached from the
     request lifecycle.

7. Public Guardrail Drift
   - Status: fixed.
   - Files: `scripts/verify-package-dry-runs.mjs`,
     `scripts/audit-effect-first.mjs`,
     `type-tests/public-api.manifest.json`, `docs/release-notes.md`,
     `docs/effect-first-audit.md`, `docs/package-hygiene-audit.md`,
     `docs/perfection-progress.md`, `docs/sharp-cast-audit.md`,
     `docs/ultimate-goal-checklist.md`.
   - Problem: source-package dry-runs could miss payload drift, the
     Effect-first Promise scanner missed assignment aliases, the public API
     manifest under-pinned new hook symbols, and several release-facing docs
     still pointed at older verification gates.
   - Fix: source-package dry-runs now compare the packed payload exactly
     against the source manifest after excluding generated/dependency/local
     metadata paths; the Effect-first audit tracks Promise assignment aliases
     and static extraction assignments; the manifest pins React/Solid
     `useProgram(...)`, `useResourceSuspense(...)`, and Solid `ActionHandle`;
     current-facing docs now point at this Review163 gate.
   - Benefits: packaging, Promise, public API, and docs guardrails all describe
     the same release reality.

Focused verification passed across the Review163 slices: Core, Solid, DB, and
Start package typechecks; public type tests; public API inventory audit;
Effect-first audit over 274 files; 16-target package dry-run gate; Core/Solid
focused tests 2 files / 23 tests; DB focused tests 2 files / 7 selected tests;
Start focused tests 1 file / 8 selected tests; and `git diff --check`.

Full `pnpm verify` passed after Review163: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 991 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 162: Resource Lifetimes, DB Snapshot Planning, Start Host Cancellation, And Docs

Review162 fixed fresh findings from post-Review161 subagent sweeps across
Core/UI, DB, Start, and public guardrails.

1. Core Resource Result Lifetime
   - Status: fixed.
   - Files: `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-ui-binding.ts`,
     `packages/core/test/resource.test.ts`,
     `packages/core/test/resource-ui-binding.test.ts`,
     `packages/react/test/hooks.test.ts`,
     `packages/solid/test/hooks.test.ts`.
   - Problem: deleting or garbage-collecting a Resource entry reset and then
     removed the entry. Existing `Resource.result(ref)` subscribers in React
     and Solid stayed attached to the orphaned signal when the same ref loaded
     again.
   - Fix: Core now keeps the public result signal stable for a ref while
     clearing the owned lifecycle work around it. The shared Suspense preload
     controller also clears completed same-ref host tokens before a reload.
   - Benefits: adapter subscriptions follow the Resource Interface by ref
     identity instead of leaking the internal store-entry lifetime Seam.

2. React Route Render Scope Failures
   - Status: fixed.
   - Files: `packages/react/src/route-render-scope.ts`,
     `packages/react/test/router.test.ts`.
   - Problem: React route render created a route `UiScope` during render and
     only disposed it from effect cleanup, which never runs when render throws
     before commit.
   - Fix: the React Route Render Scope Controller now disposes the route scope
     through the runtime when branch render throws, then rethrows to the host
     ErrorBoundary.
   - Benefits: React matches Solid's route lifetime Locality and does not leak
     route-owned finalizers from failed render attempts.

3. React/Solid Public Hook Type Pins
   - Status: fixed.
   - Files: `type-tests/react.test-d.ts`, `type-tests/solid.test-d.ts`,
     `type-tests/public-api.manifest.json`,
     `docs/public-api-inventory.md`.
   - Problem: focused package type tests under-pinned public hook Interfaces,
     relying too much on a broad cross-package framework test for LSP-facing
     coverage.
   - Fix: package-local type tests now directly import and exercise action,
     resource, program, signal, stream, runtime, handle, and options symbols
     required by the public API manifest.
   - Benefits: CI keeps hover/discoverability coverage local to the adapter
     package that owns each Interface.

4. DB Durable Snapshot Planning
   - Status: fixed.
   - Files: `packages/db/src/collection-definition-snapshot.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/live-query-collection-materialization.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: multi-collection dehydration and live-query collection
     materialization flattened/acquired durable source permits in separate
     places and orders. Public snapshot payloads could drift from the single
     durable snapshot Interface.
   - Fix: a shared durable snapshot planning Module now expands transitive
     writable sources, dedupes by definition identity, sorts permits
     deterministically, and is used by public snapshot/dehydrate/persist paths.
   - Benefits: source snapshot ordering lives behind one Seam and concurrent
     derived snapshots cannot acquire the same source permits in opposite order.

5. DB Snapshot Interface And Diagnostics
   - Status: fixed.
   - Files: `packages/db/src/collection-change-feed-runtime.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/src/index.ts`,
     `packages/db/src/collection-contract.ts`,
     `docs/db.md`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/sync-adapter.test.ts`.
   - Problem: synchronous `snapshot()`/`dehydrate()` docs overstated durable
     persistence semantics, change-feed defect/interruption failures could
     publish `undefined`, and invalid query key encoding could escape the
     expected join/aggregate operation error Seam.
   - Fix: sync snapshot docs now describe inspection-only semantics while
     Effect forms are named as durable workflows. Change-feed failure events
     squash non-fail Causes into meaningful diagnostics. Join and group key
     encoding are wrapped as `QueryEvaluationError` with the correct operation.
   - Benefits: DB Interfaces now describe their durability boundary honestly
     and diagnostics preserve the operation that owns failures.

6. Start Host Disconnect Cancellation
   - Status: fixed.
   - Files: `packages/start/src/start-host-runtime-runner.ts`,
     `packages/start/src/node-web-exchange.ts`,
     `packages/start/src/node-adapter.ts`,
     `packages/start/src/vite.ts`,
     `packages/start/test/adapters.test.ts`.
   - Problem: Node/Vite callback Adapters forked request Effects without
     retaining a typed fiber handle, and Node request conversion did not attach
     an `AbortSignal`. Client disconnects before response creation could leave
     SSR/RPC/action work running detached.
   - Fix: the Start host fork runner now returns typed fibers, Node exchanges
     create per-request lifecycle signals, and Node/Vite callback Adapters
     interrupt the forked Effect on disconnect with listener cleanup on normal
     completion.
   - Benefits: pre-response request lifecycle is owned by the host Adapter
     instead of being a detached fire-and-forget Effect.

7. Start Route Artifact Hot Updates
   - Status: fixed.
   - Files: `packages/start/src/vite.ts`, `packages/start/test/start.test.ts`,
     `docs/generated-artifact-audit.md`.
   - Problem: the written `routeTree.gen.ts` artifact updated at startup/build
     but did not refresh or invalidate related virtual modules when file routes
     were added, removed, or renamed during a Vite dev session.
   - Fix: the Vite plugin now refreshes generated route artifacts from the same
     lifecycle helper and invalidates Start route/app-graph virtual modules from
     `handleHotUpdate(...)` when files under the configured route directory
     change.
   - Benefits: generated file and virtual route Modules now stay aligned during
     dev, preserving the editor-facing route Interface.

8. Current-Facing Guardrails
   - Status: fixed.
   - Files: `docs/generated-artifact-audit.md`,
     `docs/public-api-inventory.md`,
     `docs/sharp-cast-audit.md`,
     `scripts/verify-package-dry-runs.mjs`,
     `type-tests/public-api.manifest.json`.
   - Problem: current-facing docs and package dry-run pins lagged the Review161
     verification reality and did not fully pin generated starter/project
     artifacts or React action handle docs.
   - Fix: generated artifact, public API, and sharp-cast docs now point at the
     current review ledgers; package dry-runs require project-console's
     load-bearing generated/support files; React `ActionHandle` is manifest
     pinned.
   - Benefits: review and packaging guardrails now describe the files and
     Interfaces CI actually protects.

Focused verification passed across the Review162 slices: Core, React, Solid,
DB, and Start package typechecks; public type tests; public API inventory
audit; Effect-first audit over 274 files; Core/React/Solid focused tests 5
files / 109 tests; DB focused tests 3 files / 183 tests; Start focused tests 5
files / 215 tests; package dry-run gate; and `git diff --check`.

Full `pnpm verify` passed after Review162: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 987 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 161: Durability, Diagnostics, React Action Values, And Guardrails

Review161 fixed fresh findings from the post-Review160 subagent sweeps across
DB, Start, Core, React, and public guardrails.

1. DB Durable Commit Interruption And Readonly Change Feeds
   - Status: fixed.
   - Files: `packages/db/src/collection-write-commit.ts`,
     `packages/db/src/collection-mutation-workflow.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: direct writes and mutation workflow persistence could be
     interrupted after visible state mutation but before durable persistence
     settled. Readonly collection definitions could also subscribe to
     change-feed adapters before the readonly mutation guard rejected them.
   - Fix: direct write commits and mutation enqueue/commit/rollback paths now
     run through uninterruptible durable sections with explicit restoration
     where rollback is required. Readonly change-feed subscription rejects with
     `ReadonlyCollectionMutation` before acquiring a store/feed side effect.
   - Benefits: collection state publication stays behind the durable commit
     Seam, and readonly collection Interfaces reject write-like adapters before
     observable work starts.

2. DB Live Query Transitive Snapshot Permits
   - Status: fixed.
   - Files: `packages/db/src/collection-definition-snapshot.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/live-query-collection-materialization.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: live-query collection snapshots only acquired permits for their
     direct sources. A nested live-query collection source could therefore
     materialize through a derived dummy state while an underlying durable source
     write was still in flight.
   - Fix: collection definitions can expose durable snapshot sources, and live
     query collection materialization flattens those sources transitively before
     acquiring snapshot permits.
   - Benefits: derived snapshots now observe committed writable sources even
     across nested live-query collection graphs.

3. Start Transport Diagnostics Finalization
   - Status: fixed.
   - Files: `packages/start/src/start-transport-endpoint-runner.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: RPC/action transport diagnostics were applied before
     `ResponseContext` metadata, so handler code could overwrite
     `x-effect-ui-request-id`, transport kind, or protocol-version headers.
   - Fix: the transport runner writes authoritative diagnostics into the shared
     `ResponseContext` after user code runs, and still clones the immediate
     response with those diagnostics.
   - Benefits: request correlation and transport diagnostics stay authoritative
     for both full Start handlers and direct RPC/action response helpers.

4. Core Stable Stringify Typed Host Failures
   - Status: fixed.
   - Files: `packages/core/src/stable-stringify.ts`,
     `packages/core/test/stable-stringify.test.ts`.
   - Problem: hostile getters, sparse-array index accessors, and proxy
     `ownKeys` traps could throw raw host errors through stable key encoding.
   - Fix: object key discovery, array index reads, Map/Set iteration, and final
     JSON encoding now wrap unexpected host failures as
     `StableStringifyEncodeFailure` with path and cause details.
   - Benefits: stable key generation keeps its typed error Interface even when
     input data is adversarial.

5. React Action Hook Value Adaptation
   - Status: fixed.
   - Files: `packages/react/src/hooks.ts`, `packages/react/test/hooks.test.ts`,
     `type-tests/react.test-d.ts`.
   - Problem: React `useAction(...)` returned the Core `ActionInstance`
     directly, leaking Core `ReadableSignal` values for `state` and
     `invalidationPlan` into React UI code.
   - Fix: `useAction(...)` now returns a React `ActionHandle` with subscribed
     React values plus `submitEffect`, `resetEffect`, `reset`, and the
     underlying Core instance at `handle.instance`.
   - Benefits: React action UI follows the same Adapter pattern as Resource and
     Program hooks while preserving the lower-level Core controller.

6. Start/Vite Route Definition Writer Public Pins
   - Status: fixed.
   - Files: `packages/start/src/generated-route-definitions.ts`,
     `type-tests/start-vite.test-d.ts`,
     `type-tests/public-api.manifest.json`.
   - Problem: the expert-public `@effect-ui/start/vite` route definition writer
     symbols were documented but not directly required by the public type-test
     manifest, and the failure union lacked enough hover context.
   - Fix: the sync/effect writers, result/failure types, and filesystem/path
     errors are directly imported and exercised by type tests, with required
     manifest pins. The writer plan/result/error/failure types now carry
     LSP-facing field and union docs.
   - Benefits: CI keeps the expert-public route writer Interface discoverable
     and type-pinned.

7. Effect-First `self.Promise` Guardrail
   - Status: fixed.
   - Files: `scripts/audit-effect-first.mjs`,
     `docs/effect-first-audit.md`.
   - Problem: the Promise static/constructor AST audit covered `globalThis` and
     `window` but not the Worker/browser `self` host global.
   - Fix: `self` is now treated as a Promise constructor receiver, with
     self-tests for direct statics, element access, aliases, extracted statics,
     destructuring, computed destructuring, and constructors.
   - Benefits: browser and Worker code cannot bypass the Effect-first policy by
     spelling host Promise access through `self.Promise`.

8. Current-Facing Documentation Drift
   - Status: fixed.
   - Files: `docs/release-notes.md`, `docs/effect-first-audit.md`,
     `docs/package-hygiene-audit.md`, `docs/starter.md`,
     `docs/perfection-progress.md`.
   - Problem: current-facing docs still pointed at older Review151/157 gates or
     under-described generated starter artifact drift coverage.
   - Fix: verification summaries now point at the current Review161 gate, audit
     docs link back to this review ledger for the latest source of truth, and
     starter docs mention the project-console-only generated manifest artifact.
   - Benefits: reviewers and agents no longer have to reconcile stale "latest"
     claims across docs.

Focused verification passed across the Review161 slices: DB package typecheck,
DB collection/live-query/sync-adapter tests 3 files / 179 tests, Start package
typecheck, focused Start transport diagnostics test, Core package typecheck,
Core stable-stringify tests 1 file / 7 tests, React package typecheck, focused
React action hook tests, public type tests, public API inventory audit,
Effect-first audit over 274 files, and `git diff --check`.

Full `pnpm verify` passed after Review161: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 977 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 160: Committed Program Startup, Durable Query Snapshots, And Hostile Diagnostics

Review160 fixed fresh DB, React, and Start findings from the post-Review159
subagent sweeps.

1. Start Agent Graph Fact Rendering
   - Status: fixed.
   - Files: `packages/start/src/start-agent-graph-facts.ts`,
     `packages/start/src/start-agent-graph-query.ts`,
     `packages/start/src/start-agent-graph-formatter.ts`,
     `packages/start/test/app-graph.test.ts`.
   - Problem: agent graph query fact search still called
     `Object.prototype.toString.call(...)` before the defensive inspection
     block, so a hostile fact object with a throwing `Symbol.toStringTag`
     getter could escape diagnostics. Verbose formatting also used raw
     `JSON.stringify(...)`, so BigInt, circular, or hostile facts could crash
     CLI output.
   - Fix: bounded fact rendering now lives in one shared helper used by query
     search and verbose formatting. Formatter fact reads catch per-property
     access failures. Regressions cover BigInt, circular facts, and hostile
     getter objects.
   - Benefits: Start diagnostics stay total and bounded even when app metadata
     contains unserializable or adversarial values.

2. React Program Commit Lifecycle
   - Status: fixed.
   - Files: `packages/react/src/hooks.ts`, `packages/react/test/hooks.test.ts`.
   - Problem: `useProgram(...)` called `Program.start(...)` during React render.
     Because `Program.start(...)` immediately forks processors and
     subscriptions, suspended or abandoned render work could leak running
     fibers before React committed the component and registered cleanup.
   - Fix: `useProgram(...)` now returns an inert bridge instance during render
     and starts the real Program from `useLayoutEffect(...)` after commit. The
     bridge mirrors model, failure, and timeline signals and delegates dispatch
     once the committed instance exists. A Suspense regression proves suspended
     render work does not start Program subscriptions.
   - Benefits: React Program lifecycles are commit-owned while preserving the
     existing hook surface and Effect-native dispatch semantics.

3. DB Live Query Snapshots And Local Unsynced Rows
   - Status: fixed.
   - Files: `packages/db/src/live-query-collection-materialization.ts`,
     `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/test/live-query-collection.test.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: live-query collection snapshot Effects materialized source rows
     without acquiring the source collections' durable commit permits, so a
     concurrent failing direct write could be observed before rollback. Refetch
     row replacement also dropped non-optimistic local direct-write rows marked
     `synced: false` when the server omitted them.
   - Fix: live-query collection snapshot Effects acquire durable permits for
     their source collections before materialization, which also protects
     persist/dehydrate Effect paths. Refetch replacement carries forward local
     unsynced direct-write rows that are not represented by optimistic mutation
     stacks.
   - Benefits: derived collection snapshots observe committed source state, and
     local direct-write drafts survive ordinary remote refreshes.

Focused verification passed: Start package typecheck, focused Start agent graph
tests 1 file / 2 tests, React package typecheck, React hook tests 1 file / 15
tests, DB package typecheck, DB collection/live-query collection tests 2 files /
158 tests, public API audit, Effect-first audit over 274 files, and
`git diff --check`.

Full `pnpm verify` passed after Review160: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 274 files, 53 root test files / 970 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 159: Action Response Resource Identity

Review159 fixed the only actionable finding from the post-Review158 sweeps. DB,
Start/Devtools/script, and public guardrail sweeps reported no other actionable
findings.

1. Start Action Hydration/Invalidation Identity
   - Status: fixed.
   - Files: `packages/start/src/start-action-response-application.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: action response application filtered follow-up invalidation work
     for hydrated resources using only `resource.key`. Resource hydration
     payload identity is `name + key`; using just the key made the Start client
     Adapter rely on Core's current globally-prefixed key shape instead of the
     public hydration contract.
   - Fix: hydrated resource suppression now compares composite resource
     identity from snapshot `name/key` against invalidation entry
     `family.options.name/key`. A regression uses family-local keys for two
     different resource families to prove hydrating one family no longer
     suppresses invalidating the other.
   - Benefits: Start action metadata application now follows the same Resource
     identity contract as hydration snapshots and stays correct if key encoding
     changes or an adapter supplies family-local keys.

Focused verification passed: Start package typecheck, Start/app-graph/adapters
plus Devtools tests 4 files / 268 tests, DB reviewer verification 5 files / 190
tests, public API audit, Effect-first audit over 273 files, and
`git diff --check`.

Full `pnpm verify` passed after Review159: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 273 files, 53 root test files / 966 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 158: Scoped UI Preloads, Durable Restore Liveness, And Trace Defects

Review158 fixed fresh DB, Core/React/Solid, Start, public type, and trace
findings from the post-Review157 sweeps.

1. Resource UI And Solid Route Error Lifecycle
   - Status: fixed.
   - Files: `packages/core/src/resource-ui-binding.ts`,
     `packages/core/test/resource-ui-binding.test.ts`,
     `packages/react/test/hooks.test.ts`,
     `packages/solid/src/route-render-scope.ts`,
     `packages/solid/src/router.ts`, `packages/solid/test/router.test.ts`,
     `type-tests/core.test-d.ts`.
   - Problem: default Suspense resource preloads ran outside a Scope, so
     scoped resource acquire/release lifecycles depended on host adapter luck.
     Solid route render failures that happened after navigation were captured
     by the host ErrorBoundary callback but could leave the previous route DOM
     mounted.
   - Fix: default Resource UI Suspense preloads fork
     `Effect.scoped(...)` work in the bound runtime. Solid route rendering now
     cleans up failed route scopes, clears stale route nodes, and schedules
     current-transition render errors after Solid commits the cleared node so
     the host ErrorBoundary owns the fallback DOM.
   - Benefits: resource UI preloads keep Effect Scope lifetime guarantees, and
     Solid route outlets no longer strand stale UI when async route rendering
     fails.

2. DB Durable Restore, Public Hydration, And Mutation Joiners
   - Status: fixed.
   - Files: `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-state.ts`,
     `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/src/collection-write-commit.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: restore-before-preload could either clobber a newer write with a
     stale persisted snapshot or over-serialize by holding the durable commit
     permit while waiting on storage reads. Rollback snapshots also dropped
     active mutation attempts, so pending flush joiners could start duplicate
     mutation owner work. Public `persistEffect(...)` and `hydrateEffect(...)`
     could observe transient state while a failing durable write was rolling
     back.
   - Fix: restore-before-preload captures the collection version, performs the
     storage read outside the commit permit, then acquires the durable permit
     only for hydrate/publish after rechecking active load attempt and version.
     State snapshots preserve active mutation attempts when rollback restores
     pending state. Public persist, hydrate, restore, and dehydrate Effect paths
     serialize against the same durable commit permit for normal collections.
   - Benefits: slow cache reads no longer stall newer forced refetches or
     direct writes, stale snapshots cannot overwrite fresher state, mutation
     joiners stay attached to the active owner, and public persistence Effects
     see committed collection state.

3. Start Hydration Payload And Request Trace Failure Classification
   - Status: fixed.
   - Files: `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/start-request-preload.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: Start request preloads could include read-only live-query
     collections in hydration payloads even though those derived collections
     reject direct hydrate. Start Action traces could record success when output
     encoding or hydration metadata generation failed into an HTTP 500 Defect
     response.
   - Fix: request preload hydration filters out read-only live-query
     collections while still tracking their source collections. Action response
     construction records metadata/output failures as trace failures, preserving
     interruption semantics and marking 500+ defect responses as defects.
   - Benefits: SSR hydration payloads contain only hydratable collections, and
     Start request traces now tell the truth about response-construction
     defects.

4. Start Agent Graph Query Robustness
   - Status: fixed.
   - Files: `packages/start/src/start-agent-graph-query.ts`,
     `packages/start/test/app-graph.test.ts`.
   - Problem: public agent graph queries used raw `JSON.stringify(...)` on
     graph facts, so BigInt values, cycles, hostile getters, or deep structures
     could defect instead of producing bounded searchable text.
   - Fix: graph fact search now uses bounded structural text extraction with
     depth, entry, and length limits plus cycle, BigInt, symbol, function, and
     thrown-access handling.
   - Benefits: agent graph queries stay total over public graph facts while
     preserving useful search signal for diagnostics and repair workflows.

Focused verification passed: Core/React/Solid/DB/Start package typechecks,
public type tests, public API audit, Effect-first audit over 273 files, DB
collection tests 1 file / 126 tests, Start request/app-graph tests 2 files /
173 tests, Core/React/Solid resource and router tests 3 files / 48 tests, and
focused stale-restore/mutation/persist/hydrate DB regressions.

Full `pnpm verify` passed after Review158: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 273 files, 53 root test files / 965 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 157: Durable Commit Locality, Devtools Secrets, And Public CLI Surface

Review157 fixed fresh DB, React/Core, Devtools, Start, public API, and script
guardrail findings from the post-Review156 sweeps.

1. DB Durable Restore And Mutation Commit Locality
   - Status: fixed.
   - Files: `packages/db/src/collection-write-commit.ts`,
     `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-mutation-workflow.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: restore-before-preload could hydrate a stale persisted snapshot
     after a newer forced refetch had already committed. Direct writes,
     mutation persistence, and load persistence also used separate durable
     ordering paths, allowing an older blocked storage write to overwrite a
     newer snapshot. Mutation success/dequeue events could publish before the
     post-handler persistence step completed.
   - Fix: Collection State now uses one shared durable commit permit across
     load restores, load commits, direct writes, and mutation workflow commits.
     Restore-before-preload is gated by the active load attempt before and
     after decoding. Mutation dequeue/commit/rollback events now publish only
     after the matching durable persistence succeeds.
   - Benefits: DB commit Locality now covers stale restore, direct write,
     mutation, persistence, and event publication ordering through one
     Effect-owned path.

2. Router Public Adapter Lifecycle
   - Status: fixed.
   - Files: `packages/react/src/link.ts`,
     `packages/react/test/router.test.ts`, `type-tests/core.test-d.ts`,
     `scripts/audit-public-api-inventory.mjs`.
   - Problem: React hover preloads could outlive a replaced router when the new
     router reused the same runtime, because the preloader memo keyed only on
     `router.runtime`. The public `BrowserRouterLinkPreloadIdentity` type was
     exported but not pinned by hover docs/type tests.
   - Fix: React now keys the Core preloader by router instance so provider
     replacement interrupts stale hover work. Core link preload identity is
     pinned by the public API inventory and public type tests.
   - Benefits: adapter lifecycle ownership now follows the router object that
     owns the active route graph, and LSP-facing Core link identity docs cannot
     silently drift.

3. Devtools Route-Plan Redaction And Cleanup Failure Serialization
   - Status: fixed.
   - Files: `packages/devtools/src/devtools-contract.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/panels.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `scripts/audit-public-api-inventory.mjs`.
   - Problem: `DevtoolsRoutePlan.href` and `match.href` preserved sensitive
     query strings even after request URL redaction, including embedded request
     trace route plans. Start teardown `cleanupFailure` facts were also dropped
     before snapshot, summary, and panel projection.
   - Fix: route-plan serialization now redacts sensitive query parameters in
     both plan and match hrefs. Request trace teardown serialization preserves a
     bounded cleanup-failure object through snapshots, summaries, and panels.
     `DevtoolsUnknownInvalidationTarget` now has public hover documentation.
   - Benefits: Devtools owns sensitive trace redaction at the serialization
     Seam and preserves teardown truth instead of making callers infer cleanup
     failures from missing data.

4. Effect-First, Package Payload, And Start CLI Guardrails
   - Status: fixed.
   - Files: `scripts/audit-effect-first.mjs`,
     `scripts/verify-package-dry-runs.mjs`, `packages/start/package.json`,
     `tsconfig.base.json`, `docs/public-api-inventory.md`,
     `type-tests/public-api.manifest.json`,
     `type-tests/start-cli.test-d.ts`.
   - Problem: the Effect-first audit missed nested and computed
     `globalThis.Promise` extraction forms. Source package dry-runs checked
     directories but not required entrypoint files. The Start diagnostics CLI
     runner was documented as a public source surface but exported only through
     bin/private paths.
   - Fix: the Effect-first audit catches nested and computed global Promise
     extraction. Source package dry-runs now require concrete app, server,
     route, virtual-module, script, panel, extension, and config entrypoints.
     `@effect-ui/start/cli` is an explicit public subpath with type-test
     coverage for the Effect-native CLI commands and runner helpers.
   - Benefits: Effect-first, copyability, and LSP-facing public CLI contracts
     now fail at the guardrail where drift would enter.

Focused verification passed: DB/React/Devtools/Start package typechecks,
public type tests, public API audit, Effect-first audit over 273 files,
16-target package dry-run metadata/payload gate, DB collection tests 1 file /
122 tests, React router tests 1 file / 11 tests, Devtools tests 1 file / 76
tests, package build, script syntax checks, and `git diff --check`.

Full `pnpm verify` passed after Review157: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 273 files, 53 root test files / 954 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to complete before the clean-sweep
counter can start.

## Review 156: Durable Commit Races, Query Redaction, And Guardrail Pins

Review156 fixed fresh Core/React/Solid, DB, Devtools, Start, public API, and
script guardrail findings from the post-Review155 sweeps.

1. Router Link Preload Identity
   - Status: fixed.
   - Files: `packages/core/src/browser-router-link.ts`,
     `packages/react/src/link.ts`, `packages/solid/src/link.ts`,
     `packages/core/test/browser-router.test.ts`,
     `packages/react/test/router.test.ts`,
     `packages/solid/test/router.test.ts`.
   - Problem: Review155 bound hover preloads to href, but the ownership
     decision also depends on whether preloading is enabled, whether the route
     belongs to the active router, and whether anchor `target`/`download`
     attributes hand navigation to the browser.
   - Fix: Core now exposes `bindPreloadIdentity(...)`, an Interface whose
     identity includes all preload-affecting adapter facts and an enabled bit.
     React and Solid compute that identity from href, preload, route
     membership, target, and download before starting hover work.
   - Benefits: the link preloader Seam now has enough Locality to interrupt
     stale work when any fact that changes ownership changes, while preserving
     the older `bindTarget(...)` compatibility path.

2. DB Durable Load Commit Races
   - Status: fixed.
   - Files: `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: `persistOnLoad` could mutate live rows before durable persistence
     completed, and superseded loads could win the storage race after a newer
     visible generation had already committed. `CollectionLoaded.count` also
     reported the loaded batch size instead of the stored row count.
   - Fix: load persistence now stages the snapshot and commits visible rows
     only after durable persistence succeeds. Durable load commits are
     serialized per collection and guarded by generation checks, interruption
     restores the prior committed state, and `CollectionLoaded.count` reports
     the store size after commit.
   - Benefits: Collection load commit Locality now covers memory, persistence,
     interruption, and stale-generation races rather than treating storage as a
     best-effort side effect.

3. Devtools Serialization And Lifecycle Cleanup
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: request URL query secrets bypassed the Devtools Serialization
     Contract through `trace.request.url` and `trace.request.path`, and a
     synchronous panel boot failure could finish before lifecycle cleanup was
     fully registered.
   - Fix: Devtools now redacts sensitive query parameter names and values at
     the trace request serialization Seam. Panel boot installs finalization
     cleanup before the boot fiber can complete, covering sync mount and
     `afterMount` failures.
   - Benefits: callers no longer need to sanitize request query strings before
     handing traces to Devtools, and panel lifecycle cleanup belongs to the
     boot Module from the first instruction.

4. Start CLI Query Encoding And Guardrail Depth
   - Status: fixed.
   - Files: `packages/start/src/cli.ts`,
     `packages/start/src/start-diagnostics-cli-contract.ts`,
     `packages/start/test/start.test.ts`, `scripts/audit-effect-first.mjs`,
     `scripts/audit-public-api-inventory.mjs`,
     `scripts/verify-package-dry-runs.mjs`,
     `type-tests/devtools.test-d.ts`,
     `type-tests/public-api.manifest.json`.
   - Problem: generated graph/impact repair commands could still lose query
     text that begins with `-` because Effect CLI does not preserve those
     positionals after `--` in this command tree. The Effect-first audit missed
     Promise constructors extracted from `globalThis`/`window`, source package
     dry-runs only asserted `.gitignore`, and public API type tests did not pin
     important direct Devtools exports.
   - Fix: Start supports `--query=<text>` and generated repair commands use it
     for flag-shaped query text, with parser round-trip coverage. The
     Effect-first audit now catches destructured global Promise constructor
     aliases. Source package dry-runs require concrete files/directories, and
     the public API manifest can require direct type-test imports for important
     public symbols.
   - Benefits: CLI repair commands, Promise guardrails, package copyability,
     and LSP-facing public API coverage now fail at the Interface where drift
     enters.

Focused verification passed: Core/React/Solid/DB/Devtools/Start package
typechecks, public type tests, public API audit, Effect-first audit over 272
files, 16-target package dry-run metadata/payload gate, DB collection tests 1
file / 119 tests, Devtools tests 1 file / 75 tests, Start start/app-graph tests
2 files / 170 tests, Core/React/Solid hook/router tests 5 files / 79 tests,
script syntax checks, and `git diff --check`.

Full `pnpm verify` passed after Review156: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 272 files, 53 root test files / 949 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to complete before the clean-sweep
counter can start.

## Review 155: Runtime Identity, Persistence Commit, And Guardrail Depth

Review155 fixed fresh Core/React/Solid, DB, Start, Devtools, and script/docs
guardrail findings from the post-Review154 sweeps.

1. Router Link Target Identity And Solid Runtime Inputs
   - Status: fixed.
   - Files: `packages/core/src/browser-router-link.ts`,
     `packages/react/src/link.ts`, `packages/solid/src/link.ts`,
     `packages/solid/src/runtime.ts`, `packages/solid/src/router.ts`,
     `packages/core/test/browser-router.test.ts`,
     `packages/react/test/router.test.ts`,
     `packages/solid/test/hooks.test.ts`.
   - Problem: hover preloads were keyed only by the preloader instance, so a
     link whose target changed could keep stale work alive. Solid providers
     also captured runtime/router inputs at construction rather than giving the
     Adapter a keyed remount seam.
   - Fix: the Core preloader now exposes `bindTarget(...)` and interrupts stale
     work when the target identity changes. React and Solid links bind their
     current href into that Interface. Solid runtime/router providers now mount
     keyed provider instances under a dedicated owner, and Solid links sync href
     through `createRenderEffect(...)`.
   - Benefits: hover preload ownership now has target Locality, and Solid keeps
     runtime/router provider ownership explicit instead of relying on captured
     construction state.

2. DB Load Persistence Commit Ordering
   - Status: fixed.
   - Files: `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: a load with `persistOnLoad` could mark the Collection `Ready`
     before persistence failed, causing later preload/refetch paths to skip the
     retry because the visible state looked successful.
   - Fix: load commits snapshot the previous Collection State, apply loaded
     rows, persist, and only then publish `CollectionLoaded` and mark `Ready`.
     Persistence failure restores the previous rows/error state, records
     `CollectionLoadFailure`, and re-fails with the original persistence cause.
   - Benefits: the Collection load Module now has atomic commit Locality across
     memory and persistence Adapters, so failed durable writes remain retryable.

3. Start And Script Guardrail False Negatives
   - Status: fixed.
   - Files: `packages/start/src/start-diagnostics-cli-contract.ts`,
     `packages/start/test/start.test.ts`, `packages/start/test/app-graph.test.ts`,
     `scripts/audit-effect-first.mjs`,
     `scripts/audit-public-api-inventory.mjs`,
     `scripts/verify-package-dry-runs.mjs`.
   - Problem: impact verify commands still rendered valued load flags as
     split argv tokens, the Effect-first audit missed Promise constructor
     aliases, package release metadata was documented but not enforced, and the
     public API inventory did not compare Source cells against the manifest.
   - Fix: Start renders load flags as `--flag=value`. The Effect-first audit
     catches `new Promise` through direct, global, parenthesized, and aliased
     constructor forms. Package dry-runs now enforce private/license/files plus
     framework description, `sideEffects: false`, and `./dist/*` entrypoints.
     Public API inventory checks now reject Source-column drift.
   - Benefits: CLI repair commands stay argv-safe, and release/API guardrails
     now fail at the Interface where the drift is introduced.

4. Devtools Cleanup And Redaction Ownership
   - Status: fixed.
   - Files: `packages/devtools/src/bridge.ts`,
     `packages/devtools/src/devtools-contract.ts`,
     `packages/devtools/src/index.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: bridge cleanup was not stack-safe for nested/out-of-order
     installs, request-trace redaction depended on upstream callers rather than
     the Devtools Serialization Contract, and panel lifecycle listeners could
     remain after manual cleanup.
   - Fix: bridge installs keep per-target stack state, trace header/cookie
     redaction moved into serialization copy paths, and panel boot cleanup
     removes lifecycle listeners from manual interrupts, lifecycle events, and
     fiber finalization.
   - Benefits: Devtools now owns its cleanup and sensitive trace serialization
     seams, reducing caller coupling and leak risk.

Focused verification passed: Core/React/Solid/DB/Devtools/Start package
typechecks, public type tests, public API audit, Effect-first audit over 272
files, package dry-run metadata/payload gate across 16 targets, DB collection
tests 1 file / 116 tests, Devtools tests 1 file / 73 tests, Start
start/app-graph tests 2 files / 170 tests, Core/React/Solid hook/router tests
5 files / 76 tests, script syntax checks, and `git diff --check`.

Full `pnpm verify` passed after Review155: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 272 files, 53 root test files / 941 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, generated starter-suite
packaging/verifies for basic/react/project-console at 19/24/30 app files with
5/4/6 local packages, 16-target package dry-run gate, project-console
typecheck, 4 project-console test files / 27 tests, project-console build, and
leak scans. Fresh post-fix sweeps still need to run before the clean-sweep
counter can start.

## Review 154: Interruption Liveness And Guardrail Closure

Review154 fixed fresh DB, Start, script, and LSP/type-surface findings from the
post-Review153 sweeps.

1. DB Active Attempt Interruption Liveness
   - Status: fixed.
   - Files: `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: active load and mutation attempts could keep ownership after the
     owner fiber was interrupted, leaving later callers blocked behind a dead
     in-flight attempt.
   - Fix: active load and mutation owners now finalize their visible attempt
     state through `Effect.onExit(...)`, completing the attempt and clearing
     active ownership on success, failure, or interruption.
   - Benefits: the Collection load/mutation Modules now have liveness Locality
     at the active-attempt seam. Interrupted callers do not poison future
     preloads or mutation flushes.

2. Start Endpoint, Diagnostics, And CLI Seams
   - Status: fixed.
   - Files: `packages/start/src/start-request-handler.ts`,
     `packages/start/src/app-graph.ts`,
     `packages/start/src/start-diagnostics-cli-contract.ts`,
     `packages/start/src/start-transport-endpoints.ts`,
     `packages/start/test/start.test.ts`,
     `packages/start/test/app-graph.test.ts`, `type-tests/start.test-d.ts`,
     `docs/public-api-inventory.md`.
   - Problem: invalid handler endpoint options were resolved before the
     returned request Effect, diagnostics DTO decoding accepted colliding RPC
     and action endpoint facts, impact verify commands were shell-safe but not
     argv-safe for flag-shaped query text, and the public endpoint policy seam
     was under-documented for LSP users.
   - Fix: `createRequestHandlerEffect(...)` resolves endpoint policy inside the
     returned Effect and normalizes failures to `StartRequestHandlerError`.
     Diagnostics DTO decoding reuses `resolveStartTransportEndpointsEffect(...)`
     so collision facts fail as DTO errors. Impact verify commands put load
     options before graph query arguments and insert `--` for flag-shaped
     queries. Public endpoint path/conflict helpers and errors now carry hover
     docs and type pins.
   - Benefits: Start keeps endpoint policy in the typed Effect channel at the
     runtime and diagnostics seams, while CLI repair commands remain safe when
     route/action/query names resemble flags.

3. Effect-First And Package Guardrail False Negatives
   - Status: fixed.
   - Files: `scripts/audit-effect-first.mjs`,
     `scripts/package-manifest-targets.mjs`,
     `scripts/package-project-console-starter.mjs`,
     `scripts/workspace-package-discovery.mjs`,
     `docs/effect-first-audit.md`, `docs/package-hygiene-audit.md`.
   - Problem: the Promise static AST audit missed typed literal element access,
     package manifest target checks ignored package-local strings without `./`,
     generated starter artifact checks silently passed when both source and
     generated files were missing, local package adapter directory names could
     collide after normalization, and audit docs still described an older full
     verification gate.
   - Fix: the Effect-first audit unwraps `as`, `satisfies`, and type assertion
     expressions before classifying Promise statics and extraction patterns.
     Manifest validation rejects invalid package-local target strings with
     repair guidance. Generated artifact verification reports missing declared
     artifacts even when both sides are absent. Workspace discovery rejects
     duplicate local adapter directory names. Effect-first and package hygiene
     docs now point at the Review154 full gate.
   - Benefits: copyability and Promise guardrails now fail at the source of the
     policy breach instead of relying on downstream packaging luck or stale
     docs.

4. Core Program And Link Preloader LSP Pins
   - Status: fixed.
   - Files: `scripts/audit-public-api-inventory.mjs`,
     `type-tests/core.test-d.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`.
   - Problem: the Review153 Program runtime seam and Core browser-link
     preloader seam were behaviorally fixed, but their expert-public type and
     hover coverage lagged behind the new contract.
   - Fix: public API inventory checks now cover `startProgram(...)`,
     `Program.StartOptions`, `Program.RuntimeRemainingRequirements`, and the
     browser-link preloader decision/runtime/options surface. Public type tests
     pin those Interfaces so future changes preserve LSP discoverability.
   - Benefits: the typed runtime-preload contracts are visible where users and
     adapter authors actually cross the Interface, not only in prose review
     notes.

Focused verification passed: Start and DB package typechecks, public type
tests, public API audit, Effect-first audit over 272 files, DB collection tests
1 file / 113 tests, Start request/app-graph tests 2 files / 169 tests, script
syntax checks, malformed manifest target check, the 16-target package dry-run
gate, generated starter-suite packaging/verifies for basic/react/project-console
at 19/24/30 app files with 5/4/6 local packages, and `git diff --check`.

Full `pnpm verify` passed after Review154: 11 package builds, workspace
typecheck, public type tests, public API audit, Effect-first audit over 272
files, 53 root test files / 932 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, generated starter-suite packaging/verifies
for basic/react/project-console, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans. Fresh post-fix sweeps still need to run
before the clean-sweep counter can start.

## Review 153: Runtime Bounds, Finalization Metrics, And Package Walls

Review153 fixed the fresh Core, DB, Start, LSP/type-surface, and
package/starter findings from the post-Review152 sweep.

1. Core Program Runtime And Link Preload Seams
   - Status: fixed.
   - Files: `packages/core/src/program.ts`,
     `packages/core/src/browser-router-link.ts`,
     `packages/react/src/hooks.ts`, `packages/solid/src/hooks.ts`,
     `packages/core/test/program.test.ts`, `type-tests/core.test-d.ts`,
     `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`.
   - Problem: serviceful Programs could start through the ambient runtime even
     when TypeScript could not prove the Runtime Spine provided the Program's
     command, update, and subscription requirements. Router link preloads also
     accepted requirementful Effects at the Core preloader seam.
   - Fix: `Program.start(definition, { runtime })` is now the explicit typed
     runtime-bound Interface for serviceful Programs, and runtime
     startup/provision errors flow into `Program.RuntimeError`. React and Solid
     Program hooks pass their captured runtime through that seam. The Core link
     preloader now accepts only already-provided, requirement-free preload
     Effects.
   - Benefits: service discharge has Locality at the Runtime Spine seam instead
     of being implied by ambient context. Framework Adapters still hide the
     common case, while type tests prove missing Program services and serviceful
     Core preloads are rejected.

2. DB Superseded Loads, Query Keys, And Materialization Errors
   - Status: fixed.
   - Files: `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/src/sync-adapter.ts`,
     `packages/db/src/live-query-collection-materialization.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/sync-adapter.test.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: stale superseded load attempts still had ambiguous completion
     semantics, query sync Adapters kept sharing a mutable caller-owned query
     key, and raw live-query materialization throws could escape the collection
     error Interface.
   - Fix: superseded attempts now complete from a visible newer Ready state,
     join an active newer generation, or fail from the visible Failure state.
     Query sync Adapters detach the query key at construction and use owned
     copies for fetch and invalidation. Live Query Collection materialization
     normalizes unexpected load/snapshot throws into
     `EffectInputCallbackError` while preserving codec/callback errors.
   - Benefits: load generation, query Adapter identity, and materialization
     failures each have one local policy. Callers get deeper behavior behind
     the same collection Interfaces without needing generation or cloning
     discipline.

3. Start Request Finalization And Endpoint Collisions
   - Status: fixed.
   - Files: `packages/start/src/request-trace.ts`,
     `packages/start/src/request-runtime-lifecycle.ts`,
     `packages/start/src/request-runtime-response.ts`,
     `packages/start/src/start-transport-endpoints.ts`,
     `packages/start/src/app-graph.ts`,
     `packages/start/src/start-manifest-wall.ts`,
     `packages/start/src/start-vite-diagnostics-loader.ts`,
     `packages/start/src/start-agent-graph-contract.ts`,
     `packages/start/src/start-diagnostics-cli-contract.ts`,
     `packages/start/src/start-diagnostics-cli-runner.ts`,
     `packages/start/src/index.ts`, `packages/start/test/start.test.ts`,
     `packages/start/test/app-graph.test.ts`, `type-tests/start.test-d.ts`.
   - Problem: request duration/status metrics finalized before streaming
     response lifecycles were done, runtime cleanup failures could obscure the
     original response failure, RPC/action endpoint collisions were not rejected
     at every graph/diagnostics seam, and Start impact verify commands dropped
     diagnostics options.
   - Fix: request count remains at entry, while status and duration finalize
     from request runtime finalization events. Runtime disposal uses
     `Effect.exit`, preserves the original request failure, and records cleanup
     failure facts in teardown traces. Endpoint collision validation now flows
     through typed Start transport endpoint Effects at handler, app graph,
     manifest, and diagnostics seams. Impact verify commands include
     shell-safe `--root`, `--config`, and `--mode` options.
   - Benefits: observability now matches the real request lifetime, cleanup
     failures are visible without stealing the failure channel, and graph/CLI
     consumers get the same endpoint and verification policy as runtime
     Adapters.

4. Package, Starter, And Effect-First Guardrail Depth
   - Status: fixed.
   - Files: `scripts/audit-effect-first.mjs`,
     `scripts/package-project-console-starter.mjs`,
     `scripts/verify-package-dry-runs.mjs`,
     `scripts/workspace-package-discovery.mjs`,
     `scripts/package-manifest-targets.mjs`,
     `scripts/generated-starter-artifacts.mjs`.
   - Problem: workspace package discovery was duplicated, package dry-runs did
     not prove manifest targets existed in payloads, starter generated-artifact
     checks knew only one route file, leak-scan parity was too shallow, and the
     Promise static guardrail relied on regexes for increasingly rich syntax.
   - Fix: package/starter scripts now share Effect-backed workspace discovery,
     validate `exports`, `bin`, `main`, and `types` targets against packed and
     local Adapter payloads, use an explicit route/virtual generated artifact
     registry, require source starter leak-scan parity, and audit Promise
     statics through the TypeScript AST across direct, global, alias,
     extraction, and `.call/.apply/.bind` forms.
   - Benefits: package and starter copyability checks have stronger release
     leverage, while the Effect-first policy is enforced by syntax-aware
     analysis instead of fragile text matching.

Focused verification passed: Core/React/Solid/DB/Start package typechecks,
public type tests, public API audit, Effect-first audit over 272 files,
script syntax checks, Core Program/router tests 2 files / 25 tests,
React/Solid hook/router tests 4 files / 62 tests, DB collection/sync
adapter/live-query/SQLite tests 4 files / 172 tests, Start start/RPC/app-graph
tests 3 files / 182 tests, generated starter packaging at 19/24/30 app files
with 5/4/6 local packages, the 16-target package dry-run gate, and `git diff
--check`.

Full `pnpm verify` passed after Review153: 11 package builds, workspace
typecheck, public type tests, public API audit, Effect-first audit over 272
files, 53 root test files / 929 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, generated starter-suite packaging/verifies
for basic/react/project-console, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans. Fresh post-fix sweeps still need to run
before the clean-sweep counter can start.

## Review 152: Runtime Seams, Router Modules, And Generated Guardrails

Review152 fixed the fresh Core, DB, Start, docs/LSP, and package/starter
findings from the post-Review151 sweep.

1. Core Route Preload And Browser Router Locality
   - Status: fixed.
   - Files: `packages/core/src/route.ts`,
     `packages/core/src/browser-router*.ts`, `type-tests/core.test-d.ts`,
     `scripts/audit-public-api-inventory.mjs`.
   - Problem: Route preload planning reached through the broad public Resource
     facade, browser router kept history, link, render, kernel, and host
     controller Modules in one Implementation, and Core type-test ownership was
     too diffuse for important public Interfaces.
   - Fix: route preload planning now calls the Resource Runtime Module seam
     directly. Browser router keeps `browser-router.ts` as the public facade
     while focused history, link, render-decision, state, kernel, and host
     controller Modules own their Implementations. Core type tests now pin
     ActionResult, app, Form, Program, request/response context, Resource
     snapshot codec, route grammar, scope, and browser-router decision surfaces.

2. DB Load Generation, Live Query Identity, And SQLite Adapter Depth
   - Status: fixed.
   - Files: `packages/db/src/collection-sync-load-policy.ts`,
     `packages/db/src/live-query-runtime.ts`, `packages/db/src/query-plan.ts`,
     `packages/db/src/sqlite-persistence.ts`, `packages/db/test/*`,
     `packages/react-db/test/react-db.test.ts`,
     `packages/solid-db/test/solid-db.test.ts`.
   - Problem: superseded preload failures could still fail callers after a
     newer forced refetch made a collection Ready; live-query source
     fingerprint failures collapsed into generic evaluation errors; and the
     in-memory SQLite statement Adapter coerced malformed params.
   - Fix: superseded load attempts complete successfully when a newer Ready
     generation owns state, live-query source identity errors preserve
     `operation: "source"`, and SQLite memory statements validate exact param
     count, string params, and finite numeric params before row access.

3. Start Request, Manifest, Action, And Trace Interfaces
   - Status: fixed.
   - Files: `packages/start/src/request-runtime-lifecycle.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/start-transport-protocol.ts`,
     `packages/start/src/start-manifest-wall.ts`,
     `packages/start/src/vite.ts`, `packages/start/src/request-trace.ts`,
     `packages/start/test/start.test.ts`, `type-tests/start.test-d.ts`.
   - Problem: Start applied response metadata through the synchronous Core
     helper, one-shot manifest/action Iterables could be consumed more than
     once, and request-trace records/metrics had shallow hover/type ownership.
   - Fix: Start response metadata now crosses the typed Effect path, manifest
     Iterables are normalized once at the Vite/manifest seam, explicit actions
     are materialized once at handler creation, file-route manifest entry
     Iterables synthesize modules correctly, and request trace records plus
     metrics have declaration-site JSDoc and Start-owned type pins.

4. Package And Starter Guardrails
   - Status: fixed.
   - Files: `scripts/verify-package-dry-runs.mjs`,
     `scripts/package-project-console-starter.mjs`,
     `scripts/audit-effect-first.mjs`,
     `scripts/audit-public-api-inventory.mjs`,
     `scripts/starter-template-content.mjs`.
   - Problem: package dry-run targets repeated workspace membership by hand,
     starter packaging could copy stale local package dist output when run
     standalone, generated starter templates escaped Effect-first auditing, and
     starter leak-scan scripts could drift independently.
   - Fix: package dry-runs now discover workspace package manifests and require
     an explicit payload policy for every discovered package. Starter packaging
     builds each local package before copying, audits generated starter
     templates as virtual Effect-first files, and verifies starter leak scans
     are byte-for-byte identical.

Focused verification passed: Core/DB/Start/React-DB/Solid-DB package
typechecks, public type tests, public API audit, Effect-first audit over 269
files including generated starter templates, Core router/route/resource tests
3 files / 100 tests, DB/React-DB/Solid-DB tests 4 files / 150 tests, Start
tests 2 files / 158 tests, generated starter packaging at 19/24/30 app files
with 5/4/6 local packages, 16-target package dry-run gate, and `git diff
--check`.

Full `pnpm verify` passed after Review152: 11 package builds, workspace
typecheck, public type tests, public API audit, Effect-first audit over 269
files, 53 root test files / 919 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, generated starter-suite packaging/verifies
for basic/react/project-console, 16-target package dry-run gate,
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scans. Fresh post-fix sweeps still need to run
before the clean-sweep counter can start.

## Review 150: Public Adapter Hovers And Package Payload Gates

Status: fixed for the fresh post-Review149 docs/LSP, Effect-first guardrail,
public API audit, package dry-run, and generated-starter tarball sweeps. Focused
and full verification are green. Fresh post-fix sweeps still need to run before
the clean-sweep counter can start.

- Public Start adapter hover depth: fetch and Node adapter overloads and
  implementation declarations now have declaration-site JSDoc, and the public
  API inventory audit checks every overload declaration for the curated expert
  public Adapter functions. LSP users now see what the Effect-first Adapter does
  instead of landing on an undocumented overload or implementation signature.
- Public type-test coverage locality: the public API inventory audit now
  verifies imported type-test bindings by walking identifiers outside import
  declarations instead of scanning raw text. String literals, comments, and
  templates can no longer accidentally satisfy the coverage Interface.
- Package payload wall: `pnpm example:pack-dry-run` now covers all 11 framework
  packages plus the five starter/example source packages. Framework packages
  must ship only `package.json` and `dist/*`, while source packages stay
  source-only with `.gitignore` coverage and no generated output, lockfiles,
  dependency directories, build info, or local metadata. The generated basic,
  React, and project-console starters are the standalone copyable paths; the
  devtools panel and extension remain workspace examples with source package
  gates.
- Effect-first Promise factory guardrail: the audit now rejects
  `Promise.try(...)`, `Promise.withResolvers(...)`, and extracted forms through
  dot, bracket, and template-literal static member access, keeping new Promise
  factory APIs out of library internals unless they are explicitly adapted at a
  host seam.
- Generated starter tarball locality: generated basic, React, and
  project-console starters now include `.effect-ui-packages` in their package
  `files` allowlist, and `pnpm starter:package` dry-runs each generated starter
  tarball to prove local file-package Adapters are present while forbidden app
  artifacts remain absent.
- Release-command drift: the README and package-hygiene docs now include the
  package dry-run gate alongside starter packaging so the release checklist
  names the same verification wall as root `pnpm verify`.

Focused verification passed: `pnpm starter:package` verified generated starter
manifests and tarball payloads for basic (19 app files / 5 local packages),
React (24 app files / 4 local packages), and project-console (30 app files /
6 local packages); `pnpm audit:public-api`; `pnpm audit:effect-first` over
259 files; `pnpm typecheck:types`; `git diff --check`; source routeTree
generated-artifact diff; raw Error/TypeError/subclass grep; direct Promise
fixture grep; and the 16-target package dry-run gate from `pnpm build &&
pnpm example:pack-dry-run`.

Full `pnpm verify` passed after Review 150: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 259 files, 53 root test files / 901 tests, devtools-panel verify with
2 tests, devtools-extension verify with 20 tests, basic starter verify with
2 tests, React starter verify with 3 tests, generated starter-suite packaging/
verifies for basic (19 app files / 5 local packages), React (24 app files /
4 local packages), and project-console (30 app files / 6 local packages),
16-target package dry-run gate for all framework packages plus the basic
starter, React starter, project-console example, devtools panel, and devtools
extension, project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scan.

## Review 149: Runtime Store Laziness And Copyability Gates

Status: fixed for the fresh post-Review148 Core runtime, Effect-first guardrail,
and starter/package sweeps. Focused and full verification are green. Fresh
post-fix sweeps still need to run before the clean-sweep counter can start.

- Resource Store implementation opacity: the internal Resource Store
  implementation marker now uses a module-local `Symbol(...)` instead of a
  global `Symbol.for(...)`, so external structural Adapters cannot recreate the
  marker and reach mutable internals. A regression proves the old global marker
  spoof is rejected as `InvalidResourceStore`.
- Runtime Spine laziness: `EffectUiRuntime.provide(...)` now validates
  `resourceStore` overrides inside the returned Effect with `Effect.suspend(...)`
  rather than throwing synchronously while constructing the Effect. The public
  Interface now matches its LSP promise that providing services does not start
  or validate work until the Effect is run.
- Effect-first template-key guardrail: the audit now treats static
  no-substitution template keys such as ``Promise[`all`]`` and
  ``client[`then`]`` like quoted bracket access. Self-tests cover direct Promise
  static calls, extracted Promise statics, `.then(...)`, `.catch(...)`, and
  `.finally(...)` through template keys.
- Generated starter content drift: `pnpm starter:package` now compares generated
  route artifact contents, currently `src/routeTree.gen.ts`, after standalone
  verify. If Vite silently rewrites a copied starter's generated artifact, the
  packager fails until the source starter artifact is regenerated and committed.
- Package dry-run locality: root `pnpm verify` now includes
  `pnpm example:pack-dry-run`, an Effect-backed package payload gate that runs
  dry-runs for the basic starter, React starter, project-console example,
  devtools panel, and devtools extension. It rejects `dist`, `.test-dist`,
  `node_modules`, lockfiles, build info, local metadata, and missing
  `.gitignore` files.

Focused verification passed: Core typecheck, public type tests, public API
audit, Effect-first audit over 259 files, Core ResourceStore/runtime tests
2 files / 16 tests, starter-suite packaging/verifies for basic (19 app files /
5 local packages), React (24 app files / 4 local packages), and project-console
(30 app files / 6 local packages), source routeTree generated-artifact diff,
Start virtual declaration-map absence checks, the new five-package dry-run gate,
and raw Error/TypeError/subclass grep.

Full `pnpm verify` passed after Review 149: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 259 files, 53 root test files / 901 tests, devtools-panel verify with
2 tests, devtools-extension verify with 20 tests, basic starter verify with
2 tests, React starter verify with 3 tests, generated starter-suite packaging/
verifies for basic (19 app files / 5 local packages), React (24 app files /
4 local packages), and project-console (30 app files / 6 local packages),
five-package dry-run gate for the basic starter, React starter, project-console
example, devtools panel, and devtools extension, project-console typecheck,
4 project-console test files / 27 tests, project-console build, and leak scan.

## Review 148: Resource Store Opacity, Query Error Locality, And Audit Guardrails

Status: fixed for the fresh post-Review147 runtime-spine, DB, docs/LSP,
Effect-first guardrail, and starter/devtools sweeps. Focused and full
verification are green. Fresh post-fix sweeps still need to run before the
clean-sweep counter can start.

- Public Resource Store opacity: `ResourceStore` remains an expert-public
  diagnostic Interface, but now carries an internal implementation marker so
  structural external Adapters cannot masquerade as the mutable store
  Implementation. `EffectUiRuntime.provide(..., { resourceStore })` rejects
  fake structural stores with a typed `InvalidResourceStore` defect instead of
  drifting into raw mutable-map failures. Type tests pin that mutable store
  constructors and unsafe accessors stay out of the root public surface.
- Resource deletion no-op locality: `Resource.deleteEffect(ref)` now peeks at
  existing Resource Store entries, inputs, and tag facts before mutating. A
  never-present ref leaves diagnostics unchanged and does not create empty
  family maps or publish misleading deletion events.
- Resource previous-value read contract: `ResourcePending` and
  `ResourceFailure` now expose `hasPrevious` separately from `previous`, so a
  successful `undefined` value remains distinguishable from no previous value in
  synchronous render reads and LSP hovers.
- DB query error locality: indexed join probes now run inside the Query
  Evaluation Module's `join` operation wrapper. `Query.diagnostics(...)` and
  `Query.onceEffect(...)` report selector failures as `QueryEvaluationError`
  values with `operation: "join"` instead of surfacing raw selector throws or
  misclassifying them as whole-plan evaluation failures.
- React/Solid DB docs drift: DB docs now name both `@effect-ui/react-db` and
  `@effect-ui/solid-db` as framework-local collection/live-query Adapters and
  describe automatic preload failure recording for both packages.
- Effect-first guardrail depth: the audit now rejects Promise static extraction
  through direct assignments and destructuring, including aliased destructuring
  such as `const { all: promiseAll } = Promise`, so Promise combinators cannot
  be smuggled past member-call scans.
- Public API inventory drift: the Core Source Surface docs and audit now agree
  that `resource-store` is selected from the root barrel rather than
  star-exported, preserving the public diagnostic Interface without exposing
  mutable internals.
- Starter/devtools package hygiene: `@effect-ui/start` removes the stale
  `dist/virtual.d.ts.map` after replacing the built virtual declaration with
  `src/virtual-modules.d.ts`, generated starters prove that stale map is absent,
  and devtools panel/extension examples now package local `.gitignore` files
  while their dry-runs stay source-only.

Focused verification passed: Core/DB/project-console typechecks, public type
tests, public API audit, Effect-first audit over 258 files, Core Resource/
ResourceStore/runtime plus DB collection tests 4 files / 179 tests, Start clean
build with no stale `virtual.d.ts.map`, generated starter-suite packaging/
verifies for basic (19 app files / 5 local packages), React (24 app files /
4 local packages), and project-console (30 app files / 6 local packages),
devtools panel/extension verifies and package dry-runs including `.gitignore`,
generated-output cleanup checks, raw throw/subclass grep, direct Promise
fixture grep, and broad `as any`/`@ts-ignore` grep.

Full `pnpm verify` passed after Review 148: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 258 files, 53 root test files / 900 tests, devtools-panel verify with
2 tests, devtools-extension verify with 20 tests, basic starter verify with
2 tests, React starter verify with 3 tests, generated starter-suite packaging/
verifies for basic (19 app files / 5 local packages), React (24 app files /
4 local packages), and project-console (30 app files / 6 local packages),
project-console typecheck, 4 project-console test files / 27 tests,
project-console build, and leak scan.

## Review 147: Resource Runtime Cleanup And Starter Package Hygiene

Status: fixed for the fresh post-Review146 runtime-spine, docs/LSP,
Effect-first guardrail, DB, and starter/devtools sweeps. Focused and full
verification are green. Fresh post-fix sweeps still found actionable work, so
the clean-sweep counter has not started.

- Resource Runtime lifetime cleanup: stale `Resource.readEffect(...)` refreshes
  now fork through a tracked detached-fiber helper that unregisters completed
  fibers from the owning `ResourceStore`. A regression proves stale read
  refresh work raises the diagnostic fiber count while active and returns it to
  zero after completion.
- Resource previous-value presence: the Resource Lifetime Module now carries a
  presence-bearing previous-value snapshot instead of using `undefined` as the
  absence sentinel. Resources whose successful value is actually `undefined`
  retain `previous` state during refresh and failure, so read boundaries and UI
  status report `hasPrevious`/`hasValue` correctly.
- Public Resource Store surface: the Core root barrel now explicitly exports
  supported Resource Store Interfaces and constructors instead of wildcard
  re-exporting mutable internals. Type tests reject root imports of
  `MutableResourceStore`, `makeMutableResourceStore(...)`, and
  `unsafeMutableResourceStore(...)`.
- Start fetch guardrail: invalid custom Start fetch hooks now fail with a typed
  `Data.TaggedError` value mapped into `ServerTransportError`, avoiding a raw
  `TypeError` throw inside package source while preserving the Effect-first
  guidance.
- Starter/package hygiene: every package build removes both `dist` and
  `.tsbuildinfo` before compiling, preventing stale package artifacts from
  shipping. The starter packager also rejects dist files without a source
  module before copying local packages.
- Generated starter cleanliness: basic, React, and project-console starters now
  include their own `.gitignore`; generated verification cleans
  `node_modules`, `dist`, `.test-dist`, and the lockfile, then re-runs manifest
  and forbidden-output checks after each standalone verify. The verified
  generated app manifests are now 19, 24, and 30 app files.
- Public Start adapter type coverage: the root `@effect-ui/start/adapters`
  facade now pins `createFetchHandler(...)` and the same serviceful-runtime
  negative assertion as the fetch subpath.

Focused verification passed: Core/Start typechecks, public type tests, public
API audit, Effect-first audit over 258 files, Core Resource/ResourceStore/UI
and React/Solid hook tests 5 files / 94 tests, Start RPC tests 1 file / 14
tests, Start package clean build, Start pack dry-run stale-generator grep,
starter package dry-runs including `.gitignore`, generated starter-suite
packaging/verifies for basic (19 app files / 5 local packages), React
(24 app files / 4 local packages), and project-console (30 app files / 6 local
packages), generated-output cleanup checks, raw throw/subclass grep, and direct
Promise fixture grep.

Full `pnpm verify` passed after Review 147: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 258 files, 53 root test files / 897 tests, devtools-panel verify with
2 tests, devtools-extension verify with 20 tests, basic starter verify with
2 tests, React starter verify with 3 tests, starter-suite packaging for basic
(19 app files / 5 local packages), React (24 app files / 4 local packages), and
project-console (30 app files / 6 local packages), project-console typecheck,
4 project-console test files / 27 tests, project-console build, and leak scan.

## Review 146: Runtime Store Override And Generated Starter Verification

Status: fixed for the fresh post-Review145 runtime/locality, docs/LSP,
Effect-first guardrail, DB docs, and starter-copyability sweeps. Focused and
full verification are green. Fresh post-fix sweeps still found actionable work,
so the clean-sweep counter has not started.

- Runtime Store override locality: `EffectUiRuntime.provide(..., {
  resourceStore })` now installs an ambient runtime Adapter whose
  `resourceStore`, nested `provide(...)`, `runFork(...)`, and `runSync(...)`
  preserve the override. A Core regression prefetches a Resource into an
  override store and proves `Resource.read(...)` inside the same provided Effect
  reads that store rather than the base runtime store.
- Generated starter verification: `pnpm starter:package` now installs each
  generated starter outside the workspace with `--ignore-workspace`, runs that
  starter's own `verify` script, rejects workspace protocols outside
  `node_modules`/build output, and removes generated install/build artifacts.
  The generated gate now verifies basic, React, and project-console payloads at
  18, 23, and 29 app files.
- Starter leak scans: basic, React, and project-console starters now ship a
  bundled Effect-backed Node leak scanner instead of relying on user-global
  `rg`. The Effect-first audit includes these copyable starter scripts.
- Public type/docs drift: focused Start fetch/node subpath type tests now pin
  runtime-required host facades and low-level adapter aliases. Current docs
  explain virtual module type opt-in through a checked declaration import and DB
  mutation flush docs name rollback persistence failure precedence.
- Promise fixture cleanup: Start negative tests now use explicit
  `Effect.runPromise(...)` host-boundary fixtures instead of `Promise.resolve`
  or `new Promise` conveniences.

Focused verification passed: Core/Start package typechecks, public type tests,
public API audit, Effect-first audit over 258 files, Core runtime tests
1 file / 8 tests, Start tests 2 files / 151 tests, DB collection tests
1 file / 105 tests, source starter verifies, generated starter packaging, and
direct Promise fixture grep.

Full `pnpm verify` passed after Review 146: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 258 files, 53 root test files / 894 tests, devtools-panel verify with
2 tests, devtools-extension verify with 20 tests, basic starter verify with
2 tests, React starter verify with 3 tests, starter-suite packaging for basic
(18 app files / 5 local packages), React (23 app files / 4 local packages), and
project-console (29 app files / 6 local packages), project-console typecheck,
4 project-console test files / 27 tests, project-console build, and leak scan.

## Review 145: Effect Guardrails, Ambient Runtime, And Starter Copyability

Status: fixed for the fresh post-Review144 architecture/locality, docs/LSP,
Effect-first guardrail, and starter-copyability sweeps. Focused and full
verification are green. Fresh post-fix sweeps must still run before the
clean-sweep counter can be considered.

- Effect-first audit guardrails: the scanner now catches parenthesized and
  extracted Promise statics/member calls such as `(Promise).all(...)`,
  `(Promise.all)(...)`, `(client.then)(...)`, and
  `client.then.call(...)`. Example Vite configs are now inside the audited
  scope, raising the checked set to 255 files.
- Start render runtime locality: `EffectUiRuntime.provide(...)` now installs the
  active runtime in an Effect v4 fiber-local `Context.Reference`, so synchronous
  helpers such as `Resource.read(...)` see the request runtime while returned
  render Effects execute. A Start regression proves a returned render Effect can
  read a route-preloaded Resource from the request store.
- Public type/docs pins: Start render context type tests now pin
  `legacyHydrationScript`, the deprecated `hydrationScript` alias,
  `hydrationRootScript`, and `StartRenderHydrationPlan`. Focused
  `@effect-ui/start-fetch` and `@effect-ui/start-node` package type tests now
  cover Effect handlers, host facades, runtime-required options, and low-level
  adapter aliases.
- Starter copyability: `pnpm starter:package` now generates basic, React, and
  project-console starter payloads with local `.effect-ui-packages/*` file
  dependencies, standalone Vite/tsconfig files, no workspace protocols, no
  monorepo aliases, and install dry-runs outside the workspace. Example package
  manifests now have `files` allowlists so dry-runs exclude `dist` and
  `.test-dist` artifacts.
- Test sharp-cast cleanup: form and router negative tests no longer use `as any`;
  invalid public API calls are marked with `@ts-expect-error`, while form
  snapshots use precise mutable helper types.

Focused verification passed: Core/Start/Solid typechecks, public type tests,
public API audit, Effect-first audit over 255 files, starter-suite packaging,
example package dry-runs, and focused touched tests
`packages/core/test/form.test.ts`, `packages/core/test/browser-router.test.ts`,
`packages/solid/test/router.test.ts`, and `packages/start/test/start.test.ts`
(4 files / 192 tests).

Full `pnpm verify` passed after Review 145: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 255 files, 53 root test files / 893 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, starter-suite packaging for basic
(16 app files / 5 local packages), React (21 app files / 4 local packages), and
project-console (27 app files / 6 local packages), project-console typecheck,
4 project-console test files / 27 tests, project-console build, and leak scan.

## Review 144: Collection Store Sync Locality And Public Kernel Pins

Status: fixed for the fresh post-Review143 architecture/locality, docs/LSP, and
Effect-first guardrail sweeps. Focused and full verification are green. Fresh
post-fix sweeps must still run before the clean-sweep counter can be considered.

- DB collection-store sync locality: `pendingMutations()`, `snapshot()`, and
  `Collection.dehydrate(...)` now default to the active `currentCollectionStore`
  override, matching `rows()` and `state()`. A collection regression hydrates
  one runtime store with pending optimistic state, leaves a second store empty,
  and proves all three synchronous reads honor the explicit store override.
- Browser-router public kernel pins: `BrowserRouterKernelOptions`,
  `BrowserRouterKernel`, and `createBrowserRouterKernel` now have public hover
  docs, are covered by the public API hover audit, and are asserted in the Core
  public type tests.
- Effect-first audit hardening: package-source declaration files are now in the
  audit scope, bringing `packages/start/src/virtual-modules.d.ts` under the
  scanner. The audit catches optional Promise statics/member calls and anchors
  structural thenable type surfaces to the two runtime guard seams.
- Docs drift: the historical overnight requirement is no longer worded as a
  current May 16 requirement, the active checklist wording distinguishes latest
  verification from a clean post-fix sweep, and the project-console starter
  repair text names versioned package imports without monorepo aliases.

Focused verification passed: `pnpm --filter @effect-ui/db typecheck`, `pnpm
--filter @effect-ui/core typecheck`, `pnpm typecheck:types`, `pnpm
audit:public-api`, `pnpm audit:effect-first`, `pnpm exec vitest run
packages/db/test/collection.test.ts` (1 file / 105 tests), and `git diff
--check`.

Full `pnpm verify` passed after Review 144: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 250 files, 53 root test files / 892 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console starter packaging
with 27 files verified, project-console typecheck, 4 project-console test files
/ 27 tests, project-console build, and leak scan.

## Review 143: Stale StartAction Invalidation And Audit Guardrails

Status: fixed for the fresh post-Review142 architecture/locality, docs/LSP, and
Effect-first guardrail sweeps. Focused and full verification are green. Fresh
post-fix sweeps must still run before the clean-sweep counter can be considered.

- StartAction stale invalidation: stale successful parallel submissions no
  longer drop all response metadata. Hydration and visible action state remain
  latest-only, but accepted server invalidation metadata now still runs in the
  captured/caller runtime. A Start regression proves a late stale response can
  refresh a separately preloaded resource without overwriting the newer
  hydrated resource value.
- Browser-history public seam closure: the public hover audit now covers the
  complete exposed history seam, including `BrowserNavigateOptions`,
  `BrowserHistoryWindow`, React/Solid `BrowserRouterOptions`, and React/Solid
  `RouterProviderProps`. Core, React, and Solid type tests now assert injected
  `BrowserHistoryAdapter` values across the provider/options surfaces.
- Effect-first audit guardrails: the scanner now treats all
  `PromiseLike<T>` type surfaces as anchored exceptions, including alias and
  `extends` forms, and catches bracket/multiline Promise choreography such as
  `Promise["all"](...)`, `Promise\n.all(...)`, `client["then"](...)`, and
  split typed member chains.
- Docs drift: the active verification gate in the ultimate checklist now
  matches the Review143 full gate, and project-console starter docs describe
  the 27-file copyable-source manifest comparison plus workspace-manifest
  version rewrite policy without claiming published packages.

Focused verification passed: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/react typecheck`, `pnpm --filter @effect-ui/solid
typecheck`, `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first`, and `pnpm exec vitest run packages/start/test/start.test.ts`
(1 file / 136 tests).

Full `pnpm verify` passed after Review 143: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 249 files, 53 root test files / 891 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console starter packaging
with 27 files verified, project-console typecheck, 4 project-console test files
/ 27 tests, project-console build, and leak scan.

## Review 142: Runtime Locality And Verification Pin Closure

Status: fixed for the fresh post-Review141 runtime, React DB parity, public
hover/type, Effect-first scanner, and docs-drift sweep. Focused and full
verification passed. Fresh post-fix sweeps found the Review 143 stale
StartAction invalidation, public seam, audit guardrail, and docs-drift gaps.

- StartAction runtime locality: `StartAction.use(...)` now mirrors Core
  `Action.use(...)` runtime capture policy. It captures explicit or ambient
  runtimes only; an instance created outside a runtime leaves response
  hydration/invalidation inside the returned Effect so the caller runtime's
  Resource Store owns the update. Start coverage proves uncaptured action
  metadata applies to the caller runtime and not the default runtime.
- React DB parity coverage: React DB now has the same runtime-ownership
  regressions as Solid DB for returned collection/live-query Effects, mutation
  handler/pending-mutation state, and live-query collection subscriptions
  scoped to the explicit `RuntimeProvider` runtime.
- Public browser-history seam pins: the public hover-doc audit and Core type
  tests now name the Browser History Adapter seam (`BrowserHistoryAdapter`,
  `MemoryBrowserHistoryAdapter`, and the window/memory adapter factories) so
  Review 140's provider history projection cannot lose LSP docs or public type
  coverage silently.
- Effect-first scanner hardening: `scripts/audit-effect-first.mjs` now bans
  `Promise.allSettled(...)`, `Promise.any(...)`, and typed member chains such
  as `.then<T>(...)`, `.catch<T>(...)`, and `.finally<T>(...)`, with self-tests
  for those holes and the `Effect.catch<T>(...)` exemption.
- Starter docs drift: release, copyability, and checklist docs now describe
  the 27-file exact project-console starter manifest and workspace
  package-manifest dependency rewrite policy, and release notes include the
  checked React starter path.

Focused verification passed: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/react-db typecheck`, `pnpm typecheck:types`, `pnpm
audit:public-api`, `pnpm audit:effect-first`, `pnpm exec vitest run
packages/start/test/start.test.ts` (1 file / 136 tests), and `pnpm exec vitest
run packages/react-db/test/react-db.test.ts` (1 file / 10 tests).

Full `pnpm verify` passed after Review 142: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 249 files, 53 root test files / 891 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console starter packaging
with 27 files verified, project-console typecheck, 4 project-console test files
/ 27 tests, project-console build, and leak scan.

## Review 141: Project Console Runtime Store and Starter Manifest Gate

Status: fixed for the fresh post-Review140 Project Console and starter tooling
sweep. Focused verification is green. Full verification passed after this
review and before Review 142.

- Project Demo Store: project-console seed state now lives behind the
  server-only `ProjectDemoStore` Effect service, backed by an Effect `Ref` and
  provided by `ProjectDemoStoreLive`. Server functions depend on this Runtime
  Spine service instead of a module-global `Map`, while direct local-client tests
  provide a fresh store layer per Effect program.
- Server app runtime composition: `server.tsx` now builds the server app with
  `Layer.mergeAll(ProjectApiLive, ProjectDemoStoreLive)`. `app-definition.ts`
  remains browser-safe and does not import `domain.server.ts`, preserving the
  existing client leak-scan boundary for seed data and server implementation
  modules.
- Project Console starter manifest gate: `scripts/package-project-console-starter.mjs`
  now collects the copyable source file manifest and generated starter manifest
  through Effect, compares them exactly, rejects forbidden build/dependency path
  segments anywhere in the payload, and reports the verified file count. The
  package command now verified 27 generated files instead of a shallow
  hand-maintained 17-file list.
- Starter dependency version policy: workspace protocol dependencies are now
  rewritten from the versions declared by `packages/*/package.json` instead of a
  hard-coded placeholder, and starter docs/README text now names that policy.

Focused verification passed: `pnpm example:typecheck`, `pnpm example:test` (4
files / 27 tests), `pnpm example:build`, `pnpm example:leak-scan`, `pnpm
starter:project-console:package` (27 files verified), generated package
dependency inspection, generated forbidden-token grep, `pnpm typecheck:types`,
`pnpm audit:public-api`, `pnpm audit:effect-first`, and `git diff --check`.

Full `pnpm verify` passed after Review 141: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 249 files, 53 root test files / 887 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console starter packaging
with 27 files verified, project-console typecheck, 4 project-console test files
/ 27 tests, project-console build, and leak scan.

## Review 140: Router History Projection and Program Runtime Scheduling

Status: fixed for the fresh post-Review139 Core/React/Solid sweep. Focused
verification is green, but fresh post-fix sweeps found the Review 141 Project
Console runtime store and starter packaging issues.

- Router Provider history projection: React and Solid `RouterProvider` now
  expose the Core `BrowserHistoryAdapter` seam that `createBrowserRouter(...)`
  already accepted. Provider-level tests prove navigation commits to the
  injected memory history Adapter and does not mutate the host `window.history`
  path.
- Program Runtime Scheduler: live Program background-fiber policy now lives in
  `program-runtime-scheduler.ts`. Runtime-owned detached work enters the
  Runtime Spine through `runtime.runFork(...)`, while already-provided
  acknowledged processor/subscription Effects keep their explicit
  `runtime.provide(...)` boundary so Runtime Spine startup/provision failures
  still become typed Program dispatch/subscription failures instead of killing
  the queue before acknowledgements complete.
- Program dispatch regression hook: Core Program tests now wrap an
  `AnyEffectUiRuntime` and assert fire-and-forget dispatch enters the owning
  Runtime Spine, while the existing runtime-provision failure test continues to
  cover acknowledged dispatch error reporting.

Focused verification passed: `pnpm --filter @effect-ui/core typecheck`, `pnpm
--filter @effect-ui/react typecheck`, `pnpm --filter @effect-ui/solid
typecheck`, `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first`, `pnpm exec vitest run packages/core/test/program.test.ts
packages/react/test/router.test.ts packages/solid/test/router.test.ts` (3 files
/ 47 tests), and `git diff --check`.

## Review 139: Endpoint Runner, Query Seams, and Audit Anchors

Status: fixed for the fresh post-Review138 Start, DB, public audit, and
docs/vocabulary sweeps. Full verification passed after this slice, but fresh
post-fix sweeps found the Review 140 Core/React/Solid runtime/router seams.

- Start Transport Endpoint Runner: shared RPC/action endpoint policy now lives
  in `start-transport-endpoint-runner.ts`. RPC and action endpoints provide
  protocol-specific Adapter slots while envelope creation, request validation,
  Request Runtime provisioning, diagnostics headers, transport failure tracing,
  and runtime failure tracing stay local to one Module.
- Start trace/diagnostics cleanup: request trace response projection now
  feature-detects `Headers.getSetCookie()` and degrades to zero when a host
  omits it, and malformed action JSON bodies now report action request wording
  instead of server-function wording.
- Query Execution Plan seam: Live Query Runtime now validates through
  `validateQueryExecutionPlan(...)`, keeping Query validation callers on the
  Query Execution Plan Module Interface instead of reaching back to Query Plan.
- Collection Projection Callback Policy: state lookup, projection callback
  normalization, functional update application, and row-key preservation now
  live in `collection-projection-callback-policy.ts` instead of being copied
  across Collection Runtime, Collection Sync Load Policy, and Collection
  Mutation Workflow.
- Public type-test manifest depth: `type-tests/public-api.manifest.json` can
  now require `typeTestReferences`, and the public API audit rejects vacuous
  side-effect-only focused type tests. `type-tests/start-virtual.test-d.ts`
  now pins representative `virtual:effect-ui/*` declarations.
- Effect-first audit anchoring: `scripts/audit-effect-first.mjs` now stores
  named seam anchors with context matchers rather than file/count allowances, so
  replacing an approved occurrence with another same-pattern occurrence in the
  same file fails.
- Domain vocabulary drift: `CONTEXT.md` now describes the actual bidirectional
  Public API Source Surface Coverage Gate Interface from Review 137, including
  namespace-backed modules that require an explicit audit allowance plus a
  root-barrel import.

Focused verification passed: `pnpm --filter @effect-ui/db typecheck`, `pnpm
--filter @effect-ui/start typecheck`, `pnpm typecheck:types`, `pnpm
audit:public-api`, `pnpm audit:effect-first`, `pnpm exec vitest run
packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts
packages/db/test/sync-adapter.test.ts` (3 files / 149 tests), `pnpm exec
vitest run packages/start/test/rpc.test.ts packages/start/test/start.test.ts`
(2 files / 149 tests), and `git diff --check`.
Full `pnpm verify` passed after the slice: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 248 files, 53 root test files / 884 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 138: Effect Audit Wording Exactness

Status: fixed for the fresh post-Review137 Effect/Promise wording sweep. Full
verification is green, but fresh post-fix sweeps found the Review 139 Start,
DB, public audit, and docs/vocabulary issues.

- Effect-first audit wording: `scripts/audit-effect-first.mjs` now describes
  allowlisted matches as exact allowed occurrence counts rather than all of them
  as host seams, since public type-test Promise fixtures are intentional
  negative assertions rather than runtime host boundaries.
- Exactness claim: the Review 136 docs now say the audit catches deleted
  occurrences or cross-file moves, matching the file/count mechanism instead of
  implying line-level movement anchors inside an allowed file.

Focused verification passed: `pnpm audit:effect-first` and `git diff --check`.
Full `pnpm verify` passed after the slice: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 246 files, 53 root test files / 882 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 137: Bidirectional Public Source Surface Audit

Status: fixed for the fresh post-Review136 verification-gap sweep. Focused
verification is green, but a fresh post-fix Effect/Promise wording sweep found
the audit wording exactness gap fixed in Review 138. Full verification passed
after the Review 138 follow-up.

- Public inventory exactness: `scripts/audit-public-api-inventory.mjs` now
  checks the Source Surface local-module lists in both directions. Root barrel
  re-exported modules must be documented, documented local source modules must
  actually be re-exported by the package root barrel, and namespace-backed
  source modules require an explicit audit allowance plus a root-barrel import.
- Public API drift guard: the audit now fails if an internal implementation
  module is accidentally listed as part of a root package surface again, closing
  the gap exposed by the Review 136 DB inventory cleanup while preserving the
  public DB `sync-adapter` surface exposed through `Collection.*`.
- LSP docs contract: `docs/public-api-inventory.md` now documents the
  bidirectional source-surface audit so future hover/docs updates have the same
  machine-checked boundary as the public import-path manifest.

Focused verification passed: `pnpm audit:public-api`, `pnpm typecheck:types`,
`pnpm audit:effect-first`, and `git diff --check`.

## Review 136: Exact Effect Audit and Public Inventory Drift

Status: fixed for the fresh post-Review135 test-gap and docs/LSP findings.
Focused verification is green, but a fresh post-fix verification-gap sweep
found the bidirectional source-surface audit gap fixed in Review 137. Full
verification passed after the Review 138 follow-up.

- Effect-first audit exactness: approved Effect-first occurrences in
  `scripts/audit-effect-first.mjs` now require an exact per-file count and
  print `= N`, so deleted occurrences or cross-file moves cannot pass under an
  old at-most allowance. Banned-pattern exceptions still use upper-bound counts.
- DB public inventory: `docs/public-api-inventory.md` no longer claims
  internal `collection-definition-snapshot` or `collection-state` modules are
  part of the `@effect-ui/db` root export surface.
- Start app graph helper hovers: `describeFileRouteManifestEntry(...)`,
  `describeStartAppGraphRouteDiagnosticsRuntimeCandidate(...)`,
  `describeServerFunctionManifestEntry(...)`, and
  `describeActionManifestEntry(...)` now have declaration-site JSDoc and are
  pinned by the public hover audit.

Focused verification passed: `pnpm audit:effect-first`, `pnpm
audit:public-api`, `pnpm --filter @effect-ui/start typecheck`, and `git diff
--check`.

## Review 135: Store-Explicit Hydration Apply and Strict Diagnostics DTOs

Status: fixed for the fresh post-Review134 architecture, Effect/Promise,
docs/LSP, and test-gap sweeps. Full verification passed, but fresh post-fix
sweeps found the Review 136 docs/LSP and test-gap issues, so the Thirty-Sweep
clean counter remains at 0.

- DB store-explicit hydration: `StoreExplicitCollectionSnapshotDefinition` now
  includes `hydrateWithStoreEffect(...)`, and Collection Persistence applies
  marked definitions through that store-aware Interface instead of recursing
  back through the public collection facade. Live Query Collections keep their
  read-only hydrate failure through the same store-explicit contract.
- Start diagnostics DTO strictness: the shared diagnostics decoder now rejects
  malformed preload status, action behavior presence, and action concurrency
  strings before Vite/CLI policy checks or agent graph projection can consume
  them.
- Public Vite diagnostics type surface: `type-tests/start-vite.test-d.ts` now
  imports the diagnostics gate, build-policy validators, diagnostics policy
  validators, load DTO/error types, and asserts `StartBuildPolicyError` remains
  static-only rather than reabsorbing resolved diagnostics errors.
- Public hover audit: `StartBuildPolicyError` now has declaration-site JSDoc
  and the public hover audit pins `StartBuildPolicy` plus
  `StartBuildPolicyError`.
- Effect-first exact seams: the Promise return-type audit now tightens
  `packages/start/src/fetch-adapter.ts` to its single real
  `Promise<Response>` host facade.

Focused verification passed: `pnpm --filter @effect-ui/db typecheck`, `pnpm
--filter @effect-ui/start typecheck`, `pnpm typecheck:types`, `pnpm
audit:public-api`, `pnpm audit:effect-first`, `pnpm exec vitest run
packages/start/test/app-graph.test.ts -t "DTO|malformed graph payloads|policy"`
(1 file / 3 selected tests), `pnpm exec vitest run
packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts
-t "store-explicit|hydrate preflight|store-aware adapter"` (2 files / 4
selected tests), and `git diff --check`.
Full `pnpm verify` passed after the slice: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 246 files, 53 root test files / 882 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 134: Runtime Diagnostics Policy and Audit Drift Closure

Status: fixed for the fresh post-Review133 architecture, Effect/Promise,
docs/LSP, and test-gap sweeps. Full verification passed, but fresh post-fix
sweeps found the Review 135 architecture, Effect/Promise, docs/LSP, and
test-gap issues, so the Thirty-Sweep clean counter remains at 0.

- Start graph query vocabulary: `StartAgentGraphQueryKind` is now derived from
  `startAgentGraphQueryKinds`, removing the second hand-maintained authority
  between the contract and vocabulary modules.
- Static vs resolved diagnostics policy: `validateStartBuildPolicyEffect(...)`
  now validates only static app graph policies. Resolved route-preload
  diagnostics policy remains enforced by the generated runtime diagnostics
  virtual module and the Vite diagnostics gate, where route modules and
  registries are actually loaded.
- Public hover regression hook: the public API audit now also pins
  `Program`, Start app graph parse/DTO/deserialization declarations, and the
  public deserializer hover docs. `docs/public-api-inventory.md` now records
  the curated hover-doc audit contract explicitly.
- Effect-first exact seams: `scripts/audit-effect-first.mjs` now removes stale
  `Effect.runPromise` allowances for Start fetch/Vite files and tightens the
  request runtime response seam to the single remaining host boundary.
- Diagnostics and hydrate regression coverage: Start tests now cover disabled
  runtime diagnostics policy serialization, Vite diagnostics opt-outs, and the
  disabled build diagnostics gate. DB collection tests now cover
  multi-collection hydrate preflight for incomplete store-explicit payloads
  before any earlier collection mutates.
- Package-boundary assertions: `type-tests/start.test-d.ts` now imports the
  expanded Start app graph diagnostics policy, route-preload validator,
  DTO/deserializer, and error surface through `@effect-ui/start`.

Focused verification passed: `pnpm exec vitest run packages/start/test/start.test.ts
-t "diagnostics policy|build diagnostics gate|runtime diagnostics virtual
module|typed static build policy"` (1 file / 8 selected tests), `pnpm exec
vitest run packages/db/test/collection.test.ts -t "store-explicit
payload|preflights incomplete|multi-collection hydration"` (1 file / 2 selected
tests), `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 246 files, and `pnpm --filter @effect-ui/start
typecheck`.
Full `pnpm verify` passed after the slice: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 246 files, 53 root test files / 881 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 133: App Graph Public Hover and CLI Vocabulary Seams

Status: fixed for the fresh post-Review132 docs/LSP and test-gap sweeps. Full
verification passed, but fresh post-fix sweeps found the Review 134
architecture, audit, docs/LSP, and test gaps, so the Thirty-Sweep clean counter
remains at 0.

- App Graph public hover coverage: `packages/start/src/app-graph.ts` now
  documents the important public diagnostics candidates, policy inputs,
  decoders, graph constructors, diagnostics projectors, unknown-preload
  classifiers, and policy validators. `scripts/audit-public-api-inventory.mjs`
  now enforces JSDoc for those declarations and the extracted diagnostics
  policy Module.
- Public package-boundary assertions: `type-tests/start.test-d.ts` now imports
  the public app graph diagnostics and policy APIs from `@effect-ui/start`,
  pinning package-export drift instead of relying only on source-local tests.
- Diagnostics policy opt-out semantics:
  `packages/start/test/app-graph.test.ts` now asserts top-level disabled
  policy, `null`, section-level `false`, and `requireDeclaredForPreload: false`
  all suppress unknown preload diagnostics.
- CLI query vocabulary seam: `packages/start/test/start.test.ts` now
  table-tests every `startAgentGraphQueryKinds` value through
  `parseStartDiagnosticsCliArgs(...)` and `runStartDiagnosticsCliEffect(...)`,
  including hyphenated `resource-tag`, for both graph and impact commands.
- Verification snapshots: current-facing docs that still pointed at old Review
  86/92/120 full gates now point at the Review 132 full `pnpm verify` result.

Focused verification passed: `pnpm audit:public-api`, `pnpm --filter
@effect-ui/start typecheck`, `pnpm typecheck:types`, `pnpm audit:effect-first`
over 246 files, and `pnpm exec vitest run packages/start/test/app-graph.test.ts
packages/start/test/start.test.ts -t "policy|query kind|parser/runtime seam|parses and runs"`
(2 files / 11 selected tests), and `git diff --check`.
Full `pnpm verify` passed after the slice: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 246 files, 53 root test files / 877 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 132: Start Diagnostics Policy Module and Regression Hooks

Status: fixed for the fresh post-Review131 architecture, docs/LSP, and test-gap
sweeps. Full verification passed, but fresh post-fix docs/LSP and test-gap
sweeps found the public app graph hover and CLI seam gaps fixed in Review 133,
so the Thirty-Sweep clean counter remains at 0.

- Start App Graph Diagnostics Policy: added
  `packages/start/src/start-app-graph-diagnostics-policy.ts` as the focused
  internal Module for route preload diagnostics policy, typed policy errors,
  violation collection/formatting, synchronous enforcement, and validation
  Effects. `app-graph.ts` preserves the public compatibility facade while
  Start Manifest Wall, diagnostics/agent graph contracts, Vite exports, and the
  Vite diagnostics loader consume the named policy Seam.
- Public hover regression hook: `scripts/audit-public-api-inventory.mjs` now
  parses selected public declaration surfaces with TypeScript and fails when
  important LSP hover declarations lack JSDoc. `packages/core/src/program.ts`
  documents `startProgramWithRuntimeError(...)`, and
  `packages/core/src/program-contract.ts` documents the direct public Program
  contract symbols, aliases, event DTOs, story types, and runtime handle.
- Store-explicit hydrate regression: `packages/db/test/live-query-collection.test.ts`
  now pins that incomplete store-explicit snapshot markers fail during hydrate
  preflight with `operation: "hydrate"` and do not mutate collection rows.
- Start agent graph vocabulary regression:
  `packages/start/test/app-graph.test.ts` now table-tests every
  `startAgentGraphQueryKinds` value against node-kind filtering and shared
  impact verify command generation.

Focused verification passed: `pnpm audit:public-api`, `pnpm --filter
@effect-ui/core typecheck`, `pnpm --filter @effect-ui/start typecheck`, `pnpm
typecheck:types`, `pnpm audit:effect-first` over 246 files, `pnpm exec vitest
run packages/db/test/live-query-collection.test.ts` (1 file / 29 tests), and
`pnpm exec vitest run packages/start/test/app-graph.test.ts` (1 file / 17
tests), and `git diff --check`.
Full `pnpm verify` passed after the slice: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 246 files, 53 root test files / 875 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 131: Public Hover Completion

Status: fixed for the post-Review130 docs/LSP sweep and focused verification is
green. Full verification passed, but the fresh post-hover sweeps found the
Start diagnostics policy Module, hover regression hook, and test gaps fixed in
Review 132, so the Thirty-Sweep clean counter remains at 0.

- Start Agent Graph facade: `packages/start/src/agent-graph.ts` now documents
  `createStartAgentGraph(...)` and `createStartAgentGraphEffect(...)`, the
  public constructors that project Start app graph diagnostics into the
  agent-readable graph used by CLI repair flows.
- Program namespace aliases: `packages/core/src/program.ts` now has
  declaration-site JSDoc on the public `Program.*` type aliases, including
  runtime errors, timeline events, deterministic story entries, steps, commands,
  and subscriptions.
- Start Vite Diagnostics Loader: `packages/start/src/start-vite-diagnostics-loader.ts`
  now documents the public `StartAppGraphDiagnosticsLoadError` union used by
  Vite diagnostics loaders and build policy callers.

Focused verification passed: `pnpm --filter @effect-ui/core typecheck`, `pnpm
--filter @effect-ui/start typecheck`, `pnpm typecheck:types`, `pnpm
audit:public-api`, and `pnpm audit:effect-first` over 245 files.
Full `pnpm verify` passed after the hover-only slice: 11 package builds,
workspace typecheck, public type tests, public API inventory audit, Effect-first
audit over 245 files, 53 root test files / 873 tests, devtools-panel verify with
2 tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 130: DB Store-Explicit Collection Snapshot Interface

Status: fixed for the DB candidate found by the fresh Review 129 sweep and
fully verified. The post-fix architecture and Effect/Promise sweeps found no
source architecture or Promise-shaped blockers, but the docs/LSP sweep found the
hover gaps fixed in Review 131, so the Thirty-Sweep clean counter remains at 0.

- Store-Explicit Collection Snapshot: added
  `packages/db/src/collection-definition-snapshot.ts` as the focused internal
  Module for the snapshot marker, store-explicit snapshot Interface, guard,
  snapshot dispatch, hydrate preflight dispatch, and incomplete-marker errors.
- Collection Persistence: `packages/db/src/collection-persistence.ts` now
  consumes the store-explicit snapshot Module instead of owning duplicate
  structural casts. Marked definitions fail with a typed
  `CollectionSnapshotCodecError` when their explicit-store implementation is
  incomplete rather than falling back to `definition.snapshot()`.
- Live Query Collection: `packages/db/src/live-query-collection.ts` now
  registers its read-only derived collection snapshot implementation through the
  store-explicit Module, keeping runtime-store projection locality inside the
  materialization path.
- Regression coverage: `packages/db/test/live-query-collection.test.ts` now
  pins that an incomplete store-explicit marker fails during dehydrate instead
  of reading the ambient Collection Store.

Focused verification passed: `pnpm --filter @effect-ui/db typecheck`, `pnpm
exec vitest run packages/db/test/live-query-collection.test.ts` (1 file / 28
tests), `pnpm exec vitest run packages/db/test/collection.test.ts
packages/db/test/live-query-collection.test.ts packages/db/test/sync-adapter.test.ts
packages/db/test/server-collection.test.ts packages/db/test/sqlite-persistence.test.ts`
(5 files / 160 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, and
`pnpm audit:effect-first` over 245 files, and `git diff --check`.
Full `pnpm verify` passed after the slice: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 245 files, 53 root test files / 873 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 129: Start Graph Vocabulary, Diagnostics DTO Depth, and LSP Docs

Status: fixed for the Start/docs findings from the fresh Review 129 sweep and
focused verification is green. The same sweep found a DB store-explicit
snapshot Interface candidate, which is fixed in Review 130 below; the
Thirty-Sweep clean counter remains at 0 until a fresh post-fix sweep finds no
actionable work.

- Start Agent Graph Vocabulary: added
  `packages/start/src/start-agent-graph-vocabulary.ts` as the semantic catalog
  for query kinds, query-to-node mapping, and node-to-impact-relation mapping.
  The CLI contract, graph query Module, and impact planner now consume one
  vocabulary Seam instead of each owning partial graph-kind switches.
- Start App Graph Diagnostics DTO: `packages/start/src/app-graph.ts` now
  validates resource family diagnostics, resource tag diagnostics, and
  collection definition diagnostics structurally instead of only checking that
  registry sections are arrays. The DTO decoder now catches malformed registry
  diagnostics before the Vite diagnostics loader, CLI, devtools, or agent graph
  adapters can assume missing `name`/policy fields.
- LSP-facing public docs: Start agent graph DTOs/functions, diagnostics report
  contracts, diagnostics report formatting, and the golden-path `Program`
  namespace aliases now have declaration-site JSDoc for hover help. The public
  API inventory also names the DB `sync-adapter` source surface and current
  docs-drift scope.

Focused verification passed: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/core typecheck`, `pnpm --filter @effect-ui/start build`,
`pnpm exec vitest run
packages/start/test/app-graph.test.ts` (1 file / 16 tests), `pnpm exec vitest
run packages/start/test/start.test.ts -t 'diagnostics CLI|agent graph|app graph
diagnostics|diagnostics report'` (1 file / 7 selected tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, and `pnpm audit:effect-first` over
244 files.
Full `pnpm verify` remained pending until the DB Review 130 follow-up.

## Review 128: DB Query Context Identity Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Query Context Identity: added `packages/db/src/query-context-identity.ts` as
  the focused internal Module for source alias/key identity, collection row
  delta identity, merged context identity, ordered-context tie-break identity,
  and IVM context metadata.
- Query Execution Plan: `packages/db/src/query-execution-plan.ts` now consumes
  Query Context Identity for stable equal-order tie breaks while keeping query
  validation, preload/refetch, snapshot execution, diagnostics, and projection
  stages local.
- Live Query Runtime: `packages/db/src/live-query-runtime.ts` now consumes the
  same identity Module for source deltas, context merge keys, IVM row keys, and
  ordered live-query parity instead of owning a separate symbol/string policy.
- Regression coverage: added
  `packages/db/test/query-context-identity.test.ts` for key-type identity,
  self-join alias identity, delimiter-safe merges, base-source-before-join
  ordering, and missing-key fallback.

Focused verification passed: `pnpm --filter @effect-ui/db typecheck`, `pnpm
exec vitest run packages/db/test/query-context-identity.test.ts
packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
(3 files / 134 tests), `pnpm exec vitest run packages/db/test/collection.test.ts
packages/db/test/live-query-collection.test.ts packages/db/test/sync-adapter.test.ts
packages/db/test/server-collection.test.ts packages/db/test/sqlite-persistence.test.ts`
(5 files / 159 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 243 files, and `git diff --check`.
Full `pnpm verify` also passed after the slice.

## Review 127: Start Agent Graph Formatter and Impact Modules

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start Agent Graph Contract: added
  `packages/start/src/start-agent-graph-contract.ts` for graph node, edge,
  query, impact, and formatting DTO Interfaces while `agent-graph.ts` remains
  the public package facade.
- Start Agent Graph Query: added
  `packages/start/src/start-agent-graph-query.ts` for query-kind matching,
  text search, result edge selection, and Effect wrappers.
- Start Agent Graph Display/Formatter: added
  `packages/start/src/start-agent-graph-display.ts` and
  `packages/start/src/start-agent-graph-formatter.ts` so concise/verbose graph
  text, impact text, display titles, truncation, and no-match copy no longer
  live beside semantic graph projection.
- Start Agent Graph Impact Planner: added
  `packages/start/src/start-agent-graph-impact.ts` for edit targets,
  contracts, dependencies, may-affect relations, warnings, and shell-safe
  verify command injection from the Start Diagnostics CLI Contract.
- Facade locality: `packages/start/src/agent-graph.ts` now owns graph
  projection from diagnostics and re-exports the focused internal Modules.

Focused verification passed: `pnpm --filter @effect-ui/start build`, `pnpm
exec vitest run packages/start/test/app-graph.test.ts` (1 file / 16 tests),
`pnpm exec vitest run packages/start/test/start.test.ts` (1 file / 130 tests),
`pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over
242 files, and `git diff --check`.
Full `pnpm verify` also passed after the slice.

## Review 126: Core Program Runtime Lifecycle Hardening

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Program dispatch acknowledgement locality: `packages/core/src/program-runtime.ts`
  now tracks pending `dispatchEffect(...)` acknowledgements and completes them
  during disposal before interrupting runtime fibers and shutting down the
  queue. Dispatch after disposal remains a no-op success.
- Program subscription commit ownership: subscription restarts now happen in
  the message commit path after a successful model write, preserving the
  `Object.is` restart behavior without routing lifecycle work through a hidden
  `Signal.subscribe(...)` observer.
- Program subscription generation policy: each restart and disposal advances a
  generation token so stale subscription emissions or failures cannot enqueue
  messages or record timeline facts after a newer model generation exists.
- Program disposal race guard: post-dispose update continuations no longer write
  model state, run commands, or record stale update failures after disposal has
  already completed pending acknowledgements.

Focused verification passed: `pnpm --filter @effect-ui/core typecheck`, `pnpm
exec vitest run packages/core/test/program.test.ts` (1 file / 12 tests), `pnpm
exec vitest run packages/devtools/test/devtools.test.ts -t 'Program'` (1 file
/ 3 selected tests), `pnpm exec vitest run packages/react/test/hooks.test.ts -t
'Program'` (1 file / 1 selected test), `pnpm exec vitest run
packages/solid/test/hooks.test.ts -t 'Program'` (1 file / 1 selected test),
`pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over
237 files, and `git diff --check`.
Full `pnpm verify` also passed after the slice.

## Review 125: Core Program Runtime Coordinator Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Program Contract: added `packages/core/src/program-contract.ts` for Program
  symbols, public data Interfaces, event DTOs, story Interfaces, and the runtime
  error channel.
- Program Primitives: added `packages/core/src/program-primitives.ts` for
  Program guards, command/subscription normalization, failure DTO construction,
  EffectInput update stepping, and pure constructors shared by story and
  runtime execution.
- Program Story Harness: added `packages/core/src/program-story.ts` so
  deterministic story execution and command resolution no longer import live
  runtime Queue, Fiber, Scope, or subscription machinery.
- Program Runtime Coordinator: added `packages/core/src/program-runtime.ts` for
  live queue processing, command fibers, subscription fibers, runtime provision,
  failure recording, dispatch acknowledgements, and disposal. The public
  `packages/core/src/program.ts` file is now the facade that preserves the
  public exports and `Program` namespace while capturing Runtime Spine and
  `UiScope`.

Focused verification passed: `pnpm --filter @effect-ui/core typecheck`, `pnpm
exec vitest run packages/core/test/program.test.ts` (1 file / 8 tests), `pnpm
exec vitest run packages/devtools/test/devtools.test.ts -t 'Program'` (1 file
/ 3 selected tests), `pnpm exec vitest run packages/react/test/hooks.test.ts -t
'Program'` (1 file / 1 selected test), `pnpm exec vitest run
packages/solid/test/hooks.test.ts -t 'Program'` (1 file / 1 selected test),
`pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over
237 files, and `git diff --check`.
Full `pnpm verify` also passed after the slice.

## Review 124: Core Program Runtime Timeline Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Program Runtime Timeline: added
  `packages/core/src/program-runtime-timeline.ts` as the focused internal
  Module for Program event retention, sequence assignment, optional program name
  annotation, disabled timeline behavior, and timeline clearing.
- Program facade locality: `packages/core/src/program.ts` now keeps public
  Program constructors, story harness, message queue, command fibers,
  subscription restart, failure recording, and disposal local while delegating
  retention bookkeeping to the timeline Module.
- Regression coverage: Program tests now pin that `timeline: false` suppresses
  message and disposal events while preserving model updates and disposal
  behavior.

Focused verification passed: `pnpm --filter @effect-ui/core typecheck`, `pnpm
exec vitest run packages/core/test/program.test.ts` (1 file / 8 tests), `pnpm
exec vitest run packages/devtools/test/devtools.test.ts -t 'Program'` (1 file
/ 3 selected tests), `pnpm exec vitest run packages/react/test/hooks.test.ts -t
'Program'` (1 file / 1 selected test), `pnpm exec vitest run
packages/solid/test/hooks.test.ts -t 'Program'` (1 file / 1 selected test),
`pnpm audit:public-api`, `pnpm typecheck:types`, `pnpm audit:effect-first` over
233 files, and `git diff --check`.
Full `pnpm verify` also passed after the slice.

## Review 123: Start Diagnostics CLI Contract Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start Diagnostics CLI Contract: added
  `packages/start/src/start-diagnostics-cli-contract.ts` as the shared Module
  for graph/impact query-kind vocabulary and shell-safe impact verification
  commands.
- Effect v4 CLI depth: `packages/start/src/cli.ts` still builds real nested
  `Command` subcommands from the shared catalog, while `CliError.InvalidValue`
  expected text and compatibility usage fallback no longer maintain a parallel
  hand-written command reference.
- Agent graph locality: `packages/start/src/agent-graph.ts` now delegates
  impact report verify-command planning to the CLI contract instead of
  constructing `effect-ui-start` command strings inside graph analysis.
- Regression coverage: app graph tests pin shell-safe verify command quoting,
  and Start CLI tests continue to cover Effect CLI help/version, graph/impact
  subcommands, and invalid usage paths.

Focused verification passed: `pnpm --filter @effect-ui/start typecheck`, `pnpm
exec vitest run packages/start/test/start.test.ts -t 'diagnostics CLI|Start
diagnostics CLI|usage result|graph route|impact'` (1 file / 4 tests), `pnpm
exec vitest run packages/start/test/app-graph.test.ts -t 'agent graph|impact|verify
commands'` (1 file / 2 tests), `pnpm typecheck:types`, `pnpm audit:public-api`,
`pnpm audit:effect-first` over 232 files, and `git diff --check`.
Full `pnpm verify` also passed after the slice.

## Review 122: Browser Router Link Decision Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Browser Router Link Decision: `packages/core/src/browser-router.ts` now owns
  adapter-neutral hover preload and click navigation decisions for RouterLink.
  The policy maps user-handled event facts, modified clicks, target/download
  browser-handled links, outside-router routes, resolved hrefs, and replace
  navigation into `Preload`, `Navigate`, or `Ignore` decisions.
- Adapter locality: `packages/react/src/link.ts` and `packages/solid/src/link.ts`
  consume the Core decisions while keeping DOM event handler invocation,
  framework prop wiring, dynamic href construction, and owner cleanup local.
- LSP surface: Core exports `browserRouterLinkPreloadDecision(...)`,
  `browserRouterLinkClickDecision(...)`,
  `BrowserRouterLinkPreloadDecision`, `BrowserRouterLinkClickDecision`, and
  `BrowserRouterLinkIgnoreReason` with hover docs for future adapters.
- Regression coverage: Core browser-router tests now pin preload-disabled,
  default-prevented, browser-handled, outside-router, modified-click, and
  replace-navigation decisions, while React/Solid router tests continue to pin
  framework RouterLink wiring.

Focused verification passed: `pnpm --filter @effect-ui/core typecheck`, `pnpm
--filter @effect-ui/react typecheck`, `pnpm --filter @effect-ui/solid
typecheck`, and `pnpm exec vitest run packages/core/test/browser-router.test.ts
packages/react/test/router.test.ts packages/solid/test/router.test.ts` (3 files
/ 44 tests).
Full `pnpm verify` also passed after the slice.

## Review 121: DB Collection Mutation Workflow Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Collection Mutation Workflow: added
  `packages/db/src/collection-mutation-workflow.ts` as the focused Effect v4
  Module for optimistic insert/update/delete and pending mutation flush
  orchestration.
- Effect ownership: the new Module owns mutation handler DTO detachment,
  active-attempt `Deferred` joiners, `Schedule` retry, optimistic
  commit/rollback, `CollectionMutate*` lifecycle events, mutation persistence,
  and restored pending replay.
- Runtime locality: `packages/db/src/collection-runtime.ts` now delegates
  mutation and flush Effects to the workflow while keeping synchronous row
  reads, direct writes, change-feed application, hydration, persistence facades,
  and Collection facade construction local.
- Dead seam cleanup: the old broad collection input helper exports disappeared;
  callback Effect conversion now lives inside the owning load and mutation
  Modules.

Focused verification passed: `pnpm --filter @effect-ui/db typecheck`, `pnpm
--filter @effect-ui/db build`, selected mutation/flush tests (1 file / 31
selected tests), DB persisted/sync/flush tests (3 files / 26 tests), full DB
collection tests (1 file / 102 tests), `pnpm typecheck:types`, `pnpm
audit:public-api`, `pnpm audit:effect-first` over 231 files, and `git diff
--check`.
Full `pnpm verify` also passed after the slice.

## Review 120: Start Action Response Codec Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Action response codec: added
  `packages/start/src/start-action-response-codec.ts` for action response DTOs,
  invalidation metadata serialization, response metadata hydration payload
  construction, JSON/redirect response mode selection, action Exit-to-Response
  encoding, client response parsing, and typed output/error decoding.
- Schema codec locality: added `packages/start/src/start-schema-codec.ts` so
  request and response codecs share the same Effect Schema encode/decode policy
  instead of duplicating it.
- Transport protocol locality: `packages/start/src/start-transport-protocol.ts`
  now keeps RPC protocol behavior, action map construction, action failure-kind
  classification, and compatibility re-exports. Action client, request
  endpoints, client transport, and response application import the focused
  response codec directly.

Focused verification: `pnpm --filter @effect-ui/start typecheck` and `pnpm
exec vitest run packages/start/test/rpc.test.ts packages/start/test/start.test.ts
-t "action response|Start action|Start actions"` (2 files / 14 tests) passed.
Full `pnpm verify` also passed after the slice.

## Review 119: Devtools Runtime Seam Collapse

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Panels locality: `packages/devtools/src/panels.ts` now owns its summary and
  serialization dependencies directly. The removed `DevtoolsPanelsRuntime`
  Interface had one Adapter and did not represent real variation.
- Store locality: `packages/devtools/src/store.ts` now owns invalidation,
  route-plan, request-trace, summary, panel, and causal-graph dependencies
  directly. The removed `DevtoolsStoreRuntime` Interface had one Adapter and
  made the root facade know too much about Store internals.
- Facade depth: `packages/devtools/src/index.ts` now wires the public facade to
  the owning Modules instead of constructing one-off runtime objects.

Focused verification: `pnpm --filter @effect-ui/devtools typecheck` and `pnpm
exec vitest run packages/devtools/test/devtools.test.ts` (1 file / 70 tests)
passed. Full `pnpm verify` also passed after the slice.

## Review 118: Devtools Fact Identity Index Helpers

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Fact Identity: `packages/devtools/src/fact-identity.ts` now owns first-match
  fact index helpers for Devtools invalidation and route-plan facts, using the
  same bounded Devtools Serialization Policy fingerprint as other identity
  repairs.
- Interface narrowing: removed unused `normalizeImportedRequestTraceFacts(...)`
  from the internal Fact Identity Interface. Imported snapshots still normalize
  request trace facts through `normalizeRequestTraceFacts(...)`, which is the
  function Store and Summary actually consume.
- Store/Summary locality: `packages/devtools/src/store.ts` and
  `packages/devtools/src/summary-facts.ts` now consume the shared first-match
  helpers instead of duplicating fingerprint lookup policy at each Seam.

Focused verification: `pnpm --filter @effect-ui/devtools typecheck` and `pnpm
exec vitest run packages/devtools/test/devtools.test.ts` (1 file / 70 tests)
passed. Full `pnpm verify` also passed after the slice.

## Review 117: Browser Route Render Decision Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Browser Route Render Decision: `packages/core/src/browser-router.ts` now owns
  adapter-neutral outlet decisions for `Pending`, `Failure`, `NotFound`, ready
  component props, empty ready routes, and stable route-render keys.
- Adapter locality: `packages/react/src/route-render-scope.ts` and
  `packages/solid/src/route-render-scope.ts` consume the Core decision while
  keeping framework component invocation, default fallback rendering, and
  `UiScope` lifetime local to each Adapter.
- LSP surface: Core now exports `BrowserRouteOutletRenderers`,
  `BrowserRouteReadyRenderProps`, `BrowserRouteRenderDecision`,
  `browserRouteRenderDecision(...)`, and `browserRouteRenderKey(...)` with
  hover docs, so outlet state meaning is described in one place.
- Regression coverage: Core browser-router tests now pin ready, empty, and
  not-found route render decisions in addition to existing React/Solid router
  outlet coverage.

Focused verification: `pnpm --filter @effect-ui/core typecheck`, `pnpm --filter
@effect-ui/react typecheck`, `pnpm --filter @effect-ui/solid typecheck`, and
`pnpm exec vitest run packages/core/test/browser-router.test.ts
packages/react/test/router.test.ts packages/solid/test/router.test.ts` (3 files
/ 44 tests), `pnpm audit:public-api`, `pnpm typecheck:types`, `pnpm
audit:effect-first` over 228 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 228 files, 52 root test
files / 861 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 116: DB Collection Sync Load Policy Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Collection Sync Load Policy: added
  `packages/db/src/collection-sync-load-policy.ts` as the focused Effect-first
  Module for `preloadEffect(...)` and `refetchEffect(...)` load orchestration.
  It owns in-flight `Deferred` ownership/joining, forced-refetch generation
  freshness, restore-before-load, load/refetch selection, retry scheduling, row
  replacement, `CollectionLoaded`/`CollectionLoadFailure` events, and load
  persistence.
- Runtime locality: `packages/db/src/collection-runtime.ts` now keeps the
  public Collection facade, optimistic mutation execution, pending flush replay,
  direct writes, change-feed batch application, hydration, and persistence
  facades while delegating load/refetch ordering to the focused Module.
- Effect v4 fit: this extraction concentrates the real Effect orchestration
  seam instead of inventing Effects around pure row reads. The public Collection
  Interface still returns Effects for asynchronous load/refetch work and keeps
  synchronous read methods synchronous.
- Audit shape: the Effect-first source scope expanded to 228 auditable files
  after the new DB source Module.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm --filter
@effect-ui/db build`, `pnpm exec vitest run packages/db/test/collection.test.ts
-t "preload|refetch|load|restore|persistence"` (1 file / 37 selected tests),
`pnpm exec vitest run packages/db/test/persisted-options.test.ts
packages/db/test/sync-adapter.test.ts packages/db/test/flush-policy.test.ts` (3
files / 26 tests), `pnpm exec vitest run packages/db/test/collection.test.ts`
(1 file / 102 tests), `pnpm audit:public-api`, `pnpm typecheck:types`, `pnpm
audit:effect-first` over 228 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 228 files, 52 root test
files / 860 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 115: Start Vite Diagnostics Loader Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start Vite Diagnostics Loader: added
  `packages/start/src/start-vite-diagnostics-loader.ts` as the focused Module
  for temporary Vite server acquire/release, Start diagnostics virtual-module
  plugin setup, app graph DTO decoding, diagnostics policy exception mapping,
  `loadStartAppGraphDiagnosticsEffect(...)`, and
  `runStartViteDiagnosticsGateEffect(...)`.
- Vite facade locality: `packages/start/src/vite.ts` now keeps the public Vite
  plugin, sync hook facades, server-only transform guard, file-route generation,
  and dev SSR middleware wiring while re-exporting the diagnostics loader
  Interface for the public `@effect-ui/start/vite` subpath.
- CLI locality: `start-diagnostics-cli-runner.ts` imports diagnostics loading
  from the focused loader Module instead of depending on the broad Vite plugin
  Module.
- Audit shape: the Effect-first source scope expanded to 227 auditable files
  after the new Start source Module.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/start build`, `pnpm exec vitest run
packages/start/test/start.test.ts -t "loads resolved app graph diagnostics
through Vite|rejects resolved app graph diagnostics policy violations through
Vite|fails the Vite build diagnostics gate|Start diagnostics CLI"` (1 file / 6
selected tests), `pnpm exec vitest run packages/start/test/start.test.ts` (1
file / 130 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 227 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 227 files, 52 root test
files / 860 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 114: Start Diagnostics CLI Query Kind Subcommands

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start CLI grammar: `packages/start/src/cli.ts` now models each graph/impact
  query kind (`route`, `action`, `resource`, `module`, and the rest) as nested
  Effect v4 `Command` subcommands under `graph` and `impact`.
- Shared flags: graph `--verbose` is now an Effect CLI shared flag on the graph
  command, so `graph --verbose route ...`, `graph route --verbose ...`, and
  `graph route ... --verbose` all flow through the same command context.
- Argument policy: kind-specific query text remains an Effect v4
  `Argument.variadic(...)` plus `Argument.mapEffect(...)` parser, preserving the
  existing too-many-args and missing-impact-query diagnostics while letting the
  command tree own help/completion shape for the known kinds.
- Regression coverage: the Start CLI tests now pin generated nested help for
  `effect-ui-start graph route --help` as well as the existing parser/runtime
  behavior for query execution and invalid input.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/start build`, `pnpm exec vitest run
packages/start/test/start.test.ts -t "parses and runs the Start diagnostics CLI
wrapper|invalid Start diagnostics CLI input|queryable Start agent graph|high-signal
Start impact brief"` (1 file / 4 selected tests), `pnpm exec vitest run
packages/start/test/start.test.ts` (1 file / 130 tests), `pnpm
typecheck:types`, `pnpm audit:effect-first` over 226 files, and `git diff
--check` passed. Full `pnpm verify` passed: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 226 files, 52 root test files / 860 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 113: Start Action Request Codec Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start: added `packages/start/src/start-action-request-codec.ts` as the
  focused Start Action Request Codec Module. It owns the action request DTO,
  progressive form field contracts, `StartActionFormEncodeError`, schema-backed
  full/partial input encoding, form hidden-field generation, JSON request
  decoding, form-data request decoding, and hidden-JSON plus visible-field merge
  policy.
- Transport protocol locality: `packages/start/src/start-transport-protocol.ts`
  now keeps response DTOs, response encoding/decoding, invalidation metadata,
  failure classification, status parsing, action maps, and RPC helpers while
  re-exporting the request codec names for compatibility.
- Caller locality: `start-action-client.ts` imports request encoding/form
  helpers from the codec Module, and `start-request-endpoints.ts` imports
  `readStartActionRequestEffect(...)` from the codec Module.
- Public surface: the Start root now re-exports request codec names directly
  from the codec Module, and `docs/public-api-inventory.md` classifies
  `start-action-request-codec` in the Start source surface.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/start build`, `pnpm exec vitest run
packages/start/test/start.test.ts -t "same schema action request
codec|progressive form default encoding|runs Start actions from JSON and form
posts"` (1 file / 3 selected tests), `pnpm exec vitest run
packages/start/test/start.test.ts` (1 file / 130 tests), `pnpm exec vitest run
packages/start/test/rpc.test.ts` (1 file / 13 tests), `pnpm typecheck:types`,
`pnpm audit:public-api`, `pnpm audit:effect-first` over 226 files, and `git diff
--check` passed. Full `pnpm verify` passed: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 226 files, 52 root test files / 860 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 112: Core Action Workflow Resource Runtime Locality

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Core Action Execution Workflow: `packages/core/src/action-execution-workflow.ts`
  now imports `planResourceInvalidationEffect(...)` and
  `runResourceInvalidationPlanEffect(...)` directly from `resource-runtime.ts`.
- Facade locality: the internal action workflow no longer value-imports the
  public `Resource` namespace for sibling implementation calls. The public
  `Resource.planInvalidationEffect(...)` and
  `Resource.runInvalidationPlanEffect(...)` facade helpers remain the app-facing
  Interface.
- Runtime behavior: action invalidation planning/execution still uses the
  active Resource Store through Effect context, but the internal dependency now
  points at the Resource Runtime Module where that policy lives.

Focused verification: `pnpm --filter @effect-ui/core typecheck`, `pnpm vitest
run packages/core/test/action.test.ts packages/core/test/resource.test.ts` (2
files / 90 tests), `pnpm audit:effect-first` over 225 files, and `git diff
--check` passed. Full `pnpm verify` passed: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 225 files, 52 root test files / 860 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 111: Query Execution Ordering Parity

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- DB Query Execution Plan: `packages/db/src/query-execution-plan.ts` now owns
  the stable tie-break identity used when explicit `orderBy(...)` selectors
  compare equal. The identity is built from collection alias and row key in the
  same base-source/join order that the live IVM graph uses.
- Live Query Runtime: `packages/db/src/live-query-runtime.ts` now delegates
  equal-order comparison, source context identity, and merged context identity
  to the Query Execution Plan Module instead of keeping a live-only fallback
  that could drift from one-shot execution.
- Behavior fix: one-shot `Query.build(...).execute()` and
  `Query.live(...).evaluate()` now agree for equal sort keys. Callers that need
  domain-specific ordering should add another `orderBy(...)`; otherwise both
  engines use the same deterministic row-identity fallback.
- Regression coverage: added a DB query test that previously failed with
  `["Zeta", "Alpha"]` for one-shot execution while live evaluation produced
  `["Alpha", "Zeta"]`.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm
--filter @effect-ui/db build`, `pnpm vitest run
packages/db/test/collection.test.ts -t "one-shot and live ordering
parity|ordered live query windows|grouped aggregate ordered windows"` (1 file /
3 selected tests), `pnpm vitest run packages/db/test/collection.test.ts` (1 file
/ 102 tests), `pnpm vitest run packages/db/test/live-query-collection.test.ts`
(1 file / 27 tests), `pnpm audit:effect-first` over 225 files, and `git diff
--check` passed. Full `pnpm verify` passed: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 225 files, 52 root test files / 860 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 110: Start Diagnostics CLI Parser Compatibility

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start CLI parser compatibility: `parseStartDiagnosticsCliArgsEffect(...)` now
  runs the same Effect v4 command tree used by the runtime path and interprets
  `CliError.ShowHelp` as the compatibility `Help` result when the formatter
  reports a help-only action.
- Manual argv sniffing removed: the parser helper no longer maintains a local
  command-name set, top-level help detector, nested help detector, or unknown
  command precheck. Unknown subcommands and invalid arguments are owned by
  `Command.runWith(...)`, the Effect CLI parser, and formatter diagnostics.
- Usage guidance: typed `StartDiagnosticsCliUsageError` values can carry
  generated Effect CLI help as guidance, so embedding callers see the same
  grammar surface as the bin runner instead of the legacy hand-written usage
  string.
- Regression coverage: parser tests now pin empty argv and nested subcommand
  help as compatibility `Help` results while the runtime tests continue to pin
  formatted help and invalid-input exit codes.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm exec
vitest run packages/start/test/start.test.ts -t "parses and runs the Start
diagnostics CLI wrapper|returns a usage result for invalid Start diagnostics CLI
input"` (1 file / 2 selected tests), `pnpm typecheck:types`, `pnpm
audit:effect-first` over 225 files, `pnpm --filter @effect-ui/start build`,
built CLI top-level help, nested help, unknown-subcommand, and valid graph query
probes, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 225 files, 52 root test files / 859 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 109: Start Diagnostics CLI Runtime Dispatch

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start CLI runtime: `runStartDiagnosticsCliEffect(...)` now builds the
  Effect v4 command tree with handlers that delegate directly to
  `runStartDiagnosticsCliCommandEffect(...)`.
- Dispatch locality: runtime execution no longer calls
  `parseStartDiagnosticsCliArgsEffect(...)` and then manually dispatches the
  parsed command. The parser helper remains available for tests/embedding.
- Built-in CLI actions: `--help`, `--version`, and unknown-subcommand handling
  now flow through `Command.runWith(...)`, Effect CLI's built-in global flags,
  `CliError.ShowHelp`, and the formatter output path.
- Version source: the `effect-ui-start` command runner now reports
  `0.0.0-alpha.0`, matching the package version.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm exec
vitest run packages/start/test/start.test.ts -t "Start diagnostics CLI"` (1 file
/ 3 selected tests), `pnpm audit:effect-first` over 225 files, `pnpm --filter
@effect-ui/start build`, built CLI `--help`, `--version`, unknown-subcommand,
and valid graph query probes, and `git diff --check` passed. Full `pnpm verify`
passed: 11 package builds, workspace typecheck, public type tests, public API
inventory audit, Effect-first audit over 225 files, 52 root test files / 859
tests, devtools-panel verify with 2 tests, devtools-extension verify with 20
tests, basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 108: Start Diagnostics CLI Query Arguments

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start CLI grammar: `packages/start/src/cli.ts` now models graph and impact
  query tails as Effect v4 `Argument` values with `Argument.variadic(...)` and
  `Argument.mapEffect(...)`.
- Error channel: graph query arity, graph query kind validation, and impact
  required-query validation now fail through `CliError.InvalidValue` instead of
  command-construction throws caught as `unknown`.
- Handler locality: `diagnostics`, `graph`, and `impact` command handlers now
  pass parsed command objects directly to the runner callback; the old
  `commandFromCliConfigEffect(...)` throw wrapper is gone.
- CLI behavior: extra graph query tokens and `impact route` are rejected before
  Vite diagnostics loading, while valid inherited-flag commands such as
  `effect-ui-start --root examples/project-console graph route /projects/:id`
  still execute normally.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm exec
vitest run packages/start/test/start.test.ts -t "Start diagnostics CLI"` (1 file
/ 3 selected tests), `pnpm audit:effect-first` over 225 files, `pnpm --filter
@effect-ui/start build`, built CLI invalid graph/impact argument probes, built
CLI valid graph query probe, and `git diff --check` passed. Full `pnpm verify`
passed: 11 package builds, workspace typecheck, public type tests, public API
inventory audit, Effect-first audit over 225 files, 52 root test files / 859
tests, devtools-panel verify with 2 tests, devtools-extension verify with 20
tests, basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 107: Start Diagnostics CLI Shared Flags

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start CLI grammar: `packages/start/src/cli.ts` now defines common
  diagnostics options once on the root `effect-ui-start` command with Effect
  v4 `Command.withSharedFlags(...)`.
- Command context: `diagnostics`, `graph`, and `impact` handlers read the
  shared parent config by yielding the root command service, so `--root`,
  `--config`, `--mode`, `--json`, and `--pretty` are owned by the parent
  command instead of being structurally repeated in every subcommand.
- CLI behavior: the parser now supports the idiomatic inherited-flag form
  `effect-ui-start --root app diagnostics` while preserving the existing
  `effect-ui-start diagnostics --root app` form and unknown-command guidance.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm exec
vitest run packages/start/test/start.test.ts -t "Start diagnostics CLI"` (1 file
/ 3 selected tests), `pnpm audit:effect-first` over 225 files, `pnpm --filter
@effect-ui/start build`, `node packages/start/dist/cli.js --help`, `node
packages/start/dist/cli.js --root examples/project-console diagnostics --json`,
and `git diff --check` passed. Full `pnpm verify` passed: 11 package builds,
workspace typecheck, public type tests, public API inventory audit, Effect-first
audit over 225 files, 52 root test files / 859 tests, devtools-panel verify with
2 tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 106: Core Resource UI Binding Runtime Locality

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Core Resource UI Binding: `packages/core/src/resource-ui-binding.ts` now
  imports `resourceResult(...)`, `prefetchResourceEffect(...)`, and
  `refreshResourceEffect(...)` from `resource-runtime.ts`.
- Facade locality: the controller no longer value-imports the public
  `Resource` namespace for sibling implementation calls. The public Resource
  facade remains the app-facing Interface; the UI binding Module consumes the
  canonical runtime implementation seam directly.
- Runtime behavior: existing `runWithRuntime(...)`, `runtime.provide(...)`, and
  `resourceUiBindRuntimeEffect(...)` wrappers are unchanged.

Focused verification: `pnpm --filter @effect-ui/core typecheck`, `pnpm
typecheck:types`, `pnpm vitest run packages/core/test/resource-ui-binding.test.ts`
(1 file / 3 tests), `pnpm audit:effect-first` over 225 files, and `git diff
--check` passed. Full `pnpm verify` passed: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 225 files, 52 root test files / 859 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 105: Start Client Transport Status Policy

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start client transport: moved decoded-body HTTP status validation fully into
  `packages/start/src/start-client-transport.ts`.
- Protocol locality: removed `validateStartResponseStatusEffect(...)` from
  `packages/start/src/start-transport-protocol.ts`; the protocol module keeps
  request/body parsing and wire DTO validation, while the client transport owns
  post-parse status policy.
- Regression coverage: `packages/start/test/rpc.test.ts` now pins the RPC
  branch where a `Success` body with HTTP 500 becomes a `BadStatus`
  `ServerTransportError`.

Focused verification: `rg -n "validateStartResponseStatusEffect"
packages/start/src packages/start/test` returned no matches, `pnpm --filter
@effect-ui/start typecheck`, `pnpm vitest run packages/start/test/rpc.test.ts
packages/start/test/start.test.ts` (2 files / 143 tests), `pnpm
audit:effect-first` over 225 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 225 files, 52 root test
files / 859 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 104: DB Persisted Options Ownership

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- DB persistence: moved `persistedCollectionOptions(...)` from
  `packages/db/src/index.ts` into `packages/db/src/collection-persistence.ts`.
- Public facade: the top-level `persistedCollectionOptions` export and
  `Collection.persistedOptions` namespace alias remain stable.
- LSP docs: `CollectionPersistedOptions` now explains that the helper converts
  persisted options into normal `CollectionOptions` while unioning collection
  handler `E`/`R` with persistence storage `PE`/`PR`.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm
typecheck:types`, `pnpm vitest run packages/db/test/persisted-options.test.ts`
(1 file / 3 tests), `pnpm audit:public-api`, `pnpm audit:effect-first` over
225 files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 225 files, 52 root test files / 859 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 103: DB SQLite Statement Contract Ownership

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- DB facade: `packages/db/src/index.ts` no longer defines
  `Collection.SQLiteStatementValue`, `SQLiteStatementParams`,
  `SQLiteStatementRow`, or `SQLiteStatementDatabase` structurally in the root
  namespace.
- SQLite ownership: those namespace entries now alias the contracts already
  owned by `packages/db/src/sqlite-persistence.ts`.
- Public API: the `Collection.SQLiteStatement*` names remain available for
  LSP/discovery ergonomics, but the root facade no longer duplicates the
  statement adapter contract.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm
typecheck:types`, `pnpm vitest run packages/db/test/sqlite-persistence.test.ts
packages/db/test/persisted-options.test.ts` (2 files / 13 tests), `pnpm
audit:effect-first` over 225 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 225 files, 52 root test
files / 859 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 102: Start Diagnostics Vite Server Lifetime

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start Vite diagnostics: `packages/start/src/vite.ts` now acquires the
  temporary middleware-mode Vite server with `Effect.acquireRelease(...)` inside
  `Effect.scoped(...)`.
- CLI locality: `effect-ui-start diagnostics`, `graph`, `impact`, and the Vite
  build diagnostics gate continue to consume `loadStartAppGraphDiagnostics*`,
  but the server lifetime is now an explicit scoped Effect resource.
- Release policy: Vite server close failures still die from the finalizer, while
  create/load/decode/policy failures stay in the typed
  `StartAppGraphDiagnosticsLoadError` channel.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm vitest
run packages/start/test/start.test.ts -t "resolved app graph diagnostics"` (1
file / 2 selected tests), `pnpm audit:effect-first` over 225 files, and `git
diff --check` passed. Full `pnpm verify` passed: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 225 files, 52 root test files / 859 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console packaging/typecheck/
tests/build with 4 files / 27 tests, and leak scans.

## Review 101: Start Transport Body Readers

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start body readers: added `packages/start/src/start-transport-body.ts` as the
  internal Module for one-shot JSON, form-data, and response-text reads behind
  Effect v4 helpers.
- Protocol locality: `packages/start/src/start-transport-protocol.ts` now asks
  that Module to read request and response bodies, while keeping request shape,
  status, schema, and JSON parse policy in the transport protocol.
- Typed failures: request body read failures become `ServerRpcProtocolError`
  protocol failures; response body stream failures become `ServerTransportError`
  invalid-response failures before JSON decoding begins.
- Regression coverage: `packages/start/test/rpc.test.ts` now covers failing
  RPC JSON request reads, action form reads, RPC response text reads, and action
  response text reads without adding host async test bodies.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm vitest
run packages/start/test/rpc.test.ts packages/start/test/start.test.ts` (2 files
/ 143 tests), `pnpm audit:effect-first` over 225 files, and `git diff --check`
passed. Full `pnpm verify` passed: 11 package builds, workspace typecheck,
public type tests, public API inventory audit, Effect-first audit over 225
files, 52 root test files / 859 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console packaging/typecheck/tests/
build with 4 files / 27 tests, and leak scans.

## Review 100: Start Default Fetch Abort Signal

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start fetch: the default `globalThis.fetch` adapter in
  `packages/start/src/start-fetch.ts` now passes through the AbortSignal Effect
  v4 supplies to `Effect.tryPromise(...)`.
- Signal policy: default fetch calls merge the Effect interruption signal with
  any caller-provided `init.signal` and any `Request` input signal, using
  `AbortSignal.any(...)` when available and a small fallback controller
  otherwise.
- Regression coverage: `packages/start/test/rpc.test.ts` now forks a browser
  RPC client call, interrupts the fiber, and verifies that the fake global
  fetch receives and observes an aborted signal.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm vitest
run packages/start/test/rpc.test.ts packages/start/test/start.test.ts` (2 files
/ 142 tests), `pnpm audit:effect-first` over 224 files, and `git diff --check`
passed. Full `pnpm verify` passed: 11 package builds, workspace typecheck,
public type tests, public API inventory audit, Effect-first audit over 224
files, 52 root test files / 858 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console packaging/typecheck/tests/
build with 4 files / 27 tests, and leak scans.

## Review 99: Devtools Serialization Policy Contract Edge

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Devtools contract: moved `DevtoolsSerializationPolicy` into
  `packages/devtools/src/devtools-contract.ts`, so the public contract owns the
  Store serialization/redaction policy it references.
- Serialization implementation: `packages/devtools/src/serialization.ts` now
  imports the policy from the contract and re-exports it for compatibility.
  The dependency arrow is one-way: serialization depends on the public
  contract, while the contract no longer imports the serialization
  implementation.
- Internal locality: Store and fact-identity helpers now import the policy from
  the contract module, closing the small back-edge left after Review 96.

Focused verification: `pnpm --filter @effect-ui/devtools typecheck`, `pnpm
vitest run packages/devtools/test/devtools.test.ts` (1 file / 70 tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over 224
files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 224 files, 52 root test files / 857 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 98: Core Resource Store Test Effect Boundary

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Core tests: converted the Resource Store diagnostics snapshot test from an
  `async` Vitest body with multiple `Effect.runPromise(...)` calls and a host
  `finally` cleanup into one returned `Effect.runPromise(Effect.gen(...))`
  program.
- Cleanup locality: runtime disposal now runs through `Effect.ensuring(...)`,
  so the test's setup, Resource preload, diagnostics reads, assertions, and
  cleanup stay inside one Effect-owned workflow. The only Promise boundary left
  is the Vitest host runner.
- Review cleanup: this closes the small async test-boundary candidate from the
  fresh test seam scan.

Focused verification: `pnpm --filter @effect-ui/core typecheck`, `pnpm vitest
run packages/core/test/resource-store.test.ts` (1 file / 3 tests), `pnpm
audit:effect-first` over 224 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 224 files, 52 root test
files / 857 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 97: Devtools Public Type-Test Ownership

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Type tests: expanded `type-tests/devtools.test-d.ts` from a smoke import into
  the focused owner for pure Devtools public API assertions. It now covers the
  Devtools Store Interface, snapshot/summary/panel/causal graph Effects,
  panel contracts, bridge payloads, serialization policy, route/invalidation/
  request/runtime DTOs, mount/boot lifecycles, and negative union checks.
- Framework type tests: trimmed pure Devtools-only assertions out of
  `type-tests/framework.test-d.ts`. The broad integration file now keeps the
  compatibility assertions that actually cross package boundaries: Start
  request traces and app graph diagnostics, Start action invalidation plans,
  DB collection store events, Core Program events, Resource Store runtime
  events, and Start action tracking.
- Review cleanup: the deeper focused public type-test ownership candidate is
  closed. Fresh sweeps should look for new candidates rather than carrying this
  known Devtools type-test debt forward.

Focused verification: `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 224 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 224 files, 52 root test
files / 857 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 96: Devtools Public Contract Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Devtools: added `packages/devtools/src/devtools-contract.ts` as the public
  Devtools DTO and Interface Module. It owns JSON-safe snapshot values,
  invalidation/route/request/runtime event contracts, Store Interfaces, Start
  app graph diagnostics, summary and causal graph DTOs, panel DTOs, panel UI
  options, and panel boot contracts.
- Devtools facade: `packages/devtools/src/index.ts` now re-exports the public
  contract while keeping behavior facades such as `makeDevtoolsStore(...)`,
  summary/panel rendering helpers, bridge exports, and boot helpers local to the
  root import path.
- Internal locality: Devtools internals now import shared contracts from
  `./devtools-contract.js` instead of the root facade, avoiding root import
  cycles while preserving the public LSP hover surface.
- Review cleanup: the Devtools Public Contract Module candidate is closed.
  Fresh sweeps still leave deeper focused public type-test ownership as the
  next candidate.

Focused verification: `pnpm --filter @effect-ui/devtools typecheck`, `pnpm
vitest run packages/devtools/test/devtools.test.ts` (1 file / 70 tests),
`pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over
224 files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 224 files, 52 root test files / 857 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 95: Core Action Execution Workflow Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Core: added `packages/core/src/action-execution-workflow.ts` as the internal
  Action Execution Workflow Module. It owns `Action.use(...)` callback
  normalization, retry wrapping, optimistic transaction commit/rollback,
  stale-submission interruption, invalidation planning/execution, direct action
  run submission joining, and visible submission state updates.
- Action facade: `packages/core/src/action.ts` now keeps public definition
  overloads, sync invalidation planning facade, runtime binding, and typed
  runtime requirement subtraction, while delegating live instance workflow
  execution to the new Module.
- Review cleanup: the Core Action Execution Workflow candidate is closed.
  Fresh sweeps still leave Devtools Public Contract Module and deeper focused
  public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/core typecheck`, `pnpm vitest
run packages/core/test/action.test.ts` (1 file / 33 tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over 223
files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 223 files, 52 root test files / 857 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 94: Browser Router Host Controller Facade

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Core: added `BrowserRouterHostControllerOptions`,
  `BrowserRouterHostController`, and
  `createBrowserRouterHostController(...)` to the expert-public
  `browser-router` Module. The controller binds a Browser Router Kernel to a
  Browser History Adapter and owns idempotent start/dispose, initial
  navigation, external history listener wiring, programmatic commit forwarding,
  typed route navigation helpers, and preload disposal.
- React/Solid: both router adapters now consume the Core host controller.
  React exposes the controller's `ReadableSignal` shape directly, while Solid
  projects the same controller into Solid `Accessor`s and keeps Solid owner
  cleanup local.
- Review cleanup: the Browser Router Host Adapter Facade candidate is closed.
  Fresh sweeps still leave Core Action Execution Workflow, Devtools Public
  Contract Module, and deeper focused public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/core typecheck`, `pnpm
--filter @effect-ui/react typecheck`, `pnpm --filter @effect-ui/solid
typecheck`, `pnpm vitest run packages/core/test/browser-router.test.ts
packages/react/test/router.test.ts packages/solid/test/router.test.ts` (3
files / 43 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 222 files, and `git diff --check` passed. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API inventory audit, Effect-first audit over 222 files, 52 root test
files / 857 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console packaging/typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 93: Collection Change Feed Runtime Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- DB: added `packages/db/src/collection-change-feed-runtime.ts` as the
  internal Collection Change Feed Runtime Module. It owns scoped feed
  subscription lifecycle, dispatcher acquisition, consumer-fiber execution,
  adapter subscribe/unsubscribe normalization, default write-option selection,
  direct `emit(...)` completion, host-callback `emitChanges(...)` queueing, and
  asynchronous failure publication.
- Collection Runtime: `packages/db/src/collection-runtime.ts` now wires the
  active Runtime Collection Store into the new Module with store-local
  `applyChanges` and `publishFailure` Effects, while row mutation, persistence,
  and event publication policy remain in Collection Runtime.
- Review cleanup: the DB Collection Change Feed Runtime candidate is closed.
  Fresh sweeps still leave Browser Router Host Adapter Facade, Core Action
  Execution Workflow, Devtools Public Contract Module, and deeper focused
  public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm vitest run
packages/db/test/sync-adapter.test.ts packages/db/test/collection.test.ts
packages/db/test/live-query-collection.test.ts` (3 files / 144 tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over 222
files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 222 files, 52 root test files / 856 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 92: Start Action Response Application Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start: added `packages/start/src/start-action-response-application.ts` as the
  internal Start Action Response Application Module. It owns accepted action
  response metadata application: invalidation target validation, Resource Tag
  and Ref resolution, hydration payload application, hydrated-ref filtering,
  and malformed metadata mapping to `ServerTransportError`.
- Transport protocol: `packages/start/src/start-transport-protocol.ts` now
  keeps action request/response DTOs, parsing, status policy, encoding, and
  decoding while re-exporting the action response application helpers for
  compatibility.
- Action client: `packages/start/src/start-action-client.ts` now calls the
  application Module explicitly for direct submissions and stateful
  `StartAction.use(...)` submissions.
- Review cleanup: the Start Action Response Application candidate is closed.
  Fresh sweeps still leave Browser Router Host Adapter Facade, Core Action
  Execution Workflow, DB Collection Change Feed Runtime, Devtools Public
  Contract Module, and deeper focused public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm vitest
run packages/start/test/start.test.ts` (1 file / 130 tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over 221
files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 221 files, 52 root test files / 856 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 91: Start Diagnostics CLI Runner Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Start: added `packages/start/src/start-diagnostics-cli-runner.ts` as the
  internal Start Diagnostics CLI Runner Module. It owns diagnostics loading,
  graph and impact projection, JSON/text formatting, write effects, and
  diagnostics failure reporting for parsed CLI commands.
- CLI: `packages/start/src/cli.ts` now defines the `effect-ui-start` command
  tree with Effect v4 `Command`, `Flag`, and `Argument` primitives, preserving
  the public usage/help text and bin process wiring while delegating parsed
  diagnostics/graph/impact command execution to the runner.
- Review cleanup: the Start Diagnostics CLI Command Runner candidate is
  closed. Fresh sweeps still leave Browser Router Host Adapter Facade, Core
  Action Execution Workflow, DB Collection Change Feed Runtime, Devtools Public
  Contract Module, and deeper focused public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm vitest
run packages/start/test/start.test.ts` (1 file / 130 tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over 220
files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 220 files, 52 root test files / 856 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 90: Collection Index Materialization Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- DB: added `packages/db/src/collection-index-materialization.ts` as the
  Collection Index Materialization Module. It owns secondary-index
  normalization, lookup-key encoding, duplicate-value dedupe,
  runtime/request-local bucket caches, index row reads, indexed join keys, and
  the public `UnknownCollectionIndex` error.
- Collection State: now keeps only mutable collection state, version/load-state
  signals, row storage, pending mutations, optimistic stacks, snapshots, and
  rebasing. Secondary index cache entries are owned by the index
  materialization Module and stored on the state object.
- Runtime/query/live-query: collection runtime, query source adapters,
  collection registry diagnostics, live-query collection materialization, and
  the public DB root now import index policy from the new Module.
- Review cleanup: the DB Collection Secondary Index Materialization candidate
  is closed. Fresh sweeps still leave Browser Router Host Adapter Facade, Core
  Action Execution Workflow, DB Collection Change Feed Runtime, Start Action
  Response Application, Devtools Public Contract Module, and deeper focused
  public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm vitest run
packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
(2 files / 128 tests), `pnpm audit:public-api`, `pnpm audit:effect-first` over
219 files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 219 files, 52 root test files / 856 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 89: Collection Value Detachment Module

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- DB: added `packages/db/src/collection-value-detachment.ts` as the internal
  Collection Value Detachment Module. It owns deep collection value cloning,
  frozen value/transaction copies, mutation and transaction cloning, update
  draft detachment, value-change diffing, and public row DTO detachment.
- Collection State: now stays focused on mutable row maps, index caches,
  optimistic row stacks, pending mutation entries, rebasing, rollback, and
  version/load-state invalidation while delegating value copy policy to the
  detachment Module.
- Runtime/materialization/codec/ingress: collection runtime, mutation queue,
  snapshot codec, row ingress, and live-query materialization now consume the
  detachment Module directly for clone/freeze/DTO policy instead of importing
  those helpers from mutable Collection State.
- Review cleanup: the DB Collection Value Detachment candidate is closed. Fresh
  sweeps still leave Browser Router Host Adapter Facade, Core Action Execution
  Workflow, DB Collection Change Feed Runtime, Start Action Response
  Application, Start Diagnostics CLI Command Runner, Devtools Public Contract
  Module, and deeper focused public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm vitest run
packages/db/test/collection.test.ts packages/db/test/persistence.test.ts
packages/db/test/live-query-collection.test.ts
packages/db/test/sync-adapter.test.ts packages/db/test/sqlite-persistence.test.ts`
(4 files / 154 tests), `pnpm audit:effect-first` over 218 files, and `git diff
--check` passed. Full `pnpm verify` passed: 11 package builds, workspace
typecheck, public type tests, public API inventory audit, Effect-first audit
over 218 files, 52 root test files / 856 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 88: Public API Source Surface Coverage Gate

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- Audit: generalized `scripts/audit-public-api-inventory.mjs` so every package
  root barrel's local re-exported modules must be named in that package's
  Source Surface section. This extends the previous Core-only source-surface
  guard to Start, DB, Devtools, React, React DB, Solid, and Solid DB.
- Audit fix: replaced the non-JavaScript `\z` end-of-input regex escape in the
  inventory section parser with a real end-of-input sentinel, so package
  sections are not accidentally truncated at ordinary `z` characters.
- Docs: `docs/public-api-inventory.md` now names the root-local source modules
  for every package barrel that exports them, keeping LSP/hover-facing docs
  aligned with actual source modules.
- Review cleanup: the Public API Source Surface Coverage Gate candidate is
  closed. Fresh sweeps still leave Browser Router Host Adapter Facade, Core
  Action Execution Workflow, DB Collection Secondary Index Materialization, DB
  Collection Change Feed Runtime, Start Action Response Application, Start
  Diagnostics CLI Command Runner, Devtools Public Contract Module, and deeper
  focused public type-test ownership candidates.

Focused verification: `pnpm audit:public-api`, `pnpm audit:effect-first`, and
`git diff --check` passed. Full `pnpm verify` passed: 11 package builds,
workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 217 files, 52 root test files / 856 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 87: React Route Render Scope Controller

Status: fixed for this fresh post-Review86 sweep and fully verified in the
current worktree. Fresh sweeps still found actionable candidates, so the
Thirty-Sweep clean counter remains at 0.

- React: added `packages/react/src/route-render-scope.ts` as the internal React
  Route Render Scope Controller. It owns `RouterOutlet` branch rendering,
  route-owned `UiScope` creation, keyed route frame remounting, runtime
  provider re-entry, and runtime-bound route finalizers.
- Router: `RouterOutlet` now stays focused on reading the current router state,
  adapting typed outlet props, and delegating render lifetime policy to the
  controller. Public React router APIs and route render behavior remain
  unchanged.
- Review cleanup: the React Route Render Scope Controller candidate is closed.
  Fresh sweeps also found Browser Router Host Adapter Facade, Core Action
  Execution Workflow, DB Collection Secondary Index Materialization, DB
  Collection Value Detachment, DB Collection Change Feed Runtime, Start Action
  Response Application, Start Diagnostics CLI Command Runner, Devtools Public
  Contract Module, and deeper focused public type-test ownership candidates.

Focused verification: `pnpm --filter @effect-ui/react typecheck`, `pnpm vitest
run packages/react/test/router.test.ts` (1 file / 7 tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, `pnpm audit:effect-first` over 217
files, and `git diff --check` passed. Full `pnpm verify` passed: 11 package
builds, workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 217 files, 52 root test files / 856 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging/typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 86: Public API Type-Test Manifest

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger candidates may still emerge from future sweeps, so the
Thirty-Sweep clean counter remains at 0.

- Type tests: added `type-tests/public-api.manifest.json` plus focused
  entrypoint type-test files for every package export, including Start
  subpaths and platform adapter packages. The existing
  `type-tests/framework.test-d.ts` remains as cross-package integration
  coverage rather than the only failure domain.
- Audit: strengthened `scripts/audit-public-api-inventory.mjs` so every
  package `exports` entry and bin must appear in the manifest, every manifest
  entry must map back to a real workspace package export/bin, every
  import-shaped entry must have a focused type-test file, and each focused
  type-test file must import its claimed entrypoint.
- Docs: public API inventory now names the manifest as the owner of
  import-path type-test coverage.
- Review cleanup: the package-split public type-test manifest candidate is now
  closed. New architecture sweeps should look for fresh opportunities rather
  than re-opening the old Review 75 list by default.

Focused verification: `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 216 auditable files, and `git diff --check` passed.
Full `pnpm verify` passed: 11 package builds, workspace typecheck, public type
tests, public API inventory audit, Effect-first audit over 216 auditable files,
52 root test files / 856 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console packaging, project-console
typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 85: Solid Route Render Scope Controller

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger candidates remain open, so the Thirty-Sweep clean
counter remains at 0.

- Solid: added `packages/solid/src/route-render-scope.ts` as the internal Solid
  Route Render Scope Controller. It owns `RouterOutlet` branch rendering,
  route-owned `UiScope` creation, Solid root cleanup, runtime-bound route
  finalizers, transition disposal ordering, and stale queued-render suppression.
- Router: `RouterOutlet` now stays focused on reading the current router,
  adapting typed outlet props, and wiring Solid effects/cleanup to the
  controller. Public router APIs and route render semantics remain unchanged.
- Review cleanup: the older Solid Route Render Scope Controller candidate is
  now closed. The package-split public type-test manifest remained open after
  this review.

Focused verification: `pnpm --filter @effect-ui/solid typecheck`, `pnpm vitest
run packages/solid/test/router.test.ts` (1 file / 25 tests), `pnpm
audit:effect-first` over 199 auditable files, and `git diff --check` passed.
Full `pnpm verify` passed: 11 package builds, workspace typecheck, public type
tests, public API inventory audit, Effect-first audit over 199 auditable files,
52 root test files / 856 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console packaging, project-console
typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 84: Query Execution Plan Module

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger candidates remain open, so the Thirty-Sweep clean
counter remains at 0.

- DB: added `packages/db/src/query-execution-plan.ts` as the internal Query
  Execution Plan Module. It owns Query validation entrypoints, source adapter
  selection, source preload/refetch, snapshot execution, diagnostics, and
  remaining projection stages for filtering, ordering, windowing, and
  projection.
- Query/Live Query: `QueryBuilder` now stays focused on immutable DSL and
  aggregate helpers while delegating `execute(...)`, `projectContexts(...)`,
  `Query.onceEffect(...)`, and `Query.diagnostics(...)` to the plan Module.
  Live Query State uses the same source-adapter and preload policy, and Live
  Query Runtime keeps IVM graph mechanics while delegating final projection
  stages back to the plan.
- Tests: added grouped query parity coverage proving
  `Query.build(...).execute()`, `Query.onceEffect(...)`, and
  `Query.live(...).evaluate()` use the same execution plan stages for source
  filters, grouping, post-group filters, projection, ordering, and windows.
- Review cleanup: the older Query Execution Plan Module candidate is now
  closed. Solid Route Render Scope Controller and package-split public
  type-test manifest work remained open after this review. Solid
  `RuntimeProvider` runtime ownership semantics and deeper Effect-first Audit
  Scanner Module are closed for now because their deletion tests did not
  justify new Modules.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm vitest run
packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
(2 files / 128 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 198 auditable files, and `git diff --check` passed.
Full `pnpm verify` passed: 11 package builds, workspace typecheck, public type
tests, public API inventory audit, Effect-first audit over 198 auditable files,
52 root test files / 856 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console packaging, project-console
typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 83: Start Node Web Exchange Module

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger candidates remain open, so the Thirty-Sweep clean
counter remains at 0.

- Start: added `packages/start/src/node-web-exchange.ts` as the internal Start
  Node Web Exchange Module. It owns forwarded origin policy, Node header/body
  conversion, Node response status/header writing, multiple `Set-Cookie`
  preservation, Web stream piping, `HEAD` response body cancellation, and typed
  `StartNodeAdapterError` exchange failures.
- Node/Vite: `node-adapter.ts` now stays focused on Start handler invocation,
  Node `createServer` callback wiring, typed runtime requirements, and
  Node-only error hooks while re-exporting the expert-public exchange helpers
  for compatibility. `start-vite-dev-ssr.ts` and `start-manifest-wall.ts`
  consume the internal exchange Module directly, so dev SSR and production Node
  hosts share request/response mechanics.
- Review cleanup: the older Node Web Exchange Module candidate is now closed.
  The Start Client Transport Runtime Module candidate is also closed for now:
  the deletion test shows the existing Start Client Transport Module is already
  deep, while RPC/action runtime provision belongs to their public client
  Modules unless a third transport client or shared lifecycle policy appears.
  Solid `RuntimeProvider` runtime ownership semantics, Route Render Scope
  Controller, Query Execution Plan Module, deeper Effect-first Audit Scanner
  Module, and package-split public type-test manifest work remain open
  candidates.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/start-node typecheck`, `pnpm vitest run
packages/start/test/adapters.test.ts packages/start/test/start.test.ts` (2
files / 148 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, and `pnpm
audit:effect-first` over 197 auditable files passed. Full `pnpm verify` passed:
11 package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 197 auditable files, 52 root test files / 855
tests, devtools-panel verify with 2 tests, devtools-extension verify with 20
tests, basic starter verify with 2 tests, React starter verify with 3 tests,
project-console packaging, project-console typecheck/tests/build with 4 files /
27 tests, and leak scans.

## Review 82: Start Host Runtime Runner Module

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger Review 75 candidates remain open, so the Thirty-Sweep
clean counter remains at 0.

- Start: added `packages/start/src/start-host-runtime-runner.ts` as the
  internal Start Host Runtime Runner. It owns explicit/default runtime
  selection, Promise-shaped host facade execution, callback-shaped host facade
  forking, and response Scope lifetime wrapping for the host-required seams.
- Fetch/Node/Vite: fetch Promise handlers, Node `createServer` callbacks, Vite
  diagnostics Promise hooks, and Vite dev middleware callbacks now delegate
  final runtime launch policy to the runner. Fetch and Node adapters keep their
  serviceful-handler type enforcement and request/response translation local.
- Audit/API: the Effect-first scanner now names the runner as the approved host
  seam for `Effect.runPromise(...)` and Promise return types. Public host
  adapter facades stay unchanged, and `StartForkRuntime` remains re-exported
  from the Node adapter for callback hosts.
- Review cleanup: the older Start Host Facade Runtime Runner candidate is now
  closed. Solid `RuntimeProvider` runtime ownership semantics, Route Render
  Scope Controller, Query Execution Plan Module, Node Web Exchange Module,
  Start Client Transport Runtime Module, deeper Effect-first Audit Scanner
  Module, and package-split public type-test manifest work remain open
  candidates.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm
--filter @effect-ui/start-fetch typecheck`, `pnpm --filter
@effect-ui/start-node typecheck`, `pnpm vitest run
packages/start/test/adapters.test.ts packages/start/test/start.test.ts` (2
files / 148 tests), `pnpm vitest run packages/start/test/streaming.test.ts` (1
file / 11 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 196 auditable files, and `git diff --check` passed.
Full `pnpm verify` passed: 11 package builds, workspace typecheck, public type
tests, public API inventory audit, Effect-first audit over 196 auditable files,
52 root test files / 855 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console packaging, project-console
typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 81: Resource UI Binding Controller

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger Review 75 candidates remain open, so the Thirty-Sweep
clean counter remains at 0.

- Core: added `packages/core/src/resource-ui-binding.ts` as the
  adapter-neutral Resource UI Binding Controller. It owns Resource ref identity,
  runtime-bound refresh/prefetch Effects, automatic preload fibers, keyed
  preload failures, observer failure swallowing, stale preload interruption,
  state matching helpers, and Suspense preload-token dedupe.
- React/Solid: resource hooks now consume the Core controller for shared
  Resource UI policy while keeping host reactivity and host Suspense thenable
  throwing local to each adapter. Public `useResource(...)`,
  `useResourceResult(...)`, `useResourceValue(...)`, `useResourceError(...)`,
  and `useResourceSuspense(...)` behavior stays unchanged.
- Tests/API: added `packages/core/test/resource-ui-binding.test.ts` for the
  controller contract. `resource-ui-binding` is classified as an expert-public
  Core Module for framework adapters and diagnostics; golden-path apps should
  keep using framework resource hooks or the `Resource` facade.
- Review cleanup: the older Resource UI Binding Controller candidate is now
  closed. Solid `RuntimeProvider` runtime ownership semantics, Route Render
  Scope Controller, Query Execution Plan Module, Start Host Facade Runtime
  Runner Module, Node Web Exchange Module, Start Client Transport Runtime
  Module, deeper Effect-first Audit Scanner Module, and package-split public
  type-test manifest work remained open at the time of Review 81.

Focused verification: `pnpm --filter @effect-ui/core typecheck`, `pnpm
--filter @effect-ui/react typecheck`, `pnpm --filter @effect-ui/solid
typecheck`, `pnpm vitest run packages/core/test/resource-ui-binding.test.ts
packages/react/test/hooks.test.ts packages/solid/test/hooks.test.ts` (3 files /
31 tests), `pnpm typecheck:types`, `pnpm audit:public-api`, `pnpm
audit:effect-first` over 195 auditable files, and `git diff --check` passed.
Full `pnpm verify` passed: 11 package builds, workspace typecheck, public type
tests, public API inventory audit, Effect-first audit over 195 auditable files,
52 root test files / 853 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console starter packaging,
project-console typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 80: Request Runtime Lifecycle Module

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger Review 75 candidates remain open, so the Thirty-Sweep
clean counter remains at 0.

- Start: extracted `packages/start/src/request-runtime-lifecycle.ts` for the
  Request Runtime completion policy. The Module owns response Effect exit
  handling, failure/interruption teardown, ResponseContext application, request
  trace emission, Request Runtime disposal, and streamed response finalization.
- Start Request Handler: `start-request-handler.ts` now stays focused on
  transport endpoint selection, SSR preload/render selection, hydration plan
  creation, and request trace fact mutation before handing the selected
  response Effect to the lifecycle Module.
- Review cleanup: the older Start Response Lifetime candidate is no longer a
  separate open item. Generic response Scope lifetime remains in
  `response-lifetime.ts`; Request Runtime response completion remains in
  `request-runtime-response.ts`; Review 80 adds the missing lifecycle wrapper
  around selected Start handler responses.
- Docs/API: `CONTEXT.md` now names Request Runtime Lifecycle Module, and the
  public API inventory records that `createRequestHandler*` facades remain
  unchanged while lifecycle completion stays internal.

Focused verification: `pnpm --filter @effect-ui/start typecheck`, `pnpm vitest
run packages/start/test/start.test.ts packages/start/test/adapters.test.ts
packages/start/test/streaming.test.ts` (3 files / 158 tests), and `pnpm
audit:effect-first` over 194 auditable files passed. Full `pnpm verify` passed:
11 package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 194 auditable files, 51 root test files / 850
tests, devtools-panel verify with 2 tests, devtools-extension verify with 20
tests, basic starter verify with 2 tests, React starter verify with 3 tests,
project-console starter packaging, project-console typecheck/tests/build with 4
files / 27 tests, and leak scans.

## Review 79: Collection Query Source Adapter

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger Review 75 candidates remain open, so the Thirty-Sweep
clean counter remains at 0.

- DB: extracted `packages/db/src/query-source-adapter.ts` for query-readable
  collection source access. The Adapter owns row reads, row counts, declared
  index checks, indexed row probes, indexed-join key extraction, version/state
  signals, and preload/refetch Effect selection.
- Query locality: `query-builder.ts` no longer imports Collection Runtime only
  to compute indexed join keys. Query Plan, Live Query State, and Live Query
  Runtime consume source rows, indexes, state, versions, and preload/refetch
  through the Adapter Interface instead of each knowing the Collection
  Definition method set directly.
- Docs/API: `CONTEXT.md` now names Collection Query Source Adapter, and the
  public API inventory records that `Query.*` and `Collection.liveQuery(...)`
  keep the same facades while source adaptation remains internal.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm vitest run
packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
(2 files / 127 tests), and `pnpm audit:effect-first` over 193 auditable files
passed. Full `pnpm verify` passed: 11 package builds, workspace typecheck,
public type tests, public API inventory audit, Effect-first audit over 193
auditable files, 51 root test files / 850 tests, devtools-panel verify with 2
tests, devtools-extension verify with 20 tests, basic starter verify with 2
tests, React starter verify with 3 tests, project-console starter packaging,
project-console typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 78: Live Query Collection Materialization Module

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger Review 75 candidates remain open, so the Thirty-Sweep
clean counter remains at 0.

- DB: extracted `packages/db/src/live-query-collection-materialization.ts` for
  Live Query Collection projection locality. The Module owns per-Runtime
  Collection Store materialized entries, keyed lookups, revision and
  `Ready.updatedAt` policy, secondary-index buckets, state/version signals, and
  snapshot construction.
- Live Query Collection: `live-query-collection.ts` now stays focused on the
  read-only Collection Definition adapter: query input normalization,
  read-only mutation/hydration failures, preload/refetch registration,
  persistence handoff, snapshot marker installation, and collection registry
  registration.
- Docs/API: `CONTEXT.md` names the implemented private Module, and the public
  API inventory records that `Collection.liveQuery(...)` keeps the same facade
  while materialization remains internal.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm vitest run
packages/db/test/live-query-collection.test.ts packages/db/test/collection.test.ts
packages/db/test/sync-adapter.test.ts
packages/db/test/persisted-options.test.ts` (4 files / 145 tests), and `pnpm
audit:effect-first` over 191 auditable files passed. Full `pnpm verify` passed:
11 package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 191 auditable files, 51 root test files / 847
tests, devtools-panel verify with 2 tests, devtools-extension verify with 20
tests, basic starter verify with 2 tests, React starter verify with 3 tests,
project-console starter packaging, project-console typecheck/tests/build with 4
files / 27 tests, and leak scans.

## Review 77: Collection Write Commit Module

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. Larger Review 75 candidates remain open, so the Thirty-Sweep
clean counter remains at 0.

- DB: extracted `packages/db/src/collection-write-commit.ts` for direct-write
  atomicity. The Module owns Collection Store snapshot capture, restore on
  persistence failure, and the successful `CollectionWritten` event after
  persistence.
- Collection Runtime: direct write insert/update/delete and change-batch paths
  now keep validation, row ingress, key checks, and row-change application local,
  then hand the common commit sequence to Collection Write Commit. Mutation
  handler execution and pending mutation attempt coordination stay in
  `collection-runtime.ts` for a later, larger extraction.
- Docs/API: `CONTEXT.md` now names Collection Write Commit, and the public API
  inventory documents that the new Module is internal and preserves
  `Collection.write*Effect(...)` plus `Collection.applyChangesEffect(...)`
  facade behavior.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm vitest run
packages/db/test/collection.test.ts packages/db/test/persisted-options.test.ts
packages/db/test/sync-adapter.test.ts
packages/db/test/live-query-collection.test.ts
packages/db/test/sqlite-persistence.test.ts` (5 files / 155 tests), `pnpm
audit:effect-first` over 190 auditable files, and `git diff --check` passed.
Full `pnpm verify` passed: 11 package builds, workspace typecheck, public type
tests, public API inventory audit, Effect-first audit over 190 auditable files,
51 root test files / 847 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console starter packaging,
project-console typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 76: Runtime Collection Store Module Extraction

Status: fixed for this bounded Review 75 follow-up and fully verified in the
current worktree. The larger Review 75 candidates remain open, so the
Thirty-Sweep clean counter remains at 0.

- DB: extracted `RuntimeCollectionStore`, Resource Store module-registry
  lookup, store Effect/sync accessors, synchronous
  `runWithCollectionStore(...)` override locality, event subscriptions,
  diagnostics snapshots, and initial-data state materialization into
  `packages/db/src/runtime-collection-store.ts`. `collection-runtime.ts` now
  consumes that Module instead of owning store construction directly.
- Query/live-query locality: `query-builder.ts`, `live-query-state.ts`, and
  `live-query-collection.ts` import runtime store helpers from the new Module,
  while `collection-runtime.ts` keeps projection callback normalization,
  mutation execution, direct writes, persistence handoff, change-feed
  application, and event publication.
- Docs/API: `CONTEXT.md` now names the Runtime Collection Store separately from
  the higher-level Collection Runtime, and the public API inventory clarifies
  that public access remains `Collection.storeEffect()`,
  `Collection.currentStore()`, and `Collection.subscribeEventsEffect()` rather
  than the concrete store class.

Focused verification: `pnpm --filter @effect-ui/db typecheck`, `pnpm --filter
@effect-ui/react-db typecheck`, `pnpm --filter @effect-ui/solid-db typecheck`,
`pnpm vitest run packages/db/test/collection.test.ts
packages/db/test/live-query-collection.test.ts
packages/db/test/sync-adapter.test.ts` (3 files / 142 tests), `pnpm
typecheck:types`, `pnpm audit:public-api`, and `pnpm audit:effect-first` over
189 auditable files passed. Full `pnpm verify` passed: 11 package builds,
workspace typecheck, public type tests, public API inventory audit,
Effect-first audit over 189 auditable files, 51 root test files / 847 tests,
devtools-panel verify with 2 tests, devtools-extension verify with 20 tests,
basic starter verify with 2 tests, React starter verify with 3 tests,
project-console starter packaging, project-console typecheck/tests/build with 4
files / 27 tests, and leak scans.

## Review 75: History Adapters, Runtime UI Scopes, Transport Envelopes, And Inventory Gates

Status: fixed for the bounded Review 75 findings and fully verified in the
current worktree. Review 75 still found larger Module and Adapter work, so the
Thirty-Sweep clean counter remains at 0.

- Core/React/Solid: Browser history is now a Core Browser History Adapter seam
  with window and memory implementations. React and Solid routers consume the
  same `currentHref`, external-history listener, same-href retry, and
  push/replace commit policy while keeping their host render lifecycle separate.
  Core also exposes `makeRuntimeUiScope(...)`; the Browser Router Kernel, React
  component/route scopes, and Solid component/route scopes use it so late
  finalizers run through the owning Runtime Spine instead of hand-rolling the
  same runner policy in each Adapter.
- Start: RPC/action endpoint handling now constructs a Start Transport Endpoint
  Envelope for request diagnostics. When a request arrives without an incoming
  request id, response diagnostics and request traces consume the same generated
  id instead of generating independently.
- Docs/API/audit: `browser-router` is classified in the public API inventory,
  and `scripts/audit-public-api-inventory.mjs` now checks package export-map
  rows plus Core root star-export classification. Public type tests pin the
  Browser History Adapter, runtime-bound `UiScope` factory, and Start Transport
  Endpoint Envelope. LSP-facing JSDoc now uses Runtime Spine, Erased Runtime
  Runner, Resource Store, and host seam vocabulary in the touched public runtime
  and adapter surfaces.
- Open Review 75 candidates: Solid `RuntimeProvider` runtime ownership
  semantics, Route Render Scope Controller, Query Execution Plan Module, Start
  Host Facade Runtime Runner Module, Node Web Exchange Module, Start Client
  Transport Runtime Module, deeper Effect-first Audit Scanner Module, and
  package-split public type-test manifest work.

Verification: focused regressions passed across Core scope/browser router,
React router, Solid router, Start RPC/request handling, touched package
typechecks, public type tests, the new public API inventory audit, and the
Effect-first audit over 188 auditable files. Full `pnpm verify` passed: 11
package builds, workspace typecheck, public type tests, public API inventory
audit, Effect-first audit over 188 auditable files, 51 root test files / 847
tests, devtools-panel verify with 2 tests, devtools-extension verify with 20
tests, basic starter verify with 2 tests, React starter verify with 3 tests,
project-console starter packaging, project-console typecheck/tests/build with 4
files / 27 tests, and leak scans.

## Review 74: Read Decisions, Hydration Plans, Finalization Events, And Panel Locality

Status: fixed for the bounded Review 74 findings and fully verified in the
current worktree. Review 74 still found larger Module and Adapter work, so the
Thirty-Sweep clean counter remains at 0.

- Core: `Resource.read(...)` and `Resource.readEffect(...)` now share one
  Resource Read Decision policy for missing, initial, pending-with-previous,
  failure, collected reset, stale refresh, and value outcomes. The sync and
  Effect Interfaces only adapt delivery instead of duplicating the decision
  tree.
- DB/React DB/Solid DB: collection hydration validation and application now
  share a Collection Hydration Plan that resolves definitions and runs
  definition/store preflight once. React DB and Solid DB share DB-owned live
  query dependency equality, dependency snapshotting, prebuilt Live Query reuse,
  and runtime-bound `Query.live(...)` selection policy.
- Start/starters: Request Runtime response completion now emits one
  finalization state shape for buffered and streamed responses, so request trace
  emission has one mapping path. `createStartStreamedHtmlResponseEffect(...)`
  owns the starter policy of appending `StartRenderHydrationPlan` streamed
  chunks before the tail, and the basic, React, and project-console starters use
  that helper.
- Devtools/docs/API: obsolete app-graph copy helpers were removed from the
  generic Serialization Policy; app-graph detachment stays in the App Graph
  Normalizer Module. Panel overflow row identity is now exposed by the Panel
  Contract Module and consumed by the renderer instead of duplicating the
  private id prefix. Public type tests pin the new Start streamed response
  helper and Devtools overflow guard.
- Open Review 74 candidates: Browser History Adapter Module, Solid
  RuntimeProvider runtime ownership semantics, Collection Write Commit Module,
  Query Execution Plan Module, Start Transport Endpoint Envelope Module, Start
  Host Facade Runtime Runner Module, Public Interface Inventory Audit Module,
  and Effect-first Audit Scanner Module. These are larger seams or require more
  careful adapter design than the bounded fixes in this pass.

Verification: focused regressions passed across Core Resource, DB collection
and live-query, React DB, Solid DB, Devtools, Start request/streaming, basic
starter, and React starter: 8 package test files / 413 tests plus starter
verifies. Full `pnpm verify` passed: 11 package builds, workspace typecheck,
public type tests, Effect-first audit over 187 auditable files, 51 root test
files / 843 tests, devtools-panel verify with 2 tests, devtools-extension
verify with 20 tests, basic starter verify with 2 tests, React starter verify
with 3 tests, project-console starter packaging, project-console
typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 73: Runtime Locality, Shared Adapter Policies, File-Route Seams, And Devtools Boot

Status: fixed for the local Review 73 findings and fully verified in the
current worktree. Review 73 still found larger design work, so the
Thirty-Sweep clean counter remains at 0.

- Core/React/Solid: `UiScope` late finalizers now run through the configured
  owner runtime instead of the ambient/default runner, and framework/router
  scopes bind that runner to their Runtime Spine. Core owns shared RouterLink
  plain-click detection, outside-router detection, and hover preload
  interruption policy for React and Solid. React `RuntimeProvider` recreates
  provider-owned runtimes when the source identity changes, and React Suspense
  coverage now proves cleanup and stale-ref preload detachment.
- DB/React DB/Solid DB: Collection Stores expose runtime-local diagnostics
  snapshots without publishing private row maps. DB public type tests reject
  Promise-shaped sync adapter, query-sync, change-feed, persistence, and SQLite
  adapter callbacks. React DB and Solid DB share collection/live-query reactive
  binding and preload controller policy from the DB package. Live Query
  Collection index lookup now caches derived-row buckets per projection
  revision.
- Start/Devtools/audit: custom Start fetchers and file-route preload helpers
  reject Promise-shaped erased JavaScript returns with typed failures and repair
  guidance. File-route resource selector throws are captured as typed preload
  failures. The Effect-first audit now catches template interpolation bodies,
  multiline Promise return types, and direct `await` seams. Devtools runtime
  events are pinned in public type tests, store concepts have focused JSDoc, and
  panel/extension boot lifecycle work now flows through the shared
  `bootDevtoolsPanels(...)` helper.
- Open design decisions: hydration sync facades still intentionally fall back to
  the current/default runtime when no explicit runtime is supplied; tightening
  that would be breaking. Start request handler, preload, RPC, and action
  lifecycle still need a larger Request Runtime lifecycle Module extraction.
  React route transition disposal cannot exactly match Solid's owner disposal
  ordering without a deeper adapter design change because React function
  components render before cleanup hooks run.

Verification: focused regressions passed across Core browser-router/scope,
React hooks, DB collection/live-query, React DB, Solid DB, Start RPC and
file-route preload cases, Devtools package build, devtools panel verify,
devtools extension verify, package typechecks, public type tests, and
`pnpm audit:effect-first`. Full `pnpm verify` passed: 11 package builds,
workspace typecheck, public type tests, Effect-first audit over 187 auditable
files, 51 root test files / 843 tests, devtools-panel verify with 2 tests,
devtools-extension verify with 20 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console starter packaging,
project-console typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 72: Adapter Lifetimes, Mutation Finalization, Start Manifests, And Audit Depth

Status: fixed and fully verified in the current worktree.

- React/Solid adapters: React component and route `UiScope` Modules are keyed
  to their owning Runtime Spine, so a runtime replacement cannot dispose a
  scope that the Implementation keeps reusing. React `useProgram(...)` now
  replaces and disposes Program instances when the Program Definition, Runtime
  Spine, or owning scope changes. Solid `useAction(...)` now registers owner
  cleanup that resets active submissions, matching the React Action Adapter
  lifetime policy.
- DB/React DB/Solid DB: Collection Mutation Queue active attempts now complete
  joiners on every exit path, including post-commit or rollback persistence
  failures. Live Query Collection materialization keeps the last-good
  projection when later row ingress/keying fails while exposing the failure
  state. React DB and Solid DB preload failures are generation-keyed, and direct
  change-feed `emit` now flows through the same dispatcher late-drop policy as
  host-callback `emitChanges`.
- Start/starters: Resource Store diagnostics gained a stable snapshot/count
  Interface so Start request traces no longer import mutable Resource Store
  internals. Basic and React starters rely on file-route discovery instead of
  hand-maintained route arrays, while project-console checks its explicit route
  list against discovery. The Manifest Wall no longer infers implementation
  `exportName` values from wire names for direct server functions/actions.
- Devtools/docs/audit: the extension panel polling policy moved into the panel
  runtime so boot performs one immediate inspected-window read and waits before
  the first periodic refresh. Devtools app-graph normalizers are documented and
  pinned as expert-public compatibility helpers. The Effect-first audit now
  enforces async-function and non-Effect `.catch(...)` policy directly instead
  of relying on docs grep follow-ups.

Verification: focused regressions passed across React/Solid hooks and React
router, DB collection/live-query/sync adapter suites, React DB, Solid DB, Core
Resource Store diagnostics, Start request/manifest flows, basic starter, React
starter, project-console, devtools extension/panel entrypoints, workspace
typecheck, public type tests, and `pnpm audit:effect-first`. The integrated
focused regression run passed 16 files / 361 tests. Full `pnpm verify` passed:
11 package builds, workspace typecheck, public type tests, Effect-first audit
over 186 auditable files, 51 root test files / 834 tests, devtools-panel verify
with 2 panel tests, devtools-extension verify with 20 tests, basic starter verify
with 2 tests, React starter verify with 3 tests, project-console starter
packaging, project-console typecheck/tests/build with 4 files / 27 tests, and
leak scans.

## Review 71: Router Kernel, Static Graphs, Public Stores, And Reactive Lifetimes

Status: fixed and fully verified in the current worktree.

- Core/React/Solid: browser route matching, href/path helpers, navigation,
  preload lifecycle, failure normalization, and public preload Effects now live
  in an adapter-neutral browser-router kernel. React and Solid keep only their
  host subscription/render wiring. React `useAction(...)` now keeps a stable
  runtime-bound Action instance across rerenders and resets active submissions
  on unmount. React and Solid Resource handles key automatic preload failures to
  the currently observed ref, so stale preloads cannot poison a later ref's UI
  state.
- Core Resource Store: the public `ResourceStore` Interface exposes only
  `eventBus`, `moduleRegistry`, `fiberRegistry`, and `diagnostics`. Internal
  entry/input/cache/tag-index/fiber collections moved behind
  `MutableResourceStore`, `makeMutableResourceStore(...)`, and
  `unsafeMutableResourceStore(...)`, preserving adapter Leverage without
  publishing implementation maps as public API.
- Start/starters: `virtual:effect-ui/app-graph` is now a pure static DTO module
  with no route implementation imports or runtime guard side effects. Runtime
  route-module diagnostics moved to the explicit
  `virtual:effect-ui/app-graph/runtime-diagnostics` module. Non-streaming
  renderers use the named `legacyHydrationScript` Interface, while streamed
  renderers keep using `hydrationRootScript` plus streamed chunks.
- DB/React DB/Solid DB: React DB and Solid DB stabilize source arrays by
  collection identity, Solid live-query `deps` follow React-style shallow-array
  semantics, and query-sync invalidation now names rollback semantics
  explicitly as `mutationInvalidation: "rollback-on-failure"` instead of
  overloading "strict" with remote rollback meaning.
- Devtools/docs/audit: devtools panel contract resolver exports are pinned in
  public type tests and inventory docs, panel/extension entrypoints prove
  interruption cleanup, and the Effect-first audit detects spaced
  `Promise <T>` plus approved/blocked `PromiseLike<T>` return seams.

Verification: focused regressions passed across React/Solid hooks,
React/Solid/Core routers, Start app graph/file-route/streaming flows, DB query
sync, React DB and Solid DB live queries, Devtools panel/extension entrypoints,
public type tests, package typechecks, and `pnpm audit:effect-first` over 186
auditable files. The focused multi-package regression run passed 14 files / 266
tests. Full `pnpm verify` passed: 11 package builds, workspace typecheck,
public type tests, Effect-first audit over 186 auditable files, 51 root test
files / 816 tests, devtools-panel verify with 2 panel tests,
devtools-extension verify with 19 tests, basic starter verify with 2 tests,
React starter verify with 3 tests, project-console starter packaging,
project-console typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 70: Route Render Scope, Hydration Laziness, Reactive Sources, And Audit Depth

Status: fixed and fully verified in the current worktree.

- React/Solid adapters: React `RouterOutlet` now renders pending, failure,
  not-found, and ready route branches inside the router Runtime Spine and a
  route-owned `UiScope`, matching the ownership rule already proven in the
  Solid adapter. Solid and React Resource handles now expose automatic preload
  failures through `preloadFailure` and optional `onPreloadFailure(...)`
  callbacks, so mount-time preload failures and Runtime Spine startup/provision
  failures no longer disappear into fire-and-forget fibers.
- Start/starters: streamed renderers no longer pay for or fail on unused full
  legacy hydration serialization. `StartRenderHydrationPlan` exposes the lazy
  legacy script separately from the eager root-only streamed script, and the
  basic and React starters consume `hydrationRootScript` plus streamed resource
  chunks instead of rebuilding root hydration manually.
- DB/React DB: React live queries now rebuild and resubscribe when React-style
  dependency arrays change, including dynamic source subscriptions and automatic
  preload restart. Query sync mutation invalidation has an explicit
  `mutationInvalidation` policy: default best-effort preserves committed
  mutations when cache invalidation fails, while rollback-on-failure mode treats
  invalidation failure as part of the mutation rollback boundary.
- Devtools/audit: the Effect-first audit now has explicit auditable roots for
  package sources, example runtime sources, workspace scripts, and public type
  tests, and prints the scope plus host-boundary allowances. Devtools extension
  docs point extension authors at
  `resolveEffectUiDevtoolsBridgePayload(...)` when diagnostics matter, and the
  checked panel/extension examples smoke-test their real entrypoints.

Verification: focused regressions passed across React hooks/router, Solid
hooks, Start hydration/starter flows, DB sync adapter, React DB live query,
Devtools panel/extension entrypoints, public type tests, and React/Solid package
typechecks. Full `pnpm verify` passed: 11 package builds, workspace typecheck,
public type tests, Effect-first audit over 185 auditable files, 50 root test
files / 804 tests, devtools-panel verify with 2 panel tests,
devtools-extension verify with 19 tests, basic starter verify with 2 tests,
React starter verify with 2 tests, project-console starter packaging,
project-console typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 69: Adapter Boundaries, Typed Runtime Errors, And Public Seams

Status: fixed and fully verified in the current worktree.

- Core/React/Solid: `Program.RuntimeError<E, ER = never>` now carries both
  Program-domain failures and Runtime Spine startup/provision failures. Solid
  and React `useProgram(...)` expose that `ER` channel through
  `dispatchEffect(...)` instead of erasing runtime errors to the update error
  slot. The Resource Store now exposes explicit `eventBus`, `moduleRegistry`,
  `fiberRegistry`, and `diagnostics` seams, leaving raw `entries`, `inputs`, and
  `caches` as internal state. React route preload now matches against the
  ordered router route set, so shadowed hrefs preload the same route navigation
  renders.
- Start/React starter: streamed renderers now receive `hydrationRootScript`,
  the root-only script derived from the render hydration plan, while
  `hydrationScript` remains documented as the full non-streaming payload.
  Runtime app graph route candidates enrich matching manifest route diagnostics
  instead of replacing static manifest routes. Vite dev SSR waits for successful
  HTML transform before finalizing a stream trace as successful, so transform
  failures remain failure traces. The workspace Vitest config now respects the
  React starter's React JSX transform and `@` source alias, and the root verify
  gate includes the React starter package verify.
- DB: Live Query Collections are explicitly read-only at the Collection
  Contract seam. `Collection.applyChangesEffect(...)` rejects read-only live
  query definitions with `ReadonlyCollectionMutation` before mutating rows,
  publishing write events, or persisting snapshots. Live Query Collection
  persistence reuses the shared snapshot persistence helper and emits the same
  `CollectionPersisted` event path as normal collections.
- Devtools: the browser-extension inspected-window transport has a bounded
  timeout instead of hanging forever when `chrome.devtools.inspectedWindow.eval`
  never calls back. Invalid live bridge payloads now render typed diagnostics
  rather than silently falling back to sample data. App graph legacy
  normalization now flows through the shared normalizer used by summaries,
  serialization, panels, and causal graph projection.

Verification: focused regressions passed across React router, Core
Program/Resource Store, Start app graph/render/streaming, DB live-query
collections, Devtools panel contracts, devtools-extension transport, public
type tests, package typechecks, Effect-first audit, React starter package verify,
and the root test suite with 50 files / 791 tests. Full `pnpm verify` passed:
11 package builds, workspace typecheck, public type tests, Effect-first audit,
50 root test files / 791 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 18 tests, basic starter verify with 2 tests,
React starter verify with 2 tests, project-console starter packaging,
project-console typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 68: Preload Resolution, Runtime Coordination, And Graph Depth

Status: fixed and fully verified in the current worktree.

- Core/Solid: `Resource.readEffect(...)` now participates in touched-ref
  collection, so Effect route preload plans dehydrate refs read from an
  already-loaded Resource Store. `ActionResult` redirect headers and validation
  error containers copy/freeze caller-owned metadata at construction. Solid
  route preloads build the target href and match against the router's ordered
  route set, so shadowed static routes such as `/projects/settings` agree with
  navigation instead of a single route definition.
- Start: request preload and hydration now share a Start Collection Resolution
  Module. Hydration resolves collection snapshots through direct definitions,
  explicit resolvers, or explicit registries and fails unresolved payload names
  as typed `CollectionSnapshotCodecError` values before Resource hydration
  mutates state. File-route preload helpers can declare collections by stable
  name while concrete collection definitions still preload directly.
- DB/Solid DB: mutation flush now joins active attempts instead of replaying an
  in-flight transaction handler. Collection load/refetch coordination is
  store-owned, so concurrent preloads join one load and forced refetches cannot
  be stale-overwritten by slower earlier loads. Live Query Collection
  materialization now routes derived rows through the shared row-ingress key
  policy, preserving finite-key validation and typed projection failures.
- Devtools/React/effect-first: route preload ResourceFamily causal nodes now
  use full app graph depth before first-write-wins can retain shallow facts.
  Runtime-only `RequestTrace` events canonicalize into request trace facts so
  panels, resource sources, and causal Records edges agree with
  `recordRequestTrace(...)`. Panel rendering preserves overflow rows after item
  limiting. React Suspense no longer exposes a Promise-shaped public type; its
  required host conversion is counted by the Effect-first audit like the Solid
  Suspense Adapter.

Verification: focused regressions passed across Core/Solid, Start, DB/Solid
DB, Devtools, React, and public type tests. Full `pnpm verify` passed: 10
package builds, workspace typecheck, public type tests, Effect-first audit, 47
root test files / 765 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 17 tests, basic starter verify with 2 tests,
project-console starter packaging, project-console typecheck/tests/build with
4 files / 27 tests, and leak scans.

## Review 67: Snapshot Encoding, Client Transport, Materialization, And Devtools Scale

Status: fixed and fully verified in the current worktree.

- Core/Solid: Resource hydration snapshots now schema-encode Resource inputs and
  successful values before they cross the snapshot or payload seam. Effect code
  has `Resource.readEffect(...)` for already-loaded values and
  `Resource.statusEffect(...)` remains the Effect-first status Interface, while
  synchronous `Resource.read(...)`/`status(...)` stay render/host Adapter seams.
  Resource invalidation plans and `ActionResult` invalidation metadata now copy
  and freeze retained arrays, so later caller mutation cannot rewrite stored
  facts. The shared stable identity Module now distinguishes Date, URL, Map,
  Set, binary data, undefined, sparse array holes, marker-shaped objects, and
  unsupported values through typed errors.
- Start/project-console: App Graph Diagnostics DTO validation now lives behind
  one shared Effect-first Interface used by Vite and CLI adapters. Request
  handler and host Adapter error normalization share one
  `StartRequestHandlerError` constructor path. RPC and action clients now share
  a private Start client transport Module for request serialization, fetch
  invocation, status validation, and transport error mapping, while each client
  keeps its protocol-specific encode/decode logic.
- DB/Solid DB: Live Query Collections materialize through one keyed projection
  used by rows, lookups, indexes, snapshots, state, version, and `updatedAt`, so
  hidden duplicate-key changes do not bump collection-shaped state when the
  public output is unchanged. `useCollection(...)` now exposes reactive
  `pendingMutations` plus runtime-bound insert, update, delete, write, and flush
  Effects. Change-feed host callbacks use a scoped dispatcher with deterministic
  late-emission drop behavior after subscription release.
- Devtools/docs/API: Fact Identity now consumes the shared Devtools
  Serialization Policy fingerprint path instead of duplicating serialization
  behavior. Start App Graph Diagnostics are pinned against the Devtools app graph
  Interface in public type tests. The Panel Contract applies deterministic item
  windowing with an overflow row, so valid large app graph panels normalize
  instead of being rejected by bridge payload guards.

Verification: focused regressions passed across Core/Solid, Start, DB/Solid DB,
Devtools, extension, and public type tests. Full `pnpm verify` passed: 9 package
builds, workspace typecheck, public type tests, Effect-first audit, 45 root test
files / 745 tests, devtools-panel verify with 1 panel test, devtools-extension
verify with 17 tests, basic starter verify with 2 tests, project-console
starter packaging, project-console typecheck/tests/build with 4 files / 27
tests, and leak scans.

## Review 66: Resource Keys, Action Codecs, Row Ingress, And App Graph Depth

Status: fixed and fully verified in the current worktree.

- Core/Solid: default Resource family and tag keys now use a typed Resource key
  codec for JSON-compatible values plus Date, URL, Map, and Set, with
  `ResourceKeyError` guidance for unsupported or circular inputs. Synchronous
  `Resource.read(...)` peeks before throwing, so absent reads no longer mutate
  Resource Store family/input/entry state. Signal dependency evaluation rolls
  back partial subscriptions on failure, and Solid router membership policy now
  keeps unregistered links from trapping browser navigation while `navigate(...)`
  reports `RouterRouteNotRegistered`.
- Start/project-console: Start action JSON clients and progressive forms share a
  Start Action Request Codec, with `StartActionFormEncodeError` for sync form
  facades. Streaming renderers receive a `StartRenderHydrationPlan` containing
  root payload/script plus streamed resource chunks, so SSR adapters do not
  duplicate root and stream hydration facts. Runtime endpoint path resolution now
  validates direct paths through the same endpoint policy, while explicit full
  URL adapter endpoints remain allowed. Project-console normalizes
  `ProjectError` values through one schema-backed Module.
- DB/Solid DB: Collection Row Ingress now canonicalizes rows before live state
  mutation: schema output decoding, finite key validation, `getKey`
  normalization, cloning, and stored-row creation happen at one Seam for
  initial data, loads, writes, optimistic mutations, and change batches.
  Handler-facing transaction facts are cloned/frozen so adapters cannot mutate
  pending queue, rollback, persisted, or restored flush facts. Live Query
  preload/refetch validates query plans before source loads, and Solid DB
  captures those `QueryEvaluationError` failures.
- Devtools/docs/API: app graph diagnostics now use a structured copy path that
  preserves typed arrays instead of inserting generic truncation markers.
  Devtools store recording returns retained route-plan/invalidation fact indexes,
  including `recordSerializedRoutePlan(...)`, so runtime events can observe
  duplicate recorded facts precisely. `DevtoolsStore` is now an explicit public
  Interface instead of an inferred internal factory return type.

Verification: focused regressions passed across Core/Solid, Start/project-
console, DB/Solid DB, Devtools, extension, project-console, and public type
tests. Full `pnpm verify` passed: 9 package builds, workspace typecheck, public
type tests, Effect-first audit, 45 root test files / 730 tests, devtools-panel
verify with 1 panel test, devtools-extension verify with 17 tests, basic starter
verify with 2 tests, project-console starter packaging, project-console
typecheck/tests/build with 4 files / 27 tests, and leak scans.

## Review 65: Runtime Time, Endpoint Policy, Snapshot Canonicalization, And Bounded Panels

Status: fixed and fully verified in the current worktree.

- Core/Solid: synchronous Resource `status(...)` and `read(...)` now use the
  active Runtime Spine clock policy, so sync reads agree with `statusEffect(...)`
  under custom clocks. Solid route disposal runs component cleanup in the same
  runtime/scope context used for route setup. Form snapshots and dirty equality
  share one snapshot policy for structural object/array fields and detached
  Map/Set/custom object values. Route grammar validation rejects invalid and
  duplicate params instead of silently overwriting matched values.
- Start/project-console: Start transport endpoint policy now lives in one shared
  module. Custom `rpcPath` and `actionPath` flow through manifests, request
  handlers, request traces, Vite dev SSR handling, RPC/action clients, and
  progressive action forms. Stream finalizers and request traces preserve the
  typed `StartStreamError` failure phase, and project-console derives runtime
  registry facts, Start options, and fallback graph facts from one source.
- DB/Solid DB: Collection snapshot validation canonicalizes pending update
  `changes` from decoded `previous`/`value`, so hydrated optimistic replay does
  not reinstall raw schema-input values. `Collection.dehydrateEffect(...)` runs
  definition-aware snapshot validation before returning payloads, and
  receiver-bound adapter policy now covers server collections, query-sync
  clients, and SQLite clock callbacks.
- Devtools/docs/API: runtime-only route-plan and invalidation summaries now feed
  the resource index used by panels as well as causal graph edges. The dead
  `InvalidationTarget` causal node kind is removed from the public union, and
  bridge payload normalization bounds display and item-data strings at the panel
  seam.

Verification: focused regressions passed across Core/Solid, Start/project-
console, DB/Solid DB, Devtools, extension, project-console, and public type
tests. Full `pnpm verify` passed: 9 package builds, workspace typecheck, public
type tests, Effect-first audit, 45 root test files / 707 tests, devtools-panel
verify with 1 panel test, devtools-extension verify with 16 tests, basic starter
verify with 2 tests, project-console starter packaging, project-console
typecheck/tests/build with 4 files / 24 tests, and leak scans.

## Review 64: Store-Owned Loads, Manifest Walls, Hydration Preflight, And Runtime Facts

Status: fixed and fully verified in the current worktree.

- Core/Solid: Resource in-flight loads are now owned by the Resource Store while
  callers join them. Interrupting one joiner no longer cancels the load for
  navigation or another consumer; Resource deletion, invalidation, and runtime
  disposal remain the cancellation seams. Resource lifetime checks take an
  explicit `now`, route matching uses grammar-specific ordering instead of
  caller order, and Form state snapshots detach caller-owned initial, reset,
  exposed state, and in-flight validation values.
- Start/project-console: streamed hydration script serialization now fails
  through typed `StartStreamError` phases instead of defects; action/RPC
  endpoint paths normalize at the manifest wall and reject empty paths, full
  URLs, and CR/LF; and project-console now derives app and server-app
  definitions from one source while keeping server registry ownership at the
  server edge.
- DB/Solid DB: `Collection.dehydrateEffect(...)` validates the built payload
  through the Collection Snapshot Codec, `validateHydrationPayloadEffect(...)`
  shares hydrate preflight depth including target-store pending collisions and
  read-only live-query snapshots, method-style adapter callbacks keep their
  receiver, and Live Query Collection `Ready.updatedAt` is stable across
  repeated reads until source/materialized output changes.
- Devtools/docs/API: runtime-only invalidation and route-plan events now project
  the same causal graph facts as recorded snapshot facts, while matched
  recorded facts stay canonical. Panel items reject duplicate ids per panel and
  render stable item identity attributes for extension rows, tests, and agent
  tools. Sharp-cast docs no longer claim a stale zero-hit broad grep.

Verification: focused regressions passed across Core/Solid, Start/project-
console, DB/Solid DB, Devtools, extension, and public type tests. Full `pnpm
verify` passed: 9 package builds, workspace typecheck, public type tests,
Effect-first audit, 45 root test files / 690 tests, devtools-panel verify with
1 panel test, devtools-extension verify with 15 tests, basic starter verify with
2 tests, project-console starter packaging, project-console
typecheck/tests/build, and leak scans.

## Review 63: Effect Snapshot Errors, Atomic Hydration, And Request Facts

Status: fixed and fully verified in the current worktree.

- Core/Solid: Resource status reads now remain non-mutating while Resource
  dehydration failures surface as typed `ResourceSnapshotCodecError` Effect
  failures through `Resource.dehydrateEffect(...)`, route preload planning, and
  Start action response metadata. `RouterProvider` requires an explicit runtime
  for serviceful route preloads, and the project-console host now passes the
  request/client runtime into the app instead of hardcoding the app runtime.
- Start: request-embedded route plans include resource keys so Devtools can
  derive exact hydration edges; pre-response request interruption is reported
  as a cancelled trace with interruption failure kind; callable manifest
  builders and serialized manifest decoders reject whitespace-only
  name/module/export/client-reference fields.
- DB/Solid DB: multi-collection hydration now preflights target-store pending
  transaction id collisions and read-only live-query collection snapshots before
  mutating earlier collections. Definition-owned snapshots receive the explicit
  Collection Store, and public type tests pin live-query collection service
  requirements plus Solid DB handle error surfaces.
- Devtools/docs/API: structural fact identity is bounded for arrays, objects,
  maps, sets, strings, and bytes; route-plan runtime facts can link
  `Hydrates` edges from request trace resource keys; public type tests pin
  route snapshot codec errors and serviceful `RouterProvider` runtime
  requirements.

Verification: focused regressions passed across DB, Devtools, Start, and
public type tests: 6 files / 293 tests plus `pnpm typecheck`, project-console
SSR regressions 2 files / 9 tests, and example typecheck. Full `pnpm verify`
passed: 9 package builds, workspace typecheck, public type tests, Effect-first
audit, 45 root test files / 665 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 15 tests, basic starter verify with 2 tests,
project-console starter packaging/typecheck/tests/build, and leak scans.

## Review 62: Request Locality, Snapshot Preflight, And LSP Runtime Types

Status: fixed and fully verified in the current worktree.

- Core/Solid: `ActionResult.withInvalidation(...)` and the Effect-returning
  result helpers preserve serviceful invalidation requirements; Solid browser
  router runtime options reject typed runtimes missing route preload services;
  Resource dehydration now peeks instead of registering absent refs; and
  duration parsing matches the public numeric duration type.
- Start: the Request Runtime always installs its request-local
  `Server.localClient(...)` Adapter, so app-level remote `ServerClient`
  services cannot leak into SSR route preload/server function dispatch.
  Callable manifests also reject empty import-client module/export references
  before serialization can emit invalid client refs.
- DB: collection hydration validates duplicate pending transaction ids before
  mutating any collection, `getKey` hydrate failures report
  `EffectInputCallbackError`, and live-query collection materialization
  de-duplicates derived keys with normal collection last-write semantics.
- Devtools/docs/API: causal edge ids use framed graph identity, imported request
  traces are normalized before request trace limits detach facts, fact identity
  honors the bounded serialization policy for payload/error seams, and public
  type/docs inventories pin the newly documented router, DB, and devtools
  contracts.

Verification: focused regressions passed across Devtools 1 file / 61 tests,
DB 2 files / 103 tests, Core 2 files / 52 tests, Solid router 1 file / 18
tests, Start 3 files / 121 tests, and public type tests. Full `pnpm verify`
passed: 9 package builds, workspace typecheck, public type tests, Effect-first
audit, 45 root test files / 655 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 15 tests, basic starter verify with 2 tests,
project-console packaging/typecheck/tests/build, and leak scans.

## Review 61: Registry Requirements, Invalidation Types, And Bounded Serialization

Status: fixed and fully verified in the current worktree.

- Core/Solid: action invalidation requirements, including invalidations carried
  by `ActionResult`, now flow through `ActionDefinition`, `ActionOptions`,
  `Action.planInvalidation*`, and `Action.use(...)`; optimistic transaction
  finish is atomic across signals; runtime disposal runs Resource Store and
  managed-runtime finalizers before reporting failures; `RouterLink` preloads
  stay inside the router Module; outside-router public preload failures carry a
  typed `RouterRouteNotRegistered` cause; and action submission reset remains
  local to the submission controller.
- Start: app-local registry action/RPC requirements and explicit
  `options.actions` requirements stay in Start request handler requirements and
  are subtracted only by the provided server runtime; malformed invalidation tag
  metadata fails closed with `ServerTransportError`; duplicate file-route
  `routeId` slugs fail manifest validation; and the basic starter avoids
  duplicate root/stream hydration.
- DB: live-query collection snapshot, persist, and dehydrate operations use the
  runtime-local Collection Store; derived live-query hydrate and restore fail
  explicitly through `CollectionSnapshotCodecError` instead of silently
  accepting writes to a read-only view.
- Devtools/docs/API: detached serialization is bounded and trap-safe, preserves
  ArrayBuffer/view markers, and avoids stack overflow on hostile or very deep
  payloads; bridge docs describe diagnostics for later missing/invalid reads;
  and public type tests pin low-level host adapters, action invalidation
  requirements, Start registry requirements, and the devtools panel contract.

Verification: focused regressions passed across Core/Solid, Devtools, Start,
basic starter, and DB: Core/Solid 4 files / 60 tests, Devtools 1 file / 58
tests, Start/basic starter 5 files / 148 tests, and DB 2 files / 99 tests.
Full `pnpm verify` passed: 9 package builds, workspace typecheck, public type
tests, Effect-first audit, 45 root test files / 643 tests, devtools-panel verify
with 1 panel test, devtools-extension verify with 15 tests, basic starter verify
with 2 tests, project-console packaging/typecheck/tests/build, and leak scans.

## Review 60: Stream Lifetimes, Store-Local Reactivity, And Identity Depth

Status: fixed and fully verified in the current worktree.

- Start: Fetch and Vite dev SSR response adapters now keep request Scope
  lifetime attached to streaming `Response.body` close/error/cancel, route
  declared string collections resolve through explicit request/app-local
  collection registries instead of process globals, and project-console no
  longer emits the same resource hydration pair in root and streamed chunks.
- DB/Solid-DB: `Collection.liveQuery(...)` owns state, versions, and materialized
  snapshots per `RuntimeCollectionStore`; Solid DB subscribes to collection
  signals inside the active runtime; persistence restore returns an explicit
  restored-snapshot fact; and snapshot codecs reject non-finite numeric keys plus
  negative or fractional pending mutation attempts.
- Core: Resource tag dependency graph indexing now uses a structured internal
  tag identity instead of the public display key, while Resource hydration
  duplicate detection uses a structured `(name, key)` tuple map.
- Devtools: fact matching now uses full deterministic structural identity
  instead of display serialization, imported id-less request traces normalize
  before request trace trimming, and extension live payloads no longer reset
  selection to `requests` when the bridge omits `selectedPanelId`.
- Docs/API: sharp-cast ledgers now describe current named cast seams rather than
  claiming a zero-hit broad grep, and public type tests pin Start diagnostics
  loader/report subpaths.

Verification: combined focused regressions passed across Core, DB, Solid-DB,
Devtools, devtools-extension, Start, and project-console: 10 files / 350 tests.
Focused package/type-test checks passed for Core, DB, Solid-DB, Devtools, Start,
devtools-extension, project-console, and `pnpm typecheck:types`. Full
`pnpm verify` passed: 9 package builds, workspace typecheck, public type tests,
Effect-first audit, 45 root test files / 632 tests, devtools-panel verify,
devtools-extension verify with 15 tests, basic starter verify with 2 tests,
project-console packaging/typecheck/tests/build, and leak scans.

## Review 59: Registry-Local Dispatch, Structured Identity, And LSP Drift

Status: fixed and fully verified in the current worktree.

- Start: app-graph diagnostics policy failures now use a tagged Effect error,
  serialized action/server-function manifests validate `moduleKind` against the
  actual server/client module paths, file-route manifests enforce route
  entry/module agreement, action response content-type failures say "Start
  action", and the project-console server entry now builds an explicit server
  app registry for SSR route preload and form action dispatch.
- Core/Solid: Resource hydration rejects duplicate `name`/`key` snapshots before
  apply, sync `Action.planInvalidation(...)` wraps invalidation callback throws
  in `EffectInputCallbackError`, `Server.localClient({ registry })` dispatches
  through the supplied app registry snapshot, default Solid `RuntimeProvider`
  instances own isolated runtimes, and stale Suspense preloads are interrupted
  when a ref changes to an already-loaded resource.
- DB: incremental live-query row/output identity now uses structured stable
  keys instead of delimiter-concatenated strings, `updateEffect(...)` uses
  decoded changes for optimistic replay and handlers, `joinIndexed(...)`
  validates declared indexes through Query Plan validation, and pending mutation
  attempt increments bump the collection version.
- Devtools: public `*Effect` describer/render wrappers are lazy, extension
  transport errors no longer overlay stale sample facts after a live bridge
  disappears, and direct id-less request traces normalize consistently before
  summary/causal graph projection.
- Docs/API: migration notes use `Action.define(...)` plus
  `StartAction.use(...)`/`startActionForm(...)`, the TSRX public API inventory
  preserves `@tsrx/vite-plugin-solid` ordering, deployment host facades are
  pinned in public type tests, and stale finalizer naming was corrected.

Verification: focused package typechecks and regressions passed across Core,
Solid, DB, Start, Devtools, devtools-extension, and project-console; `pnpm
typecheck`, `pnpm audit:effect-first`, package-source raw `Error`/`TypeError`
scan, `git diff --check`, and full `pnpm verify` passed. The full gate covered
9 package builds, workspace typecheck, public type tests, Effect-first audit, 45
root test files / 618 tests, devtools-panel verify, devtools-extension verify,
basic starter verify, project-console starter packaging, project-console
typecheck/tests/build, and leak scans.

## Review 58: Hydration Walls, Runtime Ownership, Devtools Identity, And LSP Coverage

Status: fixed and fully verified in the current worktree. The detailed finding
entry for this sweep is also recorded in the ledger body; this tip keeps the
latest review discoverable despite older merge ordering.

- Start: malformed collection hydration roots now fail closed, `.server.tsrx`
  and `.contract.tsrx` participate in the Manifest/Vite server-only wall, and
  Vite dev SSR pass-through uses the Effect middleware Adapter.
- Core/Solid: action reset interrupts all active submission fibers, Resource
  delete/forced refresh semantics notify subscribers correctly, and Solid
  router state consumes Core `Route.matchEffect(...)` so schema decode failures
  become typed `RouteNavigationError` failures.
- DB: hydration rejects duplicate collection/row identities, Collection
  mutation/direct-write paths validate `input`, query window counts are finite
  safe integers everywhere, and live-query collection versions use monotonic
  revisions instead of hash identity.
- Devtools: Ref invalidation targets stay Resource nodes, runtime event fact
  fallbacks cannot collide with recorded facts, imported duplicate event
  sequences are normalized, describers detach unknown values, legacy app-graph
  panels render safely, and item metrics reject malformed non-arrays.
- Docs/API: `@effect-ui/tsrx` has LSP/type-test coverage, Start root low-level
  helpers and Core re-exports are classified as expert-public convenience
  surfaces, DB next slices no longer list completed TanStack Query-shaped sync
  work, and project-console graph helpers are documented as narrow non-Vite
  fallbacks.

Verification: package typechecks and focused regressions passed across Core,
Solid, Start, DB, Devtools, and TSRX; `pnpm typecheck`, `pnpm audit:effect-first`,
`pnpm test` with 45 root files / 603 tests, full `pnpm verify`, and
`git diff --check` passed.

## Review 57: Atomic Imports, Runtime Cleanup, and Transport Validation

Status: fixed and fully verified in the current worktree.

- DB Collection Runtime: initial optimistic mutation application now sits inside
  the same persistence rollback seam as pending enqueue, so a failed mutation
  persist leaves rows, pending mutations, versions, and events unchanged.
  Restored pending mutation snapshots now require exact rollback-row key
  coverage, collection values detach `ArrayBuffer` values, and zero-source query
  plans fail at the Query Plan validator Interface.
- Devtools Store and graph facts: imported snapshots are bounded before deep
  payload detachment, serialization stops traversing once a bounded exact
  truncation count is known, request-embedded route plans use identity disjoint
  from standalone plans, and count-only hydration facts no longer emit
  identity-bearing `Hydrates` edges.
- Core/Solid runtime cleanup: `Action.reset()` runs the local reset Effect
  without the captured runtime, `UiScope` owns and awaits its finalizer list when
  disposed directly, provider-owned Solid runtimes dispose without forking on
  the runtime being disposed, and RouterOutlet transitions start previous route
  cleanup before rendering the next branch while keeping newer route renders
  queued behind in-flight disposal starts.
- Start transport: action invalidation `entries` are semantically validated
  through runtime-local Resource family lookup before hydration/invalidation is
  applied, form actions negotiate response mode from `Accept` quality and
  preference, and Vite dev SSR middleware error reporting treats `next(error)`
  as best effort.
- Docs drift: route virtual-module docs now distinguish runtime virtual helpers
  from precise generated route type maps, and DB host examples wrap Promise
  clients with `Effect.tryPromise(...)`.

Focused evidence:

- DB typecheck and `packages/db/test/collection.test.ts` passed: 67 tests.
- Devtools typecheck and `packages/devtools/test/devtools.test.ts` passed:
  46 tests.
- Core, Solid, and Start package typechecks passed.
- Focused Core/Solid/Start regression run passed: 5 files / 175 tests.
- Full verification passed: 9 package builds, workspace typecheck, public type
  tests, Effect-first audit, 45 root test files / 585 tests, devtools panel,
  devtools extension, basic starter, project-console packaging/build, leak-scan
  gates, and `git diff --check`.

## Review 1: Internal Runtime Modules

Status: fixed.

- Resource Lifetime Module: extracted Resource Lifetime, Resource Dependency
  Graph, Resource Event Stream, duration parsing, and identifiers from the
  Resource Definition facade.
- Collection Store and Mutation Queue Module: extracted collection row/index
  state, pending mutation queue transitions, persistence, and Query Plan
  Diagnostics from the DB root facade.
- Start Request Runtime Module: extracted Request Runtime creation, provision,
  local server client installation, response-body finalization, and request
  teardown facts from Start root request handling.
- Start Transport Module: extracted Effect-shaped Start Fetch transport and
  request trace facts from the Start root facade.
- Start Manifest Wall Module: extracted manifest assembly, route discovery,
  virtual module generation, app graph policy validation, and generated route
  definition writes from the Vite adapter.

Evidence:

- `pnpm typecheck` passed.
- `pnpm build` passed.
- `pnpm test` passed with local server binding allowed: 39 files / 322 tests.
- `pnpm verify` passed end to end.

## Review 2: Effect Runtime Compatibility

Status: fixed in the current worktree.

- Resource Request Family: `Resource.requestFamily(...)` lets a Resource
  Definition keep Resource Store state, TTL, hydration, tags, and invalidation
  while delegating sibling load batching to Effect `RequestResolver`.
- Start Request Observability: Start request handling now emits Effect metrics,
  log annotations, and spans alongside JSON-safe `StartRequestTrace` facts.
- Effect RPC Compatibility: Start server functions can be described as
  `effect/unstable/rpc` descriptors and grouped as an `RpcGroup`, while the
  current Start transport remains the serving Adapter.

Evidence:

- `pnpm typecheck` passed.
- `pnpm exec vitest run packages/core/test/resource.test.ts packages/start/test/effect-rpc-compat.test.ts packages/start/test/start.test.ts` passed:
  3 files / 85 tests.

## Review 3: Deepening Candidates

Status: items 1-6 are fixed in the current worktree.

1. Devtools Inspection Module
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/bridge.ts`,
     `packages/devtools/src/panels.ts`,
     `packages/devtools/src/panel-renderer.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/src/summary.ts`,
     `packages/devtools/test/devtools.test.ts`, `examples/devtools-*`.
   - Problem: snapshot storage, serialization, request trace records, summary
     building, causal graph construction, panel model generation, HTML
     rendering, and bridge installation shared one large Implementation.
   - Fix: `packages/devtools/src/serialization.ts` owns serialization,
     invalidation plan projection, route-plan projection, and defensive trace
     copies; `packages/devtools/src/store.ts` owns bounded snapshot storage and
     event recording; `packages/devtools/src/panels.ts` owns summary to
     panel-contract projection; `packages/devtools/src/panel-renderer.ts` owns
     deterministic panel HTML rendering, panel-id validation,
     DOM mount/update/unmount behavior, and the Effect-scoped mount helper; and
     `packages/devtools/src/bridge.ts` owns the scoped app-side inspected-window
     bridge install/uninstall lifecycle. `packages/devtools/src/summary.ts`
     owns request trace summaries, app-graph summaries, resource indexing,
     runtime event summaries, and causal graph construction. The devtools root
     remains the public facade and contract surface.
   - Benefits: store bugs, serialization bugs, summary bugs, causal graph bugs,
     panel model bugs, renderer bugs, and bridge lifecycle bugs now have narrow
     implementation interfaces while public imports stay stable.
   - Evidence: `pnpm --filter @effect-ui/devtools build` passed,
     `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 17 tests. Full `pnpm typecheck` and `pnpm test` also passed:
     40 files / 328 tests.

2. Live Query Runtime Module
   - Status: fixed.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: Query Plan Diagnostics are extracted, but `QueryBuilder`,
     `LiveQuery`, Live Query Collection, and the incremental IVM engine still
     sit in the DB root.
   - Fix: `packages/db/src/live-query-runtime.ts` now owns the IVM graph,
     source synchronization, join stream construction, grouping, ordering,
     windowing, output multiplicity handling, and source preload/refetch loops.
     The DB root keeps the compact Query and Collection facades.
   - Benefits: incremental query behavior now has better locality and a smaller
     implementation interface. Query callers keep the same DSL leverage, while
     runtime bugs in joins, grouped rows, ordering, and source deltas live in
     the Live Query Runtime Module instead of the DB root.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/core/test/route-server.test.ts packages/start/test/file-routes.test.ts packages/start/test/file-route-modules.test.ts packages/start/test/route-manifest.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 6 files / 70 tests.

3. Start Transport Protocol Module
   - Status: fixed.
   - Files: `packages/start/src/index.ts`, `packages/start/src/rpc.ts`,
     `packages/start/src/request-trace.ts`, `packages/start/src/start-fetch.ts`,
     `packages/start/src/start-transport-protocol.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: JSON/form decoding, RPC response encoding, Start Action Request
     handling, Progressive Action Result encoding, invalidation hydration, and
     failure classification lived in the Start root.
   - Fix: moved protocol decoding, response shaping, schema encode/decode,
     failure classification, invalidation payload serialization, action
     response metadata, client response parsing, and progressive form metadata
     into `start-transport-protocol.ts`. The Start root now orchestrates the
     Request Runtime and delegates wire rules to that Module.
   - Benefits: Start transport behavior now has better locality; JSON/form
     protocol bugs, action response metadata bugs, and client decode bugs can be
     tested through one protocol interface instead of searching the full Start
     root. The root module keeps leverage as the request handler facade.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` and
     `pnpm typecheck` passed,
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/effect-rpc-compat.test.ts`
     passed: 3 files / 67 tests, and
     `pnpm exec vitest run packages/start/test/action-manifest.test.ts packages/start/test/app-graph.test.ts`
     passed: 2 files / 16 tests.

4. Route Grammar Module
   - Status: fixed.
   - Files: `packages/core/src/route.ts`,
     `packages/core/src/route-grammar.ts`,
     `packages/start/src/file-routes.ts`,
     `packages/start/src/file-route.ts`,
     `packages/start/src/file-route-modules.ts`,
     `packages/start/src/generated-route-definitions.ts`.
   - Problem: core Route matching/building and Start file-route manifest
     generation encoded overlapping route grammar rules.
   - Fix: `packages/core/src/route-grammar.ts` now owns canonical route path
     segments, param-name rules, optional param handling, path building,
     matching, manifest path rendering, route-id slugs, segment ordering, and
     segment-prefix checks. Core `route(...)` uses that grammar directly, and
     Start file routes now act as an Adapter from filesystem `$id` segments
     into the same grammar.
   - Benefits: route grammar bugs now have one implementation and one test
     surface. Core Route keeps leverage for typed navigation, while Start keeps
     locality around filesystem naming and manifest policy instead of
     re-encoding path semantics.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed,
     `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/core/test/route-server.test.ts packages/start/test/file-routes.test.ts packages/start/test/file-route-modules.test.ts packages/start/test/route-manifest.test.ts packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 6 files / 70 tests.

5. Start Diagnostics Contract Module
   - Status: fixed.
   - Files: `packages/start/src/app-graph.ts`,
     `packages/start/src/diagnostics-report.ts`,
     `packages/start/src/start-manifest-wall.ts`,
     `packages/devtools/src/index.ts`.
   - Problem: Start App Graph Diagnostics are generated, validated, formatted
     into repair reports, and projected into devtools across separate
     Implementations.
   - Fix target: own diagnostic fact classification, policy violations,
     owner/guidance mapping, and devtools-ready projection in one diagnostics
     contract Module.
   - Fix: `packages/start/src/start-diagnostics-contract.ts` now owns
     diagnostic report facts, policy violation classification, owner grouping,
     and repair guidance; `packages/start/src/diagnostics-report.ts` remains a
     formatting facade.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/app-graph.test.ts packages/start/test/effect-rpc-compat.test.ts`
     passed: 3 files / 69 tests.

6. Solid Runtime Adapter Module
   - Status: fixed.
   - Files: `packages/solid/src/index.ts`, `packages/solid/src/runtime.ts`,
     `packages/solid/src/router.ts`, `packages/solid/src/hooks.ts`,
     `packages/solid-db/src/index.ts`, `packages/solid-db/src/collection.ts`,
     `packages/solid-db/src/live-query.ts`,
     `packages/solid-db/src/shared.ts`,
     `packages/solid/test/router.test.ts`,
     `packages/solid-db/test/solid-db.test.ts`.
   - Problem: runtime context, browser navigation, route preload scopes, route
     rendering scopes, Resource hooks, Action hooks, Stream hooks, and DB hooks
     shared broad adapter Implementations. The deletion test showed the root
     Modules were acting as low-locality containers rather than deep
     interfaces.
   - Fix: kept the public Solid and Solid DB roots as facade Modules, then moved
     Runtime Spine ownership, router lifecycle, Resource/Action/stream hooks,
     Collection hook adaptation, Live Query hook adaptation, and collection
     subscription glue behind focused internal Modules.
   - Benefits: Solid callers keep the same compact interface while maintainers
     get better locality. Router lifecycle bugs now live near route scope
     management, hook bugs live near hook adaptation, and Solid DB query
     subscription bugs live behind the shared collection subscription seam.
   - Evidence: `pnpm --filter @effect-ui/solid typecheck` passed,
     `pnpm --filter @effect-ui/solid-db typecheck` passed, and
     `pnpm exec vitest run packages/solid/test/router.test.ts packages/solid-db/test/solid-db.test.ts`
     passed: 2 files / 2 tests.

## Review 4: Effect-First Coordination Follow-Up

Status: fixed for the findings in this pass. No open candidates remain from
Review 4.

1. Devtools Store Module
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: the public devtools root still owned snapshot mutation, event
     sequencing, bounded history, action tracking, route/request recording, and
     summary/panel/causal graph reads. The Module was deep for callers, but its
     Implementation had poor locality.
   - Fix: `store.ts` now owns the Devtools Store runtime and exposes Effect
     operations as the implementation interface. Plain store methods are sync
     Adapters over those Effects for existing host callers. `serialization.ts`
     owns JSON-safe value projection, invalidation plan projection, route-plan
     projection, and defensive request-trace copies.
   - Benefits: Store ordering, limits, copies, and event recording now have one
     test surface. The public root keeps its facade leverage while future
     summary and causal-graph Modules can depend on a narrower Store interface.
   - Evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 17 tests.

2. Effect-first test coordination
   - Status: fixed for the audited sites.
   - Files: `packages/core/test/action.test.ts`,
     `packages/core/test/resource.test.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/persisted-options.test.ts`,
     `packages/db/test/sqlite-persistence.test.ts`,
     `packages/start/test/start.test.ts`,
     `examples/project-console/src/domain.mock.test.ts`.
   - Problem: several tests coordinated Action, Resource, Collection, and
     StartAction concurrency with Promise handles even though the behavior under
     test was Effect-native scheduling.
   - Fix: replaced Promise lifetimes with `Effect.runFork(...)`,
     `runtime.runFork(...)`, `Fiber.join(...)`, `Fiber.await(...)`,
     `Effect.all(...)`, `Effect.flip(...)`, and
     `Effect.scoped(runtime.provide(...))` so internal sequencing stays inside
     Effect. Host Promise conversion remains at the Vitest boundary.
   - Benefits: tests now exercise the same fibers, interruption, and runtime
     provisioning semantics as the library. This improves locality for
     scheduler bugs and keeps Promise use as a host Adapter instead of an
     internal coordination seam.
   - Evidence: `pnpm typecheck` passed,
     `pnpm exec vitest run packages/core/test/action.test.ts packages/core/test/resource.test.ts`
     passed: 2 files / 43 tests,
     `pnpm exec vitest run packages/db/test/sqlite-persistence.test.ts packages/db/test/persisted-options.test.ts packages/db/test/collection.test.ts`
     passed: 3 files / 40 tests,
     `pnpm exec vitest run examples/project-console/src/domain.mock.test.ts`
     passed: 1 file / 7 tests, and
     `pnpm exec vitest run packages/start/test/start.test.ts` passed:
     1 file / 57 tests.
   - Full gate: escalated `pnpm verify` passed after this follow-up with
     9 package builds, workspace typecheck, type tests, 40 root test files /
     328 tests, devtools-panel verify, devtools-extension verify, basic starter
     verify, project-console starter packaging/typecheck/tests/build, and leak
     scan.

3. Collection Runtime Module
   - Status: fixed for the root collection runtime.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-ids.ts`,
     `packages/db/src/collection-errors.ts`,
     `packages/db/src/collection-preload.ts`,
     `packages/db/test/*.test.ts`.
   - Problem: the DB root still owned Collection Definition construction,
     runtime store access, load/refetch, direct writes, change batches,
     optimistic mutation execution, event publication, and persistence
     coordination, so unrelated Query and adapter work had to share one large
     Implementation.
   - Fix: `collection-runtime.ts` now owns the runtime store, preload
     collection, load/refetch, pending mutation execution, direct writes,
     change-feed writes, persistence handoff, and `Collection.define(...)`
     implementation. `collection-ids.ts`, `collection-errors.ts`, and
     `collection-preload.ts` hold the stable symbols, tagged errors, and
     preload collector contract. The DB root remains the public Collection and
     Query facade.
   - Benefits: Collection runtime bugs now have a focused implementation
     interface and test surface. Query, sync adapters, flush policy, and
     persistence helpers can depend on a smaller runtime module instead of
     re-entering the full DB root.
   - Evidence: `pnpm --filter @effect-ui/db typecheck`, `pnpm typecheck`, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/flush-policy.test.ts packages/db/test/persisted-options.test.ts packages/db/test/sqlite-persistence.test.ts packages/db/test/live-query-collection.test.ts packages/db/test/server-collection.test.ts packages/db/test/sync-adapter.test.ts`
     passed: 7 files / 58 tests.
   - Full gate: escalated `pnpm verify` passed after this extraction with 9
     package builds, workspace typecheck, type tests, 40 root test files / 328
     tests, devtools-panel verify, devtools-extension verify, basic starter
     verify, project-console starter packaging/typecheck/tests/build, and leak
     scan.

4. Start Request Handler Module
   - Status: fixed.
   - Files: `packages/start/src/index.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/start-request-preload.ts`,
     `packages/start/src/request-runtime.ts`,
     `packages/start/src/request-trace.ts`,
     `packages/start/src/start-transport-protocol.ts`.
   - Problem: the Start root still owned RPC/action/SSR endpoint selection,
     Request Runtime creation and provisioning, request trace mutation,
     ResponseContext application, and stream finalization orchestration.
   - Fix: `start-request-endpoints.ts` now owns server RPC/action endpoint
     execution, `start-request-preload.ts` owns request preload and collection
     hydration facts, and `start-request-handler.ts` owns endpoint selection,
     SSR render orchestration, response context application, request trace
     mutation, and runtime/stream finalization. The Start root remains the
     public facade and keeps client action/RPC helpers separate from server
     request lifecycle code.
   - Benefits: server request lifecycle bugs now have a focused Module and can
     depend on the existing request-runtime, request-trace, and transport
     protocol Interfaces without expanding the public root Implementation.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` and
     `pnpm typecheck` passed, and escalated
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts packages/start/test/adapters.test.ts`
     passed: 3 files / 71 tests.

5. Resource Runtime Module
   - Status: fixed.
   - Files: `packages/core/src/resource.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-collector.ts`,
     `packages/core/src/resource-errors.ts`,
     `packages/core/src/resource-lifetime.ts`,
     `packages/core/src/resource-store.ts`.
   - Problem: the public Resource root still owned runtime store lookup,
     touched-ref collection, in-flight fiber coordination, suspense reads,
     invalidation execution, dehydration, hydration, and duplicate runtime
     contract declarations that broke Vite/Rolldown app-graph diagnostics.
   - Fix: `resource-runtime.ts` now owns store lookup, touched-ref collection,
     refresh/prefetch execution, suspense reads, invalidation execution,
     dehydration, and hydration. `resource.ts` keeps Resource Definition,
     family/tag diagnostics, and public Resource namespace wrappers.
     `resource-collector.ts` and `resource-errors.ts` hold the stable contract
     exports so source consumers do not see duplicate ESM exports.
   - Benefits: Resource runtime bugs now have better locality, and Start's Vite
     diagnostics path can parse Core source without duplicate export failures.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/resource.test.ts packages/core/test/resource-store.test.ts packages/core/test/runtime.test.ts packages/core/test/action.test.ts packages/core/test/action-result.test.ts packages/core/test/route-server.test.ts packages/start/test/start.test.ts`
     passed: 7 files / 128 tests.

Open candidates from this pass: none after the Start Request Handler and
Resource Runtime extractions. A fresh review should look for new candidates
instead of reopening the fixed Review 4 list.

## Review 5: Devtools Summary Follow-Up

Status: fixed for the finding in this pass. No open candidates remain from
Review 5.

1. Devtools Summary Contract Module
   - Status: fixed.
   - Files: `packages/devtools/src/summary.ts`,
     `packages/devtools/src/summary-app-graph.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: after the public devtools root was split, `summary.ts` became a
     new low-locality Implementation. It owned app graph summary projection,
     route/invalidation/request/runtime summary facts, resource indexing, and
     causal graph construction in one 1,400+ line Module.
   - Fix: `summary-app-graph.ts` now owns Start App Graph summary projection,
     `summary-facts.ts` owns normalized invalidation, route, request, runtime
     event, and resource index facts, and `causal-graph.ts` owns causal node and
     edge construction. `summary.ts` now composes those Modules into the public
     `DevtoolsSummary` facade.
   - Benefits: app graph summary bugs, runtime fact normalization bugs, and
     causal graph bugs now have separate implementation surfaces. The public
     devtools summary and causal graph exports remain stable.
   - Evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 17 tests.

Full gate: escalated `pnpm verify` passed after the Start Request Handler,
Resource Runtime, and Devtools Summary extractions with 9 package builds,
workspace typecheck, type tests, 40 root test files / 328 tests,
devtools-panel verify, devtools-extension verify, basic starter verify,
project-console starter packaging/typecheck/tests/build, and leak scan.

Open candidates from this pass: none. The next architecture-deepening review
should start from a fresh scan rather than the fixed Review 4 or Review 5
findings.

## Review 6: DB Query Builder Follow-Up

Status: fixed for the finding in this pass. No open candidates remain from
Review 6.

1. Query Builder And Live Query Collection Modules
   - Status: fixed.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`,
     `packages/solid-db/test/solid-db.test.ts`.
   - Problem: after Collection Runtime and Live Query Runtime were extracted,
     the DB root still owned the immutable Query Builder, aggregate helpers,
     one-shot query execution, live-query creation, query diagnostics, and
     read-only Live Query Collection adaptation. That kept Query behavior in a
     large facade Module instead of near Query Plan, Live Query Runtime, and
     collection-adapter concepts.
   - Fix: `query-builder.ts` now owns `QueryBuilder`, the public `Query`
     namespace implementation, aggregate helpers, source preloading, live query
     construction, and diagnostics delegation. `live-query-collection.ts` owns
     the adapter from a Live Query graph to a read-only Collection Definition.
     `index.ts` re-exports the Query interface and keeps Collection facade
     behavior.
   - Benefits: Query DSL, execution, and Live Query Collection adapter bugs now
     have focused Modules and test surfaces. The DB root keeps public leverage
     while Query Plan and Live Query Runtime remain the implementation seams for
     planning and incremental evaluation.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` and `pnpm typecheck`
     passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts packages/solid-db/test/solid-db.test.ts`
     passed: 3 files / 36 tests.

Open candidates from this pass: none. The next architecture-deepening review
should start from a fresh scan rather than the fixed Review 6 finding.

## Review 7: Core Effect Execution Seam

Status: fixed for the Core execution-seam finding in this pass. Follow-up
subagent probes are recorded in Review 8.

1. Core Effect Execution Seam
   - Status: fixed.
   - Files: `packages/core/src/route.ts`,
     `packages/core/src/server.ts`,
     `packages/core/test/route-server.test.ts`.
   - Problem: `Route.preloadEffect(...)`,
     `Route.planNavigationEffect(...)`, and
     `Server.handleRouteEffect(...)` returned Effects while still invoking
     preload, route matching/schema decode, or route handlers during Effect
     construction. That made the Module Interface shallow: callers had to know
     hidden sync ordering and hidden throw modes even when composing Effects.
   - Fix: route preload invocation, navigation matching/schema decode, and
     server route handler invocation now run inside the returned Effect.
     Synchronous preload and handler failures are captured in typed Effect
     failure channels (`RoutePreloadError`, `RouteNavigationError`, and
     `ServerRouteHandlerError`), and schema decode failures from navigation
     planning are observed through the returned Effect instead of
     construction-time throws. The sync `route.match(...)` Interface remains
     unchanged.
   - Benefits: Effect-returning Interfaces now have better Locality and
     Leverage. Adapters can reason about route/server work as one Effect
     program, and tests cover the behavior through the public Interface instead
     of reaching into implementation order.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/route-server.test.ts packages/core/test/runtime.test.ts`
     passed: 2 files / 23 tests.

2. Start Adapter Stream Coordination
   - Status: fixed.
   - Files: `packages/start/test/adapters.test.ts`.
   - Problem: one streaming adapter test still used `Promise.race(...)` for
     timeout coordination at the test seam.
   - Fix: replaced the Promise race with `Effect.raceFirst(...)` around an
     `Effect.tryPromise(...)` host read boundary.
   - Benefits: the test keeps host `ReadableStream` reads at the Adapter seam
     while scheduling and timeout coordination stay in Effect.
   - Evidence: the Promise-method grep over packages, examples, scripts, and
     type tests is clean. `pnpm --filter @effect-ui/start typecheck` passed,
     and the escalated
     `pnpm exec vitest run packages/start/test/adapters.test.ts` passed:
     1 file / 7 tests.

## Review 8: Fresh Large-Module Deletion-Test Follow-Up

Status: fixed for actionable findings in this pass. The Devtools probe found no
new Devtools split to make.

1. DB Query Builder And Live Query Collection
   - Status: fixed.
   - Files: `packages/db/src/index.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/src/live-query-runtime.ts`.
   - Problem: the DB root still owned Query Builder construction, aggregate
     helpers, one-shot execution, live query creation, diagnostics delegation,
     and the Live Query Collection adapter. The public root Interface was
     useful, but the Implementation mixed Collection facade work with Query
     DSL and adapter behavior.
   - Fix: `query-builder.ts` now owns the Query Module and `Query` namespace
     implementation. `live-query-collection.ts` now owns the Adapter that turns
     a Live Query graph into a read-only Collection Definition. The DB root
     re-exports the public Query and Collection facades.
   - Benefits: Query and Live Query Collection behavior now have smaller test
     surfaces and better Locality while preserving public import leverage.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 2 files / 35 tests.

2. Start Manifest Entry Core
   - Status: fixed.
   - Files: `packages/start/src/manifest-entry-core.ts`,
     `packages/start/src/server-function-manifest.ts`,
     `packages/start/src/action-manifest.ts`.
   - Problem: server-function manifests and action manifests had separate
     Implementations for the same Manifest Wall mechanics: module id
     normalization, module classification, deterministic ids, entry validation,
     sort order, duplicate name/id/export checks, and browser-safe client
     reference validation.
   - Fix: `manifest-entry-core.ts` now owns the shared internal Manifest Entry
     Core. Server functions and actions remain separate public Modules and
     adapt their extra fields (`hasHandler` and action behavior metadata)
     through the shared seam.
   - Benefits: duplicate manifest bugs now have one implementation surface,
     while the public server-function/action Manifest Interfaces stay distinct.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/server-function-manifest.test.ts packages/start/test/action-manifest.test.ts packages/start/test/app-graph.test.ts`
     passed: 3 files / 21 tests.

3. Start Transport Public Interface
   - Status: fixed.
   - Files: `packages/start/src/index.ts`,
     `packages/start/src/start-transport-protocol.ts`.
   - Problem: the Start root had a curated transport/form/result export list,
     but also wildcard-exported `start-transport-protocol.ts`, leaking internal
     protocol helpers such as low-level request readers, response constructors,
     failure classifiers, and exit encoders.
   - Fix: removed the wildcard export. The root still exports the documented
     transport paths/headers through `rpc.ts`, browser clients, action form
     bridge, request predicates, invalidation-plan description, and Start
     action result types.
   - Benefits: the Start Transport Protocol remains a deep internal Module,
     while the root public Interface is narrower and easier to keep stable.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/rpc.test.ts packages/start/test/start.test.ts`
     passed: 2 files / 64 tests.

4. Start Request Trace Recorder
   - Status: fixed.
   - Files: `packages/start/src/request-trace-recorder.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/request-trace.ts`.
   - Problem: endpoint and handler Modules directly mutated
     `StartRequestTraceFacts`, spreading failure-kind ordering, action/server
     function recording, route plan projection, and collection preload
     projection across request lifecycle code.
   - Fix: `request-trace-recorder.ts` now owns the mutation Interface for
     request trace facts. Endpoint and handler code records intent through
     `recordStartRequestTraceFailure`, server-function/action recorders, and
     preload recording.
   - Benefits: trace fact mutation rules have one Locality point without
     changing the final `StartRequestTrace` contract.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/start.test.ts packages/start/test/rpc.test.ts`
     passed: 2 files / 64 tests.

5. Start App Graph Diagnostics Policy Contract
   - Status: fixed.
   - Files: `packages/start/src/app-graph.ts`,
     `packages/start/src/start-virtual-modules.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: app graph diagnostics policy validation lived in
     `app-graph.ts`, while the generated app graph virtual module embedded a
     second Implementation of unknown route preload policy violation
     collection and formatting.
   - Fix: `app-graph.ts` now exports
     `collectStartAppGraphDiagnosticsPolicyViolations` and
     `formatStartAppGraphDiagnosticsPolicyViolation`; the virtual module calls
     those helpers and reuses the existing unknown-route preload diagnostics
     functions.
   - Benefits: diagnostics policy semantics have one Interface whether callers
     validate in process or through Vite's resolved virtual module.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/app-graph.test.ts packages/start/test/start.test.ts packages/start/test/rpc.test.ts`
     passed: 3 files / 73 tests.

6. Devtools Large-Module Probe
   - Status: no action.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/summary.ts`,
     `packages/devtools/src/causal-graph.ts`.
   - Deletion test: passed. The Devtools root is a legitimate public
     contract/facade Module; `summary.ts` now composes focused summary Modules;
     and `causal-graph.ts` hides a large deterministic graph Implementation
     behind a small Interface. Splitting it now would expose one-adapter graph
     builder seams rather than increasing Depth.

Open candidates from this pass: none after the fixes above. Later follow-up
probes found new candidates, tracked in Review 9.

## Review 9: Core Signal Dependency Tracker Follow-Up

Status: fixed for the Signal Dependency Tracker finding. Other follow-up
probes still found actionable candidates in Core, DB, Devtools, and Start, so
this is not a clean-sweep point.

1. Signal Dependency Tracker Module
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/core/src/signal.ts`,
     `packages/core/src/signal-dependencies.ts`,
     `packages/core/test/signal.test.ts`,
     `packages/core/test/scope.test.ts`.
   - Problem: `watch(...)` and `Signal.derive(...)` each owned a separate
     dependency-tracking Implementation. `watch(...)` de-duped sources and
     queued reentrant runs; derived signals subscribed on every source read and
     dropped reentrant recomputes. A derived signal that read the same source
     twice could subscribe twice and recompute more than once for one update.
   - Fix: `signal-dependencies.ts` now owns the shared internal tracker for
     observer installation, source de-duping, cleanup, untracked reads, and
     queued reruns. `watch(...)` and `DerivedSignalImpl` are Adapters over the
     same dependency Interface.
   - Benefits: signal dependency semantics have one Locality point, while the
     public Signal Interface stays unchanged. Derived signals now get the same
     source de-duping and queued recompute behavior as `watch(...)`.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/signal.test.ts packages/core/test/scope.test.ts packages/core/test/route-server.test.ts packages/core/test/runtime.test.ts`
     passed: 4 files / 35 tests.

2. Form Validation Runtime
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/core/src/form.ts`,
     `packages/core/test/form.test.ts`,
     `packages/core/test/action-result.test.ts`.
   - Problem: `Form.validateEffect(...)` read and wrote shared form state
     across schema/custom validation without an epoch. If `setField(...)`,
     `reset(...)`, or another validation happened while validation was
     running, a stale validation could later commit `Valid` or `Invalid` state
     for old values.
   - Fix: form controllers now keep a validation revision. Field writes,
     reset, and validation starts advance the revision. Each validation
     snapshots values at start and only commits final form state when its
     revision is still current. Stale validations still return or fail with
     the captured validation result, but they do not mutate current state.
   - Benefits: the Form Module now owns async validation race semantics, giving
     callers a deeper Effect-first Interface and better Locality for future
     validation policy changes.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed, and
     `pnpm exec vitest run packages/core/test/form.test.ts packages/core/test/action-result.test.ts`
     passed: 2 files / 16 tests.

3. Collection Transaction Identity
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/db/src/collection-state.ts`,
     `packages/db/src/collection-mutation-queue.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: collection mutation transaction ids used a module-global
     counter. Hydrating a pending `ctx_1` into a fresh runtime could collide
     with the next newly-created transaction id, causing new pending mutations
     to alias restored mutation facts.
   - Fix: transaction identity now lives on Collection State. New optimistic
     mutations allocate ids from the active state, and hydration advances the
     state-local counter from restored pending transaction ids.
   - Benefits: optimistic mutation identity now has runtime/request Locality,
     and restored pending mutation facts cannot be overwritten by subsequent
     writes in the same Collection Store.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/persisted-options.test.ts packages/db/test/flush-policy.test.ts`
     passed: 3 files / 39 tests.

Follow-up candidates queued at this point, with later reviews resolving most of
them: Core Definition Registry, Core Action Submission Controller, Devtools
Store Snapshot Detachment, Devtools Serialization Policy, DB Collection Contract
Module, DB Collection Registry Locality, DB Collection Snapshot Codec, Start
callable manifest entry assembly/deserialization, Start App Graph Diagnostics
Runtime, and Start File Route Path Decoder.

## Review 10: Devtools Identity Follow-Up

Status: fixed for Devtools Fact Identity and Graph Identity findings. Other
Devtools candidates remain queued.

1. Devtools Graph Identity Module
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/devtools/src/graph-ids.ts`,
     `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/panels.ts`.
   - Problem: causal graph construction, summary facts, and panels each built
     ids with local string templates. The same conceptual ids existed in
     multiple Implementations, so future graph/panel changes could drift
     silently.
   - Fix: `graph-ids.ts` now owns graph node ids, panel item ids, runtime event
     ids, invalidation target ids, runtime target labels, and causal edge ids.
     Graph, summary, and panel Modules call the shared Interface.
   - Benefits: stable Devtools identity has one Locality point and callers get
     the same ids across summaries, panels, and causal graph edges.
   - Evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 19 tests.

2. Devtools Fact Identity Module
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/devtools/src/fact-identity.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: bounded invalidation history trimming left stored action/runtime
     invalidation indexes pointing at stale positions, and id-less request
     traces could be summarized into graph facts without stable request ids.
   - Fix: `fact-identity.ts` now owns invalidation index rebasing for stored
     action/runtime facts and fallback request trace id stamping. The Store
     applies it before appending trimmed invalidation history or recording a
     request trace runtime event.
   - Benefits: Devtools Store fact references remain valid after bounded
     history truncation, and request trace facts get deterministic identity
     before summary or causal graph projection.
   - Evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and
     `pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed:
     1 file / 19 tests.

Follow-up candidates queued at this point, with later reviews resolving most of
them: Core Definition Registry, Devtools Store Snapshot Detachment, Devtools
Serialization Policy, DB Collection Contract Module, DB Collection Registry
Locality, DB Collection Snapshot Codec, Start callable manifest entry
assembly/deserialization, Start App Graph Diagnostics Runtime, and Start File
Route Path Decoder.

## Review 11: Start File Route Segment Parser Follow-Up

Status: fixed for the Start File Route Path Decoder finding.

1. Start File Route Segment Parser
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/start/src/file-route-segments.ts`,
     `packages/start/src/file-routes.ts`,
     `packages/start/test/file-routes.test.ts`.
   - Problem: file-route segment parsing existed in two forms: sync route
     discovery used an undefined/ignored return shape, while Effect manifest
     generation represented invalid dynamic params as typed
     `FileRouteManifestInvalidSegment` errors. The sync path could treat a
     malformed `$123` segment as static when producing a route manifest entry.
   - Fix: `file-route-segments.ts` now owns one parser that classifies ignored
     route groups/pathless segments, valid static/dynamic segments, and invalid
     dynamic param names. Sync route discovery drops invalid routes, while
     Effect manifest generation converts the same parse result into the typed
     manifest error.
   - Benefits: file-route path decoding has one Locality point, and sync
     discovery plus Effect manifest generation cannot drift on malformed
     dynamic param semantics.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/file-routes.test.ts packages/start/test/start.test.ts`
     passed: 2 files / 71 tests.

Follow-up candidates queued at this point, with later reviews resolving most of
them: Core Definition Registry, Devtools Store Snapshot Detachment, Devtools
Serialization Policy, DB Collection Contract Module, DB Collection Registry
Locality, DB Collection Snapshot Codec, Start callable manifest entry
assembly/deserialization, and Start App Graph Diagnostics Runtime.

## Review 12: Core Action Submission Controller Follow-Up

Status: fixed for the Core Action Submission Controller finding.

1. Core Action Submission Controller
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/core/src/action.ts`,
     `packages/core/test/action.test.ts`.
   - Problem: `Action.use(...)` scattered submission versioning, current fiber
     ownership, visible state mutation, invalidation-plan mutation, stale
     checks, and reset interruption across the submit workflow. That made it
     easy for stale parallel completions to mutate the visible invalidation
     plan independently from the visible success state, and optimistic signal
     patches applied during an interrupted optimistic Effect had no local
     rollback owner until the optimistic callback returned.
   - Fix: `action.ts` now has an internal Action Submission Controller that
     owns submission identity, latest/exhaust/parallel coordination, current
     fiber tracking, state transitions, invalidation-plan updates, stale
     interruption checks, and reset coordination behind the existing public
     `Action.use(...)` Interface. The workflow now acquires the optimistic
     transaction rollback before running user optimistic work.
   - Benefits: Action submission coordination now has one Locality point while
     callers keep the same Interface. The regression tests exercise the
     Interface behavior directly: interrupted optimistic work rolls back
     transaction patches, and stale parallel successes still run their
     invalidations without replacing the latest visible invalidation plan.
   - Evidence: `pnpm --filter @effect-ui/core typecheck` passed,
     `pnpm exec vitest run packages/core/test/action.test.ts` passed:
     1 file / 20 tests, and
     `pnpm exec vitest run packages/core/test` passed: 12 files / 108 tests.

Follow-up candidates queued at this point, with later reviews resolving most of
them: Core Definition Registry, Devtools Store Snapshot Detachment, Devtools
Serialization Policy, DB Collection Contract Module, DB Collection Registry
Locality, DB Collection Snapshot Codec, Start callable manifest entry
assembly/deserialization, and Start App Graph Diagnostics Runtime.

## Review 13: Start Client Facade Follow-Up

Status: fixed for Start client facade depth in this pass.

1. Start RPC Client And Action Client Modules
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/start/src/index.ts`,
     `packages/start/src/start-rpc-client.ts`,
     `packages/start/src/start-action-client.ts`,
     `packages/start/test/rpc.test.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: the Start root facade still implemented RPC-backed
     `ServerClient` creation, browser RPC Layer construction, action transport
     submission, and stateful `StartAction.use(...)`. Those are real client
     Modules with fetch resolution, transport failure classification, schema
     encode/decode, hydration, and action concurrency behavior; keeping them in
     the root made the root Interface shallow.
   - Fix: `start-rpc-client.ts` owns the Start RPC Client, including
     `makeRpcClient`, `makeRpcClientLayer`, and `BrowserRpcLive`.
     `start-action-client.ts` owns `submitStartActionEffect` and the
     stateful `StartAction` namespace. The Start root now re-exports those
     public Interfaces.
   - Benefits: client transport behavior has focused Locality while preserving
     root import leverage. Future RPC/action client changes can be tested and
     reviewed without editing the whole Start root facade.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/rpc.test.ts packages/start/test/start.test.ts packages/start/test/file-routes.test.ts`
     passed: 3 files / 78 tests.

Follow-up candidates queued at this point, with later reviews resolving most of
them: Core Definition Registry, Devtools Store Snapshot Detachment, Devtools
Serialization Policy, DB Collection Contract Module, DB Collection Registry
Locality, DB Collection Snapshot Codec, Start callable manifest entry
assembly/deserialization, and Start App Graph Diagnostics Runtime.

## Review 14: DB Snapshot And Devtools Serialization Follow-Up

Status: fixed for DB Collection Snapshot Codec, Devtools Store Snapshot
Detachment, and Devtools Serialization Policy findings.

1. DB Collection Snapshot Codec
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-mutation-queue.ts`,
     `packages/db/src/collection-state.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: collection row snapshot cloning, pending mutation snapshot
     conversion, hydration validation, JSON encoding/decoding, and live-query
     collection snapshot creation were spread across runtime, state,
     persistence, mutation queue, and live-query adapter Modules.
   - Fix: `collection-snapshot-codec.ts` now owns snapshot validation,
     cloning, pending mutation conversion, JSON encode/decode, hydration state
     application, and live-query collection snapshot construction helpers.
   - Benefits: persistence and hydration seams now have one validation and
     copy policy, which improves Locality for snapshot format changes and
     keeps persisted data from leaking unchecked shapes into Collection State.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and the focused
     multi-package regression suite passed: 7 files / 162 tests.

2. Devtools Serialization Policy And Store Snapshot Detachment
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: Devtools serialization did not have an explicit bounded policy
     for deep, wide, long, circular, accessor, Map/Set, Error, and detached
     runtime values. Store record/read seams could retain caller-owned object
     references, allowing later caller mutation to rewrite recorded facts.
   - Fix: `serialization.ts` now owns a bounded serialization policy and
     detached copy helpers for invalidation plans, route plans, request traces,
     runtime events, app graph diagnostics, and snapshots. `store.ts` uses
     those helpers at set/get/record seams.
   - Benefits: Devtools inspection values stay JSON-safe and bounded, and Store
     facts are detached from caller-owned values before summary or causal graph
     projection.
   - Evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and the
     focused multi-package regression suite passed: 7 files / 162 tests.

3. Start App Graph Nested Route Revalidation
   - Status: covered.
   - Files: `packages/start/test/app-graph.test.ts`.
   - Problem: app graph deserialization depends on nested file-route manifest
     facts staying internally consistent. Without regression coverage, a
     future deserializer could accept route module routePath values that no
     longer match their decoded segments.
   - Fix: added a regression test that corrupts a serialized graph's nested
     route module path and verifies deserialization fails through the typed
     file-route manifest parse error.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and the
     focused multi-package regression suite passed: 7 files / 162 tests.

Follow-up candidates queued at this point, with later reviews resolving them:
Core Definition Registry, DB Collection Contract Module, DB Collection Registry
Locality, Start callable manifest entry assembly/deserialization, and Start App
Graph Diagnostics Runtime.

## Review 15: Shared Submission, DB Contract, And Manifest Decode Follow-Up

Status: fixed for the highest-confidence Action, DB, and Start follow-up
findings in this pass.

1. Shared Action Submission Controller
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/core/src/action-submission.ts`,
     `packages/core/src/action.ts`,
     `packages/start/src/start-action-client.ts`,
     `packages/core/test/action.test.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: Core `Action.use(...)` and Start `StartAction.use(...)` still
     carried parallel submission state machines: submission versioning, current
     fiber ownership, stale interruption, state transitions, invalidation plan
     updates, and reset interruption. That duplicated a behavioral seam where
     small drift can become stale UI state or missed interruption.
   - Fix: `action-submission.ts` now owns the generic Action Submission
     Controller, including visible state, invalidation signal, concurrency
     decisions, stale checks, pending/success/failure transitions, and reset.
     Core Actions and Start Actions both delegate their client state machines
     to that controller while keeping their domain workflows local.
   - Benefits: action submission concurrency now has one Interface and one
     Locality point across local Core actions and transport-backed Start
     actions.
   - Evidence: `pnpm --filter @effect-ui/core typecheck`,
     `pnpm --filter @effect-ui/start typecheck`, and
     `pnpm exec vitest run packages/core/test/action.test.ts packages/start/test/start.test.ts`
     passed: 2 files / 77 tests.

2. DB Collection Contract And Registry
   - Status: fixed.
   - Files: `CONTEXT.md`,
     `packages/db/src/collection-contract.ts`,
     `packages/db/src/collection-registry.ts`,
     `packages/db/src/index.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/live-query-collection.ts`.
   - Problem: the DB root facade still owned Collection contract types and the
     process-wide Collection registry, while internal DB Modules imported
     those root types. That made the root too deep and made registry
     diagnostics look like facade behavior instead of collection infrastructure.
   - Fix: `collection-contract.ts` owns Collection Definition, row, mutation,
     snapshot, persistence, store-event, diagnostics, and related public
     contracts. `collection-registry.ts` owns registration, definitions, and
     diagnostics. Internal DB Modules now import collection contracts directly,
     and the root re-exports the public Interface.
   - Benefits: the DB root is closer to a facade, while Collection contracts
     and diagnostics have stable local Modules for future adapter and devtools
     work.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts packages/db/test/persisted-options.test.ts packages/db/test/sqlite-persistence.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 4 files / 48 tests.

3. Typed DB Snapshot Codec Errors
   - Status: fixed.
   - Files: `packages/db/src/collection-contract.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/index.ts`,
     `packages/start/src/hydration.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: snapshot validation existed, but invalid persisted JSON still
     escaped through `Effect.sync(...)` as a defect. Direct hydrate and
     hydrate-payload paths had the same issue. Persistence and hydration
     decode errors should be typed Effect failures because callers can repair
     storage, clear a key, or surface guidance.
   - Fix: snapshot encode/decode now use typed
     `CollectionSnapshotCodecError` failures. Collection persistence,
     direct hydrate, hydrate-payload, preload/refetch/write/mutation/persist,
     and restore APIs expose that error channel where snapshot storage or
     hydration payloads can be touched. Start hydration Effects preserve the
     typed collection hydration error channel at direct hydration seams.
   - Benefits: corrupted persisted collection state is now recoverable through
     normal Effect error handling instead of defect handling, including SSR or
     browser hydration payloads.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and the DB
     persistence-focused test suite passed: 4 files / 51 tests.

4. Start Callable Manifest Deserialization Core
   - Status: fixed.
   - Files: `packages/start/src/manifest-entry-core.ts`,
     `packages/start/src/server-function-manifest.ts`,
     `packages/start/src/action-manifest.ts`,
     `packages/start/test/action-manifest.test.ts`,
     `packages/start/test/server-function-manifest.test.ts`.
   - Problem: action and server-function manifests already shared entry
     assembly helpers, but deserialization still duplicated JSON parsing,
     version/path validation, server/wire/client identity validation, import
     reference validation, and entry iteration.
   - Fix: Manifest Entry Core now owns typed JSON parsing, versioned manifest
     payload decoding, and common callable entry decoding. Server-function and
     action manifests supply their transport path field, transport client tag,
     branded id function, and domain-specific behavior fields.
   - Benefits: the Manifest Wall has one deserialization grammar for callable
     artifacts, which reduces drift between server-function RPC clients and
     progressive action clients.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/action-manifest.test.ts packages/start/test/server-function-manifest.test.ts`
     passed: 2 files / 12 tests.

5. Start Action Stale Hydration Guard
   - Status: fixed.
   - Files: `packages/start/src/start-action-client.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: `StartAction.use(...)` called the public submit helper, which
     hydrates action responses before stale-submission checks. Under `parallel`
     concurrency, and under non-interruptible `latest` transports, stale
     responses could still mutate Resource or Collection hydration state.
   - Fix: the Start client now has an internal transport-only submission Effect
     that returns the decoded result and response body. The public
     `submitStartActionEffect(...)` still hydrates immediately, while
     stateful `StartAction.use(...)` checks the submission controller before
     applying hydration side effects.
   - Benefits: stale action responses can still resolve for callers, but only
     the accepted submission updates action state or client hydration state.
   - Evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
     `pnpm exec vitest run packages/start/test/start.test.ts` passed with the
     stale hydration regression.

6. DB Mutation Commit Versus Persistence Failure
   - Status: fixed.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: post-commit persistence ran inside the same `tap`/`catch` region
     as the remote mutation handler. If the handler succeeded but the snapshot
     persistence write failed, Collection Runtime rolled rows back and emitted
     rollback events as if the remote mutation failed.
   - Fix: mutation handler failure is caught before commit. Once the handler
     succeeds, Collection Runtime marks rows synced, dequeues the pending
     mutation, emits commit events, and then runs post-commit persistence. A
     persistence failure can fail the Effect without undoing an already
     committed mutation.
   - Benefits: local state no longer diverges from a successfully committed
     remote mutation because the persistence layer failed after the commit.
   - Evidence: `pnpm --filter @effect-ui/db typecheck` passed, and
     `pnpm exec vitest run packages/db/test/collection.test.ts` passed with the
     post-commit persistence failure regression.

Workspace evidence for this pass: `pnpm typecheck:types` passed, and the
focused cross-package regression run passed: 8 files / 137 tests.

Full verification evidence: escalated `pnpm verify` passed after this tranche:
9 package builds, workspace typecheck, type tests, 40 root test files / 349
tests, devtools-panel verify, devtools-extension verify, basic starter verify,
project-console starter packaging/typecheck/tests/build, and leak scan.

## Review 16: DB Collection Registry Locality Follow-Up

Status: fixed for DB Collection Registry Locality.

1. DB Collection Definition Registry Adapter
   - Status: fixed.
   - Files: `packages/db/src/collection-registry.ts`,
     `packages/db/src/index.ts`,
     `packages/db/test/collection-registry.test.ts`.
   - Problem: the Collection registry was still effectively a module-global
     `Map`. Duplicate definitions silently overwrote earlier entries, tests
     and tools could not create isolated registries, and duplicate diagnostics
     had no local owner.
   - Fix: `collection-registry.ts` now owns a Collection Definition Registry
     Adapter with isolated registry construction, an explicit default adapter,
     registry-local diagnostics, first-registration-wins duplicate handling by
     default, and an opt-in replacement policy. The DB facade preserves
     `Collection.definitions()` and `Collection.diagnostics()` while exposing
     `Collection.makeRegistry`, `Collection.defaultRegistry`, and
     `Collection.registryDiagnostics()`.
   - Benefits: registry behavior now has Locality independent from the DB root
     facade, duplicate collection names are deterministic and inspectable, and
     advanced callers can create an isolated adapter without mutating the
     process-wide default registry.
   - Evidence: `pnpm exec vitest run packages/db/test/collection-registry.test.ts packages/db/test/collection.test.ts`
     passed: 2 files / 36 tests; `pnpm exec vitest run packages/db/test/sync-adapter.test.ts packages/db/test/live-query-collection.test.ts`
     passed: 2 files / 10 tests; and `pnpm exec vitest run packages/db/test`
     passed: 8 files / 64 tests. `pnpm --filter @effect-ui/db typecheck`
     passed.

## Review 17: Core Registry, Start Runtime Diagnostics, And Error Defaults

Status: fixed for Core Definition Registry, Start App Graph Diagnostics
Runtime, and default generic error type cleanup.

1. Core Definition Registry
   - Status: fixed.
   - Files: `packages/core/src/definition-registry.ts`,
     `packages/core/src/action.ts`, `packages/core/src/server.ts`,
     `packages/core/src/app.ts`, `packages/core/test/definition-registry.test.ts`.
   - Problem: Action and Server function registries were separate module-local
     maps, so app construction could only observe the current globals and could
     not accept an explicit registry snapshot.
   - Fix: Core now has a Definition Registry module that owns action and server
     function registration, lookups, snapshots, and explicit registry assembly.
     `defineApp(...)` captures a registry snapshot by default and accepts an
     explicit registry input for isolated app graphs.
   - Evidence: `pnpm typecheck` passed, and
     `pnpm exec vitest run packages/core/test/definition-registry.test.ts packages/db/test/collection-registry.test.ts packages/db/test/collection.test.ts packages/start/test/app-graph.test.ts packages/start/test/start.test.ts`
     passed: 5 files / 112 tests.

2. Start App Graph Diagnostics Runtime
   - Status: fixed.
   - Files: `packages/start/src/app-graph.ts`,
     `packages/start/test/app-graph.test.ts`.
   - Problem: generated/static app graph diagnostics could not be rebuilt from
     runtime route module candidates, so runtime-only schema/preload evidence
     and policy exceptions had no single owner.
   - Fix: Start App Graph now describes runtime diagnostics from route module
     candidates, recomputes unknown preload-resource/collection facts from
     those runtime facts, and exposes a policy exception carrying diagnostics
     plus violations.
   - Evidence: included in the focused 5-file registry/app-graph/start run
     above.

3. Default Error Generics
   - Status: fixed for package default generic error parameters.
   - Files: Core Action/Resource/Server/Form/Signal/EffectInput APIs, DB
     Collection/Sync/Server/SQLite/LiveQuery APIs, Solid DB hooks, Start action
     result inference, and public type tests.
   - Problem: omitted generic error parameters defaulted to `unknown`, making
     otherwise infallible definitions look like they could fail with anything.
   - Fix: default generic error parameters now use `never`. Type tests now make
     errorful collection adapters explicit when partial generic arguments would
     otherwise hide the error channel.
   - Evidence: `pnpm typecheck` passed. Public type tests passed after the
     registry and default-error cleanup, including server collection and live
     query collection helper surfaces.

Full verification evidence: escalated `pnpm verify` passed after this tranche:
9 package builds, workspace typecheck, type tests, 42 root test files / 361
tests, devtools-panel verify, devtools-extension verify, basic starter verify,
project-console starter packaging/typecheck/tests/build, and leak scan.

Historical follow-up candidate from this pass: Start host-boundary error
wrappers for request handlers, fetch hooks, Vite/CLI diagnostics loaders, and
adapter handler Effects. Review 19 fixed that candidate. The Thirty-Sweep Gate
is still not satisfied because later passes still found and fixed new work.

## Review 18: Effect-First And Documentation Reconciliation

Status: fixed for the EffectInput Promise inference gap and docs drift found by
the follow-up audit.

1. EffectInput Promise Inference Guard
   - Status: fixed.
   - Files: `packages/core/src/effect-like.ts`,
     `packages/core/src/action.ts`, `packages/core/src/server.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: `Action.define(...)` and `Server.fn(...)` rejected explicitly typed
     Promise callbacks, but unannotated callbacks could infer their output type
     as `Promise<T>` and satisfy the value branch of `EffectInput`. The helper
     also had a `never extends A` conditional-type trap that made Promise-like
     return values look assignable after `EffectInputValue<Promise<T>>`
     collapsed to `never`.
   - Fix: `EnsureEffectInput` and `EnsureEffectInputValue` now reject
     Promise-like output before value compatibility checks. `Action.define(...)`
     and `Server.fn(...)` infer the raw callback return and intersect it with
     that guard, and type tests cover unannotated Promise-returning action and
     server-function callbacks.
   - Benefits: Promise work must be adapted explicitly at host seams with
     Effect, rather than hiding behind inferred action or server-function
     success types.

2. Effect-First Promise Method Audit
   - Status: clean.
   - Files: `packages/`, `examples/`, `scripts/`, `type-tests/`.
   - Problem: the previous user review specifically rejected Promise-based
     coordination in library and type-test code where `Effect.all(...)` and
     Effect fibers can express the same work.
   - Fix: no source edits were needed in this pass because the broad audit found
     no `Promise.all`, `Promise.race`, `Promise.resolve`, `new Promise`,
     `.then(...)`, or `.finally(...)` hits across checked source, examples,
     scripts, and type tests.
   - Evidence: `rg -n "Promise\\.all|Promise\\.race|Promise\\.resolve|new Promise|\\.then\\(|\\.finally\\(" packages examples scripts type-tests -g '*.ts' -g '*.tsx' -g '*.mjs'`
     reported no hits.

3. Architecture Documentation Locality
   - Status: fixed.
   - Files: `CONTEXT.md`, `docs/architecture-deepening-review.md`,
     `docs/effect-first-audit.md`, `docs/perfection-progress.md`,
     `docs/release-notes.md`.
   - Problem: older review sections still described candidates as queued after
     later reviews had resolved them, `CONTEXT.md` under-described the explicit
     Collection Registry and runtime app-graph diagnostics Modules, and the
     Effect-first audit still carried historical wording about raw Promise
     helpers in adapter tests.
   - Fix: the domain vocabulary now describes the Collection Registry adapter
     seam, Start runtime diagnostics evidence, and Devtools serialization
     contract distinctly. Older queued-candidate lists are marked as historical,
     the Effect-first audit reflects the clean Promise grep, and the progress/
     release notes record the latest full verification gate.
   - Benefits: future architecture reviews get better Locality from the docs:
     resolved candidates are not rediscovered as active work, and Promise policy
     evidence matches the current Effect-first code.

Workspace evidence for this pass: `pnpm typecheck` passed, root tests passed:
43 files / 365 tests, and escalated `pnpm verify` passed: 9 package builds,
workspace typecheck, type tests, 43 root test files / 365 tests,
devtools-panel verify, devtools-extension verify, basic starter verify,
project-console starter packaging/typecheck/tests/build, and leak scan.

## Review 19: EffectInput, Registry Adapter, And Host-Seam Follow-Up

Status: fixed for the additional subagent findings around Promise-shaped
EffectInput values, Start diagnostics policy validation, Core registry duplicate
diagnostics, Start file-route discovery, Solid resource suspense locality, and
Start host-boundary typed errors.

1. EffectInput Promise Guard
   - Status: fixed.
   - Files: `packages/core/src/effect-like.ts`,
     `packages/core/test/effect-like.test.ts`.
   - Problem: public type helpers rejected Promise-returning callbacks, but the
     deepest `toEffect(...)` Seam still treated thenables as pure values. A JS
     caller, `any`, or cast could make Promise-shaped work look like successful
     data.
   - Fix: `toEffect(...)` now detects thenables and dies with
     `EffectInputPromiseRejected`, whose guidance points callers to
     `Effect.tryPromise(...)` at the host Adapter Seam.
   - Benefits: all Modules that normalize `EffectInput` get one high-leverage
     guard, so Promise-shaped internals cannot silently enter Action, Resource,
     Server, DB, or Start Implementations as values.

2. Start Diagnostics Policy Effect Seam
   - Status: fixed.
   - Files: `packages/start/src/app-graph.ts`,
     `packages/start/src/start-virtual-modules.ts`,
     `packages/start/test/app-graph.test.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: generated app-graph Modules called a sync throwing diagnostics
     policy helper directly. Typed validation existed, but the generated Vite
     Adapter still owned an ad hoc throw path.
   - Fix: Start App Graph now exposes
     `validateStartAppGraphDiagnosticsPolicyExceptionEffect(...)`, returning
     policy violations or failing with the diagnostics-bearing policy exception.
     The generated Vite module runs that Effect at the sync host boundary.
   - Benefits: diagnostics policy validation is Effect-first and reusable, while
     the Vite Adapter remains the only place that turns a typed policy failure
     into a synchronous build-time throw.

3. Core Definition Registry Adapter
   - Status: fixed.
   - Files: `packages/core/src/definition-registry.ts`,
     `packages/core/src/action.ts`, `packages/core/src/server.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/core/test/definition-registry.test.ts`.
   - Problem: Core Action and Server function registration still used silent
     overwrites, and Start RPC dispatch could fall back from an app registry
     snapshot to later process globals.
   - Fix: Core now has a Definition Registry Adapter with isolated construction,
     duplicate policy, duplicate diagnostics, and default `replace` semantics to
     preserve `Server.client(...)` followed by `Server.implement(...)`. Start RPC
     dispatch uses the app registry snapshot.
   - Benefits: duplicate registration facts have Locality and diagnostics, while
     Start request dispatch no longer observes definitions registered after app
     construction.

4. Start File Route Discovery Effect
   - Status: fixed.
   - Files: `packages/start/src/start-manifest-wall.ts`,
     `packages/start/src/vite.ts`.
   - Problem: route discovery walked the filesystem synchronously in framework
     internals. Permission and read failures crossed the Seam as thrown defects,
     and filesystem behavior was not represented as an Effect Adapter.
   - Fix: `discoverFileRoutesEffect(...)` and
     `withDiscoveredFileRoutesEffect(...)` now own route discovery as typed
     Effects with `FileRouteDiscoveryError`. The old sync functions are facades
     for Vite hooks and other sync host boundaries.
   - Benefits: route discovery has an Effect-first Interface and typed failure
     Locality without removing the sync Vite integration point.

5. Solid Resource Suspense Locality
   - Status: fixed.
   - Files: `packages/core/src/resource-errors.ts`,
     `packages/core/src/resource-runtime.ts`, `packages/core/src/resource.ts`,
     `packages/core/src/read.ts`, `packages/core/test/resource.test.ts`,
     `packages/solid/src/hooks.ts`, `packages/solid/test/router.test.ts`.
   - Problem: Core `Resource.read(...)` still owned the Suspense Promise Seam by
     throwing a host Promise value for missing or GC-expired resources. That made
     the Core Resource Module depend on a UI/host Adapter shape.
   - Fix: Core `Resource.read(...)` is now synchronous and Effect-first: missing
     or expired data throws typed `ResourcePending`, failed data throws
     `ResourceFailure`, and explicit preloading stays in
     `Resource.prefetchEffect(...)`. Solid `useResourceSuspense(...)` is now the
     Adapter that throws the host Suspense Promise from the active runtime.
   - Benefits: Promise locality moves to the Solid UI Adapter, while Core keeps
     its Resource Interface expressed as values, typed errors, and Effects.

6. Start Host Error Contract
   - Status: fixed.
   - Files: `packages/start/src/start-fetch.ts`,
     `packages/start/src/start-request-preload.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/adapters.ts`, `packages/start/src/vite.ts`,
     `packages/start/src/cli.ts`,
     `packages/start/src/start-transport-protocol.ts`.
   - Problem: Start host-facing Interfaces still published raw, untyped host
     failure channels for request preload, request handlers, adapter handlers,
     fetch hooks, and diagnostics loading. That made the
     error Interface as complex as the Implementation and contradicted the
     `never`-by-default error policy.
   - Fix: preload failures now use `StartPreloadError`, request handlers and
     Node/fetch adapters normalize caller failures to `StartRequestHandlerError`,
     fetch hooks default to `never` and map caller failures to
     `ServerTransportError`, Vite/CLI diagnostics loading returns
     `StartAppGraphDiagnosticsLoadError`, and Start action result defaults use
     `never` for omitted validation/domain errors.
   - Benefits: host error behavior now has one typed Seam per Adapter, while raw
     `unknown` remains payload/cause data instead of the public Effect error
     channel.

7. Helper Alias Error Defaults
   - Status: fixed.
   - Files: `packages/core/src/action.ts`, `packages/db/src/sync-adapter.ts`,
     `packages/db/src/collection-runtime.ts`, `packages/db/src/index.ts`,
     `packages/solid/src/router.ts`, `packages/start/src/request-trace.ts`,
     `packages/devtools/src/panels.ts`,
     `packages/devtools/test/devtools.test.ts`, `type-tests/framework.test-d.ts`.
   - Problem: after the direct Effect error-channel cleanup, adjacent helper
     aliases still let `unknown` leak into callback or runtime failure types.
   - Fix: Start request trace handlers no longer accept arbitrary Effect
     failures, `Action.use(...)` runtime error defaults are `never`, Solid
     router preload exposes `Route.PreloadError`, and Collection change-feed
     `emit(...)` exposes collection/write codec errors instead of `unknown`.
     Devtools request panel data now serializes richer teardown snapshots before
     storing them in the panel item data field.
   - Benefits: the typed-error rule now applies consistently across the helper
     Interfaces callers compose with Effect workflows, not only raw
     `Effect.Effect<...>` annotations.

Workspace evidence for this pass: `pnpm typecheck` passed,
`pnpm --filter @effect-ui/core typecheck` passed,
`pnpm --filter @effect-ui/start typecheck` passed,
`pnpm --filter @effect-ui/solid typecheck` passed, and
`pnpm exec vitest run packages/core/test/effect-like.test.ts packages/core/test/definition-registry.test.ts packages/start/test/app-graph.test.ts packages/start/test/start.test.ts`
passed: 4 files / 77 tests. The Start host-boundary follow-up also passed
workspace typecheck/type tests, focused Start/RPC/app-graph tests
(`3` files / `77` tests), the Start adapter suite with localhost binding
permission (`1` file / `7` tests), and the direct `unknown` error-slot grep
over source/type tests. Full `pnpm verify` passed: 9 package builds, workspace
typecheck, type tests, 43 root test files / 365 tests, devtools-panel verify,
devtools-extension verify, basic starter verify, project-console starter
packaging/typecheck/tests/build, and leak scan. The helper-alias follow-up
passed workspace typecheck/type tests, focused DB/Start tests
(`3` files / `100` tests), focused Devtools tests (`1` file / `22` tests), and
the helper-alias unknown-error grep. Full `pnpm verify` passed after this
follow-up: 9 package builds, workspace typecheck, type tests, 43 root test files
/ 366 tests, devtools-panel verify, devtools-extension verify, basic starter
verify, project-console starter packaging/typecheck/tests/build, and leak scan.

## Review 20: Resource Read Boundary, Trace Projection, And Start Docs Follow-Up

1. Core Resource Read Boundary / Solid Suspense Adapter
   - Status: fixed.
   - Files: `packages/core/src/resource-errors.ts`,
     `packages/core/src/resource-runtime.ts`, `packages/core/src/resource.ts`,
     `packages/core/src/read.ts`, `packages/solid/src/hooks.ts`,
     `packages/core/test/resource.test.ts`.
   - Problem: the Core Resource Module still carried a UI-shaped Promise
     Seam for pending reads. The Interface forced callers to know that missing
     data might throw a Suspense Promise even outside a UI Adapter.
   - Fix: Core reads now throw typed `ResourcePending` for missing, pending,
     collected, or GC-expired reads, and typed `ResourceFailure` for failed
     reads. Those error constructors preserve the actual Resource ref
     input/runtime generics. Explicit loading remains
     `Resource.prefetchEffect(...)`. Solid `useResourceSuspense(...)` is now
     the Adapter that converts pending reads into the Suspense Promise expected
     by Solid.
   - Benefits: Promise locality sits at the UI host Seam. Core Resource keeps a
     smaller Effect-first Interface with better leverage for non-Solid callers
     and clearer tests.

2. Solid Router Failure State
   - Status: fixed.
   - Files: `packages/solid/src/router.ts`,
     `packages/solid/test/router.test.ts`, `type-tests/framework.test-d.ts`.
   - Problem: router failure state exposed `error: unknown` even though the
     Implementation gets a concrete `Route.PreloadError` Cause from
     `Route.preloadEffect(...)`.
   - Fix: `BrowserRouterState` now exposes
     `Cause.Cause<Route.PreloadError | ER>` plus an optional first typed
     failure value. Type tests assert the public failure state preserves the
     route preload error Interface.
   - Benefits: route failure handling has typed Locality at the Solid Adapter,
     rather than pushing unknown narrowing into every UI caller.

3. Devtools Request Trace Projection Depth
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/panels.ts`,
     `packages/devtools/src/bridge.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: raw request traces carried teardown snapshots and per-owner
     server/action failures, but the summary and panel Interfaces flattened
     them to a few counts and one top-level failure kind.
   - Fix: summaries and panels now preserve teardown timing, before/after
     Resource Store snapshots, server-function failure owners, action failure
     owners, and detailed trace data. JSDoc was added at the public DTO and
     bridge declaration sites.
   - Benefits: devtools inspection has higher leverage: callers can answer
     which Module failed without falling back to raw event history, and LSP
     hover docs explain the projection contracts.

4. Start Diagnostics, Hydration, And Generated Artifact Contracts
   - Status: fixed.
   - Files: `packages/start/src/virtual-modules.d.ts`,
     `packages/start/src/vite.ts`, `packages/start/src/hydration.ts`,
     `packages/start/test/start.test.ts`,
     `packages/start/test/file-route-modules.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: `diagnosticsPolicyViolations` crossed the virtual-module Seam as
     `unknown[]`, Start hydration error docs lived away from the declarations
     they described, malformed collection hydration needed a Start-level
     regression, and generated app-graph/file-route artifacts had grown past
     fragment-only assertions.
   - Fix: diagnostics policy violations now use the concrete
     `StartAppGraphDiagnosticsPolicyViolation` type in the virtual/Vite
     Interfaces; hydration exports document `StartHydrationError` and the
     payload/chunk helpers at declaration sites; malformed streamed chunks and
     root hydration payloads now fail with typed parse errors in the Effect
     path; Start tests assert malformed collection snapshots fail with
     `CollectionSnapshotCodecError`; generated module tests now include inline
     golden snapshots.
   - Benefits: Start's generated and hydration contracts have better LSP
     discoverability and better review leverage when generated output changes.

5. DB Change Feed And Node Error Hook EffectInput Seams
   - Status: fixed.
   - Files: `packages/db/src/collection-contract.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/sync-adapter.ts`, `packages/db/src/index.ts`,
     `packages/solid-db/src/collection.ts`, `packages/start/src/adapters.ts`,
     `packages/start/test/adapters.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: Collection change-feed `emit(...)`, collection output schema
     validation, and Node server error hooks were helper Interfaces adjacent to
     Effect workflows, but their failure or async contracts still blurred the
     implementation seam.
   - Fix: change-feed `emit(...)` now exposes collection and snapshot-codec
     errors explicitly; collection output schema failures during load, hydrate,
     direct writes, and Solid DB preloads normalize to
     `CollectionSnapshotCodecError`; and Node server error hooks now accept pure
     values or Effects, rejecting Promise-shaped hooks through the same
     EffectInput rule as the rest of the library.
   - Benefits: helper Interfaces now follow the same Effect-first rule as the
     main Modules, increasing Locality around storage/write failures and host
     error handling.

Workspace evidence for this pass: `pnpm --filter @effect-ui/start typecheck`
passed, `pnpm typecheck` passed, `pnpm --filter @effect-ui/db build` passed,
`pnpm exec vitest run packages/start/test/adapters.test.ts` passed, DB focused
tests passed: 5 files / 65 tests, and the focused multi-package regression
suite passed: 7 files / 139 tests. Earlier in the same tranche, the snapshot
update run passed for Start file-route/app-graph virtual module coverage. The
source-only Promise-method and non-Effect `.catch(...)` greps were clean. Full
`pnpm verify` then passed and is recorded as progress checkpoint 254.

## Review 21: LSP Docs And DB Runtime Error Polish

1. LSP-Facing Concept Docs
   - Status: fixed.
   - Files: `packages/core/src/resource-errors.ts`,
     `packages/solid-db/src/collection.ts`,
     `packages/start/src/hydration.ts`,
     `packages/start/src/virtual-modules.d.ts`,
     `packages/devtools/src/index.ts`.
   - Problem: the behavior had improved faster than the hover docs. Resource
     read failures, Solid DB collection handles, Start hydration DOM helpers,
     virtual app graph exports, and Devtools request-panel DTOs all had public
     Interfaces where callers still had to infer important error modes or data
     semantics from Implementation code.
   - Fix: added field-level and helper-level JSDoc at those public Interfaces,
     including `ResourcePending`/`ResourceFailure` payload fields,
     `CollectionRuntimeError`-aware Solid DB accessors, Start hydration chunk
     attributes/readers/hydrators, virtual diagnostics exports, and Devtools
     request trace/panel projection fields.
   - Benefits: the LSP surface now carries the local vocabulary at the actual
     seam callers cross, giving higher leverage than separate prose docs alone.

2. DB Collection Runtime Error Normalization
   - Status: fixed.
   - Files: `packages/db/src/collection-contract.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/src/query-plan.ts`,
     `packages/db/src/sync-adapter.ts`,
     `packages/db/src/index.ts`,
     `packages/solid-db/src/collection.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: stale raw `Schema.SchemaError` annotations could leak back into
     the DB Collection and Query Interfaces even though the runtime behavior
     normalizes output-schema failures to `CollectionSnapshotCodecError`.
   - Fix: restored `CollectionRuntimeError<E>` to `E |
     CollectionSnapshotCodecError`, normalized the snapshot codec Effect error
     mapping, aligned Solid DB collection state/error accessors with
     `CollectionRuntimeError<E>`, and updated the regression test to assert the
     normalized codec error and `reason` text.
   - Benefits: schema validation knowledge has Locality in the Collection
     Snapshot Codec Module instead of spreading raw Effect Schema errors across
     Collection, Query, and Solid Adapter Interfaces.

Workspace evidence for this pass: `pnpm --filter @effect-ui/db build` passed
with before/after DB/Solid DB source checksums unchanged, `pnpm vitest run
packages/db/test/collection.test.ts` passed, and full `pnpm verify` passed:
9 package builds, workspace typecheck, type tests, 45 root test files / 415
tests, devtools-panel verify with 1 panel test, devtools-extension verify with
1 extension test file / 6 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4 project-console
test files / 23 tests, project-console build, and leak scan. The raw DB/Solid
DB schema-error grep plus source Promise-method grep were clean after the full
verification run.

## Review 22: Devtools Start Action Observation Surface

1. Devtools Start Action Error Channel
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/store.ts`, `type-tests/framework.test-d.ts`.
   - Problem: the Devtools Store accepted stateful Start Action instances
     through an observation Interface whose default error channel was too
     narrow. Real Start Action instances expose `Server.ClientError` in their
     visible submission state, but the devtools seam could collapse that slot
     to `never`, making a valid Start Adapter look incompatible with the
     Devtools Store.
   - Fix: made `DevtoolsStartActionInstance` generic over input, result, error,
     and invalidation-plan slots with an observation-safe `unknown` default for
     errors; the store now preserves those generics internally and uses explicit
     `any` aliases only at the untyped facade edge.
   - Benefits: the Devtools Store remains a deep Module for action observation:
     it can record Core Actions and Start Actions through one small Interface
     without lying about their error modes or forcing callers to erase useful
     type information themselves.

Workspace evidence for this pass: `pnpm typecheck` passed after the devtools
surface fix, full `pnpm verify` passed as above, and the Promise/raw-schema
post-verify audits were clean.

## Review 23: Effect Callback Errors And Hydration/Fact Identity Locality

1. DB EffectInput Callback Error Seam
   - Status: fixed.
   - Files: `packages/db/src/collection-contract.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/index.ts`, `packages/db/src/sync-adapter.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/sync-adapter.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: DB loaders, mutation handlers, sync adapters, change-feed
     subscriptions, and persistence callbacks could synchronously throw before
     returning an Effect. The old Adapter implementation cast those thrown
     values into the caller's `E`, so callback defects and declared domain
     failures crossed the same Interface.
   - Fix: route callback execution through `invokeEffectInput(...)` and expose
     `EffectInputCallbackError` in the affected Collection Runtime and
     persistence error channels. Regression tests assert synchronous loader,
     storage, sync load, sync insert, and mutation callback throws preserve the
     original cause inside the typed callback error.
   - Benefits: DB Adapter failures now have Locality at the EffectInput Seam.
     Callers can distinguish declared collection failures from host callback
     defects without catching `unknown`.

2. Devtools Imported Fact Identity
   - Status: fixed.
   - Files: `packages/devtools/src/fact-identity.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: Devtools Store still owned request trace fingerprinting, imported
     id seeding, and id-less `RequestTrace` event pairing even though those are
     Fact Identity policy, not bounded store recording behavior.
   - Fix: moved imported request trace normalization into the Fact Identity
     Module. The Store now receives a normalized snapshot and next trace
     sequence from that deeper Interface, then continues to own recording and
     bounded history.
   - Benefits: fact id repair has better Locality for Store, Summary, and
     Causal Graph maintenance, and Store remains a higher-leverage recording
     Adapter.

3. Start Hydration DOM Adapter
   - Status: fixed.
   - Files: `packages/start/src/hydration-dom.ts`,
     `packages/start/src/hydration.ts`,
     `packages/start/test/start.test.ts`,
     `packages/start/test/streaming.test.ts`,
     `docs/public-api-inventory.md`.
   - Problem: Start Hydration combined payload construction, HTML-safe JSON
     encoding, chunk parsing, DOM script discovery, consumed-marker mutation,
     Resource/Collection hydration, and synchronous host facades in one Module.
     That made the public Interface harder to scan in LSP hovers and kept DOM
     Adapter rules adjacent to wire codec rules.
   - Fix: added a `hydration-dom.ts` Module for script ids, streamed chunk
     marker attributes, minimal document/element Interfaces, raw script reads,
     and consumed marking. `hydration.ts` now re-exports those contracts while
     keeping payload/chunk parsing and Effect-first hydration application.
   - Benefits: Start Hydration has a clearer transport Seam: DOM selection and
     mutation are isolated in one Adapter, while hydration codec and runtime
     application keep their own test surface and docs.

4. DB Build/Verification Guard
   - Status: environment hazard identified.
   - Files: `packages/db/src/*`, `/private/tmp/effect-ui-live-repro`.
   - Problem: while verifying DB error-channel cleanup, raw
     `Schema.SchemaError` annotations reappeared in DB source. A guarded DB
     build reproduced no source mutation from `tsgo`, and a subagent found a
     stale temp worktree plus a separate `codex` process with this repo as cwd.
   - Fix: re-normalized DB source, kept raw schema-error and Promise-method
     greps in the verification loop, and temporarily guarded DB source files
     during broad gates so concurrent stale writers fail loudly.
   - Benefits: the source of truth stays Effect-first, and the verification
     Seam now checks for accidental Promise/raw-schema drift rather than
     trusting package builds alone.

Workspace evidence for this pass: `pnpm --filter @effect-ui/start typecheck`,
`pnpm --filter @effect-ui/devtools typecheck`, `pnpm typecheck`, `pnpm
--filter @effect-ui/db build`, `pnpm --filter @effect-ui/starter-basic build`,
`pnpm vitest run packages/start/test/start.test.ts
packages/start/test/streaming.test.ts`, `pnpm vitest run
packages/devtools/test/devtools.test.ts`, and `pnpm vitest run
packages/db/test/collection.test.ts packages/start/test/adapters.test.ts`
passed. Full `pnpm verify` passed: 9 package builds, workspace typecheck, type
tests, 45 root test files / 420 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 6 tests, basic starter
verify with 1 starter test, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan. The DB/Solid DB raw schema-error grep,
source Promise-method grep, and immutable flag audit were clean after
verification.

## Review 151: Core State Presence, Source Package Gates, And DB/Start Seams

Review151 fixed the next set of fresh sweep findings from the Core, DB, Start,
docs/LSP, and example packaging passes.

1. Generated Starter And Source Package Gates
   - Status: fixed.
   - Files: `scripts/package-project-console-starter.mjs`,
     `scripts/verify-package-dry-runs.mjs`, `docs/starter.md`,
     `docs/example-copyability-and-leak-audit.md`.
   - Problem: generated starter READMEs still described workspace workflows,
     generated starter tarball checks only proved that some local package was
     present, and the package dry-run gate called devtools examples copyable
     even though they remain workspace examples.
   - Fix: generated basic, React, and project-console starter READMEs now use
     standalone commands. Starter tarball dry-runs prove the exact expected
     `.effect-ui-packages/*` directories and required `dist/index.*` files are
     present, and reject unknown/unreferenced local adapters. Devtools panel and
     extension dry-runs are labeled workspace source packages.

2. Core Previous-Value Presence And Runtime Store Hover
   - Status: fixed.
   - Files: `packages/core/src/action-submission.ts`,
     `packages/core/src/resource-ui-binding.ts`, `packages/core/src/runtime.ts`,
     `type-tests/core.test-d.ts`.
   - Problem: `undefined` successful values were indistinguishable from no
     previous action/resource value, and `withResourceStore(...)` was an
     expert-public request-runtime seam without LSP-facing docs/type pins.
   - Fix: action pending/failure state and Resource UI pending/failure metadata
     now carry `hasPrevious`. `withResourceStore(...)` has hover docs and type
     tests that pin the request-local Resource Store Adapter seam.

3. DB/Start Collection Identity And SQLite Row Validation
   - Status: fixed.
   - Files: `packages/db/src/collection-persistence.ts`,
     `packages/db/src/sqlite-persistence.ts`,
     `packages/start/src/start-collection-resolution.ts`,
     `packages/start/src/start-request-preload.ts`,
     `packages/start/src/hydration.ts`, `docs/db.md`.
   - Problem: duplicate collection names could silently select the wrong
     definition during Start preload/hydration, and SQLite statement rows were
     coerced with `String(...)`/`Number(...)` instead of validated at the
     Adapter boundary.
   - Fix: DB hydration planning and Start collection resolution now reject
     duplicate same-name definitions before applying payloads. SQLite statement
     rows fail as `SQLitePersistenceInvalidRow` unless string and finite-number
     fields match the persistence row contract exactly.

4. Start Route Output, Hydration Generics, And Effect RPC Hovers
   - Status: fixed.
   - Files: `packages/start/src/generated-route-definitions.ts`,
     `packages/start/src/start-manifest-wall.ts`,
     `packages/start/src/vite.ts`,
     `packages/start/src/effect-rpc-compat.ts`,
     `type-tests/start.test-d.ts`, `type-tests/start-vite.test-d.ts`.
   - Problem: generated route output could escape the Vite root, the streamed
     hydration sync facade put runtime services in the runtime-error generic,
     and the Effect RPC endpoint/procedure descriptor seam was under-documented.
   - Fix: generated route file writes reject outside-root output paths with
     `FileRouteDefinitionsOutputPathError`. `hydrateStartHydrationChunks(...)`
     now preserves runtime services and runtime errors separately. Effect RPC
     endpoint, procedure, and artifact descriptors carry field-level JSDoc and
     public type pins.

5. Adapter, Package Hygiene, And Docs Coverage
   - Status: fixed.
   - Files: `type-tests/start-adapters.test-d.ts`,
     `type-tests/db.test-d.ts`, `docs/package-hygiene-audit.md`,
     `docs/public-api-inventory.md`, `docs/type-test-coverage-audit.md`.
   - Problem: root Start adapter facade type coverage did not pin low-level
     Node/fetch paths, DB SQLite package-root exports were thinner than docs
     implied, and package hygiene docs omitted React and React-DB direct import
     sweeps.
   - Fix: Start adapter type tests now cover Effect handlers and Node callback
     facade runtime requirements. DB type tests pin package-root SQLite helpers
     and errors. Package hygiene docs name React and React-DB dependencies.

Focused verification passed: Core/DB/Start typechecks, public type tests,
public API audit, Effect-first audit over 259 files, Core action/resource UI
tests 2 files / 38 tests, DB collection/SQLite tests 2 files / 118 tests,
Start tests 1 file / 140 tests, generated starter packaging/verifies at
19/24/30 app files with 5/4/6 local packages, generated README workspace-token
grep, 16-target package dry-run gate, and `git diff --check`. Full `pnpm
verify` passed: 11 package builds, workspace typecheck, public type tests,
public API audit, Effect-first audit over 259 files, 53 root test files / 908
tests, devtools-panel verify with 2 tests, devtools-extension verify with 20
tests, basic starter verify with 2 tests, React starter verify with 3 tests,
generated starter-suite packaging/verifies for basic/react/project-console,
16-target package dry-run gate, project-console typecheck, 4 project-console
test files / 27 tests, project-console build, and leak scan.

## Review 30: Transport Requirements, Resource Load Errors, And Detached Panels

1. Start Action Transport Status And Runtime Locality
   - Status: fixed.
   - Files: `packages/start/src/start-fetch.ts`,
     `packages/start/src/start-rpc-client.ts`,
     `packages/start/src/start-action-client.ts`,
     `packages/start/src/start-transport-protocol.ts`,
     `packages/start/test/start.test.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: Start action clients trusted response body tags even when the HTTP
     status contradicted the semantic body. `StartFetch` also typed only the
     fetch error, so service-backed fetch Effects lost their requirement trail.
   - Fix: action success/failure/redirect bodies now require a 2xx status,
     validation bodies require 422, and server/defect bodies remain
     body-driven. `StartFetch<E, R>` now preserves fetch requirements, with
     `runtime`/`transportRuntime` options for service-backed transports.
   - Benefits: clients no longer accept impossible action responses, and LSP
     hover types show where transport services must be provided.

2. Resource Load Error And Provides Callback Policy
   - Status: fixed.
   - Files: `packages/core/src/resource.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-lifetime.ts`,
     `packages/core/src/resource-dependency-graph.ts`,
     `packages/core/src/resource-errors.ts`, `packages/core/test/resource.test.ts`,
     `packages/solid/src/hooks.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: public Resource state/status and Solid handles still advertised
     only the user load error `E`, even though synchronous `load` callback
     throws already became `EffectInputCallbackError`. `provides(...)` callback
     throws were still outside that policy.
   - Fix: introduced the documented `Resource.LoadError<E>` surface for
     Resource state, status, preload, refresh, and Solid resource handles.
     `provides(...)` now runs through the same callback error seam as `load`.
   - Benefits: Resource hover docs now match runtime behavior, and tag-index
     callback failures are typed Effect failures instead of defects.

3. Query And Collection Store Locality
   - Status: fixed.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/src/query-builder.ts`, `packages/db/src/query-plan.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/test/collection.test.ts`, `type-tests/framework.test-d.ts`.
   - Problem: `Query.onceEffect(...)` preloaded from the Effect-provided
     Collection Store but then evaluated through synchronous collection reads
     that could fall back to the ambient runtime store. Multi-collection
     dehydration/hydration also had store parameters that were not consistently
     used by the snapshot helpers.
   - Fix: one-shot query evaluation now runs under an explicit Collection Store
     override captured from `collectionStoreEffect`, and collection hydration
     payload helpers pass the active store all the way to snapshot/hydrate
     internals while definition-owned snapshot collections keep their own
     snapshot Interface.
   - Benefits: two runtimes can safely share Collection Definitions without
     one-shot query or hydration payload leakage.

4. Flush And SQLite Callback Error Channels
   - Status: fixed.
   - Files: `packages/db/src/flush-policy.ts`,
     `packages/db/src/sqlite-persistence.ts`,
     `packages/db/src/sync-adapter.ts`,
     `packages/db/test/flush-policy.test.ts`,
     `packages/db/test/sqlite-persistence.test.ts`,
     `type-tests/framework.test-d.ts`, `docs/public-api-inventory.md`.
   - Problem: flush skip predicates, background sync readiness predicates, and
     SQLite persistence callbacks could throw synchronously before entering the
     public Effect error channel. Resource-backed collection sync adapters also
     hid the widened Resource load error.
   - Fix: those predicates and SQLite callbacks now run through
     `EffectInputCallbackError` normalization. Resource-backed collection sync
     adapters expose `Resource.LoadError<E>` for load/refetch.
   - Benefits: DB host and persistence adapters have one callback policy, and
     LSP users see the real error channel before wiring storage or sync.

5. Detached Devtools Panel Payloads
   - Status: fixed.
   - Files: `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/src/serialization.ts`, `packages/devtools/src/index.ts`,
     `packages/devtools/test/devtools.test.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: panel bridge normalization validated inspected-window objects but
     returned references to those live objects. Later renderer reads could still
     trip getters, proxies, or mutated arrays. The serialization policy type was
     also implemented but not exported as public LSP vocabulary.
   - Fix: panel bridge normalization now returns detached DTOs, array/property
     reads are trap-safe, host object probes in serialization use guarded
     fallbacks, and `DevtoolsSerializationPolicy` is exported and type-tested.
   - Benefits: extension panels can render normalized payloads without touching
     hostile inspected-window objects, and users can hover the serialization
     limits that shape runtime values.

6. Generated Route Default Export Docs
   - Status: fixed.
   - Files: `packages/start/src/file-route-modules.ts`,
     `packages/start/test/file-route-modules.test.ts`,
     `examples/basic-starter/src/routeTree.gen.ts`,
     `examples/project-console/src/routeTree.gen.ts`.
   - Problem: the generated route artifact had rich hover docs for maps and
     helper types, but the default export still appeared as a bare export.
   - Fix: the generator now emits JSDoc for the default route-tree export, and
     generated example artifacts plus inline snapshots were updated.
   - Benefits: the written app-specific route tree is consistently documented
     across named and default imports.

Focused workspace evidence for this pass: `pnpm --filter
@effect-ui/core typecheck`, `pnpm --filter @effect-ui/db typecheck`, `pnpm
--filter @effect-ui/devtools typecheck`, `pnpm --filter @effect-ui/start
typecheck`, `pnpm --filter @effect-ui/solid typecheck`, `pnpm typecheck:types`,
`pnpm test packages/start/test/start.test.ts`, `pnpm test
packages/start/test/file-route-modules.test.ts`, `pnpm test
packages/db/test/collection.test.ts`, `pnpm test
packages/db/test/live-query-collection.test.ts`, `pnpm test
packages/db/test/flush-policy.test.ts packages/db/test/sqlite-persistence.test.ts`,
`pnpm test packages/devtools/test/devtools.test.ts`, `pnpm test
examples/devtools-extension/src/extension.test.ts packages/devtools/test/devtools.test.ts`,
and `pnpm test packages/core/test/resource.test.ts` passed. Full `pnpm verify`
passed: 9 package builds, workspace typecheck, type tests, 45 root test files /
454 tests, devtools-panel verify with 1 panel test, devtools-extension verify
with 1 extension test file / 7 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4 project-console
test files / 23 tests, project-console build, and leak scan. Post-verify raw
schema-error, Promise-method, immutable flag, ResourceFamily live-store,
sync-load closure, runtime Promise docs, and whitespace audits passed.

## Review 37: Start Hydration Transport Effect-First Implementation

Status: fixed.

Findings:

1. Start Hydration Transport Sync/Effect Duplication
   - Status: fixed.
   - Files: `packages/start/src/hydration.ts`,
     `packages/start/test/start.test.ts`, `docs/public-api-inventory.md`,
     `CONTEXT.md`.
   - Problem: Start Hydration exposed Effect-first helpers, but private JSON
     parsing, payload/chunk decoding, and HTML-safe serialization still had
     parallel throwing and Effect implementations. That left the transport
     policy split between sync code and Effect code, even though the
     synchronous APIs are only browser/host-boundary conveniences.
   - Fix: made payload decoding, streamed chunk decoding, JSON parsing, and
     HTML-safe encoding flow through Effect-first helpers. The synchronous
     serialization and read APIs now unwrap those same Effects at the host
     boundary and throw the original tagged transport failures directly.
     Runtime-dependent hydration facades still run through the Runtime Spine.
   - Benefits: root document hydration and streamed hydration chunks now share
     one transport policy for parse, decode, encode, ordering, and typed
     failures. LSP-facing docs now describe the sync helpers as facades over
     Effect-first transport behavior instead of separate implementations.

Focused evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
`pnpm vitest run packages/start/test/start.test.ts
packages/start/test/streaming.test.ts` passed with 2 files / 86 tests. Added
regressions for sync serialization failures preserving
`StartHydrationPayloadSerializeError`, malformed streamed chunk sync failures
preserving sequence/value details, and legacy streamed root payloads decoding
through the sync facade. Full `pnpm verify` passed after this pass: 9 package
builds, workspace typecheck, type tests, effect-first source audit, 45 root
test files / 456 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 7 tests, basic starter
verify with 1 starter test, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan.

## Review 41: Devtools Summary Input Normalization Locality

Status: fixed.

Findings:

1. Devtools Summary Input Normalization Repetition
   - Status: fixed.
   - Files: `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/summary.ts`,
     `packages/devtools/src/causal-graph.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: `describeDevtoolsSummary(...)` and
     `describeDevtoolsCausalGraph(...)` independently resolved
     `DevtoolsSummaryInput` overrides against snapshots, defaulted optional
     arrays, summarized invalidations, route plans, request traces, runtime
     events, and derived resource indexes. That made the summary and causal
     graph projections share behavior by copy/paste instead of a named Module.
   - Fix: added `normalizeDevtoolsSummaryInput(...)` in `summary-facts.ts`.
     Summary and causal graph helpers now consume the same normalized facts,
     while `makeDevtoolsCausalGraph(...)` remains unchanged as the lower-level
     graph builder.
   - Benefits: input override precedence, summary indexes, request trace
     summaries, runtime event ordering, and resource index derivation now have
     one Locality before they feed summaries, panels, and causal graphs.

Focused evidence: `pnpm --filter @effect-ui/devtools typecheck` passed, and
`pnpm vitest run packages/devtools/test/devtools.test.ts` passed with 1 file /
26 tests. Full `pnpm verify` passed after this pass: 9 package builds,
workspace typecheck, type tests, effect-first source audit, 45 root test files
/ 457 tests, devtools-panel verify with 1 panel test, devtools-extension verify
with 1 extension test file / 7 tests, basic starter verify with 1 starter
test, project-console starter packaging, project-console typecheck, 4
project-console test files / 23 tests, project-console build, and leak scan.

## Review 42: Start/Devtools Invalidation Structural Contract

Status: accepted as intentional.

Findings:

1. Start Action Invalidation DTO And Devtools Invalidation DTO
   - Status: accepted.
   - Files: `packages/start/src/start-transport-protocol.ts`,
     `packages/devtools/src/index.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `docs/type-test-coverage-audit.md`,
     `CONTEXT.md`.
   - Problem considered: `StartActionInvalidationPlan` and
     `DevtoolsInvalidationPlan` share the same structural DTO shape, which can
     look like duplicated ownership.
   - Decision: keep the DTOs separate and structurally compatible. Start owns
     action transport metadata, Devtools owns detached inspection metadata, and
     `serializedInvalidationPlan` is the dependency-free bridge between them.
     A shared type would either couple Start to Devtools, couple Devtools to
     Start, or move inspection-shaped transport data into Core.
   - Benefits: full-stack action causality can flow into devtools while package
     dependencies stay acyclic and intentional. Type tests now pin assignability
     in both directions so future DTO growth has an explicit contract check.

Focused evidence: `pnpm typecheck:types` passed after the reverse structural
assignability assertion was added.

## Review 43: Queued Architecture Candidate Decisions

Status: accepted as intentional.

Findings:

1. Collection Mutation Runtime Module
   - Status: accepted.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-mutation-queue.ts`,
     `packages/db/test/collection.test.ts`, `docs/public-api-inventory.md`.
   - Problem considered: optimistic mutation execution and pending flush replay
     could be extracted from Collection Runtime into a separate Mutation Runtime
     Module.
   - Decision: keep execution in Collection Runtime. Mutation execution needs
     active Collection Store lookup, projection callback normalization, schema
     validation, rollback rows, retry attempts, persistence, and event
     publication together. `collection-mutation-queue.ts` remains the narrow
     queue fact/state helper for transaction ids, attempts, enqueue/dequeue, and
     snapshot helpers.
   - Benefits: mutation policy remains runtime/request-local without exporting a
     wider private helper surface.

2. Collection Direct Write And Change Batch Module
   - Status: accepted.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/src/sync-adapter.ts`, `packages/db/test/collection.test.ts`,
     `packages/db/test/sync-adapter.test.ts`,
     `docs/public-api-inventory.md`.
   - Problem considered: direct writes and change-feed batch application could
     move into a separate write Module.
   - Decision: keep direct writes and batch application in Collection Runtime.
     They mutate Collection Store rows, secondary indexes, row metadata,
     persistence state, event publication, and live-query-visible versions in one
     transaction-shaped locality. Sync adapters own subscription and emit
     batches; they do not own store mutation policy.
   - Benefits: adapters stay host-facing, while store mutation behavior remains
     under the runtime/request-local Collection Runtime policy.

3. SQLite Statement Adapter Locality
   - Status: accepted.
   - Files: `packages/db/src/sqlite-persistence.ts`,
     `packages/db/test/sqlite-persistence.test.ts`, `docs/db.md`,
     `docs/public-api-inventory.md`.
   - Problem considered: statement, prepared-statement, and memory SQLite
     helpers might deserve separate files or package boundaries.
   - Decision: keep them colocated as one dependency-free SQLite persistence
     helper family. The memory adapter is the reference implementation for the
     generated statement-driver SQL, and public access stays through the DB root
     and `Collection.sqlite*` helpers.
   - Benefits: storage-adapter docs, tests, and LSP hovers present one coherent
     composition chain without implying a dependency on any SQLite runtime.

4. Solid Router Location Adapter
   - Status: accepted.
   - Files: `packages/solid/src/router.ts`,
     `packages/solid/test/router.test.ts`, `docs/public-api-inventory.md`.
   - Problem considered: browser `location`, `history`, and `popstate`
     adaptation might be mixed too deeply into Solid router state.
   - Decision: keep browser location/history behavior inside the Solid browser
     router Adapter. `createBrowserRouter(...)` and `RouterProvider` already own
     route preload, state updates, and route scope lifecycle at the Solid host
     boundary; Core remains the route definition, match, and href-building owner.
   - Benefits: host browser mechanics stay outside Core without creating a thin
     extra abstraction inside the same Solid adapter package.

5. Devtools Store Sync Facades
   - Status: accepted.
   - Files: `packages/devtools/src/store.ts`,
     `packages/devtools/src/index.ts`, `packages/devtools/test/devtools.test.ts`,
     `docs/devtools.md`, `docs/public-api-inventory.md`.
   - Problem considered: Devtools Store exposes sync methods next to Effect-first
     implementation methods.
   - Decision: keep the sync methods on the store object as host-boundary
     facades over the same Effect implementation methods. The store Module owns
     the runtime and state; a separate facade would duplicate the public surface
     without reducing coupling.
   - Benefits: framework internals and tests can keep using Effect methods, while
     host adapters still get plain sync reads/writes from the same bounded store.

Focused evidence: read-only subagents inspected each candidate and found no
smaller code extraction that would improve Module, Interface, Seam, Adapter, or
Locality ownership. Docs were updated so these accepted boundaries are less
likely to be re-queued.

## Review 44: DB/Solid/Start Typed Surface Follow-Up

Status: fixed.

Findings:

1. Collection Flush Policy Runtime Error Channel
   - Status: fixed.
   - Files: `packages/db/src/flush-policy.ts`,
     `packages/db/src/collection-contract.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `docs/db.md`.
   - Problem: `FlushCollectionsPendingMutationsError` named only collection
     handler errors, skip errors, and callback errors even though it yields
     `collection.flushPendingMutationsEffect()`, whose public Interface can also
     fail with `CollectionSnapshotCodecError`.
   - Fix: widened the coordination error alias to
     `CollectionRuntimeError<CollectionError<...>>`, updated stale hover docs so
     output-schema failures are described as snapshot codec failures, and pinned
     flush/background-sync error channels in type tests.
   - Benefits: multi-collection flush and background sync now tell the same error
     truth as single-collection mutation flushing.

2. Solid DB Owner-Scoped Automatic Preload
   - Status: fixed.
   - Files: `packages/solid-db/src/shared.ts`,
     `packages/solid-db/test/solid-db.test.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`.
   - Problem: automatic `useCollection(...)` / `useLiveQuery(...)` preloads were
     forked and then detached from Solid owner cleanup, so a slow preload could
     outlive its component owner and report a late failure.
   - Fix: retained the preload fiber and interrupted it during owner cleanup
     alongside collection source unsubscriptions. Added a regression with a
     never-completing preload that proves disposal interrupts the fiber and does
     not call `onPreloadFailure`.
   - Benefits: Solid DB's Reactive Binding Module now owns both mount-time
     preload execution and owner cleanup as one lifecycle.

3. Solid Router Outlet And Hook Type Coverage
   - Status: fixed.
   - Files: `packages/solid/src/router.ts`, `packages/solid/test/router.test.ts`,
     `type-tests/framework.test-d.ts`, `docs/public-api-inventory.md`,
     `docs/type-test-coverage-audit.md`.
   - Problem: `RouterProviderProps` carried the route tuple, but
     `RouterOutletProps` widened pending/failure renderer state back to
     `AnyRoute`, and the public Solid type tests barely pinned the router/hooks
     surface.
   - Fix: made `RouterOutletProps` preserve route-specific state while keeping
     the existing error-first generic form for broad renderers. Type tests now
     cover typed browser router href/navigation/preload, route-specific outlet
     matches, Solid resource handles, and Solid action input/output preservation.
   - Benefits: LSP hover and callback inference now keep route params/search
     precise through outlet fallback renderers.

4. Generated Route Definitions Typed Generation Failures
   - Status: fixed.
   - Files: `packages/start/src/file-route-modules.ts`,
     `packages/start/src/generated-route-definitions.ts`,
     `packages/start/src/start-virtual-modules.ts`,
     `packages/start/src/vite.ts`,
     `packages/start/test/file-route-modules.test.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`.
   - Problem: the generated route file writer and virtual route module exposed
     Effect-first APIs, but invalid route identifiers or route-module export
     names could still throw before entering the typed Effect error channel.
   - Fix: named `FileRouteDefinitionsModuleError`, added an error guard, routed
     generated file planning and virtual route/app-graph module generation
     through Effect-visible failures, and widened the Vite writer error alias to
     `FileRouteDefinitionsFileWriteFailure`.
   - Benefits: generation, virtual-module loading, and filesystem writes now
     agree that generated route diagnostics are typed Effect failures.

5. Basic Starter Generated Artifact Contract
   - Status: fixed.
   - Files: `examples/basic-starter/src/starter.test.ts`.
   - Problem: the basic starter only tested SSR output, while the richer
     project-console starter pinned generated route artifact shape.
   - Fix: added a starter regression for the generated header, `routes`,
     `routeById`, `routeByPath`, and `FileRouteHrefOptionsById`.
   - Benefits: both starter paths now exercise the LSP-facing generated route
     artifact contract.

Focused evidence: package typechecks for DB, Solid, Solid DB, and Start passed;
`pnpm typecheck:types` passed; focused tests passed for Solid router, Solid DB,
DB flush/collection behavior, Start file-route modules, and the basic starter;
`pnpm audit:effect-first` and `git diff --check` passed. Full `pnpm verify`
passed after this tranche: 9 package builds, workspace typecheck, type tests,
Effect-first source audit, 45 root test files / 461 tests, devtools-panel verify
with 1 panel test, devtools-extension verify with 1 extension test file / 7
tests, basic starter verify with 1 starter test file / 2 tests,
project-console starter packaging, project-console typecheck, 4 project-console
test files / 23 tests, project-console build, and leak scans. Post-verify raw
schema-error, Promise-method, immutable flag, ResourceFamily live-store,
runtime Promise docs, and whitespace audits passed.

## Review 40: Start Facade Package Depth Decision

Status: accepted as intentional.

Findings:

1. `@effect-ui/start-fetch` And `@effect-ui/start-node` Shallow Packages
   - Status: accepted.
   - Files: `packages/start-fetch/src/index.ts`,
     `packages/start-node/src/index.ts`, `docs/public-api-inventory.md`,
     `packages/start/test/adapters.test.ts`.
   - Problem considered: the package roots are shallow re-export facades,
     which can be a smell when a package claims a Module but only forwards
     names.
   - Decision: keep them shallow. Their depth lives in
     `@effect-ui/start/fetch-adapter` and `@effect-ui/start/node-adapter`; the
     packages are install/import seams for host-shaped deployments. Deleting
     them would move Node/fetch package ergonomics back into docs and user
     imports without reducing implementation complexity.
   - Evidence: public API inventory explicitly classifies both as thin
     facades, adapter tests prove the package facades point at the tested
     implementation, and the fetch facade is pinned to the fetch-only adapter
     module so it does not pull Node imports into fetch-only bundles.

No code fix was made. Focused verification from the audit agent passed:
`pnpm vitest run packages/start/test/adapters.test.ts` with 15 tests,
`pnpm typecheck:types`, and package typechecks for `@effect-ui/start-fetch`
and `@effect-ui/start-node`.

## Review 39: Start Transport Status Policy Locality

Status: fixed.

Findings:

1. Start Transport Response And Status Policy Duplication
   - Status: fixed.
   - Files: `packages/start/src/start-transport-protocol.ts`,
     `packages/start/src/start-rpc-client.ts`,
     `packages/start/src/start-action-client.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: the Start transport Module had parallel RPC/action JSON
     response builders and duplicated runtime failure, protocol failure,
     transport request failure, and not-found response construction. Client
     status validation also lived separately in the RPC and action clients, so
     semantic body tags and expected HTTP statuses could drift.
   - Fix: added shared JSON, server-error, defect, and not-found response
     helpers behind the existing exported RPC/action response functions. Added
     `validateStartResponseStatusEffect(...)` for the shared RPC/action client
     status policy, then routed `start-rpc-client.ts` and
     `start-action-client.ts` through it while preserving existing error
     messages, bodies, and status codes.
   - Benefits: the Start Transport Protocol now owns status policy and common
     response construction. RPC/action clients stay thinner and cannot
     independently reinterpret successful, validation, server-error, or defect
     transport bodies.

Focused evidence: `pnpm --filter @effect-ui/start typecheck` passed, and
`pnpm vitest run packages/start/test/rpc.test.ts packages/start/test/start.test.ts`
passed with 2 files / 88 tests. Full `pnpm verify` passed after this pass: 9
package builds, workspace typecheck, type tests, effect-first source audit, 45
root test files / 457 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 7 tests, basic starter
verify with 1 starter test, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan.

## Review 38: Request Runtime Response Stream Adapter Locality

Status: fixed.

Findings:

1. Request Runtime Owned Web Stream Adapter
   - Status: fixed.
   - Files: `packages/start/src/request-runtime.ts`,
     `packages/start/src/request-runtime-response.ts`,
     `packages/start/src/streaming.ts`, `packages/start/test/streaming.test.ts`,
     `scripts/audit-effect-first.mjs`, `docs/public-api-inventory.md`,
     `CONTEXT.md`.
   - Problem: `request-runtime.ts` owned both Runtime Spine provisioning and
     Web response body mechanics: it called `response.body.getReader()`,
     constructed a new `ReadableStream`, and rebuilt the `Response` to delay
     request runtime disposal until stream close/cancel/error. That put a host
     Adapter beside lifecycle code.
   - Fix: added `responseWithStreamFinalizer(...)` to the Start streaming
     Module so Web response wrapping, reader pulling, chunk counting, and
     close/error/cancel mapping live with stream Adapters. Added
     `request-runtime-response.ts` for the runtime-specific finalizer that
     guards single disposal, records teardown facts, and invokes request trace
     callbacks. `request-runtime.ts` now re-exports the stable completion
     facade while keeping Runtime construction/provisioning local.
   - Benefits: streaming mechanics, Runtime lifecycle, and request handler
     orchestration each have clearer Locality while preserving the old public
     completion API and streamed-response teardown semantics.

Focused evidence: `pnpm --filter @effect-ui/start typecheck`,
`pnpm audit:effect-first`, and `pnpm vitest run packages/start/test/start.test.ts
packages/start/test/streaming.test.ts packages/start/test/adapters.test.ts`
passed with 3 files / 102 tests. Added streaming regressions for wrapped Web
response close, cancel, and error finalization events. Full `pnpm verify`
passed after this pass: 9 package builds, workspace typecheck, type tests,
effect-first source audit, 45 root test files / 457 tests, devtools-panel
verify with 1 panel test, devtools-extension verify with 1 extension test file
/ 7 tests, basic starter verify with 1 starter test, project-console starter
packaging, project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan.

## Review 24: Action Optimism And Live Query State Locality

1. Action Optimistic Transaction Module
   - Status: fixed.
   - Files: `packages/core/src/action-optimistic.ts`,
     `packages/core/src/action.ts`, `CONTEXT.md`.
   - Problem: `Action.use(...)` owned optimistic signal patch stacking,
     rollback, commit, and cross-submission recomputation inline with action
     submission orchestration. That made the Action facade a shallower Module:
     callers only need an optimistic transaction Interface, while maintainers
     had to read signal patch internals in the same file as concurrency and
     invalidation logic.
   - Fix: extracted `action-optimistic.ts` as the Action Optimistic
     Transaction Module. `Action.use(...)` now wires a small runtime into the
     workflow, while the new Module owns patch state, touched-signal tracking,
     commit folding, rollback removal, and recomputation of later optimistic
     patches. The public Action Interface still exposes only the existing
     transaction and rollback types.
   - Benefits: optimistic patch behavior now has Locality at a focused Seam,
     giving tests and future concurrency changes a deeper Interface without
     widening the public Action surface.

2. Live Query State Module
   - Status: fixed.
   - Files: `packages/db/src/live-query-state.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/test/live-query-collection.test.ts`, `CONTEXT.md`.
   - Problem: `Query.live(...)` mixed Query Builder description work with the
     reactive Adapter that turns Live Query Runtime evaluation into `data`,
     `state`, source preloads, source refetches, source failures, and last-good
     data retention. The Interface was small, but the Implementation mixed two
     concepts with different reasons to change.
   - Fix: extracted `makeLiveQueryState(...)` into a Live Query State Module.
     Query Builder still owns immutable query descriptions and one-shot
     execution; Live Query State now owns the public `LiveQuery` handle around
     the runtime evaluator. Added regressions proving a later projection
     failure reports typed query failure while preserving the last successful
     data, a later source refetch failure preserves current data, and the live
     query recovers when source data becomes valid again.
   - Benefits: Live Query Runtime remains about incremental query mechanics,
     Query Builder remains about query construction, and the state Adapter has
     one testable Interface for load-state folding and failure retention.

3. Start Endpoint Workflow Candidate
   - Status: closed as not actionable.
   - Files inspected: `packages/start/src/start-request-endpoints.ts`.
   - Problem considered: extracting the endpoint dispatch branches into a
     separate workflow Module.
   - Decision: the deletion test failed. The proposed Module would expose a
     callback-heavy Interface nearly as complex as the Implementation, with
     only one real Adapter. Keeping the dispatch branches in the Start Request
     Handler path preserves better Locality than adding a shallow Seam.

Workspace evidence for this pass: `pnpm --filter @effect-ui/core typecheck`
passed, `pnpm --filter @effect-ui/db typecheck` passed, `pnpm typecheck`
passed, `pnpm typecheck:types` passed, and the focused regression runs passed:
`pnpm vitest run packages/core/test/action.test.ts
packages/db/test/live-query-collection.test.ts` with 2 files / 30 tests and
`pnpm exec vitest run packages/core/test/action.test.ts
packages/db/test/collection.test.ts packages/db/test/live-query-collection.test.ts
packages/solid-db/test/solid-db.test.ts` with 4 files / 77 tests. Full `pnpm
verify` passed: 9 package builds, workspace typecheck, type tests, 45 root test
files / 422 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 6 tests, basic starter
verify with 1 starter test, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan. DB/Solid DB raw schema-error grep, source
Promise-method grep, and immutable flag audit passed after verification.

## Review 25: Runtime Locality And Start Dev SSR Module Boundaries

1. Resource Runtime Store Operations
   - Status: fixed.
   - Files: `packages/core/src/resource.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-lifetime.ts`,
     `packages/core/test/resource.test.ts`,
     `docs/public-api-inventory.md`.
   - Problem: `ResourceFamily` is the stable Resource Definition Module, but it
     still owned live Resource Store implementation details: per-store input
     maps, entries, Effect cache construction, hydration writes, invalidation,
     deletion, and entry enumeration. That made the definition Interface
     shallower and let internal callers treat a definition as the live runtime
     owner.
   - Fix: moved entry/cache/input/hydration/delete operations into Resource
     Runtime helpers. `ResourceFamily` now owns options and ref construction.
     Public deletion is exposed as `Resource.deleteEffect(ref)`, and GC receives
     the Resource Runtime delete operation as a callback rather than calling
     back into `ref.family`.
   - Benefits: live Resource Store behavior now has Locality in the Resource
     Runtime Module. Resource Definition remains a smaller Interface, and tests
     cover direct deletion plus `ResourceDeleted` publication through the public
     Effect API.

2. Collection Sync Load Policy
   - Status: fixed.
   - Files: `packages/db/src/collection-contract.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/sync-adapter.ts`,
     `packages/db/test/sync-adapter.test.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`.
   - Problem: `Collection.syncOptions(...)` kept `let loaded = false` in a sync
     Adapter closure to choose between adapter `load` and `refetch`. That state
     was Collection Definition-global, so one runtime/request could make a
     second runtime's first preload call the refetch Adapter.
   - Fix: added `CollectionOptions.refetch` and moved the `load` versus
     `refetch` decision into Collection Runtime. First preload uses `load ??
     refetch`; forced refetch uses `refetch ?? load`. The sync Adapter now maps
     callbacks independently and owns no runtime state. Added a two-runtime
     regression proving first preload remains store-local.
   - Benefits: Collection Sync Adapter stays a translation Interface, while
     Collection Runtime owns load-state policy with better request/runtime
     Locality.

3. Start Vite Dev SSR Adapter Module
   - Status: fixed.
   - Files: `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/src/vite.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`.
   - Problem: `vite.ts` mixed Vite plugin assembly, virtual module wiring,
     diagnostics loading, server-only module blocking, and dev SSR request
     handling. The dev SSR path already had a meaningful Adapter Interface, but
     its Implementation lived beside unrelated build-time Vite behavior.
   - Fix: extracted `start-vite-dev-ssr.ts` for `StartDevServer`,
     `StartViteDevServer`, handler resolution, SSR request selection,
     Node-to-web conversion, HTML transform handling, Vite stacktrace repair,
     and middleware error routing. `vite.ts` keeps the public re-exports and
     plugin assembly.
   - Benefits: Vite diagnostics/plugin changes and dev request bugs now land in
     different Modules. The public `@effect-ui/start/vite` Interface stays
     stable while the dev SSR Adapter has a deeper Implementation behind it.

Workspace evidence for this pass: `pnpm --filter @effect-ui/core typecheck`
passed, `pnpm vitest run packages/core/test/resource.test.ts` passed with 1
file / 34 tests, `pnpm --filter @effect-ui/db typecheck` passed, `pnpm vitest
run packages/db/test/sync-adapter.test.ts packages/db/test/collection.test.ts`
passed with 2 files / 50 tests, `pnpm --filter @effect-ui/start typecheck`
passed, `pnpm exec vitest run packages/start/test/start.test.ts
packages/start/test/adapters.test.ts` passed with 2 files / 84 tests, and
`pnpm typecheck` passed. Full `pnpm verify` passed: 9 package builds,
workspace typecheck, type tests, 45 root test files / 423 tests,
devtools-panel verify with 1 panel test, devtools-extension verify with 1
extension test file / 6 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4
project-console test files / 23 tests, project-console build, and leak scan.
DB/Solid DB raw schema-error grep, source Promise-method grep, and immutable
flag audit passed after verification.

## Review 26: Solid DB Binding, Expert-Public Core Surface, And Route Plan Projection

1. Solid DB Reactive Binding Module
   - Status: fixed.
   - Files: `packages/solid-db/src/shared.ts`,
     `packages/solid-db/src/collection.ts`,
     `packages/solid-db/src/live-query.ts`,
     `packages/solid-db/test/solid-db.test.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`.
   - Problem: `useCollection(...)` and `useLiveQuery(...)` duplicated the same
     Solid Adapter mechanics: runtime capture, collection source subscription,
     tick invalidation, automatic preload, preload failure capture,
     runtime-bound returned Effects, and owner cleanup. The public hook
     Interfaces were small, but their Implementations forced maintainers to
     reason about one binding policy in two files.
   - Fix: deepened `shared.ts` into the Solid DB Reactive Binding Module.
     Hook-specific files now describe collection reads, indexes, live query
     data, and state while the shared Module owns source subscriptions, cleanup,
     preload execution, and Effect binding. Added a cleanup regression that
     proves `useCollection(...)` and `useLiveQuery(...)` unsubscribe their
     collection state/version sources with the Solid owner.
   - Benefits: the Solid DB Adapter has better Locality around the Solid
     reactivity Seam. Hook behavior remains stable, while future preload,
     cleanup, or runtime-binding changes cross one Interface.

2. Expert-Public Core Surface Drift
   - Status: fixed.
   - Files: `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: the `@effect-ui/core` root export already exposed expert Modules
     such as Action Submission, Definition Registry, Resource Registry,
     Resource Snapshot Codec, and Route Grammar, but the public inventory and
     LSP-facing type tests did not pin those Interfaces. That left adapters and
     generated manifests with a documented surface narrower than the actual
     package surface.
   - Fix: classified those Modules as expert public in the inventory and added
     public type tests for route grammar inference/building, registry duplicate
     diagnostics, Action Submission state/concurrency, Resource Registry
     diagnostics, `Resource.deleteEffect(...)`, and Resource Snapshot Codec
     helpers.
   - Benefits: the package root surface is explicit. App code still has high
     Leverage through `Action`, `Resource`, `Route`, `Server`, and `defineApp`,
     while advanced Adapter/test code has stable, documented seams.

3. Devtools Route Plan Projection Module
   - Status: fixed.
   - Files: `packages/devtools/src/route-plan-facts.ts`,
     `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/test/devtools.test.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`.
   - Problem: Devtools route-plan semantics were split across standalone route
     plans and request-embedded route plans. Standalone plans emitted
     `Matches`, `Preloads`, and `Hydrates` causal edges, while embedded request
     plans only emitted route-plan and match facts before request resources
     were recorded separately. Callers had to know the Adapter path to
     understand a route plan's causal meaning.
   - Fix: introduced the internal Devtools Route Plan Projection Module. Both
     standalone route plans and request trace route plans now project through
     the same Interface, and the request trace path only adds its
     source-specific `Records` edge. The request trace regression now asserts
     embedded route plans emit `Matches`, `Preloads`, and `Hydrates`.
   - Benefits: route-plan meaning has Locality in one Module, and the Causal
     Graph becomes a graph assembly Adapter instead of owning two projections
     for the same domain fact.

Workspace evidence for this pass: `pnpm --filter @effect-ui/solid-db
typecheck`, `pnpm vitest run packages/solid-db/test/solid-db.test.ts`,
`pnpm typecheck:types`, `pnpm --filter @effect-ui/devtools typecheck`, and
`pnpm vitest run packages/devtools/test/devtools.test.ts` passed. Full `pnpm
verify` passed: 9 package builds, workspace typecheck, type tests, 45 root
test files / 424 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 6 tests, basic starter
verify with 1 starter test, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan. DB/Solid DB raw schema-error grep,
source Promise-method grep, immutable flag audit, ResourceFamily live-store
grep, sync-load closure grep, and `git diff --check` passed after
verification.

## Review 58: Hydration Walls, Runtime Ownership, Devtools Identity, And LSP Coverage

Fresh subagents scanned Core/Solid, DB, Start, Devtools, and docs/API seams.
This pass found actionable work, so the clean-sweep counter remains at zero.

1. Start Hydration And Manifest Walls
   - Status: fixed.
   - Files: `packages/start/src/hydration.ts`,
     `packages/start/src/manifest-entry-core.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/src/vite.ts`, `packages/start/test/start.test.ts`,
     `packages/start/test/server-function-manifest.test.ts`, and
     `packages/start/test/action-manifest.test.ts`.
   - Problem: Start hydration accepted malformed collection roots, `.tsrx`
     contract/server files were not fully covered by the manifest/server-only
     wall, and Vite dev SSR could call `next()` outside the Effect Adapter.
   - Fix: validated collection payload shape, centralized `.server.tsrx` and
     `.contract.tsrx` classification in the Manifest Entry Module, and routed
     Vite dev SSR pass-through through `callMiddlewareNextBestEffort(...)`.
   - Benefits: hydration, manifest policy, and dev middleware behavior now
     share the same typed Interface and Adapter locality.

2. Core Resource/Action Runtime Ownership And Solid Route Matching
   - Status: fixed.
   - Files: `packages/core/src/action-submission.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-lifetime.ts`, `packages/core/src/route.ts`,
     `packages/core/test/action.test.ts`, `packages/core/test/resource.test.ts`,
     `packages/core/test/route-server.test.ts`, `packages/solid/src/router.ts`,
     `packages/solid/test/hooks.test.ts`, and
     `packages/solid/test/router.test.ts`.
   - Problem: action reset only owned the latest submission fiber, deleted
     Resource refs could leave existing `Resource.result` subscribers stale,
     forced invalidation could join a stale non-forced load, and Solid router
     matching still used sync `Route.match(...)` where schema failures could
     escape the typed navigation-error Seam.
   - Fix: action submissions now track and interrupt all active fibers,
     Resource deletion resets the entry before deleting it, forced refresh
     interrupts stale non-forced work, Core exposes `Route.matchEffect(...)`,
     and Solid router state reports `RouteNavigationError` failures without a
     synthetic match.
   - Benefits: runtime ownership is local to Core Modules, while Solid consumes
     the typed route-matching Adapter instead of duplicating match error policy.

3. DB Snapshot, Query, And Collection Input Contracts
   - Status: fixed.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/query-builder.ts`, `packages/db/src/query-plan.ts`,
     `packages/db/test/collection.test.ts`, and
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: collection hydration could silently overwrite duplicate
     identities, local mutation/direct-write paths ignored the `input` schema,
     query windows accepted non-finite/fractional counts, and live-query
     collection versions used a hash that could collide.
   - Fix: hydration rejects duplicate collection names and row keys, mutation
     paths validate `input` before `output`, diagnostics/once/live query paths
     share finite safe-integer window validation, and live-query collection
     versions are monotonic revisions keyed by stable materialized equality.
   - Benefits: Collection and Query Interfaces now reject bad input at their
     owning seams instead of relying on downstream incidental behavior.

4. Devtools Fact Identity, Import, And Panel Contract Safety
   - Status: fixed.
   - Files: `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/src/panels.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/src/summary-facts.ts`, and
     `packages/devtools/test/devtools.test.ts`.
   - Problem: Ref invalidation targets could be rendered under the wrong graph
     node kind, unmatched runtime event fact ids could collide with recorded
     facts, imported duplicate event sequences were not normalized, public
     describers returned live unknown values, legacy route modules could throw
     in panels, and item-level malformed metrics were dropped rather than
     rejected.
   - Fix: Ref targets stay Resource nodes, runtime event fallback ids allocate
     after recorded facts, imported events are sequence-normalized, invalidation
     and route describers detach unknown params/search/input values, panels use
     the app-graph preload-collections accessor, and panel items reject
     non-array metrics.
   - Benefits: Devtools now keeps graph identity, imported snapshots, and panel
     DTOs local to their owning Modules and safe at public bridge seams.

5. Docs/API Inventory And TSRX LSP Coverage
   - Status: fixed.
   - Files: `packages/tsrx/src/index.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `docs/db.md`, `docs/architecture.md`,
     `examples/project-console/src/start-graph.ts`,
     `examples/project-console/src/full-stack-golden.test.ts`,
     `docs/release-notes.md`, `docs/docs-drift-audit.md`,
     `docs/ultimate-goal-checklist.md`, and `docs/perfection-progress.md`.
   - Problem: `@effect-ui/tsrx` lacked hover/type-test coverage, Start root
     low-level transport/Core convenience exports were wider than the
     inventory described, DB next-slice docs still listed completed
     TanStack Query-shaped sync work, the project-console graph helper could
     look like a second topology Interface, and release evidence had stale
     counts.
   - Fix: added TSRX JSDoc and public type assertions, classified Start
     low-level helpers and Core re-exports as expert-public convenience
     surfaces, removed the completed DB next-slice item, documented the
     project-console helper as a narrow non-Vite fallback, and refreshed the
     verification ledgers.
   - Benefits: LSP/docs now describe the actual public Interface without
     implying duplicate graph ownership or stale future work.

Focused workspace evidence for this pass: package typechecks for Core, Solid,
Start, DB, Devtools, and TSRX passed; public type tests passed; focused
regressions passed for Core action/resource/route-server, Solid hooks/router,
Start start/server-function/action manifest, DB collection/live-query
collection, and Devtools. Full `pnpm verify` passed: 9 package builds,
workspace typecheck, type tests, Effect-first source audit, 45 root test files
/ 603 tests, devtools-panel verify with 1 panel test, devtools-extension verify
with 1 extension test file / 14 tests, basic starter verify with 1 starter test
file / 2 tests, project-console starter packaging, project-console typecheck,
4 project-console test files / 23 tests, project-console build, and leak scans.

## Review 47: Devtools Extension Transport Error Panel

1. Extension Panel Transport Error Surface
   - Status: fixed.
   - Files: `examples/devtools-extension/src/panel-runtime.ts`,
     `examples/devtools-extension/src/panel.ts`,
     `examples/devtools-extension/src/extension.test.ts`,
     `examples/devtools-extension/README.md`, `docs/devtools.md`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: the extension transport already mapped inspected-window eval
     exceptions to `DevtoolsExtensionTransportError`, but the panel update path
     caught all transport failures and converted them to `undefined`, leaving
     users on sample data with no bridge guidance.
   - Fix: extracted the panel update policy into `panel-runtime.ts`; live
     payloads still update the mounted panel, no-bridge still keeps the sample
     fallback, and typed transport failures now render an error item in the
     diagnostics panel.
   - Benefits: the checked browser extension teaches the same Effect-first
     Adapter rule as the library: host failures stay typed and visible at the
     UI seam instead of disappearing behind fallback data.

Focused workspace evidence for this pass: `pnpm --filter
@effect-ui/example-devtools-extension verify` passed, including extension
typecheck, 1 test file / 9 tests, and production build.

## Review 48: Start Preload Requirement And Devtools Fact Identity Follow-Up

1. Start Request Runtime Requirement Surface
   - Status: fixed.
   - Files: `packages/start/src/request-runtime.ts`,
     `packages/start/src/start-request-preload.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/start-host-adapter.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/node-adapter.ts`,
     `type-tests/framework.test-d.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`,
     `docs/type-test-coverage-audit.md`.
   - Problem: Core route planning preserved preload service requirements, but
     Start request preload and request-handler Effects erased them to `unknown`
     or `Scope.Scope` after the request Runtime boundary. A route preload could
     depend on a service missing from `app.server` and still look provided in
     LSP hovers.
   - Fix: added `RequestRuntimeRemainingRequirements`, threaded it through
     `preloadRequestEffect(...)`, `preloadRequestEffectWithRuntime(...)`,
     `createRequestHandlerEffect(...)`, and the Effect-first fetch/node adapter
     conversions. Effect-first adapters now infer requirements from the handler
     and reject partial generics that would otherwise default a missing
     requirement parameter to `unknown`. The callback/Promise host facades remain
     the explicit erased runtime boundaries.
   - Benefits: Start now reports the same missing route preload services that
     Core reports, and adapters preserve that truth until a host explicitly runs
     the Effect on a runtime.

2. Action Runtime Binding Definition Truth
   - Status: fixed.
   - Files: `packages/core/src/action.ts`,
     `packages/solid/src/hooks.ts`, `type-tests/framework.test-d.ts`.
   - Problem: runtime-bound `Action.use(definition, { runtime })` correctly
     discharged services from `submitEffect(...)`, but the exposed
     `instance.definition` type was narrowed too. That made `definition.run(...)`
     appear requirement-free even though the action definition itself had not
     changed. Solid `useAction(...)` also bound to the nearest runtime while its
     returned type still exposed the original requirements.
   - Fix: `ActionInstance` now separates the submission requirements from the
     underlying definition requirements, and Solid `useAction(...)` returns a
     runtime-bound instance whose `submitEffect(...)` is provided by the Solid
     runtime while `definition.run(...)` keeps its original type. The hook also
     exposes an optional `ER` generic for apps whose Solid Runtime Provider has a
     known startup/acquisition error channel.
   - Benefits: action hovers now distinguish the definition contract from the
     runtime-bound instance contract instead of flattening both into one shape.

3. Devtools Request Trace Fact Identity
   - Status: fixed.
   - Files: `packages/devtools/src/fact-identity.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `docs/devtools.md`, `CONTEXT.md`.
   - Problem: recording a caller-supplied request id such as `trace:1` did not
     advance the fallback trace-id allocator, so the next id-less trace could
     collide. Bounded invalidation history trimming also rebased snapshot action
     and runtime-event invalidation indexes but missed request-trace action
     indexes in both snapshot request traces and runtime `RequestTrace` events.
     Request-embedded route plans also used the request trace index as their
     route-plan fact identity, which could point at a synthetic node when the
     same route plan had already been recorded at another route-plan index.
   - Fix: `fact-identity.ts` now exposes request-trace sequence parsing and
     request-trace action invalidation rebasing. The Store seeds the next trace
     sequence from caller-supplied ids and rebases request-trace action links in
     snapshots and runtime events whenever invalidation facts are trimmed.
     Causal graph projection now reuses a matching recorded route-plan summary
     for request-embedded route plans before falling back to request-local
     projection.
   - Benefits: request trace ids remain deterministic without collisions, and
     request summaries/runtime events keep pointing at the correct invalidation
     facts after bounded history compaction. Request route-plan edges point at
     canonical route-plan facts instead of index-shaped accidents.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/core
typecheck`, `pnpm --filter @effect-ui/solid typecheck`, `pnpm --filter
@effect-ui/start typecheck`, `pnpm --filter @effect-ui/devtools typecheck`,
`pnpm typecheck:types`, `pnpm vitest run packages/devtools/test/devtools.test.ts`,
`pnpm vitest run packages/start/test/start.test.ts
packages/start/test/adapters.test.ts`, and `pnpm vitest run
packages/core/test/action.test.ts packages/core/test/runtime.test.ts
packages/core/test/route-server.test.ts` passed. Full `pnpm verify` passed:
9 package builds, workspace typecheck, type tests, Effect-first source audit,
45 root test files / 470 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 9 tests, basic starter
verify with 1 starter test file / 2 tests, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scans.

## Review 49: Host Facade, Runtime-Bound Handle, And Fact Identity Sweep

1. Start Host Facade Requirement Surface
   - Status: fixed.
   - Files: `packages/start/src/start-host-adapter.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/node-adapter.ts`,
     `packages/start-fetch/src/index.ts`,
     `packages/start-node/src/index.ts`,
     `packages/start/test/adapters.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: Effect-first fetch/node adapters preserved handler
     requirements, but Promise/callback facades could still accept a
     serviceful handler with no runtime and fall back to the default runtime.
   - Fix: Start request handlers now carry a phantom requirement marker for
     adapter inference. The host facades provide per-request `Scope.Scope`
     themselves, and require a typed runtime when any non-Scope requirements
     remain.
   - Benefits: host-shaped adapters remain ergonomic for scope-only handlers
     while missing app services stay visible at the Adapter Interface.

2. Core Promise Guard And Server Wire Codec Truth
   - Status: fixed.
   - Files: `packages/core/src/effect-like.ts`,
     `packages/core/src/action-result.ts`, `packages/core/src/action.ts`,
     `packages/core/src/server.ts`, `packages/core/test/server.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: callback `EffectInput` seams rejected Promise-shaped returns, but
     direct helpers such as `toEffect(...)` and `ActionResult.fromEffect(...)`
     could still infer a Promise as a pure value. Core local/mock server
     clients also schema-round-tripped input/output without applying the same
     error schema policy to domain failures.
   - Fix: direct Promise-shaped `EffectInput` values are rejected in public type
     tests and still die with `EffectInputPromiseRejected` if an erased value
     reaches runtime. `Server.mockClient(...)` and `Server.localClient()` now
     encode/decode domain failures through the Server Wire Codec, while
     `EffectInputCallbackError`, schema errors, and transport errors remain
     client errors.
   - Benefits: the Promise Guard and Server Wire Codec Modules now match their
     public hover contract across direct helpers, local clients, mocks, and
     Start transports.

3. Solid And Solid DB Runtime-Bound Handle Truth
   - Status: fixed.
   - Files: `packages/solid/src/runtime.ts`,
     `packages/solid/src/hooks.ts`, `packages/solid-db/src/shared.ts`,
     `packages/solid-db/src/collection.ts`,
     `packages/solid-db/src/live-query.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: Solid Resource and Solid DB returned Effects were runtime-bound,
     but their public handles either kept stale service requirements or hid a
     fallible Runtime Provider's startup/acquisition error channel. Solid
     Resource automatic prefetch fibers also lived until runtime disposal
     instead of Solid owner cleanup.
   - Fix: `useRuntime<ER>()`, `useResource<..., ER>()`,
     `useCollection<..., ER>()`, and `useLiveQuery<..., ER>()` now expose
     runtime-bound Effect error channels explicitly. Solid DB handles no longer
     expose service requirements already supplied by the Solid runtime, and
     Solid Resource automatic prefetch fibers are interrupted on owner cleanup
     or ref change.
   - Benefits: UI Adapter hovers describe the actual runtime-bound Interface,
     and Solid-created background work has Solid-local lifetime.

4. DB Query Factory Defaults
   - Status: fixed.
   - Files: `packages/db/src/query-builder.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: `QueryFactory<TResult>` defaulted public error and requirement
     parameters to `any`, so annotated factories could erase collection
     failures and service requirements.
   - Fix: public `QueryFactory` and `Query.Factory` defaults now use `never`,
     and `QueryBuilder` carries a phantom type marker so serviceful builders
     cannot be assigned to requirement-free factory aliases.
   - Benefits: query factory annotations now preserve the same concrete
     error/requirement channels that `Query.onceEffect(...)` and
     `Query.live(...)` expose.

5. Devtools Runtime Event And Fact Fingerprint Identity
   - Status: fixed.
   - Files: `packages/devtools/src/fact-identity.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/test/devtools.test.ts`.
   - Problem: duplicate caller-supplied runtime event sequences could collapse
     graph nodes, and Store/Summary fact matching used raw `JSON.stringify(...)`
     instead of the Devtools Serialization Policy.
   - Fix: the Store rebases duplicate sequence/tag pairs to the next runtime
     event sequence. Fact identity now uses one stable serialized fingerprint
     based on `toDevtoolsSerializableValue(...)`, shared by Store and Summary
     projection.
   - Benefits: runtime event graph ids stay unique, and equivalent invalidation
     or route-plan facts match even when object key insertion order differs.

Focused workspace evidence for this pass: `pnpm typecheck`,
`pnpm exec vitest run packages/core/test/server.test.ts`,
`pnpm exec vitest run packages/solid/test/hooks.test.ts`,
`pnpm exec vitest run packages/start/test/adapters.test.ts`, and
`pnpm exec vitest run packages/devtools/test/devtools.test.ts` passed. Full
`pnpm verify` passed: 9 package builds, workspace typecheck, type tests,
Effect-first source audit, 45 root test files / 475 tests, devtools-panel
verify with 1 panel test, devtools-extension verify with 1 extension test file
/ 9 tests, basic starter verify with 1 starter test file / 2 tests,
project-console starter packaging, project-console typecheck, 4
project-console test files / 23 tests, project-console build, and leak scans.
Post-verify Promise-method, DB/Solid DB raw schema-error, and whitespace audits
passed.

## Review 50: Scope, Identity, And Lifecycle Follow-Up Sweep

1. Start Dev SSR And Host Adapter Requirement Surface
   - Status: fixed.
   - Files: `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/node-adapter.ts`,
     `packages/start/test/start.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: the Vite dev SSR Adapter erased the request `Scope.Scope`
     requirement that normal Start request handlers need, while bare fetch/node
     handler aliases still allowed annotations to hide preserved requirements.
   - Fix: Vite dev SSR now scopes handler execution, the SSR handler type allows
     the request Scope but not arbitrary app services, and bare fetch/node handler
     aliases default to service-free `never` with type pins for serviceful
     handlers.
   - Benefits: Start host Adapters now share one request Scope ownership policy,
     and non-Scope service requirements stay visible at the public Interface.

2. Solid Router Lifecycle And Resource Selector Locality
   - Status: fixed / documented.
   - Files: `packages/solid/src/router.ts`,
     `packages/solid/src/hooks.ts`, `packages/solid/test/router.test.ts`.
   - Problem: same-href navigation could not retry a failed current-route
     preload, and `RouterOutlet` rendered the next route before previous Solid
     cleanup callbacks ran.
   - Fix: router navigation now carries a revision tick so same-href navigation
     re-runs preload, and previous Solid roots are disposed before rendering the
     next ready route. Resource selector hooks now document that each convenience
     selector owns one subscription and `useResource(...)` is the shared handle
     for multi-selector reads.
   - Benefits: route retry, owner cleanup, and selector subscription ownership
     are explicit at the UI Adapter seam.

3. Core Callback, Hydration, And Derived Signal Ownership
   - Status: fixed.
   - Files: `packages/core/src/server.ts`,
     `packages/core/src/resource-runtime.ts`, `packages/core/src/resource.ts`,
     `packages/core/src/action-optimistic.ts`, `packages/core/src/action.ts`,
     `packages/core/src/signal.ts`, `packages/core/test/route-server.test.ts`,
     `packages/core/test/resource.test.ts`, `packages/core/test/action.test.ts`,
     `packages/core/test/signal.test.ts`, `packages/start/src/hydration.ts`.
   - Problem: `Server.route(...)` discarded `EffectInputCallbackError`
     operation/guidance details; Resource hydration committed success/cache state
     before `provides` could fail; optimistic signal patch updater throws could
     escape transaction rebases; and derived signals kept source subscriptions
     after their last subscriber.
   - Fix: route handler errors preserve the full callback error as cause.
     Hydration validates provided tags before committing state/cache and exposes
     callback failures through Start hydration. Optimistic signal patches run
     through typed Effect failures during initial apply and commit rebase.
     Derived signals dispose dependency trackers after the last subscriber, while
     Live Query State caches evaluations by source version so repeated accessors
     preserve last failure/data facts.
   - Benefits: user callback failures keep typed context, partial hydration state
     is avoided, optimistic transaction rebases are Effect-first, and signal
     dependency lifetime is no longer permanent by construction.

4. DB Collection Key And Live Query Source Identity
   - Status: fixed.
   - Files: `packages/db/src/collection-errors.ts`,
     `packages/db/src/collection-contract.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/src/live-query-state.ts`,
     `packages/db/src/query-plan.ts`, `packages/db/src/index.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`,
     `packages/solid-db/test/solid-db.test.ts`,
     `examples/project-console/src/project-collections.ts`.
   - Problem: live query row identity collapsed numeric key `1` and string key
     `"1"`, direct/update mutations could desynchronize a row's map key from its
     value-derived key, and self-join source lists caused duplicate preload and
     subscription ownership.
   - Fix: IVM row/context identity now encodes the primitive key kind, updates
     reject key-changing patches with `CollectionRowKeyChanged`, source
     ownership dedupes by Collection Definition, and live query evaluation facts
     are cached by source version.
   - Benefits: Collection key identity has one invariant across runtime rows,
     snapshots, live query contexts, and Solid DB source subscriptions.

5. Devtools Fact, Panel, And Extension Payload Identity
   - Status: fixed.
   - Files: `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/src/store.ts`, `packages/devtools/src/panels.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `examples/devtools-extension/src/transport.ts`,
     `examples/devtools-extension/src/extension.test.ts`.
   - Problem: causal graph request-route-plan matching still used raw
     `JSON.stringify(...)`, Start action invalidation-only changes were missed
     after terminal state updates, ordered panel ids had two owners, and malformed
     non-null extension bridge payloads collapsed into the same `undefined` as an
     absent bridge.
   - Fix: causal graph route-plan matching now uses stable serialized fact
     fingerprints. Start action tracking subscribes to both state and invalidation
     signals while deduping repeated invalidation facts. Panel construction is
     ordered by the public panel id catalog, and invalid inspected-window payloads
     become `DevtoolsExtensionTransportError`.
   - Benefits: Devtools identity, panel ordering, and extension diagnostics now
     share the public serialization/contract Modules instead of local ad hoc
     comparisons.

Focused workspace evidence for this pass: `pnpm typecheck`, `pnpm exec vitest
run packages/core/test/action.test.ts packages/core/test/signal.test.ts
packages/core/test/resource.test.ts packages/core/test/route-server.test.ts
packages/db/test/collection.test.ts packages/solid/test/router.test.ts
packages/devtools/test/devtools.test.ts examples/devtools-extension/src/extension.test.ts
packages/start/test/start.test.ts`, and the live-query/Solid DB regression slice
passed. Full `pnpm verify` passed: 9 package builds, workspace typecheck, type
tests, Effect-first source audit, 45 root test files / 487 tests,
devtools-panel verify with 1 panel test, devtools-extension verify with 1
extension test file / 10 tests, basic starter verify with 1 starter test file /
2 tests, project-console starter packaging, project-console typecheck, 4
project-console test files / 23 tests, project-console build, and leak scans.
Post-verify Promise-method audit matched only approved host/test/type-guard
seams, DB/Solid DB raw schema audit matched only Collection Snapshot Codec
decode normalization, and `git diff --check` passed.

## Review 51: Runtime-Local State, Response Metadata, And Panel Contract Sweep

Status: fixed in the current worktree.

This review used five parallel subagent scans across Core, DB/Solid DB, Start,
Solid, and Devtools. The sweep still found actionable Module, Interface, Seam,
Adapter, and Locality work, so it is evidence that we are closer, not evidence
that the clean-sweep counter can start.

1. Core Resource Invalidation And Registry Identity
   - Status: fixed.
   - Files: `packages/core/src/resource.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-dependency-graph.ts`,
     `packages/core/src/definition-registry.ts`,
     `packages/core/src/scope.ts`,
     `packages/core/test/definition-registry.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: Resource invalidation plan helpers erased service requirements,
     registry assembly trusted caller-provided `Map` keys over definition
     identity, unsafe registry clears left stale duplicate diagnostics, and
     public `scoped(...)` docs did not say the caller owns the scope lifetime.
   - Fix: invalidation targets/plans now preserve the Resource ref requirement
     type through planning and execution; registry maps are normalized by
     `definition.name`; unsafe action/server-function clears also remove
     duplicate diagnostics for the cleared definition kind; and `scoped(...)`
     JSDoc now names the caller-owned lifetime policy.
   - Benefits: LSP hovers now describe the services invalidation really needs,
     duplicate diagnostics track the actual active registry, and UI Adapter
     lifecycle docs no longer imply automatic disposal.

2. Solid Router And Runtime Adapter Lifecycle
   - Status: fixed.
   - Files: `packages/solid/src/router.ts`,
     `packages/solid/src/hooks.ts`, `packages/solid/src/runtime.ts`,
     `packages/solid/test/router.test.ts`,
     `packages/solid/test/hooks.test.ts`.
   - Problem: public router preload did not provide `Scope.Scope`; route
     unmount cleanup order differed between transitions and owner disposal;
     `useResourceSuspense(...)` returned stale success data even when the latest
     refresh had failed; provider-owned runtimes disposed themselves through the
     runtime being disposed; and `createBrowserRouter(...)` hid its Solid owner
     lifetime requirement.
   - Fix: public router preload uses scoped route preload execution, route
     disposal goes through one helper that closes the Solid root before the
     `UiScope`, stale refresh failures throw `ResourceFailure` with the previous
     value attached, provider cleanup forks disposal outside the runtime being
     closed, and browser-router JSDoc names the owner requirement.
   - Benefits: the Solid Adapter now has one Lifecycle policy across preload,
     transition, owner cleanup, Suspense failure, and runtime disposal seams.

3. DB Live Query Store Locality, Change Feed Runtime Ownership, And SQLite
   Storage Errors
   - Status: fixed.
   - Files: `packages/db/src/live-query-state.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/src/collection-contract.ts`,
     `packages/db/src/sync-adapter.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/sqlite-persistence.ts`,
     `packages/db/test/live-query-collection.test.ts`,
     `packages/db/test/sync-adapter.test.ts`,
     `packages/db/test/sqlite-persistence.test.ts`.
   - Problem: Live Query State mutable facts were descriptor-local instead of
     Collection Store-local; change-feed Adapters had to own Effect runtime
     plumbing to emit batches from host callbacks; SQLite table validation could
     throw at storage construction; and Live Query Collection snapshot `getKey`
     failures defected instead of entering the Effect error channel.
   - Fix: Live Query State now keys engine/evaluation facts by active
     Collection Store; change-feed contexts expose `emitChanges(...)`, with the
     Collection Runtime owning a queue, scoped consumer fiber, and
     `CollectionChangeFeedFailure` event publication; SQLite table resolution
     runs inside storage Effects; and Live Query Collection snapshots use an
     Effect-visible snapshot codec path that maps projection throws to
     `EffectInputCallbackError`.
   - Benefits: runtime/request Locality stays with the Collection Store, host
     adapters stay shallow, and persistence/snapshot failures are typed Effects
     rather than construction throws or defects.

4. Start Action Response Application, Dev SSR Requirement Surface, And
   Generated Route Match Types
   - Status: fixed.
   - Files: `packages/start/src/start-transport-protocol.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/src/file-route-modules.ts`,
     `packages/start/test/start.test.ts`,
     `packages/start/test/file-route-modules.test.ts`,
     `examples/project-console/src/routeTree.gen.ts`,
     `examples/basic-starter/src/routeTree.gen.ts`,
     `examples/project-console/src/server.tsx`,
     `type-tests/framework.test-d.ts`.
   - Problem: Start action response invalidation metadata was serialized but
     Ref invalidations were not replayed on the client; malformed response
     metadata could escape typed transport errors; Vite dev SSR helpers exposed
     broad `unknown` requirements after Scope provisioning; and generated route
     types were not leveraged at app render match seams.
   - Fix: action response metadata now has structural guards, typed
     hydration-application errors, Tag and Ref target replay through registered
     Resource Definitions, and hydrated-ref filtering; default Vite dev SSR
     stays requirement-free while expert `StartDevServer<R>` helpers preserve
     service requirements; generated route modules now include
     `FileRouteMatch<Path>` and `isRoutePathMatch(...)`, and the project
     console server uses that guard instead of a route/path cast.
   - Benefits: client action metadata application is Effect-first and typed,
     Vite adapter hovers match real service ownership, and generated app
     artifacts provide route-param narrowing where the app actually renders.

5. Devtools Panel Contract And Extension No-Bridge Fallback
   - Status: fixed.
   - Files: `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `examples/devtools-extension/src/panel-runtime.ts`,
     `examples/devtools-extension/src/extension.test.ts`,
     `docs/devtools.md`.
   - Problem: bridge payload validation allowed partial panel arrays while docs
     implied a complete ordered model, and the extension no-bridge fallback only
     applied before the first live update.
   - Fix: panel normalization now requires every public panel id exactly once,
     rejects missing/duplicate panels, and normalizes valid payloads to catalog
     order. The extension resets to sample panels when a later bridge read
     returns no payload.
   - Benefits: Devtools panel identity has one Contract for renderers, app
     shells, extensions, tests, and agents, and bridge disappearance is visible
     as a deterministic fallback rather than stale inspected-window state.

Evidence:

- Focused regression suite passed: `pnpm exec vitest run
  packages/core/test/definition-registry.test.ts packages/solid/test/router.test.ts
  packages/solid/test/hooks.test.ts packages/db/test/live-query-collection.test.ts
  packages/db/test/sync-adapter.test.ts packages/db/test/sqlite-persistence.test.ts
  packages/start/test/start.test.ts packages/devtools/test/devtools.test.ts
  examples/devtools-extension/src/extension.test.ts
  packages/start/test/file-route-modules.test.ts` passed: 10 files / 190 tests.
- `pnpm typecheck` passed.
- Full `pnpm verify` passed: 9 package builds, workspace typecheck, type tests,
  Effect-first source audit, 45 root test files / 502 tests, devtools-panel
  verify with 1 panel test, devtools-extension verify with 1 extension test
  file / 11 tests, basic starter verify with 1 starter test file / 2 tests,
  project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scans.
- Post-verify Promise audit matched only approved host/test/type-guard seams,
  DB/Solid DB raw schema audit matched only Collection Snapshot Codec decode
  normalization, and `git diff --check` passed.

## Review 52: Runtime-Bound Requirements, Hydration Atomicity, And Contract Tightening

Status: fixed in the current worktree.

This review used five parallel subagent scans across Core, Start, DB/Solid DB,
Solid, and Devtools. The sweep again found actionable Module, Interface, Seam,
Adapter, and Locality work, so the clean-sweep counter still cannot start.

1. Core Action And Server Contract Requirement Truth
   - Status: fixed.
   - Files: `packages/core/src/action.ts`, `packages/core/src/server.ts`,
     `packages/core/src/runtime.ts`, `packages/core/test/action.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: runtime-bound `Action.use(..., { runtime })` submissions erased
     remaining caller-provided services, broad `Server.implement(...)` and
     `Server.mock(...)` contracts could infer Promise-shaped pure outputs, and
     runtime JSDoc still described `runFork(...)` in Promise terms.
   - Fix: runtime-bound action submissions now provide only services owned by
     the captured runtime and preserve residual requirements; broad server
     handlers use the same EffectInput Promise guard as named contracts; and
     runtime docs describe Effect lifecycle ownership instead of a Promise
     caller.
   - Benefits: LSP hovers now show the services still required by a
     runtime-bound action, and loose server contracts cannot smuggle Promise
     work through inference.

2. Solid Runtime, Router, And Link Adapter Types
   - Status: fixed.
   - Files: `packages/solid/src/runtime.ts`, `packages/solid/src/router.ts`,
     `packages/solid/src/link.ts`, `packages/start/src/file-route-modules.ts`,
     `examples/project-console/src/App.tsx`,
     `examples/project-console/src/routeTree.gen.ts`,
     `examples/basic-starter/src/routeTree.gen.ts`,
     `packages/start/test/file-route-modules.test.ts`,
     `docs/architecture.md`, `type-tests/framework.test-d.ts`.
   - Problem: `RuntimeProvider.source` accepted existing runtimes even though
     the provider disposes source-owned runtimes, router rendering installed a
     Solid context without installing the matching Core ambient runtime, the
     generated route guard lost narrowing after `Route.withComponent(...)`, and
     `RouterLink` bridged Solid event and route-argument types too broadly.
   - Fix: `RuntimeProvider.source` now accepts provider-owned runtime sources
     while existing runtimes use `runtime`; `RouterProvider` renders children
     through `runWithRuntime(...)`; generated `isRoutePathMatch(...)` guards
     compare route paths; Project Console uses the generated guard; and
     `RouterLink` handles Solid bound-event tuples and generic route href args
     without pretending object-style event handlers are part of camel-case
     Solid events.
   - Benefits: runtime ownership, ambient runtime Locality, generated LSP
     narrowing, and Solid link hover types now describe the same behavior the
     Adapter runs.

3. DB Live Query, Hydration, Registry, And Persistence Locality
   - Status: fixed.
   - Files: `packages/db/src/live-query-state.ts`,
     `packages/db/src/collection-persistence.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-registry.ts`,
     `packages/db/src/sqlite-persistence.ts`,
     `packages/db/src/index.ts`,
     `packages/db/test/live-query-collection.test.ts`,
     `packages/db/test/collection-registry.test.ts`,
     `packages/db/test/sqlite-persistence.test.ts`,
     `CONTEXT.md`, `docs/db.md`.
   - Problem: live-query signals could stay subscribed to one Collection Store
     while reads in another runtime reused the subscribed value, collection
     hydration validated and mutated in one pass, definition-owned snapshot
     collections could be hydrated through writable-store code, collection
     registry keys trusted caller names, persistence diagnostics reported
     defaults as disabled, and SQLite `now()` ran outside callback policy.
   - Fix: live-query `data` and `state` now delegate to store-local signal
     sets bound with `runWithCollectionStore(...)`; hydration validates the
     full payload before mutating and delegates definition-owned snapshots to
     their definition Interface; public validation helpers are exposed through
     `Collection.validateHydrationPayloadEffect(...)`; registries normalize to
     `definition.name`; persistence diagnostics report default-enabled flags;
     and SQLite `now()` is routed through the typed callback seam.
   - Benefits: runtime/request Locality holds even with active subscriptions,
     hydration is all-or-nothing for malformed payloads, and registry and
     persistence diagnostics match actual Collection runtime behavior.

4. Start Action Transport, Manifest Wall, And Hydration Atomicity
   - Status: fixed.
   - Files: `packages/start/src/start-action-client.ts`,
     `packages/start/src/start-transport-protocol.ts`,
     `packages/start/src/start-manifest-wall.ts`,
     `packages/start/src/hydration.ts`,
     `packages/start/test/start.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: `StartAction.use(...)` erased serviceful fetch requirements when
     no transport runtime was provided, action response guards accepted
     tag-only malformed bodies and ref invalidations without `input`, route
     discovery included `.d.mts`/`.d.cts` declaration files, and malformed
     collection hydration could leave resources already applied.
   - Fix: StartAction instances preserve fetch requirements unless a runtime or
     transport runtime provides them; action response validation now checks
     tag-specific required fields, redirect/header shapes, and Ref target input
     fields; declaration variants are ignored by the manifest wall; and Start
     hydration validates resources and collections before applying either.
   - Benefits: Start client hovers expose the transport services callers still
     owe, malformed wire payloads fail in the typed transport channel, and SSR
     hydration no longer commits partial state after a later collection codec
     failure.

5. Devtools Panel And Collection Event Contract Truth
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `type-tests/framework.test-d.ts`, `docs/release-notes.md`,
     `docs/docs-drift-audit.md`.
   - Problem: Devtools collection-store event types omitted
     `CollectionChangeFeedFailure`, collection failure serialization did not
     detach its error payload, direct renderer panel inputs bypassed catalog
     normalization, `DevtoolsPanelMount.update(...)` docs described defaults
     instead of merge semantics, and current-facing docs still carried stale
     verification counts.
   - Fix: Devtools store events now include change-feed failures, serialization
     detaches their errors, public panel normalization is exported and applied
     to direct inputs, mount update JSDoc describes the merged current input,
     and current docs point at the latest verification gate.
   - Benefits: Devtools event ingestion, renderer inputs, browser-extension
     bridge docs, and LSP hover text now agree on the public contract.

Evidence:

- `pnpm typecheck` passed.
- Focused regressions passed:
  `pnpm exec vitest run packages/core/test/action.test.ts
  packages/db/test/live-query-collection.test.ts
  packages/db/test/collection-registry.test.ts
  packages/db/test/sqlite-persistence.test.ts packages/start/test/start.test.ts
  packages/start/test/file-route-modules.test.ts
  packages/devtools/test/devtools.test.ts` passed: 7 files / 185 tests.
- Solid-focused regressions passed:
  `pnpm exec vitest run packages/solid/test/router.test.ts
  packages/solid-db/test/solid-db.test.ts` passed: 2 files / 16 tests.
- Core server/action regressions passed:
  `pnpm exec vitest run packages/core/test/server.test.ts
  packages/core/test/action.test.ts` passed: 2 files / 34 tests.
- Full `pnpm verify` passed: 9 package builds, workspace typecheck, type
  tests, Effect-first source audit, 45 root test files / 511 tests,
  devtools-panel verify with 1 panel test, devtools-extension verify with 1
  extension test file / 11 tests, basic starter verify with 1 starter test file
  / 2 tests, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scans.
- Post-verify Promise-method grep reported no hits, DB/Solid DB raw schema
  audit matched only Collection Snapshot Codec decode normalization, runtime
  Promise docs remained host-boundary-only, ResourceFamily live-store checks
  showed Resource Family still delegates live state to Resource Runtime, and
  `git diff --check` passed.

## Review 53: Runtime Ownership, Batch Atomicity, And Devtools Event Truth

Status: fixed for the selected worktree items; remaining follow-ups are listed
explicitly below.

This review used five parallel subagent scans across Solid/Solid DB, Core,
Start, DB, and Devtools. The sweep again found actionable Module, Interface,
Seam, Adapter, and Locality work, so the clean-sweep counter still cannot
start.

1. Solid Runtime Ownership And Router Runtime Locality
   - Status: fixed.
   - Files: `packages/solid/src/runtime.ts`,
     `packages/solid/src/router.ts`, `packages/solid/src/link.ts`,
     `packages/solid/test/router.test.ts`,
     `packages/solid-db/src/shared.ts`,
     `packages/solid-db/src/collection.ts`,
     `packages/solid-db/src/live-query.ts`,
     `packages/solid-db/test/solid-db.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: `RuntimeProvider` could be given both an existing runtime and a
     source for a provider-owned runtime, route components could render without
     the router-owned Core ambient runtime, and `RouterLink` hover preloads used
     a broad runtime path that did not cancel stale hover work. Solid DB preload
     observer errors were also under-documented after the state signal changed.
   - Fix: made `runtime` and `source` mutually exclusive at the public prop
     type, kept provider-owned source disposal distinct from externally owned
     runtimes, rendered route components inside the router runtime, ran link
     hover preloads through that runtime, interrupted stale hover preload
     fibers, and documented the Solid DB preload observer policy.
   - Benefits: Solid adapter ownership, router Locality, hover preload
     lifecycle, and LSP-visible provider docs now describe the same runtime
     behavior.

2. Core Resource, Server, Action, And Route Contract Tightening
   - Status: fixed.
   - Files: `packages/core/src/resource-registry.ts`,
     `packages/core/src/resource-dependency-graph.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/request-context.ts`,
     `packages/core/src/server.ts`, `packages/core/src/action.ts`,
     `packages/core/src/action-submission.ts`, `packages/core/src/route.ts`,
     `packages/core/test/resource-registry.test.ts`,
     `packages/core/test/resource.test.ts`,
     `packages/core/test/route-server.test.ts`,
     `packages/core/test/action.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: Resource hydration still had mutation-before-late-failure risk in
     provided-tag planning, resource diagnostics reported schema capability
     truth too loosely, request/response host callback throws could escape
     server route typing, the server contract checker treated request/response
     context callback failures as domain-error requirements, action reset could
     hide runtime errors behind the captured runtime path, and route match docs
     did not state the sync decode throw seam.
   - Fix: split Resource hydration into validation/planning before mutation,
     derived provided tags before committing state, used real Schema checks for
     diagnostics, mapped request/response context host failures into typed
     server route errors, allowed `EffectInputCallbackError` as the server
     contract callback seam, made action reset mutate local submission state
     directly, and documented `Route.match(...)` sync decode behavior with the
     typed navigation alternative.
   - Benefits: Resource hydration is all-or-nothing across state and dependency
     tags, server host Adapter errors stay typed, action reset is local, and
     route hovers tell callers which Interface owns typed navigation failures.

3. Start Dev SSR Classification And Action Name Contracts
   - Status: fixed.
   - Files: `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/src/start-transport-protocol.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/index.ts`, `packages/start/test/start.test.ts`.
   - Problem: the Vite dev SSR middleware bypassed all dotted paths, so app
     routes with dots were misclassified as assets; explicit duplicate Start
     action names silently used the last definition in a `Map`.
   - Fix: replaced the blanket dotted-path bypass with known Vite/internal and
     asset prefixes plus request `Accept` handling, added a typed
     `StartActionDuplicateName` error, and rejected duplicate explicit action
     names when building the action map.
   - Benefits: app route URLs no longer fall out of dev SSR just because they
     contain a dot, and action-name collisions fail in the Start transport
     contract instead of becoming order-dependent behavior.

4. DB Collection Ownership, Registry Views, And Batch Application
   - Status: fixed.
   - Files: `packages/db/src/collection-state.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-registry.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/collection-registry.test.ts`.
   - Problem: collection rows could retain caller-owned object references
     across load/write/update paths, registry `definitions()` exposed a live
     mutable view, and `applyChangesEffect(...)` could partially mutate state or
     publish write facts before persistence failure finished.
   - Fix: cloned collection values on ingress and egress, returned detached
     registry definition maps, planned batch upserts before applying state,
     applied a single version bump, rolled state/version back on persistence
     failure, and suppressed write events for failed persisted batches.
   - Benefits: Collection State owns its rows, registry callers cannot mutate
     the Definition Registry through a returned view, and batch application now
     behaves as one Store transition from the public event stream.

5. Devtools Serialization, Runtime Events, And Extension Diagnostics
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/panels.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `examples/devtools-extension/src/panel-runtime.ts`,
     `examples/devtools-extension/src/extension.test.ts`.
   - Problem: serialization policy bounds accepted invalid numeric inputs,
     detached copies could lose Error and binary-buffer detail, runtime
     resource/collection facts were missing from panel summaries, and extension
     diagnostics collapsed structured errors to strings.
   - Fix: normalized serialization bounds to finite nonnegative integers,
     detached Error metadata and binary views by value, folded
     `ResourceStoreEvent` runtime facts into resource summaries, included
     runtime-event-only collections in collection panels, and preserved
     structured diagnostic error payloads in the extension panel runtime.
   - Benefits: Devtools snapshots and panels now agree with runtime facts, the
     extension can inspect richer failure payloads, and serialization policy is
     deterministic at the public boundary.

Known follow-ups:

- Decide whether Start streamed hydration should guarantee whole-document
  atomicity or document intentionally progressive semantics for partial streams.
- Add a DB optimistic mutation transaction stack for overlapping same-row
  mutations if the current last-writer behavior is not the intended model.
- Choose the DB query alias validation Interface: build-time throw versus a
  live-query failure state.

Evidence:

- `pnpm --filter @effect-ui/solid typecheck`, `pnpm --filter
  @effect-ui/solid-db typecheck`, `pnpm typecheck:types`, and `pnpm vitest run
  packages/solid/test/router.test.ts packages/solid-db/test/solid-db.test.ts`
  passed: 2 files / 19 tests.
- `pnpm --filter @effect-ui/core typecheck`, `pnpm --filter @effect-ui/db
  typecheck`, `pnpm --filter @effect-ui/devtools typecheck`, focused Core/DB
  and Devtools regressions, `pnpm --filter @effect-ui/start typecheck`,
  `pnpm vitest run packages/start/test/start.test.ts`,
  `pnpm devtools-extension:typecheck`, and `pnpm devtools-extension:test`
  passed.
- Full `pnpm typecheck` passed.
- Full `pnpm test` passed: 45 root test files / 532 tests.
- Full `pnpm verify` passed: 9 package builds, workspace typecheck, type
  tests, Effect-first source audit, 45 root test files / 532 tests,
  devtools-panel verify with 1 panel test, devtools-extension verify with 1
  extension test file / 12 tests, basic starter verify with 1 starter test file
  / 2 tests, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scans.

## Review 54: Hydration Semantics, Query Plan Validation, And Optimistic Row Rebase

Status: fixed in the current worktree.

This follow-up closed the three explicit Review 53 follow-ups. The sweep still
found actionable Interface and Locality work, so the clean-sweep counter still
cannot start.

1. Start Streamed Hydration Progressive Semantics
   - Status: fixed.
   - Files: `packages/start/src/hydration.ts`,
     `packages/start/test/start.test.ts`, `docs/architecture.md`.
   - Problem: the Start Hydration Transport did not state whether root plus
     streamed document hydration was a whole-document transaction or a
     progressive stream. The implementation already applied chunks in sequence,
     but the Interface left callers to infer rollback behavior.
   - Fix: documented progressive semantics at the streamed hydration options and
     Effect helpers, clarified architecture docs, and added a regression proving
     each payload validates before mutation while an already-applied earlier
     chunk remains applied if a later chunk fails. Consumed DOM markers are still
     written only after a full chunk scan succeeds.
   - Benefits: the Start Hydration Transport now has an honest Interface:
     atomicity is per payload, streaming remains progressive, and retry behavior
     is visible to browser Adapter authors.

2. DB Query Plan Alias Validation
   - Status: fixed.
   - Files: `packages/db/src/query-plan.ts`,
     `packages/db/src/query-builder.ts`,
     `packages/db/src/live-query-runtime.ts`,
     `packages/db/src/live-query-state.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: duplicate source/join aliases and missing join source aliases
     were accepted inconsistently. Diagnostics, one-shot execution, and live
     queries could disagree; live runtime construction could also throw before
     Live Query State converted failures to query state.
   - Fix: added shared Query Plan validation for duplicate aliases, missing join
     sources, mismatched join collections, and no-base-source join plans.
     `Query.onceEffect(...)` validates before preloading sources and maps plan
     failures to `QueryEvaluationError`; live query runtime creation is lazy so
     invalid plans surface as live query `Failure` state instead of accessor
     throws.
   - Benefits: Query Builder keeps one plan invariant policy. Diagnostics,
     one-shot queries, and Live Query State now report the same alias errors
     through their intended Interfaces.

3. DB Optimistic Same-Row Mutation Rebase
   - Status: fixed.
   - Files: `packages/db/src/collection-state.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/test/collection.test.ts`.
   - Problem: optimistic rollback used only the failed transaction's saved row
     snapshot. When two pending mutations touched the same row, an earlier
     failure could erase a later optimistic update, and an earlier success could
     mark a later pending row as synced by key.
   - Fix: added a row-keyed optimistic stack to Collection State. Collection
     Runtime appends patches when local mutations apply, rebases visible rows on
     commit/rollback, updates later pending rollback bases, folds committed
     patches into the base when possible, and marks a visible row synced only
     when no pending patch remains for that key. Restored pending mutations keep
     the existing snapshot fallback path.
   - Benefits: Collection Runtime now owns overlapping optimistic row locality.
     Pending transaction behavior is stable regardless of whether an earlier
     same-row mutation succeeds or fails first.

Evidence:

- `pnpm --filter @effect-ui/start typecheck` passed.
- `pnpm vitest run packages/start/test/start.test.ts` passed: 1 file / 89 tests.
- `pnpm --filter @effect-ui/db typecheck` passed.
- `pnpm vitest run packages/db/test/collection.test.ts` passed: 1 file / 58 tests.
- Full `pnpm typecheck` passed.
- Full `pnpm test` passed: 45 root test files / 537 tests.
- Full `pnpm verify` passed: 9 package builds, workspace typecheck, type
  tests, Effect-first source audit, 45 root test files / 537 tests,
  devtools-panel verify with 1 panel test, devtools-extension verify with 1
  extension test file / 12 tests, basic starter verify with 1 starter test file
  / 2 tests, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scans.

## Review 55: Atomicity, Host Boundaries, And Solid Runtime Locality

Status: fixed in the current worktree.

This fresh subagent sweep still found actionable Module, Interface, Seam,
Adapter, and Locality work, so the clean-sweep counter still cannot start.

1. DB Optimistic Base And Hydration Merge Policy
   - Status: fixed.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/live-query-collection.test.ts`.
   - Problem: remote loads, direct writes, and change-feed batches updated
     `state.rows` beside the optimistic row stack. A refetch during a pending
     local update could leave rollback bases stale, pending deletes could be
     resurrected, merge hydration could overwrite an existing pending
     transaction id, and Live Query Collections returned shallow row wrappers.
   - Fix: added one base-row application path that updates optimistic stack
     bases and rebases pending patches, rejects duplicate pending transaction
     ids during `{ replace: false }` hydration, and clones live-query collection
     egress/snapshot values.
   - Benefits: Collection Runtime now owns local optimistic visibility and
     remote base truth in one Module, and collection-like derived views honor
     the same row-detachment Interface as normal collections.

2. Core Resource And Action Atomicity
   - Status: fixed.
   - Files: `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource.ts`, `packages/core/src/action.ts`,
     `packages/core/test/resource.test.ts`, `packages/core/test/action.test.ts`.
   - Problem: resource refresh applied `Success` before `provides(...)` tag
     facts were safe, and Action invalidation refreshed resources before an
     optimistic commit could fail.
   - Fix: resource loads now compute provided tags before publishing success,
     while actions commit optimistic transactions before running resource
     invalidation plans. Core also exposes an Effect lookup for Resource
     families that prefers the active Resource Store.
   - Benefits: value state, tag facts, optimistic state, and invalidation side
     effects now move through their intended atomic seams.

3. Start Transport And Hydration Host Boundaries
   - Status: fixed.
   - Files: `packages/start/src/start-transport-protocol.ts`,
     `packages/start/src/hydration.ts`, `packages/start/src/hydration-dom.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: action response ref invalidation looked only in the process-wide
     Resource registry, JSON response construction could defect on non-JSON-safe
     values, custom hydration script ids were interpolated as raw HTML
     attributes, and empty hydration scripts/chunks were treated as missing.
   - Fix: action response hydration resolves Resource families through the
     active runtime store, JSON response construction maps stringify failures to
     Defect responses, hydration ids are attribute-escaped, and present empty
     DOM scripts now reach the typed parse-error seam.
   - Benefits: Start Adapters no longer leak process-global lookup or host JSON
     and DOM edge cases through transport Interfaces.

4. Devtools Serialization And Store Limits
   - Status: fixed.
   - Files: `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `examples/devtools-extension/src/panel-runtime.ts`,
     `examples/devtools-extension/src/extension.test.ts`.
   - Problem: hostile array proxies bypassed guarded serialization/copy paths,
     store history limits inherited `Array.slice` edge cases, and extension
     diagnostics read unknown error descriptions through an unguarded property
     access.
   - Fix: array serialization and detached copies now trap failures as
     `UninspectableObject`, store limits normalize once before trimming, and
     extension transport diagnostics guard description reads.
   - Benefits: Devtools inspection remains best-effort even for hostile values,
     and bounded histories have an explicit Store Interface.

5. Solid Runtime-Owned Streams, Suspense, And Live Query Dependencies
   - Status: fixed.
   - Files: `packages/solid/src/hooks.ts`,
     `packages/solid/test/hooks.test.ts`,
     `packages/solid-db/src/shared.ts`,
     `packages/solid-db/src/live-query.ts`,
     `packages/solid-db/test/solid-db.test.ts`,
     `type-tests/framework.test-d.ts`.
   - Problem: `useStream(...)` only accepted requirement-free streams,
     Suspense preloads were not owned by the Solid `UiScope`, and `useLiveQuery`
     looked reactive while only collection versions could trigger recompute.
   - Fix: `useStream(...)` now runs service-backed streams through the nearest
     runtime and UI scope, `useResourceSuspense(...)` throws a Promise derived
     from a scope-owned preload fiber, and `useLiveQuery(...)` accepts explicit
     Solid `deps` for query rebuilds while resubscribing source collections.
   - Benefits: Solid Adapters own their runtime-to-UI seams consistently across
     streams, resource Suspense, and DB live queries.

Evidence:

- Package typechecks passed for `@effect-ui/core`, `@effect-ui/db`,
  `@effect-ui/start`, `@effect-ui/devtools`, `@effect-ui/solid`, and
  `@effect-ui/solid-db`.
- Focused regressions passed: DB collection/live-query collection, Core
  resource/action, Start, Devtools plus extension, Solid hooks, and Solid DB.
- Full `pnpm typecheck` passed.
- Full `pnpm test` passed: 45 root test files / 554 tests.
- Full `pnpm verify` passed: 9 package builds, workspace typecheck, type
  tests, Effect-first source audit, 45 root test files / 554 tests,
  devtools-panel verify with 1 panel test, devtools-extension verify with 1
  extension test file / 13 tests, basic starter verify with 1 starter test file
  / 2 tests, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scans.

## Review 56: Runtime Ownership, Transport Semantics, And Devtools Import Safety

Status: fixed in the current worktree.

This fresh subagent sweep still found actionable Store, Runtime, Transport,
Adapter, and Summary seams, so the clean-sweep counter still cannot start.

1. DB Store-Local Optimistic Hydration And Change Feed Application
   - Status: fixed.
   - Files: `packages/db/src/collection-state.ts`,
     `packages/db/src/collection-snapshot-codec.ts`,
     `packages/db/src/collection-runtime.ts`,
     `packages/db/src/sync-adapter.ts`,
     `packages/db/test/collection.test.ts`,
     `packages/db/test/sync-adapter.test.ts`.
   - Problem: restored pending mutations did not reconstruct optimistic row
     overlays, Effect change-feed emitters resolved the Collection Store when
     run instead of when subscribed, and Query Sync cache invalidation failures
     could roll back already-committed remote mutations.
   - Fix: moved optimistic/base-row helpers into Collection State, restored
     pending overlays during snapshot application, bound Effect change-feed
     emitters to the subscribed Store, and made post-commit Query Sync
     invalidation best-effort.
   - Benefits: local pending state, feed emission, and remote mutation commit
     truth now stay attached to the right Collection Store and transaction
     seam.

2. Solid Runtime-Owned Disposal And Dynamic Source Preload
   - Status: fixed.
   - Files: `packages/solid/src/runtime.ts`,
     `packages/solid/src/router.ts`,
     `packages/solid/test/hooks.test.ts`,
     `packages/solid/test/router.test.ts`,
     `packages/solid-db/src/shared.ts`,
     `packages/solid-db/src/live-query.ts`,
     `packages/solid-db/test/solid-db.test.ts`.
   - Problem: `UiScope` disposal and route preload disposal used ambient
     `runFork`, RouterOutlet fallbacks rendered outside the route runtime/scope,
     and dynamic Solid DB source changes did not restart auto preload.
   - Fix: disposals now fork through the owning Solid runtime, every
     RouterOutlet state branch renders in a route `UiScope`, and dynamic
     live-query source refresh resubscribes and restarts source preload.
   - Benefits: UI lifecycle Locality now follows the runtime that created the
     scope, and Solid DB dependency changes refresh both subscriptions and
     preloaded source truth.

3. Core Reset, Delete, Finalizer, And Cookie Seams
   - Status: fixed.
   - Files: `packages/core/src/action-submission.ts`,
     `packages/core/src/resource-runtime.ts`,
     `packages/core/src/resource-store.ts`,
     `packages/core/src/request-context.ts`,
     `packages/core/test/action.test.ts`,
     `packages/core/test/resource.test.ts`,
     `packages/core/test/resource-store.test.ts`,
     `packages/core/test/route-server.test.ts`.
   - Problem: `resetEffect(...)` left active Action fibers alive, resource
     deletion left remembered inputs behind, one Resource Store finalizer
     failure could skip later finalizers, and response cookie attributes were
     interpolated without validation.
   - Fix: `resetEffect(...)` interrupts the active submission fiber before
     reset, resource deletion clears remembered inputs, store disposal runs all
     module finalizers before returning the first failure, and Set-Cookie
     attributes reject control characters, semicolons, and invalid dates/ages.
   - Benefits: Core lifecycle cleanup is now atomic where users observe it and
     best-effort where teardown owns multiple finalizers.

4. Start Action Metadata, Trace, And Accept Semantics
   - Status: fixed.
   - Files: `packages/start/src/start-transport-protocol.ts`,
     `packages/start/src/request-trace.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/test/start.test.ts`.
   - Problem: action response invalidation metadata could silently drop unknown
     or mismatched Resource refs, request trace cookie decoding could throw
     while building diagnostics, form actions ignored explicit JSON `Accept`,
     and Vite dev SSR used a shallow Accept parser that ignored `q=0`.
   - Fix: semantic invalidation ref failures now return typed
     `ServerTransportError`s, trace cookie projection decodes best-effort,
     form action redirects return typed JSON when explicitly requested, and dev
     SSR delegates HTML Accept parsing to the shared media-type parser.
   - Benefits: Start transport metadata is fail-closed, diagnostics stay
     best-effort, and response negotiation matches the client-visible
     progressive-enhancement contract.

5. Devtools Panel, Route-Plan, Summary, And Import Safety
   - Status: fixed.
   - Files: `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/src/serialization.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/route-plan-facts.ts`,
     `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/src/summary-app-graph.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `examples/devtools-extension/src/transport.ts`,
     `examples/devtools-extension/src/extension.test.ts`.
   - Problem: panel bridge normalization could recurse through cyclic or huge
     payloads, route-plan hydration collapsed identity to a count, summaries
     could expose nested app-graph data from the live Store snapshot, and
     imported snapshots bypassed Store history limits/rebasing.
   - Fix: panel contract normalization is cycle/depth/entry bounded, extension
     callbacks catch normalization failures, route-plan hydration carries
     hydrated resource keys, summaries copy Store snapshots before projection,
     app-graph summaries detach nested diagnostics, and imported snapshots now
     copy, stamp, trim, and rebase facts through the same Store limits.
   - Benefits: Devtools bridge and Store imports are total best-effort
     Adapters, and causal graph hydration edges now describe the resources that
     actually hydrated.

Evidence:

- Package typechecks passed for `@effect-ui/core`, `@effect-ui/db`,
  `@effect-ui/start`, `@effect-ui/devtools`, `@effect-ui/solid`, and
  `@effect-ui/solid-db`.
- Focused regressions passed: DB collection/sync adapter, Core
  action/resource/resource-store/route-server, Solid hooks/router, Solid DB,
  Start, Devtools, and the devtools extension.
- `pnpm typecheck` passed.
- `pnpm audit:effect-first` passed.
- Full `pnpm test` passed: 45 root test files / 571 tests.
- Full `pnpm verify` passed: 9 package builds, workspace typecheck, type
  tests, Effect-first source audit, 45 root test files / 571 tests,
  devtools-panel verify with 1 panel test, devtools-extension verify with 1
  extension test file / 14 tests, basic starter verify with 1 starter test file
  / 2 tests, project-console starter packaging, project-console typecheck, 4
  project-console test files / 23 tests, project-console build, and leak scans.

## Review 45: Core Type Truth, Devtools Graph Identity, And Dev SSR Origin Policy

1. Core Route Preload Requirement Surface
   - Status: fixed.
   - Files: `packages/core/src/route.ts`,
     `packages/solid/src/router.ts`, `packages/core/src/app.ts`,
     `packages/start/src/start-request-preload.ts`,
     `packages/start/src/start-request-handler.ts`,
     `packages/start/src/start-request-endpoints.ts`,
     `packages/start/src/request-runtime.ts`,
     `packages/start/src/virtual-modules.d.ts`,
     `type-tests/framework.test-d.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`,
     `docs/type-test-coverage-audit.md`.
   - Problem: `RouteDefinition` erased service requirements returned by
     `preload`, so `Route.preloadEffect(...)`,
     `Route.planPreloadEffect(...)`, and `Route.planNavigationEffect(...)`
     looked requirement-free even when preload used an Effect service.
   - Fix: added a fourth route-definition generic for preload requirements,
     inferred it from the concrete preload callback, and threaded it through the
     route planning APIs. Broad route collections now use an explicit fourth
     `any` parameter, while Solid erases only at its runtime Adapter boundary.
     The same pass made `route(path)` options-free definitions match safely at
     runtime while preserving inferred path params in type tests.
   - Benefits: LSP hovers now show when route preload needs services, and host
     adapters must consciously discharge those services through a Runtime Spine.

2. Core Action Runtime Binding
   - Status: fixed.
   - Files: `packages/core/src/action.ts`,
     `type-tests/framework.test-d.ts`, `CONTEXT.md`,
     `docs/public-api-inventory.md`,
     `docs/type-test-coverage-audit.md`.
   - Problem: `Action.use(definition, { runtime })` ran submissions on the
     captured runtime but still exposed the original action requirements in
     `submitEffect(...)`, while casting away the runtime error channel.
   - Fix: added a runtime-bound overload that removes services supplied by the
     explicit runtime, includes Resource Store provisioning, and widens the
     action error channel with the runtime error type.
   - Benefits: runtime-bound actions now describe the Effect they actually
     return instead of forcing users and agents to chase implementation casts.

3. Devtools Runtime Fact Targets And Edge Identity
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/store.ts`,
     `packages/devtools/src/fact-identity.ts`,
     `packages/devtools/src/summary-facts.ts`,
     `packages/devtools/src/causal-graph.ts`,
     `packages/devtools/src/graph-ids.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `docs/devtools.md`, `CONTEXT.md`,
     `docs/public-api-inventory.md`.
   - Problem: runtime `Invalidation` and `RoutePlan` event targets used the
     runtime-event array index as if it were the recorded fact index, producing
     phantom graph nodes when event and fact order diverged. Causal edge ids
     also used a global insertion counter, so unrelated earlier facts churned
     otherwise-stable edge ids.
   - Fix: runtime events can carry explicit invalidation/route-plan fact
     indexes, summary projection falls back by matching recorded facts, bounded
     history rebases those indexes, and causal edge ids now derive from
     kind/source/target/label plus duplicate ordinal.
   - Benefits: Devtools graphs stay stable for tests, panels, and agents, and
     runtime events observe existing fact nodes instead of synthesizing targets.

4. Start Vite Dev SSR Origin Policy
   - Status: fixed.
   - Files: `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/src/start-manifest-wall.ts`,
     `packages/start/src/vite.ts`,
     `packages/start/test/start.test.ts`,
     `CONTEXT.md`, `docs/public-api-inventory.md`.
   - Problem: the Vite dev SSR middleware converted Node requests without
     accepting the Node Adapter origin/forwarded-header policy, so dev and
     production host adapters could disagree about the public request URL.
   - Fix: added `nodeRequest` options to the dev SSR middleware and
     `EffectUiStartOptions`, then passed them through to
     `nodeRequestToWebRequestEffect(...)`.
   - Benefits: teams can make forwarded-header trust explicit in Vite dev just
     as they can in the Node adapter.

5. Resource Collector Hover Truth
   - Status: fixed.
   - Files: `packages/core/src/resource.ts`.
   - Problem: `Resource.collectEffect(...)` docs said collection happened
     through prefetch/read even though synchronous `Resource.read(...)` does not
     participate in the Effect collector service.
   - Fix: clarified that the collector records refs touched through
     prefetch/refresh Effects.
   - Benefits: LSP docs now describe the actual collector seam instead of
     implying hidden synchronous read tracking.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/core
typecheck`, `pnpm --filter @effect-ui/solid typecheck`, `pnpm --filter
@effect-ui/start typecheck`, `pnpm typecheck:types`, `pnpm vitest run
packages/core/test/route-server.test.ts packages/core/test/runtime.test.ts
packages/core/test/action.test.ts`, `pnpm vitest run
packages/solid/test/router.test.ts`, `pnpm vitest run
packages/start/test/start.test.ts packages/start/test/adapters.test.ts`, and
`pnpm vitest run packages/devtools/test/devtools.test.ts` passed.

## Review 34: Route And Devtools Raw DTO Hover Follow-Up

Status: fixed.

Findings:

1. Route Public Type Hover Depth
   - Status: fixed.
   - Files: `packages/core/src/route.ts`.
   - Problem: Route preload diagnostics, route type aliases, route options,
     params/search helpers, match plans, and href builders were correct but
     still sparse in LSP hovers. That left important intent discoverable only
     by reading implementation and tests.
   - Fix: added concise JSDoc around preload hints/status/diagnostics, route
     options, typed params/search helpers, route context, matched routes,
     navigation plans, and href options.
   - Benefits: route authors now get the purpose and lifecycle expectations of
     each public Interface directly from editor hovers.

2. Devtools Raw DTO And App Graph Hover Depth
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`.
   - Problem: Devtools raw snapshot, action, event, request-trace, and Start
     app graph DTOs were exposed as useful public inspection shapes but had
     shallow documentation. The JSON-safe projection docs were stronger than
     the raw inspection docs.
   - Fix: documented the raw Devtools DTO families, runtime event/action
     inputs, request trace snapshots, route plans, schema diagnostics, and
     Start app graph graph/diagnostic/policy shapes.
   - Benefits: agents and users inspecting Devtools data can distinguish raw
     captured runtime facts from projected panel summaries without leaving the
     type surface.

Full `pnpm verify` passed after this pass: 9 package builds, workspace
typecheck, type tests, 45 root test files / 454 tests, devtools-panel verify
with 1 panel test, devtools-extension verify with 1 extension test file / 7
tests, basic starter verify with 1 starter test, project-console starter
packaging, project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan. Post-verify raw schema-error,
Promise-method, immutable flag, ResourceFamily live-store, sync-load closure,
runtime Promise docs, and whitespace audits passed.

## Review 35: LSP Public Surface Hover Completion Follow-Up

Status: fixed.

Findings:

1. Start Streaming And Manifest Hover Depth
   - Status: fixed.
   - Files: `packages/start/src/streaming.ts`,
     `packages/start/src/server-function-manifest.ts`,
     `packages/start/src/action-manifest.ts`,
     `packages/start/src/start-transport-protocol.ts`.
   - Problem: Start's streaming SSR helpers and generated manifest contract
     types were exported from the public package but still hovered mostly as raw
     structure. The missing docs obscured shell/chunk/tail ordering, hydration
     sequencing, manifest module kinds, client-reference strategies, schema
     presence flags, and progressive action form helpers.
   - Fix: added concise JSDoc for HTML stream chunks/options/errors/constructors,
     server-function and action manifest ids/definitions/references/entries,
     action invalidation wire shapes, action-definition extraction helpers,
     hidden form fields, and request endpoint guards.
   - Benefits: Start's SSR and generated-artifact Interface is now explainable
     from editor hovers instead of forcing users or agents to infer policy from
     implementation.

2. Devtools Panel And Bridge Hover Depth
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`,
     `packages/devtools/src/bridge.ts`.
   - Problem: Devtools Store, serialization, and raw DTO docs had been deepened,
     but the panel UI/mount surface and inspected-window bridge provider still
     had thin hovers.
   - Fix: documented panel ids, severities, rendering options, mount options,
     mount handles, the bridge global key, and provider callback semantics.
   - Benefits: embedded panel shells and browser extensions can understand the
     Devtools bridge and renderer contract directly at the public Interface.

3. Core And DB Expert-Public Hover Depth
   - Status: fixed.
   - Files: `packages/core/src/capability.ts`,
     `packages/core/src/definition-registry.ts`,
     `packages/core/src/form.ts`, `packages/core/src/resource-registry.ts`,
     `packages/core/src/resource-snapshot-codec.ts`,
     `packages/core/src/resource-store.ts`, `packages/core/src/server.ts`,
     `packages/db/src/sqlite-persistence.ts`.
   - Problem: Core intentionally exports several expert-public runtime,
     registry, server serialization, form validation, and snapshot-codec
     helpers. Several of those symbols still hovered as signatures even though
     adapters, tests, Devtools, and generated manifests depend on their
     semantics.
   - Fix: added JSDoc for Resource Store events/state/modules, Resource snapshot
     codec operations and helpers, Core/Resource definition registry diagnostics,
     Form field/error helpers, Server mock/local client and schema encode/decode
     helpers, Capability test helpers, and SQLite persistence defaults plus
     namespace aliases.
   - Benefits: expert-public Modules now expose their intent and error/locality
     rules at the same seam where advanced users and agents consume them.

Focused evidence before full verification: `pnpm --filter @effect-ui/core
typecheck`, `pnpm --filter @effect-ui/db typecheck`, `pnpm --filter
@effect-ui/start typecheck`, `pnpm --filter @effect-ui/devtools typecheck`,
and `pnpm typecheck:types` passed. Full `pnpm verify` passed after this pass:
9 package builds, workspace typecheck, type tests, 45 root test files / 454
tests, devtools-panel verify with 1 panel test, devtools-extension verify with
1 extension test file / 7 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4 project-console
test files / 23 tests, project-console build, and leak scan. Post-verify raw
schema-error, Promise-method, immutable flag, ResourceFamily live-store,
sync-load closure, runtime Promise docs, and whitespace audits passed.

## Review 36: Effect-First Source Audit And Server Wire Codec

Status: fixed.

Findings:

1. Effect-First Source Audit Guardrail
   - Status: fixed.
   - Files: `package.json`, `scripts/audit-effect-first.mjs`,
     `CONTEXT.md`.
   - Problem: the project had a standing Effect-first rule and repeated manual
     Promise greps, but `pnpm verify` did not enforce where Promise host seams
     are allowed in package source. That made the Interface between library
     source and host platform Promise APIs a convention rather than a checked
     Module.
   - Fix: added `pnpm audit:effect-first`, wired it into `pnpm verify`, and
     encoded the approved package-source Promise seams explicitly: Solid
     Suspense, Fetch-native handlers, Vite hooks, CLI launch, Vite dev SSR
     Promise-shaped host interfaces, and Web Stream callbacks.
   - Benefits: Promise drift now fails the standard verification gate while
     still preserving explicit host Adapter seams.

2. Core Server Wire Codec Module
   - Status: fixed.
   - Files: `packages/core/src/server.ts`,
     `packages/core/src/server-wire-codec.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: the Core `Server` Module mixed callable construction, mock/local
     clients, route handling, schema encode/decode, RPC envelope decoding,
     manifest schema-presence projection, and defect/server-error
     serialization. That made the Server facade shallower than it needed to be:
     local clients, mocks, and Start transports shared policy only by going
     through a broad public namespace.
   - Fix: extracted `server-wire-codec.ts` for server-function schema
     encode/decode, RPC request/response envelope decoding, schema-presence
     manifest projection, and server defect/error serialization. The public
     `Server.*` helpers remain stable facade methods over the new Module.
   - Benefits: wire/schema behavior has Locality in one Core Module, while the
     Server facade keeps its higher-level contract, client, mock, and route
     Leverage.

Focused evidence before full verification: `pnpm --filter @effect-ui/core
typecheck`, `pnpm vitest run packages/core/test/server.test.ts
packages/core/test/route-server.test.ts packages/start/test/rpc.test.ts`,
`pnpm typecheck:types`, and `pnpm audit:effect-first` passed. Full `pnpm
verify` passed after this pass: 9 package builds, workspace typecheck, type
tests, effect-first source audit, 45 root test files / 454 tests,
devtools-panel verify with 1 panel test, devtools-extension verify with 1
extension test file / 7 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4 project-console
test files / 23 tests, project-console build, and leak scan. Post-verify raw
schema-error, Promise-method, immutable flag, ResourceFamily live-store,
sync-load closure, runtime Promise docs, and whitespace audits passed.

## Review 31: Runtime Spine Type Truth And LSP Hover Depth

1. Typed Runtime Spine Versus Host-Erased Runtime Runner
   - Status: fixed.
   - Files: `packages/core/src/runtime.ts`,
     `packages/core/src/action.ts`, `packages/solid/src/runtime.ts`,
     `packages/solid/src/hooks.ts`, `packages/solid/src/router.ts`,
     `packages/solid-db/src/shared.ts`, `packages/start/src/hydration.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/request-runtime.ts`,
     `packages/start/src/request-trace.ts`,
     `packages/start/src/request-trace-recorder.ts`,
     `packages/start/src/node-adapter.ts`,
     `type-tests/framework.test-d.ts`, `docs/public-api-inventory.md`,
     `CONTEXT.md`.
   - Problem: `EffectUiRuntime<unknown, ER>` was being used as the Interface
     for "some runtime" at Solid and Start host seams. After tightening the
     Runtime Spine, that spelling meant "a runtime that provides every service",
     which erased the distinction between typed app services and host-boundary
     runtime plumbing.
   - Fix: `EffectUiRuntime<R, ER>.provide(...)` now removes only services in
     `R` plus the Resource Store, and `runFork(...)`/`runSync(...)` only accept
     Effects whose requirements are satisfied by the runtime. Added the explicit
     `AnyEffectUiRuntime<ER>` Adapter Interface for ambient Solid contexts,
     hydration, Node/fetch host facades, and request tracing where the concrete
     app service set cannot be named.
   - Benefits: TypeScript and LSP hovers now show whether a Runtime Spine truly
     provides a service. Missing services remain visible in the Effect
     requirement channel, while host Adapters still have an honest erased runner
     for platform boundaries.

2. Start Transport Runtime Requirements
   - Status: fixed.
   - Files: `packages/start/src/start-fetch.ts`,
     `packages/start/src/start-rpc-client.ts`,
     `packages/start/src/start-action-client.ts`,
     `packages/start/src/start-transport-protocol.ts`,
     `type-tests/framework.test-d.ts`, `docs/public-api-inventory.md`,
     `CONTEXT.md`.
   - Problem: service-backed `StartFetch<E, R>` requirements were preserved in
     the low-level fetch type, but RPC clients hid those requirements behind the
     core `ServerClient` Interface and action submissions did not reflect that a
     provided runtime discharged transport requirements.
   - Fix: RPC client and layer creation now require `transportRuntime` when the
     fetch Effect has requirements. Start action submission has overloads that
     preserve fetch requirements when no runtime is supplied and return a
     requirement-free Effect when `runtime` or `transportRuntime` supplies the
     transport services.
   - Benefits: transport Adapters remain Effect-first without a hidden
     requirement leak, and editor hovers now explain whether callers must provide
     auth/tracing/test services before running a Start action.

3. LSP Documentation For Public Concepts
   - Status: fixed for the high-leverage hover gaps found in this pass.
   - Files: `packages/core/src/action-result.ts`,
     `packages/core/src/action.ts`, `packages/core/src/signal.ts`,
     `packages/core/src/request-context.ts`,
     `packages/db/src/collection-contract.ts`,
     `packages/db/src/query-builder.ts`, `packages/solid/src/hooks.ts`,
     `packages/solid/src/router.ts`.
   - Problem: several important public object literals and Interfaces had
     useful top-level docs but weak member-level hover text. That made the LSP
     less helpful exactly where users write options objects: actions, action
     results, signals, request/response context, collections, queries, and Solid
     bindings.
   - Fix: added member-level JSDoc for action result variants/helpers, action
     definition fields, signal dependency/stream/watch APIs, request and
     response context services, collection option fields, query builder methods
     and filter helpers, Solid resource handles, and browser router methods.
   - Benefits: the public Interface now carries more intent in editor hovers,
     reducing the need to jump into implementation files to understand what an
     option or helper is for.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/core
typecheck`, `pnpm --filter @effect-ui/db typecheck`, `pnpm --filter
@effect-ui/solid typecheck`, `pnpm --filter @effect-ui/start typecheck`,
`pnpm --filter @effect-ui/starter-basic typecheck`, `pnpm --filter
@effect-ui/example-project-console typecheck`, and `pnpm typecheck:types`
passed during implementation. Full `pnpm verify` passed: 9 package builds,
workspace typecheck, type tests, 45 root test files / 454 tests,
devtools-panel verify with 1 panel test, devtools-extension verify with 1
extension test file / 7 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4
project-console test files / 23 tests, project-console build, and leak scan.
Post-verify DB/Solid DB raw schema-error grep, Promise-method grep, immutable
flag audit, ResourceFamily live-store/sync-load closure grep, runtime Promise
docs grep, and `git diff --check` passed.

## Review 32: Start And Devtools LSP Surface Follow-Up

1. Start File-Route And App-Graph Hover Docs
   - Status: fixed.
   - Files: `packages/start/src/file-routes.ts`,
     `packages/start/src/app-graph.ts`,
     `packages/start/src/virtual-modules.d.ts`.
   - Problem: file-route ids, manifest entries/modules, app graph diagnostics,
     and virtual-module route type aliases were public but still sparse in LSP
     hovers. Users could see the types but not the route-vs-layout/module role,
     static-vs-runtime diagnostic, or broad-virtual-vs-precise-generated
     distinction without reading implementation files.
   - Fix: added JSDoc to file-route branded ids, module/entry/manifest fields,
     manifest generation/validation helpers, app graph diagnostic types, and
     virtual module exports/type aliases.
   - Benefits: generated route tooling and virtual modules now explain their
     artifact boundaries directly in editor hovers.

2. Start RPC Transport Hover Docs
   - Status: fixed.
   - Files: `packages/start/src/rpc.ts`.
   - Problem: public Start transport paths, media types, request/trace headers,
     diagnostics, and validation helpers were exposed without concise hover
     text. The status mapping for method, accept, and content-type failures was
     discoverable only by reading the implementation.
   - Fix: documented the RPC/action endpoints, protocol and diagnostics
     headers, media-type constants, request-id helpers, request/response
     diagnostics helpers, and validation helpers including their 405/406/415
     error roles.
   - Benefits: host Adapter authors can understand the Start transport protocol
     from LSP hover docs without chasing constants across the module.

3. Devtools Serialization Hover Docs
   - Status: fixed.
   - Files: `packages/devtools/src/serialization.ts`.
   - Problem: public serialization and detached-copy helpers did the important
     bridge-safety work, but hovers did not explain JSON-safe projection versus
     detached DTO copying.
   - Fix: added JSDoc for `toDevtoolsSerializableValue(...)`, invalidation,
     route-plan, request-trace, runtime-event, app-graph, and snapshot copy or
     projection helpers.
   - Benefits: Devtools bridge and panel authors can distinguish live Core
     values from detached, JSON-safe panel DTOs at the Interface.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/start
typecheck`, `pnpm --filter @effect-ui/devtools typecheck`, and `pnpm
typecheck:types` passed during implementation. Full `pnpm verify` passed: 9
package builds, workspace typecheck, type tests, 45 root test files / 454
tests, devtools-panel verify with 1 panel test, devtools-extension verify with
1 extension test file / 7 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4
project-console test files / 23 tests, project-console build, and leak scan.
Post-verify DB/Solid DB raw schema-error grep, Promise-method grep, immutable
flag audit, ResourceFamily live-store/sync-load closure grep, runtime Promise
docs grep, and `git diff --check` passed.

## Review 33: Collection Event And Devtools Store Hover Follow-Up

1. Collection Store Event Semantics
   - Status: fixed.
   - Files: `packages/db/src/collection-contract.ts`.
   - Problem: `CollectionStoreEvent` is an important public event contract for
     devtools and tests, but the variants did not explain count, transaction,
     pending, or error payload meanings.
   - Fix: documented each event variant with the lifecycle moment and payload
     semantics.
   - Benefits: event consumers can understand load, hydration, persistence,
     mutation queue, commit, rollback, and direct-write events from LSP hovers.

2. Devtools Store Surface
   - Status: fixed.
   - Files: `packages/devtools/src/index.ts`.
   - Problem: `makeDevtoolsStore(...)` returned an inferred anonymous API and
     store options/summary/panel inputs had sparse hover text.
   - Fix: exported documented `DevtoolsStore`, documented retention limits,
     summary/panel input roles, and annotated `makeDevtoolsStore(...)` with the
     named store type.
   - Benefits: Devtools users now see the store as a named Interface with
     documented bounds and projection responsibilities instead of an anonymous
     structural return type.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/db
typecheck`, `pnpm --filter @effect-ui/devtools typecheck`, and `pnpm
typecheck:types` passed during implementation. Full `pnpm verify` passed: 9
package builds, workspace typecheck, type tests, 45 root test files / 454
tests, devtools-panel verify with 1 panel test, devtools-extension verify with
1 extension test file / 7 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4
project-console test files / 23 tests, project-console build, and leak scan.
Post-verify DB/Solid DB raw schema-error grep, Promise-method grep, immutable
flag audit, ResourceFamily live-store/sync-load closure grep, runtime Promise
docs grep, and `git diff --check` passed.

## Review 29: Projection Callbacks, Render Callbacks, And LSP Truth

1. Core Form Validation Callback Policy
   - Status: fixed.
   - Files: `packages/core/src/form.ts`,
     `packages/core/src/action-result.ts`,
     `packages/core/test/form.test.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: form validators were EffectInput-shaped but synchronous throws
     could bypass the same callback normalization used by Action, Resource,
     Server, Collection, and Start. `ActionResult.validateFormEffect(...)`
     also still advertised validation errors without the callback-error member.
   - Fix: routed validators through `invokeEffectInput("Form.validate", ...)`,
     mapped `EffectInputCallbackError` into `FormValidationError` and form
     state, and widened ActionResult's form-validation result type to match the
     actual Form Interface.
   - Benefits: Form validation now has one typed callback policy, and the
     progressive-action validation bridge reflects the same error surface that
     LSP users see on `FormInstance.validateEffect(...)`.

2. Collection Projection Callback Policy
   - Status: fixed.
   - Files: `packages/db/src/collection-runtime.ts`,
     `packages/db/test/collection.test.ts`, `docs/public-api-inventory.md`,
     `CONTEXT.md`.
   - Problem: row projection callbacks such as `getKey` and functional
     `CollectionUpdate` bodies ran directly inside Effect-returning collection
     operations. Synchronous throws could become defects even though
     `CollectionRuntimeError` already included `EffectInputCallbackError`.
   - Fix: added a Collection Runtime projection helper that wraps store
     initialization, `getKey`, load replacement, direct writes, inserts, and
     update projections in `EffectInputCallbackError` failures.
   - Benefits: collection Effect APIs keep row identity and update projection
     failures in the declared error channel while sync read helpers remain
     sync and rely on pure, total projections.

3. Start Render And Dev SSR Handler Surface
   - Status: fixed.
   - Files: `packages/start/src/start-request-handler.ts`,
     `packages/start/src/start-vite-dev-ssr.ts`,
     `packages/start/test/start.test.ts`, `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: custom SSR render callbacks could throw before entering a typed
     Start error seam, and the Vite dev SSR handler type appeared to allow
     service-requiring Effects even though the dev middleware does not provide
     app services.
   - Fix: render callbacks now run through the EffectInput callback seam while
     preserving the Request Runtime boundary; sync render throws become
     `EffectInputCallbackError` causes inside `StartRequestHandlerError`.
     Type tests now reject service-requiring `StartSsrRequestHandler` Effects.
   - Benefits: request render failures are Adapter-local typed data, and the
     dev SSR Interface no longer promises unprovided service requirements.

4. Devtools Panel Contract Trap Safety And Snapshot Docs
   - Status: fixed.
   - Files: `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/src/index.ts`,
     `packages/devtools/test/devtools.test.ts`, `docs/devtools.md`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: bridge payload guards could still throw on hostile
     inspected-window values such as proxies or throwing getters, and docs
     overstated JSON-safety for raw snapshots that intentionally carry detached
     `unknown` facts.
   - Fix: panel guards now read properties, prototypes, and enumerable values
     through trap-safe helpers and normalize invalid bridge payloads to
     `undefined`. Devtools docs/JSDoc now distinguish raw snapshots from the
     JSON-safe summary, causal graph, panel, and bridge projections.
   - Benefits: browser-extension and app-shell Adapters can validate untrusted
     inspected-window values without leaking defects, and LSP docs describe the
     actual snapshot boundary.

5. Runtime And Generated Route Public Pins
   - Status: fixed.
   - Files: `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`.
   - Problem: the public inventory still named removed Promise runner APIs on
     the Runtime Spine, and type tests did not pin the generated route writer
     and generated route artifact helper family.
   - Fix: documented `EffectUiRuntime.provide(...)` plus host-owned
     `Effect.runPromise(runtime.provide(...))` as the Promise boundary, added a
     deletion test for the removed runtime Promise runner, and pinned
     `createGeneratedFileRouteDefinitionsModule(...)`,
     `FileRouteDefinitionsModuleInvalidIdentifier`,
     `writeFileRouteDefinitionsFileEffect(...)`, and
     `FileRouteDefinitionsFileWriteError`.
   - Benefits: the expert-public LSP surface matches the implementation and
     keeps generated route IO explicitly Effect-first.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/core
typecheck`, `pnpm --filter @effect-ui/db typecheck`, `pnpm --filter
@effect-ui/start typecheck`, `pnpm typecheck:types`, `pnpm vitest run
packages/core/test/form.test.ts packages/core/test/action.test.ts`, `pnpm
vitest run packages/db/test/collection.test.ts`, `pnpm vitest run
packages/devtools/test/devtools.test.ts examples/devtools-extension/src/extension.test.ts`,
and `pnpm vitest run packages/start/test/start.test.ts
packages/start/test/file-route-modules.test.ts` passed. Full `pnpm verify`
passed: 9 package builds, workspace typecheck, type tests, 45 root test files /
447 tests, devtools-panel verify with 1 panel test, devtools-extension verify
with 1 extension test file / 7 tests, basic starter verify with 1 starter test,
project-console starter packaging, project-console typecheck, 4 project-console
test files / 23 tests, project-console build, and leak scan. Post-verify raw
schema-error, Promise-method, immutable flag, ResourceFamily live-store,
sync-load closure, and whitespace audits passed.

## Review 27: Host Adapter Split, Snapshot Interfaces, And Devtools Contracts

1. Devtools Panel Contract Module
   - Status: fixed.
   - Files: `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/src/panel-renderer.ts`,
     `packages/devtools/src/index.ts`,
     `examples/devtools-extension/src/transport.ts`,
     `examples/devtools-extension/src/extension.test.ts`,
     `packages/devtools/test/devtools.test.ts`, `docs/devtools.md`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: inspected-window extension transport and panel rendering shared
     the same panel ids, severities, metric/item shapes, and JSON-safe data
     rules, but validation lived in the extension example. That made the
     browser-extension Adapter deeper than the package contract and invited
     future drift between app-side, extension-side, test, and renderer hosts.
   - Fix: added the shared Devtools Panel Contract Module with panel guards and
     `normalizeEffectUiDevtoolsBridgePayload(...)`. The renderer, extension
     transport, public root export, tests, docs, and type tests now consume the
     same Interface.
   - Benefits: panel payload validation has Locality in devtools. Browser
     extensions remain Adapters, while agents and app shells can rely on the
     same public contract.

2. Collection Snapshot Interface And Live Query Collection Stability
   - Status: fixed.
   - Files: `packages/db/src/collection-persistence.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/test/live-query-collection.test.ts`, `CONTEXT.md`.
   - Problem: collection dehydration/hydration still reached through
     store-backed helpers, even when given a read-only Live Query Collection
     whose Definition already exposed snapshot/hydrate Effects. Live Query
     Collections also recreated state/version Signals when callers read the
     accessors, making their Definition Interface less stable than normal
     collections.
   - Fix: collection persistence now calls the Collection Definition-owned
     snapshot/hydrate Interface. Live Query Collections materialize state and
     version Signals once and return stable references. Regressions cover stable
     signals and dehydration through the Definition Interface.
   - Benefits: persistence callers depend on the Collection Snapshot Interface
     instead of a writable Collection Store detail. Read-only derived
     collections can satisfy the contract without pretending to own normal row
     mutation state.

3. Solid Router Runtime-Bound Public Preload
   - Status: fixed.
   - Files: `packages/solid/src/router.ts`, `packages/solid/test/router.test.ts`.
   - Problem: the public `BrowserRouter.preloadEffect(...)` method returned the
     raw core route preload Effect, so users could obtain an unbound Effect that
     still required services already installed in the Solid router runtime.
   - Fix: `preloadEffect(...)` now provides the router Runtime Spine before
     returning the Effect, and the regression installs a route service through a
     Layer to prove the public preload method is runtime-bound.
   - Benefits: the Solid Router Adapter owns its host runtime seam. Callers can
     stay Effect-first without manually re-providing services that the router
     already owns.

4. Start Host Adapter Module Split
   - Status: fixed.
   - Files: `packages/start/src/start-host-adapter.ts`,
     `packages/start/src/fetch-adapter.ts`,
     `packages/start/src/node-adapter.ts`,
     `packages/start/src/adapters.ts`, `packages/start/package.json`,
     `packages/start-fetch/src/index.ts`, `packages/start-node/src/index.ts`,
     `tsconfig.base.json`, `vitest.config.ts`,
     `packages/start/test/adapters.test.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: the previous `adapters.ts` Module mixed fetch-only and Node-only
     host behavior. Fetch facade users could traverse a source Module with
     Node imports, while synchronous root handler throws were not normalized
     through the same `StartRequestHandlerError` channel as Effect failures.
   - Fix: extracted a small Start Host Adapter Core for handler invocation and
     error normalization, then split fetch and Node host adapters into separate
     exported subpaths. The old `./adapters` path remains a compatibility
     facade. Tests assert sync throw normalization and that the packaged fetch
     facade points at the fetch-only module.
   - Benefits: host-specific imports now match host-specific Modules. The
     fetch Adapter remains Node-free, the Node Adapter owns Node IO, and the
     shared error seam has one Implementation.

5. Start Fetch Transport Failure Normalization
   - Status: fixed.
   - Files: `packages/start/src/start-fetch.ts`,
     `packages/start/test/rpc.test.ts`, `packages/start/test/start.test.ts`,
     `CONTEXT.md`.
   - Problem: custom transport header callbacks, `Headers` construction, and
     custom fetch implementations could throw synchronously before the Start
     RPC/action client entered the normal Effect failure path.
   - Fix: header resolution and fetch invocation now run through `Effect.try`
     and map setup/network failures to `ServerTransportError`. RPC and action
     client regressions prove caller `onError` hooks receive the normalized
     transport error.
   - Benefits: the Start Fetch Transport Adapter has a coherent error contract:
     setup and network failures are transport failures, while protocol/domain
     results stay in the typed Start Transport Protocol.

6. Generated Route Artifact And Devtools Graph LSP Docs
   - Status: fixed.
   - Files: `packages/start/src/virtual-modules.d.ts`,
     `packages/devtools/src/index.ts`,
     `type-tests/framework.test-d.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: LSP-facing docs did not clearly distinguish broad Vite virtual
     route typings from the precise written generated route artifact. Devtools
     causal graph kind/node/edge exports also lacked hover docs and type-test
     pins, making an important expert-public inspection Interface easy to miss.
   - Fix: documented `virtual:effect-ui/routes` as broad by design and
     `routeTree.gen.ts` as the app-specific typed route surface. Added hover
     docs for Devtools causal graph kind/node/edge contracts and type tests for
     generated route helpers, virtual routes, host adapter subpaths, panel
     guards, bridge normalization, and causal graph kind unions.
   - Benefits: editors now show the intended Interface boundaries. Agents and
     adapter authors get the precise route artifact for app-specific work and
     the devtools graph contract for inspection UIs.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/devtools
typecheck`, `pnpm vitest run packages/devtools/test/devtools.test.ts`,
`pnpm devtools-extension:verify`, `pnpm --filter @effect-ui/db typecheck`,
`pnpm vitest run packages/db/test/live-query-collection.test.ts
packages/db/test/collection.test.ts`, `pnpm --filter @effect-ui/solid
typecheck`, `pnpm vitest run packages/solid/test/router.test.ts`, `pnpm
--filter @effect-ui/start typecheck`, `pnpm --filter @effect-ui/start-fetch
typecheck`, `pnpm --filter @effect-ui/start-node typecheck`, `pnpm vitest run
packages/start/test/adapters.test.ts`, `pnpm vitest run
packages/start/test/rpc.test.ts packages/start/test/start.test.ts
packages/start/test/adapters.test.ts`, and `pnpm typecheck:types` passed. Full
`pnpm verify` passed: 9 package builds, workspace typecheck, type tests, 45
root test files / 433 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 6 tests, basic starter
verify with 1 starter test, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan. DB/Solid DB raw schema-error grep,
source Promise-method grep, immutable flag audit, ResourceFamily live-store
grep, sync-load closure grep, and `git diff --check` passed after
verification.

## Review 28: Callback Seams, Generated IO, And Bridge Validation

1. Core UI Lifecycle Callback Seam
   - Status: fixed.
   - Files: `packages/core/src/scope.ts`, `packages/core/src/signal.ts`,
     `packages/core/test/scope.test.ts`, `CONTEXT.md`.
   - Problem: `UiScope.addFinalizer(...)` invoked pure finalizer callbacks at
     registration time, and `watch(...)` invoked the watcher callback before it
     entered the scoped Effect fiber. Effect-returning callbacks usually masked
     the bug, but pure cleanup and synchronous watcher throws lived outside the
     lifecycle callback seam.
   - Fix: routed finalizers and watcher callbacks through
     `invokeEffectInput(...)`. Pure finalizers are now deferred until
     `disposeEffect(...)`, and watcher callback throws are captured in the
     Effect error channel of the scoped fiber instead of escaping signal
     notification.
   - Benefits: UI lifecycle Locality is in Core, not in caller discipline.
     Framework adapters can register plain cleanup and watch callbacks without
     creating out-of-band throws.

2. Action Callback Policy
   - Status: fixed.
   - Files: `packages/core/src/action.ts`,
     `packages/core/test/action.test.ts`,
     `type-tests/framework.test-d.ts`, `docs/public-api-inventory.md`,
     `CONTEXT.md`.
   - Problem: `Action.run(...)` had `EffectInputCallbackError`
     normalization, but `optimistic(...)` and `invalidates(...)` callbacks
     were invoked directly. Synchronous throws could become defects or escape
     action state even though `ActionInstance.state` already advertised the
     callback error seam.
   - Fix: added shared Action callback error construction, wrapped optimistic
     and invalidation callbacks in typed Effect failures, and exposed
     `Action.planInvalidationEffect(...)` for Effect-first invalidation
     planning. Regressions prove sync throws in both callbacks fail
     `submitEffect(...)` and record action failure state.
   - Benefits: Action user-defined work now follows one callback policy across
     run, optimistic patching, and invalidation planning.

3. Live Query Collection Snapshot Persistence
   - Status: fixed.
   - Files: `packages/db/src/collection-persistence.ts`,
     `packages/db/src/live-query-collection.ts`,
     `packages/db/test/live-query-collection.test.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: Live Query Collection persistence encoded and wrote snapshots
     through a local EffectInput conversion, duplicating storage callback policy
     from the Collection Persistence Module and missing
     `EffectInputCallbackError` normalization for synchronous storage Adapter
     throws.
   - Fix: introduced `persistCollectionSnapshotEffect(...)` in the shared
     persistence Module. Normal collections use it inside the store/event
     workflow, and Live Query Collections use it directly through their
     Definition-owned snapshot Interface.
   - Benefits: snapshot storage behavior has one Module and one Adapter error
     policy, while read-only Live Query Collections still avoid pretending to
     own a writable Collection Store.

4. Devtools Panel Contract JSON-Safety
   - Status: fixed.
   - Files: `packages/devtools/src/panel-contract.ts`,
     `packages/devtools/test/devtools.test.ts`,
     `type-tests/framework.test-d.ts`, `docs/devtools.md`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: bridge payload validation accepted any number and any enumerable
     object. That allowed `NaN`, infinities, `Date`, `Map`, `Set`, and `Error`
     values through the inspected-window bridge even though the Devtools
     Serialization Policy tags those host values before they become JSON-safe
     panel data.
   - Fix: tightened `isDevtoolsSerializableValue(...)` to finite numbers,
     arrays, and plain records, and tightened panel metric numbers the same
     way. Type tests now pin every exported Panel Contract guard and public
     id/severity union.
   - Benefits: panel validation, serialization docs, extension transport, and
     renderer assumptions now agree at the public Interface.

5. Generated Route Definitions File Writer And LSP Artifact
   - Status: fixed.
   - Files: `packages/start/src/file-route-modules.ts`,
     `packages/start/src/generated-route-definitions.ts`,
     `packages/start/src/vite.ts`,
     `packages/start/test/file-route-modules.test.ts`,
     `examples/project-console/src/routeTree.gen.ts`,
     `docs/public-api-inventory.md`, `CONTEXT.md`.
   - Problem: the precise generated route artifact still emitted bare exports
     without hover docs, and generated route file writes used synchronous Node
     filesystem calls with raw thrown errors.
   - Fix: the generator now emits concise JSDoc for the route arrays, lookup
     maps, metadata, and helper type aliases. The file writer now has
     `writeFileRouteDefinitionsFileEffect(...)` and
     `FileRouteDefinitionsFileWriteError`, while the existing sync writer
     remains the Vite host-hook facade.
   - Benefits: the app-specific route artifact is self-describing where users
     and agents hover it, and CI/agent tooling can use a typed Effect seam for
     generated-file IO diagnostics.

6. Node And Extension Host Sync-Throw Normalization
   - Status: fixed.
   - Files: `packages/start/src/node-adapter.ts`,
     `packages/start/test/adapters.test.ts`,
     `examples/devtools-extension/src/transport.ts`,
     `examples/devtools-extension/src/extension.test.ts`, `CONTEXT.md`.
   - Problem: Node response status/header writes happened inside
     `Effect.sync(...)`, so setter/header throws became defects instead of
     `StartNodeAdapterError`. A custom Node runtime whose `runFork(...)` threw
     synchronously also skipped `onError`. The Devtools extension example could
     likewise die if `chrome.devtools.inspectedWindow.eval(...)` threw before
     invoking its callback.
   - Fix: response status/header writes now use `Effect.try(...)`; the Node
     callback facade catches synchronous runtime fork throws and reports them
     through the configured error hook using the default runtime; the extension
     transport maps synchronous `eval(...)` throws to
     `DevtoolsExtensionTransportError`.
   - Benefits: host-boundary failures remain typed and local to their Adapters,
     and examples continue to teach the Effect-first host Adapter pattern.

Focused workspace evidence for this pass: `pnpm --filter @effect-ui/core
typecheck`, `pnpm --filter @effect-ui/db typecheck`, `pnpm --filter
@effect-ui/devtools typecheck`, `pnpm --filter @effect-ui/start typecheck`,
`pnpm vitest run packages/core/test/scope.test.ts
packages/core/test/action.test.ts`, `pnpm vitest run
packages/db/test/live-query-collection.test.ts`, `pnpm vitest run
packages/devtools/test/devtools.test.ts`, `pnpm vitest run
packages/start/test/adapters.test.ts`, `pnpm vitest run
examples/devtools-extension/src/extension.test.ts`, `pnpm vitest run
packages/start/test/file-route-modules.test.ts`, `pnpm typecheck:types`, and
`pnpm --filter @effect-ui/example-project-console build` passed. Full `pnpm
verify` passed: 9 package builds, workspace typecheck, type tests, 45 root
test files / 442 tests, devtools-panel verify with 1 panel test,
devtools-extension verify with 1 extension test file / 7 tests, basic starter
verify with 1 starter test, project-console starter packaging,
project-console typecheck, 4 project-console test files / 23 tests,
project-console build, and leak scan. DB/Solid DB raw schema-error grep,
source Promise-method grep, immutable flag audit, ResourceFamily live-store
grep, sync-load closure grep, and `git diff --check` passed after
verification.
