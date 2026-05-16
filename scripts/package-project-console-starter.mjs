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

const basicStarterReadme = `# Effect UI Basic Starter

This is the smallest checked starter path for a full-stack Effect UI app. It
keeps the same shape as the project console without the local-first DB, actions,
or diagnostics demo data.

## Commands

\`\`\`sh
pnpm install
pnpm dev
pnpm verify
\`\`\`

The starter includes:

- Start SSR with an Effect-returning request handler;
- browser hydration through \`hydrateFromDocument\`;
- a route-owned Resource preload declared in file route metadata;
- a production leak scan for server-only module sentinels.
`;

const reactStarterReadme = `# Effect UI React Starter

React + Vite starter for Effect UI with Tailwind v4, Base UI, and a
shadcn-compatible project shape.

## Commands

\`\`\`sh
pnpm install
pnpm dev
pnpm verify
\`\`\`

The starter includes a shadcn CLI-installed \`Badge\`, a Base UI primitive, file
routes, route-owned Resource preload, SSR, browser hydration, and a production
leak scan for server-only sentinels.
`;

const projectConsoleStarterReadme = `# Effect UI Project Console Starter

This is the larger checked starter path for Effect UI. It exercises branded
routes, file-route generation, Resources, Collections, Start server functions,
Start actions, no-JS form fallback, SSR, hydration, capability-based mocking,
and a production server-only leak scan.

## Commands

\`\`\`sh
pnpm install
pnpm dev
pnpm verify
\`\`\`

Keep \`src/domain.contract.ts\` browser-safe. Put server implementations and
seed data in \`src/domain.server.ts\`. Keep \`src/start-options.ts\` explicit;
it is the app graph source for server functions, actions, file routes,
diagnostics, and generated route output. Keep \`src/routeTree.gen.ts\`
generated, not hand-edited.
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
    readme: basicStarterReadme,
  },
  {
    id: "react",
    displayName: "react starter",
    sourceDir: resolve(workspaceRoot, "examples/react-starter"),
    outputDir: resolve(startersOutputRoot, "react"),
    packageName: "effect-ui-react-starter",
    viteConfig: reactStarterViteConfig,
    tsConfig: reactStarterTsConfig,
    readme: reactStarterReadme,
  },
  {
    id: "project-console",
    displayName: "project-console starter",
    sourceDir: resolve(workspaceRoot, "examples/project-console"),
    outputDir: resolve(startersOutputRoot, "project-console"),
    packageName: "effect-ui-project-console-starter",
    viteConfig: solidStarterViteConfig("projectConsoleStartOptions"),
    tsConfig: solidStarterTsConfig,
    readme: projectConsoleStarterReadme,
  },
];

const forbiddenSourceSegments = new Set([
  "node_modules",
  "dist",
  ".test-dist",
  localPackagesDirectoryName,
]);
const forbiddenGeneratedAppSegments = new Set(["node_modules", "dist", ".test-dist"]);
const forbiddenGeneratedLocalPackageSegments = new Set(["node_modules", ".test-dist"]);
const forbiddenGeneratedPackageFileNames = new Set([
  ".DS_Store",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  localLockfileName,
  "yarn.lock",
]);
const forbiddenGeneratedReadmeFragments = [
  "pnpm --filter @effect-ui",
  "pnpm example:",
  "pnpm starter:package",
  ".test-dist/starters",
];
const generatedAppContentFiles = ["src/routeTree.gen.ts"];

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

const distSourceStem = (relativeDistFile) => {
  const withoutMap = relativeDistFile.endsWith(".map")
    ? relativeDistFile.slice(0, -".map".length)
    : relativeDistFile;
  if (withoutMap.endsWith(".d.ts")) {
    return withoutMap.slice(0, -".d.ts".length);
  }
  if (withoutMap.endsWith(".js")) {
    return withoutMap.slice(0, -".js".length);
  }
  return undefined;
};

const packageSourceExistsForDistFile = (workspacePackage, relativeDistFile) =>
  Effect.gen(function* () {
    const sourceStem = distSourceStem(relativeDistFile);
    if (sourceStem === undefined) {
      return false;
    }

    const sourceDir = resolve(workspacePackage.directory, "src");
    const candidates = [
      resolve(sourceDir, `${sourceStem}.ts`),
      resolve(sourceDir, `${sourceStem}.tsx`),
      resolve(sourceDir, `${sourceStem}.d.ts`),
    ];
    for (const candidate of candidates) {
      if (yield* pathExists(candidate)) {
        return true;
      }
    }
    return false;
  });

const assertNoStalePackageDistArtifacts = (workspacePackage, sourceDist) =>
  Effect.gen(function* () {
    const distFiles = yield* collectFiles(sourceDist);
    const staleFiles = [];
    for (const distFile of distFiles) {
      const hasSource = yield* packageSourceExistsForDistFile(workspacePackage, distFile);
      if (!hasSource) {
        staleFiles.push(distFile);
      }
    }

    if (staleFiles.length > 0) {
      return yield* Effect.fail(
        fail(
          `${workspacePackage.packageJson.name} dist contains stale files with no source module.`,
          [
            `Stale files: ${staleFiles.join(", ")}`,
            "Run the package build script so dist is removed before compilation, then package the starter again.",
          ].join(" "),
        ),
      );
    }
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
    yield* assertNoStalePackageDistArtifacts(workspacePackage, sourceDist);

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

const assertGeneratedAppContentMatchesSource = (starter) =>
  Effect.gen(function* () {
    const changed = [];
    for (const file of generatedAppContentFiles) {
      const sourcePath = resolve(starter.sourceDir, file);
      const generatedPath = resolve(starter.outputDir, file);
      const sourceExists = yield* pathExists(sourcePath);
      const generatedExists = yield* pathExists(generatedPath);
      if (!sourceExists && !generatedExists) {
        continue;
      }
      if (!sourceExists || !generatedExists) {
        changed.push(file);
        continue;
      }
      const sourceText = yield* fsEffect(
        `read source ${starter.displayName} ${file}`,
        () => readFile(sourcePath, "utf8"),
      );
      const generatedText = yield* fsEffect(
        `read generated ${starter.displayName} ${file}`,
        () => readFile(generatedPath, "utf8"),
      );
      if (sourceText !== generatedText) {
        changed.push(file);
      }
    }

    if (changed.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} app content drifted during standalone verify.`,
          [
            `Changed generated files: ${changed.join(", ")}`,
            "Regenerate and commit these source starter artifacts before packaging so Vite does not silently repair the copied starter.",
          ].join(" "),
        ),
      );
    }
  });

