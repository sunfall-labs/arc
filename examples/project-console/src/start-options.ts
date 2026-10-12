// Server functions and Actions are not listed here: the Start plugin derives
// them from `createRequestHandler(app, { serverFunctions })` in the server
// entry, naming each by the module export it came from.
export const projectConsoleStartOptions = {
  serverEntry: "/src/server.tsx",
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
