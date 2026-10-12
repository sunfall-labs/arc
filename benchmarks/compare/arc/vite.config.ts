import { sunfallArcStart } from "@sunfall/arc-start/vite";
import { sunfallArcTsrx } from "@sunfall/arc-tsrx";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    ...sunfallArcTsrx({ solid: { ssr: true } }),
    sunfallArcStart({
      serverEntry: "/src/server.tsx",
      fileRouteOptions: { routeDirectory: "src/routes" },
      fileRouteGeneration: { outputFile: "src/routeTree.gen.ts" },
    }),
  ],
  build: isSsrBuild
    ? {}
    : {
        outDir: "dist/client",
        manifest: true,
        rollupOptions: { input: "src/main.tsx" },
      },
}));
