#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);

class PackageDryRunError extends Data.TaggedError("PackageDryRunError") {}

const fail = (message, repair, cause) =>
  new PackageDryRunError({ message, repair, cause });

const frameworkPackageTargets = [
  "@effect-ui/core",
  "@effect-ui/db",
  "@effect-ui/devtools",
  "@effect-ui/react",
  "@effect-ui/react-db",
  "@effect-ui/solid",
  "@effect-ui/solid-db",
  "@effect-ui/start",
  "@effect-ui/start-fetch",
  "@effect-ui/start-node",
  "@effect-ui/tsrx",
].map((filter) => ({
  label: `${filter} package`,
  filter,
  payload: "dist-package",
}));

const copyablePackageTargets = [
  {
    label: "basic starter",
    filter: "@effect-ui/starter-basic",
    payload: "copyable-source",
    requiresGitignore: true,
  },
  {
    label: "React starter",
    filter: "@effect-ui/starter-react",
    payload: "copyable-source",
    requiresGitignore: true,
  },
  {
    label: "project-console example",
    filter: "@effect-ui/example-project-console",
    payload: "copyable-source",
    requiresGitignore: true,
  },
  {
    label: "devtools panel example",
    filter: "@effect-ui/example-devtools-panel",
    payload: "copyable-source",
    requiresGitignore: true,
  },
  {
    label: "devtools extension example",
    filter: "@effect-ui/example-devtools-extension",
    payload: "copyable-source",
    requiresGitignore: true,
  },
];

const packageTargets = [...frameworkPackageTargets, ...copyablePackageTargets];

const forbiddenGeneratedSegments = new Set([".test-dist", "node_modules"]);
const forbiddenCopyableSegments = new Set(["dist", ...forbiddenGeneratedSegments]);
const forbiddenFileNames = new Set([
  ".DS_Store",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

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
    : forbiddenCopyableSegments;
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

const verifyPackageDryRuns = Effect.forEach(packageTargets, verifyPackageTarget);

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
