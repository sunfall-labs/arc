import { sunfallArcStart } from "@sunfall/arc-start/vite";
import { sunfallArcTsrx } from "@sunfall/arc-tsrx";
import { defineConfig } from "vite";
import { projectConsoleStartOptions } from "./src/start-options.js";

const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [...sunfallArcTsrx({ solid: { ssr: true } }), sunfallArcStart(projectConsoleStartOptions)],
  resolve: {
    alias: [
      { find: "@sunfall/arc-core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@sunfall/arc-db", replacement: fromRoot("packages/db/src/index.ts") },
      { find: "@sunfall/arc-solid", replacement: fromRoot("packages/solid/src/index.ts") },
      { find: "@sunfall/arc-solid-db", replacement: fromRoot("packages/solid-db/src/index.ts") },
      { find: "@sunfall/arc-start/vite", replacement: fromRoot("packages/start/src/vite.ts") },
      { find: "@sunfall/arc-start", replacement: fromRoot("packages/start/src/index.ts") },
      { find: "@sunfall/arc-tsrx", replacement: fromRoot("packages/tsrx/src/index.ts") },
    ],
  },
});
