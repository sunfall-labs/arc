#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const packagesDir = resolve(workspaceRoot, "packages");
const startersOutputRoot = resolve(workspaceRoot, ".test-dist/starters");
const localPackagesDirectoryName = ".effect-ui-packages";
const localLockfileName = "pnpm-lock.yaml";

class StarterPackageError extends Data.TaggedError("StarterPackageError") {}

const fail = (message, repair, cause) =>
  new StarterPackageError({ message, repair, cause });

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
            "Ensure pnpm is available on PATH and the generated starter has valid package metadata.",
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

const stringifyJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

const solidStarterTsConfig = {
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
    types: ["vite/client"],
  },
  include: ["src", "vite.config.ts"],
};

const reactStarterTsConfig = {
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
    jsx: "react-jsx",
    noEmit: true,
    baseUrl: ".",
    paths: {
      "@/*": ["./src/*"],
    },
    types: ["vite/client"],
  },
  include: ["src", "vite.config.ts"],
};

const solidStarterViteConfig = (startOptionsImport) => `import { effectUiStart } from "@effect-ui/start/vite";
import { effectUiTsrx } from "@effect-ui/tsrx";
import { defineConfig } from "vite";
import { ${startOptionsImport} } from "./src/start-options.js";

export default defineConfig({
  plugins: [
    ...effectUiTsrx({ solid: { ssr: true } }),
    effectUiStart(${startOptionsImport})
  ]
});
`;

const reactStarterViteConfig = `import tailwindcss from "@tailwindcss/vite";
import { effectUiStart } from "@effect-ui/start/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { reactStarterStartOptions } from "./src/start-options.js";

const fromStarter = (path: string): string => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    effectUiStart(reactStarterStartOptions)
  ],
  resolve: {
    alias: [
      { find: "@", replacement: fromStarter("src") }
    ]
  }
});
`;

const starterDefinitions = [
  {
    id: "basic",
    displayName: "basic starter",
    sourceDir: resolve(workspaceRoot, "examples/basic-starter"),
    outputDir: resolve(startersOutputRoot, "basic"),
    packageName: "effect-ui-basic-starter",
    viteConfig: solidStarterViteConfig("starterStartOptions"),
    tsConfig: solidStarterTsConfig,
  },
  {
    id: "react",
    displayName: "react starter",
    sourceDir: resolve(workspaceRoot, "examples/react-starter"),
    outputDir: resolve(startersOutputRoot, "react"),
    packageName: "effect-ui-react-starter",
    viteConfig: reactStarterViteConfig,
    tsConfig: reactStarterTsConfig,
  },
  {
    id: "project-console",
    displayName: "project-console starter",
    sourceDir: resolve(workspaceRoot, "examples/project-console"),
    outputDir: resolve(startersOutputRoot, "project-console"),
    packageName: "effect-ui-project-console-starter",
    viteConfig: solidStarterViteConfig("projectConsoleStartOptions"),
    tsConfig: solidStarterTsConfig,
  },
];

const forbiddenSourceSegments = new Set([
  "node_modules",
  "dist",
  ".test-dist",
  localPackagesDirectoryName,
]);
const forbiddenGeneratedAppSegments = new Set(["node_modules", "dist", ".test-dist"]);

const toPosixPath = (filePath) => filePath.split(sep).join("/");

const relativeTo = (from, to) => toPosixPath(relative(from, to));

const localPackageDirectoryName = (packageName) =>
  packageName.replace(/^@/, "").replace(/\//g, "-");

const hasForbiddenSegment = (relativePath, forbiddenSegments) =>
  relativePath
    .split("/")
    .some((segment) => forbiddenSegments.has(segment));

const shouldCopySourcePath = (sourceDir) => (from) => {
  const relativeFromSource = relative(sourceDir, from);
  if (relativeFromSource === "") {
    return true;
  }
  return relativeFromSource
    .split(sep)
    .every((segment) => !forbiddenSourceSegments.has(segment));
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

const readPackageJson = (packageJsonPath) =>
  Effect.gen(function* () {
    const text = yield* fsEffect(
      `read ${relative(workspaceRoot, packageJsonPath)}`,
      () => readFile(packageJsonPath, "utf8"),
    );
    return yield* parseJsonEffect(packageJsonPath, text);
  });

const collectWorkspacePackages = Effect.gen(function* () {
  const entries = yield* fsEffect("read workspace package directories", () =>
    readdir(packagesDir, { withFileTypes: true }),
  );
  const packages = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = resolve(packagesDir, entry.name);
    const packageJsonPath = resolve(directory, "package.json");
    const exists = yield* pathExists(packageJsonPath);
    if (!exists) {
      continue;
    }

    const packageJson = yield* readPackageJson(packageJsonPath);
    if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
      return yield* Effect.fail(
        fail(
          `${relative(workspaceRoot, packageJsonPath)} must declare string name and version fields.`,
          "Keep package manifests publish-ready before packaging starters.",
        ),
      );
    }

    packages.set(packageJson.name, {
      directory,
      packageJson,
      packageJsonPath,
      localDirectoryName: localPackageDirectoryName(packageJson.name),
    });
  }

  return packages;
});

