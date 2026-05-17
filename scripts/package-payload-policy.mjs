import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Data, Effect } from "effect";
import { manifestTargetValidationFailures } from "./package-manifest-targets.mjs";

export class PackagePayloadPolicyError extends Data.TaggedError("PackagePayloadPolicyError") {}

const distPackagePolicy = { payload: "dist-package" };

export const workspaceDistPackagePayloadPolicies = new Map([
  ["@effect-ui/core", distPackagePolicy],
  ["@effect-ui/db", distPackagePolicy],
  ["@effect-ui/devtools", distPackagePolicy],
  ["@effect-ui/react", distPackagePolicy],
  ["@effect-ui/react-db", distPackagePolicy],
  ["@effect-ui/solid", distPackagePolicy],
  ["@effect-ui/solid-db", distPackagePolicy],
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
  ["@effect-ui/start-fetch", distPackagePolicy],
  ["@effect-ui/start-node", distPackagePolicy],
  ["@effect-ui/tsrx", distPackagePolicy],
]);

export const knownPayloadPolicies = new Set(["dist-package", "source-package"]);

const fail = (message, repair, cause) =>
  new PackagePayloadPolicyError({ message, repair, cause });

const toPosixPath = (filePath) => filePath.split(sep).join("/");

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

const isNodeNotFoundError = (cause) =>
  cause &&
  typeof cause === "object" &&
  "code" in cause &&
  cause.code === "ENOENT";

const pathExistsEffect = (workspaceRoot, filePath) =>
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

export const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export const stripSourceExtension = (filePath) =>
  filePath
    .replace(/\.d\.ts$/, "")
    .replace(/\.[cm]?tsx?$/, "");

export const distPackageSourceStemsFromFiles = (files) =>
  new Set(
    files
      .filter((file) => !file.endsWith(".d.ts") && /\.[cm]?tsx?$/.test(file))
      .map(stripSourceExtension)
  );

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

export const distPackageArtifactDriftFailures = (target, files, sourceStems) => {
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

export const declarationArtifactPackFailures = (target, files) => {
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

export const collectDistPackageSourceStemsEffect = ({
  sourceDir,
  workspaceRoot,
}) =>
  Effect.gen(function* () {
    const files = [];
    const visit = (directory) => Effect.gen(function* () {
      const entries = yield* fsEffect(
        workspaceRoot,
        `read ${relative(workspaceRoot, directory)}`,
        () => readdir(directory, { withFileTypes: true }),
      );
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          yield* visit(fullPath);
          continue;
        }
        if (entry.isFile()) {
          files.push(toPosixPath(relative(sourceDir, fullPath)));
        }
      }
    });

    yield* visit(sourceDir);
    return distPackageSourceStemsFromFiles(files);
  });

export const declarationArtifactContentFailuresEffect = ({
  target,
  workspaceRoot,
}) =>
  Effect.gen(function* () {
    const failures = [];
    for (const artifact of target.declarationArtifacts ?? []) {
      if (!isNonEmptyString(artifact.source) || !isNonEmptyString(artifact.output)) {
        continue;
      }

      const sourcePath = join(target.directory, artifact.source);
      const outputPath = join(target.directory, artifact.output);
      const source = yield* fsEffect(
        workspaceRoot,
        `read ${relative(workspaceRoot, sourcePath)}`,
        () => readFile(sourcePath),
      );
      const output = yield* fsEffect(
        workspaceRoot,
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
        if (yield* pathExistsEffect(workspaceRoot, forbiddenPath)) {
          failures.push(`${target.label} copied declaration artifact left forbidden file ${forbidden}.`);
        }
      }
    }
    return failures;
  });

/**
 * Validates a dist-package payload against the shared package policy.
 *
 * The Interface owns source-stem discovery, dist artifact drift checks,
 * declaration artifact copy/content checks, and package manifest target checks
 * so dry-run and generated-starter packaging scripts enforce the same rules.
 */
export const validateDistPackagePayloadEffect = ({
  target,
  files,
  sourceDir = join(target.directory, "src"),
  workspaceRoot,
  packageJson = target.packageJson,
  payloadLabel = `${target.label} package dry-run`,
}) =>
  Effect.gen(function* () {
    if (target.payload !== "dist-package") {
      return [];
    }

    const distArtifactDrift = distPackageArtifactDriftFailures(
      target,
      files,
      yield* collectDistPackageSourceStemsEffect({ sourceDir, workspaceRoot }),
    );
    const declarationArtifactPackDrift = declarationArtifactPackFailures(target, files);
    const declarationArtifactContentDrift =
      declarationArtifactPackDrift.length === 0
        ? yield* declarationArtifactContentFailuresEffect({ target, workspaceRoot })
        : [];
    const missingManifestTargets = manifestTargetValidationFailures({
      packageName: target.label,
      packageJson,
      files,
      payloadLabel,
    });

    return [
      ...distArtifactDrift,
      ...declarationArtifactPackDrift,
      ...declarationArtifactContentDrift,
      ...missingManifestTargets,
    ];
  });
