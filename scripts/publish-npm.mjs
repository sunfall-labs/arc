#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import {
  runScriptCommandEffect,
  scriptCommandErrorMessage,
  scriptCommandErrorRepair,
} from "./effect-command-runner.mjs";
import { collectWorkspacePackageManifests } from "./workspace-package-discovery.mjs";
import { workspaceDistPackagePayloadPolicies } from "./package-payload-policy.mjs";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);

class NpmPublishError extends Data.TaggedError("NpmPublishError") {}

const fail = (message, repair, cause) => new NpmPublishError({ message, repair, cause });

const normalizeError = (cause, message, repair) =>
  cause instanceof NpmPublishError ? cause : fail(message, repair, cause);

const defaultDistTag = "alpha";
const packageScope = "@sunfall/";
const publishWorkflowName = "publish-npm.yml";
const expectedRepositoryUrlFragment = "github.com/sunfall-labs/arc";

const usage = `USAGE
  pnpm publish:npm -- [--tag <dist-tag>] [--dry-run] [--package <name>] [--no-skip-existing] [--no-provenance]

Publishes Sunfall Arc framework packages to npm.

Options:
  --tag <dist-tag>       npm dist-tag to attach to published versions. Defaults to ${defaultDistTag}.
  --dry-run              Pack and run npm publish --dry-run without mutating the registry.
  --package <name>       Limit publish targets. Can be passed more than once.
  --no-skip-existing     Fail instead of skipping versions already present on npm.
  --no-provenance        Omit npm provenance for real publishes. Intended only for emergency local bootstrap.
  --help                 Show this help text.
`;

const parseArgs = (argv) => {
  const options = {
    dryRun: false,
    distTag: defaultDistTag,
    packageNames: new Set(),
    provenance: true,
    skipExisting: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--": {
        break;
      }
      case "--dry-run": {
        options.dryRun = true;
        break;
      }
      case "--help":
      case "-h": {
        options.help = true;
        break;
      }
      case "--no-provenance": {
        options.provenance = false;
        break;
      }
      case "--no-skip-existing": {
        options.skipExisting = false;
        break;
      }
      case "--package": {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw fail(
            "Missing value for --package.",
            "Pass a full package name, for example @sunfall/arc-core.",
          );
        }
        options.packageNames.add(value);
        index += 1;
        break;
      }
      case "--tag": {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw fail(
            "Missing value for --tag.",
            "Pass an npm dist-tag such as alpha, next, or latest.",
          );
        }
        options.distTag = value;
        index += 1;
        break;
      }
      default: {
        throw fail(
          `Unknown option ${arg}.`,
          "Run pnpm publish:npm -- --help for supported options.",
        );
      }
    }
  }

  return options;
};

const distTagPattern = /^[a-z][a-z0-9._-]*$/;

const validateOptions = (options) => {
  if (!distTagPattern.test(options.distTag)) {
    throw fail(
      `Invalid npm dist-tag "${options.distTag}".`,
      "Use a lowercase tag beginning with a letter, such as alpha, beta, next, or latest.",
    );
  }
  if (options.dryRun && !options.skipExisting) {
    throw fail(
      "--no-skip-existing is only meaningful for real publishes.",
      "Use --dry-run by itself when checking the publish flow.",
    );
  }
};

const commandEffect = (description, command, args, options = {}) =>
  runScriptCommandEffect(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    onStdoutChunk: options.onStdout,
    onStderrChunk: options.onStderr,
  }).pipe(
    Effect.mapError((error) =>
      fail(
        scriptCommandErrorMessage(description, error),
        scriptCommandErrorRepair(error, `Ensure ${command} is available on PATH.`),
        error,
      ),
    ),
  );

const runLoggedCommand = (description, command, args, options = {}) =>
  commandEffect(description, command, args, {
    ...options,
    onStdout: (text) => process.stdout.write(text),
    onStderr: (text) => process.stderr.write(text),
  });

const parseJsonEffect = (description, text) =>
  Effect.try({
    try: () => JSON.parse(text.trim()),
    catch: (cause) =>
      fail(
        `Failed to parse ${description}.`,
        "Keep the underlying package-manager command in machine-readable JSON mode.",
        cause,
      ),
  });

const semverParts = (version) => version.split(".").map((part) => Number.parseInt(part, 10));

const versionAtLeast = (actual, minimum) => {
  const actualParts = semverParts(actual);
  const minimumParts = semverParts(minimum);
  for (let index = 0; index < Math.max(actualParts.length, minimumParts.length); index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart > minimumPart) {
      return true;
    }
    if (actualPart < minimumPart) {
      return false;
    }
  }
  return true;
};

