import { defineConfig } from "vite";

const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: [
      { find: "@effect-ui/core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@effect-ui/devtools", replacement: fromRoot("packages/devtools/src/index.ts") },
    ],
  },
});
