# Deployment

Effect UI deployment currently centers on the Start request boundary:
`createRequestHandlerEffect(app)`. Host adapters should stay thin. They convert
platform requests into Web `Request` values, run the Effect handler through the
app runtime, and write the Web `Response` back to the host.

The tested adapter surface lives in `@effect-ui/start/adapters`.

## Fetch And Edge-Style Hosts

Use the Effect form when the host integration can run through the app runtime:

```ts
import { createRequestHandlerEffect } from "@effect-ui/start";
import { toFetchHandlerEffect } from "@effect-ui/start/adapters";
import { app } from "./app-definition.js";

const fetchEffect = toFetchHandlerEffect(createRequestHandlerEffect(app));

export default {
  fetch(request: Request): Promise<Response> {
    return app.runtime.runPromise(fetchEffect(request));
  }
};
```

For a host or test that already expects a Promise handler, use the Promise
adapter over the Promise request boundary:

```ts
import { createRequestHandler } from "@effect-ui/start";
import { toFetchHandler } from "@effect-ui/start/adapters";
import { app } from "./app-definition.js";

export const fetch = toFetchHandler(createRequestHandler(app));
```

## Node HTTP

Use `createNodeHandlerEffect` when composing inside an Effect program and
`createNodeHandler` when passing a callback to `node:http`.

```ts
import { createServer } from "node:http";
import { createRequestHandlerEffect } from "@effect-ui/start";
import { createNodeHandler } from "@effect-ui/start/adapters";
import { app } from "./app-definition.js";

const handler = createNodeHandler(createRequestHandlerEffect(app), {
  origin: (request) =>
    `${request.headers["x-forwarded-proto"] ?? "http"}://${request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost"}`
});

createServer((request, response) => {
  void handler(request, response).catch((error) => {
    response.statusCode = 500;
    response.end(String(error));
  });
}).listen(3000);
```

The Node adapter is covered for:

- forwarded origin handling through `x-forwarded-proto` and
  `x-forwarded-host`;
- request bodies for non-`GET`/`HEAD` methods;
- bodyless `HEAD` responses;
- streaming Web `Response` bodies through Node backpressure;
- preserving multiple `Set-Cookie` headers.

## Current Limits

- Host-specific packages for Cloudflare, Vercel, Netlify, Bun, or static hosts
  are not split out yet.
- Static and SPA-only deployment recipes still need an explicit starter path.
- Package publication remains blocked on the release decision to flip
  `private` package manifests and publish real versions.

Until those packages exist, keep deployment integrations as small wrappers over
`createRequestHandlerEffect(app)` and the tested adapters above.
