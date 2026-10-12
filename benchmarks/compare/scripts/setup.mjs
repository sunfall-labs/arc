#!/usr/bin/env node
// Prepares the comparison: builds and packs the local Arc packages, installs
// each isolated project (its own lockfile, outside the monorepo workspace),
// and builds every app for production.
//
//   node benchmarks/compare/scripts/setup.mjs [--skip-arc-pack] [--only=arc,solid-start]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const compareRoot = resolve(here, "..");
const repoRoot = resolve(compareRoot, "../..");
const args = process.argv.slice(2);
const onlyArg = args.find((arg) => arg.startsWith("--only="));
const only = onlyArg === undefined ? undefined : onlyArg.slice("--only=".length).split(",");
const apps = ["arc", "solid-start", "tanstack-start"].filter(
  (app) => only === undefined || only.includes(app),
);

const run = (command, commandArgs, cwd) => {
  console.log(`$ (${cwd.replace(`${repoRoot}/`, "")}) ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, { cwd, stdio: "inherit" });
};

if (apps.includes("arc") && !args.includes("--skip-arc-pack")) {
  // Arc is consumed the way an app consumes it from npm: built dist, packed.
  run("pnpm", ["install", "--frozen-lockfile"], repoRoot);
  run("pnpm", ["build"], repoRoot);
  const vendor = join(compareRoot, "arc", "vendor");
  rmSync(vendor, { recursive: true, force: true });
  mkdirSync(vendor, { recursive: true });
  for (const name of ["core", "db", "solid", "start", "tsrx"]) {
    run("pnpm", ["pack", "--pack-destination", vendor], join(repoRoot, "packages", name));
  }
  // Stable file names, so the app's package.json and overrides never change.
  for (const file of readdirSync(vendor)) {
    const stable = file.replace(/-\d+\.\d+\.\d+.*\.tgz$/, ".tgz");
    renameSync(join(vendor, file), join(vendor, stable));
  }
}

for (const app of apps) {
  const cwd = join(compareRoot, app);
  // A repacked Arc tarball changes its integrity hash, so Arc's lockfile is
  // refreshed; the other apps install exactly what their lockfile pins.
  run("pnpm", ["install", app === "arc" ? "--no-frozen-lockfile" : "--frozen-lockfile"], cwd);
  run("pnpm", ["run", "build"], cwd);
}

run("pnpm", ["install", "--frozen-lockfile"], join(compareRoot, "scripts"));
run("pnpm", ["exec", "playwright", "install", "chromium"], join(compareRoot, "scripts"));
