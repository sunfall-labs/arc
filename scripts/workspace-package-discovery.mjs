import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";

class WorkspacePackageDiscoveryError extends Data.TaggedError("WorkspacePackageDiscoveryError") {}

const fail = (message, repair, cause) =>
  new WorkspacePackageDiscoveryError({ message, repair, cause });

const toPosixPath = (filePath) => filePath.split(sep).join("/");

const relativeToWorkspace = (workspaceRoot, filePath) =>
  toPosixPath(relative(workspaceRoot, filePath));

const fsEffect = (workspaceRoot, description, evaluate) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      fail(
        `Failed to ${description}.`,
        "Run from the repository root and check filesystem permissions.",
        cause,
      ),
  });

const parseJsonEffect = (workspaceRoot, filePath, text) =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) =>
      fail(
        `Failed to parse ${relativeToWorkspace(workspaceRoot, filePath)}.`,
        "Keep package.json valid JSON.",
        cause,
      ),
  });

const isNodeNotFoundError = (cause) =>
  cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT";

const pathExists = (workspaceRoot, filePath) =>
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
              `Failed to check whether ${relativeToWorkspace(workspaceRoot, filePath)} exists.`,
              "Run from the repository root and check filesystem permissions.",
              cause,
            ),
          ),
    ),
  );

export const localPackageDirectoryName = (packageName) =>
  packageName.replace(/^@/, "").replace(/\//g, "-");

export const parseWorkspacePackageGlobs = (text) => {
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

const packageJsonPathsForWorkspaceGlob = (workspaceRoot, workspaceGlob) =>
  Effect.gen(function* () {
    if (
      workspaceGlob.startsWith("!") ||
      !workspaceGlob.endsWith("/*") ||
      workspaceGlob.slice(0, -2).includes("*")
    ) {
      return yield* Effect.fail(
        fail(
          `Unsupported workspace package glob "${workspaceGlob}".`,
          "Update workspace package discovery before changing pnpm-workspace.yaml glob shape.",
        ),
      );
    }

    const parentDirectory = resolve(workspaceRoot, workspaceGlob.slice(0, -2));
    const entries = yield* fsEffect(
      workspaceRoot,
      `read workspace package glob ${workspaceGlob}`,
      () => readdir(parentDirectory, { withFileTypes: true }),
    );
    const packageJsonPaths = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageJsonPath = resolve(parentDirectory, entry.name, "package.json");
      if (yield* pathExists(workspaceRoot, packageJsonPath)) {
        packageJsonPaths.push(packageJsonPath);
      }
    }
    return packageJsonPaths.sort((left, right) => left.localeCompare(right));
  });

const readPackageJson = (workspaceRoot, packageJsonPath) =>
  Effect.gen(function* () {
    const text = yield* fsEffect(
      workspaceRoot,
      `read ${relativeToWorkspace(workspaceRoot, packageJsonPath)}`,
      () => readFile(packageJsonPath, "utf8"),
    );
    const packageJson = yield* parseJsonEffect(workspaceRoot, packageJsonPath, text);
    if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
      return yield* Effect.fail(
        fail(
          `${relativeToWorkspace(workspaceRoot, packageJsonPath)} must declare string name and version fields.`,
          "Keep workspace package manifests package-manager addressable.",
        ),
      );
    }
    return {
      directory: dirname(packageJsonPath),
      packageJson,
      packageJsonPath,
      localDirectoryName: localPackageDirectoryName(packageJson.name),
    };
  });

export const collectWorkspacePackageManifests = (workspaceRoot) =>
  Effect.gen(function* () {
    const workspaceManifestPath = resolve(workspaceRoot, "pnpm-workspace.yaml");
    const workspaceManifest = yield* fsEffect(
      workspaceRoot,
      `read ${relativeToWorkspace(workspaceRoot, workspaceManifestPath)}`,
      () => readFile(workspaceManifestPath, "utf8"),
    );
    const workspaceGlobs = parseWorkspacePackageGlobs(workspaceManifest);
    if (workspaceGlobs.length === 0) {
      return yield* Effect.fail(
        fail(
          "pnpm-workspace.yaml does not declare any package globs.",
          "Declare workspace packages before running package verification.",
        ),
      );
    }

    const packageJsonPaths = (yield* Effect.forEach(workspaceGlobs, (workspaceGlob) =>
      packageJsonPathsForWorkspaceGlob(workspaceRoot, workspaceGlob),
    )).flat();
    const manifests = yield* Effect.forEach(packageJsonPaths, (packageJsonPath) =>
      readPackageJson(workspaceRoot, packageJsonPath),
    );
    const names = new Set();
    const duplicateNames = [];
    const localDirectoryNames = new Map();
    const duplicateLocalDirectoryNames = [];
    for (const manifest of manifests) {
      const name = manifest.packageJson.name;
      if (names.has(name)) {
        duplicateNames.push(name);
      }
      names.add(name);
      const previousPackageName = localDirectoryNames.get(manifest.localDirectoryName);
      if (previousPackageName !== undefined) {
        duplicateLocalDirectoryNames.push(
          `${manifest.localDirectoryName} (${previousPackageName}, ${name})`,
        );
      } else {
        localDirectoryNames.set(manifest.localDirectoryName, name);
      }
    }
    if (duplicateNames.length > 0) {
      return yield* Effect.fail(
        fail(
          "Workspace package manifests declare duplicate package names.",
          `Make package names unique before verification: ${duplicateNames.join(", ")}.`,
        ),
      );
    }
    if (duplicateLocalDirectoryNames.length > 0) {
      return yield* Effect.fail(
        fail(
          "Workspace package manifests map to duplicate local package adapter directories.",
          `Rename packages or update local package directory mapping before verification: ${duplicateLocalDirectoryNames.join(", ")}.`,
        ),
      );
    }

    return manifests.sort((left, right) =>
      left.packageJson.name.localeCompare(right.packageJson.name),
    );
  });
