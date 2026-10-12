import { isActionDefinition, isServerFunction } from "@sunfall/arc-core";
import { Data, Effect } from "effect";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createServer, type InlineConfig } from "vite";
import type { ActionManifestSource } from "./action-manifest.js";
import type { ServerFunctionManifestSource } from "./server-function-manifest.js";
import {
  startServedDefinitionsOf,
  type StartServedDefinitions,
} from "./start-served-definitions.js";

/** Manifest sources derived from the server entry. */
export interface StartDerivedDefinitionSources {
  readonly serverFunctionSources: ReadonlyArray<ServerFunctionManifestSource>;
  readonly actionSources: ReadonlyArray<ActionManifestSource>;
}

/**
 * Raised when the server entry serves a definition that no app module
 * exports, so the plugin cannot name its module in the app graph.
 */
export class StartDefinitionNotExported extends Data.TaggedError("StartDefinitionNotExported")<{
  readonly kind: "server-function" | "action";
  readonly name: string;
  readonly guidance: string;
}> {}

/** Raised when the server entry cannot be loaded to derive the manifests. */
export class StartDefinitionSourcesLoadError extends Data.TaggedError(
  "StartDefinitionSourcesLoadError",
)<{
  readonly serverEntry: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Failures of `deriveStartDefinitionSources`. */
export type StartDefinitionSourcesError =
  | StartDefinitionNotExported
  | StartDefinitionSourcesLoadError;

/** Inputs for deriving manifest sources from the server entry. */
export interface DeriveStartDefinitionSourcesOptions {
  /** Vite root. */
  readonly root: string;
  /** Root-relative server entry, e.g. `/src/server.tsx`. */
  readonly serverEntry: string;
  /** Named handler export; defaults to `default`, then `handleRequest`. */
  readonly handlerExport?: string;
  /** Inline Vite config (the app's plugins and aliases, without Start). */
  readonly vite: InlineConfig;
}

const emptySources: StartDerivedDefinitionSources = {
  serverFunctionSources: [],
  actionSources: [],
};

type ModuleExports = Record<string, unknown>;

interface LoadedModule {
  /** Root-relative module id, e.g. `/src/domain.server.ts`. */
  readonly id: string;
  readonly exports: ModuleExports;
}

const sourceExtensionPattern = /\.(?:[cm]?[jt]sx?|tsrx)$/u;

const rootRelativeModuleId = (root: string, file: string): string | undefined => {
  const path = file.split("?")[0] ?? file;
  if (!isAbsolute(path) || !sourceExtensionPattern.test(path)) {
    return undefined;
  }
  const relativePath = relative(root, path);
  if (
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    relativePath.split(sep).includes("node_modules")
  ) {
    return undefined;
  }
  return `/${relativePath.split(sep).join("/")}`;
};

const handlerOf = (module: ModuleExports, handlerExport: string | undefined): unknown =>
  handlerExport === undefined ? (module.default ?? module.handleRequest) : module[handlerExport];

const exportNamed = (
  modules: ReadonlyArray<LoadedModule>,
  matches: (value: unknown) => boolean,
): { readonly module: string; readonly exportName: string } | undefined => {
  for (const loaded of modules) {
    for (const [exportName, value] of Object.entries(loaded.exports)) {
      if (exportName !== "default" && matches(value)) {
        return { module: loaded.id, exportName };
      }
    }
  }
  return undefined;
};

const notExported = (
  kind: StartDefinitionNotExported["kind"],
  name: string,
): StartDefinitionNotExported =>
  new StartDefinitionNotExported({
    kind,
    name,
    guidance:
      kind === "action"
        ? `Export the Action "${name}" from a module (for example \`export const Rename = Action.define(...)\`) so the Start app graph can name it.`
        : `Export the server function "${name}" from a \`*.server.ts\` module (for example \`export const getProject = Server.implement(...)\`) so the Start app graph can name it.`,
  });

/**
 * Builds manifest sources from what the server entry serves.
 *
 * Every served definition is matched to the module export it came from among
 * the modules the server entry loaded: server functions to their
 * `Server.implement` export and, by name, to the `Server.client`
 * export browser code calls; Actions to their `Action.define` export (shared
 * by both sides).
 */
export const startDefinitionSourcesFromModules = (
  served: StartServedDefinitions,
  modules: ReadonlyArray<LoadedModule>,
): Effect.Effect<StartDerivedDefinitionSources, StartDefinitionNotExported> =>
  Effect.gen(function* () {
    const ordered = [...modules].sort((left, right) => left.id.localeCompare(right.id));
    const serverFunctionSources: ServerFunctionManifestSource[] = [];
    for (const fn of served.serverFunctions) {
      const server = exportNamed(ordered, (value) => value === fn);
      if (server === undefined) {
        return yield* notExported("server-function", fn.name);
      }
      const client = exportNamed(
        ordered,
        (value) =>
          value !== fn && isServerFunction(value) && !value.hasHandler && value.name === fn.name,
      );
      serverFunctionSources.push({
        fn,
        module: server.module,
        exportName: server.exportName,
        ...(client === undefined
          ? {}
          : { clientModule: client.module, clientExportName: client.exportName }),
      });
    }
    const actionSources: ActionManifestSource[] = [];
    for (const action of served.actions) {
      const source = exportNamed(ordered, (value) => value === action);
      if (source === undefined || !isActionDefinition(action)) {
        return yield* notExported("action", action.name);
      }
      actionSources.push({
        action,
        module: source.module,
        exportName: source.exportName,
        clientModule: source.module,
        clientExportName: source.exportName,
      });
    }
    return { serverFunctionSources, actionSources };
  });

/**
 * SSR-loads the server entry through a temporary Vite server and derives the
 * server-function and Action manifest sources from the handler it exports.
 *
 * Returns no sources when the entry does not exist or its handler was not
 * built by `createRequestHandler`.
 */
export const deriveStartDefinitionSources = (
  options: DeriveStartDefinitionSourcesOptions,
): Effect.Effect<StartDerivedDefinitionSources, StartDefinitionSourcesError> => {
  const entryFile = resolve(options.root, `.${options.serverEntry}`);
  if (!existsSync(entryFile)) {
    return Effect.succeed(emptySources);
  }
  const loadError = (message: string) => (cause: unknown) =>
    new StartDefinitionSourcesLoadError({ serverEntry: options.serverEntry, message, cause });

  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () =>
        createServer({
          ...options.vite,
          root: options.root,
          configFile: false,
          logLevel: options.vite.logLevel ?? "silent",
          // Its own dependency cache, so this server never invalidates the
          // app's (and needs no browser dependency optimization).
          cacheDir: resolve(options.root, "node_modules/.vite/sunfall-arc-start"),
          optimizeDeps: { ...options.vite.optimizeDeps, noDiscovery: true, include: [] },
          server: {
            ...options.vite.server,
            middlewareMode: true,
            hmr: false,
            watch: null,
          },
        }),
      catch: loadError("Could not create the Vite server that loads the Start server entry."),
    }),
    (server) =>
      Effect.gen(function* () {
        const entry = (yield* Effect.tryPromise({
          try: () => server.ssrLoadModule(options.serverEntry),
          catch: loadError("Could not load the Start server entry to derive its manifests."),
        })) as ModuleExports;
        const served = startServedDefinitionsOf(handlerOf(entry, options.handlerExport));
        if (served === undefined) {
          return emptySources;
        }
        const modules: LoadedModule[] = [];
        for (const [file, node] of server.moduleGraph.idToModuleMap) {
          const id = rootRelativeModuleId(options.root, file);
          if (id === undefined) {
            continue;
          }
          const exports = (yield* Effect.tryPromise({
            try: () => server.ssrLoadModule(node.url),
            catch: loadError(`Could not read the exports of ${id}.`),
          })) as ModuleExports;
          modules.push({ id, exports });
        }
        return yield* startDefinitionSourcesFromModules(served, modules);
      }),
    (server) => Effect.promise(() => server.close()),
  );
};
