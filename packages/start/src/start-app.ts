import {
  Action,
  makeRuntime,
  Route,
  Signal,
  type ActionTransport,
  type ResourceStore,
  type Resource,
  type Server,
} from "@sunfall/arc-core";
import { PostedActions, settledRouteHead } from "@sunfall/arc-core/internal";
import { Component } from "@sunfall/arc-solid";
import { Cause, Data, Effect, Layer, Option } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import { KeyValueStore } from "effect/persistence";
import { hydrateFromDocument, type StartHydrationError } from "./hydration.js";
import { postedActionSubmission } from "./start-action-form-post.js";
import { startActionOutboxCookie } from "./start-action-outbox-cookie.js";
import { actionTransportLayer } from "./start-action-transport.js";
import { startHeadAttribute, startHeadMetaTags, startRootElementId } from "./start-document.js";
import { rpcClientLayer } from "./start-rpc-client.js";

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
  ClientServices = never,
  ClientError = never,
> {
  /** The root Component, rendered by the server and hydrated by `App.launch`. */
  readonly root: Component<App.RootProps, never, RootServices>;
  /** Route definitions the server matches and preloads per request. */
  readonly routes: Routes;
  /** Browser services; `App.launch` builds the browser runtime from it. */
  readonly client: Layer.Layer<ClientServices, ClientError>;
  /** The document head for a page's route head (see `App.define`). */
  readonly head: (page: Route.Head, status: Route.HeadStatus) => Route.Head;
}

/** Any app definition, for APIs that accept every app. */
export type AnyAppDefinition = AppDefinition<readonly AnyRoute[], any, any, any>;

/**
 * Services `App.launch` adds to the client Layer. `KeyValueStore` is the
 * client Layer's own when it provides one, else Web Storage
 * (`localStorage`), or memory where there is none. `HttpClient` is the
 * client Layer's own when it provides one, else `FetchHttpClient`.
 */
export type AppLaunchServices =
  | ActionTransport
  | Server.Client
  | KeyValueStore.KeyValueStore
  | HttpClient.HttpClient;

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
 * The browser's one `KeyValueStore`, shared by persisted Resources and the
 * Action Outbox: the client Layer's when it provides one, else Web Storage
 * (`localStorage`), or memory where there is no Web Storage.
 */
const clientKeyValueStore = Layer.unwrap(
  Effect.map(Effect.serviceOption(KeyValueStore.KeyValueStore), (store) =>
    Option.isSome(store)
      ? Layer.succeed(KeyValueStore.KeyValueStore)(store.value)
      : typeof globalThis.localStorage === "undefined"
        ? KeyValueStore.layerMemory
        : KeyValueStore.layerStorage(() => globalThis.localStorage),
  ),
);

/**
 * The browser's one `HttpClient`, shared by the server-function `RpcClient`
 * and the action transport: the client Layer's when it provides one (to add
 * headers, retries, or a custom fetch), else `FetchHttpClient`.
 */
const clientHttpClient = Layer.unwrap(
  Effect.map(Effect.serviceOption(HttpClient.HttpClient), (client) =>
    Option.isSome(client)
      ? Layer.succeed(HttpClient.HttpClient)(client.value)
      : FetchHttpClient.layer,
  ),
);

/**
 * Keeps `document.title` and the head's `<meta>` tags (marked
 * `data-arc-head`) in step with the head of the route the app's router
 * settles on, for as long as the scope lives.
 */
const followDocumentHead = (app: AnyAppDefinition, store: ResourceStore) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const head = settledRouteHead(store);
      let applied = "";
      const apply = (): void => {
        const settled = Signal.peek(head);
        if (settled === undefined) {
          return;
        }
        const next = app.head(settled.head, settled.status);
        const serialized = JSON.stringify(next);
        if (serialized !== applied) {
          applied = serialized;
          applyDocumentHead(globalThis.document, next);
        }
      };
      const unsubscribe = head.subscribe(apply);
      apply();
      return unsubscribe;
    }),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

const applyDocumentHead = (document: Document, head: Route.Head): void => {
  if (head.title !== undefined && document.title !== head.title) {
    document.title = head.title;
  }
  const tags = startHeadMetaTags(head);
  const current = Array.from(document.head.querySelectorAll(`meta[${startHeadAttribute}]`));
  const same =
    current.length === tags.length &&
    current.every((element, index) => {
      const attributes = Object.entries(tags[index] ?? {});
      return (
        element.attributes.length === attributes.length + 1 &&
        attributes.every(([name, value]) => element.getAttribute(name) === value)
      );
    });
  if (same) {
    return;
  }
  // Where the server renders them: before the title.
  const title = document.head.querySelector("title");
  for (const element of current) {
    element.remove();
  }
  for (const attributes of tags) {
    const element = document.createElement("meta");
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.setAttribute(startHeadAttribute, "");
    document.head.insertBefore(element, title);
  }
};

