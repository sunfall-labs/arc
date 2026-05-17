import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Effect } from "effect";
import ts from "typescript";
import {
  currentDocsEvidencePolicy,
  currentDocsTextPolicies,
  namespaceBackedSurfaceModules,
  publicHoverDocGroups,
} from "./public-api-symbol-policy.mjs";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

const root = process.cwd();
const packagesDirectory = join(root, "packages");
const inventoryFile = join(root, "docs/public-api-inventory.md");
const publicApiManifestFile = join(root, "type-tests/public-api.manifest.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const readText = (file) => readFileSync(file, "utf8");

const inventory = readText(inventoryFile);
const publicApiManifest = readJson(publicApiManifestFile);
const failures = [];

const failSelfTest = (message) => {
  failures.push(`Public API inventory self-test failed: ${message}`);
};

const hasJsDoc = (node) =>
  ts.getJSDocCommentsAndTags(node).some((entry) => entry.kind === ts.SyntaxKind.JSDocComment);

const declarationName = (node) => {
  if (
    (ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isModuleDeclaration(node)) &&
    node.name
  ) {
    return node.name.text;
  }

  return undefined;
};

const variableStatementDeclarationNames = (statement) =>
  ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      )
    : [];

const findDeclarationNode = (statements, name) => {
  for (const statement of statements) {
    if (declarationName(statement) === name) {
      return statement;
    }
    if (variableStatementDeclarationNames(statement).includes(name)) {
      return statement;
    }
  }

  return undefined;
};

const findDeclarationNodes = (statements, name) => {
  const declarations = [];
  for (const statement of statements) {
    if (
      declarationName(statement) === name ||
      variableStatementDeclarationNames(statement).includes(name)
    ) {
      declarations.push(statement);
    }
  }
  return declarations;
};

const namespaceStatements = (sourceFile, namespaceName) => {
  const namespace = sourceFile.statements.find(
    (statement) =>
      ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name) &&
      statement.name.text === namespaceName &&
      statement.body !== undefined &&
      ts.isModuleBlock(statement.body),
  );
  return namespace?.body && ts.isModuleBlock(namespace.body)
    ? namespace.body.statements
    : undefined;
};

