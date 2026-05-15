# Start Effect RPC Compatibility

## Decision

The smallest safe adoption step is an additive Effect RPC compatibility layer for
Start server functions. Start keeps `POST /__effect-ui/rpc` as the default JSON
transport while the shared endpoint policy can override the path through
manifests, request handlers, Vite dev SSR, and clients. `@effect-ui/start` can
now describe live `Server.fn` contracts as `effect/unstable/rpc` `Rpc`
descriptors and an `RpcGroup`.

This compatibility layer does not own progressive action form encoding.
`@effect-ui/start` keeps the Start Action Request Codec as the shared Interface
for JSON action clients and form hidden-field payloads.

## Primitives Evaluated

- `effect/unstable/rpc`: closest match. `Rpc.make` maps cleanly from server
  function name, input schema, output schema, and error schema. `RpcGroup.make`
  can group the generated descriptors.
- `effect/unstable/httpapi`: useful later for route/action OpenAPI, but not the
  best fit for the current Start server function wire protocol because server
  function dispatch is name-keyed inside one JSON RPC endpoint.
- `effect/unstable/http`: useful later for platform adapters and request/response
  conversion, but adopting it in the current handler would rewrite transport
  execution rather than prepare it.

## Current Compatibility

The new compatibility artifact records:

- Start RPC endpoint method, path, media types, protocol version, and diagnostic
  headers.
- One Effect RPC procedure per server function manifest entry.
- Whether each procedure has payload, success, and error schemas.
- Known blockers before replacing the transport with Effect RPC server/client
  protocols.

Live server functions can produce actual `Rpc` descriptors. Production manifests
cannot, because they intentionally store schema presence booleans instead of
schema values.

## Next Steps

1. Generate compatibility artifacts beside the Start app graph so downstream
   tooling can inspect RPC procedures without importing app code.
2. Add an optional development-only path that builds `RpcGroup` from live
   registered server functions and compares it with the manifest artifact.
3. Prototype an Effect `RpcServer` handler behind a feature flag once the
   unstable protocol envelope can round-trip Start's current success, failure,
   server error, and defect tags.
4. Evaluate `HttpApi` separately for action endpoints and file routes, where
   path/method-oriented metadata is a better fit.
