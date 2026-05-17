#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { runScriptCommandEffect } from "./effect-command-runner.mjs";
import { manifestTargetValidationFailures } from "./package-manifest-targets.mjs";
import {
  declarationArtifactPackFailures,
  distPackageArtifactDriftFailures,
  distPackageSourceStemsFromFiles,
  isNonEmptyString,
  workspaceDistPackagePayloadPolicies,
} from "./package-payload-policy.mjs";
import {
  copyableStarterEntries,
  generatedStarterArtifactsFor,
  starterCatalogConsistencyEffect,
} from "./starter-catalog.mjs";
import {
  collectWorkspacePackageManifests,
  localPackageDirectoryName,
} from "./workspace-package-discovery.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const localPackagesDirectoryName = ".effect-ui-packages";
const localLockfileName = "pnpm-lock.yaml";
const usePrebuiltWorkspacePackages = process.env.EFFECT_UI_VERIFY_PREBUILT_PACKAGES === "1";
const useFastWorkspaceStarterVerify = process.env.EFFECT_UI_VERIFY_FAST_STARTERS === "1";

class StarterPackageError extends Data.TaggedError("StarterPackageError") {}

const fail = (message, repair, cause) =>
  new StarterPackageError({ message, repair, cause });

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

const commandEffect = (description, command, args, options = {}) =>
  Effect.gen(function* () {
    console.log(`▶ ${description}`);
    const result = yield* runScriptCommandEffect(command, args, {
      cwd: options.cwd ?? workspaceRoot,
      env: {
        ...process.env,
        CI: process.env.CI ?? "1",
        ...options.env,
      },
    }).pipe(
      Effect.mapError((error) =>
        fail(
          error.code === undefined
            ? `Failed to run ${description}.`
            : `Command failed while running ${description}.`,
          error.code === undefined
            ? "Ensure pnpm is available on PATH and the generated starter has valid package metadata."
            : [
                `Command: ${error.commandText}`,
                `Exit code: ${error.code}`,
                error.stdout.trim() === "" ? undefined : `stdout: ${error.stdout.trim()}`,
                error.stderr.trim() === "" ? undefined : `stderr: ${error.stderr.trim()}`,
              ].filter(Boolean).join(" "),
          error,
        )
      )
    );
    console.log(`✓ ${description}`);
    return result;
  });

const parseJsonEffect = (filePath, text) =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) =>
      fail(
        `Failed to parse ${relative(workspaceRoot, filePath)}.`,
        "Keep package.json valid JSON.",
        cause,
      ),
  });

const stringifyJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const starterDefinitions = copyableStarterEntries;

const forbiddenSourceSegments = new Set([
  "node_modules",
  "dist",
  ".test-dist",
  "type-tests",
  localPackagesDirectoryName,
]);
const forbiddenGeneratedAppSegments = new Set(["node_modules", "dist", ".test-dist"]);
const forbiddenGeneratedLocalPackageSegments = new Set(["node_modules", ".test-dist"]);
const forbiddenGeneratedPackageFileNames = new Set([
  ".DS_Store",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  localLockfileName,
  "yarn.lock",
]);
const forbiddenGeneratedReadmeFragments = [
  "pnpm --filter @effect-ui",
  "pnpm example:",
  "pnpm starter:package",
  ".test-dist/starters",
  "@latest",
  "dlx shadcn@latest",
];
const forbiddenSourceReadmeFragments = [
  "@latest",
  "dlx shadcn@latest",
];
const toPosixPath = (filePath) => filePath.split(sep).join("/");

const relativeTo = (from, to) => toPosixPath(relative(from, to));

const hasForbiddenSegment = (relativePath, forbiddenSegments) =>
  relativePath
    .split("/")
    .some((segment) => forbiddenSegments.has(segment));

const shouldCopySourcePath = (sourceDir) => (from) => {
  const relativeFromSource = relative(sourceDir, from);
  if (relativeFromSource === "") {
    return true;
  }
  return relativeFromSource
    .split(sep)
    .every((segment) => !forbiddenSourceSegments.has(segment));
};

const isNodeNotFoundError = (cause) =>
  cause &&
  typeof cause === "object" &&
  "code" in cause &&
  cause.code === "ENOENT";

const pathExists = (filePath) =>
  Effect.tryPromise({
    try: () => stat(filePath),
    catch: (cause) => cause,
  }).pipe(
    Effect.as(true),
    Effect.catch((cause) =>
      isNodeNotFoundError(cause)
        ? Effect.succeed(false)
        : Effect.fail(
            fail(
              `Failed to check whether ${relative(workspaceRoot, filePath)} exists.`,
              "Run from the repository root and check filesystem permissions.",
              cause,
            ),
          ),
    ),
  );

const verifyRunsLeakScan = (script) =>
  /(?:^|&&|;)\s*pnpm\s+leak-scan(?:\s|$)/.test(script);

