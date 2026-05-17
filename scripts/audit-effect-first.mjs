import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Effect } from "effect";
import ts from "typescript";
import {
  generatedStarterEffectFirstTemplates,
  generatedStarterReadmeTemplates,
  starterCatalogConsistencyFailures,
} from "./starter-catalog.mjs";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

const root = process.cwd();
const selfTestFailures = [];
const starterCatalogFailures = starterCatalogConsistencyFailures();

if (starterCatalogFailures.length > 0) {
  for (const failure of starterCatalogFailures) {
    selfTestFailures.push(`Starter catalog manifest is invalid: ${failure}`);
  }
}

const typeScriptSourceExtensions = new Set([".ts", ".tsx"]);
const typeScriptDeclarationExtensions = new Set([".ts", ".tsx", ".d.ts"]);
const scriptExtensions = new Set([".mjs"]);
const markdownSnippetExtensions = new Map([
  ["js", ".js"],
  ["jsx", ".jsx"],
  ["javascript", ".js"],
  ["mjs", ".mjs"],
  ["ts", ".ts"],
  ["tsx", ".tsx"],
  ["typescript", ".ts"],
]);

const extensionOf = (fileName) =>
  fileName.endsWith(".d.ts") ? ".d.ts" : fileName.slice(fileName.lastIndexOf("."));

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
      typeScriptDeclarationExtensions.has(extensionOf(entry.name)),
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
      typeScriptSourceExtensions.has(extensionOf(entry.name)),
  },
  {
    name: "example configs",
    directory: join(root, "examples"),
    description: "examples/*/vite.config.ts build entrypoints",
    include: (relativeFile, entry) =>
      entry.isFile() && /^examples\/[^/]+\/vite\.config\.ts$/.test(relativeFile),
  },
  {
    name: "example scripts",
    directory: join(root, "examples"),
    description: "examples/*/scripts/*.mjs copyable starter tools",
    include: (relativeFile, entry) =>
      entry.isFile() && /^examples\/[^/]+\/scripts\/[^/]+\.mjs$/.test(relativeFile),
  },
  {
    name: "workspace scripts",
    directory: join(root, "scripts"),
    description: "scripts/*.mjs release and audit entrypoints",
    include: (relativeFile, entry) =>
      entry.isFile() &&
      relativeFile.startsWith("scripts/") &&
      scriptExtensions.has(extensionOf(entry.name)),
  },
  {
    name: "public type tests",
    directory: join(root, "type-tests"),
    description: "type-tests/*.d.ts public API assertions",
    include: (relativeFile, entry) =>
      entry.isFile() &&
      relativeFile.startsWith("type-tests/") &&
      typeScriptDeclarationExtensions.has(extensionOf(entry.name)),
  },
  {
    name: "markdown docs",
    directory: root,
    description: "README, docs, and example Markdown files with TypeScript/JavaScript fences",
    include: (relativeFile, entry) =>
      entry.isFile() &&
      relativeFile.endsWith(".md") &&
      (relativeFile === "README.md" ||
        relativeFile.startsWith("docs/") ||
        relativeFile.startsWith("examples/")),
  },
];

const collectFiles = (auditableRoot) => {
  const sourceFiles = [];
  if (!existsSync(auditableRoot.directory)) {
    return sourceFiles;
  }
  const skippedDirectories = new Set([".git", ".test-dist", "dist", "node_modules"]);

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) {
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
  files: collectFiles(auditableRoot),
}));

const physicalSourceFiles = auditableFilesByRoot
  .flatMap((auditableRoot) => auditableRoot.files)
  .map((file) => ({
    relativeFile: relative(root, file),
    read: () => readFileSync(file, "utf8"),
  }));

const generatedStarterTemplateFiles = generatedStarterEffectFirstTemplates.map((template) => ({
  relativeFile: template.file,
  read: () => template.source,
}));

const extractMarkdownCodeSnippets = (relativeFile, source) => {
  const snippets = [];
  const lines = source.split(/\r?\n/);
  let active;
  let snippetIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].match(/^```([^\s`]*)/);
    if (fence === null) {
      if (active !== undefined) {
        active.lines.push(lines[index]);
      }
      continue;
    }

    if (active === undefined) {
      active = {
        language: (fence[1] ?? "").toLowerCase(),
        startLine: index + 2,
        lines: [],
      };
      continue;
    }

    const extension = markdownSnippetExtensions.get(active.language);
    if (extension !== undefined) {
      snippetIndex += 1;
      snippets.push({
        relativeFile: `${relativeFile}:${active.startLine}:snippet-${snippetIndex}${extension}`,
        source: active.lines.join("\n"),
      });
    }
    active = undefined;
  }

  return snippets;
};

const markdownSnippetFiles = physicalSourceFiles
  .filter((file) => file.relativeFile.endsWith(".md"))
  .flatMap((file) =>
    extractMarkdownCodeSnippets(file.relativeFile, file.read()).map((snippet) => ({
      relativeFile: snippet.relativeFile,
      read: () => snippet.source,
    })),
  );

const generatedStarterReadmeSnippetFiles = generatedStarterReadmeTemplates.flatMap((template) =>
  extractMarkdownCodeSnippets(template.file, template.source).map((snippet) => ({
    relativeFile: snippet.relativeFile,
    read: () => snippet.source,
  })),
);

const sourceFiles = [
  ...physicalSourceFiles.filter((file) => !file.relativeFile.endsWith(".md")),
  ...generatedStarterTemplateFiles,
  ...markdownSnippetFiles,
  ...generatedStarterReadmeSnippetFiles,
];
const sourceFileNames = new Set(sourceFiles.map((file) => file.relativeFile));

const seam = (file, name, anchor) => ({ file, name, anchor });

