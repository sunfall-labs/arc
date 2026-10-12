import {
  Action,
  makeRuntime,
  Route,
  type ActionTransport,
  type Resource,
  type ServerClient,
} from "@sunfall/arc-core";
import type { Collection } from "@sunfall/arc-db";
import { Component } from "@sunfall/arc-solid";
import { Data, Effect, Layer, Option } from "effect";
import { KeyValueStore } from "effect/persistence";
import { hydrateFromDocument, type StartHydrationError } from "./hydration.js";
import { makeActionTransportLayer } from "./start-action-transport.js";
import type { StartActionDefinition } from "./start-action-request-codec.js";
import { startRootElementId } from "./start-document.js";
import type { StartFetch } from "./start-fetch.js";
import { makeRpcClientLayer } from "./start-rpc-client.js";
import type { StartTransportEndpointOverrides } from "./start-transport-endpoints.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

/**
 * Set by the Start Vite plugin: `false` in static-client builds
 * (`buildPolicy.staticClient`), which compiles the RPC client out of
 * `App.launch`. Undefined outside Vite (tests), where RPC stays on.
 */
declare const __SUNFALL_ARC_BROWSER_RPC__: boolean | undefined;

/**
 * A Start app: the one definition the server handler and the browser entry
 * both derive their wiring from.
 *
 * `RootServices` are the services the root Component tree needs (its own,
 * its route Components', and its route preloads'). The client Layer provides
 * them in the browser; the server Layer given to `createRequestHandler`
 * provides them on the server.
 */
export interface AppDefinition<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  RootServices = never,
  Actions extends StartActionDefinition = StartActionDefinition,
  ClientServices = never,
  ClientError = never,
> {
  /** The root Component, rendered by the server and hydrated by `App.launch`. */
  readonly root: Component<App.RootProps, never, RootServices>;
  /** Route definitions the server matches and preloads per request. */
  readonly routes: Routes;
  /** Collections whose snapshots hydrate from the server and from Action responses. */
  readonly collections: ReadonlyArray<Collection.Any>;
  /** Actions the server serves; the browser submits them over the action transport. */
  readonly actions: ReadonlyArray<Actions>;
  /** Browser services; `App.launch` builds the browser runtime from it. */
  readonly client: Layer.Layer<ClientServices, ClientError>;
}

/** Any app definition, for APIs that accept every app. */
export type AnyAppDefinition = AppDefinition<readonly AnyRoute[], any, any, any, any>;

/** Services `App.launch` adds to the client Layer. */
export type AppLaunchServices = ActionTransport | ServerClient;

