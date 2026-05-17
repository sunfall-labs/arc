# Deployment

Sunfall Arc deployment currently centers on the Start request boundary:
`createRequestHandlerEffect(app)`. Host adapters stay thin, but the public
facades own the host-shaped runtime seam. The canonical adapter remains
Effect-first; compatibility facades exist only where a platform contract is
already fixed, such as Fetch hosts that require `(request) =>
Promise<Response>` or Node HTTP servers that require a `createServer` callback.

The tested adapter implementation lives in `@sunfall/arc-start/adapters`.
Deployment-facing package facades are split by host shape:
`@sunfall/arc-start-fetch` for Fetch-style hosts and `@sunfall/arc-start-node` for
Node HTTP.

## Fetch And Edge-Style Hosts

Use `toFetchHandlerEffect` when the host integration can run Effects itself:

```ts
import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { toFetchHandlerEffect } from "@sunfall/arc-start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandlerEffect(createRequestHandlerEffect(app));
```

Use `createFetchHandler` only as the compatibility adapter when the host itself
expects `(request: Request) => Promise<Response>`:

```ts
import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start-fetch";
import { app } from "./app-definition.js";

const fetch = createFetchHandler(createRequestHandlerEffect(app), {
  runtime: app.runtime,
});

export default {
  fetch,
};
```

`toFetchHandler` is an alias for the Effect-returning adapter shape:

```ts
import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { toFetchHandler } from "@sunfall/arc-start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandler(createRequestHandlerEffect(app));
```

## Node HTTP

Use `createNodeServerHandler` for the ordinary `node:http` callback shape:

```ts
import { createServer } from "node:http";
import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { createNodeServerHandler } from "@sunfall/arc-start-node";
import { app } from "./app-definition.js";

const handler = createNodeServerHandler(createRequestHandlerEffect(app), {
  runtime: app.runtime,
  trustForwardedHeaders: true,
});

createServer(handler).listen(3000);
```

`trustForwardedHeaders` defaults to `true` for compatibility with existing
proxy deployments. Set it to `false` when `x-forwarded-proto` and
`x-forwarded-host` are not supplied by a trusted proxy, or pass `origin` when a
deployment has a fixed public origin.

The lower `createNodeHandlerEffect` and `createNodeHandler` adapters remain
available for hosts that want to run, fork, or recover the Effect program
themselves.

The Node adapter is covered for:

- trusted and untrusted forwarded origin handling through
  `trustForwardedHeaders`;
- request bodies for non-`GET`/`HEAD` methods;
- bodyless `HEAD` responses;
- streaming Web `Response` bodies through Node backpressure;
- preserving multiple `Set-Cookie` headers.

## Platform Recipes

Cloudflare Workers, Vercel Edge, Netlify Edge, and other Fetch-native hosts
that require a Promise-shaped exported `fetch` function can use the
compatibility Fetch facade:

```ts
import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start-fetch";
import { app } from "./app-definition.js";

const fetch = createFetchHandler(createRequestHandlerEffect(app), {
  runtime: app.runtime,
});

export default {
  fetch,
};
```

Bun's HTTP server can use the same compatibility boundary:

```ts
import { createRequestHandlerEffect } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start-fetch";
import { app } from "./app-definition.js";

const fetch = createFetchHandler(createRequestHandlerEffect(app), {
  runtime: app.runtime,
});

Bun.serve({
  fetch,
});
```

Vercel and Netlify Node functions should use `@sunfall/arc-start-node` when the
host provides Node `IncomingMessage`/`ServerResponse` values. Prefer
`@sunfall/arc-start-fetch` for their edge runtimes.

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

- Host-specific packages for Cloudflare, Vercel, Netlify, Bun, or static hosts
  are not split out yet. Node HTTP and generic Fetch hosts have package facades
  and platform recipes.
- Static prerendering is built into the Start Vite plugin. Host-specific static
  packages can still add deploy-provider details later.
- Framework package manifests are publishable public scoped packages versioned
  `0.1.0-alpha.0`, with package keywords and repository/homepage/bugs metadata
  pointing at `https://github.com/sunfall-labs/arc`.

Until platform-specific packages exist, keep those deployment integrations as
small wrappers over `createRequestHandlerEffect(app)` and the tested adapters
above.