const printScopeSummary = () => {
  console.log("Effect-first audit scope:");
  for (const auditableRoot of auditableFilesByRoot) {
    console.log(
      `- ${auditableRoot.name}: ${auditableRoot.files.length} files (${auditableRoot.description})`,
    );
  }
  console.log(
    `- generated starter templates: ${generatedStarterTemplateFiles.length} virtual files (standalone starter TypeScript templates emitted by scripts/package-project-console-starter.mjs)`,
  );
  console.log(
    `- markdown code snippets: ${markdownSnippetFiles.length} virtual files (README, docs, and example TypeScript/JavaScript fences)`,
  );
  console.log(
    `- generated starter README snippets: ${generatedStarterReadmeSnippetFiles.length} virtual files (standalone starter README TypeScript/JavaScript fences)`,
  );
  console.log(`- total auditable files: ${sourceFiles.length}`);
  console.log("Effect-first anchored allowed occurrences:");
  for (const check of allowed) {
    console.log(`- ${check.name}: ${check.seams.length} anchored allowances`);
    for (const allowedSeam of check.seams) {
      console.log(`  - ${allowedSeam.file}: ${allowedSeam.name}`);
    }
  }
  console.log("Effect-first anchored banned-pattern exceptions:");
  for (const check of banned) {
    if (check.seams === undefined) {
      continue;
    }
    console.log(`- ${check.name}: ${check.seams.length} anchored exceptions`);
    for (const allowedSeam of check.seams) {
      console.log(`  - ${allowedSeam.file}: ${allowedSeam.name}`);
    }
  }
  console.log(
    `- Promise constructor/static AST guard: constructor usage plus ${promiseStaticMembers.length} static members across direct, host-global, alias, and extraction forms`,
  );
};

