import { defineConfig } from "vite";

const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: [
      { find: "@sunfall/arc-core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@sunfall/arc-devtools", replacement: fromRoot("packages/devtools/src/index.ts") },
    ],
  },
});
