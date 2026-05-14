export const starterFileRoutes = [
  "src/routes/index.ts"
] as const;

export const starterStartOptions = {
  serverEntry: "/src/server.tsx",
  fileRoutes: starterFileRoutes,
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