const auditPublicHoverDocs = () => {
  for (const group of publicHoverDocGroups) {
    const file = join(root, group.file);
    if (!existsSync(file)) {
      failures.push(`public hover docs audit points at missing file ${group.file}`);
      continue;
    }

    const source = readText(file);
    const sourceFile = ts.createSourceFile(
      group.file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    for (const name of group.declarations ?? []) {
      const declaration = findDeclarationNode(sourceFile.statements, name);
      if (declaration === undefined) {
        failures.push(`${group.file} is missing public hover declaration ${name}`);
      } else if (!hasJsDoc(declaration)) {
        failures.push(`${group.file} public hover declaration ${name} is missing JSDoc`);
      }
    }

    for (const name of group.allDeclarations ?? []) {
      const declarations = findDeclarationNodes(sourceFile.statements, name);
      if (declarations.length === 0) {
        failures.push(`${group.file} is missing public hover declaration ${name}`);
        continue;
      }
      declarations.forEach((declaration, index) => {
        if (!hasJsDoc(declaration)) {
          failures.push(
            `${group.file} public hover declaration ${name}#${index + 1} is missing JSDoc`,
          );
        }
      });
    }

    for (const [namespaceName, names] of Object.entries(group.namespaceDeclarations ?? {})) {
      const statements = namespaceStatements(sourceFile, namespaceName);
      if (statements === undefined) {
        failures.push(`${group.file} is missing public hover namespace ${namespaceName}`);
        continue;
      }
      for (const name of names) {
        const declaration = findDeclarationNode(statements, name);
        if (declaration === undefined) {
          failures.push(
            `${group.file} namespace ${namespaceName} is missing public hover declaration ${name}`,
          );
        } else if (!hasJsDoc(declaration)) {
          failures.push(`${group.file} namespace ${namespaceName}.${name} is missing JSDoc`);
        }
      }
    }
  }
};

const currentDocsTextPolicyFailures = (policy, source) => {
  const policyFailures = [];
  for (const required of policy.required ?? []) {
    required.pattern.lastIndex = 0;
    if (!required.pattern.test(source)) {
      policyFailures.push(`${policy.file} is missing current docs text: ${required.name}`);
    }
  }
  for (const banned of policy.banned ?? []) {
    banned.pattern.lastIndex = 0;
    if (banned.pattern.test(source)) {
      policyFailures.push(`${policy.file} still contains stale docs text: ${banned.name}`);
    }
  }
  return policyFailures;
};

const assertCurrentDocsTextPolicySelfTest = () => {
  const latestFocusedReview = currentDocsEvidencePolicy.latestFocusedReview;
  const latestFullGateReview = currentDocsEvidencePolicy.latestFullGateReview;
  const staleFocusedReview = latestFocusedReview - 1;
  const staleFullGateReview = latestFullGateReview - 1;
  const staleRootTestFiles = currentDocsEvidencePolicy.rootTestFiles - 5;
  const staleRootTestCount = currentDocsEvidencePolicy.rootTestCount - 62;
  const staleEffectFirstFiles = currentDocsEvidencePolicy.effectFirstFiles - 4;
  const staleCleanCounter = "2/30";
  const currentDocsSelfTestPolicy = {
    file: "self-test.md",
    required: [
      {
        name: "self-test current focused review",
        pattern: new RegExp(`Review ?${latestFocusedReview}`),
      },
      {
        name: "self-test current full gate review",
        pattern: new RegExp(`Review ?${latestFullGateReview}`),
      },
      {
        name: "self-test current root test count",
        pattern: new RegExp(
          `${currentDocsEvidencePolicy.rootTestFiles} root test files / ${currentDocsEvidencePolicy.rootTestCount} tests`,
        ),
      },
      {
        name: "self-test current clean counter",
        pattern: new RegExp(
          `${currentDocsEvidencePolicy.activeCleanCounter} after\\s+Clean Sweep 3 after Review${latestFocusedReview}`,
        ),
      },
      {
        name: "self-test current effect-first file count",
        pattern: new RegExp(
          `Effect-first audit over ${currentDocsEvidencePolicy.effectFirstFiles}`,
        ),
      },
    ],
    banned: [
      {
        name: "self-test stale focused review",
        pattern: new RegExp(`Latest focused evidence: Review ${staleFocusedReview}`),
      },
      {
        name: "self-test stale full gate review",
        pattern: new RegExp(`latest full gate is Review${staleFullGateReview}`),
      },
      {
        name: "self-test stale root test count",
        pattern: new RegExp(`${staleRootTestFiles} root test files / ${staleRootTestCount} tests`),
      },
      {
        name: "self-test stale clean counter",
        pattern: new RegExp(
          `${staleCleanCounter} after\\s+Clean Sweep 3 after Review${staleFocusedReview}`,
        ),
      },
      {
        name: "self-test stale effect-first file count",
        pattern: new RegExp(`Effect-first audit over ${staleEffectFirstFiles}`),
      },
    ],
  };
  const staleFailures = currentDocsTextPolicyFailures(
    currentDocsSelfTestPolicy,
    `Latest focused evidence: Review ${staleFocusedReview}; latest full gate is Review${staleFullGateReview}; ${staleRootTestFiles} root test files / ${staleRootTestCount} tests; Effect-first audit over ${staleEffectFirstFiles}; active counter ${staleCleanCounter} after\n  Clean Sweep 3 after Review${staleFocusedReview}.`,
  );
  for (const expected of [
    "self-test stale focused review",
    "self-test stale full gate review",
    "self-test stale root test count",
    "self-test stale clean counter",
    "self-test stale effect-first file count",
  ]) {
    if (!staleFailures.some((failure) => failure.includes(expected))) {
      failSelfTest(
        `current docs text policy self-test did not catch ${expected}: ${staleFailures.join(" ")}`,
      );
    }
  }

  const currentFailures = currentDocsTextPolicyFailures(
    currentDocsSelfTestPolicy,
    `Latest focused evidence: Review ${latestFocusedReview}; latest full gate is Review${latestFullGateReview}; ${currentDocsEvidencePolicy.rootTestFiles} root test files / ${currentDocsEvidencePolicy.rootTestCount} tests; Effect-first audit over ${currentDocsEvidencePolicy.effectFirstFiles}; active counter ${currentDocsEvidencePolicy.activeCleanCounter} after\n  Clean Sweep 3 after Review${latestFocusedReview}.`,
  );
  if (currentFailures.length > 0) {
    failSelfTest(
      `current docs text policy self-test rejected current evidence: ${currentFailures.join(" ")}`,
    );
  }

  const ultimatePolicy = currentDocsTextPolicies.find(
    (policy) => policy.file === "docs/ultimate-goal-checklist.md",
  );
  if (!ultimatePolicy) {
    failSelfTest("current docs text policy self-test could not find ultimate checklist policy");
  }
  const currentUltimateFailures = currentDocsTextPolicyFailures(
    ultimatePolicy,
    `Latest focused evidence: Review ${latestFocusedReview}; Latest focused verification recorded.\n  - Evidence: Review ${latestFocusedReview} records package dry-run count evidence. Review${latestFullGateReview} records the\n    latest full gate, leaving the active counter at ${currentDocsEvidencePolicy.activeCleanCounter}.`,
  );
  if (currentUltimateFailures.length > 0) {
    failSelfTest(
      `ultimate checklist production policy rejected current evidence: ${currentUltimateFailures.join(" ")}`,
    );
  }
  const staleUltimateFailures = currentDocsTextPolicyFailures(
    ultimatePolicy,
    `Latest focused evidence: Review ${staleFocusedReview}; Latest focused verification recorded.\n  - Evidence: Review ${staleFocusedReview} records package dry-run count evidence. Review${staleFullGateReview} records the\n    latest full gate, leaving the active counter at ${staleCleanCounter}.`,
  );
  for (const expected of [
    "Ultimate goal checklist must name current latest focused evidence",
    "Ultimate goal checklist must pin latest focused verification subsection",
    "Ultimate goal checklist must keep Review492 as latest full evidence",
    "Ultimate goal checklist must keep active clean counter at current evidence value",
  ]) {
    if (!staleUltimateFailures.some((failure) => failure.includes(expected))) {
      failSelfTest(
        `ultimate checklist production policy did not catch ${expected}: ${staleUltimateFailures.join(" ")}`,
      );
    }
  }
};

const auditCurrentDocsTextPolicies = () => {
  for (const policy of currentDocsTextPolicies) {
    const file = join(root, policy.file);
    if (!existsSync(file)) {
      failures.push(`current docs text policy points at missing file ${policy.file}`);
      continue;
    }

    failures.push(...currentDocsTextPolicyFailures(policy, readText(file)));
  }
};

const inventoryRows = new Map();
for (const line of inventory.split(/\r?\n/)) {
  const match = line.match(
    /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`([^|]*)\|\s*`([^`]+)`\s*\|\s*([^|]+)\|/,
  );
  if (match === null) {
    continue;
  }

  const exportLabel = `${match[2]}${match[3].includes("bin") ? " bin" : ""}`;
  const key = `${match[1]}\0${exportLabel}`;
  if (inventoryRows.has(key)) {
    failures.push(
      `docs/public-api-inventory.md duplicates Package Export Map row for ${match[1]} ${exportLabel}`,
    );
  }
  inventoryRows.set(key, match[4]);
}

const packageDirectories = readdirSync(packagesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesDirectory, entry.name))
  .filter((directory) => existsSync(join(directory, "package.json")))
  .sort();

const expectedEntrypoints = new Map();
const expectedBins = new Map();

const importSpecifierFor = (packageName, exportPath) =>
  exportPath === "." ? packageName : `${packageName}${exportPath.slice(1)}`;

const stripTypeScriptExtension = (path) => path.replace(/\.d\.ts$/, "").replace(/\.[cm]?tsx?$/, "");

const packageDirectoryForName = (packageName) =>
  packageDirectories.find(
    (directory) => readJson(join(directory, "package.json")).name === packageName,
  );

const manifestSourceDistStem = (entry, packageDirectory) => {
  const packageRelativeDirectory = relative(root, packageDirectory).split("\\").join("/");
  const sourcePrefix = `${packageRelativeDirectory}/src/`;
  if (typeof entry.source !== "string" || !entry.source.startsWith(sourcePrefix)) {
    failures.push(
      `${entry.package} export ${entry.export} source ${entry.source} must live under ${sourcePrefix}`,
    );
    return undefined;
  }

  if (entry.package === "@sunfall/arc-start" && entry.export === "./virtual") {
    return "virtual";
  }

  return stripTypeScriptExtension(entry.source.slice(sourcePrefix.length));
};

const expectedManifestTargets = (entry, packageDirectory) => {
  const stem = manifestSourceDistStem(entry, packageDirectory);
  if (stem === undefined) {
    return undefined;
  }
  return {
    types: `./dist/${stem}.d.ts`,
    default: `./dist/${stem}.js`,
  };
};

const assertManifestExportTargets = (entry, packageManifest, packageDirectory) => {
  const exportValue = packageManifest.exports?.[entry.export];
  if (exportValue === undefined) {
    return;
  }
  const expected = expectedManifestTargets(entry, packageDirectory);
  if (expected === undefined) {
    return;
  }

  if (entry.export === ".") {
    if (packageManifest.main !== expected.default) {
      failures.push(
        `${entry.package} main must target ${expected.default} because public-api.manifest.json maps root source to ${entry.source}`,
      );
    }
    if (packageManifest.types !== expected.types) {
      failures.push(
        `${entry.package} types must target ${expected.types} because public-api.manifest.json maps root source to ${entry.source}`,
      );
    }
  }

  if (typeof exportValue === "string") {
    if (exportValue !== expected.default) {
      failures.push(
        `${entry.package} export ${entry.export} must target ${expected.default} because public-api.manifest.json maps it to ${entry.source}`,
      );
    }
    return;
  }
  if (typeof exportValue !== "object" || exportValue === null || Array.isArray(exportValue)) {
    return;
  }

  if (exportValue.types !== expected.types) {
    failures.push(
      `${entry.package} export ${entry.export} types target must be ${expected.types} because public-api.manifest.json maps it to ${entry.source}`,
    );
  }
  if (exportValue.default !== expected.default) {
    failures.push(
      `${entry.package} export ${entry.export} default target must be ${expected.default} because public-api.manifest.json maps it to ${entry.source}`,
    );
  }
};

const assertManifestBinTarget = (entry, packageManifest, packageDirectory) => {
  const stem = manifestSourceDistStem({ ...entry, export: `<bin:${entry.bin}>` }, packageDirectory);
  if (stem === undefined) {
    return;
  }
  const expected = `./dist/${stem}.js`;
  const actual = packageManifest.bin?.[entry.bin];
  if (actual !== expected) {
    failures.push(
      `${entry.package} bin ${entry.bin} target must be ${expected} because public-api.manifest.json maps it to ${entry.source}`,
    );
  }
};

const assertRelativeFile = (label, path) => {
  if (typeof path !== "string" || path.length === 0) {
    failures.push(`${label} must be a non-empty relative path`);
    return;
  }

  if (!existsSync(join(root, path))) {
    failures.push(`${label} points at missing file ${path}`);
  }
};

const importDeclarationsFor = (sourceFile, specifier) =>
  sourceFile.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === specifier,
  );

const importModuleSpecifiers = (sourceFile) =>
  new Set(
    sourceFile.statements.flatMap((statement) =>
      ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [],
    ),
  );

const importedBindingNames = (declaration) => {
  const importClause = declaration.importClause;
  if (importClause === undefined) {
    return [];
  }

  const names = [];
  if (importClause.name !== undefined) {
    names.push(importClause.name.text);
  }

  const namedBindings = importClause.namedBindings;
  if (namedBindings === undefined) {
    return names;
  }
  if (ts.isNamespaceImport(namedBindings)) {
    names.push(namedBindings.name.text);
  } else {
    for (const element of namedBindings.elements) {
      names.push(element.name.text);
    }
  }

  return names;
};

const typeTestReferenceCoverageFailures = (entry, sourceFile) => {
  const moduleSpecifiers = importModuleSpecifiers(sourceFile);
  const usedReferences = nonImportReferenceNames(sourceFile);
  const referenceFailures = [];

  for (const reference of entry.typeTestReferences ?? []) {
    if (typeof reference !== "string" || reference.length === 0) {
      referenceFailures.push(
        `${entry.package} export ${entry.export} typeTestReferences entries must be non-empty strings`,
      );
    } else if (reference.startsWith("virtual:")) {
      if (!moduleSpecifiers.has(reference)) {
        referenceFailures.push(
          `${entry.package} export ${entry.export} type test ${entry.typeTest} must import virtual module ${reference}`,
        );
      }
    } else if (
      !reference.split(".").every((part) => ts.isIdentifierText(part, ts.ScriptTarget.Latest))
    ) {
      referenceFailures.push(
        `${entry.package} export ${entry.export} typeTestReferences entry ${reference} must be either a virtual:* module specifier, TypeScript identifier, or dotted namespace member`,
      );
    } else if (!usedReferences.has(reference)) {
      referenceFailures.push(
        `${entry.package} export ${entry.export} type test ${entry.typeTest} is missing required symbol reference ${reference}`,
      );
    }
  }

  return referenceFailures;
};

const referenceParts = (node) => {
  if (ts.isIdentifier(node)) {
    return [node.text];
  }
  if (ts.isPropertyAccessExpression(node)) {
    const left = referenceParts(node.expression);
    return left === undefined ? undefined : [...left, node.name.text];
  }
  if (ts.isQualifiedName(node)) {
    const left = referenceParts(node.left);
    return left === undefined ? undefined : [...left, node.right.text];
  }
  return undefined;
};

const nonImportReferenceNames = (sourceFile) => {
  const names = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      names.add(node.text);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isQualifiedName(node)) {
      const parts = referenceParts(node);
      if (parts !== undefined) {
        names.add(parts.join("."));
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      visit(statement);
    }
  }
  return names;
};

