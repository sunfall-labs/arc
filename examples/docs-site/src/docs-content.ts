import { Schema } from "effect";

export const DocsPageSlug = Schema.Literals([
  "getting-started",
  "core-concepts",
  "guided-tour",
  "reference",
  "deployment",
  "troubleshooting",
  "examples",
]);

export type DocsPageSlug = typeof DocsPageSlug.Type;

export const DocsRouteParams = Schema.Struct({
  slug: DocsPageSlug,
});

export type DocsRouteParams = typeof DocsRouteParams.Type;

export type DocsSection = "Start here" | "Learn" | "Ship" | "Reference";

export interface DocsBlock {
  readonly _tag: "Heading" | "Paragraph" | "List" | "Code";
  readonly text?: string;
  readonly items?: readonly string[];
  readonly code?: string;
  readonly language?: string;
}

export interface DocsPage {
  readonly slug: DocsPageSlug;
  readonly section: DocsSection;
  readonly title: string;
  readonly summary: string;
  readonly blocks: readonly DocsBlock[];
}

export const docsPages = [
  {
    slug: "getting-started",
    section: "Start here",
    title: "Getting started",
    summary: "Install the alpha packages, choose a starter shape, and run the first docs checks.",
    blocks: [
      {
        _tag: "Paragraph",
        text: "Sunfall Arc is a public alpha. The fastest way to learn it is to run a checked starter, then follow the guided tour and cookbook recipes.",
      },
      {
        _tag: "Heading",
        text: "Install the core packages",
      },
      {
        _tag: "Code",
        language: "shellscript",
        code: "pnpm add @sunfall/arc-core @sunfall/arc-start @sunfall/arc-solid effect solid-js",
      },
      {
        _tag: "Paragraph",
        text: "React apps use the React adapter packages instead of the Solid adapter. Start apps add the host facade they deploy through, such as @sunfall/arc-start-fetch or @sunfall/arc-start-node.",
      },
      {
        _tag: "Heading",
        text: "Run a checked starter",
      },
      {
        _tag: "Code",
        language: "shellscript",
        code: "pnpm starter:dev\npnpm starter:verify\npnpm react-starter:dev\npnpm react-starter:verify",
      },
      {
        _tag: "List",
        items: [
          "Use the basic starter for the smallest full-stack app shell.",
          "Use the React starter for the shadcn-compatible React path.",
          "Use the project console example when you want actions, collections, mocks, and diagnostics together.",
          "Use this docs site when you want to see server functions, Capabilities, Resources, file-route preload, SSR, prerendering, and hydration in one small app.",
        ],
      },
    ],
  },
  {
    slug: "core-concepts",
    section: "Learn",
    title: "Core concepts",
    summary: "The vocabulary behind Arc's typed app graph.",
    blocks: [
      {
        _tag: "Paragraph",
        text: "Arc is organized around named definitions that can run at runtime and remain inspectable as framework facts.",
      },
      {
        _tag: "List",
        items: [
          "Capability: a named service seam for live APIs, server clients, and test layers.",
          "Server contract: a schema-described boundary between browser-safe clients and server-only handlers.",
          "Resource: a named async data family with input/output schemas, cache state, retry policy, and semantic tags.",
          "Action: a named mutation with typed input/output, Effect execution, and invalidation policy.",
          "Route: a typed URL definition that can declare the Resources and Collections it owns before render.",
          "Collection: a local-first data definition for persistence, optimistic queues, sync adapters, and live queries.",
          "Start graph: deterministic route, resource, action, collection, endpoint, and module facts for diagnostics, CI, devtools, and agents.",
        ],
      },
      {
        _tag: "Heading",
        text: "The rule of thumb",
      },
      {
        _tag: "Paragraph",
        text: "If a fact matters to rendering, mutation, caching, testing, deployment, or diagnostics, it should have a typed owner instead of living as an ad hoc convention inside component code.",
      },
    ],
  },
  {
    slug: "guided-tour",
    section: "Learn",
    title: "Guided tour",
    summary:
      "Build the smallest useful full-stack slice: server contract, Capability, Resource, route preload, UI, and Action.",
    blocks: [
      {
        _tag: "Paragraph",
        text: "A typical Arc feature starts with a domain contract and ends with a route that can explain what it needs before it renders.",
      },
      {
        _tag: "Heading",
        text: "1. Define the browser-safe contract",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `export const GetProject = Server.contract<
  { readonly id: ProjectId },
  Project,
  ProjectError
>("Project.get", {
  input: Schema.Struct({ id: ProjectId }),
  output: ProjectSchema,
  error: ProjectErrorSchema,
});`,
      },
      {
        _tag: "Heading",
        text: "2. Expose it through a Capability-backed Resource",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `export const ProjectApi = Capability.define<ProjectApi>("ProjectApi");

export const ProjectById = Resource.family({
  name: "Project.byId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => ProjectApi.use((api) => api.get(id)),
  provides: (project) => [ProjectTag({ id: project.id })],
});`,
      },
      {
        _tag: "Heading",
        text: "3. Declare the route-owned data",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `const RouteBuilder = defineFileRoute("/projects/:id");

export const Route = RouteBuilder.preload({
  params: ProjectRouteParams,
  resources: ({ resource }) => [
    resource(ProjectById, ({ params }) => params.id),
  ],
}).route();`,
      },
      {
        _tag: "Heading",
        text: "4. Read the same Resource in the UI",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `const project = useResource(() => ProjectById(props.params.id));

return project.match({
  success: (value) => <ProjectView project={value} />,
  pending: (previous) => previous ? <ProjectView project={previous} refreshing /> : <Skeleton />,
  failure: (error) => <ProjectError error={error} />,
});`,
      },
      {
        _tag: "Heading",
        text: "5. Keep mutations attached to domain meaning",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `export const RenameProject = Action.define({
  name: "Project.rename",
  input: RenameProjectInput,
  output: ProjectSchema,
  run: (input) => ProjectApi.use((api) => api.rename(input)),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })],
});`,
      },
    ],
  },
  {
    slug: "reference",
    section: "Reference",
    title: "Package reference",
    summary: "What each public alpha package owns.",
    blocks: [
      {
        _tag: "List",
        items: [
          "@sunfall/arc-core: runtime spine, Signals, Resources, Actions, Forms, Routes, Capabilities, server contracts, and runtime helpers.",
          "@sunfall/arc-start: SSR, hydration, server functions, Start actions, file routes, manifests, prerendering, diagnostics, and app graph tooling.",
          "@sunfall/arc-start-fetch: Fetch-host facade for Workers, edge-style runtimes, Bun, and other Request/Response hosts.",
          "@sunfall/arc-start-node: Node HTTP facade for IncomingMessage/ServerResponse hosts.",
          "@sunfall/arc-db: Collections, live queries, persistence, optimistic mutation queues, and sync adapter seams.",
          "@sunfall/arc-devtools: JSON-safe inspection contracts, app graph summaries, causal graphs, request/resource/action panels, and extension-friendly payloads.",
          "@sunfall/arc-solid and @sunfall/arc-react: renderer adapters for routing, runtime providers, Resources, Actions, Programs, streams, and component scopes.",
          "@sunfall/arc-solid-db and @sunfall/arc-react-db: Collection and live-query bindings for each renderer.",
        ],
      },
      {
        _tag: "Heading",
        text: "Current alpha expectation",
      },
      {
        _tag: "Paragraph",
        text: "The public packages are meant to be usable, inspectable, and testable, but the ecosystem is still early. Prefer the checked starters and examples over inventing a fresh host integration from scratch.",
      },
    ],
  },
  {
    slug: "deployment",
    section: "Ship",
    title: "Deployment",
    summary: "Deploy through the Start request boundary, then keep host adapters thin.",
    blocks: [
      {
        _tag: "Paragraph",
        text: "Arc deployment centers on createRequestHandlerEffect(app). The Start request handler runs route preload, rendering, server functions, actions, response context, request tracing, and runtime cleanup through the app runtime.",
      },
      {
        _tag: "Heading",
        text: "Fetch-style hosts",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start-fetch";
import { app } from "./app-definition.js";

export default {
  fetch: createFetchHandler(createRequestHandlerEffect(app), {
    runtime: app.runtime,
  }),
};`,
      },
      {
        _tag: "Heading",
        text: "Node HTTP",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `import { createServer } from "node:http";
import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { createNodeServerHandler } from "@sunfall/arc-start-node";
import { app } from "./app-definition.js";

createServer(
  createNodeServerHandler(createRequestHandlerEffect(app), {
    runtime: app.runtime,
    trustForwardedHeaders: true,
  }),
).listen(3000);`,
      },
      {
        _tag: "Heading",
        text: "Static prerendering",
      },
      {
        _tag: "Paragraph",
        text: "The Start Vite plugin can prerender static file routes and crawl typed anchors during production builds. Dynamic routes need concrete prerender pages or links from discovered pages.",
      },
    ],
  },
  {
    slug: "troubleshooting",
    section: "Ship",
    title: "Troubleshooting",
    summary:
      "The first places to look when an alpha app does not behave the way the graph says it should.",
    blocks: [
      {
        _tag: "Heading",
        text: "A route renders with loading UI during SSR",
      },
      {
        _tag: "Paragraph",
        text: "Make sure the file route declares the Resource or Collection it owns with RouteBuilder.preload(...). Start diagnostics can require those declarations at build time.",
      },
      {
        _tag: "Heading",
        text: "Server-only code appears in a client bundle",
      },
      {
        _tag: "Paragraph",
        text: "Move handlers into .server.ts modules, export only contracts and typed clients from browser-safe modules, and keep leak-scan sentinels in the production build gate.",
      },
      {
        _tag: "Heading",
        text: "A callback returns a Promise where Arc expected Effect",
      },
      {
        _tag: "Paragraph",
        text: "Convert host Promise work with Effect.tryPromise at the adapter seam. Resource.load, Action.run, Server.implement handlers, and route preload should stay Effect-first.",
      },
      {
        _tag: "Heading",
        text: "The route tree looks stale",
      },
      {
        _tag: "Paragraph",
        text: "Run the docs or app build so the Start Vite plugin regenerates routeTree.gen.ts. Generated files are committed because they are public app graph artifacts.",
      },
      {
        _tag: "Code",
        language: "shellscript",
        code: "sunfall-arc-start diagnostics --root .\nsunfall-arc-start graph route /projects/:id\nsunfall-arc-start impact action Project.rename --json",
      },
    ],
  },
  {
    slug: "examples",
    section: "Reference",
    title: "Examples and starters",
    summary: "Choose the smallest example that matches the question you are trying to answer.",
    blocks: [
      {
        _tag: "List",
        items: [
          "Basic starter: the smallest checked full-stack shell with SSR, hydration, route-owned Resource preload, and leak scanning.",
          "React starter: the React adapter path with Tailwind v4, Base UI, shadcn-compatible structure, file routes, SSR, hydration, and leak scanning.",
          "Project console: the larger golden path for actions, local-first Collections, optimistic work, mocks, and diagnostics.",
          "Docs site: the dogfooded cookbook and public alpha docs app you are reading now.",
          "Devtools panel and extension examples: checked hosts for JSON-safe runtime summaries and inspected-window bridge contracts.",
        ],
      },
      {
        _tag: "Code",
        language: "shellscript",
        code: "pnpm starter:verify\npnpm react-starter:verify\npnpm project-console:verify\npnpm docs-site:verify\npnpm devtools-panel:verify\npnpm devtools-extension:verify",
      },
    ],
  },
] as const satisfies readonly DocsPage[];

export const docsSections = ["Start here", "Learn", "Ship", "Reference"] as const;

export const docsPagesBySection = (section: DocsSection): readonly DocsPage[] =>
  docsPages.filter((page) => page.section === section);

export const getDocsPage = (slug: DocsPageSlug): DocsPage | undefined =>
  docsPages.find((page) => page.slug === slug);
