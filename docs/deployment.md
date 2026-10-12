# Deployment

Sunfall Arc deployment centers on the Start request boundary:
`createRequestHandler(app, { server })`, which returns an Effect-returning
handler. `app` is the `App.define(...)` definition the browser entry also
launches; `server` is the server Layer, which must provide every service the
app's root needs, so a correctly typed handler has no requirements left for
the host. Each host shape has exactly one import path:

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
import { AppServerLive } from "./app.server.js";

const fetchHandler = toFetchHandler(createRequestHandler(app, { server: AppServerLive }));
```

Use `createFetchHandler` when the host itself expects
`(request: Request) => Promise<Response>`:

```ts
import { createRequestHandler } from "@sunfall/arc-start";
import { createFetchHandler } from "@sunfall/arc-start/fetch";
import { app } from "./app-definition.js";
import { AppServerLive } from "./app.server.js";

const fetch = createFetchHandler(createRequestHandler(app, { server: AppServerLive }));

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
import { AppServerLive } from "./app.server.js";

const handler = createNodeServerHandler(createRequestHandler(app, { server: AppServerLive }));

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
import { AppServerLive } from "./app.server.js";

const fetch = createFetchHandler(createRequestHandler(app, { server: AppServerLive }));

Bun.serve({
  fetch,
});
```

Vercel and Netlify Node functions use `@sunfall/arc-start/node` when the host
provides Node `IncomingMessage`/`ServerResponse` values, and
`@sunfall/arc-start/fetch` for their edge runtimes.

Every host serves server functions and Actions through the same handler, at
two fixed paths: `POST /__sunfall-arc/rpc` (an `effect/rpc` `RpcServer` with
JSON serialization, answering one request per POST) and
`POST /__sunfall-arc/action`. Route both to the Start handler; there is
nothing else to mount. Responses from the RPC path are always `200` JSON
arrays of `effect/rpc` messages (typed failures and defects travel inside
them), so proxies should not rewrite or cache that path. The browser reaches
both through the client Layer's `HttpClient` (else `FetchHttpClient`) on the
page's origin.

Static hosts can prerender routes during the production Vite build:

```ts
import { sunfallArcStart } from "@sunfall/arc-start/vite";

export default defineConfig({
  plugins: [
    sunfallArcStart({
      serverEntry: "/src/server.tsx",
      prerender: {
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

Prerendering calls the server entry's handler in-process through a temporary
Vite server, then swaps the page's dev entry script and dev stylesheets for the
built entry chunk and its CSS from Vite's build manifest. The plugin turns on
`build.manifest` (a string `build.manifest` path is respected), so
`dist/.vite/manifest.json` ships with the build.

For a fully static deployment, set `buildPolicy.staticClient: { target: "static" }`:
the browser build then compiles the server-function `RpcClient` out of
`App.launch`, so the app's client Layer must serve data from the prerendered
pages (the docs site's `DocsContentApiStaticClient` is the example).

## Current Limits

- There are no host-specific packages for Cloudflare, Vercel, Netlify, Bun, or
  static hosts; the `./fetch` and `./node` subpaths plus the recipes above
  cover them.
- Static prerendering is built into the Start Vite plugin. Host-specific static
  packages can still add deploy-provider details later.
- Framework package manifests are publishable public scoped packages versioned
  `0.1.0-alpha.1`, with package keywords and repository/homepage/bugs metadata
  pointing at `https://github.com/sunfall-labs/arc`.

The `runtime` option of `createFetchHandler` / `createNodeServerHandler` exists
only for handlers that still have requirements (for example a route preload
service the server Layer does not provide); the types require it exactly then.

Keep deployment integrations as small wrappers over `createRequestHandler(app, ...)`
and the tested adapters above.
