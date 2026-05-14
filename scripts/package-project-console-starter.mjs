#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const sourceDir = resolve(workspaceRoot, "examples/project-console");
const outputDir = resolve(workspaceRoot, ".test-dist/starters/project-console");
const publishVersionPlaceholder = "0.0.0-alpha.0";

class ProjectConsoleStarterPackageError extends Data.TaggedError(
  "ProjectConsoleStarterPackageError",
) {}

const fail = (message, repair, cause) =>
  new ProjectConsoleStarterPackageError({ message, repair, cause });

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
        `Failed to parse ${relative(workspaceRoot, filePath)}.`,
        "Keep package.json valid JSON.",
        cause,
      ),
  });

const stringifyPackageJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const starterViteConfig = `import { effectUiStart } from "@effect-ui/start/vite";
import { effectUiTsrx } from "@effect-ui/tsrx";
import { defineConfig } from "vite";
import { projectConsoleStartOptions } from "./src/start-options.js";

export default defineConfig({
  plugins: [
    ...effectUiTsrx({ solid: { ssr: true } }),
    effectUiStart(projectConsoleStartOptions)
  ]
});
`;

const starterTsConfig = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2022", "DOM"],
    strict: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    jsx: "preserve",
    jsxImportSource: "solid-js",
    noEmit: true,
    plugins: [{ name: "@tsrx/typescript-plugin" }],
    types: ["vite/client", "@effect-ui/start/virtual"],
  },
  include: ["src", "vite.config.ts"],
};

const requiredTemplateFiles = [
  "README.md",
  "index.html",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "src/App.tsx",
  "src/app-definition.ts",
  "src/domain.contract.ts",
  "src/domain.server.ts",
  "src/domain.ts",
  "src/main.tsx",
  "src/project-collections.ts",
  "src/routeTree.gen.ts",
  "src/server.tsx",
  "src/start-options.ts",
  "src/styles.css",
  "src/ui.tsrx",
];

const forbiddenOutputSegments = new Set(["node_modules", "dist", ".test-dist"]);

const shouldCopyPath = (from) => {
  const relativeFromSource = relative(sourceDir, from);
  if (relativeFromSource === "") {
    return true;
  }
  return relativeFromSource
    .split(sep)
    .every((segment) => !forbiddenOutputSegments.has(segment));
};

const statFile = (filePath) =>
  fsEffect(`inspect ${relative(workspaceRoot, filePath)}`, () => stat(filePath));

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

const assertFile = (relativePath) =>
  Effect.gen(function* () {
    const filePath = resolve(outputDir, relativePath);
    const fileStat = yield* statFile(filePath);
    if (!fileStat.isFile()) {
      return yield* Effect.fail(
        fail(
          `Expected ${relativePath} to be a file in the generated project-console starter.`,
          "Add the missing starter source file or update requiredTemplateFiles.",
        ),
      );
    }
  });

const assertPathMissing = (relativePath) =>
  Effect.gen(function* () {
    const filePath = resolve(outputDir, relativePath);
    const exists = yield* pathExists(filePath);
    if (exists) {
      return yield* Effect.fail(
        fail(
          `Generated project-console starter unexpectedly includes ${relativePath}.`,
          "Update the copy filter so build outputs and dependency folders stay out of starter payloads.",
        ),
      );
    }
  });

