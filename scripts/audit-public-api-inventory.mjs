import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const packagesDirectory = join(root, "packages");
const inventoryFile = join(root, "docs/public-api-inventory.md");
const publicApiManifestFile = join(root, "type-tests/public-api.manifest.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const readText = (file) => readFileSync(file, "utf8");

const inventory = readText(inventoryFile);
const publicApiManifest = readJson(publicApiManifestFile);
const failures = [];

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

if (failures.length > 0) {
  console.error("Public API inventory audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Public API inventory audit passed.");
