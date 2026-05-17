import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import {
  basicStarterReadme,
  projectConsoleStarterReadme,
  reactStarterReadme,
  reactStarterTsConfig,
  reactStarterViteConfig,
  solidStarterTsConfig,
  solidStarterViteConfig,
} from "./starter-template-content.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(__dirname, "..");
export const startersOutputRoot = resolve(workspaceRoot, ".test-dist/starters");

export class StarterCatalogError extends Data.TaggedError("StarterCatalogError") {}

const routeArtifact = (file) => ({ kind: "route", file });
const virtualArtifact = (file) => ({ kind: "virtual", file });

const sourcePackagePolicy = (requiredFiles, requiredDirectories) => ({
  payload: "source-package",
  requiresGitignore: true,
  requiredFiles,
  requiredDirectories,
});

export const starterSharedScriptArtifacts = [
  {
    relativePath: "scripts/effect-main-runner.mjs",
    sourcePath: resolve(workspaceRoot, "scripts/effect-main-runner.mjs"),
  },
];

const starterSharedScriptFiles = starterSharedScriptArtifacts.map(
  (artifact) => artifact.relativePath,
);

export const starterCatalog = [
  {
    id: "basic",
    displayName: "basic starter",
    sourcePackageName: "@effect-ui/starter-basic",
    generatedPackageName: "effect-ui-basic-starter",
    sourceDir: resolve(workspaceRoot, "examples/basic-starter"),
    outputDir: resolve(startersOutputRoot, "basic"),
    viteConfig: solidStarterViteConfig("starterStartOptions"),
    tsConfig: solidStarterTsConfig,
    readme: basicStarterReadme,
    artifacts: [
      routeArtifact("src/routeTree.gen.ts"),
      virtualArtifact("src/effect-ui-start-virtual.d.ts"),
    ],
    sourcePackage: sourcePackagePolicy(
      [
        "README.md",
        "index.html",
        "scripts/leak-scan.mjs",
        ...starterSharedScriptFiles,
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
      ["scripts", "src"],
    ),
  },
  {
    id: "react",
    displayName: "react starter",
    sourcePackageName: "@effect-ui/starter-react",
    generatedPackageName: "effect-ui-react-starter",
    sourceDir: resolve(workspaceRoot, "examples/react-starter"),
    outputDir: resolve(startersOutputRoot, "react"),
    viteConfig: reactStarterViteConfig,
    tsConfig: reactStarterTsConfig,
    readme: reactStarterReadme,
    artifacts: [
      routeArtifact("src/routeTree.gen.ts"),
      virtualArtifact("src/effect-ui-start-virtual.d.ts"),
    ],
    sourcePackage: sourcePackagePolicy(
      [
        "README.md",
        "components.json",
        "index.html",
        "scripts/leak-scan.mjs",
        ...starterSharedScriptFiles,
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
      ["scripts", "src"],
    ),
  },
  {
    id: "project-console",
    displayName: "project-console starter",
    sourcePackageName: "@effect-ui/example-project-console",
    generatedPackageName: "effect-ui-project-console-starter",
    sourceDir: resolve(workspaceRoot, "examples/project-console"),
    outputDir: resolve(startersOutputRoot, "project-console"),
    viteConfig: solidStarterViteConfig("projectConsoleStartOptions"),
    tsConfig: solidStarterTsConfig,
    readme: projectConsoleStarterReadme,
    artifacts: [
      routeArtifact("src/routeTree.gen.ts"),
      virtualArtifact("src/effect-ui-start-virtual.d.ts"),
      virtualArtifact("src/virtual-manifest-types.ts"),
    ],
    sourcePackage: sourcePackagePolicy(
      [
        "README.md",
        "index.html",
        "scripts/leak-scan.mjs",
        ...starterSharedScriptFiles,
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
      ["scripts", "src"],
    ),
  },
];

const catalogFailures = (catalog) => {
  const failures = [];
  const uniqueFields = [
    ["id", "starter id"],
    ["sourcePackageName", "source package name"],
    ["generatedPackageName", "generated package name"],
  ];
  for (const [field, label] of uniqueFields) {
    const seen = new Set();
    for (const starter of catalog) {
      const value = starter[field];
      if (typeof value !== "string" || value.trim() === "") {
        failures.push(`${starter.id ?? "unknown starter"} must declare a ${label}.`);
        continue;
      }
      if (seen.has(value)) {
        failures.push(`Duplicate ${label}: ${value}.`);
      }
      seen.add(value);
    }
  }

  for (const starter of catalog) {
    if (typeof starter.displayName !== "string" || starter.displayName.trim() === "") {
      failures.push(`${starter.id} must declare a display name.`);
    }
    if (typeof starter.sourceDir !== "string" || starter.sourceDir.trim() === "") {
      failures.push(`${starter.id} must declare a source directory.`);
    }
    if (typeof starter.outputDir !== "string" || starter.outputDir.trim() === "") {
      failures.push(`${starter.id} must declare an output directory.`);
    }
    if (typeof starter.viteConfig !== "string" || starter.viteConfig.trim() === "") {
      failures.push(`${starter.id} must declare generated Vite config content.`);
    }
    if (typeof starter.readme !== "string" || starter.readme.trim() === "") {
      failures.push(`${starter.id} must declare generated README content.`);
    }
    if (typeof starter.tsConfig !== "object" || starter.tsConfig === null) {
      failures.push(`${starter.id} must declare generated tsconfig content.`);
    }
    if (!Array.isArray(starter.artifacts) || starter.artifacts.length === 0) {
      failures.push(`${starter.id} must declare generated route or virtual artifacts.`);
    } else {
      for (const artifact of starter.artifacts) {
        if (artifact.kind !== "route" && artifact.kind !== "virtual") {
          failures.push(`${starter.id} declares invalid generated artifact kind ${artifact.kind}.`);
        }
        if (typeof artifact.file !== "string" || artifact.file.trim() === "") {
          failures.push(`${starter.id} declares a generated artifact without a file path.`);
        }
      }
    }
    const requiredFiles = starter.sourcePackage?.requiredFiles;
    if (!Array.isArray(requiredFiles) || requiredFiles.length === 0) {
      failures.push(`${starter.id} must declare source-package required files.`);
    } else {
      for (const requiredFile of ["README.md", "tsconfig.json", "vite.config.ts"]) {
        if (!requiredFiles.includes(requiredFile)) {
          failures.push(`${starter.id} source package policy must require ${requiredFile}.`);
        }
      }
      for (const artifact of starter.artifacts ?? []) {
        if (!requiredFiles.includes(artifact.file)) {
          failures.push(
            `${starter.id} source package policy must require generated artifact ${artifact.file}.`,
          );
        }
      }
    }
  }
  return failures;
};

export const starterCatalogConsistencyFailures = (catalog = starterCatalog) =>
  catalogFailures(catalog);

export const starterCatalogConsistencyEffect = (catalog = starterCatalog) =>
  Effect.suspend(() => {
    const failures = starterCatalogConsistencyFailures(catalog);
    return failures.length === 0
      ? Effect.void
      : Effect.fail(
          new StarterCatalogError({
            message: "Starter catalog manifest is invalid.",
            repair:
              "Keep starter ids, package names, generated artifacts, and source-package payload policies unique and complete.",
            failures,
          }),
        );
  });

export const assertStarterCatalogConsistency = (catalog = starterCatalog) =>
  starterCatalogConsistencyEffect(catalog);

export const copyableStarterEntries = starterCatalog.map((starter) => ({
  id: starter.id,
  displayName: starter.displayName,
  sourceDir: starter.sourceDir,
  outputDir: starter.outputDir,
  packageName: starter.generatedPackageName,
  viteConfig: starter.viteConfig,
  tsConfig: starter.tsConfig,
  readme: starter.readme,
}));

export const generatedStarterArtifacts = starterCatalog.map((starter) => ({
  starterId: starter.id,
  artifacts: starter.artifacts,
}));

export const generatedStarterArtifactsFor = (starterId) =>
  starterCatalog.find((starter) => starter.id === starterId)?.artifacts ?? [];

export const starterSourcePackagePayloadPolicies = starterCatalog.map((starter) => [
  starter.sourcePackageName,
  starter.sourcePackage,
]);

export const generatedStarterEffectFirstTemplates = starterCatalog.map((starter) => ({
  file: `generated-starter-templates/${starter.id}/vite.config.ts`,
  source: starter.viteConfig,
}));

export const generatedStarterReadmeTemplates = starterCatalog.map((starter) => ({
  file: `generated-starter-templates/${starter.id}/README.md`,
  source: starter.readme,
}));
