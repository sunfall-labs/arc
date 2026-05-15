import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

const typeScriptSourceExtensions = new Set([".ts", ".tsx"]);
const typeScriptDeclarationExtensions = new Set([".ts", ".tsx", ".d.ts"]);
const scriptExtensions = new Set([".mjs"]);

const extensionOf = (fileName) =>
  fileName.endsWith(".d.ts")
    ? ".d.ts"
    : fileName.slice(fileName.lastIndexOf("."));

const isTestFile = (fileName) =>
  /\.test\.(ts|tsx)$/.test(fileName) || /\.spec\.(ts|tsx)$/.test(fileName);

const auditableRoots = [
  {
    name: "package sources",
    directory: join(root, "packages"),
    description: "packages/*/src TypeScript implementation files",
    include: (relativeFile, entry) =>
      entry.isFile() &&
      relativeFile.startsWith("packages/") &&
      relativeFile.includes("/src/") &&
      typeScriptSourceExtensions.has(extensionOf(entry.name))
  },
  {
    name: "example sources",
    directory: join(root, "examples"),
    description: "examples/*/src runtime files, excluding smoke/unit tests",
    include: (relativeFile, entry) =>
      entry.isFile() &&
      relativeFile.startsWith("examples/") &&
      relativeFile.includes("/src/") &&
      !isTestFile(entry.name) &&
      typeScriptSourceExtensions.has(extensionOf(entry.name))
  },
  {
    name: "workspace scripts",
    directory: join(root, "scripts"),
    description: "scripts/*.mjs release and audit entrypoints",
    include: (relativeFile, entry) =>
      entry.isFile() &&
      relativeFile.startsWith("scripts/") &&
      scriptExtensions.has(extensionOf(entry.name))
  },
  {
    name: "public type tests",
    directory: join(root, "type-tests"),
    description: "type-tests/*.d.ts public API assertions",
    include: (relativeFile, entry) =>
      entry.isFile() &&
      relativeFile.startsWith("type-tests/") &&
      typeScriptDeclarationExtensions.has(extensionOf(entry.name))
  }
];

const collectFiles = (auditableRoot) => {
  const sourceFiles = [];
  if (!existsSync(auditableRoot.directory)) {
    return sourceFiles;
  }

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "dist" && entry.name !== "node_modules") {
          visit(fullPath);
        }
        continue;
      }

      const relativeFile = relative(root, fullPath);
      if (auditableRoot.include(relativeFile, entry)) {
        sourceFiles.push(fullPath);
      }
    }
  };

  visit(auditableRoot.directory);
  return sourceFiles;
};

const auditableFilesByRoot = auditableRoots.map((auditableRoot) => ({
  ...auditableRoot,
  files: collectFiles(auditableRoot)
}));

const sourceFiles = auditableFilesByRoot.flatMap((auditableRoot) => auditableRoot.files);

const printScopeSummary = () => {
  console.log("Effect-first audit scope:");
  for (const auditableRoot of auditableFilesByRoot) {
    console.log(
      `- ${auditableRoot.name}: ${auditableRoot.files.length} files (${auditableRoot.description})`
    );
  }
  console.log(`- total auditable files: ${sourceFiles.length}`);
  console.log("Effect-first host-seam allowances:");
  for (const check of allowed) {
    console.log(`- ${check.name}: ${check.seams.size} explicit file seams`);
    for (const [file, maximum] of check.seams) {
      console.log(`  - ${file}: <= ${maximum}`);
    }
  }
  for (const check of banned) {
    if (check.seams === undefined) {
      continue;
    }
    console.log(`- ${check.name}: ${check.seams.size} explicit file seams`);
    for (const [file, maximum] of check.seams) {
      console.log(`  - ${file}: <= ${maximum}`);
    }
  }
};

