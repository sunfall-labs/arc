const routeArtifact = (file) => ({ kind: "route", file });
const virtualArtifact = (file) => ({ kind: "virtual", file });

export const generatedStarterArtifacts = [
  {
    starterId: "basic",
    artifacts: [
      routeArtifact("src/routeTree.gen.ts"),
      virtualArtifact("src/effect-ui-start-virtual.d.ts"),
    ],
  },
  {
    starterId: "react",
    artifacts: [
      routeArtifact("src/routeTree.gen.ts"),
      virtualArtifact("src/effect-ui-start-virtual.d.ts"),
    ],
  },
  {
    starterId: "project-console",
    artifacts: [
      routeArtifact("src/routeTree.gen.ts"),
      virtualArtifact("src/effect-ui-start-virtual.d.ts"),
      virtualArtifact("src/virtual-manifest-types.ts"),
    ],
  },
];

export const generatedStarterArtifactsFor = (starterId) =>
  generatedStarterArtifacts.find((starter) => starter.starterId === starterId)?.artifacts ?? [];
