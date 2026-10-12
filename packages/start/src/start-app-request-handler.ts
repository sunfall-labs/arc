import { Resource, type Route, type RuntimeSource, type Server } from "@sunfall/arc-core";
import {
  storeResourceRefs,
  type ActionDefinitionRequirements,
  type AppDefinitionRegistry,
  type ServerFunctionRequirements,
} from "@sunfall/arc-core/internal";
import { Component } from "@sunfall/arc-solid";
import { createComponent, generateHydrationScript, renderToString } from "@solidjs/web";
import { Effect, Stream } from "effect";
import type { RequestRuntimeProvidedRequirements } from "./request-runtime.js";
import type { App, AppDefinition } from "./start-app.js";
import type { StartActionDefinition } from "./start-action-request-codec.js";
import {
  renderStartDocumentShell,
  type StartDocument,
  type StartDocumentContext,
} from "./start-document.js";
import {
  createStartRequestHandler,
  type StartRenderContext,
  type StartRequestHandler,
  type StartRequestRequirements,
} from "./start-request-handler.js";
import { makeStartServerApp } from "./start-server-app.js";
import { attachStartHandlerRoutes } from "./start-route-preload-warnings.js";
import { createStartStreamedHtmlResponse, htmlChunk } from "./streaming.js";
import { documentWithClientAssets } from "./start-client-assets.js";
import { createStartHydrationPayload, type StartHydrationPayload } from "./hydration.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;
type AnyServerFunction = Server.Fn<any, any, any, any>;

/** Options for `createRequestHandler(app, options)`: the server half of a Start app. */
export interface CreateRequestHandlerOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ServerServices = never,
  ServerError = never,
  ServerFunctions extends AnyServerFunction = never,
> {
  /**
   * Server services: a Layer, ManagedRuntime, or SunfallArcRuntime. Each
   * request runs route preloads, the root render, server functions, and
   * Actions on a request runtime derived from it.
   */
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  /** Server-function implementations served over RPC (`Server.implement(...)` values). */
  readonly serverFunctions?: ReadonlyArray<ServerFunctions>;
  /** The page's head and response headers, per request. */
  readonly document?: (context: StartDocumentContext<Routes>) => StartDocument;
}

type ServerRegistry<Actions extends StartActionDefinition, ServerFunctions> = AppDefinitionRegistry<
  [Actions] extends [never] ? never : Actions,
  ServerFunctions extends AnyServerFunction ? ServerFunctions : never
>;

/**
 * Compile-time check that the server runtime (plus what each request runtime
 * adds) provides every service the server runs: the root tree, the served
 * server functions, and the served Actions.
 */
type ServerServicesCheck<RootServices, ServerServices> = [
  Exclude<RootServices, RequestRuntimeProvidedRequirements<ServerServices>>,
] extends [never]
  ? {}
  : {
      readonly server: {
        readonly "server Layer is missing services the app needs": Exclude<
          RootServices,
          RequestRuntimeProvidedRequirements<ServerServices>
        >;
      };
    };

const renderAppDocumentEffect = <Routes extends readonly AnyRoute[], ServerServices, ServerError>(
  app: AppDefinition<Routes, any, any, any, any>,
  document: ((context: StartDocumentContext<Routes>) => StartDocument) | undefined,
  context: StartRenderContext<Routes, ServerServices, ServerError, any>,
): Effect.Effect<Response> =>
  Effect.suspend(() => {
    const url = new URL(context.request.url);
    const props: App.RootProps = { href: `${url.pathname}${url.search}` };
    const declared = document?.({ request: context.request, match: context.match }) ?? {};
    const page =
      context.clientAssets === undefined
        ? declared
        : documentWithClientAssets(declared, context.clientAssets, context.match);
    // The same tree `App.launch` hydrates in the browser.
    const Root = Component.embed(
      app.root as Component<App.RootProps, never, never>,
      context.runtime as never,
    );
    const body = renderToString(() => createComponent(Root, props));
    const shell = renderStartDocumentShell(page, {
      solidHydration: generateHydrationScript(),
      rootHydration: context.hydrationPlan.root.script,
    });
    return renderedResourcesChunk(context).pipe(
      Effect.map((rendered) =>
        createStartStreamedHtmlResponse({
          shell: htmlChunk(shell.open),
          chunks: Stream.make(htmlChunk(`${body}${shell.closeRoot}`)),
          hydrationPlan:
            rendered === undefined
              ? context.hydrationPlan
              : {
                  ...context.hydrationPlan,
                  streamedResourceChunks: [
                    ...context.hydrationPlan.streamedResourceChunks,
                    rendered,
                  ],
                },
          tail: htmlChunk(shell.close),
          ...(page.headers === undefined ? {} : { headers: page.headers }),
        }),
      ),
      Effect.flatten,
    );
  });

/**
 * The Resources the render itself loaded (reads the route did not preload
 * that settled while rendering), as one more hydration chunk, so the
 * hydrating client starts from the values the server rendered instead of
 * loading them again over different markup.
 */
