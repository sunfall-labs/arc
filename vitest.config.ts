import { createRequire } from "node:module";
import { configDefaults, defineConfig } from "vitest/config";
import { sunfallArcTsrx } from "./packages/tsrx/src/index.js";

// Node's resolver uses the package's "default" condition: the production build.
const solidSignalsProductionEntry = createRequire(
  new URL("./packages/core/package.json", import.meta.url),
).resolve("@solidjs/signals");

const sharedAlias = {
  "@sunfall/arc-core/internal": new URL("./packages/core/src/internal.ts", import.meta.url)
    .pathname,
  "@sunfall/arc-core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
  "@sunfall/arc-db/internal": new URL("./packages/db/src/internal.ts", import.meta.url).pathname,
  "@sunfall/arc-db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
  "@sunfall/arc-solid": new URL("./packages/solid/src/index.ts", import.meta.url).pathname,
  "@sunfall/arc-solid-db": new URL("./packages/solid-db/src/index.ts", import.meta.url).pathname,
  "@sunfall/arc-tsrx": new URL("./packages/tsrx/src/index.ts", import.meta.url).pathname,
  "@sunfall/arc-start/fetch": new URL("./packages/start/src/fetch.ts", import.meta.url).pathname,
  "@sunfall/arc-start/node": new URL("./packages/start/src/node.ts", import.meta.url).pathname,
  "@sunfall/arc-start/internal": new URL("./packages/start/src/internal.ts", import.meta.url)
    .pathname,
  "@sunfall/arc-start/testing": new URL("./packages/start/src/testing.ts", import.meta.url)
    .pathname,
  "@sunfall/arc-start": new URL("./packages/start/src/index.ts", import.meta.url).pathname,
  "@sunfall/arc-devtools": new URL("./packages/devtools/src/index.ts", import.meta.url).pathname,
};

// Solid adapter tests exercise client reactivity, so they run Solid's browser build.
const solidClientTestIncludes = ["packages/solid/**/*.test.ts", "packages/solid-db/**/*.test.ts"];
// Solid adapter `*.server.test.ts` files render with Solid's server build (solid-core).
const solidServerTestIncludes = [
  "packages/solid/**/*.server.test.ts",
  "packages/solid-db/**/*.server.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: sunfallArcTsrx(),
        resolve: {
          alias: sharedAlias,
          conditions: ["browser", "development"],
        },
        test: {
          name: "solid-client",
          environment: "happy-dom",
          include: solidClientTestIncludes,
          exclude: [...configDefaults.exclude, ...solidServerTestIncludes],
          benchmark: {
            include: [],
          },
          globals: true,
        },
      },
      {
        // Client render benchmarks use Solid's production browser build.
        // `@solidjs/signals` maps Vitest's "test" condition to its dev build,
        // so pin its production entry explicitly.
        plugins: sunfallArcTsrx({ solid: { dev: false } }),
        resolve: {
          alias: {
            ...sharedAlias,
            "@solidjs/signals": solidSignalsProductionEntry,
          },
          conditions: ["browser"],
        },
        test: {
          name: "solid-client-bench",
          environment: "happy-dom",
          // Resolve every Solid package through Vite so Arc and Solid share one
          // reactive graph (the production build) instead of Node-resolved copies.
          server: {
            deps: {
              inline: [/solid-js/, /@solidjs\//],
            },
          },
          include: [],
          passWithNoTests: true,
          benchmark: {
            include: ["benchmarks/**/*.client.bench.ts"],
          },
          globals: true,
        },
      },
      {
        plugins: sunfallArcTsrx({ solid: { ssr: true } }),
        resolve: {
          alias: sharedAlias,
        },
        test: {
          name: "solid-core",
          include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
          exclude: [
            ...configDefaults.exclude,
            "packages/solid/**/!(*.server).test.ts",
            "packages/solid-db/**/!(*.server).test.ts",
          ],
          benchmark: {
            include: ["benchmarks/**/*.bench.ts"],
            exclude: ["benchmarks/**/*.client.bench.ts"],
          },
          globals: true,
        },
      },
    ],
  },
});