const assertStarterLeakScanParity = (starters) =>
  Effect.gen(function* () {
    const leakScanRelativePath = "scripts/leak-scan.mjs";
    const leakScans = [];
    for (const starter of starters) {
      const packageJson = yield* readPackageJson(resolve(starter.sourceDir, "package.json"));
      const scripts = packageJson.scripts;
      if (
        typeof scripts !== "object" ||
        scripts === null ||
        typeof scripts["leak-scan"] !== "string" ||
        scripts["leak-scan"].trim() === ""
      ) {
        return yield* Effect.fail(
          fail(
            `${starter.displayName} package.json must declare scripts.leak-scan.`,
            "Every copyable starter must keep the production leak scan runnable.",
          ),
        );
      }
      if (
        typeof scripts.verify !== "string" ||
        !verifyRunsLeakScan(scripts.verify)
      ) {
        return yield* Effect.fail(
          fail(
            `${starter.displayName} package.json verify script must run pnpm leak-scan.`,
            "Keep standalone starter verification aligned with the workspace leak-scan policy.",
          ),
        );
      }

      const patterns = packageJson.effectUiLeakScan?.patterns;
      if (
        !Array.isArray(patterns) ||
        patterns.length === 0 ||
        patterns.some((pattern) => typeof pattern !== "string" || pattern.trim() === "")
      ) {
        return yield* Effect.fail(
          fail(
            `${starter.displayName} package.json must declare nonempty effectUiLeakScan.patterns.`,
            "Declare the server-only text patterns this starter must keep out of dist.",
          ),
        );
      }
      for (const pattern of patterns) {
        yield* Effect.try({
          try: () => new RegExp(pattern),
          catch: (cause) =>
            fail(
              `${starter.displayName} effectUiLeakScan pattern is not a valid RegExp: ${pattern}.`,
              "Keep leak-scan patterns valid so generated starters can verify themselves.",
              cause,
            ),
        });
      }

      const filePath = resolve(starter.sourceDir, leakScanRelativePath);
      if (!(yield* pathExists(filePath))) {
        return yield* Effect.fail(
          fail(
            `${starter.displayName} is missing ${leakScanRelativePath}.`,
            "Every copyable starter must include the shared leak-scan script.",
          ),
        );
      }
      const text = yield* fsEffect(
        `read ${starter.displayName} leak-scan script`,
        () => readFile(filePath, "utf8"),
      );
      leakScans.push({ starter, text });
    }

    const [baseline, ...candidates] = leakScans;
    if (baseline === undefined) {
      return;
    }

    const divergent = candidates.filter((candidate) => candidate.text !== baseline.text);
    if (divergent.length > 0) {
      return yield* Effect.fail(
        fail(
          "Starter leak-scan scripts are not byte-for-byte identical.",
          [
            `Baseline: ${relative(workspaceRoot, resolve(baseline.starter.sourceDir, leakScanRelativePath))}`,
            `Diverged: ${divergent.map((candidate) => relative(workspaceRoot, resolve(candidate.starter.sourceDir, leakScanRelativePath))).join(", ")}`,
            "Keep copyable starter leak-scan behavior consolidated by updating all copies together.",
          ].join(" "),
        ),
      );
    }
  });

const collectFiles = (rootDir, options = {}) =>
  Effect.gen(function* () {
    const files = [];
    const visit = (directory) =>
      Effect.gen(function* () {
        const entries = yield* fsEffect(
          `read ${relative(workspaceRoot, directory)}`,
          () => readdir(directory, { withFileTypes: true }),
        );
        for (const entry of entries) {
          const fullPath = resolve(directory, entry.name);
          if (options.filter && !options.filter(fullPath)) {
            continue;
          }
          if (entry.isDirectory()) {
            yield* visit(fullPath);
          } else if (entry.isFile()) {
            files.push(relativeTo(rootDir, fullPath));
          }
        }
      });

    yield* visit(rootDir);
    return files.sort((left, right) => left.localeCompare(right));
  });

const readPackageJson = (packageJsonPath) =>
  Effect.gen(function* () {
    const text = yield* fsEffect(
      `read ${relative(workspaceRoot, packageJsonPath)}`,
      () => readFile(packageJsonPath, "utf8"),
    );
    return yield* parseJsonEffect(packageJsonPath, text);
  });

const collectWorkspacePackages = collectWorkspacePackageManifests(workspaceRoot).pipe(
  Effect.map((manifests) =>
    new Map(manifests.map((manifest) => [manifest.packageJson.name, manifest]))
  ),
);

const workspaceDependencyNames = (packageJson, includeDevDependencies) => {
  const sections = [
    packageJson.dependencies,
    packageJson.peerDependencies,
    includeDevDependencies ? packageJson.devDependencies : undefined,
  ];
  return sections.flatMap((section) =>
    Object.entries(section ?? {})
      .filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"))
      .map(([name]) => name)
  );
};

const internalPackageClosure = (packageJson, workspacePackages) => {
  const seen = new Set();
  const pending = workspaceDependencyNames(packageJson, true);
  while (pending.length > 0) {
    const name = pending.shift();
    if (name === undefined || seen.has(name)) {
      continue;
    }

    const workspacePackage = workspacePackages.get(name);
    if (workspacePackage === undefined) {
      seen.add(name);
      continue;
    }

    seen.add(name);
    pending.push(...workspaceDependencyNames(workspacePackage.packageJson, false));
  }

  return [...seen].sort((left, right) => left.localeCompare(right));
};

