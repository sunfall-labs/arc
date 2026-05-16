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

export const solidStarterViteConfig = (startOptionsImport) => `import { effectUiStart } from "@effect-ui/start/vite";
import { effectUiTsrx } from "@effect-ui/tsrx";
import { defineConfig } from "vite";
import { ${startOptionsImport} } from "./src/start-options.js";

export default defineConfig({
  plugins: [
    ...effectUiTsrx({ solid: { ssr: true } }),
    effectUiStart(${startOptionsImport})
  ]
});
`;

export const reactStarterViteConfig = `import tailwindcss from "@tailwindcss/vite";
import { effectUiStart } from "@effect-ui/start/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { reactStarterStartOptions } from "./src/start-options.js";

const fromStarter = (path: string): string => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    effectUiStart(reactStarterStartOptions)
  ],
  resolve: {
    alias: [
      { find: "@", replacement: fromStarter("src") }
    ]
  }
});
`;

export const basicStarterReadme = `# Effect UI Basic Starter

This is the smallest checked starter path for a full-stack Effect UI app. It
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
- browser hydration through \`hydrateFromDocument\`;
- a route-owned Resource preload declared in file route metadata;
- a production leak scan for server-only module sentinels.
`;

export const reactStarterReadme = `# Effect UI React Starter

React + Vite starter for Effect UI with Tailwind v4, Base UI, and a
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

export const projectConsoleStarterReadme = `# Effect UI Project Console Starter

This is the larger checked starter path for Effect UI. It exercises branded
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

export const generatedStarterEffectFirstTemplates = [
  {
    file: "generated-starter-templates/basic/vite.config.ts",
    source: solidStarterViteConfig("starterStartOptions"),
  },
  {
    file: "generated-starter-templates/react/vite.config.ts",
    source: reactStarterViteConfig,
  },
  {
    file: "generated-starter-templates/project-console/vite.config.ts",
    source: solidStarterViteConfig("projectConsoleStartOptions"),
  },
];

export const generatedStarterReadmeTemplates = [
  {
    file: "generated-starter-templates/basic/README.md",
    source: basicStarterReadme,
  },
  {
    file: "generated-starter-templates/react/README.md",
    source: reactStarterReadme,
  },
  {
    file: "generated-starter-templates/project-console/README.md",
    source: projectConsoleStarterReadme,
  },
];
