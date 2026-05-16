import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const packagesDirectory = join(root, "packages");
const inventoryFile = join(root, "docs/public-api-inventory.md");
const publicApiManifestFile = join(root, "type-tests/public-api.manifest.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const readText = (file) => readFileSync(file, "utf8");

const inventory = readText(inventoryFile);
const publicApiManifest = readJson(publicApiManifestFile);
const failures = [];

const publicHoverDocs = [
  {
    file: "packages/core/src/program.ts",
    declarations: [
      "Program",
      "startProgramWithRuntimeError"
    ],
    namespaceDeclarations: {
      Program: [
        "Definition",
        "Instance",
        "Failure",
        "RuntimeError",
        "TimelineOptions",
        "Event",
        "EventBase",
        "MessageEvent",
        "CommandStartedEvent",
        "CommandCompletedEvent",
        "CommandFailedEvent",
        "UpdateFailedEvent",
        "SubscriptionStartedEvent",
        "SubscriptionEmittedEvent",
        "SubscriptionFailedEvent",
        "DisposedEvent",
        "Phase",
        "Update",
        "Step",
        "Command",
        "CommandInput",
        "Subscription",
        "SubscriptionInput",
        "StoryEntry",
        "Story",
        "StoryOptions"
      ]
    }
  },
  {
    file: "packages/core/src/program-contract.ts",
    declarations: [
      "ProgramStepTypeId",
      "ProgramCommandTypeId",
      "ProgramSubscriptionTypeId",
      "ProgramPhase",
      "ProgramFailure",
      "ProgramCommand",
      "ProgramCommandInput",
      "ProgramStep",
      "ProgramUpdate",
      "ProgramSubscription",
      "ProgramSubscriptionInput",
      "ProgramUpdateError",
      "ProgramUpdateRequirements",
      "ProgramSubscriptionError",
      "ProgramSubscriptionRequirements",
      "ProgramDefinition",
      "ProgramRuntimeError",
      "ProgramTimelineOptions",
      "ProgramEventBase",
      "ProgramMessageEvent",
      "ProgramCommandStartedEvent",
      "ProgramCommandCompletedEvent",
      "ProgramCommandFailedEvent",
      "ProgramUpdateFailedEvent",
      "ProgramSubscriptionStartedEvent",
      "ProgramSubscriptionEmittedEvent",
      "ProgramSubscriptionFailedEvent",
      "ProgramDisposedEvent",
      "ProgramEvent",
      "ProgramStoryEntry",
      "ProgramStory",
      "ProgramStoryOptions",
      "ProgramInstance"
    ]
  },
  {
    file: "packages/core/src/browser-router-history-adapter.ts",
    declarations: [
      "BrowserNavigateOptions",
      "BrowserHistoryWindow",
      "BrowserHistoryAdapter",
      "MemoryBrowserHistoryAdapter",
      "makeWindowBrowserHistoryAdapter",
      "makeMemoryBrowserHistoryAdapter"
    ]
  },
  {
    file: "packages/core/src/browser-router-kernel.ts",
    declarations: [
      "BrowserRouterKernelOptions",
      "BrowserRouterKernel",
      "createBrowserRouterKernel",
      "RouterRouteNotRegistered"
    ]
  },
  {
    file: "packages/core/src/browser-router-host-controller.ts",
    declarations: [
      "BrowserRouterHostController",
      "createBrowserRouterHostController"
    ]
  },
  {
    file: "packages/react/src/router.ts",
    declarations: [
      "BrowserRouterOptions",
      "RouterProviderProps"
    ]
  },
  {
    file: "packages/solid/src/router.ts",
    declarations: [
      "BrowserRouterOptions",
      "RouterProviderProps"
    ]
  },
  {
    file: "packages/start/src/agent-graph.ts",
    declarations: [
      "createStartAgentGraph",
      "createStartAgentGraphEffect"
    ]
  },
  {
    file: "packages/start/src/app-graph.ts",
    declarations: [
      "StartAppGraphDiagnosticsRuntimeCandidates",
      "StartAppGraphWireSchemaPolicy",
      "StartAppGraphActionBehaviorPolicy",
      "StartAppGraphParseError",
      "StartAppGraphMissingWireSchemas",
      "StartAppGraphUnknownActionBehavior",
      "StartAppGraphDiagnosticsDtoError",
      "StartAppGraphDiagnosticsDtoInput",
      "StartAppGraphDiagnosticsDto",
      "StartAppGraphDeserializeError",
      "decodeStartAppGraphDiagnosticsEffect",
      "decodeStartAppGraphDiagnosticsPolicyViolationsEffect",
      "decodeStartAppGraphDiagnosticsDtoEffect",
      "createStartAppGraph",
      "serializeStartAppGraph",
      "describeFileRouteManifestEntry",
      "describeStartAppGraphRouteDiagnosticsRuntimeCandidate",
      "describeServerFunctionManifestEntry",
      "describeActionManifestEntry",
      "unknownRoutePreloadResourcesForDiagnostics",
      "unknownRoutePreloadCollectionsForDiagnostics",
      "describeStartAppGraph",
      "describeStartAppGraphRuntimeDiagnostics",
      "describeStartAppGraphEffect",
      "validateStartAppGraphWireSchemasEffect",
      "validateStartAppGraphActionBehaviorEffect",
      "deserializeStartAppGraph"
    ]
  },
  {
    file: "packages/start/src/start-app-graph-diagnostics-policy.ts",
    declarations: [
      "StartAppGraphRoutePreloadResourcesPolicy",
      "StartAppGraphRoutePreloadCollectionsPolicy",
      "StartAppGraphDiagnosticsPolicy",
      "StartAppGraphUnknownRoutePreloadResources",
      "StartAppGraphUnknownRoutePreloadCollections",
      "StartAppGraphDiagnosticsPolicyError",
      "StartAppGraphDiagnosticsPolicyViolation",
      "StartAppGraphDiagnosticsPolicyException",
      "validateStartAppGraphRoutePreloadResourcesDiagnosticsEffect",
      "collectStartAppGraphDiagnosticsPolicyViolations",
      "formatStartAppGraphDiagnosticsPolicyViolation",
      "createStartAppGraphDiagnosticsPolicyException",
      "enforceStartAppGraphDiagnosticsPolicy",
      "validateStartAppGraphDiagnosticsPolicyExceptionEffect",
      "validateStartAppGraphRoutePreloadCollectionsDiagnosticsEffect",
      "validateStartAppGraphDiagnosticsPolicyEffect"
    ]
  },
  {
    file: "packages/start/src/start-manifest-wall.ts",
    declarations: [
      "StartBuildPolicy",
      "StartBuildPolicyError"
    ]
  },
  {
    file: "packages/start/src/start-vite-diagnostics-loader.ts",
    declarations: [
      "StartAppGraphDiagnosticsLoadError"
    ]
  },
  {
    file: "packages/start/src/request-trace.ts",
    declarations: [
      "StartRequestTraceTransport",
      "StartRequestTraceStatus",
      "StartRequestTraceFailureKind",
      "StartRequestTraceStreamState",
      "StartRequestTraceFiberStatus",
      "StartRequestTraceHeader",
      "StartRequestTraceCookie",
      "StartRequestTraceRequest",
      "StartRequestTraceResponse",
      "StartRequestTraceResource",
      "StartRequestTraceCollection",
      "StartRequestTraceServerFunction",
      "StartRequestTraceAction",
      "StartRequestTraceFiber",
      "StartRequestTraceStream",
      "StartRequestTraceTeardownSnapshot",
      "StartRequestTraceCleanupFailure",
      "StartRequestTraceTeardown",
      "StartRequestTrace",
      "StartRequestTraceRoutePlan",
      "StartRequestTraceHandler",
      "startRequestCountMetric",
      "startRequestDurationMetric",
      "startRequestStatusMetric"
    ]
  },
  {
    file: "packages/start/src/fetch-adapter.ts",
    allDeclarations: [
      "toFetchHandlerEffect",
      "toFetchHandler",
      "createFetchHandler"
    ]
  },
  {
    file: "packages/start/src/node-adapter.ts",
    allDeclarations: [
      "createNodeHandlerEffect",
      "createNodeHandler",
      "createNodeServerHandler"
    ]
  }
];

const hasJsDoc = (node) =>
  ts.getJSDocCommentsAndTags(node).some((entry) =>
    entry.kind === ts.SyntaxKind.JSDocComment
  );

const declarationName = (node) => {
  if (
    (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isModuleDeclaration(node)
    ) &&
    node.name
  ) {
    return node.name.text;
  }

  return undefined;
};

const variableStatementDeclarationNames = (statement) =>
  ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
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
    if (declarationName(statement) === name || variableStatementDeclarationNames(statement).includes(name)) {
      declarations.push(statement);
    }
  }
  return declarations;
};

