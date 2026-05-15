export const reactStarterStartOptions = {
  serverEntry: "/src/server.tsx",
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
      }
    }
  }
} as const;
