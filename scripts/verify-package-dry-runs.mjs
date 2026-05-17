#!/usr/bin/env node

import { mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import {
  runScriptCommandEffect,
  scriptCommandErrorMessage,
  scriptCommandErrorRepair
} from "./effect-command-runner.mjs";
import { runScriptMainEffect } from "./effect-main-runner.mjs";
import {
  isNonEmptyString,
  knownPayloadPolicies,
  validateDistPackagePayloadEffect,
  workspaceDistPackagePayloadPolicies,
} from "./package-payload-policy.mjs";
import {
  starterCatalogConsistencyEffect,
  starterSourcePackagePayloadPolicies,
} from "./starter-catalog.mjs";
import { collectWorkspacePackageManifests } from "./workspace-package-discovery.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);

class PackageDryRunError extends Data.TaggedError("PackageDryRunError") {}

const fail = (message, repair, cause) =>
  new PackageDryRunError({ message, repair, cause });
const selfTestFailures = [];

const packagePayloadPolicies = new Map([
  ...workspaceDistPackagePayloadPolicies,
  [
    "@effect-ui/example-devtools-extension",
    {
      payload: "source-package",
      requiresGitignore: true,
      requiredFiles: [
        "README.md",
        "devtools.html",
        "panel.html",
        "public/manifest.json",
        "src/devtools.ts",
        "src/panel-runtime.ts",
        "src/panel.ts",
        "src/transport.ts",
        "tsconfig.json",
        "vite.config.ts",
      ],
      requiredDirectories: ["public", "src"],
    },
  ],
  [
    "@effect-ui/example-devtools-panel",
    {
      payload: "source-package",
      requiresGitignore: true,
      requiredFiles: [
        "README.md",
        "index.html",
        "src/main.ts",
        "src/sample.ts",
        "tsconfig.json",
        "vite.config.ts",
      ],
      requiredDirectories: ["src"],
    },
  ],
  ...starterSourcePackagePayloadPolicies,
]);

const forbiddenGeneratedSegments = new Set([".test-dist", "node_modules"]);
const forbiddenSourcePackageSegments = new Set(["dist", "type-tests", ...forbiddenGeneratedSegments]);
const forbiddenFileNames = new Set([
  ".DS_Store",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const toPosixPath = (filePath) => filePath.split(sep).join("/");

const isStringArray = (value) =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string");

const manifestMetadataValidationFailures = (target) => {
  const packageJson = target.packageJson;
  const failures = [];

  if (packageJson.private !== true) {
    failures.push(`${target.label} package.json must keep private: true until the publication decision is explicit.`);
  }
  if (packageJson.license !== "UNLICENSED") {
    failures.push(`${target.label} package.json must keep license: "UNLICENSED" while the workspace is private.`);
  }
  if (!isStringArray(packageJson.files)) {
    failures.push(`${target.label} package.json must declare a non-empty files allowlist.`);
  }

  if (target.payload === "dist-package") {
    if (!isNonEmptyString(packageJson.description)) {
      failures.push(`${target.label} package.json must include a non-empty description for registry and generated-starter surfaces.`);
    }
    if (packageJson.sideEffects !== false) {
      failures.push(`${target.label} package.json must declare sideEffects: false for tree-shakable framework modules.`);
    }
    if (packageJson.files?.length !== 1 || packageJson.files[0] !== "dist") {
      failures.push(`${target.label} package.json files allowlist must be exactly ["dist"] for dist-package payloads.`);
    }
    if (!isNonEmptyString(packageJson.main) || !packageJson.main.startsWith("./dist/")) {
      failures.push(`${target.label} package.json main must point at a ./dist/ entrypoint.`);
    }
    if (!isNonEmptyString(packageJson.types) || !packageJson.types.startsWith("./dist/")) {
      failures.push(`${target.label} package.json types must point at a ./dist/ declaration entrypoint.`);
    }
  }

  if (target.payload === "source-package" && target.requiresGitignore) {
    if (!Array.isArray(packageJson.files) || !packageJson.files.includes(".gitignore")) {
      failures.push(`${target.label} package.json files allowlist must include .gitignore for copyable source payload hygiene.`);
    }
  }
  if (target.payload === "source-package") {
    if (!isNonEmptyString(packageJson.scripts?.verify)) {
      failures.push(`${target.label} package.json must declare a verify script so workspace verification cannot skip copyable source packages.`);
    }
  }

  return failures;
};

const packagePayloadValidationFailures = (target, files) => {
  const failures = [];
  const fileSet = new Set(files);
  for (const requiredFile of target.requiredFiles ?? []) {
    if (!fileSet.has(requiredFile)) {
      failures.push(`${target.label} package dry-run is missing required source file ${requiredFile}.`);
    }
  }
  for (const requiredDirectory of target.requiredDirectories ?? []) {
    const prefix = `${requiredDirectory}/`;
    if (!files.some((file) => file.startsWith(prefix))) {
      failures.push(`${target.label} package dry-run is missing required source directory ${requiredDirectory}.`);
    }
  }
  return failures;
};

const sourcePackageManifestValidationFailures = (target, expectedFiles, actualFiles) => {
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);
  const missing = expectedFiles.filter((file) => !actualSet.has(file));
  const extra = actualFiles.filter((file) => !expectedSet.has(file));
  const failures = [];

  if (missing.length > 0) {
    failures.push(`${target.label} package dry-run is missing source manifest files: ${missing.join(", ")}.`);
  }
  if (extra.length > 0) {
    failures.push(`${target.label} package dry-run includes files outside the source manifest: ${extra.join(", ")}.`);
  }

  return failures;
};

const failSelfTest = (message) => {
  selfTestFailures.push(message);
};

const assertManifestMetadataPolicy = (name, target, expectedFragments) => {
  const failures = manifestMetadataValidationFailures(target);
  if (failures.length !== expectedFragments.length) {
    failSelfTest(
      `${name} manifest metadata self-test expected ${expectedFragments.length} failures but found ${failures.length}: ${failures.join(" ")}`
    );
  }
  for (const expectedFragment of expectedFragments) {
    if (!failures.some((failure) => failure.includes(expectedFragment))) {
      failSelfTest(
        `${name} manifest metadata self-test did not find expected failure fragment ${expectedFragment}: ${failures.join(" ")}`
      );
    }
  }
};

const assertPackagePayloadPolicy = (name, target, files, expectedFragments) => {
  const failures = packagePayloadValidationFailures(target, files);
  if (failures.length !== expectedFragments.length) {
    failSelfTest(
      `${name} package payload self-test expected ${expectedFragments.length} failures but found ${failures.length}: ${failures.join(" ")}`
    );
  }
  for (const expectedFragment of expectedFragments) {
    if (!failures.some((failure) => failure.includes(expectedFragment))) {
      failSelfTest(
        `${name} package payload self-test did not find expected failure fragment ${expectedFragment}: ${failures.join(" ")}`
      );
    }
  }
};

const assertSourcePackageManifestPolicy = (name, target, expectedFiles, actualFiles, expectedFragments) => {
  const failures = sourcePackageManifestValidationFailures(target, expectedFiles, actualFiles);
  if (failures.length !== expectedFragments.length) {
    failSelfTest(
      `${name} source package manifest self-test expected ${expectedFragments.length} failures but found ${failures.length}: ${failures.join(" ")}`
    );
  }
  for (const expectedFragment of expectedFragments) {
    if (!failures.some((failure) => failure.includes(expectedFragment))) {
      failSelfTest(
        `${name} source package manifest self-test did not find expected failure fragment ${expectedFragment}: ${failures.join(" ")}`
      );
    }
  }
};

const validDistPackageSelfTest = {
  label: "@effect-ui/self-test",
  payload: "dist-package",
  packageJson: {
    private: true,
    license: "UNLICENSED",
    description: "Self-test package.",
    files: ["dist"],
    sideEffects: false,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
  },
};

assertManifestMetadataPolicy("valid dist package", validDistPackageSelfTest, []);
assertManifestMetadataPolicy(
  "dist package missing side effects",
  {
    ...validDistPackageSelfTest,
    packageJson: { ...validDistPackageSelfTest.packageJson, sideEffects: true },
  },
  ["sideEffects: false"],
);
assertManifestMetadataPolicy(
  "dist package wrong files",
  {
    ...validDistPackageSelfTest,
    packageJson: { ...validDistPackageSelfTest.packageJson, files: ["dist", "src"] },
  },
  ['files allowlist must be exactly ["dist"]'],
);
assertManifestMetadataPolicy(
  "source package missing gitignore",
  {
    label: "@effect-ui/source-self-test",
    payload: "source-package",
    requiresGitignore: true,
    packageJson: {
      private: true,
      license: "UNLICENSED",
      files: ["src"],
      scripts: { verify: "pnpm test" },
    },
  },
  [".gitignore"],
);
assertManifestMetadataPolicy(
  "source package missing verify script",
  {
    label: "@effect-ui/source-self-test",
    payload: "source-package",
    packageJson: {
      private: true,
      license: "UNLICENSED",
      files: ["src", ".gitignore"],
      scripts: {},
    },
  },
  ["verify script"],
);

const sourcePackageSelfTest = {
  label: "@effect-ui/source-self-test",
  payload: "source-package",
  requiredFiles: ["README.md", "index.html", "src/main.ts"],
  requiredDirectories: ["src"],
};
assertPackagePayloadPolicy(
  "valid source package payload",
  sourcePackageSelfTest,
  ["README.md", "index.html", "src/main.ts"],
  [],
);
assertPackagePayloadPolicy(
  "source package missing required payload",
  sourcePackageSelfTest,
  [".gitignore", "src/styles.css"],
  ["README.md", "index.html", "src/main.ts"],
);
assertSourcePackageManifestPolicy(
  "source package manifest matches",
  sourcePackageSelfTest,
  ["README.md", "index.html", "package.json", "src/main.ts"],
  ["README.md", "index.html", "package.json", "src/main.ts"],
  [],
);
assertSourcePackageManifestPolicy(
  "source package manifest drift",
  sourcePackageSelfTest,
  ["README.md", "index.html", "package.json", "src/main.ts", "src/styles.css"],
  ["README.md", "index.html", "package.json", "src/main.ts", "src/old.css"],
  ["src/styles.css", "src/old.css"],
);

const workspacePackageTargets = collectWorkspacePackageManifests(workspaceRoot).pipe(
  Effect.flatMap((manifests) =>
    Effect.gen(function* () {
      const discoveredNames = new Set(manifests.map((manifest) => manifest.packageJson.name));
      const missingPolicyPackages = manifests
        .filter((manifest) => !packagePayloadPolicies.has(manifest.packageJson.name))
        .map((manifest) => manifest.packageJson.name);
      const stalePolicyPackages = [...packagePayloadPolicies.keys()]
        .filter((name) => !discoveredNames.has(name))
        .sort((left, right) => left.localeCompare(right));
      const invalidPolicyPackages = [...packagePayloadPolicies.entries()]
        .filter(([, policy]) => !knownPayloadPolicies.has(policy.payload))
        .map(([name]) => name)
        .sort((left, right) => left.localeCompare(right));

      if (
        missingPolicyPackages.length > 0 ||
        stalePolicyPackages.length > 0 ||
        invalidPolicyPackages.length > 0
      ) {
        return yield* Effect.fail(
          fail(
            "Package dry-run payload policy is out of sync with workspace package manifests.",
            [
              "Declare an explicit dist-package or source-package payload policy for every discovered workspace package.",
              missingPolicyPackages.length > 0 ? `Missing policy: ${missingPolicyPackages.join(", ")}` : undefined,
              stalePolicyPackages.length > 0 ? `Policy without workspace package: ${stalePolicyPackages.join(", ")}` : undefined,
              invalidPolicyPackages.length > 0 ? `Invalid policy: ${invalidPolicyPackages.join(", ")}` : undefined,
            ].filter(Boolean).join(" "),
          ),
        );
      }

      return manifests.map((manifest) => ({
        label: manifest.packageJson.name,
        filter: manifest.packageJson.name,
        directory: manifest.directory,
        packageJson: manifest.packageJson,
        ...packagePayloadPolicies.get(manifest.packageJson.name),
      }));
    }),
  ),
);

const commandEffect = (description, command, args, options = {}) =>
  runScriptCommandEffect(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      ...options.env,
    },
  }).pipe(
    Effect.mapError((error) =>
      fail(
        scriptCommandErrorMessage(description, error),
        scriptCommandErrorRepair(
          error,
          "Ensure pnpm is available on PATH and package metadata is valid."
        ),
        error,
      )
    )
  );

