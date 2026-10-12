#!/usr/bin/env node

// Keeps compiled-snippet docs in sync with their type-checked fixtures.
//
// A doc marks a fenced code block as compiled with a comment on the line
// before it:
//
//   <!-- snippet: type-tests/golden-path/projects.ts -->
//   ```ts
//   ...the whole file, byte for byte...
//   ```
//
// `pnpm typecheck` type-checks the fixture files and runs this script, which
// fails when a fence differs from its file, when a TypeScript fence in a
// checked doc has no snippet marker, or when a fixture file is never shown.
// `--write` rewrites the fences from the files.
//
// `<!-- snippet: before.tsx -> after.tsx -->` before a ```diff fence shows the
// unified diff between two fixture files instead, so a step that changes a
// few lines shows just those lines and still cannot drift.
//
// `<!-- snippet: type-tests/docs/db/sync.ts#changes -->` shows one region of a
// fixture: the lines between `// #region changes` and the next
// `// #endregion`, dedented. The rest of the file (imports, the model the
// snippet refers to) is still type-checked but not shown. Region marker lines
// never appear in a shown file.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Docs whose TypeScript fences must all be compiled snippets, with their fixture directories. */
const checkedDocs = [
  {
    doc: "README.md",
    fixtureDirectory: "type-tests/readme",
    // Pins the README's claims about the quick start's types.
    unshown: ["claims.ts"],
  },
  {
    doc: "docs/golden-path.md",
    fixtureDirectory: "type-tests/golden-path",
    // Fixture files that pin type claims but are not shown in the doc.
    unshown: ["claims.ts", "projects.memory.ts"],
  },
  {
    doc: "docs/db.md",
    fixtureDirectory: "type-tests/docs/db",
    // The shared model the snippets refer to.
    unshown: ["model.ts"],
  },
];