/** Start apps: one definition, served by `createRequestHandler` and launched by `App.launch`. */
export namespace App {
  /** A Start app definition built by `App.define`. */
  export type Definition<
    Routes extends readonly AnyRoute[] = readonly AnyRoute[],
    RootServices = never,
    ClientServices = never,
    ClientError = never,
  > = AppDefinition<Routes, RootServices, ClientServices, ClientError>;
  /** Any app definition, for APIs that accept every app. */
  export type Any = AnyAppDefinition;
  /** Services `App.launch` adds to the app's client Layer. */
  export type LaunchServices = AppLaunchServices;
  /** Failures `App.launch` can end with besides the client Layer's own. */
  export type LaunchError = AppLaunchError;

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
    /**
     * Options for the Action Outbox that holds durable Action submissions
     * (`retry`; see `Action.outboxLayer`). The outbox persists to the
     * browser's one `KeyValueStore` (`effect/persistence`), shared with
     * persisted Resources: the client Layer's when it provides one, else
     * `localStorage`.
     */
    readonly outbox?: Action.OutboxOptions;
  }

  /**
   * Defines a Start app.
   *
   * The server and the browser derive everything from it:
   * `createRequestHandler(app, { server, implementations })` preloads
   * `routes`, renders `root` into the document, and serves the served
   * Actions and Resources; `App.launch(app)` builds the browser runtime from
   * `client` plus the action and RPC transports, restores the server's
   * Resource snapshot, and hydrates `root`.
   *
   * Keep it in a module both entries import: server-only code (`*.server.ts`
   * Layers and implementations) goes to `createRequestHandler`.
   *
   * @example
   * ```ts
   * export const app = App.define({
   *   root: Root,
   *   routes,
   *   client: ProjectApiLive,
   *   head: (page) => ({
   *     ...page,
   *     title: page.title === undefined ? "Projects" : `${page.title} · Projects`,
   *   }),
   * });
   * ```
   */
  export const define = <
    const Routes extends readonly AnyRoute[],
    RootServices = never,
    ClientServices = never,
    ClientError = never,
  >(
    config: {
      readonly root: Component<RootProps, never, RootServices>;
      readonly routes: Routes;
      readonly client?: Layer.Layer<ClientServices, ClientError>;
      /**
       * The document head for a page, from the head of its route (`page`:
       * the matched route's `head`, empty for a route without one) and how
       * the page settled (`status`: `Ready`, or `NotFound` and `Failure`,
       * whose `page` is empty). Put the app's title suffix, its fallback and
       * error titles, and the `<meta>` tags every page carries here. Start
       * renders it on the server and re-applies it in the browser when the
       * page's head changes. Defaults to `page` itself.
       */
      readonly head?: (page: Route.Head, status: Route.HeadStatus) => Route.Head;
    } & ClientServicesCheck<RootServices, ClientServices>,
  ): AppDefinition<Routes, RootServices, ClientServices, ClientError> => ({
    root: config.root,
    routes: config.routes,
    client: (config.client ?? Layer.empty) as Layer.Layer<ClientServices, ClientError>,
    head: config.head ?? ((page) => page),
  });

  /**
   * The browser entry: builds the client runtime (the app's client Layer plus
   * the action transport, the Action Outbox, and, outside static builds, the
   * server-function `RpcClient`, both over one `HttpClient`), restores the server's hydration payload into it, hydrates the
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
    ClientServices,
    ClientError,
  >(
    app: AppDefinition<Routes, RootServices, ClientServices, ClientError>,
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
        const browserRpc =
          typeof __SUNFALL_ARC_BROWSER_RPC__ === "undefined" || __SUNFALL_ARC_BROWSER_RPC__;
        // The no-JavaScript form post the server rendered this page for, while
        // the page hydrates: its Action's bindings start from its outcome.
        const postedActions: PostedActions = { current: undefined };
        const runtime = yield* Effect.acquireRelease(
          Effect.sync(() =>
            makeRuntime(
              Action.outboxLayer(options.outbox).pipe(
                Layer.provideMerge(
                  clientKeyValueStore.pipe(
                    Layer.provideMerge(
                      Layer.mergeAll(
                        actionTransportLayer,
                        browserRpc ? rpcClientLayer : Layer.empty,
                        Layer.succeed(PostedActions)(postedActions),
                      ).pipe(Layer.provideMerge(clientHttpClient), Layer.provideMerge(app.client)),
                    ),
                  ),
                ),
              ) as Layer.Layer<ClientServices | AppLaunchServices, ClientError>,
            ),
          ),
          (owned) => owned.dispose.pipe(Effect.ignore({ log: true })),
        );
        const hydration = yield* runtime.provide(
          hydrateFromDocument(globalThis.document, options.hydration),
        );
        if (hydration?.postedAction !== undefined) {
          postedActions.current = postedActionSubmission(hydration.postedAction);
        }
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
        // Hydrated: a binding created later (another visit to the form) starts idle.
        postedActions.current = undefined;
        // The server rendered this page's head; navigations and the Resources
        // a route's head reads change it from here.
        yield* followDocumentHead(app, runtime.resourceStore);
        // The outbox cookie tells the next document request which durable
        // submissions this page holds; the server reports back the ones it
        // already settled (`settledSubmissions`).
        const outbox = yield* runtime.provide(Action.outbox);
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            outbox.pending.subscribe(() => {
              globalThis.document.cookie = startActionOutboxCookie(
                Signal.peek(outbox.pending),
                location.protocol === "https:",
              );
            }),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        // Pending durable submissions re-apply their optimistic patches after
        // hydration (so the first client render matches the server's), then
        // replay. Those the server settled before rendering are already in
        // the hydrated state, so their patches stay off.
        yield* runtime.provide(
          Action.restoreOutbox({ settled: hydration?.settledSubmissions ?? [] }),
        );
        return yield* Effect.never;
      }),
    ).pipe(
      // `Effect.runFork(App.launch(app))` observes nothing: log why the app
      // did not start (a missing root, a client Layer failure, a hydration
      // payload that does not decode) instead of leaving a dead page silent.
      Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError("App.launch failed", cause),
      ),
    );
}
