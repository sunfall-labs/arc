# npm Publishing

Sunfall Arc publishes its public framework packages under the `@sunfall` npm organization scope.
Publishing is manual-only and runs from `.github/workflows/publish-npm.yml`.

## Release Model

- Use npm Trusted Publishing from GitHub Actions for normal releases.
- Do not publish from pull requests or push triggers.
- Real publishes must run from the `main` branch. Dry-runs can run from any branch.
- Run the full `pnpm verify` gate in the publish job before any registry mutation.
- Pack packages with `pnpm pack` first so `workspace:*` dependencies are rewritten to concrete package versions, then publish those tarballs with `npm publish`.
- Keep the default dist-tag at `alpha` while package versions are prerelease versions.
- Do not publish prerelease versions with the `latest` dist-tag.
- First-time prerelease publishes may cause npm to create `latest` alongside the requested prerelease tag; the publish script removes any prerelease `latest` tag after confirming the requested prerelease tag points at the current version. If npm refuses to delete `latest`, the script moves `latest` to the current prerelease so default installs do not receive a stale alpha until a stable release can replace it.

The workflow grants `id-token: write`, uses npm 11.10 or newer, pins release-job actions to full commit SHAs, does not persist checkout credentials, and explicitly disables dependency caching in the release job.

Configure the GitHub `npm-publish` environment to allow deployments only from `main`.
Prefer requiring maintainer approval on that environment before real publishes.

## First Publish Bootstrap

npm trusted publisher configuration requires the package to already exist on the registry.
Because the `@sunfall/arc-*` packages are new, the first publish can use a temporary `NPM_TOKEN` secret on the GitHub `npm-publish` environment.
The workflow only uses this token when the manual `use-token-bootstrap` input is set to `true`.

1. Create an npm automation/granular access token that can publish public packages in the `sunfall` organization.
2. Add it as `NPM_TOKEN` on the GitHub `npm-publish` environment.
3. Dispatch `Publish npm packages` from `main` with `dist-tag=alpha`, `dry-run=false`, and `use-token-bootstrap=true`.
4. After the packages exist, configure Trusted Publishing for each package:
   - Provider: GitHub Actions
   - Repository: `sunfall-labs/arc`
   - Workflow filename: `publish-npm.yml`
   - Environment: `npm-publish`
5. Remove the temporary `NPM_TOKEN` secret and require 2FA while disallowing token publishing for each package.

For bulk setup after bootstrap, npm 11.10+ exposes:

```sh
npm trust github @sunfall/arc-core --repo sunfall-labs/arc --file publish-npm.yml --env npm-publish
```

Repeat that for every published `@sunfall/arc-*` package.

## Local Dry Run

```sh
pnpm build
pnpm publish:npm -- --tag alpha --dry-run
```

The local dry run creates temporary pnpm-packed tarballs and then runs `npm publish --dry-run` for each publishable package.