const validateNpmCliEffect = (options) =>
  Effect.gen(function* () {
    const { stdout } = yield* commandEffect("npm version check", "npm", ["--version"]);
    const npmVersion = stdout.trim();
    if (!options.dryRun && options.provenance && !versionAtLeast(npmVersion, "11.5.1")) {
      return yield* Effect.fail(
        fail(
          `npm ${npmVersion} does not support trusted publishing provenance.`,
          "Install npm 11.5.1 or newer before running a real publish.",
        ),
      );
    }
    return npmVersion;
  });

const validateNodeRuntime = (options) => {
  const nodeVersion = process.versions.node;
  if (!options.dryRun && options.provenance && !versionAtLeast(nodeVersion, "22.14.0")) {
    throw fail(
      `Node ${nodeVersion} does not support npm trusted publishing provenance.`,
      "Use Node 22.14.0 or newer before running a real publish.",
    );
  }
  return nodeVersion;
};

const parseOptionsEffect = Effect.try({
  try: () => {
    const options = parseArgs(process.argv.slice(2));
    if (!options.help) {
      validateOptions(options);
      validateNodeRuntime(options);
    }
    return options;
  },
  catch: (cause) =>
    normalizeError(
      cause,
      "Failed to parse npm publish options.",
      "Run pnpm publish:npm -- --help for supported options.",
    ),
});

const targetDependencyNames = (target, packageNames) => {
  const dependencies = {
    ...target.packageJson.dependencies,
    ...target.packageJson.optionalDependencies,
    ...target.packageJson.peerDependencies,
  };
  return Object.keys(dependencies)
    .filter((name) => packageNames.has(name))
    .sort((left, right) => left.localeCompare(right));
};

const topologicalPackageOrder = (targets) => {
  const byName = new Map(targets.map((target) => [target.packageJson.name, target]));
  const packageNames = new Set(byName.keys());
  const permanent = new Set();
  const temporary = new Set();
  const ordered = [];

  const visit = (target, stack = []) => {
    const name = target.packageJson.name;
    if (permanent.has(name)) {
      return;
    }
    if (temporary.has(name)) {
      throw fail(
        `Package dependency cycle detected: ${[...stack, name].join(" -> ")}.`,
        "Break the local workspace dependency cycle before publishing packages.",
      );
    }

    temporary.add(name);
    for (const dependencyName of targetDependencyNames(target, packageNames)) {
      visit(byName.get(dependencyName), [...stack, name]);
    }
    temporary.delete(name);
    permanent.add(name);
    ordered.push(target);
  };

  for (const target of targets) {
    visit(target);
  }

  return ordered;
};

const packageTargetsEffect = (options) =>
  collectWorkspacePackageManifests(workspaceRoot).pipe(
    Effect.flatMap((manifests) =>
      Effect.try({
        try: () => {
          const publishableNames = new Set(workspaceDistPackagePayloadPolicies.keys());
          const unknownPackageNames = [...options.packageNames].filter(
            (name) => !publishableNames.has(name),
          );
          if (unknownPackageNames.length > 0) {
            throw fail(
              `Unknown publish target${unknownPackageNames.length === 1 ? "" : "s"}: ${unknownPackageNames.join(", ")}.`,
              `Publish targets must be one of: ${[...publishableNames].sort().join(", ")}.`,
            );
          }

          const selected = manifests
            .filter((manifest) => publishableNames.has(manifest.packageJson.name))
            .filter(
              (manifest) =>
                options.packageNames.size === 0 ||
                options.packageNames.has(manifest.packageJson.name),
            )
            .map((manifest) => ({
              directory: manifest.directory,
              packageJson: manifest.packageJson,
              relativeDirectory: relative(workspaceRoot, manifest.directory),
            }));

          if (selected.length === 0) {
            throw fail(
              "No publishable packages matched the requested target set.",
              "Run without --package to publish every framework package.",
            );
          }

          for (const target of selected) {
            const name = target.packageJson.name;
            if (!name.startsWith(packageScope)) {
              throw fail(
                `${name} is outside the ${packageScope} npm scope.`,
                "Only @sunfall organization packages should use this publish flow.",
              );
            }
            if (target.packageJson.private === true) {
              throw fail(
                `${name} is marked private.`,
                "Only public framework packages should use this publish flow.",
              );
            }
            if (target.packageJson.publishConfig?.access !== "public") {
              throw fail(
                `${name} must declare publishConfig.access: "public".`,
                "Keep scoped Sunfall Arc packages explicitly public before publishing.",
              );
            }
            const repositoryUrl = target.packageJson.repository?.url;
            if (
              typeof repositoryUrl !== "string" ||
              !repositoryUrl.includes(expectedRepositoryUrlFragment)
            ) {
              throw fail(
                `${name} must declare a repository.url under ${expectedRepositoryUrlFragment}.`,
                "Keep npm provenance package metadata aligned with the GitHub repository.",
              );
            }
          }

          return topologicalPackageOrder(selected);
        },
        catch: (cause) =>
          normalizeError(
            cause,
            "Failed to select npm publish targets.",
            "Keep workspace package metadata and publish policies in sync.",
          ),
      }),
    ),
  );

