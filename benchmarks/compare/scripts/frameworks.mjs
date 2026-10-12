// The three apps under test: where they live, how their production server
// starts, and which installed packages define their version.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const compareRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const frameworks = [
  {
    id: "arc",
    label: "Arc",
    cwd: join(compareRoot, "arc"),
    start: ["server.mjs"],
    packages: ["@sunfall/arc-start", "@sunfall/arc-core", "solid-js", "effect", "vite"],
  },
  {
    id: "solid-start",
    label: "SolidStart",
    cwd: join(compareRoot, "solid-start"),
    start: [".output/server/index.mjs"],
    packages: ["@solidjs/start", "@solidjs/router", "solid-js", "nitro", "vite"],
  },
  {
    id: "tanstack-start",
    label: "TanStack Start",
    cwd: join(compareRoot, "tanstack-start"),
    start: [".output/server/index.mjs"],
    packages: [
      "@tanstack/react-start",
      "@tanstack/react-router",
      "@tanstack/react-query",
      "react",
      "nitro",
      "vite",
    ],
  },
];

export const installedVersions = (framework) =>
  Object.fromEntries(
    framework.packages.map((name) => {
      try {
        const manifest = JSON.parse(
          readFileSync(join(framework.cwd, "node_modules", name, "package.json"), "utf8"),
        );
        return [name, manifest.version];
      } catch {
        return [name, "not installed"];
      }
    }),
  );
