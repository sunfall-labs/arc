export const projectConsoleFileRoutes = [
  "src/routes/index.ts",
  "src/routes/projects/index.ts",
  "src/routes/projects/$id.ts"
] as const;

export const projectConsoleServerFunctionManifest = [
  {
    name: "Project.advance",
    module: "/src/domain.server.ts",
    exportName: "advanceProject",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "advanceProject",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true
  },
  {
    name: "Project.get",
    module: "/src/domain.server.ts",
    exportName: "getProject",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "getProject",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true
  },
  {
    name: "Project.list",
    module: "/src/domain.server.ts",
    exportName: "listProjects",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "listProjects",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true
  },
  {
    name: "Project.name.submit",
    module: "/src/domain.server.ts",
    exportName: "submitProjectName",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "submitProjectName",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true
  },
  {
    name: "Project.rename",
    module: "/src/domain.server.ts",
    exportName: "renameProject",
    clientModule: "/src/domain.contract.ts",
    clientExportName: "renameProject",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true
  }
] as const;

export const projectConsoleActionManifest = [
  {
    name: "Project.collection.rename",
    module: "/src/project-collections.ts",
    exportName: "RenameProjectFromCollection",
    clientModule: "/src/project-collections.ts",
    clientExportName: "RenameProjectFromCollection",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true,
    invalidates: true,
    optimistic: true,
    retry: true,
    concurrency: "latest"
  },
  {
    name: "Project.name.submit",
    module: "/src/domain.ts",
    exportName: "SubmitProjectName",
    clientModule: "/src/domain.ts",
    clientExportName: "SubmitProjectName",
    inputSchema: true,
    outputSchema: true,
    errorSchema: true,
    invalidates: true,
    optimistic: false,
    retry: true,
    concurrency: "latest"
  }
] as const;

export const projectConsoleStartOptions = {
  serverEntry: "/src/server.tsx",
  serverFunctionManifest: projectConsoleServerFunctionManifest,
  actionManifest: projectConsoleActionManifest,
  fileRoutes: projectConsoleFileRoutes,
  fileRouteOptions: {
    routeDirectory: "src/routes"
  },
  fileRouteGeneration: {
    outputFile: "src/routeTree.gen.ts"
  },
  buildPolicy: {
    diagnostics: {
      routePreloadResources: {
        requireDeclaredForPreload: true
      },
      routePreloadCollections: {
        requireDeclaredForPreload: true
      }
    }
  }
} as const;
