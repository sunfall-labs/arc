#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);
const workspaceManifestPath = resolve(workspaceRoot, "pnpm-workspace.yaml");

class PackageDryRunError extends Data.TaggedError("PackageDryRunError") {}

const fail = (message, repair, cause) =>
  new PackageDryRunError({ message, repair, cause });

const packagePayloadPolicies = new Map([
  ["@effect-ui/core", { payload: "dist-package" }],
  ["@effect-ui/db", { payload: "dist-package" }],
  ["@effect-ui/devtools", { payload: "dist-package" }],
  ["@effect-ui/react", { payload: "dist-package" }],
  ["@effect-ui/react-db", { payload: "dist-package" }],
  ["@effect-ui/solid", { payload: "dist-package" }],
  ["@effect-ui/solid-db", { payload: "dist-package" }],
  ["@effect-ui/start", { payload: "dist-package" }],
  ["@effect-ui/start-fetch", { payload: "dist-package" }],
  ["@effect-ui/start-node", { payload: "dist-package" }],
  ["@effect-ui/tsrx", { payload: "dist-package" }],
  [
    "@effect-ui/example-devtools-extension",
    { payload: "source-package", requiresGitignore: true },
  ],
  [
    "@effect-ui/example-devtools-panel",
    { payload: "source-package", requiresGitignore: true },
  ],
  [
    "@effect-ui/example-project-console",
    { payload: "source-package", requiresGitignore: true },
  ],
  ["@effect-ui/starter-basic", { payload: "source-package", requiresGitignore: true }],
  ["@effect-ui/starter-react", { payload: "source-package", requiresGitignore: true }],
]);

const knownPayloadPolicies = new Set(["dist-package", "source-package"]);

const forbiddenGeneratedSegments = new Set([".test-dist", "node_modules"]);
const forbiddenSourcePackageSegments = new Set(["dist", ...forbiddenGeneratedSegments]);
const forbiddenFileNames = new Set([
  ".DS_Store",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const toPosixPath = (filePath) => filePath.split(sep).join("/");

const relativeToWorkspace = (filePath) =>
  toPosixPath(relative(workspaceRoot, filePath));

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

const parseJsonEffect = (filePath, text) =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) =>
      fail(
        `Failed to parse ${relativeToWorkspace(filePath)}.`,
        "Keep package.json valid JSON.",
        cause,
      ),
  });

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
              `Failed to check whether ${relativeToWorkspace(filePath)} exists.`,
              "Run from the repository root and check filesystem permissions.",
              cause,
            ),
          ),
    ),
  );

const parseWorkspacePackageGlobs = (text) => {
  const packageGlobs = [];
  let inPackages = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line === "packages:") {
      inPackages = true;
      continue;
    }
    if (!inPackages) {
      continue;
    }
    if (!line.startsWith("- ")) {
      break;
    }
    const workspaceGlob = line
      .slice(2)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (workspaceGlob !== "") {
      packageGlobs.push(workspaceGlob);
    }
  }
  return packageGlobs;
};

const packageJsonPathsForWorkspaceGlob = (workspaceGlob) =>
  Effect.gen(function* () {
    if (
      workspaceGlob.startsWith("!") ||
      !workspaceGlob.endsWith("/*") ||
      workspaceGlob.slice(0, -2).includes("*")
    ) {
      return yield* Effect.fail(
        fail(
          `Unsupported workspace package glob "${workspaceGlob}".`,
          "Update package dry-run workspace discovery before changing pnpm-workspace.yaml glob shape.",
        ),
      );
    }

    const parentDirectory = resolve(workspaceRoot, workspaceGlob.slice(0, -2));
    const entries = yield* fsEffect(
      `read workspace package glob ${workspaceGlob}`,
      () => readdir(parentDirectory, { withFileTypes: true }),
    );
    const packageJsonPaths = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageJsonPath = resolve(parentDirectory, entry.name, "package.json");
      if (yield* pathExists(packageJsonPath)) {
        packageJsonPaths.push(packageJsonPath);
      }
    }
    return packageJsonPaths.sort((left, right) => left.localeCompare(right));
  });