const renderedResourcesChunk = <Routes extends readonly AnyRoute[], ServerServices, ServerError>(
  context: StartRenderContext<Routes, ServerServices, ServerError, any>,
): Effect.Effect<StartHydrationPayload | undefined> => {
  const preloaded = new Set(
    context.resources.resources.map((resource) => `${resource.name}\u0000${resource.key}`),
  );
  const rendered = storeResourceRefs(context.resourceStore).filter(
    (ref) => !preloaded.has(`${ref.family.options.name}\u0000${ref.key}`),
  );
  return rendered.length === 0
    ? Effect.succeed(undefined)
    : context.runtime.provide(Resource.hydrationPayload(rendered)).pipe(
        Effect.map((payload) =>
          payload.resources.length === 0 ? undefined : createStartHydrationPayload(payload),
        ),
        // A value that does not encode stays unhydrated: the client loads it.
        Effect.orElseSucceed(() => undefined),
      );
};

/** The handler `createRequestHandler` returns for an app and its server options. */
type AppRequestHandler<
  Routes extends readonly AnyRoute[],
  Actions extends StartActionDefinition,
  ServerServices,
  ServerFunctions extends AnyServerFunction,
> = StartRequestHandler<
  StartRequestRequirements<
    Routes,
    ServerServices,
    ServerRegistry<Actions, ServerFunctions>,
    Actions
  >
>;

/** An app the server can render with no server Layer: its root needs no services of its own. */
type ServerlessApp<RootServices> = [
  Exclude<RootServices, RequestRuntimeProvidedRequirements<never>>,
] extends [never]
  ? unknown
  : {
      readonly "createRequestHandler needs a server Layer for": Exclude<
        RootServices,
        RequestRuntimeProvidedRequirements<never>
      >;
    };

/**
 * Builds the Start request handler for an app: server-side rendering of the
 * app's root into Start's document, server-function RPC, and Action requests.
 *
 * Each page request preloads the matched route on a request runtime built from
 * `server`, renders `app.root` with `Component.embed`, and streams the
 * document with the hydration payload `App.launch` restores. The returned
 * handler is platform-neutral and returns an Effect; host adapters
 * (`@sunfall/arc-start/fetch`, `@sunfall/arc-start/node`) run it.
 *
 * @example
 * ```ts
 * export const handleRequest = createRequestHandler(app, {
 *   server: AppServerLive,
 *   serverFunctions: [getProject],
 *   document: () => ({ title: "Projects" }),
 * });
 * ```
 */
export function createRequestHandler<
  const Routes extends readonly AnyRoute[],
  RootServices,
  Actions extends StartActionDefinition,
  ClientServices,
  ClientError,
>(
  app: AppDefinition<Routes, RootServices, Actions, ClientServices, ClientError> &
    ServerlessApp<RootServices>,
): AppRequestHandler<Routes, Actions, never, never>;
export function createRequestHandler<
  const Routes extends readonly AnyRoute[],
  RootServices,
  Actions extends StartActionDefinition,
  ClientServices,
  ClientError,
  ServerServices = never,
  ServerError = never,
  ServerFunctions extends AnyServerFunction = never,
>(
  app: AppDefinition<Routes, RootServices, Actions, ClientServices, ClientError>,
  options: CreateRequestHandlerOptions<Routes, ServerServices, ServerError, ServerFunctions> &
    ServerServicesCheck<
      | RootServices
      | ServerFunctionRequirements<ServerFunctions>
      | ActionDefinitionRequirements<Actions>,
      ServerServices
    >,
): AppRequestHandler<Routes, Actions, ServerServices, ServerFunctions>;
export function createRequestHandler<
  const Routes extends readonly AnyRoute[],
  RootServices,
  Actions extends StartActionDefinition,
  ClientServices,
  ClientError,
  ServerServices,
  ServerError,
  ServerFunctions extends AnyServerFunction,
>(
  app: AppDefinition<Routes, RootServices, Actions, ClientServices, ClientError>,
  options?: CreateRequestHandlerOptions<Routes, ServerServices, ServerError, ServerFunctions>,
): AppRequestHandler<Routes, Actions, ServerServices, ServerFunctions> {
  const serverOptions: CreateRequestHandlerOptions<
    Routes,
    ServerServices,
    ServerError,
    ServerFunctions
  > = options ?? {};
  const serverApp = makeStartServerApp({
    routes: app.routes,
    ...(serverOptions.server === undefined ? {} : { server: serverOptions.server }),
    registry: {
      actions: app.actions,
      serverFunctions: serverOptions.serverFunctions ?? [],
    },
  });
  const handler = createStartRequestHandler(serverApp as never, {
    actions: app.actions,
    render: (context) =>
      renderAppDocumentEffect(
        app,
        serverOptions.document,
        context as StartRenderContext<Routes, ServerServices, ServerError, any>,
      ),
  });
  // Vite dev SSR reads the routes to warn about undeclared preload resources.
  return attachStartHandlerRoutes(handler, app.routes) as AppRequestHandler<
    Routes,
    Actions,
    ServerServices,
    ServerFunctions
  >;
}