const allowed = [
  {
    pattern: /Effect\.runPromise/g,
    name: "Effect.runPromise",
    seams: [
      seam(
        "packages/solid/src/hooks.ts",
        "Solid Suspense token Adapter",
        /toHostToken:\s*\(fiber\)\s*=>\s*Effect\.runPromise\(Fiber\.join\(fiber\)\)/,
      ),
      seam(
        "packages/react/src/hooks.ts",
        "React Suspense token Adapter",
        /toHostToken:\s*\(fiber\)\s*=>\s*Effect\.runPromise\(Fiber\.join\(fiber\)\)/,
      ),
      seam(
        "packages/react/src/route-render-scope.ts",
        "React lazy route component Suspense token Adapter",
        /const pendingLazyComponent = forkRouteLazyComponentSuspense\(error, props\.runtime\);\s*if \(pendingLazyComponent !== undefined\) {\s*const fiber = pendingLazyComponent;\s*throw Effect\.runPromise\(Fiber\.join\(fiber\)\);/,
      ),
      seam(
        "packages/solid/src/route-render-scope.ts",
        "Solid lazy route component Suspense token Adapter",
        /const fiber = forkRouteLazyComponentSuspense\(error, runtime\);\s*return fiber === undefined \? undefined : Effect\.runPromise\(Fiber\.join\(fiber\)\);/,
      ),
      seam(
        "packages/start/src/request-runtime-response.ts",
        "Request Runtime response host runner",
        /runEffect:\s*\(effect\)\s*=>\s*Effect\.runPromise\(runtime\.provide\(effect\)\)/,
      ),
      seam(
        "packages/start/src/streaming.ts",
        "ReadableStream finalizer host runner",
        /const runResponseStreamEffect:\s*StartResponseStreamRunner\s*=\s*\(effect\)\s*=>\s*Effect\.runPromise\(effect\);/,
      ),
      seam(
        "packages/start/src/start-host-runtime-runner.ts",
        "Start host Promise runtime runner",
        /export const runStartHostPromise[\s\S]*?Effect\.runPromise\(/,
      ),
    ],
  },
  {
    pattern: /\bPromise\s*</g,
    name: "Promise return type",
    seams: [
      seam(
        "packages/start/src/fetch-adapter.ts",
        "Fetch host Promise handler facade",
        /export type StartFetchPromiseHandler\s*=\s*\(request:\s*Request\)\s*=>\s*Promise<Response>;/,
      ),
      seam(
        "packages/start/src/start-host-runtime-runner.ts",
        "generic host Promise runner return",
        /export const runStartHostPromise[\s\S]*?\):\s*Promise<A>\s*=>/,
      ),
      seam(
        "packages/start/src/start-vite-dev-ssr.ts",
        "Vite ssrLoadModule host method",
        /ssrLoadModule\(id:\s*string\):\s*Promise<Record<string,\s*unknown>>;/,
      ),
      seam(
        "packages/start/src/start-vite-dev-ssr.ts",
        "Vite transformIndexHtml host method",
        /transformIndexHtml\(url:\s*string,\s*html:\s*string\):\s*Promise<string>;/,
      ),
      seam(
        "packages/start/src/start-vite-dev-ssr.ts",
        "Vite module loader host callback",
        /f:\s*\(\)\s*=>\s*Promise<A>/,
      ),
      seam(
        "packages/start/src/vite.ts",
        "Vite plugin buildStart hook contract",
        /readonly buildStart:\s*\(\)\s*=>\s*void\s*\|\s*Promise<void>;/,
      ),
      seam(
        "packages/start/src/vite.ts",
        "Vite plugin closeBundle hook contract",
        /readonly closeBundle:\s*\(\)\s*=>\s*void\s*\|\s*Promise<void>;/,
      ),
      seam(
        "packages/start/src/vite.ts",
        "Vite diagnostics gate Promise hook",
        /const runCurrentDiagnosticsGate\s*=\s*\(\):\s*Promise<void>\s*=>/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedProject",
        /declare const promisedProject:\s*Promise<Project>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedProjects",
        /declare const promisedProjects:\s*Promise<ReadonlyArray<Project>>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture maybePromisedProject",
        /declare const maybePromisedProject:\s*Project\s*\|\s*Promise<Project>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedString",
        /declare const promisedString:\s*Promise<string>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedNumber",
        /declare const promisedNumber:\s*Promise<number>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedVoid",
        /declare const promisedVoid:\s*Promise<void>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedStartDevModule",
        /declare const promisedStartDevModule:\s*Promise<Record<string,\s*unknown>>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture projectRowsPromise",
        /declare const projectRowsPromise:\s*Promise<readonly Project\[]>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedBoolean",
        /declare const promisedBoolean:\s*Promise<boolean>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedStorageText",
        /declare const promisedStorageText:\s*Promise<string\s*\|\s*null>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedSqliteRow",
        /declare const promisedSqliteRow:\s*Promise<Collection\.SQLiteStorageRow\s*\|\s*null>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture promisedChangeFeedSubscription",
        /declare const promisedChangeFeedSubscription:\s*Promise<Collection\.ChangeFeedSubscription>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Promise negative fixture startResponsePromise",
        /declare const startResponsePromise:\s*Promise<Response>;/,
      ),
      seam(
        "type-tests/react.test-d.ts",
        "React RuntimeProvider Promise observer negative fixture",
        /declare const reactRuntimeProviderObserverPromise:\s*Promise<void>;/,
      ),
      seam(
        "type-tests/solid.test-d.ts",
        "Solid RuntimeProvider Promise observer negative fixture",
        /declare const solidRuntimeProviderObserverPromise:\s*Promise<void>;/,
      ),
      seam(
        "type-tests/react-db.test-d.ts",
        "React DB preload observer Promise negative fixture",
        /declare const reactDbPreloadObserverPromise:\s*Promise<void>;/,
      ),
      seam(
        "type-tests/solid-db.test-d.ts",
        "Solid DB preload observer Promise negative fixture",
        /declare const solidDbPreloadObserverPromise:\s*Promise<void>;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "Start fetch package Promise facade assertion",
        /const rootFetchPromise:\s*Promise<Response>\s*=\s*rootFetchPromiseHandler/,
      ),
    ],
  },
  {
    pattern: /\bPromiseLike\s*</g,
    name: "PromiseLike return type",
    seams: [
      seam(
        "packages/core/src/effect-like.ts",
        "EffectInput union Promise rejection helper",
        /type PromiseShapedMember[\s\S]*?Out extends PromiseLike<unknown>/,
      ),
      seam(
        "packages/start/src/streaming.ts",
        "ReadableStream finalizer host return contract",
        /export type StartResponseStreamRunner[\s\S]*?PromiseLike<A>;/,
      ),
    ],
  },
  {
    pattern: /(?:^|[;{\n]\s*)(?:readonly\s+)?then\s*\??\s*(?:\(|:)/gm,
    name: "structural thenable type surface",
    seams: [
      seam(
        "packages/core/src/effect-like.ts",
        "EffectInput callable thenable type detector",
        /type CallableThenableMember[\s\S]*?readonly then\?:\s*infer Then/,
      ),
      seam(
        "packages/core/src/effect-like.ts",
        "EffectInput broad unknown non-thenable guard",
        /object\s*&\s*\{\s*readonly then\?: never;\s*readonly \[Effect\.TypeId\]\?: never\s*\}/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "EffectInput callable thenable negative fixture",
        /declare const thenableProject:\s*\{\s*readonly then:\s*\(\) => void;/,
      ),
      seam(
        "type-tests/framework.test-d.ts",
        "EffectInput optional callable thenable negative fixture",
        /declare const optionalThenableProject:\s*\{\s*readonly then\?:\s*\(\) => void;/,
      ),
    ],
  },
];

const staticMemberKeyPattern = (member) => "(?:['\"]" + member + "['\"]|`" + member + "`)";

const memberAccessPattern = (member) =>
  "(?:(?:\\?\\.\\s*|\\.\\s*)" +
  member +
  "\\b|(?:\\?\\.\\s*)?\\[\\s*" +
  staticMemberKeyPattern(member) +
  "\\s*\\])";

const memberCallSuffixPattern =
  "(?:\\s*(?:\\?\\.\\s*)?(?:<[^>]+>\\s*)?\\(|\\s*\\)\\s*(?:\\?\\.\\s*)?(?:<[^>]+>\\s*)?\\(|\\s*\\)?\\s*(?:\\?\\.\\s*|\\.\\s*)(?:call|apply|bind)\\s*(?:\\?\\.\\s*)?\\()";

const memberCallPattern = (member) =>
  new RegExp(memberAccessPattern(member) + memberCallSuffixPattern, "g");

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

const promiseStaticMembers = [
  "all",
  "allSettled",
  "any",
  "race",
  "resolve",
  "reject",
  "try",
  "withResolvers",
];
const promiseStaticMemberSet = new Set(promiseStaticMembers);
const hostGlobalReceiverNames = new Set(["globalThis", "window", "self"]);
const promiseStaticForwarderNames = new Set(["call", "apply", "bind"]);
const promiseConstructorBinding = "promise-constructor";
const hostGlobalBinding = "host-global";

const promiseStaticCallName = (member) => ["Promise", member].join(".");
const promiseStaticExtractionName = (member) => ["Promise", member, "extraction"].join(".");
const promiseConstructorName = ["new", "Promise"].join(" ");

const scriptKindForFile = (fileName) =>
  fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : fileName.endsWith(".js") || fileName.endsWith(".mjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

const isCallExpressionLike = (node) =>
  ts.isCallExpression(node) || node.kind === ts.SyntaxKind.CallChain;

const isPropertyAccessLike = (node) =>
  ts.isPropertyAccessExpression(node) || node.kind === ts.SyntaxKind.PropertyAccessChain;

const isElementAccessLike = (node) =>
  ts.isElementAccessExpression(node) || node.kind === ts.SyntaxKind.ElementAccessChain;

const unwrapExpression = (node) => {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const literalPropertyName = (node) => {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
};

const memberNameOfAccess = (node) => {
  const expression = unwrapExpression(node);
  if (isPropertyAccessLike(expression)) {
    return literalPropertyName(expression.name);
  }
  if (isElementAccessLike(expression)) {
    const argument = expression.argumentExpression;
    return argument === undefined ? undefined : literalPropertyName(unwrapExpression(argument));
  }
  return undefined;
};

const receiverOfAccess = (node) => {
  const expression = unwrapExpression(node);
  return isPropertyAccessLike(expression) || isElementAccessLike(expression)
    ? expression.expression
    : undefined;
};

const bindingNameText = (name) => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return literalPropertyName(name.expression);
  }
  return undefined;
};

const bindingNames = (name) => {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingNames(element.name) : [],
    );
  }
  return [];
};

const analyzePromiseStaticBans = (fileName, sourceText) => {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(fileName),
  );
  const scopes = [
    new Map([
      ["Promise", promiseConstructorBinding],
      ...[...hostGlobalReceiverNames].map((name) => [name, hostGlobalBinding]),
    ]),
  ];
  const findings = [];

  const currentScope = () => scopes[scopes.length - 1];
  const lookupBinding = (name) => {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      const binding = scopes[index].get(name);
      if (binding !== undefined) {
        return binding;
      }
    }
    return false;
  };
  const setBinding = (name, binding) => {
    currentScope().set(name, binding);
  };
  const enterScope = (visitChildren) => {
    scopes.push(new Map());
    visitChildren();
    scopes.pop();
  };
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const addFinding = (node, name) => {
    findings.push({ line: lineOf(node), name });
  };

  const isHostGlobalExpression = (node) => {
    const expression = unwrapExpression(node);
    return ts.isIdentifier(expression) && lookupBinding(expression.text) === hostGlobalBinding;
  };

  const isPromiseConstructorExpression = (node) => {
    const expression = unwrapExpression(node);
    if (ts.isIdentifier(expression)) {
      return lookupBinding(expression.text) === promiseConstructorBinding;
    }
    const memberName = memberNameOfAccess(expression);
    const receiver = receiverOfAccess(expression);
    return memberName === "Promise" && receiver !== undefined && isHostGlobalExpression(receiver);
  };

  const bindingKindForInitializer = (initializer) => {
    if (isPromiseConstructorExpression(initializer)) {
      return promiseConstructorBinding;
    }
    if (isHostGlobalExpression(initializer)) {
      return hostGlobalBinding;
    }
    return false;
  };

  const promiseStaticMemberAccess = (node) => {
    const member = memberNameOfAccess(node);
    if (member === undefined || !promiseStaticMemberSet.has(member)) {
      return undefined;
    }
    const receiver = receiverOfAccess(node);
    if (receiver === undefined || !isPromiseConstructorExpression(receiver)) {
      return undefined;
    }
    return member;
  };

  const promiseStaticCallMember = (node) => {
    const expression = unwrapExpression(node);
    const directMember = promiseStaticMemberAccess(expression);
    if (directMember !== undefined) {
      return directMember;
    }
    const member = memberNameOfAccess(expression);
    if (member === undefined || !promiseStaticForwarderNames.has(member)) {
      return undefined;
    }
    const receiver = receiverOfAccess(expression);
    return receiver === undefined ? undefined : promiseStaticMemberAccess(receiver);
  };

  const declareBindingPattern = (name, binding = false) => {
    for (const bindingName of bindingNames(name)) {
      setBinding(bindingName, binding);
    }
  };

  const checkObjectBindingExtraction = (name, initializer) => {
    if (!ts.isObjectBindingPattern(name) || !isPromiseConstructorExpression(initializer)) {
      return;
    }
    for (const element of name.elements) {
      if (!ts.isBindingElement(element)) {
        continue;
      }
      const propertyName = bindingNameText(element.propertyName ?? element.name);
      if (propertyName !== undefined && promiseStaticMemberSet.has(propertyName)) {
        addFinding(element, promiseStaticExtractionName(propertyName));
      }
    }
  };

  const assignmentTargetNames = (target) => {
    const expression = unwrapExpression(target);
    if (ts.isIdentifier(expression)) {
      return [expression.text];
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.flatMap((property) => {
        if (ts.isShorthandPropertyAssignment(property)) {
          return [property.name.text];
        }
        if (ts.isPropertyAssignment(property)) {
          return assignmentTargetNames(property.initializer);
        }
        if (ts.isSpreadAssignment(property)) {
          return assignmentTargetNames(property.expression);
        }
        return [];
      });
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.flatMap((element) =>
        ts.isSpreadElement(element)
          ? assignmentTargetNames(element.expression)
          : assignmentTargetNames(element),
      );
    }
    return [];
  };

  const clearAssignmentTargets = (target) => {
    for (const binding of assignmentTargetNames(target)) {
      setBinding(binding, false);
    }
  };

  const checkObjectAssignmentExtraction = (target, initializer) => {
    const expression = unwrapExpression(target);
    if (!ts.isObjectLiteralExpression(expression) || !isPromiseConstructorExpression(initializer)) {
      return false;
    }
    for (const property of expression.properties) {
      if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) {
        continue;
      }
      const propertyName = bindingNameText(property.name);
      if (propertyName !== undefined && promiseStaticMemberSet.has(propertyName)) {
        addFinding(property, promiseStaticExtractionName(propertyName));
      }
    }
    clearAssignmentTargets(expression);
    return true;
  };

  const assignsPromiseConstructorFromHostGlobalObject = (target, initializer) => {
    const expression = unwrapExpression(target);
    if (!ts.isObjectLiteralExpression(expression) || !isHostGlobalExpression(initializer)) {
      return false;
    }
    let found = false;
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) {
        clearAssignmentTargets(property.expression);
        continue;
      }
      if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) {
        continue;
      }
      const propertyName = bindingNameText(property.name);
      const targetExpression = ts.isShorthandPropertyAssignment(property)
        ? property.name
        : property.initializer;
      if (propertyName !== "Promise") {
        clearAssignmentTargets(targetExpression);
        continue;
      }
      const unwrappedTarget = unwrapExpression(targetExpression);
      if (ts.isIdentifier(unwrappedTarget)) {
        setBinding(unwrappedTarget.text, promiseConstructorBinding);
      } else if (ts.isObjectLiteralExpression(unwrappedTarget)) {
        for (const nestedProperty of unwrappedTarget.properties) {
          if (
            !ts.isShorthandPropertyAssignment(nestedProperty) &&
            !ts.isPropertyAssignment(nestedProperty)
          ) {
            continue;
          }
          const nestedPropertyName = bindingNameText(nestedProperty.name);
          if (nestedPropertyName !== undefined && promiseStaticMemberSet.has(nestedPropertyName)) {
            addFinding(nestedProperty, promiseStaticExtractionName(nestedPropertyName));
          }
        }
        clearAssignmentTargets(unwrappedTarget);
      } else {
        clearAssignmentTargets(unwrappedTarget);
      }
      found = true;
    }
    return found;
  };

  const declaresPromiseConstructorFromHostGlobalObject = (name, initializer) => {
    if (!ts.isObjectBindingPattern(name) || !isHostGlobalExpression(initializer)) {
      return false;
    }
    let found = false;
    for (const element of name.elements) {
      if (!ts.isBindingElement(element)) {
        continue;
      }
      const propertyName = bindingNameText(element.propertyName ?? element.name);
      if (propertyName !== "Promise") {
        declareBindingPattern(element.name, false);
        continue;
      }
      if (ts.isIdentifier(element.name)) {
        setBinding(element.name.text, promiseConstructorBinding);
      } else if (ts.isObjectBindingPattern(element.name)) {
        for (const nestedElement of element.name.elements) {
          if (!ts.isBindingElement(nestedElement)) {
            continue;
          }
          const nestedPropertyName = bindingNameText(
            nestedElement.propertyName ?? nestedElement.name,
          );
          if (nestedPropertyName !== undefined && promiseStaticMemberSet.has(nestedPropertyName)) {
            addFinding(nestedElement, promiseStaticExtractionName(nestedPropertyName));
          }
        }
        declareBindingPattern(element.name, false);
      } else {
        declareBindingPattern(element.name, false);
      }
      found = true;
    }
    return found;
  };

  const visitFunctionLike = (node) => {
    if (node.name !== undefined && ts.isIdentifier(node.name)) {
      setBinding(node.name.text, false);
    }
    enterScope(() => {
      for (const parameter of node.parameters ?? []) {
        declareBindingPattern(parameter.name, false);
        if (parameter.initializer !== undefined) {
          visit(parameter.initializer);
        }
      }
      if (node.body !== undefined) {
        visit(node.body);
      }
    });
  };

  const visitVariableDeclaration = (node) => {
    const initializer = node.initializer;
    if (initializer !== undefined) {
      const member = promiseStaticMemberAccess(initializer);
      if (member !== undefined) {
        addFinding(initializer, promiseStaticExtractionName(member));
      }
      checkObjectBindingExtraction(node.name, initializer);
    }

    if (ts.isIdentifier(node.name)) {
      setBinding(
        node.name.text,
        initializer === undefined ? false : bindingKindForInitializer(initializer),
      );
    } else if (
      initializer !== undefined &&
      declaresPromiseConstructorFromHostGlobalObject(node.name, initializer)
    ) {
      // Binding state was recorded while walking the object pattern above.
    } else {
      declareBindingPattern(node.name, false);
    }

    if (initializer !== undefined) {
      visit(initializer);
    }
  };

  const visitAssignment = (node) => {
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
      ts.forEachChild(node, visit);
      return;
    }

    const member = promiseStaticMemberAccess(node.right);
    if (member !== undefined) {
      addFinding(node.right, promiseStaticExtractionName(member));
    }

    if (ts.isIdentifier(node.left)) {
      setBinding(node.left.text, bindingKindForInitializer(node.right));
    } else if (checkObjectAssignmentExtraction(node.left, node.right)) {
      // Assignment state was cleared while walking the object pattern above.
    } else if (assignsPromiseConstructorFromHostGlobalObject(node.left, node.right)) {
      // Binding state was recorded while walking the object pattern above.
    } else {
      clearAssignmentTargets(node.left);
    }

    visit(node.right);
  };

  const isAccountedPromiseStaticMemberAccess = (node) => {
    let current = node;
    let parent = current.parent;
    while (
      parent !== undefined &&
      (ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isNonNullExpression(parent)) &&
      parent.expression === current
    ) {
      current = parent;
      parent = current.parent;
    }

    if (parent === undefined) {
      return false;
    }
    if (isCallExpressionLike(parent) && parent.expression === current) {
      return true;
    }
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === current &&
      promiseStaticForwarderNames.has(memberNameOfAccess(parent) ?? "")
    ) {
      return true;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      return true;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === current
    ) {
      return true;
    }
    return false;
  };

  const visitImportDeclaration = (node) => {
    const importClause = node.importClause;
    if (importClause?.name !== undefined) {
      setBinding(importClause.name.text, false);
    }
    const namedBindings = importClause?.namedBindings;
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      setBinding(namedBindings.name.text, false);
    }
    if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        setBinding(element.name.text, false);
      }
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      visitImportDeclaration(node);
      return;
    }
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      visitFunctionLike(node);
      return;
    }
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)) {
      enterScope(() => ts.forEachChild(node, visit));
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      visitVariableDeclaration(node);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      visitAssignment(node);
      return;
    }
    if (ts.isNewExpression(node) && isPromiseConstructorExpression(node.expression)) {
      addFinding(node.expression, promiseConstructorName);
    }
    if (isCallExpressionLike(node)) {
      const member = promiseStaticCallMember(node.expression);
      if (member !== undefined) {
        addFinding(node.expression, promiseStaticCallName(member));
      }
    }
    const member = promiseStaticMemberAccess(node);
    if (member !== undefined && !isAccountedPromiseStaticMemberAccess(node)) {
      addFinding(node, promiseStaticExtractionName(member));
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return findings;
};

