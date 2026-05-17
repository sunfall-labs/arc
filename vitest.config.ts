import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { effectUiTsrx } from "./packages/tsrx/src/index.js";

const sharedAlias = {
  "@effect-ui/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
  "@effect-ui/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
  "@effect-ui/react": new URL("./packages/react/src/index.ts", import.meta.url).pathname,
  "@effect-ui/react-db": new URL("./packages/react-db/src/index.ts", import.meta.url).pathname,
  "@effect-ui/solid": new URL("./packages/solid/src/index.ts", import.meta.url).pathname,
  "@effect-ui/solid-db": new URL("./packages/solid-db/src/index.ts", import.meta.url).pathname,
  "@effect-ui/tsrx": new URL("./packages/tsrx/src/index.ts", import.meta.url).pathname,
  "@effect-ui/start/adapters": new URL("./packages/start/src/adapters.ts", import.meta.url)
    .pathname,
  "@effect-ui/start/fetch-adapter": new URL(
    "./packages/start/src/fetch-adapter.ts",
    import.meta.url,
  ).pathname,
  "@effect-ui/start/node-adapter": new URL("./packages/start/src/node-adapter.ts", import.meta.url)
    .pathname,
  "@effect-ui/start": new URL("./packages/start/src/index.ts", import.meta.url).pathname,
  "@effect-ui/start-fetch": new URL("./packages/start-fetch/src/index.ts", import.meta.url)
    .pathname,
  "@effect-ui/start-node": new URL("./packages/start-node/src/index.ts", import.meta.url).pathname,
  "@effect-ui/devtools": new URL("./packages/devtools/src/index.ts", import.meta.url).pathname,
};

const reactTestIncludes = [
  "packages/react/**/*.test.ts",
  "packages/react-db/**/*.test.ts",
  "examples/react-starter/**/*.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            ...sharedAlias,
            "@": new URL("./examples/react-starter/src", import.meta.url).pathname,
          },
        },
        test: {
          name: "react",
          include: reactTestIncludes,
          globals: true,
        },
      },
      {
        plugins: effectUiTsrx({ solid: { ssr: true } }),
        resolve: {
          alias: sharedAlias,
        },
        test: {
          name: "solid-core",
          include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...reactTestIncludes],
          globals: true,
        },
      },
    ],
  },
});
