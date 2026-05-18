import { access, readdir, readFile } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

const docsRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(docsRoot, "dist");

class PagesBuildVerifyError extends Data.TaggedError("PagesBuildVerifyError") {}

const fail = (message, repair, cause) => new PagesBuildVerifyError({ message, repair, cause });

const fsEffect = (description, register) =>
  Effect.callback((resume) => {
    register((cause, value) => {
      if (cause) {
        resume(
          Effect.fail(
            fail(
              `Failed to ${description}.`,
              "Run the docs-site GitHub Pages build before verification.",
              cause,
            ),
          ),
        );
        return;
      }
      resume(Effect.succeed(value));
    });
  });

const accessEffect = (filePath) =>
  fsEffect(`access ${relative(distRoot, filePath)}`, (resume) => access(filePath, resume)).pipe(
    Effect.asVoid,
  );

const readDirEffect = (directory) =>
  fsEffect(`read ${relative(distRoot, directory)}`, (resume) =>
    readdir(directory, { withFileTypes: true }, resume),
  );

const readTextEffect = (filePath) =>
  fsEffect(`read ${relative(distRoot, filePath)}`, (resume) => readFile(filePath, "utf8", resume));

const pageBasePathFromEnvironment = () => {
  const value = process.env.DOCS_SITE_BASE_PATH ?? process.env.VITE_DOCS_SITE_BASE_PATH;
  if (value === undefined || value.trim().length === 0) {
    throw fail(
      "Missing DOCS_SITE_BASE_PATH.",
      "Set DOCS_SITE_BASE_PATH before verifying a GitHub Pages build, such as '/repository-name/'.",
    );
  }
  return value;
};

const normalizeBasePath = (input) => {
  const value = input.trim();
  if (value.length === 0 || value === "/") {
    return "/";
  }
  if (value.includes("?") || value.includes("#") || /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(value)) {
    throw fail(
      `Invalid DOCS_SITE_BASE_PATH: ${input}`,
      "Use a path prefix such as '/repository-name/'.",
    );
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+/gu, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

const expectedBasePathEffect = Effect.try({
  try: () => normalizeBasePath(pageBasePathFromEnvironment()),
  catch: (cause) =>
    cause instanceof PagesBuildVerifyError
      ? cause
      : fail(
          "Failed to read GitHub Pages base path.",
          "Set DOCS_SITE_BASE_PATH before verification.",
          cause,
        ),
});

const collectHtmlFilesEffect = (directory) =>
  Effect.gen(function* () {
    const entries = yield* readDirEffect(directory);
    const files = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(yield* collectHtmlFilesEffect(path)));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(path);
      }
    }
    return files;
  });

const findRootAbsoluteAttributeFailures = (expectedBasePath, html, file) => {
  if (expectedBasePath === "/") {
    return [];
  }

  const expectedPrefix = expectedBasePath.slice(0, -1);
  const failures = [];
  const attributePattern = /\b(?:href|src)=["'](\/(?!\/)[^"']*)["']/giu;
  for (const match of html.matchAll(attributePattern)) {
    const value = match[1];
    if (!value || value.startsWith(`${expectedPrefix}/`) || value === `${expectedPrefix}/`) {
      continue;
    }
    failures.push(`${relative(distRoot, file)} references ${value}`);
  }
  return failures;
};

const mainEffect = Effect.gen(function* () {
  const expectedBasePath = yield* expectedBasePathEffect;
  yield* accessEffect(join(distRoot, "index.html"));
  yield* accessEffect(join(distRoot, ".nojekyll"));

  const htmlFiles = yield* collectHtmlFilesEffect(distRoot);
  const failures = [];
  for (const file of htmlFiles) {
    const html = yield* readTextEffect(file);
    failures.push(...findRootAbsoluteAttributeFailures(expectedBasePath, html, file));
  }

  if (failures.length > 0) {
    return yield* Effect.fail(
      fail(
        [
          `GitHub Pages build contains root-absolute links outside ${expectedBasePath}:`,
          ...failures.map((failure) => `- ${failure}`),
        ].join("\n"),
        "Use the docs site base-path helper for generated href and src attributes.",
      ),
    );
  }

  console.log(
    `Verified ${htmlFiles.length} GitHub Pages HTML files for base path ${expectedBasePath}.`,
  );
});

runScriptMainEffect(
  mainEffect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        if (error.repair !== undefined && error.repair !== "") {
          console.error(error.repair);
        }
        process.exitCode = 1;
      }),
    ),
  ),
);
