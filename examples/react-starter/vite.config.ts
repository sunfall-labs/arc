import tailwindcss from "@tailwindcss/vite";
import { sunfallArcStart } from "@sunfall/arc-start/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { reactStarterStartOptions } from "./src/start-options.js";

const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;
const fromStarter = (path: string): string => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [react(), tailwindcss(), sunfallArcStart(reactStarterStartOptions)],
  resolve: {
    alias: [
      { find: "@", replacement: fromStarter("src") },
      { find: "@sunfall/arc-core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@sunfall/arc-react", replacement: fromRoot("packages/react/src/index.ts") },
      { find: "@sunfall/arc-start/vite", replacement: fromRoot("packages/start/src/vite.ts") },
      { find: "@sunfall/arc-start", replacement: fromRoot("packages/start/src/index.ts") },
    ],
  },
});