const rewriteDependencyMap = (dependencies, workspacePackages, toFileReference) =>
  Effect.gen(function* () {
    if (dependencies == null) {
      return dependencies;
    }

    const entries = yield* Effect.forEach(Object.entries(dependencies), ([name, version]) =>
      Effect.gen(function* () {
        if (typeof version !== "string" || !version.startsWith("workspace:")) {
          return [name, version];
        }

        const workspacePackage = workspacePackages.get(name);
        if (workspacePackage === undefined) {
          return yield* Effect.fail(
            fail(
              `Starter depends on ${name}, but no workspace package manifest declares it.`,
              "Add the missing package manifest or remove the workspace protocol dependency before packaging.",
            ),
          );
        }

        return [name, toFileReference(workspacePackage)];
      })
    );
    return Object.fromEntries(entries);
  });

const rewritePackageDependencies = (packageJson, workspacePackages, toFileReference) =>
  Effect.gen(function* () {
    const dependencies = yield* rewriteDependencyMap(
      packageJson.dependencies,
      workspacePackages,
      toFileReference,
    );
    const peerDependencies = yield* rewriteDependencyMap(
      packageJson.peerDependencies,
      workspacePackages,
      toFileReference,
    );
    const devDependencies = yield* rewriteDependencyMap(
      packageJson.devDependencies,
      workspacePackages,
      toFileReference,
    );

    return {
      ...packageJson,
      dependencies,
      peerDependencies,
      devDependencies,
    };
  });

const workspacePackagePayloadTarget = (workspacePackage) =>
  Effect.gen(function* () {
    const policy = workspaceDistPackagePayloadPolicies.get(workspacePackage.packageJson.name);
    if (policy === undefined || policy.payload !== "dist-package") {
      return yield* Effect.fail(
        fail(
          `${workspacePackage.packageJson.name} generated local package adapter has no dist-package payload policy.`,
          "Keep workspace package payload policies shared between starter packaging and package dry-runs.",
        ),
      );
    }

    return {
      label: workspacePackage.packageJson.name,
      directory: workspacePackage.directory,
      packageJson: workspacePackage.packageJson,
      ...policy,
    };
  });

const declarationArtifactContentFailures = (target) =>
  Effect.gen(function* () {
    const failures = [];
    for (const artifact of target.declarationArtifacts ?? []) {
      if (!isNonEmptyString(artifact.source) || !isNonEmptyString(artifact.output)) {
        continue;
      }

      const sourcePath = resolve(target.directory, artifact.source);
      const outputPath = resolve(target.directory, artifact.output);
      const source = yield* fsEffect(
        `read ${relative(workspaceRoot, sourcePath)}`,
        () => readFile(sourcePath),
      );
      const output = yield* fsEffect(
        `read ${relative(workspaceRoot, outputPath)}`,
        () => readFile(outputPath),
      );
      if (!source.equals(output)) {
        failures.push(`${target.label} copied declaration artifact ${artifact.output} does not match ${artifact.source}.`);
      }

      for (const forbidden of artifact.forbidden ?? []) {
        if (!isNonEmptyString(forbidden)) {
          continue;
        }
        const forbiddenPath = resolve(target.directory, forbidden);
        if (yield* pathExists(forbiddenPath)) {
          failures.push(`${target.label} copied declaration artifact left forbidden file ${forbidden}.`);
        }
      }
    }
    return failures;
  });

const assertWorkspacePackageDistArtifacts = (workspacePackage, sourceDist) =>
  Effect.gen(function* () {
    const target = yield* workspacePackagePayloadTarget(workspacePackage);
    const sourceFiles = yield* collectFiles(resolve(workspacePackage.directory, "src"));
    const sourceStems = distPackageSourceStemsFromFiles(sourceFiles);
    const distFiles = (yield* collectFiles(sourceDist)).map((file) => `dist/${file}`);
    const distArtifactDrift = distPackageArtifactDriftFailures(target, distFiles, sourceStems);
    const declarationArtifactPackDrift = declarationArtifactPackFailures(target, distFiles);
    const declarationArtifactContentDrift =
      declarationArtifactPackDrift.length === 0
        ? yield* declarationArtifactContentFailures(target)
        : [];

    if (
      distArtifactDrift.length > 0 ||
      declarationArtifactPackDrift.length > 0 ||
      declarationArtifactContentDrift.length > 0
    ) {
      return yield* Effect.fail(
        fail(
          `${workspacePackage.packageJson.name} generated local package adapter dist artifacts are stale.`,
          [
            "Run a clean package build or remove stale dist files before packaging copyable starters.",
            ...distArtifactDrift,
            ...declarationArtifactPackDrift,
            ...declarationArtifactContentDrift,
          ].join(" "),
        ),
      );
    }
  });