const assertTypeTestCoverage = (entry, typeTestPath, typeTest) => {
  const sourceFile = ts.createSourceFile(
    typeTestPath,
    typeTest,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = importDeclarationsFor(sourceFile, entry.import);
  if (imports.length === 0) {
    failures.push(
      `${entry.package} export ${entry.export} type test ${entry.typeTest} does not import ${entry.import}`,
    );
    return;
  }

  const importedNames = imports.flatMap(importedBindingNames);
  if (importedNames.length === 0 && !Array.isArray(entry.typeTestReferences)) {
    failures.push(
      `${entry.package} export ${entry.export} type test ${entry.typeTest} is side-effect-only and must declare typeTestReferences in the manifest`,
    );
  }

  const usedIdentifiers = nonImportReferenceNames(sourceFile);
  for (const name of importedNames) {
    if (!usedIdentifiers.has(name)) {
      failures.push(
        `${entry.package} export ${entry.export} type test ${entry.typeTest} imports ${name} but does not exercise it outside the import declaration`,
      );
    }
  }

  for (const name of entry.requiredTypeTestImports ?? []) {
    if (typeof name !== "string" || name.length === 0) {
      failures.push(
        `${entry.package} export ${entry.export} requiredTypeTestImports entries must be non-empty strings`,
      );
    } else if (!importedNames.includes(name)) {
      failures.push(
        `${entry.package} export ${entry.export} type test ${entry.typeTest} must directly import required public symbol ${name}`,
      );
    } else if (!usedIdentifiers.has(name)) {
      failures.push(
        `${entry.package} export ${entry.export} type test ${entry.typeTest} must exercise required public symbol ${name}`,
      );
    }
  }

  failures.push(...typeTestReferenceCoverageFailures(entry, sourceFile));
};

const assertTypeTestReferenceSelfTest = (name, source, references, expectedFragments) => {
  const sourceFile = ts.createSourceFile(
    `${name}.test-d.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const entry = {
    package: "@sunfall/arc-self-test",
    export: "./virtual",
    typeTest: `${name}.test-d.ts`,
    typeTestReferences: references,
  };
  const referenceFailures = typeTestReferenceCoverageFailures(entry, sourceFile);
  if (referenceFailures.length !== expectedFragments.length) {
    failSelfTest(
      `${name} typeTestReferences self-test expected ${expectedFragments.length} failures but found ${referenceFailures.length}: ${referenceFailures.join(" ")}`,
    );
  }
  for (const expectedFragment of expectedFragments) {
    if (!referenceFailures.some((failure) => failure.includes(expectedFragment))) {
      failSelfTest(
        `${name} typeTestReferences self-test did not find expected failure fragment ${expectedFragment}: ${referenceFailures.join(" ")}`,
      );
    }
  }
};

assertTypeTestReferenceSelfTest(
  "valid structural references",
  `import actionManifest, { type ActionManifestEntry } from "virtual:sunfall-arc/actions";
const values: Array<unknown> = [actionManifest];
type Entry = ActionManifestEntry;
`,
  ["virtual:sunfall-arc/actions", "actionManifest", "ActionManifestEntry"],
  [],
);
assertTypeTestReferenceSelfTest(
  "substring references rejected",
  `import { type ActionManifestEntry } from "virtual:sunfall-arc/actions";
const text = "virtual:sunfall-arc/server-functions actionManifest ActionManifestEntry";
void text;
`,
  ["virtual:sunfall-arc/server-functions", "actionManifest", "ActionManifestEntry"],
  [
    "virtual module virtual:sunfall-arc/server-functions",
    "symbol reference actionManifest",
    "symbol reference ActionManifestEntry",
  ],
);

const exportedDeclarationNames = (source) => {
  const sourceFile = ts.createSourceFile(
    "public-api-source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = [];
  for (const statement of sourceFile.statements) {
    const hasExportModifier =
      ts.canHaveModifiers(statement) &&
      (ts
        .getModifiers(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false);
    if (!hasExportModifier) {
      continue;
    }
    if (declarationName(statement) !== undefined) {
      names.push(declarationName(statement));
    }
    names.push(...variableStatementDeclarationNames(statement));
  }
  return names.filter((name) => name !== undefined);
};

const exportedNamedModules = (source) => {
  const exports = [];
  const sourceFile = ts.createSourceFile(
    "public-api-entrypoint.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith("./") ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      exports.push({
        moduleName: statement.moduleSpecifier.text.slice(2).replace(/\.js$/, ""),
        exportedName: element.name.text,
      });
    }
  }
  return exports;
};

const addExportedSymbol = (exportedSymbolsByFile, file, name) => {
  const relativeFile = toRelativeSourceFile(file);
  const symbols = exportedSymbolsByFile.get(relativeFile) ?? new Set();
  symbols.add(name);
  exportedSymbolsByFile.set(relativeFile, symbols);
};

const collectPublicExportedSymbols = (entrySource) => {
  const exportedSymbolsByFile = new Map();
  const visited = new Set();
  const stack = [join(root, entrySource)];

  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || visited.has(file) || !existsSync(file)) {
      continue;
    }
    visited.add(file);

    const source = readText(file);
    for (const name of exportedDeclarationNames(source)) {
      addExportedSymbol(exportedSymbolsByFile, file, name);
    }
    for (const namedExport of exportedNamedModules(source)) {
      const target = exportedSourceModuleFile(file, namedExport.moduleName);
      if (target !== undefined) {
        addExportedSymbol(exportedSymbolsByFile, target, namedExport.exportedName);
      }
    }
    for (const moduleName of exportedModuleNames(source)) {
      const target = exportedSourceModuleFile(file, moduleName);
      if (target !== undefined) {
        stack.push(target);
      }
    }
  }

  return exportedSymbolsByFile;
};

const mergeExportedSymbols = (left, right) => {
  for (const [file, symbols] of right) {
    const merged = left.get(file) ?? new Set();
    for (const symbol of symbols) {
      merged.add(symbol);
    }
    left.set(file, merged);
  }
};

const publicApiExportedSymbolsBySourceFile = () => {
  const exportedSymbolsByFile = new Map();
  for (const entry of expectedEntrypoints.values()) {
    mergeExportedSymbols(exportedSymbolsByFile, collectPublicExportedSymbols(entry.source));
  }
  return exportedSymbolsByFile;
};

const publicNamespaceMembers = (groups, exportedSymbolsByFile) => {
  const members = new Set();
  for (const group of groups) {
    const exportedSymbols = exportedSymbolsByFile.get(group.file) ?? new Set();
    for (const [namespaceName, names] of Object.entries(group.namespaceDeclarations ?? {})) {
      if (!exportedSymbols.has(namespaceName)) {
        continue;
      }
      for (const name of names) {
        members.add(`${namespaceName}.${name}`);
      }
    }
  }
  return members;
};

const publicHoverDeclarationNames = (group) => [
  ...(group.declarations ?? []),
  ...(group.allDeclarations ?? []),
];

const publicHoverSymbolReachabilityFailures = (groups, exportedSymbolsByFile) => {
  const namespaceMembers = publicNamespaceMembers(groups, exportedSymbolsByFile);
  const symbolFailures = [];
  for (const group of groups) {
    const exportedSymbols = exportedSymbolsByFile.get(group.file) ?? new Set();
    for (const name of publicHoverDeclarationNames(group)) {
      if (exportedSymbols.has(name)) {
        continue;
      }
      const namespaceAlias = group.namespaceAliases?.[name];
      if (namespaceAlias !== undefined && namespaceMembers.has(namespaceAlias)) {
        continue;
      }
      if (namespaceAlias !== undefined) {
        symbolFailures.push(
          `${group.file} public hover declaration ${name} points at missing public namespace alias ${namespaceAlias}`,
        );
      } else {
        symbolFailures.push(
          `${group.file} public hover declaration ${name} is not reachable from a public package export`,
        );
      }
    }
  }
  return symbolFailures;
};

const assertPublicHoverSymbolReachabilitySelfTest = () => {
  const exportedSymbolsByFile = new Map([
    ["self.ts", new Set(["Exported"])],
    ["index.ts", new Set(["Public"])],
  ]);
  const selfTestGroups = [
    {
      file: "self.ts",
      declarations: ["Exported", "Hidden"],
      namespaceAliases: {
        Hidden: "Public.Hidden",
      },
    },
    {
      file: "index.ts",
      namespaceDeclarations: {
        Public: ["Hidden"],
      },
    },
  ];
  const validFailures = publicHoverSymbolReachabilityFailures(
    selfTestGroups,
    exportedSymbolsByFile,
  );
  if (validFailures.length > 0) {
    failSelfTest(
      `public hover symbol reachability self-test rejected namespace alias: ${validFailures.join(" ")}`,
    );
  }

  const missingDirectFailures = publicHoverSymbolReachabilityFailures(
    [
      {
        file: "self.ts",
        declarations: ["Hidden"],
      },
    ],
    exportedSymbolsByFile,
  );
  if (!missingDirectFailures.some((failure) => failure.includes("Hidden is not reachable"))) {
    failSelfTest(
      `public hover symbol reachability self-test missed unexported symbol: ${missingDirectFailures.join(" ")}`,
    );
  }

  const missingNamespaceFailures = publicHoverSymbolReachabilityFailures(
    [
      {
        file: "self.ts",
        declarations: ["Hidden"],
        namespaceAliases: {
          Hidden: "Public.Missing",
        },
      },
      {
        file: "index.ts",
        namespaceDeclarations: {
          Public: ["Hidden"],
        },
      },
    ],
    exportedSymbolsByFile,
  );
  if (
    !missingNamespaceFailures.some((failure) =>
      failure.includes("missing public namespace alias Public.Missing"),
    )
  ) {
    failSelfTest(
      `public hover symbol reachability self-test missed stale namespace alias: ${missingNamespaceFailures.join(" ")}`,
    );
  }
};

const sourceSurfaceCoverageFailures = (entry, actualModules) => {
  if (entry.sourceSurface === undefined) {
    return actualModules.length === 0
      ? []
      : [
          `${entry.package} export ${entry.export} sourceSurface is required because ${basename(entry.source)} re-exports local module ${actualModules[0]}`,
        ];
  }

  const surfaceFailures = [];
  if (
    !Array.isArray(entry.sourceSurface) ||
    entry.sourceSurface.some(
      (moduleName) => typeof moduleName !== "string" || moduleName.length === 0,
    )
  ) {
    return [
      `${entry.package} export ${entry.export} sourceSurface must be an array of non-empty strings`,
    ];
  }

  const expectedModules = [...new Set(entry.sourceSurface)].sort();
  if (expectedModules.length !== entry.sourceSurface.length) {
    surfaceFailures.push(
      `${entry.package} export ${entry.export} sourceSurface contains duplicate module names`,
    );
  }

  const expectedModuleSet = new Set(expectedModules);
  for (const moduleName of actualModules) {
    if (!expectedModuleSet.has(moduleName)) {
      surfaceFailures.push(
        `${entry.package} export ${entry.export} sourceSurface is missing local re-exported module ${moduleName}`,
      );
    }
  }

  const actualModuleSet = new Set(actualModules);
  for (const moduleName of expectedModules) {
    if (!actualModuleSet.has(moduleName)) {
      surfaceFailures.push(
        `${entry.package} export ${entry.export} sourceSurface lists ${moduleName}, but ${basename(entry.source)} does not re-export it`,
      );
    }
  }

  return surfaceFailures;
};

const assertSourceSurfaceSelfTest = (name, sourceSurface, actualModules, expectedFragments) => {
  const failures = sourceSurfaceCoverageFailures(
    {
      package: "@sunfall/arc-self-test",
      export: "./subpath",
      source: "packages/self-test/src/subpath.ts",
      sourceSurface,
    },
    actualModules,
  );
  if (failures.length !== expectedFragments.length) {
    failSelfTest(
      `${name} sourceSurface self-test expected ${expectedFragments.length} failures but found ${failures.length}: ${failures.join(" ")}`,
    );
  }
  for (const expectedFragment of expectedFragments) {
    if (!failures.some((failure) => failure.includes(expectedFragment))) {
      failSelfTest(
        `${name} sourceSurface self-test did not find expected failure fragment ${expectedFragment}: ${failures.join(" ")}`,
      );
    }
  }
};

assertSourceSurfaceSelfTest("valid source surface", ["alpha", "beta"], ["alpha", "beta"], []);
assertSourceSurfaceSelfTest(
  "source surface drift",
  ["alpha", "stale"],
  ["alpha", "missing"],
  ["missing local re-exported module missing", "lists stale"],
);
assertSourceSurfaceSelfTest(
  "missing source surface",
  undefined,
  ["alpha"],
  ["sourceSurface is required"],
);

for (const entry of publicApiManifest.entrypoints ?? []) {
  const key = `${entry.package}\0${entry.export}`;
  if (expectedEntrypoints.has(key)) {
    failures.push(
      `type-tests/public-api.manifest.json duplicates ${entry.package} export ${entry.export}`,
    );
    continue;
  }

  expectedEntrypoints.set(key, entry);
  const expectedImport = importSpecifierFor(entry.package, entry.export);
  if (entry.import !== expectedImport) {
    failures.push(
      `${entry.package} export ${entry.export} manifest import must be ${expectedImport}`,
    );
  }
  assertRelativeFile(`${entry.package} export ${entry.export} source`, entry.source);
  assertRelativeFile(`${entry.package} export ${entry.export} docs`, entry.docs);
  assertRelativeFile(`${entry.package} export ${entry.export} typeTest`, entry.typeTest);
  if (typeof entry.typeTest === "string" && existsSync(join(root, entry.typeTest))) {
    const typeTest = readText(join(root, entry.typeTest));
    assertTypeTestCoverage(entry, entry.typeTest, typeTest);
  }
}

for (const entry of publicApiManifest.bins ?? []) {
  const key = `${entry.package}\0${entry.bin}`;
  if (expectedBins.has(key)) {
    failures.push(
      `type-tests/public-api.manifest.json duplicates ${entry.package} bin ${entry.bin}`,
    );
    continue;
  }

  expectedBins.set(key, entry);
  assertRelativeFile(`${entry.package} bin ${entry.bin} source`, entry.source);
  assertRelativeFile(`${entry.package} bin ${entry.bin} docs`, entry.docs);
  if (entry.typeTest === null) {
    if (typeof entry.reason !== "string" || entry.reason.length === 0) {
      failures.push(`${entry.package} bin ${entry.bin} has no typeTest and must include a reason`);
    }
  } else {
    assertRelativeFile(`${entry.package} bin ${entry.bin} typeTest`, entry.typeTest);
  }
}

for (const packageDirectory of packageDirectories) {
  const packageManifest = readJson(join(packageDirectory, "package.json"));
  const packageName = packageManifest.name;
  if (typeof packageName !== "string") {
    failures.push(`${basename(packageDirectory)} package.json is missing a string name`);
    continue;
  }

  for (const exportPath of Object.keys(packageManifest.exports ?? {})) {
    const key = `${packageName}\0${exportPath}`;
    if (!inventoryRows.has(key)) {
      failures.push(
        `${packageName} export ${exportPath} is missing from docs/public-api-inventory.md Package Export Map`,
      );
    }
    if (!expectedEntrypoints.has(key)) {
      failures.push(
        `${packageName} export ${exportPath} is missing from type-tests/public-api.manifest.json`,
      );
    }
    if (
      inventoryRows.has(key) &&
      expectedEntrypoints.has(key) &&
      inventoryRows.get(key) !== expectedEntrypoints.get(key).source
    ) {
      failures.push(
        `${packageName} export ${exportPath} docs Source must match type-tests/public-api.manifest.json source ${expectedEntrypoints.get(key).source}`,
      );
    }
  }

  for (const binName of Object.keys(packageManifest.bin ?? {})) {
    const key = `${packageName}\0${binName} bin`;
    if (!inventoryRows.has(key)) {
      failures.push(
        `${packageName} bin ${binName} is missing from docs/public-api-inventory.md Package Export Map`,
      );
    }
    if (!expectedBins.has(`${packageName}\0${binName}`)) {
      failures.push(
        `${packageName} bin ${binName} is missing from type-tests/public-api.manifest.json`,
      );
    }
    if (
      inventoryRows.has(key) &&
      expectedBins.has(`${packageName}\0${binName}`) &&
      inventoryRows.get(key) !== expectedBins.get(`${packageName}\0${binName}`).source
    ) {
      failures.push(
        `${packageName} bin ${binName} docs Source must match type-tests/public-api.manifest.json source ${expectedBins.get(`${packageName}\0${binName}`).source}`,
      );
    }
  }
}

for (const [key, entry] of expectedEntrypoints) {
  const [packageName, exportPath] = key.split("\0");
  const packageDirectory = packageDirectoryForName(packageName);
  if (!packageDirectory) {
    failures.push(
      `${entry.package} export ${entry.export} in type-tests/public-api.manifest.json has no workspace package`,
    );
    continue;
  }

  const packageManifest = readJson(join(packageDirectory, "package.json"));
  if (!(exportPath in (packageManifest.exports ?? {}))) {
    failures.push(
      `${entry.package} export ${entry.export} in type-tests/public-api.manifest.json is not a package export`,
    );
  } else {
    assertManifestExportTargets(entry, packageManifest, packageDirectory);
  }
}

for (const [key, entry] of expectedBins) {
  const [packageName, binName] = key.split("\0");
  const packageDirectory = packageDirectoryForName(packageName);
  if (!packageDirectory) {
    failures.push(
      `${entry.package} bin ${entry.bin} in type-tests/public-api.manifest.json has no workspace package`,
    );
    continue;
  }

  const packageManifest = readJson(join(packageDirectory, "package.json"));
  if (!(binName in (packageManifest.bin ?? {}))) {
    failures.push(
      `${entry.package} bin ${entry.bin} in type-tests/public-api.manifest.json is not a package bin`,
    );
  } else {
    assertManifestBinTarget(entry, packageManifest, packageDirectory);
  }
}

const sectionForPackage = (packageName) => {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^### \`${escaped}\`\\n([\\s\\S]*?)(?=^### \`|^## |(?![\\s\\S]))`,
    "m",
  );
  return inventory.match(pattern)?.[1] ?? "";
};

const exportedModuleNames = (source) => {
  const modules = [];
  for (const match of source.matchAll(
    /export\s+(?:type\s+)?(?:\*\s+|\{[\s\S]*?\}\s+)from\s+"\.\/([^"]+)\.js";/g,
  )) {
    modules.push(match[1]);
  }
  return modules;
};

