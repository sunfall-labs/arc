#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { manifestTargetValidationFailures } from "./package-manifest-targets.mjs";
import { starterSourcePackagePayloadPolicies } from "./starter-catalog.mjs";
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
  [
    "@effect-ui/start",
    {
      payload: "dist-package",
      declarationArtifacts: [
        {
          source: "src/virtual-modules.d.ts",
          output: "dist/virtual.d.ts",
          forbidden: ["dist/virtual.d.ts.map"],
        },
      ],
    },
  ],
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
  ...starterSourcePackagePayloadPolicies,
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

const stripSourceExtension = (filePath) =>
  filePath
    .replace(/\.d\.ts$/, "")
    .replace(/\.[cm]?tsx?$/, "");

const stripDistArtifactExtension = (filePath) =>
  filePath
    .replace(/\.d\.ts\.map$/, "")
    .replace(/\.d\.ts$/, "")
    .replace(/\.js\.map$/, "")
    .replace(/\.js$/, "");

const distArtifactStem = (filePath) => {
  if (!filePath.startsWith("dist/")) {
    return undefined;
  }
  if (
    !filePath.endsWith(".js") &&
    !filePath.endsWith(".js.map") &&
    !filePath.endsWith(".d.ts") &&
    !filePath.endsWith(".d.ts.map")
  ) {
    return undefined;
  }
  return stripDistArtifactExtension(filePath.slice("dist/".length));
};

const distArtifactKind = (filePath) => {
  if (filePath.endsWith(".js.map")) {
    return "js.map";
  }
  if (filePath.endsWith(".d.ts.map")) {
    return "types.map";
  }
  if (filePath.endsWith(".js")) {
    return "js";
  }
  if (filePath.endsWith(".d.ts")) {
    return "types";
  }
  return undefined;
};

const declarationArtifactTypeMapOptionalStems = (target) =>
  new Set(
    (target.declarationArtifacts ?? [])
      .map((artifact) =>
        isNonEmptyString(artifact.output) && artifact.output.startsWith("dist/")
          ? distArtifactStem(artifact.output)
          : undefined
      )
      .filter(Boolean)
  );

const requiredDistArtifactKinds = (target, stem) => {
  const required = new Set(["js", "js.map", "types", "types.map"]);
  if (declarationArtifactTypeMapOptionalStems(target).has(stem)) {
    required.delete("types.map");
  }
  return required;
};

const collectDistPackageSourceStems = (target) =>
  Effect.gen(function* () {
    const stems = new Set();
    const sourceDirectory = join(target.directory, "src");
    const visit = (directory) => Effect.gen(function* () {
      const entries = yield* fsEffect(
        `read ${relative(workspaceRoot, directory)}`,
        () => readdir(directory, { withFileTypes: true }),
      );
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          yield* visit(fullPath);
          continue;
        }
        if (
          entry.isFile() &&
          !entry.name.endsWith(".d.ts") &&
          /\.[cm]?tsx?$/.test(entry.name)
        ) {
          stems.add(stripSourceExtension(toPosixPath(relative(sourceDirectory, fullPath))));
        }
      }
    });

    yield* visit(sourceDirectory);
    return stems;
  });

const distPackageArtifactDriftFailures = (target, files, sourceStems) => {
  const artifactStems = new Set(files.map(distArtifactStem).filter(Boolean));
  const artifactKindsByStem = new Map();
  for (const file of files) {
    const stem = distArtifactStem(file);
    const kind = distArtifactKind(file);
    if (stem === undefined || kind === undefined) {
      continue;
    }
    const kinds = artifactKindsByStem.get(stem) ?? new Set();
    kinds.add(kind);
    artifactKindsByStem.set(stem, kinds);
  }
  const extra = [...artifactStems]
    .filter((stem) => !sourceStems.has(stem))
    .sort((left, right) => left.localeCompare(right));
  const missing = [...sourceStems].flatMap((stem) => {
    const actualKinds = artifactKindsByStem.get(stem) ?? new Set();
    return [...requiredDistArtifactKinds(target, stem)]
      .filter((kind) => !actualKinds.has(kind))
      .map((kind) => `${stem}.${kind === "types" ? "d.ts" : kind === "types.map" ? "d.ts.map" : kind}`);
  })
    .sort((left, right) => left.localeCompare(right));
  const failures = [];

  if (extra.length > 0) {
    failures.push(`${target.label} package dry-run includes stale dist artifacts without matching src files: ${extra.map((stem) => "dist/" + stem).join(", ")}.`);
  }
  if (missing.length > 0) {
    failures.push(`${target.label} package dry-run is missing built JS, declaration, or source-map artifacts for src files: ${missing.map((stem) => "dist/" + stem).join(", ")}.`);
  }

  return failures;
};

