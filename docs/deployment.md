# Deployment

Effect UI deployment currently centers on the Start request boundary:
`createRequestHandlerEffect(app)`. Host adapters should stay thin. They convert
platform requests into Web `Request` values, run the Effect handler through the
app runtime, and write the Web `Response` back to the host.

The tested adapter implementation lives in `@effect-ui/start/adapters`.
Deployment-facing package facades are split by host shape:
`@effect-ui/start-fetch` for Fetch-style hosts and `@effect-ui/start-node` for
Node HTTP.

## Fetch And Edge-Style Hosts

Use the Effect form when the host integration can run through the app runtime:

```ts
import { createRequestHandlerEffect } from "@effect-ui/start";
import { toFetchHandlerEffect } from "@effect-ui/start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandlerEffect(createRequestHandlerEffect(app));

export default {
  fetch(request: Request): Promise<Response> {
    return app.runtime.runPromise(fetchEffect(request));
  }
};
```

`toFetchHandler` is the same Effect-shaped adapter for the public
`createRequestHandler` alias:

```ts
import { createRequestHandler } from "@effect-ui/start";
import { toFetchHandler } from "@effect-ui/start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandler(createRequestHandler(app));

export default {
  fetch(request: Request): Promise<Response> {
    return app.runtime.runPromise(fetchEffect(request));
  }
};
```

## Node HTTP

Use `createNodeHandlerEffect` or its `createNodeHandler` alias to build an
Effect program. The `node:http` callback is the host boundary that runs it.

```ts
import { createServer } from "node:http";
import { Effect } from "effect";
import { createRequestHandlerEffect } from "@effect-ui/start";
import { createNodeHandler } from "@effect-ui/start-node";
import { app } from "./app-definition.js";

const handler = createNodeHandler(createRequestHandlerEffect(app), {
  origin: (request) =>
    `${request.headers["x-forwarded-proto"] ?? "http"}://${request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost"}`
});

createServer((request, response) => {
  void app.runtime.runPromise(
    handler(request, response).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          response.statusCode = 500;
          response.end(String(error));
        })
      )
    )
  );
}).listen(3000);
```

The Node adapter is covered for:

- forwarded origin handling through `x-forwarded-proto` and
  `x-forwarded-host`;
- request bodies for non-`GET`/`HEAD` methods;
- bodyless `HEAD` responses;
- streaming Web `Response` bodies through Node backpressure;
- preserving multiple `Set-Cookie` headers.

## Platform Recipes

Cloudflare Workers, Vercel Edge, Netlify Edge, and other Fetch-native hosts
should start from the generic Fetch facade:

```ts
import { createRequestHandlerEffect } from "@effect-ui/start";
import { toFetchHandlerEffect } from "@effect-ui/start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandlerEffect(createRequestHandlerEffect(app));

export default {
  fetch(request: Request): Promise<Response> {
    return app.runtime.runPromise(fetchEffect(request));
  }
};
```

Bun's HTTP server can use the same Fetch-shaped boundary:

```ts
import { createRequestHandlerEffect } from "@effect-ui/start";
import { toFetchHandlerEffect } from "@effect-ui/start-fetch";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandlerEffect(createRequestHandlerEffect(app));

Bun.serve({
  fetch: (request) => app.runtime.runPromise(fetchEffect(request))
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
- Package publication remains blocked on the release decision to flip
  `private` package manifests and publish real versions.

Until platform-specific packages exist, keep those deployment integrations as
small wrappers over `createRequestHandlerEffect(app)` and the tested adapters
above.