const validatePublishPlanEffect = (options, targets) =>
  Effect.gen(function* () {
    if (options.distTag !== "latest") {
      return;
    }

    const prereleaseTargets = targets.filter((target) => target.packageJson.version.includes("-"));
    if (prereleaseTargets.length > 0) {
      return yield* Effect.fail(
        fail(
          `Refusing to publish prerelease versions with the latest dist-tag: ${prereleaseTargets
            .map((target) => `${target.packageJson.name}@${target.packageJson.version}`)
            .join(", ")}.`,
          "Use the alpha, beta, or next dist-tag for prerelease package versions.",
        ),
      );
    }
  });

const isPrereleaseVersion = (version) => version.includes("-");

const npmVersionExistsEffect = (target) =>
  commandEffect(`${target.packageJson.name}@${target.packageJson.version} registry lookup`, "npm", [
    "view",
    `${target.packageJson.name}@${target.packageJson.version}`,
    "version",
    "--json",
  ]).pipe(
    Effect.as(true),
    Effect.catch((error) => {
      const facts = `${error.repair ?? ""} ${error.cause?.stderr ?? ""} ${error.cause?.stdout ?? ""}`;
      return facts.includes("E404") || facts.includes("404 Not Found")
        ? Effect.succeed(false)
        : Effect.fail(error);
    }),
  );

const npmDistTagsEffect = (target) =>
  commandEffect(`${target.packageJson.name} dist-tag lookup`, "npm", [
    "view",
    target.packageJson.name,
    "dist-tags",
    "--json",
  ]).pipe(
    Effect.flatMap((result) =>
      parseJsonEffect(`${target.packageJson.name} dist-tag lookup`, result.stdout),
    ),
  );

const commandErrorFacts = (error) =>
  `${error.message ?? ""} ${error.repair ?? ""} ${error.cause?.stderr ?? ""} ${error.cause?.stdout ?? ""}`;

const removeLatestDistTagEffect = (target) =>
  runLoggedCommand(`${target.packageJson.name} latest dist-tag cleanup`, "npm", [
    "dist-tag",
    "rm",
    target.packageJson.name,
    "latest",
  ]).pipe(
    Effect.as(true),
    Effect.catch((error) => {
      const facts = commandErrorFacts(error);
      if (
        (facts.includes("E400") && facts.includes("/dist-tags/latest")) ||
        facts.includes("E401") ||
        facts.includes("E403") ||
        facts.includes("ENEEDAUTH") ||
        facts.includes("Unable to authenticate")
      ) {
        return Effect.sync(() => {
          console.warn(
            `npm refused or could not authenticate latest cleanup for ${target.packageJson.name}; leaving a prerelease tagged latest until a stable release can replace it.`,
          );
          return false;
        });
      }
      return Effect.fail(error);
    }),
  );

const ensurePrereleaseIsNotLatestEffect = (target, options) =>
  Effect.gen(function* () {
    if (
      options.dryRun ||
      options.distTag === "latest" ||
      !isPrereleaseVersion(target.packageJson.version)
    ) {
      return;
    }

    const distTags = yield* npmDistTagsEffect(target);
    const latestVersion = typeof distTags.latest === "string" ? distTags.latest : undefined;
    if (latestVersion === undefined || !isPrereleaseVersion(latestVersion)) {
      return;
    }
    if (distTags[options.distTag] !== target.packageJson.version) {
      return yield* Effect.fail(
        fail(
          `${target.packageJson.name} latest points at prerelease ${latestVersion}, but ${options.distTag} does not point at current version ${target.packageJson.version}.`,
          `Add the ${options.distTag} dist-tag before removing latest from this prerelease.`,
        ),
      );
    }

    console.log(
      `Removing prerelease latest dist-tag from ${target.packageJson.name}; latest pointed at ${latestVersion} and ${options.distTag} remains ${target.packageJson.version}.`,
    );
    const removed = yield* removeLatestDistTagEffect(target);
    if (!removed) {
      return;
    }

    const updatedDistTags = yield* npmDistTagsEffect(target);
    if (typeof updatedDistTags.latest === "string" && isPrereleaseVersion(updatedDistTags.latest)) {
      return yield* Effect.fail(
        fail(
          `${target.packageJson.name} still has prerelease latest dist-tag ${updatedDistTags.latest} after cleanup.`,
          "Remove the latest dist-tag manually before treating this prerelease publish as complete.",
        ),
      );
    }
  });

