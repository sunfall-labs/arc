import type { ActionManifestSource, ServerFunctionManifestSource } from "@effect-ui/start";
import { SubmitProjectName } from "./domain.js";
import {
  advanceProject,
  getProject,
  listProjects,
  renameProject,
  submitProjectName,
} from "./domain.server.js";
import { RenameProjectFromCollection } from "./project-collections.js";

export const projectConsoleServerFunctionSources = [
  {
    fn: advanceProject,
    module: "/src/domain.server.ts",
    exportName: "advanceProject",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "advanceProject",
  },
  {
    fn: getProject,
    module: "/src/domain.server.ts",
    exportName: "getProject",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "getProject",
  },
  {
    fn: listProjects,
    module: "/src/domain.server.ts",
    exportName: "listProjects",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "listProjects",
  },
  {
    fn: submitProjectName,
    module: "/src/domain.server.ts",
    exportName: "submitProjectName",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "submitProjectName",
  },
  {
    fn: renameProject,
    module: "/src/domain.server.ts",
    exportName: "renameProject",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "renameProject",
  },
] as const satisfies readonly ServerFunctionManifestSource[];

export const projectConsoleActionSources = [
  {
    action: RenameProjectFromCollection,
    module: "/src/project-collections.ts",
    exportName: "RenameProjectFromCollection",
    clientModule: "/src/project-collections.ts",
    clientExportName: "RenameProjectFromCollection",
  },
  {
    action: SubmitProjectName,
    module: "/src/domain.ts",
    exportName: "SubmitProjectName",
    clientModule: "/src/domain.ts",
    clientExportName: "SubmitProjectName",
  },
] as const satisfies readonly ActionManifestSource[];

export const projectConsoleServerRegistry = {
  actions: projectConsoleActionSources.map((source) => source.action),
  serverFunctions: projectConsoleServerFunctionSources.map((source) => source.fn),
} as const;

export const projectConsoleStartOptions = {
  serverEntry: "/src/server.tsx",
  serverFunctionSources: projectConsoleServerFunctionSources,
  actionSources: projectConsoleActionSources,
  fileRouteOptions: {
    routeDirectory: "src/routes",
  },
  fileRouteGeneration: {
    outputFile: "src/routeTree.gen.ts",
  },
  buildPolicy: {
    diagnostics: {
      routePreloadResources: {
        requireDeclaredForPreload: true,
      },
      routePreloadCollections: {
        requireDeclaredForPreload: true,
      },
    },
  },
} as const;