const allowed = [
  {
    pattern: /Effect\.runPromise/g,
    name: "Effect.runPromise",
    seams: new Map([
      ["packages/solid/src/hooks.ts", 1],
      ["packages/react/src/hooks.ts", 1],
      ["packages/start/src/request-runtime-response.ts", 2],
      ["packages/start/src/streaming.ts", 1],
      ["packages/start/src/start-host-runtime-runner.ts", 1],
      ["packages/start/src/fetch-adapter.ts", 1],
      ["packages/start/src/cli.ts", 1],
      ["packages/start/src/vite.ts", 1],
      ["scripts/package-project-console-starter.mjs", 1]
    ])
  },
  {
    pattern: /\bPromise\s*</g,
    name: "Promise return type",
    seams: new Map([
      ["packages/start/src/fetch-adapter.ts", 2],
      ["packages/start/src/start-host-runtime-runner.ts", 2],
      ["packages/start/src/start-vite-dev-ssr.ts", 3],
      ["packages/start/src/vite.ts", 2],
      ["type-tests/framework.test-d.ts", 13]
    ])
  },
  {
    pattern: /(?:\)\s*=>\s*(?:void\s*\|\s*)?|:\s*)\bPromiseLike\s*</g,
    name: "PromiseLike return type",
    seams: new Map([
      ["packages/start/src/streaming.ts", 1]
    ])
  }
];

const receiverBeforeMemberAccess = (line, memberIndex) => {
  let end = memberIndex;
  while (/\s/.test(line[end - 1] ?? "")) {
    end -= 1;
  }

  let start = end;
  while (/[$\w]/.test(line[start - 1] ?? "")) {
    start -= 1;
  }

  return line.slice(start, end);
};

const isEffectStaticMemberAccess = (line, memberIndex) =>
  receiverBeforeMemberAccess(line, memberIndex) === "Effect";

const banned = [
  { pattern: new RegExp("\\b" + "async\\b", "g"), name: "async function syntax" },
  { pattern: new RegExp("Promise" + "\\.all\\b", "g"), name: ["Promise", "all"].join(".") },
  { pattern: new RegExp("Promise" + "\\.race\\b", "g"), name: ["Promise", "race"].join(".") },
  { pattern: new RegExp("Promise" + "\\.resolve\\b", "g"), name: ["Promise", "resolve"].join(".") },
  { pattern: new RegExp("Promise" + "\\.reject\\b", "g"), name: ["Promise", "reject"].join(".") },
  { pattern: new RegExp("new\\s+" + "Promise\\b", "g"), name: ["new", "Promise"].join(" ") },
  { pattern: new RegExp("\\." + "then\\s*\\(", "g"), name: "." + "then(...)" },
  {
    pattern: /(?<!\.)\bawait\b/g,
    name: "await keyword",
    seams: new Map([
      ["scripts/package-project-console-starter.mjs", 1]
    ])
  },
  {
    pattern: new RegExp("\\." + "catch\\s*\\(", "g"),
    name: "non-Effect ." + "catch(...)",
    allow: isEffectStaticMemberAccess
  },
  { pattern: new RegExp("\\." + "finally\\s*\\(", "g"), name: "." + "finally(...)" }
];

const codeLines = (source) => {
  let inBlockComment = false;
  let inTemplate = false;
  let templateExpressionDepth = 0;
  return source.split(/\r?\n/).map((line) => {
    let output = "";
    let quote;
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
      const current = line[index];
      const next = line[index + 1];
      if (inBlockComment) {
        if (current === "*" && next === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }
      if (inTemplate) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === "\\") {
          escaped = true;
          continue;
        }
        if (current === "$" && next === "{") {
          inTemplate = false;
          templateExpressionDepth = 1;
          index += 1;
          continue;
        }
        if (current === "`") {
          inTemplate = false;
        }
        continue;
      }
      if (quote !== undefined) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === "\\") {
          escaped = true;
          continue;
        }
        if (current === quote) {
          quote = undefined;
        }
        continue;
      }
      if (current === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
      if (current === "/" && next === "/") {
        break;
      }
      if (current === "\"" || current === "'") {
        quote = current;
        continue;
      }
      if (templateExpressionDepth > 0 && current === "{") {
        templateExpressionDepth += 1;
        output += current;
        continue;
      }
      if (templateExpressionDepth > 0 && current === "}") {
        templateExpressionDepth -= 1;
        if (templateExpressionDepth === 0) {
          inTemplate = true;
          continue;
        }
        output += current;
        continue;
      }
      if (current === "`") {
        inTemplate = true;
        continue;
      }
      if (current === "/" && line[index - 1] === " ") {
        const rest = line.slice(index + 1);
        const regexEnd = rest.search(/\/[dgimsuvy]*/);
        if (regexEnd >= 0) {
          index += regexEnd + 1;
          while (/[dgimsuvy]/.test(line[index + 1] ?? "")) {
            index += 1;
          }
          continue;
        }
      }
      output += current;
    }
    return output;
  });
};

