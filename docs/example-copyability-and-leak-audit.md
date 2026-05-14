# Example Copyability And Leak Audit

Last updated: 2026-05-14.

This audit checks whether the project console example can be copied as a
starter and whether browser/server boundaries remain explicit.

## Current Sweep Results

- Added an example-local README that names the copyable golden path, the
  browser-safe/server-only split, generated route ownership, and the monorepo
  Vite alias caveat.
- Moved example test and leak-scan commands into the example package itself.
  Root scripts now delegate to those package-local commands instead of owning
  example-only behavior.
- Added `vitest` as an example dev dependency so copied test scripts do not rely
  on root-only tooling.
- Strengthened the production bundle leak assertion to reject both
  `domain.server` and `/src/domain.server.ts` in addition to seed-data strings.
- Project console UI event handlers now cross the browser boundary through
  small Effect programs: refresh uses `Resource.invalidateEffect`, rename uses
  `StartAction.submitEffect`, and advance uses `Action.submitEffect`.
- Added `examples/basic-starter` as the minimal copyable app shell with SSR,
  hydration, a route-owned Resource preload, and its own server-only leak scan.

## Verification Evidence

- `pnpm --filter @effect-ui/example-project-console verify` passed after the
  package-local scripts were added: typecheck, 4 example test files / 23 tests,
  production build, and leak scan.
- Root delegation scripts `pnpm example:test` and `pnpm example:leak-scan`
  passed.
- `pnpm --filter @effect-ui/example-project-console typecheck`,
  `pnpm --filter @effect-ui/example-project-console test`,
  `pnpm --filter @effect-ui/example-project-console build`, and
  `pnpm --filter @effect-ui/example-project-console leak-scan` passed after
  moving UI event handlers onto Effect-native APIs.
- `pnpm starter:verify` passed for `@effect-ui/starter-basic`: typecheck, 1
  starter test, production build, and leak scan.

## Follow-Up

- Replace workspace dependency notes with exact published package versions when
  the first npm release candidate exists.
- If additional `.server.ts` modules are added, extend the leak scan with
  module-specific sentinel strings that prove private server data stayed out of
  the browser bundle.
