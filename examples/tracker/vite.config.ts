import { sunfallArcStart } from "../../packages/start/src/vite.js";
import { sunfallArcTsrx } from "../../packages/tsrx/src/index.js";
import { defineConfig } from "vite";
import { trackerStartOptions } from "./src/start-options.js";

// The Start and tsrx plugins load from source like the app's modules (an app
// outside this repository imports `@sunfall/arc-start/vite` and
// `@sunfall/arc-tsrx`), so a plugin change restarts the dev server without a
// package build.
const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [...sunfallArcTsrx({ solid: { ssr: true } }), sunfallArcStart(trackerStartOptions)],
  resolve: {
    alias: [
      {
        find: "@sunfall/arc-core/internal",
        replacement: fromRoot("packages/core/src/internal.ts"),
      },
      { find: "@sunfall/arc-core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@sunfall/arc-solid", replacement: fromRoot("packages/solid/src/index.ts") },
      { find: "@sunfall/arc-start/vite", replacement: fromRoot("packages/start/src/vite.ts") },
      { find: "@sunfall/arc-start/node", replacement: fromRoot("packages/start/src/node.ts") },
      {
        find: "@sunfall/arc-start/testing",
        replacement: fromRoot("packages/start/src/testing.ts"),
      },
      { find: "@sunfall/arc-start", replacement: fromRoot("packages/start/src/index.ts") },
      { find: "@sunfall/arc-tsrx", replacement: fromRoot("packages/tsrx/src/index.ts") },
    ],
  },
});
