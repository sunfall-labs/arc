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
    file: "packages/start/src/agent-graph.ts",
    declarations: [
      "createStartAgentGraph",
      "createStartAgentGraphEffect"
    ]
  },
  {
    file: "packages/start/src/start-vite-diagnostics-loader.ts",
    declarations: [
      "StartAppGraphDiagnosticsLoadError"
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
    if (!typeTest.includes(`"${entry.import}"`) && !typeTest.includes(`'${entry.import}'`)) {
      failures.push(`${entry.package} export ${entry.export} type test ${entry.typeTest} does not import ${entry.import}`);
    }
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

  for (const moduleName of rootExportedModules) {
    if (!packageSection.includes(`\`${moduleName}\``)) {
      failures.push(`${packageName} root export ${moduleName} is not classified in its Source Surface section`);
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