const namespaceStatements = (sourceFile, namespaceName) => {
  const namespace = sourceFile.statements.find((statement) =>
    ts.isModuleDeclaration(statement) &&
    ts.isIdentifier(statement.name) &&
    statement.name.text === namespaceName &&
    statement.body !== undefined &&
    ts.isModuleBlock(statement.body)
  );
  return namespace?.body && ts.isModuleBlock(namespace.body)
    ? namespace.body.statements
    : undefined;
};

const auditPublicHoverDocs = () => {
  for (const group of publicHoverDocs) {
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
      ts.ScriptKind.TS
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
          failures.push(`${group.file} public hover declaration ${name}#${index + 1} is missing JSDoc`);
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
          failures.push(`${group.file} namespace ${namespaceName} is missing public hover declaration ${name}`);
        } else if (!hasJsDoc(declaration)) {
          failures.push(`${group.file} namespace ${namespaceName}.${name} is missing JSDoc`);
        }
      }
    }
  }
};

const inventoryRows = new Set();
for (const line of inventory.split(/\r?\n/)) {
  const match = line.match(/^\| `([^`]+)` \| `([^`]+)`([^|]*) \| `([^`]+)` \| ([^|]+) \|/);
  if (match === null) {
    continue;
  }

  const exportLabel = `${match[2]}${match[3].includes("bin") ? " bin" : ""}`;
  inventoryRows.add(`${match[1]}\0${exportLabel}`);
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
  sourceFile.statements.filter((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === specifier
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

const nonImportIdentifierNames = (sourceFile) => {
  const names = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      names.add(node.text);
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
    ts.ScriptKind.TS
  );
  const imports = importDeclarationsFor(sourceFile, entry.import);
  if (imports.length === 0) {
    failures.push(`${entry.package} export ${entry.export} type test ${entry.typeTest} does not import ${entry.import}`);
    return;
  }

  const importedNames = imports.flatMap(importedBindingNames);
  if (importedNames.length === 0 && !Array.isArray(entry.typeTestReferences)) {
    failures.push(`${entry.package} export ${entry.export} type test ${entry.typeTest} is side-effect-only and must declare typeTestReferences in the manifest`);
  }

  const usedIdentifiers = nonImportIdentifierNames(sourceFile);
  for (const name of importedNames) {
    if (!usedIdentifiers.has(name)) {
      failures.push(`${entry.package} export ${entry.export} type test ${entry.typeTest} imports ${name} but does not exercise it outside the import declaration`);
    }
  }

  for (const reference of entry.typeTestReferences ?? []) {
    if (typeof reference !== "string" || reference.length === 0) {
      failures.push(`${entry.package} export ${entry.export} typeTestReferences entries must be non-empty strings`);
    } else if (!typeTest.includes(reference)) {
      failures.push(`${entry.package} export ${entry.export} type test ${entry.typeTest} is missing required reference ${reference}`);
    }
  }
};

for (const entry of publicApiManifest.entrypoints ?? []) {
  const key = `${entry.package}\0${entry.export}`;
  if (expectedEntrypoints.has(key)) {
    failures.push(`type-tests/public-api.manifest.json duplicates ${entry.package} export ${entry.export}`);
    continue;
  }

  expectedEntrypoints.set(key, entry);
  const expectedImport = importSpecifierFor(entry.package, entry.export);
  if (entry.import !== expectedImport) {
    failures.push(`${entry.package} export ${entry.export} manifest import must be ${expectedImport}`);
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
    failures.push(`type-tests/public-api.manifest.json duplicates ${entry.package} bin ${entry.bin}`);
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
      failures.push(`${packageName} export ${exportPath} is missing from docs/public-api-inventory.md Package Export Map`);
    }
    if (!expectedEntrypoints.has(key)) {
      failures.push(`${packageName} export ${exportPath} is missing from type-tests/public-api.manifest.json`);
    }
  }

  for (const binName of Object.keys(packageManifest.bin ?? {})) {
    const key = `${packageName}\0${binName} bin`;
    if (!inventoryRows.has(key)) {
      failures.push(`${packageName} bin ${binName} is missing from docs/public-api-inventory.md Package Export Map`);
    }
    if (!expectedBins.has(`${packageName}\0${binName}`)) {
      failures.push(`${packageName} bin ${binName} is missing from type-tests/public-api.manifest.json`);
    }
  }
}

for (const [key, entry] of expectedEntrypoints) {
  const [packageName, exportPath] = key.split("\0");
  const packageDirectory = packageDirectories.find((directory) =>
    readJson(join(directory, "package.json")).name === packageName
  );
  if (!packageDirectory) {
    failures.push(`${entry.package} export ${entry.export} in type-tests/public-api.manifest.json has no workspace package`);
    continue;
  }

  const packageManifest = readJson(join(packageDirectory, "package.json"));
  if (!(exportPath in (packageManifest.exports ?? {}))) {
    failures.push(`${entry.package} export ${entry.export} in type-tests/public-api.manifest.json is not a package export`);
  }
}

for (const [key, entry] of expectedBins) {
  const [packageName, binName] = key.split("\0");
  const packageDirectory = packageDirectories.find((directory) =>
    readJson(join(directory, "package.json")).name === packageName
  );
  if (!packageDirectory) {
    failures.push(`${entry.package} bin ${entry.bin} in type-tests/public-api.manifest.json has no workspace package`);
    continue;
  }

  const packageManifest = readJson(join(packageDirectory, "package.json"));
  if (!(binName in (packageManifest.bin ?? {}))) {
    failures.push(`${entry.package} bin ${entry.bin} in type-tests/public-api.manifest.json is not a package bin`);
  }
}

const sectionForPackage = (packageName) => {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^### \`${escaped}\`\\n([\\s\\S]*?)(?=^### \`|^## |(?![\\s\\S]))`, "m");
  return inventory.match(pattern)?.[1] ?? "";
};

