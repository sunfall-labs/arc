# Deployment

Effect UI deployment currently centers on the Start request boundary:
`createRequestHandlerEffect(app)`. Host adapters stay thin, but the public
facades own the host-shaped runtime seam. The canonical adapter remains
Effect-first; compatibility facades exist only where a platform contract is
already fixed, such as Fetch hosts that require `(request) =>
Promise<Response>` or Node HTTP servers that require a `createServer` callback.

The tested adapter implementation lives in `@effect-ui/start/adapters`.
Deployment-facing package facades are split by host shape:
`@effect-ui/start-fetch` for Fetch-style hosts and `@effect-ui/start-node` for
Node HTTP.

## Fetch And Edge-Style Hosts

Use `toFetchHandlerEffect` when the host integration can run Effects itself:

```ts
import { createRequestHandlerEffect } from "@effect-ui/start";
import { toFetchHandlerEffect } from "@effect-ui/start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandlerEffect(createRequestHandlerEffect(app));
```

Use `createFetchHandler` only as the compatibility adapter when the host itself
expects `(request: Request) => Promise<Response>`:

```ts
import { createRequestHandlerEffect } from "@effect-ui/start";
import { createFetchHandler } from "@effect-ui/start-fetch";
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
import { createRequestHandlerEffect } from "@effect-ui/start";
import { toFetchHandler } from "@effect-ui/start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandler(createRequestHandlerEffect(app));
```

## Node HTTP

Use `createNodeServerHandler` for the ordinary `node:http` callback shape:

```ts
import { createServer } from "node:http";
import { createRequestHandlerEffect } from "@effect-ui/start";
import { createNodeServerHandler } from "@effect-ui/start-node";
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
import { createRequestHandlerEffect } from "@effect-ui/start";
import { createFetchHandler } from "@effect-ui/start-fetch";
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
import { createRequestHandlerEffect } from "@effect-ui/start";
import { createFetchHandler } from "@effect-ui/start-fetch";
import { app } from "./app-definition.js";

const fetch = createFetchHandler(createRequestHandlerEffect(app), {
  runtime: app.runtime,
});

Bun.serve({
  fetch,
});
```

Vercel and Netlify Node functions should use `@effect-ui/start-node` when the
host provides Node `IncomingMessage`/`ServerResponse` values. Prefer
`@effect-ui/start-fetch` for their edge runtimes.

Static and SPA-only hosts can use the app build output directly when a route
does not need SSR, request-local Resource Stores, server functions, or Start
actions. Keep those routes separate from the full-stack SSR handler so the
deployment mode is explicit.

## Current Limits

- Host-specific packages for Cloudflare, Vercel, Netlify, Bun, or static hosts
  are not split out yet. Node HTTP and generic Fetch hosts have package facades
  and platform recipes.
- Static and SPA-only deployment remains a recipe, not a dedicated package.
- Package publication still needs final repository metadata and real version
  numbers before npm release, but framework package manifests are already
  publishable public scoped packages.

Until platform-specific packages exist, keep those deployment integrations as
small wrappers over `createRequestHandlerEffect(app)` and the tested adapters
above.
