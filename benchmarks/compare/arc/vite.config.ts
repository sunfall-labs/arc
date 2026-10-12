import { sunfallArcStart } from "@sunfall/arc-start/vite";
import { sunfallArcTsrx } from "@sunfall/arc-tsrx";
import { defineConfig } from "vite";

// `vite build` builds the client into dist/client and the production server
// into dist/server (`node dist/server/index.js`).
export default defineConfig({
  plugins: [
    ...sunfallArcTsrx({ solid: { ssr: true } }),
    sunfallArcStart({
      serverEntry: "/src/server.tsx",
      fileRouteOptions: { routeDirectory: "src/routes" },
      fileRouteGeneration: { outputFile: "src/routeTree.gen.ts" },
    }),
  ],
});