/** Raised by `App.launch` when the document has no app root element. */
export class StartRootMissing extends Data.TaggedError("StartRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

/** Failures `App.launch` can end with besides the client Layer's own. */
export type AppLaunchError = StartRootMissing | StartHydrationError;

type MissingServices<Required, Provided> = Exclude<Required, Provided>;

/**
 * Compile-time check that the client Layer (plus what `App.launch` adds)
 * provides every service the root tree needs.
 */
type ClientServicesCheck<RootServices, ClientServices> = [
  MissingServices<RootServices, ClientServices | AppLaunchServices>,
] extends [never]
  ? {}
  : {
      readonly client: {
        readonly "client Layer is missing services the root needs": MissingServices<
          RootServices,
          ClientServices | AppLaunchServices
        >;
      };
    };

/**
 * The Action Outbox over the client Layer's `KeyValueStore`, or over an
 * in-memory one when the client Layer provides none.
 */
const outboxLayer = (options: Action.OutboxOptions = {}) =>
  Layer.unwrap(
    Effect.map(Effect.serviceOption(KeyValueStore.KeyValueStore), (store) =>
      Option.isSome(store)
        ? Action.outboxLayer(options).pipe(
            Layer.provide(Layer.succeed(KeyValueStore.KeyValueStore)(store.value)),
          )
        : Action.outboxLayer(options).pipe(Layer.provide(KeyValueStore.layerMemory)),
    ),
  );

/** Start apps: one definition, served by `createRequestHandler` and launched by `App.launch`. */
export namespace App {
  /** Props Start passes the root Component: the app-relative href being rendered. */
  export interface RootProps {
    /** Path plus search of the rendered URL, e.g. `/projects/atlas?tab=activity`. */
    readonly href: string;
  }

  /** Options for `App.launch`. */
  export interface LaunchOptions {
    /**
     * The app-relative href the server rendered. Defaults to
     * `location.pathname + location.search`; pass it when the app is served
     * under a base path.
     */
    readonly href?: string;
    /** Resource hydration policy for the server snapshot (e.g. `timestamp: "now"`). */
    readonly hydration?: Resource.HydrationOptions;
    /** Transport settings for server-function RPC and Action submissions. */
    readonly transport?: {
      readonly endpoints?: StartTransportEndpointOverrides;
      readonly fetch?: StartFetch;
      readonly headers?: HeadersInit | (() => HeadersInit);
    };
    /**
     * Options for the Action Outbox that holds durable Action submissions
     * (`retry`; see `Action.outboxLayer`). The outbox persists to the
     * client Layer's `KeyValueStore` (`effect/persistence`), e.g.
     * `KeyValueStore.layerStorage(() => localStorage)`; without one, pending
     * submissions last only as long as the page.
     */
    readonly outbox?: Action.OutboxOptions;
  }

  /**
   * Defines a Start app.
   *
   * The server and the browser derive everything from it:
   * `createRequestHandler(app, { server })` preloads `routes`, renders `root`
   * into the document, and serves `actions`; `App.launch(app)` builds the
   * browser runtime from `client` plus the action and RPC transports, restores
   * the server's Resource and `collections` snapshot, and hydrates `root`.
   *
   * Keep it in a module both entries import: server-only code (`*.server.ts`
   * Layers and server-function implementations) goes to `createRequestHandler`.
   *
   * @example
   * ```ts
   * export const app = App.define({
   *   root: Root,
   *   routes,
   *   collections: [Projects],
   *   actions: [RenameProject],
   *   client: ProjectApiLive,
   * });
   * ```
   */
  export const define = <
    const Routes extends readonly AnyRoute[],
    RootServices = never,
    Actions extends StartActionDefinition = never,
    ClientServices = never,
    ClientError = never,
  >(
    config: {
      readonly root: Component<RootProps, never, RootServices>;
      readonly routes: Routes;
      readonly collections?: ReadonlyArray<Collection.Any>;
      readonly actions?: ReadonlyArray<Actions>;
      readonly client?: Layer.Layer<ClientServices, ClientError>;
    } & ClientServicesCheck<RootServices, ClientServices>,
  ): AppDefinition<Routes, RootServices, Actions, ClientServices, ClientError> => ({
    root: config.root,
    routes: config.routes,
    collections: config.collections ?? [],
    actions: config.actions ?? [],
    client: (config.client ?? Layer.empty) as Layer.Layer<ClientServices, ClientError>,
  });

  /**
   * The browser entry: builds the client runtime (the app's client Layer plus
   * the action transport, the Action Outbox, and, outside static builds, the
   * RPC client), restores the server's hydration payload into it, hydrates the
   * server-rendered root, and then restores pending durable Action
   * submissions. Like `Component.launch`, it keeps the app mounted until
   * interrupted, then disposes the tree and the runtime.
   *
   * @example
   * ```ts
   * Effect.runFork(App.launch(app));
   * ```
   */
  export const launch = <
    Routes extends readonly AnyRoute[],
    RootServices,
    Actions extends StartActionDefinition,
    ClientServices,
    ClientError,
  >(
    app: AppDefinition<Routes, RootServices, Actions, ClientServices, ClientError>,
    options: LaunchOptions = {},
  ): Effect.Effect<never, ClientError | AppLaunchError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const container = globalThis.document?.getElementById(startRootElementId);
        if (!container) {
          return yield* new StartRootMissing({
            id: startRootElementId,
            guidance: `App.launch hydrates the element with id="${startRootElementId}" that Start's document renders. Load the browser entry from a page served by createRequestHandler.`,
          });
        }
        const transport = {
          ...(options.transport?.endpoints === undefined
            ? {}
            : { endpoints: options.transport.endpoints }),
          ...(options.transport?.fetch === undefined ? {} : { fetch: options.transport.fetch }),
          ...(options.transport?.headers === undefined
            ? {}
            : { headers: options.transport.headers }),
        };
        const browserRpc =
          typeof __SUNFALL_ARC_BROWSER_RPC__ === "undefined" || __SUNFALL_ARC_BROWSER_RPC__;
        const runtime = yield* Effect.acquireRelease(
          Effect.sync(() =>
            makeRuntime(
              outboxLayer(options.outbox).pipe(
                Layer.provideMerge(
                  Layer.mergeAll(
                    app.client,
                    makeActionTransportLayer({
                      ...transport,
                      actions: app.actions,
                      collections: app.collections,
                    }),
                    browserRpc ? makeRpcClientLayer(transport) : Layer.empty,
                  ),
                ),
              ) as Layer.Layer<ClientServices | AppLaunchServices, ClientError>,
            ),
          ),
          (owned) => owned.dispose.pipe(Effect.ignore({ log: true })),
        );
        yield* runtime.provide(
          hydrateFromDocument(globalThis.document, {
            ...options.hydration,
            collections: app.collections,
          }),
        );
        const href = options.href ?? `${location.pathname}${location.search}`;
        // A code-split route component must be loaded before hydrating, so the
        // first client pass renders the markup the server rendered. A failed
        // load surfaces where the router renders the route.
        yield* Effect.try(() => Route.match(app.routes, href)).pipe(
          Effect.flatMap((match) =>
            match === undefined ? Effect.void : Route.preloadComponent(match),
          ),
          Effect.ignore,
        );
        yield* Component.mount(
          app.root as Component<RootProps, never, ClientServices | AppLaunchServices>,
          container,
          { runtime, props: { href }, hydrate: true },
        );
        // Pending durable submissions re-apply their optimistic patches after
        // hydration (so the first client render matches the server's), then
        // replay.
        yield* runtime.provide(Action.restoreOutbox);
        return yield* Effect.never;
      }),
    );
}