const declarationArtifactPackFailures = (target, files) => {
  const failures = [];
  const fileSet = new Set(files);
  for (const artifact of target.declarationArtifacts ?? []) {
    if (!isNonEmptyString(artifact.source) || !isNonEmptyString(artifact.output)) {
      failures.push(`${target.label} declaration artifact policy must declare non-empty source and output paths.`);
      continue;
    }
    if (!fileSet.has(artifact.output)) {
      failures.push(`${target.label} package dry-run is missing copied declaration artifact ${artifact.output}.`);
    }
    for (const forbidden of artifact.forbidden ?? []) {
      if (!isNonEmptyString(forbidden)) {
        failures.push(`${target.label} declaration artifact forbidden paths must be non-empty strings.`);
      } else if (fileSet.has(forbidden)) {
        failures.push(`${target.label} package dry-run includes forbidden copied declaration artifact ${forbidden}.`);
      }
    }
  }
  return failures;
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

const declarationArtifactContentFailures = (target) =>
  Effect.gen(function* () {
    const failures = [];
    for (const artifact of target.declarationArtifacts ?? []) {
      if (!isNonEmptyString(artifact.source) || !isNonEmptyString(artifact.output)) {
        continue;
      }

      const sourcePath = join(target.directory, artifact.source);
      const outputPath = join(target.directory, artifact.output);
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
        const forbiddenPath = join(target.directory, forbidden);
        if (yield* pathExists(forbiddenPath)) {
          failures.push(`${target.label} copied declaration artifact left forbidden file ${forbidden}.`);
        }
      }
    }
    return failures;
  });

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

