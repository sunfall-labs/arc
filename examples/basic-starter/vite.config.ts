import { effectUiStart } from "@effect-ui/start/vite";
import { effectUiTsrx } from "@effect-ui/tsrx";
import { defineConfig } from "vite";
import { starterStartOptions } from "./src/start-options.js";

const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [...effectUiTsrx({ solid: { ssr: true } }), effectUiStart(starterStartOptions)],
  resolve: {
    alias: [
      { find: "@effect-ui/core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@effect-ui/solid", replacement: fromRoot("packages/solid/src/index.ts") },
      { find: "@effect-ui/start/vite", replacement: fromRoot("packages/start/src/vite.ts") },
      { find: "@effect-ui/start", replacement: fromRoot("packages/start/src/index.ts") },
      { find: "@effect-ui/tsrx", replacement: fromRoot("packages/tsrx/src/index.ts") },
    ],
  },
});