const readPackageJson = (packageJsonPath) =>
  Effect.gen(function* () {
    const text = yield* fsEffect(
      `read ${relativeToWorkspace(packageJsonPath)}`,
      () => readFile(packageJsonPath, "utf8"),
    );
    const packageJson = yield* parseJsonEffect(packageJsonPath, text);
    if (typeof packageJson.name !== "string") {
      return yield* Effect.fail(
        fail(
          `${relativeToWorkspace(packageJsonPath)} must declare a string name field.`,
          "Keep workspace package manifests package-manager addressable.",
        ),
      );
    }
    return { packageJsonPath, packageJson };
  });

const collectWorkspacePackageManifests = Effect.gen(function* () {
  const workspaceManifest = yield* fsEffect(
    `read ${relativeToWorkspace(workspaceManifestPath)}`,
    () => readFile(workspaceManifestPath, "utf8"),
  );
  const workspaceGlobs = parseWorkspacePackageGlobs(workspaceManifest);
  if (workspaceGlobs.length === 0) {
    return yield* Effect.fail(
      fail(
        "pnpm-workspace.yaml does not declare any package globs.",
        "Declare workspace packages before running package dry-run verification.",
      ),
    );
  }

  const packageJsonPaths = (yield* Effect.forEach(
    workspaceGlobs,
    packageJsonPathsForWorkspaceGlob,
  )).flat();
  const manifests = yield* Effect.forEach(packageJsonPaths, readPackageJson);
  const names = new Set();
  const duplicateNames = [];
  for (const manifest of manifests) {
    const name = manifest.packageJson.name;
    if (names.has(name)) {
      duplicateNames.push(name);
    }
    names.add(name);
  }
  if (duplicateNames.length > 0) {
    return yield* Effect.fail(
      fail(
        "Workspace package manifests declare duplicate package names.",
        `Make package names unique before package dry-run verification: ${duplicateNames.join(", ")}.`,
      ),
    );
  }

  return manifests.sort((left, right) =>
    left.packageJson.name.localeCompare(right.packageJson.name)
  );
});

const workspacePackageTargets = collectWorkspacePackageManifests.pipe(
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
        ...packagePayloadPolicies.get(manifest.packageJson.name),
      }));
    }),
  ),
);

const commandEffect = (description, command, args, options = {}) =>
  Effect.callback((resume) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (cause) =>
      resume(
        Effect.fail(
          fail(
            `Failed to run ${description}.`,
            "Ensure pnpm is available on PATH and package metadata is valid.",
            cause,
          ),
        ),
      ),
    );
    child.on("close", (code) => {
      if (code === 0) {
        resume(Effect.succeed({ stdout, stderr }));
        return;
      }

      resume(
        Effect.fail(
          fail(
            `Command failed while running ${description}.`,
            [
              `Command: ${command} ${args.join(" ")}`,
              `Exit code: ${code}`,
              stdout.trim() === "" ? undefined : `stdout: ${stdout.trim()}`,
              stderr.trim() === "" ? undefined : `stderr: ${stderr.trim()}`,
            ].filter(Boolean).join(" "),
            { code, stdout, stderr },
          ),
        ),
      );
    });

    return Effect.sync(() => {
      if (!child.killed) {
        child.kill();
      }
    });
  });

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

const verifyPackageTarget = (target) =>
  Effect.gen(function* () {
    const { stdout } = yield* commandEffect(
      `${target.label} package dry-run`,
      "pnpm",
      ["--filter", target.filter, "pack", "--dry-run", "--json"],
    );
    const pack = yield* parsePackOutput(target, stdout);
    const files = pack.files.map((file) => file.path).sort((left, right) => left.localeCompare(right));
    const forbidden = files.filter((file) => hasForbiddenPath(target, file));

    if (target.requiresGitignore && !files.includes(".gitignore")) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run is missing .gitignore.`,
          "Add .gitignore to the package files allowlist so copied examples keep local artifact hygiene.",
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

    return {
      label: target.label,
      files: files.length,
    };
  });

const verifyPackageDryRuns = workspacePackageTargets.pipe(
  Effect.flatMap((packageTargets) => Effect.forEach(packageTargets, verifyPackageTarget)),
);

const reportResultsEffect = (results) =>
  Effect.sync(() => {
    for (const result of results) {
      console.log(`Verified ${result.label} package dry-run (${result.files} files).`);
    }
  });

const reportFailureEffect = (cause) =>
  Effect.sync(() => {
    console.error(cause);
    process.exitCode = 1;
  });

await Effect.runPromise(
  verifyPackageDryRuns.pipe(
    Effect.flatMap(reportResultsEffect),
    Effect.catch(reportFailureEffect),
  ),
);