const workspaceDependencyNames = (packageJson, includeDevDependencies) => {
  const sections = [
    packageJson.dependencies,
    packageJson.peerDependencies,
    includeDevDependencies ? packageJson.devDependencies : undefined,
  ];
  return sections.flatMap((section) =>
    Object.entries(section ?? {})
      .filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"))
      .map(([name]) => name)
  );
};

const internalPackageClosure = (packageJson, workspacePackages) => {
  const seen = new Set();
  const pending = workspaceDependencyNames(packageJson, true);
  while (pending.length > 0) {
    const name = pending.shift();
    if (name === undefined || seen.has(name)) {
      continue;
    }

    const workspacePackage = workspacePackages.get(name);
    if (workspacePackage === undefined) {
      seen.add(name);
      continue;
    }

    seen.add(name);
    pending.push(...workspaceDependencyNames(workspacePackage.packageJson, false));
  }

  return [...seen].sort((left, right) => left.localeCompare(right));
};

const rewriteDependencyMap = (dependencies, workspacePackages, toFileReference) =>
  Effect.gen(function* () {
    if (dependencies == null) {
      return dependencies;
    }

    const entries = yield* Effect.forEach(Object.entries(dependencies), ([name, version]) =>
      Effect.gen(function* () {
        if (typeof version !== "string" || !version.startsWith("workspace:")) {
          return [name, version];
        }

        const workspacePackage = workspacePackages.get(name);
        if (workspacePackage === undefined) {
          return yield* Effect.fail(
            fail(
              `Starter depends on ${name}, but no workspace package manifest declares it.`,
              "Add the missing package manifest or remove the workspace protocol dependency before packaging.",
            ),
          );
        }

        return [name, toFileReference(workspacePackage)];
      })
    );
    return Object.fromEntries(entries);
  });

const rewritePackageDependencies = (packageJson, workspacePackages, toFileReference) =>
  Effect.gen(function* () {
    const dependencies = yield* rewriteDependencyMap(
      packageJson.dependencies,
      workspacePackages,
      toFileReference,
    );
    const peerDependencies = yield* rewriteDependencyMap(
      packageJson.peerDependencies,
      workspacePackages,
      toFileReference,
    );
    const devDependencies = yield* rewriteDependencyMap(
      packageJson.devDependencies,
      workspacePackages,
      toFileReference,
    );

    return {
      ...packageJson,
      dependencies,
      peerDependencies,
      devDependencies,
    };
  });

const writeLocalWorkspacePackage = (starter, workspacePackages, packageName) =>
  Effect.gen(function* () {
    const workspacePackage = workspacePackages.get(packageName);
    if (workspacePackage === undefined) {
      return yield* Effect.fail(
        fail(
          `Starter depends on ${packageName}, but no workspace package manifest declares it.`,
          "Add the missing package manifest or remove the workspace protocol dependency before packaging.",
        ),
      );
    }

    const sourceDist = resolve(workspacePackage.directory, "dist");
    const distExists = yield* pathExists(sourceDist);
    if (!distExists) {
      return yield* Effect.fail(
        fail(
          `${relative(workspaceRoot, sourceDist)} does not exist.`,
          "Run pnpm build before packaging copyable starters so local file dependencies contain built artifacts.",
        ),
      );
    }

    const localPackageDir = resolve(
      starter.outputDir,
      localPackagesDirectoryName,
      workspacePackage.localDirectoryName,
    );
    yield* fsEffect(
      `create local package directory ${relative(workspaceRoot, localPackageDir)}`,
      () => mkdir(localPackageDir, { recursive: true }),
    );
    yield* fsEffect(
      `copy ${workspacePackage.packageJson.name} dist artifacts`,
      () => cp(sourceDist, resolve(localPackageDir, "dist"), { recursive: true }),
    );

    const localPackageJson = yield* rewritePackageDependencies(
      workspacePackage.packageJson,
      workspacePackages,
      (dependency) => `file:../${dependency.localDirectoryName}`,
    );
    yield* fsEffect(
      `write local ${workspacePackage.packageJson.name} package.json`,
      () => writeFile(resolve(localPackageDir, "package.json"), stringifyJson(localPackageJson)),
    );
  });