const exportedModules = (entrypoint) => {
  const source = readText(entrypoint);
  const modules = [];
  for (const match of source.matchAll(/export\s+(?:type\s+)?(?:\*\s+|\{[\s\S]*?\}\s+)from\s+"\.\/([^"]+)\.js";/g)) {
    modules.push(match[1]);
  }
  return [...new Set(modules)].sort();
};

const localDependencyModules = (entrypoint) => {
  const source = readText(entrypoint);
  const modules = [];
  for (const match of source.matchAll(/from\s+"\.\/([^"]+)\.js";/g)) {
    modules.push(match[1]);
  }
  return [...new Set(modules)].sort();
};

const backtickNames = (source) =>
  [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const namespaceBackedSurfaceModules = new Map([
  ["@effect-ui/db", new Set(["sync-adapter"])]
]);

const documentedSourceSurface = (packageSection) => {
  const directModules = [];
  const namespaceModules = [];
  const coreRootExports = packageSection.match(
    /The root export (?:star-exports|re-exports) these (?:local )?modules:\n\n([\s\S]*?)(?=\n\n)/
  );
  const localSourceModules = packageSection.match(
    /- Local source modules: ([\s\S]*?)(?=\n- |\n\n)/
  );
  const namespaceSourceModules = packageSection.match(
    /- Namespace-backed source modules: ([\s\S]*?)(?=\n- |\n\n)/
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
    namespaceModules: [...new Set(namespaceModules)].sort()
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
      failures.push(`${packageName} root export ${moduleName} is not classified in its Source Surface section`);
    }
  }

  const rootExportedModuleSet = new Set(rootExportedModules);
  for (const moduleName of documentedSurface.directModules) {
    if (!rootExportedModuleSet.has(moduleName)) {
      failures.push(`${packageName} Source Surface lists ${moduleName}, but ${basename(entry.source)} does not re-export it`);
    }
  }

  const allowedNamespaceModules = namespaceBackedSurfaceModules.get(packageName) ?? new Set();
  const localDependencyModuleSet = new Set(localDependencyModules(join(root, entry.source)));
  for (const moduleName of documentedSurface.namespaceModules) {
    if (!allowedNamespaceModules.has(moduleName)) {
      failures.push(`${packageName} Source Surface lists ${moduleName} as namespace-backed without an audit allowance`);
    } else if (!localDependencyModuleSet.has(moduleName)) {
      failures.push(`${packageName} Source Surface lists ${moduleName} as namespace-backed, but ${basename(entry.source)} does not import it`);
    }
  }
}

auditPublicHoverDocs();

if (failures.length > 0) {
  console.error("Public API inventory audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Public API inventory audit passed.");
