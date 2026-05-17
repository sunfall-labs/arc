#!/usr/bin/env node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Data, Effect } from "effect";
import { validateDistPackagePayloadEffect } from "./package-payload-policy.mjs";

class PackagePayloadPolicySelfTestError extends Data.TaggedError("PackagePayloadPolicySelfTestError") {}

const fail = (message, cause) =>
  new PackagePayloadPolicySelfTestError({ message, cause });

const assert = (condition, message, cause) =>
  condition ? Effect.void : Effect.fail(fail(message, cause));

const fsEffect = (description, evaluate) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => fail(`Failed to ${description}.`, cause),
  });

const writeTextEffect = (root, file, text) =>
  Effect.gen(function* () {
    const target = join(root, file);
    yield* fsEffect(`create ${dirname(file)}`, () => mkdir(dirname(target), { recursive: true }));
    yield* fsEffect(`write ${file}`, () => writeFile(target, text));
  });

const basePackageJson = {
  name: "@effect-ui/payload-policy-self-test",
  private: true,
  license: "UNLICENSED",
  description: "Package payload policy self-test.",
  files: ["dist"],
  sideEffects: false,
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": {
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    },
    "./feature": {
      import: "./dist/feature.js",
      types: "./dist/feature.d.ts",
    },
    "./virtual": {
      types: "./dist/virtual.d.ts",
    },
  },
};

const baseFiles = [
  "package.json",
  "dist/feature.d.ts",
  "dist/feature.d.ts.map",
  "dist/feature.js",
  "dist/feature.js.map",
  "dist/index.d.ts",
  "dist/index.d.ts.map",
  "dist/index.js",
  "dist/index.js.map",
  "dist/virtual.d.ts",
  "dist/virtual.js",
  "dist/virtual.js.map",
];

const makeTarget = (directory, packageJson = basePackageJson) => ({
  label: "@effect-ui/payload-policy-self-test",
  payload: "dist-package",
  directory,
  packageJson,
  declarationArtifacts: [
    {
      source: "src/virtual-modules.d.ts",
      output: "dist/virtual.d.ts",
      forbidden: ["dist/virtual.d.ts.map"],
    },
  ],
});

const populatePackageEffect = (directory, options = {}) =>
  Effect.gen(function* () {
    const virtualDeclaration = "export interface VirtualModule { readonly id: string; }\n";
    yield* writeTextEffect(directory, "src/index.ts", "export const index = 'index';\n");
    yield* writeTextEffect(directory, "src/feature.ts", "export const feature = 'feature';\n");
    yield* writeTextEffect(directory, "src/virtual.ts", "export const virtual = 'virtual';\n");
    yield* writeTextEffect(directory, "src/virtual-modules.d.ts", virtualDeclaration);
    yield* writeTextEffect(directory, "dist/index.js", "export const index = 'index';\n");
    yield* writeTextEffect(directory, "dist/index.js.map", "{}\n");
    yield* writeTextEffect(directory, "dist/index.d.ts", "export declare const index = 'index';\n");
    yield* writeTextEffect(directory, "dist/index.d.ts.map", "{}\n");
    yield* writeTextEffect(directory, "dist/feature.js", "export const feature = 'feature';\n");
    yield* writeTextEffect(directory, "dist/feature.js.map", "{}\n");
    yield* writeTextEffect(directory, "dist/feature.d.ts", "export declare const feature = 'feature';\n");
    yield* writeTextEffect(directory, "dist/feature.d.ts.map", "{}\n");
    yield* writeTextEffect(directory, "dist/virtual.js", "export const virtual = 'virtual';\n");
    yield* writeTextEffect(directory, "dist/virtual.js.map", "{}\n");
    yield* writeTextEffect(
      directory,
      "dist/virtual.d.ts",
      options.virtualDeclarationText ?? virtualDeclaration,
    );
    if (options.writeForbiddenDeclarationMap === true) {
      yield* writeTextEffect(directory, "dist/virtual.d.ts.map", "{}\n");
    }
  });

const withTempPackageEffect = (name, options, use) =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* fsEffect(`create temp package for ${name}`, () =>
        mkdtemp(join(tmpdir(), "effect-ui-payload-policy-"))
      );
      yield* Effect.addFinalizer(() =>
        fsEffect(`remove temp package for ${name}`, () =>
          rm(directory, { recursive: true, force: true })
        ).pipe(Effect.catch(() => Effect.void))
      );
      yield* populatePackageEffect(directory, options);
      return yield* use(directory);
    })
  );

const expectFailuresEffect = (name, effect, expectedFragments) =>
  Effect.gen(function* () {
    const failures = yield* effect;
    if (failures.length !== expectedFragments.length) {
      return yield* Effect.fail(fail(
        `${name} expected ${expectedFragments.length} failures but found ${failures.length}: ${failures.join(" ")}`,
      ));
    }
    for (const expectedFragment of expectedFragments) {
      yield* assert(
        failures.some((failure) => failure.includes(expectedFragment)),
        `${name} did not find expected failure fragment ${expectedFragment}: ${failures.join(" ")}`,
        failures,
      );
    }
  });

const validateEffect = (directory, options = {}) =>
  validateDistPackagePayloadEffect({
    target: makeTarget(directory, options.packageJson),
    files: options.files ?? baseFiles,
    workspaceRoot: directory,
    payloadLabel: options.payloadLabel,
  });

const selfTest = Effect.gen(function* () {
  yield* withTempPackageEffect("valid dist package", {}, (directory) =>
    expectFailuresEffect("valid dist package", validateEffect(directory), [])
  );
  yield* withTempPackageEffect("stale dist artifact", {}, (directory) =>
    expectFailuresEffect(
      "stale dist artifact",
      validateEffect(directory, {
        files: [...baseFiles, "dist/stale.js"],
      }),
      ["stale dist artifacts"],
    )
  );
  yield* withTempPackageEffect("missing dist artifact", {}, (directory) =>
    expectFailuresEffect(
      "missing dist artifact",
      validateEffect(directory, {
        files: baseFiles.filter((file) => file !== "dist/feature.js.map"),
      }),
      ["dist/feature.js.map"],
    )
  );
  yield* withTempPackageEffect("declaration content drift", {
    virtualDeclarationText: "export interface VirtualModule { readonly drift: string; }\n",
  }, (directory) =>
    expectFailuresEffect(
      "declaration content drift",
      validateEffect(directory),
      ["does not match src/virtual-modules.d.ts"],
    )
  );
  yield* withTempPackageEffect("forbidden declaration map", {
    writeForbiddenDeclarationMap: true,
  }, (directory) =>
    expectFailuresEffect(
      "forbidden declaration map",
      validateEffect(directory, {
        files: [...baseFiles, "dist/virtual.d.ts.map"],
      }),
      ["forbidden copied declaration artifact dist/virtual.d.ts.map"],
    )
  );
  yield* withTempPackageEffect("manifest target drift", {}, (directory) =>
    expectFailuresEffect(
      "manifest target drift",
      validateEffect(directory, {
        packageJson: {
          ...basePackageJson,
          exports: {
            ...basePackageJson.exports,
            "./missing": "./dist/missing.js",
          },
        },
        payloadLabel: "generated local @effect-ui/payload-policy-self-test package",
      }),
      ["generated local @effect-ui/payload-policy-self-test package manifest field exports../missing points at missing payload file dist/missing.js"],
    )
  );
  yield* Effect.sync(() => {
    console.log("Verified package payload policy.");
  });
});

await Effect.runPromise(
  selfTest.pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        console.error(cause);
        process.exitCode = 1;
      })
    )
  )
);