const packPackageEffect = (target, packDirectory) =>
  Effect.gen(function* () {
    const { stdout } = yield* commandEffect(`${target.packageJson.name} pack`, "pnpm", [
      "--filter",
      target.packageJson.name,
      "pack",
      "--pack-destination",
      packDirectory,
      "--json",
    ]);
    const parsed = yield* parseJsonEffect(`${target.packageJson.name} pack output`, stdout);
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof pack?.filename !== "string") {
      return yield* Effect.fail(
        fail(
          `${target.packageJson.name} pack output did not include a tarball filename.`,
          "Keep pnpm pack --json output compatible with the publish script.",
        ),
      );
    }
    return pack.filename;
  });

const publishTarballEffect = (target, tarball, options) => {
  const args = ["publish", tarball, "--access", "public", "--tag", options.distTag];
  if (options.dryRun) {
    args.push("--dry-run");
  } else if (options.provenance) {
    args.push("--provenance");
  }

  return runLoggedCommand(`${target.packageJson.name} npm publish`, "npm", args, {
    env: options.provenance && !options.dryRun ? { NPM_CONFIG_PROVENANCE: "true" } : undefined,
  });
};

const publishTargetEffect = (target, options, packDirectory) =>
  Effect.gen(function* () {
    if (!options.dryRun && options.skipExisting) {
      const exists = yield* npmVersionExistsEffect(target);
      if (exists) {
        console.log(
          `Skipping ${target.packageJson.name}@${target.packageJson.version}; version already exists on npm.`,
        );
        yield* ensurePrereleaseIsNotLatestEffect(target, options);
        return { label: target.packageJson.name, status: "skipped" };
      }
    }

    console.log(
      `${options.dryRun ? "Dry-running" : "Publishing"} ${target.packageJson.name}@${target.packageJson.version} from ${target.relativeDirectory}`,
    );
    const tarball = yield* packPackageEffect(target, packDirectory);
    yield* publishTarballEffect(target, tarball, options);
    yield* ensurePrereleaseIsNotLatestEffect(target, options);
    return { label: target.packageJson.name, status: options.dryRun ? "dry-run" : "published" };
  });

const mainEffect = Effect.gen(function* () {
  const options = yield* parseOptionsEffect;
  if (options.help) {
    console.log(usage);
    return;
  }

  const nodeVersion = process.versions.node;
  const npmVersion = yield* validateNpmCliEffect(options);
  const targets = yield* packageTargetsEffect(options);
  yield* validatePublishPlanEffect(options, targets);
  const packDirectory = yield* Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "sunfall-arc-npm-publish-")),
    catch: (cause) =>
      fail(
        "Failed to create temporary package staging directory.",
        "Check local filesystem permissions before publishing.",
        cause,
      ),
  });

  console.log(
    [
      `npm publish mode: ${options.dryRun ? "dry-run" : "real"}`,
      `dist-tag: ${options.distTag}`,
      `Node: ${nodeVersion}`,
      `npm: ${npmVersion}`,
      `workflow: ${publishWorkflowName}`,
      `packages: ${targets.map((target) => target.packageJson.name).join(", ")}`,
    ].join("\n"),
  );

  const results = yield* Effect.forEach(
    targets,
    (target) => publishTargetEffect(target, options, packDirectory),
    { concurrency: 1 },
  ).pipe(
    Effect.ensuring(
      Effect.tryPromise({
        try: () => rm(packDirectory, { recursive: true, force: true }),
        catch: () => undefined,
      }).pipe(Effect.catchCause(() => Effect.void)),
    ),
  );

  const published = results.filter((result) => result.status === "published").length;
  const dryRun = results.filter((result) => result.status === "dry-run").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  console.log(
    `npm publish complete: ${published} published, ${dryRun} dry-run, ${skipped} skipped.`,
  );
});

runScriptMainEffect(
  mainEffect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        if (error.repair !== undefined && error.repair !== "") {
          console.error(error.repair);
        }
        process.exitCode = 1;
      }),
    ),
  ),
);
