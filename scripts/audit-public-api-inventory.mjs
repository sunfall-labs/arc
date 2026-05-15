import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const packagesDirectory = join(root, "packages");
const inventoryFile = join(root, "docs/public-api-inventory.md");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const readText = (file) => readFileSync(file, "utf8");

const inventory = readText(inventoryFile);
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
  }

  for (const binName of Object.keys(packageManifest.bin ?? {})) {
    const key = `${packageName}\0${binName} bin`;
    if (!inventoryRows.has(key)) {
      failures.push(`${packageName} bin ${binName} is missing from docs/public-api-inventory.md Package Export Map`);
    }
  }
}

const sectionForPackage = (packageName) => {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^### \`${escaped}\`\\n([\\s\\S]*?)(?=^### \`|^## |\\z)`, "m");
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

const coreSection = sectionForPackage("@effect-ui/core");
if (coreSection.length === 0) {
  failures.push("@effect-ui/core section is missing from docs/public-api-inventory.md");
} else {
  for (const moduleName of exportedModules(join(root, "packages/core/src/index.ts"))) {
    if (!coreSection.includes(`\`${moduleName}\``)) {
      failures.push(`@effect-ui/core root export ${moduleName} is not classified in its Source Surface section`);
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