const exportedModules = (entrypoint) => {
  const source = readText(entrypoint);
  const modules = exportedModuleNames(source);
  return [...new Set(modules)].sort();
};

for (const entry of expectedEntrypoints.values()) {
  if (existsSync(join(root, entry.source))) {
    failures.push(
      ...sourceSurfaceCoverageFailures(entry, exportedModules(join(root, entry.source))),
    );
  }
}

const toRelativeSourceFile = (file) => relative(root, file).split("\\").join("/");

const exportedSourceModuleFile = (fromFile, moduleName) => {
  const base = join(dirname(fromFile), moduleName);
  for (const extension of [".ts", ".tsx", ".d.ts"]) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const collectPublicExportedSourceFiles = (entrySource) => {
  const visited = new Set();
  const stack = [join(root, entrySource)];

  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || visited.has(file) || !existsSync(file)) {
      continue;
    }
    visited.add(file);

    for (const moduleName of exportedModuleNames(readText(file))) {
      const target = exportedSourceModuleFile(file, moduleName);
      if (target !== undefined) {
        stack.push(target);
      }
    }
  }

  return visited;
};

const publicApiReachableSourceFiles = () => {
  const reachable = new Set();
  for (const entry of expectedEntrypoints.values()) {
    for (const file of collectPublicExportedSourceFiles(entry.source)) {
      reachable.add(toRelativeSourceFile(file));
    }
  }
  return reachable;
};