const assertSameFileManifest = (starter, expected, actual) =>
  Effect.gen(function* () {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((filePath) => !actualSet.has(filePath));
    const extra = actual.filter((filePath) => !expectedSet.has(filePath));

    if (missing.length > 0 || extra.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} app file manifest does not match the copyable source manifest.`,
          [
            "Keep the copy filter and generated starter payload in sync.",
            missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined,
            extra.length > 0 ? `Extra: ${extra.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
  });

const assertNoForbiddenGeneratedAppSegments = (starter, files) =>
  Effect.gen(function* () {
    const forbidden = files.filter((file) =>
      !file.startsWith(`${localPackagesDirectoryName}/`) &&
      hasForbiddenSegment(file, forbiddenGeneratedAppSegments)
    );
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} includes forbidden build/dependency output paths.`,
          `Update the copy filter so these paths stay out of the starter payload: ${forbidden.join(", ")}.`,
        ),
      );
    }
  });

const assertNoWorkspaceProtocol = (starter) =>
  Effect.gen(function* () {
    const generatedFiles = yield* collectFiles(starter.outputDir, {
      filter: (filePath) => {
        const relativePath = relativeTo(starter.outputDir, filePath);
        return !relativePath.startsWith("node_modules/") && !relativePath.startsWith("dist/");
      },
    });
    const offenders = [];
    for (const file of generatedFiles) {
      if (!file.endsWith("package.json") && file !== localLockfileName) {
        continue;
      }
      const fileText = yield* fsEffect(
        `read ${relative(workspaceRoot, resolve(starter.outputDir, file))}`,
        () => readFile(resolve(starter.outputDir, file), "utf8"),
      );
      if (fileText.includes("workspace:")) {
        offenders.push(file);
      }
    }

    if (offenders.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} still contains workspace protocol dependencies.`,
          `Rewrite these files before publishing or copying the starter: ${offenders.join(", ")}.`,
        ),
      );
    }
  });

const verifyStandaloneConfigs = (starter) =>
  Effect.gen(function* () {
    const viteConfigText = yield* fsEffect(
      `read generated ${starter.displayName} Vite config`,
      () => readFile(resolve(starter.outputDir, "vite.config.ts"), "utf8"),
    );
    if (
      viteConfigText.includes("fromRoot") ||
      viteConfigText.includes("../../") ||
      viteConfigText.includes("packages/")
    ) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} Vite config still contains monorepo aliases.`,
          "Rewrite the generated Vite config so it uses local file-package @effect-ui imports without monorepo aliases.",
        ),
      );
    }

    const tsConfigText = yield* fsEffect(
      `read generated ${starter.displayName} tsconfig`,
      () => readFile(resolve(starter.outputDir, "tsconfig.json"), "utf8"),
    );
    if (tsConfigText.includes("../../tsconfig.base.json")) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} tsconfig still extends the monorepo base config.`,
          "Write a standalone tsconfig for the generated starter.",
        ),
      );
    }
  });

const cleanupGeneratedInstallArtifacts = (starter) =>
  Effect.gen(function* () {
    yield* fsEffect(
      `remove generated ${starter.displayName} install dependencies`,
      () => rm(resolve(starter.outputDir, "node_modules"), { force: true, recursive: true }),
    );
    yield* fsEffect(
      `remove generated ${starter.displayName} build output`,
      () => rm(resolve(starter.outputDir, "dist"), { force: true, recursive: true }),
    );
    yield* fsEffect(
      `remove generated ${starter.displayName} install lockfile`,
      () => rm(resolve(starter.outputDir, localLockfileName), { force: true }),
    );
  });

const verifyInstallableStarter = (starter) =>
  Effect.gen(function* () {
    yield* Effect.gen(function* () {
      yield* commandEffect(
        `${starter.displayName} standalone install`,
        "pnpm",
        ["--ignore-workspace", "install", "--ignore-scripts"],
        { cwd: starter.outputDir },
      );
      yield* assertNoWorkspaceProtocol(starter);
      yield* commandEffect(
        `${starter.displayName} generated starter verify`,
        "pnpm",
        ["--ignore-workspace", "verify"],
        { cwd: starter.outputDir },
      );
      yield* assertNoWorkspaceProtocol(starter);
    }).pipe(Effect.ensuring(cleanupGeneratedInstallArtifacts(starter)));
  });