const parsePackOutput = (target, stdout) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(stdout.trim()),
      catch: (cause) =>
        fail(
          `Failed to parse ${target.label} package dry-run output.`,
          "Keep pnpm pack --dry-run --json output machine-readable.",
          cause,
        ),
    });
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    if (
      typeof pack !== "object" ||
      pack === null ||
      !Array.isArray(pack.files)
    ) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run output did not include a files array.`,
          "Keep pnpm pack --dry-run --json output machine-readable.",
        ),
      );
    }
    return pack;
  });

const hasForbiddenPath = (target, filePath) => {
  const segments = filePath.split("/");
  const forbiddenSegments = target.payload === "dist-package"
    ? forbiddenGeneratedSegments
    : forbiddenSourcePackageSegments;
  return (
    segments.some((segment) => forbiddenSegments.has(segment)) ||
    forbiddenFileNames.has(segments.at(-1) ?? "") ||
    filePath.endsWith(".tsbuildinfo")
  );
};

const fsEffect = (description, evaluate) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      fail(
        `Failed to ${description}.`,
        "Run from the repository root and check filesystem permissions.",
        cause,
      ),
  });

const collectSourcePackageFiles = (target) =>
  Effect.gen(function* () {
    const files = [];
    const visit = (directory) => Effect.gen(function* () {
      const entries = yield* fsEffect(
        `read ${relative(workspaceRoot, directory)}`,
        () => readdir(directory, { withFileTypes: true }),
      );
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        const relativePath = toPosixPath(relative(target.directory, fullPath));
        if (hasForbiddenPath(target, relativePath)) {
          continue;
        }
        if (entry.isDirectory()) {
          yield* visit(fullPath);
          continue;
        }
        if (entry.isFile()) {
          files.push(relativePath);
          continue;
        }
        if (entry.isSymbolicLink()) {
          const linkStat = yield* fsEffect(
            `stat ${relative(workspaceRoot, fullPath)}`,
            () => stat(fullPath),
          );
          if (linkStat.isFile()) {
            files.push(relativePath);
          }
        }
      }
    });

    yield* visit(target.directory);
    return files.sort((left, right) => left.localeCompare(right));
  });

const verifyStartCliSymlinkBinEffect = (target) => {
  if (target.label !== "@effect-ui/start") {
    return Effect.void;
  }

  return Effect.gen(function* () {
    const binTarget = target.packageJson.bin?.["effect-ui-start"];
    if (!isNonEmptyString(binTarget)) {
      return yield* Effect.fail(
        fail(
          "@effect-ui/start package.json is missing the effect-ui-start bin target.",
          "Keep the diagnostics CLI bin declared so package-manager installs expose the Start diagnostics command.",
        ),
      );
    }

    const cliPath = join(target.directory, binTarget);
    const tempDirectory = yield* fsEffect(
      "create effect-ui-start symlink bin check directory",
      () => mkdtemp(join(tmpdir(), "effect-ui-start-bin-")),
    );

    return yield* Effect.gen(function* () {
      const linkedBin = join(tempDirectory, "effect-ui-start");
      yield* fsEffect(
        "create effect-ui-start bin symlink",
        () => symlink(cliPath, linkedBin, "file"),
      );

      const { stdout } = yield* commandEffect(
        "@effect-ui/start symlinked CLI bin version check",
        process.platform === "win32" ? process.execPath : linkedBin,
        process.platform === "win32" ? [linkedBin, "--version"] : ["--version"],
      );
      const expected = `effect-ui-start v${target.packageJson.version}`;
      if (stdout.trim() !== expected) {
        return yield* Effect.fail(
          fail(
            "@effect-ui/start symlinked CLI bin did not execute.",
            [
              "Keep the CLI main-module guard resilient to package-manager symlink entrypoints.",
              `Expected stdout: ${expected}`,
              stdout.trim() === "" ? "Actual stdout was empty." : `Actual stdout: ${stdout.trim()}`,
            ].join(" "),
          ),
        );
      }

      const invalidCommandError = yield* Effect.flip(
        runScriptCommandEffect(
          process.platform === "win32" ? process.execPath : linkedBin,
          process.platform === "win32" ? [linkedBin, "unknown"] : ["unknown"],
          {
            cwd: workspaceRoot,
            env: {
              ...process.env
            }
          }
        )
      ).pipe(
        Effect.mapError((result) =>
          fail(
            "@effect-ui/start symlinked CLI invalid subcommand unexpectedly succeeded.",
            [
              "Usage errors must keep a non-zero process exit code through the Effect main-runner teardown.",
              result.stdout.trim() === "" ? "stdout was empty." : `stdout: ${result.stdout.trim()}`,
              result.stderr.trim() === "" ? "stderr was empty." : `stderr: ${result.stderr.trim()}`,
            ].join(" "),
            result,
          )
        )
      );
      if (
        invalidCommandError.code !== 1 ||
        !invalidCommandError.stderr.includes("Unknown subcommand") ||
        !invalidCommandError.stdout.includes("USAGE")
      ) {
        return yield* Effect.fail(
          fail(
            "@effect-ui/start symlinked CLI invalid subcommand did not fail with usage semantics.",
            [
              "Keep Effect CLI parse failures mapped to process exit code 1.",
              `Exit code: ${invalidCommandError.code}`,
              invalidCommandError.stdout.trim() === "" ? "stdout was empty." : `stdout: ${invalidCommandError.stdout.trim()}`,
              invalidCommandError.stderr.trim() === "" ? "stderr was empty." : `stderr: ${invalidCommandError.stderr.trim()}`,
            ].join(" "),
            invalidCommandError,
          )
        );
      }
    }).pipe(
      Effect.ensuring(
        fsEffect(
          "remove effect-ui-start symlink bin check directory",
          () => rm(tempDirectory, { recursive: true, force: true }),
        ).pipe(Effect.catchCause(() => Effect.void)),
      ),
    );
  });
};

const verifyPackageTarget = (target) =>
  Effect.gen(function* () {
    const manifestMetadataFailures = manifestMetadataValidationFailures(target);
    if (manifestMetadataFailures.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package metadata does not match the documented release policy.`,
          manifestMetadataFailures.join(" "),
        ),
      );
    }

    const { stdout } = yield* commandEffect(
      `${target.label} package dry-run`,
      "pnpm",
      ["--filter", target.filter, "pack", "--dry-run", "--json"],
    );
    const pack = yield* parsePackOutput(target, stdout);
    const files = pack.files.map((file) => file.path).sort((left, right) => left.localeCompare(right));
    const forbidden = files.filter((file) => hasForbiddenPath(target, file));
    const missingRequiredPayload = packagePayloadValidationFailures(target, files);
    const sourceManifestDrift = target.payload === "source-package"
      ? sourcePackageManifestValidationFailures(target, yield* collectSourcePackageFiles(target), files)
      : [];
    const distPackagePayloadDrift = target.payload === "dist-package"
      ? yield* validateDistPackagePayloadEffect({
          target,
          files,
          workspaceRoot,
        })
      : [];

    if (target.requiresGitignore && !files.includes(".gitignore")) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run is missing .gitignore.`,
          "Add .gitignore to the package files allowlist so copied examples keep local artifact hygiene.",
        ),
      );
    }
    if (missingRequiredPayload.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run is missing required source/config payloads.`,
          [
            "Keep source package files allowlists aligned with copyable app and example contracts.",
            ...missingRequiredPayload,
          ].join(" "),
        ),
      );
    }
    if (sourceManifestDrift.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run does not match the source package file manifest.`,
          [
            "Keep source package files allowlists aligned with the copyable source tree.",
            ...sourceManifestDrift,
          ].join(" "),
        ),
      );
    }
    if (distPackagePayloadDrift.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run dist payload does not match the shared package policy.`,
          [
            "Run a clean build or fix package.json exports/bin/main/types targets before packing framework packages.",
            ...distPackagePayloadDrift,
          ].join(" "),
        ),
      );
    }
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run includes generated or local-only artifacts.`,
          `Remove these paths from the package payload: ${forbidden.join(", ")}.`,
        ),
      );
    }
    if (target.payload === "dist-package") {
      const nonDist = files.filter((file) => file !== "package.json" && !file.startsWith("dist/"));
      if (!files.some((file) => file.startsWith("dist/"))) {
        return yield* Effect.fail(
          fail(
            `${target.label} package dry-run is missing dist output.`,
            "Run pnpm build before package dry-run verification so publishable packages contain built artifacts.",
          ),
        );
      }
      if (nonDist.length > 0) {
        return yield* Effect.fail(
          fail(
            `${target.label} package dry-run includes non-dist payload files.`,
            `Keep framework package payloads limited to package.json and dist artifacts: ${nonDist.join(", ")}.`,
          ),
        );
      }
    }
    yield* verifyStartCliSymlinkBinEffect(target);

    return {
      label: target.label,
      files: files.length,
    };
  });

const verifyPackageDryRuns = starterCatalogConsistencyEffect().pipe(
  Effect.flatMap(() => workspacePackageTargets),
  Effect.flatMap((packageTargets) => Effect.forEach(packageTargets, verifyPackageTarget)),
);

const reportResultsEffect = (results) =>
  Effect.sync(() => {
    for (const result of results) {
      console.log(`Verified ${result.label} package dry-run (${result.files} files).`);
    }
  });

const reportFailureEffect = (cause) =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      console.error(cause);
    });
    return yield* Effect.fail(cause);
  });

const verifyPackageDryRunSelfTestsEffect = selfTestFailures.length === 0
  ? Effect.void
  : Effect.fail(fail(
    "Package dry-run self-tests failed.",
    "Fix the package dry-run policy self-tests before running package verification.",
    selfTestFailures
  ));

runScriptMainEffect(
  verifyPackageDryRunSelfTestsEffect.pipe(
    Effect.andThen(verifyPackageDryRuns),
    Effect.flatMap(reportResultsEffect),
    Effect.catch(reportFailureEffect),
  ),
);
