// Code the site shows on the homepage and the blog comes from type-checked
// fixtures, never from strings in this app: `pnpm typecheck:types` compiles
// type-tests/site and type-tests/golden-path, so a snippet cannot drift from
// the API it shows.
import homeSource from "../../../type-tests/site/home.tsx?raw";
import projectsSource from "../../../type-tests/golden-path/projects.step-1.ts?raw";
import routesSource from "../../../type-tests/golden-path/routes.ts?raw";
import renameTestSource from "../../../type-tests/golden-path/rename.test.ts?raw";

const regionStartPattern = /^\s*\/\/ #region (\S+)\s*$/u;
const regionEndPattern = /^\s*\/\/ #endregion\b/u;

/**
 * The dedented lines between `// #region name` and the next `// #endregion`,
 * the same regions scripts/verify-doc-snippets.mjs reads for the docs.
 */
export const sourceRegion = (source: string, name: string): string => {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => regionStartPattern.exec(line)?.[1] === name);
  if (start === -1) {
    throw new Error(`Snippet region "${name}" is missing.`);
  }
  let end = start + 1;
  while (end < lines.length && !regionEndPattern.test(lines[end] ?? "")) {
    end += 1;
  }
  const body = lines.slice(start + 1, end);
  const indent = Math.min(
    ...body.filter((line) => line.trim() !== "").map((line) => /^\s*/u.exec(line)?.[0].length ?? 0),
  );
  return body
    .map((line) => line.slice(indent))
    .join("\n")
    .replace(/^\n+|\n+$/gu, "");
};

/** A whole fixture file without its region markers or trailing newline. */
const wholeSource = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !regionStartPattern.test(line) && !regionEndPattern.test(line))
    .join("\n")
    .replace(/\n+$/u, "");

export const homeSnippets = {
  resource: sourceRegion(homeSource, "resource"),
  action: sourceRegion(homeSource, "action"),
  component: sourceRegion(homeSource, "component"),
  unhandled: sourceRegion(homeSource, "unhandled"),
  durable: sourceRegion(homeSource, "durable"),
  timeline: sourceRegion(homeSource, "timeline"),
  refresh: sourceRegion(homeSource, "refresh"),
} as const;

export const goldenPathSnippets = {
  projects: wholeSource(projectsSource),
  routes: wholeSource(routesSource),
  renameTest: wholeSource(renameTestSource),
} as const;