const rewriteStarterPackageJson = (starter, workspacePackages, packageJson, internalPackageNames) =>
  Effect.gen(function* () {
    const localReference = (workspacePackage) =>
      `file:${localPackagesDirectoryName}/${workspacePackage.localDirectoryName}`;
    const rewrittenPackageJson = yield* rewritePackageDependencies(
      packageJson,
      workspacePackages,
      localReference,
    );
    const overrides = Object.fromEntries(
      internalPackageNames.map((name) => {
        const workspacePackage = workspacePackages.get(name);
        return [name, localReference(workspacePackage)];
      }),
    );
    const packageJsonPath = resolve(starter.outputDir, "package.json");
    const starterPackageJson = {
      ...rewrittenPackageJson,
      name: starter.packageName,
      version: "0.0.0",
      private: true,
      scripts: {
        ...rewrittenPackageJson.scripts,
        dev: "vite",
      },
      pnpm: {
        ...rewrittenPackageJson.pnpm,
        overrides: {
          ...rewrittenPackageJson.pnpm?.overrides,
          ...overrides,
        },
      },
    };

    yield* fsEffect(
      `write generated ${starter.displayName} package.json`,
      () => writeFile(packageJsonPath, stringifyJson(starterPackageJson)),
    );
  });

const rewriteMonorepoConfig = (starter) =>
  Effect.gen(function* () {
    yield* fsEffect(`write standalone ${starter.displayName} Vite config`, () =>
      writeFile(resolve(starter.outputDir, "vite.config.ts"), starter.viteConfig),
    );
    yield* fsEffect(`write standalone ${starter.displayName} tsconfig`, () =>
      writeFile(resolve(starter.outputDir, "tsconfig.json"), stringifyJson(starter.tsConfig)),
    );
  });

const packageStarter = (workspacePackages, starter) =>
  Effect.gen(function* () {
    const sourcePackageJsonPath = resolve(starter.sourceDir, "package.json");
    const sourcePackageJson = yield* readPackageJson(sourcePackageJsonPath);
    const internalPackageNames = internalPackageClosure(sourcePackageJson, workspacePackages);

    yield* fsEffect(`remove the previous generated ${starter.displayName}`, () =>
      rm(starter.outputDir, { force: true, recursive: true }),
    );
    yield* fsEffect(`create the generated ${starter.displayName} parent directory`, () =>
      mkdir(dirname(starter.outputDir), { recursive: true }),
    );
    yield* fsEffect(`copy the ${starter.displayName} source`, () =>
      cp(starter.sourceDir, starter.outputDir, {
        filter: shouldCopySourcePath(starter.sourceDir),
        recursive: true,
      }),
    );
    yield* rewriteStarterPackageJson(
      starter,
      workspacePackages,
      sourcePackageJson,
      internalPackageNames,
    );
    yield* rewriteMonorepoConfig(starter);
    yield* Effect.forEach(internalPackageNames, (packageName) =>
      writeLocalWorkspacePackage(starter, workspacePackages, packageName)
    );

    const expectedFiles = yield* collectFiles(starter.sourceDir, {
      filter: shouldCopySourcePath(starter.sourceDir),
    });
    const generatedAppFiles = yield* collectFiles(starter.outputDir, {
      filter: (filePath) =>
        !relativeTo(starter.outputDir, filePath).startsWith(`${localPackagesDirectoryName}/`),
    });

    yield* assertSameFileManifest(starter, expectedFiles, generatedAppFiles);
    yield* assertNoForbiddenGeneratedAppSegments(starter, generatedAppFiles);
    yield* verifyStandaloneConfigs(starter);
    yield* assertNoWorkspaceProtocol(starter);
    yield* verifyInstallableStarter(starter);

    return {
      id: starter.id,
      outputDir: starter.outputDir,
      appFiles: generatedAppFiles.length,
      localPackages: internalPackageNames.length,
    };
  });

const packageStarters = Effect.gen(function* () {
  const workspacePackages = yield* collectWorkspacePackages;
  const results = yield* Effect.forEach(starterDefinitions, (starter) =>
    packageStarter(workspacePackages, starter)
  );

  return results;
});

const reportPackagedStartersEffect = (results) =>
  Effect.sync(() => {
    for (const result of results) {
      console.log(
        `Packaged ${result.id} starter at ${relative(workspaceRoot, result.outputDir)} (${result.appFiles} app files, ${result.localPackages} local packages verified).`,
      );
    }
  });

const reportPackageFailureEffect = (cause) =>
  Effect.sync(() => {
    console.error(cause);
    process.exitCode = 1;
  });

await Effect.runPromise(
  packageStarters.pipe(
    Effect.flatMap(reportPackagedStartersEffect),
    Effect.catch(reportPackageFailureEffect),
  ),
);
