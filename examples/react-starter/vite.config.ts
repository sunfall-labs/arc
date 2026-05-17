import tailwindcss from "@tailwindcss/vite";
import { effectUiStart } from "@effect-ui/start/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { reactStarterStartOptions } from "./src/start-options.js";

const fromRoot = (path: string): string => new URL(`../../${path}`, import.meta.url).pathname;
const fromStarter = (path: string): string => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [react(), tailwindcss(), effectUiStart(reactStarterStartOptions)],
  resolve: {
    alias: [
      { find: "@", replacement: fromStarter("src") },
      { find: "@effect-ui/core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@effect-ui/react", replacement: fromRoot("packages/react/src/index.ts") },
      { find: "@effect-ui/start/vite", replacement: fromRoot("packages/start/src/vite.ts") },
      { find: "@effect-ui/start", replacement: fromRoot("packages/start/src/index.ts") },
    ],
  },
});