const assertManifestTargetsInPayload = (label, packageJson, files) =>
  Effect.gen(function* () {
    const failures = manifestTargetValidationFailures({
      packageName: packageJson.name,
      packageJson,
      files,
      payloadLabel: label,
    });
    if (failures.length > 0) {
      return yield* Effect.fail(
        fail(
          `${label} contains manifest targets that are missing from the payload.`,
          [
            "Build the package or fix package.json exports/bin/main/types targets before packaging starters.",
            ...failures,
          ].join(" "),
        ),
      );
    }
  });

const ensureFreshWorkspacePackage = (builtPackageNames, workspacePackage) =>
  Effect.gen(function* () {
    const packageName = workspacePackage.packageJson.name;
    if (builtPackageNames.has(packageName)) {
      return;
    }
    if (usePrebuiltWorkspacePackages) {
      builtPackageNames.add(packageName);
      return;
    }

    yield* commandEffect(
      `${packageName} local package build`,
      "pnpm",
      ["--filter", packageName, "build"],
    );
    builtPackageNames.add(packageName);
  });

const writeLocalWorkspacePackage = (starter, workspacePackages, builtPackageNames, packageName) =>
  Effect.gen(function* () {
    const workspacePackage = workspacePackages.get(packageName);
    if (workspacePackage === undefined) {
      return yield* Effect.fail(
        fail(
          `Starter depends on ${packageName}, but no workspace package manifest declares it.`,
          "Add the missing package manifest or remove the workspace protocol dependency before packaging.",
        ),
      );
    }

    yield* ensureFreshWorkspacePackage(builtPackageNames, workspacePackage);

    const sourceDist = resolve(workspacePackage.directory, "dist");
    const distExists = yield* pathExists(sourceDist);
    if (!distExists) {
      return yield* Effect.fail(
        fail(
          `${relative(workspaceRoot, sourceDist)} does not exist.`,
          "Run pnpm build before packaging copyable starters so local file dependencies contain built artifacts.",
        ),
      );
    }
    yield* assertWorkspacePackageDistArtifacts(workspacePackage, sourceDist);

    const localPackageDir = resolve(
      starter.outputDir,
      localPackagesDirectoryName,
      workspacePackage.localDirectoryName,
    );
    yield* fsEffect(
      `create local package directory ${relative(workspaceRoot, localPackageDir)}`,
      () => mkdir(localPackageDir, { recursive: true }),
    );
    yield* fsEffect(
      `copy ${workspacePackage.packageJson.name} dist artifacts`,
      () => cp(sourceDist, resolve(localPackageDir, "dist"), { recursive: true }),
    );

    const localPackageJson = yield* rewritePackageDependencies(
      workspacePackage.packageJson,
      workspacePackages,
      (dependency) => `file:../${dependency.localDirectoryName}`,
    );
    yield* fsEffect(
      `write local ${workspacePackage.packageJson.name} package.json`,
      () => writeFile(resolve(localPackageDir, "package.json"), stringifyJson(localPackageJson)),
    );
    const localPackageFiles = yield* collectFiles(localPackageDir);
    yield* assertManifestTargetsInPayload(
      `${workspacePackage.packageJson.name} generated local package adapter`,
      localPackageJson,
      localPackageFiles,
    );
  });

const assertSameFileManifest = (starter, expected, actual) =>
  Effect.gen(function* () {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((filePath) => !actualSet.has(filePath));
    const extra = actual.filter((filePath) => !expectedSet.has(filePath));

    if (missing.length > 0 || extra.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} app file manifest does not match the copyable source manifest.`,
          [
            "Keep the copy filter and generated starter payload in sync.",
            missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined,
            extra.length > 0 ? `Extra: ${extra.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
  });

const assertNoForbiddenGeneratedAppSegments = (starter, files) =>
  Effect.gen(function* () {
    const forbidden = files.filter((file) =>
      !file.startsWith(`${localPackagesDirectoryName}/`) &&
      hasForbiddenSegment(file, forbiddenGeneratedAppSegments)
    );
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} includes forbidden build/dependency output paths.`,
          `Update the copy filter so these paths stay out of the starter payload: ${forbidden.join(", ")}.`,
        ),
      );
    }
  });

const assertNoWorkspaceProtocol = (starter) =>
  Effect.gen(function* () {
    const generatedFiles = yield* collectFiles(starter.outputDir, {
      filter: (filePath) => {
        const relativePath = relativeTo(starter.outputDir, filePath);
        return !relativePath.startsWith("node_modules/") && !relativePath.startsWith("dist/");
      },
    });
    const offenders = [];
    for (const file of generatedFiles) {
      if (!file.endsWith("package.json") && file !== localLockfileName) {
        continue;
      }
      const fileText = yield* fsEffect(
        `read ${relative(workspaceRoot, resolve(starter.outputDir, file))}`,
        () => readFile(resolve(starter.outputDir, file), "utf8"),
      );
      if (fileText.includes("workspace:")) {
        offenders.push(file);
      }
    }

    if (offenders.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} still contains workspace protocol dependencies.`,
          `Rewrite these files before publishing or copying the starter: ${offenders.join(", ")}.`,
        ),
      );
    }
  });

