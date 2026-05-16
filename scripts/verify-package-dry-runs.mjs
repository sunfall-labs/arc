#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { manifestTargetValidationFailures } from "./package-manifest-targets.mjs";
import { collectWorkspacePackageManifests } from "./workspace-package-discovery.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(__dirname);

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
  [
    "@effect-ui/example-project-console",
    {
      payload: "source-package",
      requiresGitignore: true,
      requiredFiles: [
        "README.md",
        "index.html",
        "scripts/leak-scan.mjs",
        "src/App.tsx",
        "src/app-definition.ts",
        "src/domain.contract.ts",
        "src/domain.server.ts",
        "src/domain.ts",
        "src/effect-ui-start-virtual.d.ts",
        "src/main.tsx",
        "src/project-collections.ts",
        "src/project-error.ts",
        "src/routeTree.gen.ts",
        "src/routes/index.ts",
        "src/server.tsx",
        "src/start-graph.ts",
        "src/start-options.ts",
        "src/virtual-manifest-types.ts",
        "tsconfig.json",
        "vite.config.ts",
      ],
      requiredDirectories: ["scripts", "src"],
    },
  ],
  [
    "@effect-ui/starter-basic",
    {
      payload: "source-package",
      requiresGitignore: true,
      requiredFiles: [
        "README.md",
        "index.html",
        "scripts/leak-scan.mjs",
        "src/App.tsx",
        "src/app-definition.ts",
        "src/effect-ui-start-virtual.d.ts",
        "src/main.tsx",
        "src/routeTree.gen.ts",
        "src/routes/index.ts",
        "src/server.tsx",
        "src/start-options.ts",
        "tsconfig.json",
        "vite.config.ts",
      ],
      requiredDirectories: ["scripts", "src"],
    },
  ],
  [
    "@effect-ui/starter-react",
    {
      payload: "source-package",
      requiresGitignore: true,
      requiredFiles: [
        "README.md",
        "components.json",
        "index.html",
        "scripts/leak-scan.mjs",
        "src/App.tsx",
        "src/HomePage.tsx",
        "src/app-definition.ts",
        "src/effect-ui-start-virtual.d.ts",
        "src/main.tsx",
        "src/routeTree.gen.ts",
        "src/routes/index.ts",
        "src/server.tsx",
        "src/start-options.ts",
        "tsconfig.json",
        "vite.config.ts",
      ],
      requiredDirectories: ["scripts", "src"],
    },
  ],
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

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

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

const failSelfTest = (message) => {
  console.error(message);
  process.exit(1);
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
    },
  },
  [".gitignore"],
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
        packageJson: manifest.packageJson,
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
    const missingManifestTargets = manifestTargetValidationFailures({
      packageName: target.label,
      packageJson: target.packageJson,
      files,
      payloadLabel: `${target.label} package dry-run`,
    });

    if (target.requiresGitignore && !files.includes(".gitignore")) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run is missing .gitignore.`,
          "Add .gitignore to the package files allowlist so copied examples keep local artifact hygiene.",
        ),
      );
    }
    if (missingManifestTargets.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run contains manifest targets that are missing from the payload.`,
          [
            "Build the package or fix package.json exports/bin/main/types targets before publishing.",
            ...missingManifestTargets,
          ].join(" "),
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
