import { solidStart } from "@solidjs/start/config";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// The official SolidStart 2 template's config: SolidStart plus Nitro, whose
// default preset builds a Node server at `.output/server/index.mjs`.
export default defineConfig({
  plugins: [solidStart(), nitro()],
});
