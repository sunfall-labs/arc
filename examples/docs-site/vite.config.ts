import tailwindcss from "@tailwindcss/vite";
import { sunfallArcTsrx } from "@sunfall/arc-tsrx";
import { defineConfig } from "vite";
import { sunfallArcStart } from "@sunfall/arc-start/vite";
import { docsSiteStartOptions } from "./src/start-options.js";

const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [
    ...sunfallArcTsrx({ solid: { ssr: true } }),
    tailwindcss(),
    sunfallArcStart(docsSiteStartOptions),
  ],
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "syntax-highlighting",
              test: /node_modules\/(?:\.pnpm\/)?(?:@shikijs|shiki)/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: [
      { find: "@sunfall/arc-core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@sunfall/arc-solid", replacement: fromRoot("packages/solid/src/index.ts") },
      { find: "@sunfall/arc-start/vite", replacement: fromRoot("packages/start/src/vite.ts") },
      { find: "@sunfall/arc-start", replacement: fromRoot("packages/start/src/index.ts") },
      { find: "@sunfall/arc-tsrx", replacement: fromRoot("packages/tsrx/src/index.ts") },
    ],
  },
});
