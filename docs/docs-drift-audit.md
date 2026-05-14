# Docs Drift Audit

Last updated: 2026-05-14.

This audit checks release-tracking docs for claims that no longer match the
implementation after the request trace, Effect-first, typed-error, package
hygiene, and generated-artifact sweeps.

## Current Sweep Results

- Updated request-trace docs that still described richer teardown facts as a
  future gap.
- Updated the release-candidate slice list so it no longer asks for removed
  Promise `.then(...)` internals or already-shipped teardown facts.
- Updated the cleanup backlog so the generated artifact determinism audit points
  at the completed audit artifact instead of remaining unchecked.
- Left older checkpoint counts in place only where they explicitly describe
  historical evidence from that checkpoint; current verification counts are
  recorded in the verification gate and progress ledger.

## Verification Evidence

- Drift search:
  - `rg -n "remaining|TODO|FIXME|still|open|future|not yet|Promise-first|richer teardown|cancellation and failure|292|298|33 package|290 tests|MST|request-runtime teardown" docs -g '*.md'`
  - `rg -n "Promise\\.resolve|\\.then\\(|\\.finally\\(|non-Effect|raw Error|TypeError|runtime-disposed marker|stream close paths|response stream-close" docs -g '*.md'`
- Updated files:
  - `docs/ultimate-goal-checklist.md`
  - `docs/perfection-progress.md`
  - `docs/framework-perfection-charter.md`

## Follow-Up

- Re-run this audit before any release-candidate handoff.
- Add a docs-specific check script if drift patterns stabilize into repeatable
  grep rules.
