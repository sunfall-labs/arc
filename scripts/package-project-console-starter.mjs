#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const packagesDir = resolve(workspaceRoot, "packages");
const sourceDir = resolve(workspaceRoot, "examples/project-console");
const outputDir = resolve(workspaceRoot, ".test-dist/starters/project-console");

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

const forbiddenOutputSegments = new Set(["node_modules", "dist", ".test-dist"]);

const toPosixPath = (filePath) => filePath.split(sep).join("/");

const relativeTo = (from, to) => toPosixPath(relative(from, to));

const hasForbiddenOutputSegment = (relativePath) =>
  relativePath
    .split("/")
    .some((segment) => forbiddenOutputSegments.has(segment));

const shouldCopyPath = (from) => {
  const relativeFromSource = relative(sourceDir, from);
  if (relativeFromSource === "") {
    return true;
  }
  return relativeFromSource
    .split(sep)
    .every((segment) => !forbiddenOutputSegments.has(segment));
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

const collectWorkspacePackageVersions = Effect.gen(function* () {
  const entries = yield* fsEffect("read workspace package directories", () =>
    readdir(packagesDir, { withFileTypes: true }),
  );
  const versions = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = resolve(packagesDir, entry.name, "package.json");
    const exists = yield* pathExists(packageJsonPath);
    if (!exists) {
      continue;
    }

    const packageJsonText = yield* fsEffect(
      `read ${relative(workspaceRoot, packageJsonPath)}`,
      () => readFile(packageJsonPath, "utf8"),
    );
    const packageJson = yield* parseJsonEffect(packageJsonPath, packageJsonText);
    if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
      return yield* Effect.fail(
        fail(
          `${relative(workspaceRoot, packageJsonPath)} must declare string name and version fields.`,
          "Keep package manifests publish-ready before packaging the starter.",
        ),
      );
    }

    versions.set(packageJson.name, packageJson.version);
  }

  return versions;
});

const assertSameFileManifest = (expected, actual) =>
  Effect.gen(function* () {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((filePath) => !actualSet.has(filePath));
    const extra = actual.filter((filePath) => !expectedSet.has(filePath));

    if (missing.length > 0 || extra.length > 0) {
      return yield* Effect.fail(
        fail(
          "Generated project-console starter file manifest does not match the copyable source manifest.",
          [
            "Keep the copy filter and generated starter payload in sync.",
            missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined,
            extra.length > 0 ? `Extra: ${extra.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
  });

const assertNoForbiddenOutputSegments = (files) =>
  Effect.gen(function* () {
    const forbidden = files.filter(hasForbiddenOutputSegment);
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          "Generated project-console starter includes forbidden build/dependency output paths.",
          `Update the copy filter so these paths stay out of the starter payload: ${forbidden.join(", ")}.`,
        ),
      );
    }
  });

const rewritePackageJson = (workspacePackageVersions) => Effect.gen(function* () {
  const packageJsonPath = resolve(outputDir, "package.json");
  const packageJsonText = yield* fsEffect(
    "read generated project-console starter package.json",
    () => readFile(packageJsonPath, "utf8"),
  );
  const packageJson = yield* parseJsonEffect(packageJsonPath, packageJsonText);

  const replaceWorkspaceVersions = (dependencies) => Effect.gen(function* () {
    if (dependencies == null) {
      return dependencies;
    }
    const entries = yield* Effect.forEach(Object.entries(dependencies), ([name, version]) =>
      Effect.gen(function* () {
        if (typeof version !== "string" || !version.startsWith("workspace:")) {
          return [name, version];
        }

        const workspaceVersion = workspacePackageVersions.get(name);
        if (workspaceVersion === undefined) {
          return yield* Effect.fail(
            fail(
              `Generated project-console starter depends on ${name}, but no workspace package manifest declares it.`,
              "Add the missing package manifest or remove the workspace protocol dependency before packaging.",
            ),
          );
        }

        return [name, workspaceVersion];
      })
    );
    return Object.fromEntries(entries);
  });

  const dependencies = yield* replaceWorkspaceVersions(packageJson.dependencies);
  const devDependencies = yield* replaceWorkspaceVersions(packageJson.devDependencies);

  const starterPackageJson = {
    ...packageJson,
    name: "effect-ui-project-console-starter",
    version: "0.0.0",
    private: true,
    scripts: {
      ...packageJson.scripts,
      dev: "vite",
    },
    dependencies,
    devDependencies,
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
  const expectedFiles = yield* collectFiles(sourceDir, { filter: shouldCopyPath });
  const generatedFiles = yield* collectFiles(outputDir);

  yield* assertSameFileManifest(expectedFiles, generatedFiles);
  yield* assertNoForbiddenOutputSegments(generatedFiles);

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

  return generatedFiles.length;
});

const packageProjectConsoleStarter = Effect.gen(function* () {
  const workspacePackageVersions = yield* collectWorkspacePackageVersions;
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
  yield* rewritePackageJson(workspacePackageVersions);
  yield* rewriteMonorepoConfig;
  const verifiedFiles = yield* verifyGeneratedStarter;

  return {
    outputDir,
    verifiedFiles,
  };
});

const reportPackagedStarterEffect = ({ outputDir: generatedOutputDir, verifiedFiles }) =>
  Effect.sync(() => {
    console.log(
      `Packaged project-console starter at ${relative(workspaceRoot, generatedOutputDir)} (${verifiedFiles} files verified).`,
    );
  });

const reportPackageFailureEffect = (cause) =>
  Effect.sync(() => {
    console.error(cause);
    process.exitCode = 1;
  });

await Effect.runPromise(
  packageProjectConsoleStarter.pipe(
    Effect.flatMap(reportPackagedStarterEffect),
    Effect.catch(reportPackageFailureEffect),
  ),
);
