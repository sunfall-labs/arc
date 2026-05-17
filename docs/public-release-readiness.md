# Public Release Readiness

Last updated: 2026-05-17.

This is the release handoff checklist for the first public Sunfall Arc alpha.
The workspace root and copyable examples remain private; the framework packages
under `packages/*` are the publishable artifacts.

## Current Evidence

- `pnpm verify` passes after the generated route test assertion was updated for
  the current formatted route artifact shape.
- `pnpm benchmark` passes and prints timing rows for the five release baseline
  benchmarks.
- `docs/benchmark-baseline-audit.md` records a fresh May 17, 2026 baseline.
- Package dry-run verification covers all framework packages, examples,
  starters, and generated starter payloads.
- Public package manifests include descriptions, MIT license metadata, author
  metadata, public scoped-package access, package entrypoints, file payload
  policy, package keywords, GitHub repository links, issue links, and the
  selected `0.1.0-alpha.0` version.
- npm registry lookup returned `E404` for all eleven public package names, so
  no public package with those exact names is currently visible on the registry.
  This does not prove `@sunfall` org publish access.

## Human Decisions Still Required

- Confirm npm authentication, `@sunfall` org access, 2FA/provenance policy, and
  the account that will publish.
- Decide whether examples and starters should stay private-only for the first
  alpha or be published later as separate template packages.

## Step-By-Step Release

1. Confirm `0.1.0-alpha.0` remains the final first public alpha version.
2. Replace `workspace:*` internal package dependencies with the selected
   published version range during packaging or before publish.
3. Confirm package `repository`, `homepage`, and `bugs` metadata points at
   `https://github.com/sunfall-labs/arc`.
4. Run `pnpm install` from a clean checkout.
5. Run `pnpm verify`.
6. Run `pnpm benchmark` and update `docs/benchmark-baseline-audit.md` if the
   release machine changes.
7. Run `git diff --check`.
8. Create the release commit and tag.
9. Publish packages in dependency order:
   `@sunfall/arc-core`, `@sunfall/arc-db`, `@sunfall/arc-start`,
   `@sunfall/arc-start-node`, `@sunfall/arc-start-fetch`,
   `@sunfall/arc-devtools`, `@sunfall/arc-react`, `@sunfall/arc-react-db`,
   `@sunfall/arc-solid`, `@sunfall/arc-solid-db`, `@sunfall/arc-tsrx`.
10. Install the published packages into a temporary clean app.
11. Run the basic and React starter smoke tests against the published packages.
12. Publish the GitHub release notes and alpha announcement with the documented
    experimental limits.