const rewritePackageJson = Effect.gen(function* () {
  const packageJsonPath = resolve(outputDir, "package.json");
  const packageJsonText = yield* fsEffect(
    "read generated project-console starter package.json",
    () => readFile(packageJsonPath, "utf8"),
  );
  const packageJson = yield* parseJsonEffect(packageJsonPath, packageJsonText);

  const replaceWorkspaceVersions = (dependencies) => {
    if (dependencies == null) {
      return dependencies;
    }
    return Object.fromEntries(
      Object.entries(dependencies).map(([name, version]) => [
        name,
        typeof version === "string" && version.startsWith("workspace:")
          ? publishVersionPlaceholder
          : version,
      ]),
    );
  };

  const starterPackageJson = {
    ...packageJson,
    name: "effect-ui-project-console-starter",
    version: "0.0.0",
    private: true,
    scripts: {
      ...packageJson.scripts,
      dev: "vite",
    },
    dependencies: replaceWorkspaceVersions(packageJson.dependencies),
    devDependencies: replaceWorkspaceVersions(packageJson.devDependencies),
  };

  yield* fsEffect("write generated project-console starter package.json", () =>
    writeFile(packageJsonPath, stringifyPackageJson(starterPackageJson)),
  );
});

const rewriteMonorepoConfig = Effect.gen(function* () {
  yield* fsEffect("write standalone project-console starter Vite config", () =>
    writeFile(resolve(outputDir, "vite.config.ts"), starterViteConfig),
  );
  yield* fsEffect("write standalone project-console starter tsconfig", () =>
    writeFile(
      resolve(outputDir, "tsconfig.json"),
      stringifyPackageJson(starterTsConfig),
    ),
  );
});

const verifyGeneratedStarter = Effect.gen(function* () {
  for (const filePath of requiredTemplateFiles) {
    yield* assertFile(filePath);
  }

  yield* assertPathMissing("dist");
  yield* assertPathMissing("node_modules");

  const packageJsonPath = resolve(outputDir, "package.json");
  const packageJsonText = yield* fsEffect(
    "read generated project-console starter package.json",
    () => readFile(packageJsonPath, "utf8"),
  );
  if (packageJsonText.includes("workspace:")) {
    return yield* Effect.fail(
      fail(
        "Generated project-console starter package.json still contains workspace protocol dependencies.",
        "Rewrite workspace protocol versions before publishing or copying the starter.",
      ),
    );
  }

  const viteConfigText = yield* fsEffect(
    "read generated project-console starter Vite config",
    () => readFile(resolve(outputDir, "vite.config.ts"), "utf8"),
  );
  if (
    viteConfigText.includes("fromRoot") ||
    viteConfigText.includes("replacement:")
  ) {
    return yield* Effect.fail(
      fail(
        "Generated project-console starter Vite config still contains monorepo aliases.",
        "Rewrite the generated Vite config so it imports published @effect-ui packages directly.",
      ),
    );
  }

  const tsConfigText = yield* fsEffect(
    "read generated project-console starter tsconfig",
    () => readFile(resolve(outputDir, "tsconfig.json"), "utf8"),
  );
  if (tsConfigText.includes("../../tsconfig.base.json")) {
    return yield* Effect.fail(
      fail(
        "Generated project-console starter tsconfig still extends the monorepo base config.",
        "Write a standalone tsconfig for the generated starter.",
      ),
    );
  }
});

const packageProjectConsoleStarter = Effect.gen(function* () {
  yield* fsEffect("remove the previous generated project-console starter", () =>
    rm(outputDir, { force: true, recursive: true }),
  );
  yield* fsEffect("create the generated starter parent directory", () =>
    mkdir(dirname(outputDir), { recursive: true }),
  );
  yield* fsEffect("copy the project-console starter source", () =>
    cp(sourceDir, outputDir, {
      filter: shouldCopyPath,
      recursive: true,
    }),
  );
  yield* rewritePackageJson;
  yield* rewriteMonorepoConfig;
  yield* verifyGeneratedStarter;

  return {
    outputDir,
    requiredFiles: requiredTemplateFiles.length,
  };
});

try {
  const { outputDir: generatedOutputDir, requiredFiles } = await Effect.runPromise(
    packageProjectConsoleStarter,
  );
  console.log(
    `Packaged project-console starter at ${relative(workspaceRoot, generatedOutputDir)} (${requiredFiles} required files verified).`,
  );
} catch (cause) {
  console.error(cause);
  process.exitCode = 1;
}