const markerPattern = /^<!-- snippet: ([^\s#]+)(?:#([\w-]+))?(?: -> (\S+))? -->$/;
const regionStartPattern = /^\s*\/\/ #region (\S+)\s*$/;
const regionEndPattern = /^\s*\/\/ #endregion\b/;
const fencePattern = /^```(\S*)\s*$/;
const typeScriptLanguages = new Set(["ts", "tsx", "typescript"]);

class DocSnippetDrift extends Data.TaggedError("DocSnippetDrift") {}

const readText = (file) => readFileSync(join(root, file), "utf8");
const isRegionMarker = (line) => regionStartPattern.test(line) || regionEndPattern.test(line);
const readSource = (file) =>
  readText(file)
    .split("\n")
    .filter((line) => !isRegionMarker(line))
    .join("\n")
    .replace(/\n+$/, "");

/** The dedented lines of `// #region <name>`, or undefined when the file has no such region. */
const readRegion = (file, name) => {
  const lines = readText(file).split("\n");
  const start = lines.findIndex((line) => regionStartPattern.exec(line)?.[1] === name);
  if (start === -1) {
    return undefined;
  }
  let end = start + 1;
  while (end < lines.length && !regionEndPattern.test(lines[end])) {
    end += 1;
  }
  const body = lines.slice(start + 1, end).filter((line) => !isRegionMarker(line));
  const indent = Math.min(
    ...body.filter((line) => line.trim() !== "").map((line) => /^\s*/.exec(line)[0].length),
  );
  return body
    .map((line) => line.slice(indent))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
};

const diffContext = 2;

/** Unified diff hunks (`@@` headers, ` `/`-`/`+` lines) between two line arrays. */
const unifiedDiff = (before, after) => {
  // Longest common subsequence table, filled from the end.
  const lcs = Array.from({ length: before.length + 1 }, () =>
    Array.from({ length: after.length + 1 }, () => 0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const edits = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      edits.push({ kind: " ", text: before[i], i, j });
      i += 1;
      j += 1;
    } else if (i < before.length && (j >= after.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      edits.push({ kind: "-", text: before[i], i, j });
      i += 1;
    } else {
      edits.push({ kind: "+", text: after[j], i, j });
      j += 1;
    }
  }

  const lines = [];
  let index = 0;
  while (index < edits.length) {
    if (edits[index].kind === " ") {
      index += 1;
      continue;
    }
    const start = Math.max(0, index - diffContext);
    let end = index;
    // Extend the hunk while changes are within 2 * context of each other.
    while (end < edits.length) {
      if (edits[end].kind !== " ") {
        end += 1;
        continue;
      }
      let next = end;
      while (next < edits.length && edits[next].kind === " ") {
        next += 1;
      }
      if (next < edits.length && next - end <= diffContext * 2) {
        end = next;
        continue;
      }
      end = Math.min(edits.length, end + diffContext);
      break;
    }
    const hunk = edits.slice(start, end);
    const beforeCount = hunk.filter((edit) => edit.kind !== "+").length;
    const afterCount = hunk.filter((edit) => edit.kind !== "-").length;
    lines.push(`@@ -${hunk[0].i + 1},${beforeCount} +${hunk[0].j + 1},${afterCount} @@`);
    lines.push(...hunk.map((edit) => `${edit.kind}${edit.text}`.trimEnd()));
    index = end;
  }
  return lines.join("\n");
};

const expectedBody = (snippet) =>
  snippet.region !== undefined
    ? readRegion(snippet.file, snippet.region)
    : snippet.after === undefined
      ? readSource(snippet.file)
      : unifiedDiff(readSource(snippet.file).split("\n"), readSource(snippet.after).split("\n"));

/** Returns the doc rewritten from its fixtures, plus every problem found. */
const syncDoc = ({ doc, fixtureDirectory, unshown }) => {
  const lines = readText(doc).split("\n");
  const output = [];
  const problems = [];
  const shown = new Set();
  let pendingSnippet;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = markerPattern.exec(line);
    if (marker) {
      pendingSnippet = { file: marker[1], region: marker[2], after: marker[3], line: index + 1 };
      output.push(line);
      continue;
    }

    const fence = fencePattern.exec(line);
    if (!fence || fence[1] === "") {
      if (pendingSnippet !== undefined && line.trim() !== "") {
        problems.push(
          `${doc}:${pendingSnippet.line}: snippet marker is not followed by a code fence`,
        );
        pendingSnippet = undefined;
      }
      output.push(line);
      continue;
    }

    // An opening fence: find its closing fence.
    let closing = index + 1;
    while (closing < lines.length && lines[closing].trim() !== "```") {
      closing += 1;
    }
    if (closing >= lines.length) {
      problems.push(`${doc}:${index + 1}: code fence is never closed`);
      output.push(...lines.slice(index));
      break;
    }

    const body = lines.slice(index + 1, closing).join("\n");
    if (pendingSnippet === undefined) {
      if (typeScriptLanguages.has(fence[1])) {
        problems.push(
          `${doc}:${index + 1}: TypeScript fence has no <!-- snippet: <file> --> marker; ` +
            `move the code into ${fixtureDirectory}/ so it is type-checked`,
        );
      }
      output.push(...lines.slice(index, closing + 1));
    } else if (
      [pendingSnippet.file, pendingSnippet.after].some(
        (file) => file !== undefined && !existsSync(join(root, file)),
      )
    ) {
      problems.push(`${doc}:${pendingSnippet.line}: snippet file is missing`);
      output.push(...lines.slice(index, closing + 1));
    } else {
      shown.add(pendingSnippet.file);
      if (pendingSnippet.after !== undefined) {
        shown.add(pendingSnippet.after);
      }
      const source = expectedBody(pendingSnippet);
      if (source === undefined) {
        problems.push(
          `${doc}:${pendingSnippet.line}: ${pendingSnippet.file} has no // #region ${pendingSnippet.region}`,
        );
        output.push(...lines.slice(index, closing + 1));
        pendingSnippet = undefined;
        index = closing;
        continue;
      }
      if (source !== body) {
        problems.push(
          `${doc}:${index + 1}: snippet differs from ${pendingSnippet.after ?? pendingSnippet.file} ` +
            "(run node scripts/verify-doc-snippets.mjs --write)",
        );
      }
      output.push(line, ...(source === "" ? [] : source.split("\n")), "```");
    }
    pendingSnippet = undefined;
    index = closing;
  }

  for (const entry of readdirSync(join(root, fixtureDirectory), { withFileTypes: true })) {
    const file = relative(root, join(root, fixtureDirectory, entry.name));
    if (entry.isFile() && !unshown.includes(entry.name) && !shown.has(file)) {
      problems.push(`${doc}: fixture ${file} is never shown; add a snippet or list it as unshown`);
    }
  }

  return { doc, text: output.join("\n"), problems };
};

const verifyDocSnippets = (args) =>
  Effect.gen(function* () {
    const write = args.includes("--write");
    const results = yield* Effect.sync(() => checkedDocs.map(syncDoc));

    if (write) {
      yield* Effect.sync(() => {
        for (const result of results) {
          writeFileSync(join(root, result.doc), result.text);
        }
      });
    }

    const problems = results.flatMap((result) =>
      write
        ? result.problems.filter((problem) => !problem.includes("snippet differs"))
        : result.problems,
    );
    if (problems.length > 0) {
      return yield* new DocSnippetDrift({ message: problems.join("\n") });
    }
    yield* Effect.sync(() =>
      console.log(
        `Doc snippets ${write ? "written" : "match"}: ${results.map((result) => result.doc).join(", ")}`,
      ),
    );
  });

runScriptMainEffect(
  verifyDocSnippets(process.argv.slice(2)).pipe(
    Effect.catchTag("DocSnippetDrift", (error) =>
      Effect.sync(() => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }),
    ),
  ),
);
