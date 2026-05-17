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