const assertStandaloneReadme = (starter) =>
  Effect.gen(function* () {
    const readmePath = resolve(starter.outputDir, "README.md");
    const text = yield* fsEffect(
      `read generated ${starter.displayName} README`,
      () => readFile(readmePath, "utf8"),
    );
    const forbidden = forbiddenGeneratedReadmeFragments.filter((fragment) =>
      text.includes(fragment)
    );
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} README still contains workspace-only instructions.`,
          `Rewrite README.md for standalone use; remove: ${forbidden.join(", ")}.`,
        ),
      );
    }
  });

const parsePackDryRunOutput = (starter, stdout) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(stdout.trim()),
      catch: (cause) =>
        fail(
          `Failed to parse generated ${starter.displayName} package dry-run output.`,
          "Keep pnpm pack --dry-run --json output machine-readable.",
          cause,
        ),
    });
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof pack !== "object" || pack === null || !Array.isArray(pack.files)) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run output did not include a files array.`,
          "Keep pnpm pack --dry-run --json output machine-readable.",
        ),
      );
    }
    return pack;
  });

const assertGeneratedStarterPackageDryRun = (starter, internalPackageNames) =>
  Effect.gen(function* () {
    const packageJson = yield* readPackageJson(resolve(starter.outputDir, "package.json"));
    const { stdout } = yield* commandEffect(
      `${starter.displayName} package dry-run`,
      "pnpm",
      ["--ignore-workspace", "pack", "--dry-run", "--json"],
      { cwd: starter.outputDir },
    );
    const pack = yield* parsePackDryRunOutput(starter, stdout);
    const files = pack.files.map((file) => file.path);
    const forbidden = files.filter((file) =>
      !file.startsWith(`${localPackagesDirectoryName}/`) &&
      hasForbiddenSegment(file, forbiddenGeneratedAppSegments)
    );
    const forbiddenLocalPackageFiles = files.filter((file) =>
      file.startsWith(`${localPackagesDirectoryName}/`) &&
      (
        hasForbiddenSegment(file, forbiddenGeneratedLocalPackageSegments) ||
        forbiddenGeneratedPackageFileNames.has(file.split("/").at(-1) ?? "") ||
        file.endsWith(".tsbuildinfo")
      )
    );
    const expectedLocalPackageDirectories = internalPackageNames
      .map(localPackageDirectoryName)
      .sort((left, right) => left.localeCompare(right));
    const actualLocalPackageDirectories = [...new Set(
      files
        .filter((file) => file.startsWith(`${localPackagesDirectoryName}/`))
        .map((file) => file.split("/")[1])
        .filter((directory) => directory !== undefined)
    )].sort((left, right) => left.localeCompare(right));
    const actualLocalPackageDirectorySet = new Set(actualLocalPackageDirectories);
    const missingLocalPackages = expectedLocalPackageDirectories.filter((directory) =>
      !actualLocalPackageDirectorySet.has(directory)
    );
    const expectedLocalPackageDirectorySet = new Set(expectedLocalPackageDirectories);
    const unexpectedLocalPackages = actualLocalPackageDirectories.filter((directory) =>
      !expectedLocalPackageDirectorySet.has(directory)
    );
    const missingLocalPackageFiles = expectedLocalPackageDirectories.flatMap((directory) =>
      [
        `${localPackagesDirectoryName}/${directory}/package.json`,
        `${localPackagesDirectoryName}/${directory}/dist/index.js`,
        `${localPackagesDirectoryName}/${directory}/dist/index.d.ts`,
      ].filter((file) => !files.includes(file))
    );
    const referencedLocalPackageDirectories = localPackageReferences(packageJson)
      .sort((left, right) => left.localeCompare(right));
    const referencedLocalPackageDirectorySet = new Set(referencedLocalPackageDirectories);
    const unreferencedLocalPackages = expectedLocalPackageDirectories.filter((directory) =>
      !referencedLocalPackageDirectorySet.has(directory)
    );
    const unknownLocalPackageReferences = referencedLocalPackageDirectories.filter((directory) =>
      !expectedLocalPackageDirectorySet.has(directory)
    );

    if (missingLocalPackages.length > 0 || unexpectedLocalPackages.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run has incomplete local file package adapters.`,
          [
            "Keep generated starter package payloads aligned with local file dependencies.",
            missingLocalPackages.length > 0 ? `Missing: ${missingLocalPackages.join(", ")}` : undefined,
            unexpectedLocalPackages.length > 0 ? `Unexpected: ${unexpectedLocalPackages.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
    if (missingLocalPackageFiles.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run omits required local package files.`,
          `Include these local package files in the tarball payload: ${missingLocalPackageFiles.join(", ")}.`,
        ),
      );
    }
    if (unreferencedLocalPackages.length > 0 || unknownLocalPackageReferences.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package.json local file references do not match the packaged adapters.`,
          [
            "Keep dependencies and pnpm overrides aligned with the generated local package payload.",
            unreferencedLocalPackages.length > 0 ? `Unreferenced adapters: ${unreferencedLocalPackages.join(", ")}` : undefined,
            unknownLocalPackageReferences.length > 0 ? `Unknown references: ${unknownLocalPackageReferences.join(", ")}` : undefined,
          ].filter(Boolean).join(" "),
        ),
      );
    }
    if (forbidden.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run includes forbidden app artifacts.`,
          `Remove these generated app paths from the tarball payload: ${forbidden.join(", ")}.`,
        ),
      );
    }
    if (forbiddenLocalPackageFiles.length > 0) {
      return yield* Effect.fail(
        fail(
          `Generated ${starter.displayName} package dry-run includes forbidden local package artifacts.`,
          `Remove these local package paths from the tarball payload: ${forbiddenLocalPackageFiles.join(", ")}.`,
        ),
      );
    }
  });

const localPackageReferencesFromMap = (dependencies) =>
  Object.values(dependencies ?? {})
    .filter((value) => typeof value === "string")
    .flatMap((value) => {
      const prefix = `file:${localPackagesDirectoryName}/`;
      return value.startsWith(prefix) ? [value.slice(prefix.length)] : [];
    });

const localPackageReferences = (packageJson) =>
  [
    ...localPackageReferencesFromMap(packageJson.dependencies),
    ...localPackageReferencesFromMap(packageJson.peerDependencies),
    ...localPackageReferencesFromMap(packageJson.devDependencies),
    ...localPackageReferencesFromMap(packageJson.pnpm?.overrides),
  ];

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
      `remove generated ${starter.displayName} test output`,
      () => rm(resolve(starter.outputDir, ".test-dist"), { force: true, recursive: true }),
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
      files: [...new Set([...(rewrittenPackageJson.files ?? []), localPackagesDirectoryName])],
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
    yield* fsEffect(`write standalone ${starter.displayName} README`, () =>
      writeFile(resolve(starter.outputDir, "README.md"), starter.readme),
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
    const collectGeneratedAppFiles = () => collectFiles(starter.outputDir, {
      filter: (filePath) =>
        !relativeTo(starter.outputDir, filePath).startsWith(`${localPackagesDirectoryName}/`),
    });
    const generatedAppFiles = yield* collectGeneratedAppFiles();

    yield* assertSameFileManifest(starter, expectedFiles, generatedAppFiles);
    yield* assertNoForbiddenGeneratedAppSegments(starter, generatedAppFiles);
    yield* verifyStandaloneConfigs(starter);
    yield* assertStandaloneReadme(starter);
    yield* assertNoWorkspaceProtocol(starter);
    yield* verifyInstallableStarter(starter);
    const verifiedGeneratedAppFiles = yield* collectGeneratedAppFiles();
    yield* assertSameFileManifest(starter, expectedFiles, verifiedGeneratedAppFiles);
    yield* assertNoForbiddenGeneratedAppSegments(starter, verifiedGeneratedAppFiles);
    yield* assertGeneratedAppContentMatchesSource(starter);
    yield* assertStandaloneReadme(starter);
    yield* assertNoWorkspaceProtocol(starter);
    yield* assertGeneratedStarterPackageDryRun(starter, internalPackageNames);

    return {
      id: starter.id,
      outputDir: starter.outputDir,
      appFiles: verifiedGeneratedAppFiles.length,
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
