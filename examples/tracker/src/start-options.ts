export const trackerStartOptions = {
  serverEntry: "/src/server.tsx",
  fileRouteOptions: {
    routeDirectory: "src/routes",
  },
  fileRouteGeneration: {
    outputFile: "src/routeTree.gen.ts",
  },
} as const;
