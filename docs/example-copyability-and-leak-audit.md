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
- Starter packaging compares generated route/virtual artifact contents after
  standalone verify, currently `src/routeTree.gen.ts` and
  `src/effect-ui-start-virtual.d.ts`, so copied starters cannot be silently
  repaired by the Start Vite adapter while the source starter artifacts remain
  stale.
- `pnpm example:pack-dry-run` runs an Effect-backed dry-run gate for the basic
  starter, React starter, project-console example, devtools panel, and devtools
  extension. The basic, React, and generated project-console starters are the
  standalone copyable paths; the devtools panel and extension are workspace
  examples with source-only package payload gates. The root `pnpm verify`
  command includes this gate and rejects generated output, dependency
  directories, lockfiles, build info, local metadata, and missing `.gitignore`
  files.
- Generated starter package manifests now include `.effect-ui-packages` in
  their `files` allowlist, and `pnpm starter:package` dry-runs each generated
  starter tarball to prove local file-package Adapters are present while app
  build/test/dependency artifacts stay absent.
- The package dry-run gate also covers all 11 framework packages. Framework
  packages must dry-run as `package.json` plus `dist/*` only, while source
  packages keep the source-only policy above.

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
  project-console starter manifests: 20, 25, and 31 app files respectively,
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
- `pnpm example:pack-dry-run` passed for all five source packages:
  20 basic starter files, 25 React starter files, 31 project-console files,
  10 devtools panel files, and 15 devtools extension files.
- `pnpm build && pnpm example:pack-dry-run` passed after Review 150 for all
  16 package targets: 11 framework packages with dist-only payloads plus the
  five source-only packages.
- `find .test-dist/starters -maxdepth 2 \( -name node_modules -o -name dist
  -o -name pnpm-lock.yaml -o -name .test-dist \) -print` returned no output,
  and `find .test-dist/starters -maxdepth 2 -name .gitignore -print` listed all
  three generated starters.

## Follow-Up

- If additional `.server.ts` modules are added, extend the leak scan with
  module-specific sentinel strings that prove private server data stayed out of
  the browser bundle.
