#!/usr/bin/env node

import { readFile, readdir } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

class LeakScanError extends Data.TaggedError("LeakScanError") {}

const fail = (message, repair, cause) => new LeakScanError({ message, repair, cause });

const fsEffect = (description, register) =>
  Effect.callback((resume) => {
    register((cause, value) => {
      if (cause) {
        resume(
          Effect.fail(
            fail(`Failed to ${description}.`, "Run the docs-site build before leak-scan.", cause),
          ),
        );
        return;
      }
      resume(Effect.succeed(value));
    });
  });

const readTextEffect = (filePath) =>
  fsEffect(`read ${relative(process.cwd(), filePath)}`, (resume) =>
    readFile(filePath, "utf8", resume),
  );

const readDirEffect = (directory) =>
  fsEffect(`read ${relative(process.cwd(), directory)}`, (resume) =>
    readdir(directory, { withFileTypes: true }, resume),
  );

const toPosixPath = (filePath) => filePath.split(sep).join("/");

const collectFiles = (root) =>
  Effect.gen(function* () {
    const files = [];
    const visit = (directory) =>
      Effect.gen(function* () {
        const entries = yield* readDirEffect(directory);
        for (const entry of entries) {
          const fullPath = resolve(directory, entry.name);
          if (entry.isDirectory()) {
            yield* visit(fullPath);
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      });

    yield* visit(root);
    return files.sort((left, right) => left.localeCompare(right));
  });

const readConfig = Effect.gen(function* () {
  const packageJsonPath = resolve(process.cwd(), "package.json");
  const packageJsonText = yield* readTextEffect(packageJsonPath);
  const packageJson = yield* Effect.try({
    try: () => JSON.parse(packageJsonText),
    catch: (cause) => fail("Failed to parse package.json.", "Keep package.json valid JSON.", cause),
  });
  const config = packageJson.sunfallArcLeakScan;
  if (!config || !Array.isArray(config.patterns)) {
    return yield* Effect.fail(
      fail(
        "Missing sunfallArcLeakScan.patterns in package.json.",
        "Declare the server-only text patterns this example must keep out of dist.",
      ),
    );
  }
  return {
    dist: resolve(process.cwd(), typeof config.dist === "string" ? config.dist : "dist"),
    patterns: config.patterns.map((pattern) => new RegExp(pattern)),
  };
});

const program = Effect.gen(function* () {
  const config = yield* readConfig;
  const files = yield* collectFiles(config.dist);
  const leaks = [];
  for (const file of files) {
    const text = yield* readTextEffect(file);
    for (const pattern of config.patterns) {
      if (pattern.test(text)) {
        leaks.push(`${toPosixPath(relative(process.cwd(), file))} matched ${pattern}`);
      }
    }
  }

  if (leaks.length > 0) {
    return yield* Effect.fail(
      fail(
        "Server-only docs implementation details leaked into the docs-site build.",
        leaks.join("\n"),
      ),
    );
  }
});

runScriptMainEffect(
  program.pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        console.error(cause);
        process.exitCode = 1;
      }),
    ),
  ),
);
