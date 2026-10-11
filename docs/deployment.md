# Deployment

Sunfall Arc deployment centers on the Start request boundary:
`createRequestHandler(app)`, which returns an Effect-returning handler. Each
host shape has exactly one import path:

- `@sunfall/arc-start/fetch` for Fetch-style hosts (Workers, edge runtimes,
  Bun, Deno, tests);
- `@sunfall/arc-start/node` for Node HTTP (`IncomingMessage` /
  `ServerResponse`).

Each subpath exposes one Effect-first adapter plus one host-shaped facade for
platforms whose contract is already fixed. `StartRequestHandlerError` is
exported from the `@sunfall/arc-start` root.

## Fetch And Edge-Style Hosts

Use `toFetchHandler` when the host integration can run Effects itself:

```ts
import { createRequestHandler } from "@sunfall/arc-start";
import { toFetchHandler } from "@sunfall/arc-start/fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandler(createRequestHandler(app));
```

Use `createFetchHandler` when the host itself expects
`(request: Request) => Promise<Response>`:

```ts
import { createRequestHandler } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start/fetch";
import { app } from "./app-definition.js";

const fetch = createFetchHandler(createRequestHandler(app), {
  runtime: app.runtime,
});

export default {
  fetch,
};
```

## Node HTTP

Use `createNodeServerHandler` for the ordinary `node:http` callback shape:

```ts
import { createServer } from "node:http";
import { createRequestHandler } from "@sunfall/arc-start";
import { createNodeServerHandler } from "@sunfall/arc-start/node";
import { app } from "./app-definition.js";

const handler = createNodeServerHandler(createRequestHandler(app), {
  runtime: app.runtime,
});

createServer(handler).listen(3000);
```

`trustForwardedHeaders` defaults to `false`: the request origin comes from the
`Host` header (or `origin` when you pass a fixed public origin). Set
`trustForwardedHeaders: true` only behind a proxy that overwrites
`x-forwarded-proto` and `x-forwarded-host`; otherwise clients could spoof the
origin your app sees.

`createNodeHandler` is the Effect-first Node adapter for hosts that want to run,
fork, or recover the Effect program themselves.

The Node adapter is covered for:

- untrusted-by-default and explicitly trusted forwarded origin handling through
  `trustForwardedHeaders`;
- request bodies for non-`GET`/`HEAD` methods;
- bodyless `HEAD` responses;
- streaming Web `Response` bodies through Node backpressure;
- preserving multiple `Set-Cookie` headers.

## Platform Recipes

Cloudflare Workers, Vercel Edge, Netlify Edge, and other Fetch-native hosts
that require a Promise-shaped exported `fetch` function use `createFetchHandler`
as shown above. Bun's HTTP server uses the same boundary:

```ts
import { createRequestHandler } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start/fetch";
import { app } from "./app-definition.js";

const fetch = createFetchHandler(createRequestHandler(app), {
  runtime: app.runtime,
});

Bun.serve({
  fetch,
});
```

Vercel and Netlify Node functions use `@sunfall/arc-start/node` when the host
provides Node `IncomingMessage`/`ServerResponse` values, and
`@sunfall/arc-start/fetch` for their edge runtimes.

Static hosts can prerender routes during the production Vite build:

```ts
import { sunfallArcStart } from "@sunfall/arc-start/vite";

export default defineConfig({
  plugins: [
    sunfallArcStart({
      serverEntry: "/src/server.tsx",
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: true,
        autoSubfolderIndex: true,
        crawlLinks: true,
      },
    }),
  ],
});
```

Static file routes are discovered automatically when they have no path params.
Dynamic routes stay explicit: add concrete paths through `prerender.pages` or
link to them from a discovered page when `crawlLinks` is enabled. The build
writes ordinary HTML files into Vite's output directory, using
`/page/index.html` paths by default.

## Current Limits

- There are no host-specific packages for Cloudflare, Vercel, Netlify, Bun, or
  static hosts; the `./fetch` and `./node` subpaths plus the recipes above
  cover them.
- Static prerendering is built into the Start Vite plugin. Host-specific static
  packages can still add deploy-provider details later.
- Framework package manifests are publishable public scoped packages versioned
  `0.1.0-alpha.1`, with package keywords and repository/homepage/bugs metadata
  pointing at `https://github.com/sunfall-labs/arc`.

Keep deployment integrations as small wrappers over `createRequestHandler(app)`
and the tested adapters above.
