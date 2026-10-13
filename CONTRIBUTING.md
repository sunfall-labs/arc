# Contributing

## Development

```sh
pnpm install
pnpm verify
```

`pnpm verify` is the gate for every change and for every release. CI runs it as three parallel jobs (`pnpm verify --part static`, `--part packages`, `--part starters`); locally, `pnpm verify` runs all three. It builds the
packages, checks formatting and lint, typechecks the workspace and the public
type tests, runs the public API audit, the Effect command runner and package
payload policies, the Effect-first audit, the workspace tests, one iteration
of every benchmark in `benchmarks/*.bench.ts` (`ARC_BENCH_SMOKE=1`, so a bench
that drifts from the framework fails the gate), the example and starter
verifies, starter package generation, and package dry runs. `pnpm benchmark`
runs the benchmarks for measurement.

### Framework Changes In The Example Apps

The examples alias `@sunfall/arc-*` to the packages' `src`, so a framework
change reaches the app's modules under `vite dev` and in tests without a
build. Vite loads `vite.config.ts` itself with Node, outside those aliases:

- `examples/tracker` and `examples/docs-site` import the Start and tsrx
  plugins from `packages/*/src`, so a plugin change restarts their dev server
  on its own.
- The plugins' own imports of `@sunfall/arc-core` (the dev host's runtime and
  handler adapter) still resolve to `packages/core/dist`, and so do all of
  `examples/project-console` and `examples/basic-starter`'s plugin imports:
  those apps are starter templates and import the published entry points.
  Changes there need `pnpm build` and a dev-server restart.

### Docs Stay Checked

- `pnpm docs:snippets` (part of `pnpm typecheck`) requires every TypeScript
  fence in `README.md`, `docs/golden-path.md`, and `docs/db.md` to match a
  type-checked fixture under `type-tests/readme`, `type-tests/golden-path`, or
  `type-tests/docs/db`. Edit the
  fixture, then run `node scripts/verify-doc-snippets.mjs --write`.
- `pnpm audit:public-api` checks `docs/public-api-inventory.md` against
  `type-tests/public-api.manifest.json` and every package's `exports`. A new
  export needs a row in both.
- `pnpm audit:effect-first` scans TypeScript fences in `README.md`, `docs/`,
  and example Markdown for Promise-first code.

Record user-visible changes in [CHANGELOG.md](CHANGELOG.md) under
"Unreleased", and add a section to
[docs/migration-notes.md](docs/migration-notes.md) for breaking changes.

## Publishing To npm

Sunfall Arc publishes its framework packages under the `@sunfall` npm scope
from `.github/workflows/publish-npm.yml`.

### Release Model

- Push a `v*` tag to publish. The dist-tag follows the tag name: `-alpha`
  publishes to `alpha`, `-beta` to `beta`, `-rc` to `next`, anything else to
  `latest`. The workflow can also be dispatched manually with an explicit
  dist-tag and a dry-run toggle.
- Real publishes must run from `main` or a `v*` tag. Dry runs can run from any
  branch.
- The publish job runs the full `pnpm verify` gate before any registry
  mutation.
- Packages are packed with `pnpm pack` first so `workspace:*` dependencies are
  rewritten to concrete versions, then the tarballs are published with
  `npm publish`.
- Do not publish prerelease versions with the `latest` dist-tag. A first-time
  prerelease publish may cause npm to create `latest` alongside the requested
  prerelease tag; the publish script removes that `latest` tag after confirming
  the requested tag points at the current version. If npm refuses the delete,
  the script moves `latest` to the current prerelease so default installs do
  not receive a stale alpha.

The workflow uses npm Trusted Publishing (`id-token: write`, npm 11.10 or
newer), pins release-job actions to full commit SHAs, does not persist checkout
credentials, and disables dependency caching in the release job.

Configure the GitHub `npm-publish` environment to allow deployments only from
`main` and `v*` tags, and prefer requiring maintainer approval on it.

### First Publish Bootstrap

npm Trusted Publishing requires the package to already exist on the registry,
so a brand-new `@sunfall/arc-*` package needs a one-time token publish:

1. Create an npm automation or granular access token that can publish public
   packages in the `sunfall` organization.
2. Add it as `NPM_TOKEN` on the GitHub `npm-publish` environment.
3. Dispatch `Publish npm packages` from `main` with `dist-tag=alpha`,
   `dry-run=false`, and `use-token-bootstrap=true`.
4. Configure Trusted Publishing for each package: provider GitHub Actions,
   repository `sunfall-labs/arc`, workflow `publish-npm.yml`, environment
   `npm-publish`. With npm 11.10+:

   ```sh
   npm trust github @sunfall/arc-core --repo sunfall-labs/arc --file publish-npm.yml --env npm-publish
   ```

5. Remove the temporary `NPM_TOKEN` secret and require 2FA while disallowing
   token publishing for each package.

### Local Dry Run

```sh
pnpm build
pnpm publish:npm -- --tag alpha --dry-run
```

The dry run packs each publishable package with pnpm and runs
`npm publish --dry-run` on the tarball.