const assertDeclarationArtifactPolicy = (name, target, files, expectedFragments) => {
  const failures = declarationArtifactPackFailures(target, files);
  if (failures.length !== expectedFragments.length) {
    failSelfTest(
      `${name} declaration artifact self-test expected ${expectedFragments.length} failures but found ${failures.length}: ${failures.join(" ")}`
    );
  }
  for (const expectedFragment of expectedFragments) {
    if (!failures.some((failure) => failure.includes(expectedFragment))) {
      failSelfTest(
        `${name} declaration artifact self-test did not find expected failure fragment ${expectedFragment}: ${failures.join(" ")}`
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

const distSourceStemsSelfTest = new Set(["index", "feature"]);
const distArtifactFilesSelfTest = [
  "package.json",
  "dist/index.js",
  "dist/index.js.map",
  "dist/index.d.ts",
  "dist/index.d.ts.map",
  "dist/feature.js",
  "dist/feature.js.map",
  "dist/feature.d.ts",
  "dist/feature.d.ts.map",
];
const distArtifactDriftSelfTest = [
  ...distArtifactFilesSelfTest,
  "dist/stale.js",
  "dist/stale.d.ts",
];
const distArtifactMissingSelfTest = distArtifactFilesSelfTest.filter((file) => file !== "dist/feature.d.ts");
const distArtifactMissingJsMapSelfTest = distArtifactFilesSelfTest.filter((file) => file !== "dist/feature.js.map");
const distArtifactMissingTypesMapSelfTest = distArtifactFilesSelfTest.filter((file) => file !== "dist/feature.d.ts.map");
const distArtifactDeclarationAdapterSelfTest = {
  ...validDistPackageSelfTest,
  declarationArtifacts: [
    {
      source: "src/virtual-modules.d.ts",
      output: "dist/feature.d.ts",
      forbidden: ["dist/feature.d.ts.map"],
    },
  ],
};
const distArtifactDeclarationAdapterFilesSelfTest = distArtifactFilesSelfTest.filter((file) => file !== "dist/feature.d.ts.map");
assertSourcePackageManifestPolicy(
  "dist artifact drift self-test helper baseline",
  sourcePackageSelfTest,
  [],
  [],
  [],
);
if (distPackageArtifactDriftFailures(validDistPackageSelfTest, distArtifactFilesSelfTest, distSourceStemsSelfTest).length !== 0) {
  failSelfTest("dist artifact drift self-test expected the baseline payload to pass.");
}
if (!distPackageArtifactDriftFailures(validDistPackageSelfTest, distArtifactDriftSelfTest, distSourceStemsSelfTest).some((failure) => failure.includes("stale dist artifacts"))) {
  failSelfTest("dist artifact drift self-test did not catch stale dist artifacts.");
}
if (!distPackageArtifactDriftFailures(validDistPackageSelfTest, distArtifactMissingSelfTest, distSourceStemsSelfTest).some((failure) => failure.includes("dist/feature.d.ts"))) {
  failSelfTest("dist artifact drift self-test did not catch missing dist artifacts.");
}
if (!distPackageArtifactDriftFailures(validDistPackageSelfTest, distArtifactMissingJsMapSelfTest, distSourceStemsSelfTest).some((failure) => failure.includes("dist/feature.js.map"))) {
  failSelfTest("dist artifact drift self-test did not catch missing JS source maps.");
}
if (!distPackageArtifactDriftFailures(validDistPackageSelfTest, distArtifactMissingTypesMapSelfTest, distSourceStemsSelfTest).some((failure) => failure.includes("dist/feature.d.ts.map"))) {
  failSelfTest("dist artifact drift self-test did not catch missing declaration maps.");
}
if (distPackageArtifactDriftFailures(distArtifactDeclarationAdapterSelfTest, distArtifactDeclarationAdapterFilesSelfTest, distSourceStemsSelfTest).length !== 0) {
  failSelfTest("dist artifact drift self-test expected copied declaration adapters to omit declaration maps.");
}

const declarationArtifactSelfTest = {
  label: "@effect-ui/declaration-self-test",
  payload: "dist-package",
  declarationArtifacts: [
    {
      source: "src/virtual-modules.d.ts",
      output: "dist/virtual.d.ts",
      forbidden: ["dist/virtual.d.ts.map"],
    },
  ],
};
assertDeclarationArtifactPolicy(
  "valid declaration artifact",
  declarationArtifactSelfTest,
  ["package.json", "dist/virtual.js", "dist/virtual.d.ts"],
  [],
);
assertDeclarationArtifactPolicy(
  "declaration artifact drift",
  declarationArtifactSelfTest,
  ["package.json", "dist/virtual.js", "dist/virtual.d.ts.map"],
  ["dist/virtual.d.ts", "dist/virtual.d.ts.map"],
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
    const distArtifactDrift = target.payload === "dist-package"
      ? distPackageArtifactDriftFailures(target, files, yield* collectDistPackageSourceStems(target))
      : [];
    const declarationArtifactPackDrift = target.payload === "dist-package"
      ? declarationArtifactPackFailures(target, files)
      : [];
    const declarationArtifactContentDrift =
      target.payload === "dist-package" && declarationArtifactPackDrift.length === 0
        ? yield* declarationArtifactContentFailures(target)
        : [];
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
    if (distArtifactDrift.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run dist artifacts do not match source files.`,
          [
            "Run a clean build or remove stale dist files before packing framework packages.",
            ...distArtifactDrift,
          ].join(" "),
        ),
      );
    }
    if (declarationArtifactPackDrift.length > 0 || declarationArtifactContentDrift.length > 0) {
      return yield* Effect.fail(
        fail(
          `${target.label} package dry-run copied declaration artifacts are stale.`,
          [
            "Keep declaration-only public Adapter artifacts byte-identical to their source declarations and remove stale declaration maps.",
            ...declarationArtifactPackDrift,
            ...declarationArtifactContentDrift,
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
