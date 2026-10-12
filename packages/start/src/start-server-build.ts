import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { UserConfig } from "vite";
import { clientAssetsFromViteManifest, type ViteManifest } from "./start-client-assets.js";
import type { FileRouteManifest } from "./file-routes.js";

/**
 * The production build of a dynamic Start app (any app that does not
 * prerender): `vite build` builds the client into `<outDir>/client` with a
 * manifest, then the server into `<outDir>/server`, whose `index.js` serves
 * the app with `serve` from `@sunfall/arc-start/node`.
 */

/** Vite virtual module id of the production server entry (`<outDir>/server/index.js`). */
export const productionServerEntryId = "virtual:sunfall-arc-start/production-server";
const resolvedProductionServerEntryId = `\0${productionServerEntryId}`;

export const resolveProductionServerEntryId = (id: string): string | null =>
  id === productionServerEntryId ? resolvedProductionServerEntryId : null;

export const isProductionServerEntry = (id: string): boolean =>
  id === resolvedProductionServerEntryId;

export interface StartServerBuildLayout {
  readonly clientOutDir: string;
  readonly serverOutDir: string;
}

/** Output directories, relative to the Vite root, for `build.outDir`. */
export const startServerBuildLayout = (outDir: string): StartServerBuildLayout => ({
  clientOutDir: `${outDir}/client`,
  serverOutDir: `${outDir}/server`,
});

const rootRelative = (root: string, file: string): string => {
  const path = file.startsWith("/") && !file.startsWith(root) ? file.slice(1) : file;
  return relative(root, isAbsolute(path) ? path : resolve(root, path))
    .split("\\")
    .join("/");
};

/**
 * Vite config for the two-environment production build. The client keeps the
 * app's own `build` options (an explicit `input` included); Start sets its
 * output directory and manifest, and the server environment's input.
 */
export const startServerBuildConfig = (options: {
  readonly root: string;
  readonly outDir: string;
  readonly serverEntry: string;
  readonly clientEntry: string;
  readonly clientInput: unknown;
}): UserConfig => {
  const layout = startServerBuildLayout(options.outDir);
  return {
    builder: {},
    environments: {
      client: {
        build: {
          outDir: layout.clientOutDir,
          manifest: true,
          ...(options.clientInput === undefined
            ? {
                rolldownOptions: {
                  input: resolve(options.root, rootRelative(options.root, options.clientEntry)),
                },
              }
            : {}),
        },
      },
      ssr: {
        build: {
          outDir: layout.serverOutDir,
          ssr: true,
          // The client build already copied `public/`.
          copyPublicDir: false,
          rolldownOptions: {
            input: {
              index: productionServerEntryId,
              server: resolve(options.root, rootRelative(options.root, options.serverEntry)),
            },
          },
        },
      },
    },
  };
};

/** Root-relative source paths of the lazy modules each route path's page loads. */
export const routeModulesByPath = (
  root: string,
  manifest: FileRouteManifest,
): Record<string, string[]> => {
  const byPath: Record<string, string[]> = {};
  for (const module of manifest.modules) {
    if (module.kind === "Component" || module.kind === "Layout") {
      (byPath[module.routePath] ??= []).push(rootRelative(root, module.filePath));
    }
  }
  return byPath;
};

/**
 * Source of `<outDir>/server/index.js`: imports the app's handler, embeds the
 * client build's assets (read from the client manifest, which the client
 * environment built first), and serves both.
 */
export const productionServerEntryModule = (options: {
  readonly root: string;
  readonly outDir: string;
  readonly base: string;
  readonly serverEntry: string;
  readonly clientEntry: string;
  readonly handlerExport: string | undefined;
  readonly fileRoutes: FileRouteManifest;
}): string => {
  const layout = startServerBuildLayout(options.outDir);
  const clientDir = resolve(options.root, layout.clientOutDir);
  const manifest = JSON.parse(
    readFileSync(resolve(clientDir, ".vite/manifest.json"), "utf8"),
  ) as ViteManifest;
  const assets = clientAssetsFromViteManifest(manifest, {
    base: options.base,
    entry: rootRelative(options.root, options.clientEntry),
    routeModules: routeModulesByPath(options.root, options.fileRoutes),
  });
  const serverEntry = resolve(options.root, rootRelative(options.root, options.serverEntry));
  const clientDirFromServer = relative(resolve(options.root, layout.serverOutDir), clientDir)
    .split("\\")
    .join("/");
  const handler =
    options.handlerExport === undefined
      ? "entry.default ?? entry.handleRequest"
      : `entry[${JSON.stringify(options.handlerExport)}]`;
  return [
    `import { fileURLToPath } from "node:url";`,
    `import { serveMain } from "@sunfall/arc-start/node";`,
    `import * as entry from ${JSON.stringify(serverEntry)};`,
    ``,
    `serveMain(${handler}, {`,
    `  clientDir: fileURLToPath(new URL(${JSON.stringify(`${clientDirFromServer}/`)}, import.meta.url)),`,
    `  assets: ${JSON.stringify(assets)},`,
    `  base: ${JSON.stringify(options.base)},`,
    `});`,
    ``,
  ].join("\n");
};
