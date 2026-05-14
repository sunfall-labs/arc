# Docs Drift Audit

Last updated: 2026-05-14.

This audit checks release-tracking docs for claims that no longer match the
implementation after the request trace, Effect-first, typed-error, package
hygiene, generated-artifact, public-API, example cleanup, starter packaging,
devtools extension, inspected-window bridge, release metadata, and Start
lifecycle sweeps.

## Current Sweep Results

- Updated request-trace docs that still described richer teardown facts as a
  future gap.
- Updated the release-candidate slice list so it no longer asks for removed
  Promise `.then(...)` internals or already-shipped teardown facts.
- Updated the cleanup backlog so the generated artifact determinism audit points
  at the completed audit artifact instead of remaining unchecked.
- Updated final handoff evidence to point at the latest full `pnpm verify`
  result after API, core, and example cleanup.
- Updated release-candidate tracking after richer starter packaging, checked
  devtools extension packaging, CLI Effect-runner hardening, tagged CLI usage
  errors, and Start stream/Vite diagnostics lifecycle Effect sweeps.
- Updated devtools docs, release notes, public API inventory, and extension
  README after adding the inspected-window bridge and the public
  `installDevtoolsBridgeEffect(...)` app-side helper.
- Updated package hygiene, public API inventory, release notes, and the progress
  ledger after adding private `UNLICENSED` metadata across workspace manifests.
- Updated sharp-edge audits after removing remaining `as any`, raw throw
  sentinels, and low-friction Promise-method test helpers.
- Updated the progress ledger current-status summary so the clean-sweep gate is
  still open for the right reason: recent sweeps found actionable work beyond
  the earlier benchmark baseline and bridge/metadata slices.
- Left older checkpoint counts in place only where they explicitly describe
  historical evidence from that checkpoint; current verification counts are
  recorded in the verification gate and progress ledger.

## Verification Evidence

- Drift search:
  - `rg -n "not committed yet|not committed|future inspected|sample-data shell|browser extension.*future|live inspected app transport|remaining|Remaining|still open|future work|TODO|FIXME|Promise-first|315 tests|316 tests|319 tests" docs README.md examples -g '*.md'`
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(|non-Effect|raw Error|TypeError|runtime-disposed marker|stream close paths|response stream-close|UNLICENSED|__EFFECT_UI_DEVTOOLS__" docs README.md examples -g '*.md'`
- Updated files:
  - `README.md`
  - `docs/ultimate-goal-checklist.md`
  - `docs/perfection-progress.md`
  - `docs/framework-perfection-charter.md`
  - `docs/public-api-inventory.md`
  - `docs/devtools.md`
  - `docs/effect-first-audit.md`
  - `docs/error-message-audit.md`
  - `docs/package-hygiene-audit.md`
  - `docs/release-notes.md`
  - `docs/sharp-cast-audit.md`
  - `examples/devtools-extension/README.md`

## Follow-Up

- Re-run this audit before any release-candidate handoff.
- Add a docs-specific check script if drift patterns stabilize into repeatable
  grep rules.
