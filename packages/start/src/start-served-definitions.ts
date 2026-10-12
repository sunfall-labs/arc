import type { Server } from "@sunfall/arc-core";
import type { StartActionDefinition } from "./start-action-request-codec.js";

/**
 * What a Start request handler serves: the app's Actions and the handler's
 * server functions. `createRequestHandler` attaches it to the handler so the
 * Vite plugin can derive the manifests from the server entry.
 */
export interface StartServedDefinitions {
  readonly actions: ReadonlyArray<StartActionDefinition>;
  readonly serverFunctions: ReadonlyArray<Server.Fn<any, any, any, any>>;
}

/** Property key carrying `StartServedDefinitions` on a Start request handler. */
export const startServedDefinitionsKey: unique symbol = Symbol.for(
  "@sunfall/arc-start/served-definitions",
);

/** Attaches what a handler serves, without changing how it is called. */
export const attachStartServedDefinitions = <Handler extends object>(
  handler: Handler,
  served: StartServedDefinitions,
): Handler => {
  Object.defineProperty(handler, startServedDefinitionsKey, { value: served });
  return handler;
};

/** Reads what a handler serves, if `createRequestHandler` built it. */
export const startServedDefinitionsOf = (handler: unknown): StartServedDefinitions | undefined =>
  typeof handler === "function" || (typeof handler === "object" && handler !== null)
    ? ((handler as { readonly [startServedDefinitionsKey]?: StartServedDefinitions })[
        startServedDefinitionsKey
      ] ?? undefined)
    : undefined;
