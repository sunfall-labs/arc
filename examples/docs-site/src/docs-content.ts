import { goldenPathBlocks } from "./golden-path.js";

export { DocsPageSlug, DocsRouteParams } from "./docs-slugs.js";
import type { DocsPageSlug } from "./docs-slugs.js";

export type DocsSection = "Start here" | "Learn" | "Ship" | "Reference";

export interface DocsBlock {
  readonly _tag: "Heading" | "Paragraph" | "List" | "Code" | "Table";
  readonly text?: string;
  /** Heading level; defaults to 2. */
  readonly level?: 2 | 3;
  readonly items?: readonly string[];
  /** Table rows; the first row is the header. */
  readonly rows?: readonly (readonly string[])[];
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
    slug: "golden-path",
    section: "Start here",
    title: "The golden path",
    summary:
      "Which Arc tool to use for each job, then one feature built end to end: Resource, Component, Route, Action, Collection, SSR, and Timeline.",
    blocks: goldenPathBlocks,
  },
  {
    slug: "getting-started",
    section: "Start here",
    title: "Getting started",
    summary:
      "Install the alpha packages, choose a starter shape, and run the first correctness checks.",
    blocks: [
      {
        _tag: "Paragraph",
        text: "Sunfall Arc is a public alpha for agent-operated TypeScript apps. Install the packages and run a checked starter here; read The golden path to learn which tool to use for each job, then use the cookbook for small slices.",
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
        text: "Start apps deploy through one host adapter subpath: @sunfall/arc-start/fetch or @sunfall/arc-start/node.",
      },
      {
        _tag: "Heading",
        text: "Run a checked starter",
      },
      {
        _tag: "Code",
        language: "shellscript",
        code: "pnpm starter:dev\npnpm starter:verify",
      },
      {
        _tag: "List",
        items: [
          "Basic starter: the smallest checked full-stack app shell.",
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
    summary: "The vocabulary behind Arc's typed, agent-readable app graph.",
    blocks: [
      {
        _tag: "Paragraph",
        text: "Arc is organized around named definitions: typed declarations that can run at runtime and remain visible to tooling, CI, devtools, and agents.",
      },
      {
        _tag: "Heading",
        text: "Correctness by construction",
      },
      {
        _tag: "Paragraph",
        text: "Arc prevents drift where it can and explains drift where it cannot. TypeScript catches invalid shapes early, build diagnostics verify the generated app graph, and the runtime preserves scoped Effect lifetimes across client, server, tests, and agents.",
      },
      {
        _tag: "List",
        items: [
          "Capability: a named service boundary for live APIs, server clients, and test layers.",
          "Server contract: a schema-described boundary between browser-safe clients and server-only handlers.",
          "Resource: a named async data family with input/output schemas, cache state, retry policy, and semantic tags.",
          "Action: a named mutation with typed input/output, Effect execution, and invalidation policy.",
          "Route: a typed URL definition that can declare the Resources and Collections it owns before render.",
          "Collection: a local-first data definition for persistence, optimistic queues, sync adapters, and live queries.",
          "Start graph: deterministic metadata about routes, resources, actions, collections, endpoints, and modules for diagnostics, CI, devtools, and agents.",
        ],
      },
      {
        _tag: "Heading",
        text: "The ownership rule",
      },
      {
        _tag: "Paragraph",
        text: "If state or behavior matters to rendering, mutation, caching, testing, deployment, or diagnostics, it should have a typed owner instead of living as an ad hoc convention inside component code. That gives humans and agents one stable place to inspect, edit, and verify the behavior.",
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
          "@sunfall/arc-start: SSR, hydration, server functions, Start actions, file routes, manifests, prerendering, diagnostics, and app graph tooling. Host adapters live at @sunfall/arc-start/fetch (Workers, edge runtimes, Bun) and @sunfall/arc-start/node (IncomingMessage/ServerResponse).",
          "@sunfall/arc-db: Collections, live queries, persistence, optimistic mutation queues, and sync adapter seams.",
          "@sunfall/arc-devtools: JSON-safe inspection contracts, app graph summaries, causal graphs, request/resource/action panels, and extension-friendly payloads.",
          "@sunfall/arc-solid: the Solid 2 renderer adapter for routing, runtime providers, Resources, Actions, Programs, streams, and component scopes.",
          "@sunfall/arc-solid-db: Solid Collection and live-query bindings.",
        ],
      },
      {
        _tag: "Heading",
        text: "Alpha expectations",
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
        text: "Arc deployment centers on createRequestHandler(app). The Start request handler runs route preload, rendering, server functions, actions, response context, request tracing, and runtime cleanup on a request runtime built from the server Layer.",
      },
      {
        _tag: "Heading",
        text: "Fetch-style hosts",
      },
      {
        _tag: "Code",
        language: "tsx",
        code: `import { createRequestHandler } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start/fetch";
import { app } from "./app-definition.js";
import { AppServerLive } from "./app.server.js";

export default {
  fetch: createFetchHandler(createRequestHandler(app, { server: AppServerLive })),
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
import { createRequestHandler } from "@sunfall/arc-start";
import { createNodeServerHandler } from "@sunfall/arc-start/node";
import { app } from "./app-definition.js";
import { AppServerLive } from "./app.server.js";

createServer(
  createNodeServerHandler(createRequestHandler(app, { server: AppServerLive })),
).listen(3000);`,
      },
      {
        _tag: "Paragraph",
        text: "Forwarded headers are untrusted by default. Pass trustForwardedHeaders: true only behind a proxy that overwrites x-forwarded-proto and x-forwarded-host.",
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
        text: "Make sure the file route declares the Resource or Collection it owns with preloadResources / preloadCollections in FileRoute.define(path)(options). Start diagnostics can require those declarations at build time.",
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
        text: "Convert host Promise work with Effect.tryPromise at the adapter boundary. Resource.load, Action.run, Server.implement handlers, and route preload should stay Effect-first.",
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
    summary: "Choose the smallest checked example that matches the question you are answering.",
    blocks: [
      {
        _tag: "List",
        items: [
          "Basic starter: the smallest checked full-stack shell with SSR, hydration, route-owned Resource preload, and leak scanning.",
          "Project console: the larger golden path for actions, local-first Collections, optimistic work, mocks, and diagnostics.",
          "Docs site: the live cookbook and public alpha docs app you are reading now.",
          "Devtools panel and extension examples: checked hosts for JSON-safe runtime summaries and inspected-window bridge contracts.",
        ],
      },
      {
        _tag: "Code",
        language: "shellscript",
        code: "pnpm starter:verify\npnpm --filter @sunfall/arc-example-project-console verify\npnpm docs-site:verify\npnpm devtools-panel:verify\npnpm devtools-extension:verify",
      },
    ],
  },
] as const satisfies readonly DocsPage[];

export const docsSections = ["Start here", "Learn", "Ship", "Reference"] as const;

export const docsPagesBySection = (section: DocsSection): readonly DocsPage[] =>
  docsPages.filter((page) => page.section === section);

export const getDocsPage = (slug: DocsPageSlug): DocsPage | undefined =>
  docsPages.find((page) => page.slug === slug);
