# Example Copyability And Leak Audit

Last updated: 2026-05-16.

This audit checks whether the basic, React, and project-console examples can be
copied as starters and whether browser/server boundaries remain explicit.

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
- Extended `scripts/package-project-console-starter.mjs` into an Effect-backed
  generator for `.test-dist/starters/basic`, `.test-dist/starters/react`, and
  `.test-dist/starters/project-console`. Generated starters rewrite workspace
  protocol dependencies to local `.effect-ui-packages/*` file dependencies,
  remove monorepo Vite aliases, write standalone `tsconfig.json` files, verify
  source app manifests, install outside the workspace, and run each generated
  starter's own `verify` script before cleaning install/build artifacts.
- Generated starters now carry their own `.gitignore`, and the packager
  removes generated `.test-dist` output in addition to `node_modules`, `dist`,
  and the temporary lockfile before rechecking the manifest after verify.
- Workspace package builds clean both `dist` and `.tsbuildinfo` before
  compiling, and starter packaging rejects copied local package `dist` files
  that no longer have a source module.
- The Start package build removes the stale `dist/virtual.d.ts.map` after
  copying `src/virtual-modules.d.ts` over `dist/virtual.d.ts`, so generated
  starters do not ship a declaration map pointing at the wrong virtual-module
  implementation.
- Devtools panel and extension examples now carry package-local `.gitignore`
  files and include them in their package allowlists, keeping copied shells
  source-only while excluding `node_modules`, `dist`, `.test-dist`, build info,
  and local metadata.

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
- `pnpm starter:package` passed and verified generated basic, React, and
  project-console starter manifests: 19, 24, and 30 app files respectively,
  with 5, 4, and 6 local `@effect-ui/*` file packages; each generated starter
  completed typecheck, tests, production build, and leak scan after an isolated
  non-workspace install.
- `pnpm --filter @effect-ui/starter-basic pack --dry-run`,
  `pnpm --filter @effect-ui/starter-react pack --dry-run`,
  `pnpm --filter @effect-ui/example-project-console pack --dry-run`,
  `pnpm --filter @effect-ui/example-devtools-panel pack --dry-run`, and
  `pnpm --filter @effect-ui/example-devtools-extension pack --dry-run` showed
  only source/config/README assets and local `.gitignore` files where
  applicable, with no `dist` or `.test-dist` artifacts.
- `pnpm --filter @effect-ui/start build` passed and
  `test ! -e packages/start/dist/virtual.d.ts.map` confirmed the replacement
  virtual declaration no longer leaves a stale source map.
- `pnpm starter:package` passed and generated starter checks confirmed no
  copied `@effect-ui/start` package contains `dist/virtual.d.ts.map`.
- `find .test-dist/starters -maxdepth 2 \( -name node_modules -o -name dist
  -o -name pnpm-lock.yaml -o -name .test-dist \) -print` returned no output,
  and `find .test-dist/starters -maxdepth 2 -name .gitignore -print` listed all
  three generated starters.

## Follow-Up

- If additional `.server.ts` modules are added, extend the leak scan with
  module-specific sentinel strings that prove private server data stayed out of
  the browser bundle.
