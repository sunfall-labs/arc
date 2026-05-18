import { access, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(docsRoot, "dist");

const pageBasePathFromEnvironment = () => {
  const value = process.env.DOCS_SITE_BASE_PATH ?? process.env.VITE_DOCS_SITE_BASE_PATH;
  if (value === undefined || value.trim().length === 0) {
    throw new Error(
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
    throw new Error(`Invalid DOCS_SITE_BASE_PATH: ${input}`);
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+/gu, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

const expectedBasePath = normalizeBasePath(pageBasePathFromEnvironment());

const collectHtmlFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? collectHtmlFiles(path)
        : entry.isFile() && entry.name.endsWith(".html")
          ? [path]
          : [];
    }),
  );
  return files.flat();
};

const findRootAbsoluteAttributeFailures = (html, file) => {
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

await access(join(distRoot, "index.html"));
await access(join(distRoot, ".nojekyll"));

const htmlFiles = await collectHtmlFiles(distRoot);
const failures = [];
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  failures.push(...findRootAbsoluteAttributeFailures(html, file));
}

if (failures.length > 0) {
  throw new Error(
    [
      `GitHub Pages build contains root-absolute links outside ${expectedBasePath}:`,
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
}

console.log(
  `Verified ${htmlFiles.length} GitHub Pages HTML files for base path ${expectedBasePath}.`,
);