const assertGeneratedStarterArtifactsMatchSource = (starter) =>
  Effect.gen(function* () {
    const artifacts = generatedStarterArtifactsFor(starter.id);
    if (artifacts.length === 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} has no declared route or virtual artifacts.`,
          "Declare generated starter artifacts before packaging so standalone verify cannot silently repair them.",
        ),
      );
    }
    const changed = [];
    for (const artifact of artifacts) {
      const file = artifact.file;
      const sourcePath = resolve(starter.sourceDir, file);
      const generatedPath = resolve(starter.outputDir, file);
      const sourceExists = yield* pathExists(sourcePath);
      const generatedExists = yield* pathExists(generatedPath);
      if (!sourceExists && !generatedExists) {
        changed.push(`${file} (missing declared ${artifact.kind} artifact)`);
        continue;
      }
      if (!sourceExists || !generatedExists) {
        changed.push(file);
        continue;
      }
      const sourceText = yield* fsEffect(
        `read source ${starter.displayName} ${file}`,
        () => readFile(sourcePath, "utf8"),
      );
      const generatedText = yield* fsEffect(
        `read generated ${starter.displayName} ${file}`,
        () => readFile(generatedPath, "utf8"),
      );
      if (sourceText !== generatedText) {
        changed.push(file);
      }
    }

    if (changed.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} app content drifted during standalone verify.`,
          [
            `Changed route/virtual artifacts: ${changed.join(", ")}`,
            "Regenerate and commit these source starter artifacts before packaging so Vite does not silently repair the copied starter.",
          ].join(" "),
        ),
      );
    }
  });

const assertStandaloneReadme = (starter) =>
  Effect.gen(function* () {
    const readmePath = resolve(starter.outputDir, "README.md");
    const text = yield* fsEffect(
      `read generated ${starter.displayName} README`,
      () => readFile(readmePath, "utf8"),
    );
    const forbidden = forbiddenGeneratedReadmeFragments.filter((fragment) =>
      text.includes(fragment)
    );
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} README still contains workspace-only instructions.`,
          `Rewrite README.md for standalone use; remove: ${forbidden.join(", ")}.`,
        ),
      );
    }
  });

const assertCopyableSourceReadme = (starter) =>
  Effect.gen(function* () {
    const readmePath = resolve(starter.sourceDir, "README.md");
    const text = yield* fsEffect(
      `read source ${starter.displayName} README`,
      () => readFile(readmePath, "utf8"),
    );
    const forbidden = forbiddenSourceReadmeFragments.filter((fragment) =>
      text.includes(fragment)
    );
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `Source ${starter.displayName} README contains unpinned CLI instructions.`,
          `Keep copyable starter docs reproducible; remove: ${forbidden.join(", ")}.`,
        ),
      );
    }
  });

const parsePackDryRunOutput = (starter, stdout) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(stdout.trim()),
      catch: (cause) =>
        fail(
          `Failed to parse generated ${starter.displayName} package dry-run output.`,
          "Keep pnpm pack --dry-run --json output machine-readable.",
          cause,
        ),
    });
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof pack !== "object" || pack === null || !Array.isArray(pack.files)) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run output did not include a files array.`,
          "Keep pnpm pack --dry-run --json output machine-readable.",
        ),
      );
    }
    return pack;
  });