const assertPublicSymbolPolicyReachability = () => {
  const reachable = publicApiReachableSourceFiles();
  const exportedSymbolsByFile = publicApiExportedSymbolsBySourceFile();
  for (const group of publicHoverDocGroups) {
    if (!reachable.has(group.file)) {
      failures.push(
        `${group.file} has public hover symbol policy but is not reachable from a public package export or re-exported source module`,
      );
    }
  }
  failures.push(
    ...publicHoverSymbolReachabilityFailures(publicHoverDocGroups, exportedSymbolsByFile),
  );
};

const localDependencyModules = (entrypoint) => {
  const source = readText(entrypoint);
  const modules = [];
  for (const match of source.matchAll(/from\s+"\.\/([^"]+)\.js";/g)) {
    modules.push(match[1]);
  }
  return [...new Set(modules)].sort();
};

const backtickNames = (source) => [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const documentedSourceSurface = (packageSection) => {
  const directModules = [];
  const namespaceModules = [];
  const coreRootExports = packageSection.match(
    /The root export (?:star-exports|re-exports) these (?:local )?modules:\n\n([\s\S]*?)(?=\n\n)/,
  );
  const localSourceModules = packageSection.match(
    /- Local source modules: ([\s\S]*?)(?=\n- |\n\n)/,
  );
  const namespaceSourceModules = packageSection.match(
    /- Namespace-backed source modules: ([\s\S]*?)(?=\n- |\n\n)/,
  );

  if (coreRootExports !== null) {
    directModules.push(...backtickNames(coreRootExports[1]));
  }
  if (localSourceModules !== null) {
    directModules.push(...backtickNames(localSourceModules[1]));
  }
  if (namespaceSourceModules !== null) {
    namespaceModules.push(...backtickNames(namespaceSourceModules[1]));
  }

  return {
    directModules: [...new Set(directModules)].sort(),
    namespaceModules: [...new Set(namespaceModules)].sort(),
  };
};

for (const [key, entry] of expectedEntrypoints) {
  const [packageName, exportPath] = key.split("\0");
  if (exportPath !== "." || !existsSync(join(root, entry.source))) {
    continue;
  }

  const rootExportedModules = exportedModules(join(root, entry.source));
  if (rootExportedModules.length === 0) {
    continue;
  }

  const packageSection = sectionForPackage(packageName);
  if (packageSection.length === 0) {
    failures.push(`${packageName} section is missing from docs/public-api-inventory.md`);
    continue;
  }

  const documentedSurface = documentedSourceSurface(packageSection);
  const documentedDirectModuleSet = new Set(documentedSurface.directModules);
  for (const moduleName of rootExportedModules) {
    if (!documentedDirectModuleSet.has(moduleName)) {
      failures.push(
        `${packageName} root export ${moduleName} is not classified in its Source Surface section`,
      );
    }
  }

  const rootExportedModuleSet = new Set(rootExportedModules);
  for (const moduleName of documentedSurface.directModules) {
    if (!rootExportedModuleSet.has(moduleName)) {
      failures.push(
        `${packageName} Source Surface lists ${moduleName}, but ${basename(entry.source)} does not re-export it`,
      );
    }
  }

  const allowedNamespaceModules = namespaceBackedSurfaceModules.get(packageName) ?? new Set();
  const localDependencyModuleSet = new Set(localDependencyModules(join(root, entry.source)));
  for (const moduleName of documentedSurface.namespaceModules) {
    if (!allowedNamespaceModules.has(moduleName)) {
      failures.push(
        `${packageName} Source Surface lists ${moduleName} as namespace-backed without an audit allowance`,
      );
    } else if (!localDependencyModuleSet.has(moduleName)) {
      failures.push(
        `${packageName} Source Surface lists ${moduleName} as namespace-backed, but ${basename(entry.source)} does not import it`,
      );
    }
  }
}

assertPublicSymbolPolicyReachability();
assertPublicHoverSymbolReachabilitySelfTest();
assertCurrentDocsTextPolicySelfTest();
auditPublicHoverDocs();
auditCurrentDocsTextPolicies();

if (failures.length > 0) {
  runScriptMainEffect(
    Effect.gen(function* () {
      yield* Effect.sync(() => {
        console.error("Public API inventory audit failed:");
        for (const failure of failures) {
          console.error(`- ${failure}`);
        }
      });
      return yield* Effect.fail({
        _tag: "PublicApiInventoryAuditFailure",
        failures,
      });
    }),
  );
} else {
  runScriptMainEffect(
    Effect.sync(() => {
      console.log("Public API inventory audit passed.");
    }),
  );
}
