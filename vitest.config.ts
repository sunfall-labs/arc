import { defineConfig } from "vitest/config";
import { effectUiTsrx } from "./packages/tsrx/src/index.js";

export default defineConfig({
  plugins: effectUiTsrx({ solid: { ssr: true } }),
  test: {
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
    globals: true
  },
  resolve: {
    alias: {
      "@effect-ui/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@effect-ui/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
      "@effect-ui/solid": new URL("./packages/solid/src/index.ts", import.meta.url).pathname,
      "@effect-ui/solid-db": new URL("./packages/solid-db/src/index.ts", import.meta.url).pathname,
      "@effect-ui/tsrx": new URL("./packages/tsrx/src/index.ts", import.meta.url).pathname,
      "@effect-ui/start/adapters": new URL("./packages/start/src/adapters.ts", import.meta.url).pathname,
      "@effect-ui/start": new URL("./packages/start/src/index.ts", import.meta.url).pathname,
      "@effect-ui/start-fetch": new URL("./packages/start-fetch/src/index.ts", import.meta.url).pathname,
      "@effect-ui/start-node": new URL("./packages/start-node/src/index.ts", import.meta.url).pathname,
      "@effect-ui/devtools": new URL("./packages/devtools/src/index.ts", import.meta.url).pathname
    }
  }
});