const banned = [
  {
    pattern: new RegExp("\\b" + "async\\b", "g"),
    name: "async function syntax",
    seams: [
      seam(
        "docs/effect-ui-framework-comparison.md:83:snippet-3.ts",
        "React Router comparison action",
        /export async function action/,
      ),
    ],
  },
  { pattern: memberCallPattern("then"), name: "." + "then(...)" },
  {
    pattern: /(?<!\.)\bawait\b/g,
    name: "await keyword",
    seams: [
      seam(
        "docs/effect-ui-framework-comparison.md:83:snippet-3.ts",
        "React Router comparison formData await",
        /await request\.formData\(\)/,
      ),
      seam(
        "docs/effect-ui-framework-comparison.md:83:snippet-3.ts",
        "React Router comparison mutation await",
        /await renameProject\(name\)/,
      ),
    ],
  },
  {
    pattern: memberCallPattern("catch"),
    name: "non-Effect ." + "catch(...)",
    allow: isEffectStaticMemberAccess,
  },
  { pattern: memberCallPattern("finally"), name: "." + "finally(...)" },
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
      if (current === '"' || current === "'") {
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

const lineNumberAt = (source, offset) => source.slice(0, offset).split(/\r?\n/).length;

const failSelfTest = (message) => {
  selfTestFailures.push(`Effect-first audit self-test failed: ${message}`);
};

const assertMarkdownSnippetExtraction = () => {
  const snippets = extractMarkdownCodeSnippets(
    "docs/self-test.md",
    [
      "```ts",
      "Effect.succeed(1);",
      "```",
      "```sh",
      "pnpm verify",
      "```",
      "```tsx",
      "<RuntimeProvider />",
      "```",
    ].join("\n"),
  );
  if (
    snippets.length !== 2 ||
    snippets[0].relativeFile !== "docs/self-test.md:2:snippet-1.ts" ||
    snippets[1].relativeFile !== "docs/self-test.md:8:snippet-2.tsx"
  ) {
    failSelfTest("Markdown snippet extraction self-test failed");
  }
};

const assertAuditPattern = (checkName, source, expectedMatches) => {
  const check = allowed.find((candidate) => candidate.name === checkName);
  if (check === undefined) {
    failSelfTest(`Missing audit pattern self-test target: ${checkName}`);
  }
  check.pattern.lastIndex = 0;
  const matches = source.match(check.pattern)?.length ?? 0;
  if (matches !== expectedMatches) {
    failSelfTest(
      `${checkName} audit pattern self-test expected ${expectedMatches} matches but found ${matches}`,
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
    failSelfTest(`Missing banned audit pattern self-test target: ${checkName}`);
  }
  const matches = bannedMatches(check, source).length;
  if (matches !== expectedMatches) {
    failSelfTest(
      `${checkName} banned audit pattern self-test expected ${expectedMatches} matches but found ${matches}`,
    );
  }
};

const assertPromiseStaticBans = (source, expectedNames) => {
  const matches = analyzePromiseStaticBans("self-test.ts", source).map((match) => match.name);
  if (matches.length !== expectedNames.length) {
    failSelfTest(
      `Promise static AST self-test expected ${expectedNames.length} matches but found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  for (let index = 0; index < expectedNames.length; index += 1) {
    if (matches[index] !== expectedNames[index]) {
      failSelfTest(
        `Promise static AST self-test expected ${expectedNames.join(", ")} but found ${matches.join(", ")}`,
      );
    }
  }
};

assertMarkdownSnippetExtraction();
assertAuditPattern("Promise return type", "const value: Promise <string> = promised;", 1);
assertAuditPattern("Promise return type", "const value: Promise\n<string> = promised;", 1);
assertAuditPattern("PromiseLike return type", ") => void | PromiseLike <string>;", 1);
assertAuditPattern("PromiseLike return type", "type Bad<T> = PromiseLike<T>;", 1);
assertAuditPattern("PromiseLike return type", "interface Bad<T> extends PromiseLike<T> {}", 1);
assertAuditPattern(
  "structural thenable type surface",
  "interface Token<T> { then(resolve: (value: T) => void): void }",
  1,
);
assertAuditPattern(
  "structural thenable type surface",
  "type Token<T> = { readonly then: (resolve: (value: T) => void) => void }",
  1,
);
assertPromiseStaticBans("Promise\n.all([]);", ["Promise.all"]);
assertPromiseStaticBans('Promise["all"]([]);', ["Promise.all"]);
assertPromiseStaticBans("Promise[`all`]([]);", ["Promise.all"]);
assertPromiseStaticBans('Promise["all" as const]([]);', ["Promise.all"]);
assertPromiseStaticBans('Promise["all" satisfies string]([]);', ["Promise.all"]);
assertPromiseStaticBans('Promise?.["all"]?.([]);', ["Promise.all"]);
assertPromiseStaticBans("Promise?.[`all`]?.([]);", ["Promise.all"]);
assertPromiseStaticBans("(Promise).all([]);", ["Promise.all"]);
assertPromiseStaticBans("(Promise.all)([]);", ["Promise.all"]);
assertPromiseStaticBans("globalThis.Promise.all([]);", ["Promise.all"]);
assertPromiseStaticBans("window.Promise.all([]);", ["Promise.all"]);
assertPromiseStaticBans("self.Promise.all([]);", ["Promise.all"]);
assertPromiseStaticBans('globalThis["Promise"]["all"]([]);', ["Promise.all"]);
assertPromiseStaticBans('self["Promise"]["all"]([]);', ["Promise.all"]);
assertPromiseStaticBans("const host = globalThis; host.Promise.all([]);", ["Promise.all"]);
assertPromiseStaticBans("const host = window; host.Promise.all([]);", ["Promise.all"]);
assertPromiseStaticBans("const host = self; host.Promise.all([]);", ["Promise.all"]);
assertPromiseStaticBans("let host; host = globalThis; host.Promise.all([]);", ["Promise.all"]);
assertPromiseStaticBans("let host; host = self; new host.Promise(() => undefined);", [
  "new Promise",
]);
assertPromiseStaticBans("const host = globalThis; const P = host.Promise; P.resolve(value);", [
  "Promise.resolve",
]);
assertPromiseStaticBans("const host = globalThis; let P; P = host.Promise; P.all([]);", [
  "Promise.all",
]);
assertPromiseStaticBans("const host = globalThis; const all = host.Promise.all; all([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("const host = globalThis; let all; all = host.Promise.all; all([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("const P = Promise; P.all([]);", ["Promise.all"]);
assertPromiseStaticBans("const P = globalThis.Promise; P.all([]);", ["Promise.all"]);
assertPromiseStaticBans("const P = window.Promise; const Q = P; Q.all([]);", ["Promise.all"]);
assertPromiseStaticBans("const P = self.Promise; const Q = P; Q.all([]);", ["Promise.all"]);
assertPromiseStaticBans("let P; P = self.Promise; P.all([]);", ["Promise.all"]);
assertPromiseStaticBans("let P; P = globalThis.Promise; new P(() => undefined);", ["new Promise"]);
assertPromiseStaticBans("const P = Promise; function run(P) { P.all([]); } P.all([]);", [
  "Promise.all",
]);
assertPromiseStaticBans("const Promise = { all() {} }; Promise.all([]);", []);
assertPromiseStaticBans("Promise.allSettled([]);", ["Promise.allSettled"]);
assertPromiseStaticBans("Promise.any([]);", ["Promise.any"]);
assertPromiseStaticBans("Promise?.resolve(value);", ["Promise.resolve"]);
assertPromiseStaticBans("Promise.resolve?.(value);", ["Promise.resolve"]);
assertPromiseStaticBans("(Promise).resolve(value);", ["Promise.resolve"]);
assertPromiseStaticBans("Promise.try(() => value);", ["Promise.try"]);
assertPromiseStaticBans("Promise[`try`](() => value);", ["Promise.try"]);
assertPromiseStaticBans("Promise.withResolvers<string>();", ["Promise.withResolvers"]);
assertPromiseStaticBans("Promise[`withResolvers`]();", ["Promise.withResolvers"]);
assertPromiseStaticBans("Promise.all.call(Promise, []);", ["Promise.all"]);
assertPromiseStaticBans("Promise.all.apply(Promise, [[]]);", ["Promise.all"]);
assertPromiseStaticBans("Promise.all.bind(Promise);", ["Promise.all"]);
assertPromiseStaticBans("const all = Promise.all; all([]);", ["Promise.all.extraction"]);
assertPromiseStaticBans("let all; all = Promise.all;", ["Promise.all.extraction"]);
assertPromiseStaticBans('const all = Promise["all"]; all([]);', ["Promise.all.extraction"]);
assertPromiseStaticBans("const all = Promise[`all`]; all([]);", ["Promise.all.extraction"]);
assertPromiseStaticBans('const all = Promise["all" as const]; all([]);', [
  "Promise.all.extraction",
]);
assertPromiseStaticBans('const all = Promise["all" satisfies string]; all([]);', [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("const { all } = Promise; all([]);", ["Promise.all.extraction"]);
assertPromiseStaticBans("const { all: promiseAll } = Promise; promiseAll([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("const P = Promise; const { all } = P; all([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("let all; ({ all } = Promise); all([]);", ["Promise.all.extraction"]);
assertPromiseStaticBans("let promiseAll; ({ all: promiseAll } = Promise); promiseAll([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("const P = Promise; let resolve; ({ resolve } = P); resolve(value);", [
  "Promise.resolve.extraction",
]);
assertPromiseStaticBans("const race = globalThis.Promise.race; race([]);", [
  "Promise.race.extraction",
]);
assertPromiseStaticBans("const resolve = window.Promise.resolve; resolve(value);", [
  "Promise.resolve.extraction",
]);
assertPromiseStaticBans("const resolve = self.Promise.resolve; resolve(value);", [
  "Promise.resolve.extraction",
]);
assertPromiseStaticBans("const promiseTry = Promise.try; promiseTry(() => value);", [
  "Promise.try.extraction",
]);
assertPromiseStaticBans("const withResolvers = Promise[`withResolvers`]; withResolvers();", [
  "Promise.withResolvers.extraction",
]);
assertPromiseStaticBans("Reflect.apply(Promise.all, Promise, [[]]);", ["Promise.all.extraction"]);
assertPromiseStaticBans("[Promise.resolve];", ["Promise.resolve.extraction"]);
assertPromiseStaticBans("const table = { run: Promise.withResolvers };", [
  "Promise.withResolvers.extraction",
]);
assertPromiseStaticBans("Reflect.apply(globalThis.Promise.race, Promise, [[]]);", [
  "Promise.race.extraction",
]);
assertPromiseStaticBans("new Promise(() => undefined);", ["new Promise"]);
assertPromiseStaticBans("new globalThis.Promise(() => undefined);", ["new Promise"]);
assertPromiseStaticBans("new self.Promise(() => undefined);", ["new Promise"]);
assertPromiseStaticBans("new (Promise)(() => undefined);", ["new Promise"]);
assertPromiseStaticBans("const P = Promise; new P(() => undefined);", ["new Promise"]);
assertPromiseStaticBans("const { Promise: P } = globalThis; P.all([]);", ["Promise.all"]);
assertPromiseStaticBans("const { Promise } = window; new Promise(() => undefined);", [
  "new Promise",
]);
assertPromiseStaticBans("const { Promise } = self; new Promise(() => undefined);", ["new Promise"]);
assertPromiseStaticBans("const { Promise: { all } } = globalThis; all([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("const { Promise: { resolve } } = self; resolve(value);", [
  "Promise.resolve.extraction",
]);
assertPromiseStaticBans("const host = globalThis; const { Promise: P } = host; P.all([]);", [
  "Promise.all",
]);
assertPromiseStaticBans(
  "const host = window; const { Promise } = host; new Promise(() => undefined);",
  ["new Promise"],
);
assertPromiseStaticBans("const host = self; const { Promise: { all } } = host; all([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans('const { ["Promise"]: P } = globalThis; P.all([]);', ["Promise.all"]);
assertPromiseStaticBans('const { ["Promise"]: P } = self; P.resolve(value);', ["Promise.resolve"]);
assertPromiseStaticBans("let P; ({ Promise: P } = globalThis); P.all([]);", ["Promise.all"]);
assertPromiseStaticBans("let P; ({ Promise: P } = window); new P(() => undefined);", [
  "new Promise",
]);
assertPromiseStaticBans("let all; ({ Promise: { all } } = globalThis); all([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans('let resolve; ({ ["Promise"]: { resolve } } = self); resolve(value);', [
  "Promise.resolve.extraction",
]);
assertPromiseStaticBans("let host; host = globalThis; let P; ({ Promise: P } = host); P.all([]);", [
  "Promise.all",
]);
assertPromiseStaticBans("let host; host = self; let all; ({ Promise: { all } } = host); all([]);", [
  "Promise.all.extraction",
]);
assertPromiseStaticBans("const Promise = class {}; new Promise(() => undefined);", []);
assertBannedPattern(".then(...)", "client.then<string>(() => undefined);", 1);
assertBannedPattern(".then(...)", 'client["then"](() => undefined);', 1);
assertBannedPattern(".then(...)", "client[`then`](() => undefined);", 1);
assertBannedPattern(".then(...)", "client.then\n<string>(() => undefined);", 1);
assertBannedPattern(".then(...)", "client.then?.(() => undefined);", 1);
assertBannedPattern(".then(...)", 'client["then"]?.(() => undefined);', 1);
assertBannedPattern(".then(...)", "(client.then)(() => undefined);", 1);
assertBannedPattern(".then(...)", '(client["then"])(() => undefined);', 1);
assertBannedPattern(".then(...)", "client.then.call(client, () => undefined);", 1);
assertBannedPattern("non-Effect .catch(...)", "Effect.catch(() => Effect.void);", 0);
assertBannedPattern("non-Effect .catch(...)", "Effect.catch<Error>(() => Effect.void);", 0);
assertBannedPattern("non-Effect .catch(...)", "Effect\n.catch<Error>(() => Effect.void);", 0);
assertBannedPattern("non-Effect .catch(...)", "client.catch(() => undefined);", 1);
assertBannedPattern("non-Effect .catch(...)", "client.catch<Error>(() => undefined);", 1);
assertBannedPattern("non-Effect .catch(...)", 'client["catch"](() => undefined);', 1);
assertBannedPattern("non-Effect .catch(...)", "client[`catch`](() => undefined);", 1);
assertBannedPattern("non-Effect .catch(...)", "client.catch.call(client, () => undefined);", 1);
assertBannedPattern(
  "non-Effect .catch(...)",
  codeLines("`${client.catch(() => undefined)}`;")[0],
  1,
);
assertBannedPattern(".finally(...)", "client.finally<void>(() => undefined);", 1);
assertBannedPattern(".finally(...)", 'client["finally"](() => undefined);', 1);
assertBannedPattern(".finally(...)", "client[`finally`](() => undefined);", 1);
assertBannedPattern(".finally(...)", "client.finally.call(client, () => undefined);", 1);
assertBannedPattern("async function syntax", "async function run() {}", 1);
assertBannedPattern("await keyword", "await run();", 1);
assertBannedPattern("await keyword", "Deferred.await(done);", 0);

const failures = [...selfTestFailures];

printScopeSummary();

const globalPattern = (pattern) =>
  new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);

const rangesForSeam = (source, check, allowedSeam) => {
  const anchor = globalPattern(allowedSeam.anchor);
  const ranges = [];
  let anchorMatch;
  while ((anchorMatch = anchor.exec(source)) !== null) {
    const anchorSource = anchorMatch[0];
    const pattern = globalPattern(check.pattern);
    const patternMatches = [...anchorSource.matchAll(pattern)];
    if (patternMatches.length !== 1) {
      failures.push(
        `${allowedSeam.file} seam "${allowedSeam.name}" contains ${patternMatches.length} ${check.name} occurrences; expected exactly 1`,
      );
    } else {
      ranges.push({
        start: anchorMatch.index,
        end: anchorMatch.index + anchorSource.length,
        seam: allowedSeam,
      });
    }
    if (anchorMatch[0].length === 0) {
      anchor.lastIndex += 1;
    }
  }
  if (ranges.length === 0) {
    failures.push(`${allowedSeam.file} seam "${allowedSeam.name}" for ${check.name} was not found`);
  } else if (ranges.length > 1) {
    failures.push(
      `${allowedSeam.file} seam "${allowedSeam.name}" for ${check.name} matched ${ranges.length} anchors; expected exactly 1`,
    );
  }
  return ranges;
};

const anchoredRangesForFile = (check, relativeFile, source) =>
  (check.seams ?? [])
    .filter((allowedSeam) => allowedSeam.file === relativeFile)
    .flatMap((allowedSeam) => rangesForSeam(source, check, allowedSeam));

const inAnchoredRange = (ranges, index) =>
  ranges.some((range) => index >= range.start && index < range.end);

for (const file of sourceFiles) {
  const relativeFile = file.relativeFile;
  const originalSource = file.read();
  const lines = codeLines(originalSource);
  const source = lines.join("\n");

  for (const match of analyzePromiseStaticBans(relativeFile, originalSource)) {
    failures.push(`${relativeFile}:${match.line} uses ${match.name}`);
  }

  for (const check of banned) {
    if (check.seams !== undefined) {
      continue;
    }
    const matches = bannedMatches(check, source);
    for (const match of matches) {
      failures.push(`${relativeFile}:${lineNumberAt(source, match.index)} uses ${check.name}`);
    }
  }

  for (const check of banned) {
    if (check.seams === undefined) {
      continue;
    }
    const anchoredRanges = anchoredRangesForFile(check, relativeFile, source);
    check.pattern.lastIndex = 0;
    let match;
    while ((match = check.pattern.exec(source)) !== null) {
      if (!inAnchoredRange(anchoredRanges, match.index)) {
        failures.push(
          `${relativeFile}:${lineNumberAt(source, match.index)} uses ${check.name} outside an anchored exception`,
        );
      }

      if (match[0].length === 0) {
        check.pattern.lastIndex += 1;
      }
    }
  }

  for (const check of allowed) {
    const anchoredRanges = anchoredRangesForFile(check, relativeFile, source);
    check.pattern.lastIndex = 0;
    let match;
    while ((match = check.pattern.exec(source)) !== null) {
      if (!inAnchoredRange(anchoredRanges, match.index)) {
        failures.push(
          `${relativeFile}:${lineNumberAt(source, match.index)} uses ${check.name} outside an anchored allowed occurrence`,
        );
      }

      if (match[0].length === 0) {
        check.pattern.lastIndex += 1;
      }
    }
  }
}

for (const check of allowed) {
  for (const allowedSeam of check.seams) {
    if (!sourceFileNames.has(allowedSeam.file) && !existsSync(join(root, allowedSeam.file))) {
      failures.push(
        `${allowedSeam.file} seam "${allowedSeam.name}" for ${check.name} points at a missing file`,
      );
    }
  }
}

for (const check of banned) {
  if (check.seams === undefined) {
    continue;
  }
  for (const allowedSeam of check.seams) {
    if (!sourceFileNames.has(allowedSeam.file) && !existsSync(join(root, allowedSeam.file))) {
      failures.push(
        `${allowedSeam.file} seam "${allowedSeam.name}" for ${check.name} points at a missing file`,
      );
    }
  }
}

if (failures.length > 0) {
  runScriptMainEffect(
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        console.error("Effect-first audit failed:");
        for (const failure of failures) {
          console.error(`- ${failure}`);
        }
      });
      return yield* Effect.fail({
        _tag: "EffectFirstAuditFailure",
        failures,
      });
    }),
  );
} else {
  runScriptMainEffect(
    Effect.sync(() => {
      console.log("Effect-first audit passed.");
    }),
  );
}
