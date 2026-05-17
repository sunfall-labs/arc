export const solidStarterTsConfig = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2022", "DOM"],
    strict: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    jsx: "preserve",
    jsxImportSource: "solid-js",
    noEmit: true,
    plugins: [{ name: "@tsrx/typescript-plugin" }],
    types: ["vite/client"],
  },
  include: ["src", "vite.config.ts"],
};

export const reactStarterTsConfig = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2022", "DOM"],
    strict: true,
    skipLibCheck: true,
    verbatimModuleSyntax: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    jsx: "react-jsx",
    noEmit: true,
    baseUrl: ".",
    paths: {
      "@/*": ["./src/*"],
    },
    types: ["vite/client"],
  },
  include: ["src", "vite.config.ts"],
};

export const solidStarterViteConfig = (
  startOptionsImport,
) => `import { sunfallArcStart } from "@sunfall/arc-start/vite";
import { sunfallArcTsrx } from "@sunfall/arc-tsrx";
import { defineConfig } from "vite";
import { ${startOptionsImport} } from "./src/start-options.js";

export default defineConfig({
  plugins: [
    ...sunfallArcTsrx({ solid: { ssr: true } }),
    sunfallArcStart(${startOptionsImport})
  ]
});
`;

export const reactStarterViteConfig = `import tailwindcss from "@tailwindcss/vite";
import { sunfallArcStart } from "@sunfall/arc-start/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { reactStarterStartOptions } from "./src/start-options.js";

const fromStarter = (path: string): string => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sunfallArcStart(reactStarterStartOptions)
  ],
  resolve: {
    alias: [
      { find: "@", replacement: fromStarter("src") }
    ]
  }
});
`;

export const basicStarterReadme = `# Sunfall Arc Basic Starter

This is the smallest checked starter path for a full-stack Sunfall Arc app. It
keeps the same shape as the project console without the local-first DB, actions,
or diagnostics demo data.

## Commands

\`\`\`sh
pnpm install
pnpm dev
pnpm verify
\`\`\`

The starter includes:

- Start SSR with an Effect-returning request handler;
- browser hydration through the synchronous \`hydrateFromDocument\` host facade,
  which runs \`hydrateFromDocumentEffect(...)\` before the UI mounts;
- a route-owned Resource preload declared in file route metadata;
- a production leak scan for server-only module sentinels.
`;

export const reactStarterReadme = `# Sunfall Arc React Starter

React + Vite starter for Sunfall Arc with Tailwind v4, Base UI, and a
shadcn-compatible project shape.

## Commands

\`\`\`sh
pnpm install
pnpm dev
pnpm verify
\`\`\`

The starter includes a shadcn CLI-installed \`Badge\`, a Base UI primitive, file
routes, route-owned Resource preload, SSR, browser hydration, and a production
leak scan for server-only sentinels.
`;

export const projectConsoleStarterReadme = `# Sunfall Arc Project Console Starter

This is the larger checked starter path for Sunfall Arc. It exercises branded
routes, file-route generation, Resources, Collections, Start server functions,
Start actions, no-JS form fallback, SSR, hydration, capability-based mocking,
and a production server-only leak scan.

## Commands

\`\`\`sh
pnpm install
pnpm dev
pnpm verify
\`\`\`

Keep \`src/domain.contract.ts\` browser-safe. Put server implementations and
seed data in \`src/domain.server.ts\`. Keep \`src/start-options.ts\` explicit;
it is the app graph source for server functions, actions, file routes,
diagnostics, and generated route output. Keep \`src/routeTree.gen.ts\`
generated, not hand-edited.
`;