const assertGeneratedStarterPackageDryRun = (
  starter,
  workspacePackages,
  internalPackageNames,
  verifiedGeneratedAppFiles,
) =>
  Effect.gen(function* () {
    const packageJson = yield* readPackageJson(resolve(starter.outputDir, "package.json"));
    const { stdout } = yield* commandEffect(
      `${starter.displayName} package dry-run`,
      "pnpm",
      ["--ignore-workspace", "pack", "--dry-run", "--json"],
      { cwd: starter.outputDir },
    );
    const pack = yield* parsePackDryRunOutput(starter, stdout);
    const files = pack.files
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right));
    const packedAppFiles = files.filter((file) =>
      !file.startsWith(`${localPackagesDirectoryName}/`)
    );
    const forbidden = files.filter((file) =>
      !file.startsWith(`${localPackagesDirectoryName}/`) &&
      hasForbiddenSegment(file, forbiddenGeneratedAppSegments)
    );
    const forbiddenLocalPackageFiles = files.filter((file) =>
      file.startsWith(`${localPackagesDirectoryName}/`) &&
      (
        hasForbiddenSegment(file, forbiddenGeneratedLocalPackageSegments) ||
        forbiddenGeneratedPackageFileNames.has(file.split("/").at(-1) ?? "") ||
        file.endsWith(".tsbuildinfo")
      )
    );
    const expectedLocalPackageDirectories = internalPackageNames
      .map(localPackageDirectoryName)
      .sort((left, right) => left.localeCompare(right));
    const actualLocalPackageDirectories = [...new Set(
      files
        .filter((file) => file.startsWith(`${localPackagesDirectoryName}/`))
        .map((file) => file.split("/")[1])
        .filter((directory) => directory !== undefined)
    )].sort((left, right) => left.localeCompare(right));
    const actualLocalPackageDirectorySet = new Set(actualLocalPackageDirectories);
    const missingLocalPackages = expectedLocalPackageDirectories.filter((directory) =>
      !actualLocalPackageDirectorySet.has(directory)
    );
    const expectedLocalPackageDirectorySet = new Set(expectedLocalPackageDirectories);
    const unexpectedLocalPackages = actualLocalPackageDirectories.filter((directory) =>
      !expectedLocalPackageDirectorySet.has(directory)
    );
    const missingLocalPackageFiles = expectedLocalPackageDirectories.flatMap((directory) =>
      [
        `${localPackagesDirectoryName}/${directory}/package.json`,
        `${localPackagesDirectoryName}/${directory}/dist/index.js`,
        `${localPackagesDirectoryName}/${directory}/dist/index.d.ts`,
      ].filter((file) => !files.includes(file))
    );
    const referencedLocalPackageDirectories = localPackageReferences(packageJson)
      .sort((left, right) => left.localeCompare(right));
    const referencedLocalPackageDirectorySet = new Set(referencedLocalPackageDirectories);
    const unreferencedLocalPackages = expectedLocalPackageDirectories.filter((directory) =>
      !referencedLocalPackageDirectorySet.has(directory)
    );
    const unknownLocalPackageReferences = referencedLocalPackageDirectories.filter((directory) =>
      !expectedLocalPackageDirectorySet.has(directory)
    );
    const verifiedAppFileSet = new Set(verifiedGeneratedAppFiles);
    const packedAppFileSet = new Set(packedAppFiles);
    const missingPackedAppFiles = verifiedGeneratedAppFiles.filter((file) =>
      !packedAppFileSet.has(file)
    );
    const extraPackedAppFiles = packedAppFiles.filter((file) =>
      !verifiedAppFileSet.has(file)
    );
    const localPackageManifestTargetFailures = [];
    for (const packageName of internalPackageNames) {
      const workspacePackage = workspacePackages.get(packageName);
      if (workspacePackage === undefined) {
        return yield* Effect.fail(
          fail(
            `Generated ${starter.displayName} references ${packageName}, but no workspace package manifest declares it.`,
            "Keep generated local package adapter validation aligned with workspace package discovery.",
          ),
        );
      }
      const prefix = `${localPackagesDirectoryName}/${workspacePackage.localDirectoryName}/`;
      const adapterFiles = files
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length));
      const localPackageJson = yield* readPackageJson(
        resolve(starter.outputDir, prefix, "package.json"),
      );
      localPackageManifestTargetFailures.push(
        ...manifestTargetValidationFailures({
          packageName,
          packageJson: localPackageJson,
          files: adapterFiles,
          payloadLabel: `generated ${starter.displayName} ${packageName} local package adapter`,
        }),
      );
    }

    if (missingLocalPackages.length > 0 || unexpectedLocalPackages.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run has incomplete local file package adapters.`,
          [
            "Keep generated starter package payloads aligned with local file dependencies.",
            missingLocalPackages.length > 0 ? `Missing: ${missingLocalPackages.join(", ")}` : undefined,
            unexpectedLocalPackages.length > 0 ? `Unexpected: ${unexpectedLocalPackages.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
    if (missingLocalPackageFiles.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run omits required local package files.`,
          `Include these local package files in the tarball payload: ${missingLocalPackageFiles.join(", ")}.`,
        ),
      );
    }
    if (unreferencedLocalPackages.length > 0 || unknownLocalPackageReferences.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package.json local file references do not match the packaged adapters.`,
          [
            "Keep dependencies and pnpm overrides aligned with the generated local package payload.",
            unreferencedLocalPackages.length > 0 ? `Unreferenced adapters: ${unreferencedLocalPackages.join(", ")}` : undefined,
            unknownLocalPackageReferences.length > 0 ? `Unknown references: ${unknownLocalPackageReferences.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
    if (missingPackedAppFiles.length > 0 || extraPackedAppFiles.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run app file manifest does not match the verified generated app tree.`,
          [
            "Keep the generated starter tarball payload aligned with the post-verify app files.",
            missingPackedAppFiles.length > 0 ? `Missing from tarball: ${missingPackedAppFiles.join(", ")}` : undefined,
            extraPackedAppFiles.length > 0 ? `Extra in tarball: ${extraPackedAppFiles.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
    if (localPackageManifestTargetFailures.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run contains local package manifest targets missing from the tarball.`,
          [
            "Keep generated local package adapter exports/bin/main/types targets inside the packaged payload.",
            ...localPackageManifestTargetFailures,
          ].join(" "),
        ),
      );
    }
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run includes forbidden app artifacts.`,
          `Remove these generated app paths from the tarball payload: ${forbidden.join(", ")}.`,
        ),
      );
    }
    if (forbiddenLocalPackageFiles.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run includes forbidden local package artifacts.`,
          `Remove these local package paths from the tarball payload: ${forbiddenLocalPackageFiles.join(", ")}.`,
        ),
      );
    }
  });

const localPackageReferencesFromMap = (dependencies) =>
  Object.values(dependencies ?? {})
    .filter((value) => typeof value === "string")
    .flatMap((value) => {
      const prefix = `file:${localPackagesDirectoryName}/`;
      return value.startsWith(prefix) ? [value.slice(prefix.length)] : [];
    });

