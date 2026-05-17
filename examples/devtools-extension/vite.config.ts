import { defineConfig } from "vite";

const fromHere = (path: string): string => new URL(path, import.meta.url).pathname;
const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        devtools: fromHere("devtools.html"),
        panel: fromHere("panel.html"),
      },
    },
  },
  resolve: {
    alias: [
      { find: "@sunfall/arc-core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@sunfall/arc-devtools", replacement: fromRoot("packages/devtools/src/index.ts") },
    ],
  },
});