const lineNumberAt = (source, offset) =>
  source.slice(0, offset).split(/\r?\n/).length;

const assertAuditPattern = (checkName, source, expectedMatches) => {
  const check = allowed.find((candidate) => candidate.name === checkName);
  if (check === undefined) {
    throw new Error(`Missing audit pattern self-test target: ${checkName}`);
  }
  check.pattern.lastIndex = 0;
  const matches = source.match(check.pattern)?.length ?? 0;
  if (matches !== expectedMatches) {
    throw new Error(
      `${checkName} audit pattern self-test expected ${expectedMatches} matches but found ${matches}`
    );
  }
};

const bannedMatches = (check, line) => {
  const matches = [];
  check.pattern.lastIndex = 0;
  let match;
  while ((match = check.pattern.exec(line)) !== null) {
    if (check.allow === undefined || !check.allow(line, match.index)) {
      matches.push(match);
    }
    if (match[0].length === 0) {
      check.pattern.lastIndex += 1;
    }
  }
  return matches;
};

const assertBannedPattern = (checkName, source, expectedMatches) => {
  const check = banned.find((candidate) => candidate.name === checkName);
  if (check === undefined) {
    throw new Error(`Missing banned audit pattern self-test target: ${checkName}`);
  }
  const matches = bannedMatches(check, source).length;
  if (matches !== expectedMatches) {
    throw new Error(
      `${checkName} banned audit pattern self-test expected ${expectedMatches} matches but found ${matches}`
    );
  }
};

assertAuditPattern("Promise return type", "const value: Promise <string> = promised;", 1);
assertAuditPattern("Promise return type", "const value: Promise\n<string> = promised;", 1);
assertAuditPattern("PromiseLike return type", ") => void | PromiseLike <string>;", 1);
assertBannedPattern("non-Effect .catch(...)", "Effect.catch(() => Effect.void);", 0);
assertBannedPattern("non-Effect .catch(...)", "client.catch(() => undefined);", 1);
assertBannedPattern("non-Effect .catch(...)", codeLines("`${client.catch(() => undefined)}`;")[0], 1);
assertBannedPattern("async function syntax", "async function run() {}", 1);
assertBannedPattern("await keyword", "await run();", 1);
assertBannedPattern("await keyword", "Deferred.await(done);", 0);

const failures = [];
const counts = new Map();

printScopeSummary();

const record = (key) => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

for (const file of sourceFiles) {
  const relativeFile = relative(root, file);
  const lines = codeLines(readFileSync(file, "utf8"));
  const source = lines.join("\n");

  lines.forEach((line, index) => {
    for (const check of banned) {
      const matches = bannedMatches(check, line);
      for (const _match of matches) {
        const maximum = check.seams?.get(relativeFile);
        if (maximum === undefined) {
          failures.push(`${relativeFile}:${index + 1} uses ${check.name}`);
        } else {
          record(`${check.name}\0${relativeFile}`);
        }
      }
    }
  });

  for (const check of allowed) {
    check.pattern.lastIndex = 0;
    let match;
    while ((match = check.pattern.exec(source)) !== null) {
      const maximum = check.seams.get(relativeFile);
      if (maximum === undefined) {
        failures.push(`${relativeFile}:${lineNumberAt(source, match.index)} uses ${check.name} outside an approved host seam`);
      } else {
        record(`${check.name}\0${relativeFile}`);
      }

      if (match[0].length === 0) {
        check.pattern.lastIndex += 1;
      }
    }
  }
}

for (const check of allowed) {
  for (const [file, maximum] of check.seams) {
    const count = counts.get(`${check.name}\0${file}`) ?? 0;
    if (count > maximum) {
      failures.push(`${file} has ${count} ${check.name} occurrences; expected at most ${maximum}`);
    }
  }
}

for (const check of banned) {
  if (check.seams === undefined) {
    continue;
  }
  for (const [file, maximum] of check.seams) {
    const count = counts.get(`${check.name}\0${file}`) ?? 0;
    if (count > maximum) {
      failures.push(`${file} has ${count} ${check.name} occurrences; expected at most ${maximum}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Effect-first audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Effect-first audit passed.");