const localPackageReferences = (packageJson) =>
  [
    ...localPackageReferencesFromMap(packageJson.dependencies),
    ...localPackageReferencesFromMap(packageJson.peerDependencies),
    ...localPackageReferencesFromMap(packageJson.devDependencies),
    ...localPackageReferencesFromMap(packageJson.pnpm?.overrides),
  ];

const verifyStandaloneConfigs = (starter) =>
  Effect.gen(function* () {
    const viteConfigText = yield* fsEffect(
      `read generated ${starter.displayName} Vite config`,
      () => readFile(resolve(starter.outputDir, "vite.config.ts"), "utf8"),
    );
    if (
      viteConfigText.includes("fromRoot") ||
      viteConfigText.includes("../../") ||
      viteConfigText.includes("packages/")
    ) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} Vite config still contains monorepo aliases.`,
          "Rewrite the generated Vite config so it uses local file-package @effect-ui imports without monorepo aliases.",
        ),
      );
    }

    const tsConfigText = yield* fsEffect(
      `read generated ${starter.displayName} tsconfig`,
      () => readFile(resolve(starter.outputDir, "tsconfig.json"), "utf8"),
    );
    if (tsConfigText.includes("../../tsconfig.base.json")) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} tsconfig still extends the monorepo base config.`,
          "Write a standalone tsconfig for the generated starter.",
        ),
      );
    }
  });

const cleanupGeneratedInstallArtifacts = (starter) =>
  Effect.gen(function* () {
    yield* fsEffect(
      `remove generated ${starter.displayName} install dependencies`,
      () => rm(resolve(starter.outputDir, "node_modules"), { force: true, recursive: true }),
    );
    yield* fsEffect(
      `remove generated ${starter.displayName} build output`,
      () => rm(resolve(starter.outputDir, "dist"), { force: true, recursive: true }),
    );
    yield* fsEffect(
      `remove generated ${starter.displayName} test output`,
      () => rm(resolve(starter.outputDir, ".test-dist"), { force: true, recursive: true }),
    );
    yield* fsEffect(
      `remove generated ${starter.displayName} install lockfile`,
      () => rm(resolve(starter.outputDir, localLockfileName), { force: true }),
    );
  });

const verifyInstallableStarter = (starter) =>
  Effect.gen(function* () {
    yield* Effect.gen(function* () {
      yield* commandEffect(
        `${starter.displayName} standalone install`,
        "pnpm",
        ["--ignore-workspace", "install", "--ignore-scripts"],
        { cwd: starter.outputDir },
      );
      yield* assertNoWorkspaceProtocol(starter);
      if (useFastWorkspaceStarterVerify) {
        yield* commandEffect(
          `${starter.displayName} generated starter typecheck`,
          "pnpm",
          ["--ignore-workspace", "typecheck"],
          { cwd: starter.outputDir },
        );
        yield* commandEffect(
          `${starter.displayName} generated starter tests`,
          "pnpm",
          ["--ignore-workspace", "test"],
          { cwd: starter.outputDir },
        );
        yield* commandEffect(
          `${starter.displayName} generated starter Vite build`,
          "pnpm",
          ["--ignore-workspace", "exec", "vite", "build"],
          { cwd: starter.outputDir },
        );
        yield* commandEffect(
          `${starter.displayName} generated starter leak scan`,
          "pnpm",
          ["--ignore-workspace", "leak-scan"],
          { cwd: starter.outputDir },
        );
      } else {
        yield* commandEffect(
          `${starter.displayName} generated starter verify`,
          "pnpm",
          ["--ignore-workspace", "verify"],
          { cwd: starter.outputDir },
        );
      }
      yield* assertNoWorkspaceProtocol(starter);
    }).pipe(Effect.ensuring(cleanupGeneratedInstallArtifacts(starter)));
  });

const rewriteStarterPackageJson = (starter, workspacePackages, packageJson, internalPackageNames) =>
  Effect.gen(function* () {
    const localReference = (workspacePackage) =>
      `file:${localPackagesDirectoryName}/${workspacePackage.localDirectoryName}`;
    const rewrittenPackageJson = yield* rewritePackageDependencies(
      packageJson,
      workspacePackages,
      localReference,
    );
    const overrides = Object.fromEntries(
      internalPackageNames.map((name) => {
        const workspacePackage = workspacePackages.get(name);
        return [name, localReference(workspacePackage)];
      }),
    );
    const packageJsonPath = resolve(starter.outputDir, "package.json");
    const starterPackageJson = {
      ...rewrittenPackageJson,
      name: starter.packageName,
      version: "0.0.0",
      private: true,
      files: [...new Set([...(rewrittenPackageJson.files ?? []), localPackagesDirectoryName])],
      scripts: {
        ...rewrittenPackageJson.scripts,
        dev: "vite",
      },
      pnpm: {
        ...rewrittenPackageJson.pnpm,
        overrides: {
          ...rewrittenPackageJson.pnpm?.overrides,
          ...overrides,
        },
      },
    };

    yield* fsEffect(
      `write generated ${starter.displayName} package.json`,
      () => writeFile(packageJsonPath, stringifyJson(starterPackageJson)),
    );
  });

const rewriteMonorepoConfig = (starter) =>
  Effect.gen(function* () {
    yield* fsEffect(`write standalone ${starter.displayName} Vite config`, () =>
      writeFile(resolve(starter.outputDir, "vite.config.ts"), starter.viteConfig),
    );
    yield* fsEffect(`write standalone ${starter.displayName} tsconfig`, () =>
      writeFile(resolve(starter.outputDir, "tsconfig.json"), stringifyJson(starter.tsConfig)),
    );
    yield* fsEffect(`write standalone ${starter.displayName} README`, () =>
      writeFile(resolve(starter.outputDir, "README.md"), starter.readme),
    );
  });

const packageStarter = (workspacePackages, builtPackageNames, starter) =>
  Effect.gen(function* () {
    const sourcePackageJsonPath = resolve(starter.sourceDir, "package.json");
    const sourcePackageJson = yield* readPackageJson(sourcePackageJsonPath);
    const internalPackageNames = internalPackageClosure(sourcePackageJson, workspacePackages);

    yield* assertCopyableSourceReadme(starter);
    yield* fsEffect(`remove the previous generated ${starter.displayName}`, () =>
      rm(starter.outputDir, { force: true, recursive: true }),
    );
    yield* fsEffect(`create the generated ${starter.displayName} parent directory`, () =>
      mkdir(dirname(starter.outputDir), { recursive: true }),
    );
    yield* fsEffect(`copy the ${starter.displayName} source`, () =>
      cp(starter.sourceDir, starter.outputDir, {
        filter: shouldCopySourcePath(starter.sourceDir),
        recursive: true,
      }),
    );
    yield* rewriteStarterPackageJson(
      starter,
      workspacePackages,
      sourcePackageJson,
      internalPackageNames,
    );
    yield* rewriteMonorepoConfig(starter);
    yield* Effect.forEach(internalPackageNames, (packageName) =>
      writeLocalWorkspacePackage(starter, workspacePackages, builtPackageNames, packageName)
    );

    const expectedFiles = yield* collectFiles(starter.sourceDir, {
      filter: shouldCopySourcePath(starter.sourceDir),
    });
    const collectGeneratedAppFiles = () => collectFiles(starter.outputDir, {
      filter: (filePath) =>
        !relativeTo(starter.outputDir, filePath).startsWith(`${localPackagesDirectoryName}/`),
    });
    const generatedAppFiles = yield* collectGeneratedAppFiles();

    yield* assertSameFileManifest(starter, expectedFiles, generatedAppFiles);
    yield* assertNoForbiddenGeneratedAppSegments(starter, generatedAppFiles);
    yield* verifyStandaloneConfigs(starter);
    yield* assertStandaloneReadme(starter);
    yield* assertNoWorkspaceProtocol(starter);
    yield* verifyInstallableStarter(starter);
    const verifiedGeneratedAppFiles = yield* collectGeneratedAppFiles();
    yield* assertSameFileManifest(starter, expectedFiles, verifiedGeneratedAppFiles);
    yield* assertNoForbiddenGeneratedAppSegments(starter, verifiedGeneratedAppFiles);
    yield* assertGeneratedStarterArtifactsMatchSource(starter);
    yield* assertStandaloneReadme(starter);
    yield* assertNoWorkspaceProtocol(starter);
    yield* assertGeneratedStarterPackageDryRun(
      starter,
      workspacePackages,
      internalPackageNames,
      verifiedGeneratedAppFiles,
    );

    return {
      id: starter.id,
      outputDir: starter.outputDir,
      appFiles: verifiedGeneratedAppFiles.length,
      localPackages: internalPackageNames.length,
    };
  });

const packageStarters = Effect.gen(function* () {
  yield* starterCatalogConsistencyEffect();
  const workspacePackages = yield* collectWorkspacePackages;
  yield* assertStarterLeakScanParity(starterDefinitions);
  const builtPackageNames = new Set();
  const starterConcurrency =
    usePrebuiltWorkspacePackages && useFastWorkspaceStarterVerify
      ? starterDefinitions.length
      : 1;
  const results = yield* Effect.forEach(
    starterDefinitions,
    (starter) => packageStarter(workspacePackages, builtPackageNames, starter),
    { concurrency: starterConcurrency },
  );

  return results;
});

const reportPackagedStartersEffect = (results) =>
  Effect.sync(() => {
    for (const result of results) {
      console.log(
        `Packaged ${result.id} starter at ${relative(workspaceRoot, result.outputDir)} (${result.appFiles} app files, ${result.localPackages} local packages verified).`,
      );
    }
  });

const reportPackageFailureEffect = (cause) =>
  Effect.sync(() => {
    console.error(cause);
    process.exitCode = 1;
  });

await Effect.runPromise(
  packageStarters.pipe(
    Effect.flatMap(reportPackagedStartersEffect),
    Effect.catch(reportPackageFailureEffect),
  ),
);
