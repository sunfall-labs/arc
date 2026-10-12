import type { AppDefinitionRegistry, Route, RuntimeSource, Server } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { createComponent, generateHydrationScript, renderToString } from "@solidjs/web";
import { Effect, Stream } from "effect";
import type { RequestRuntimeProvidedRequirements } from "./request-runtime.js";
import type { StartRequestTraceHandler } from "./request-trace.js";
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
import { attachStartServedDefinitions } from "./start-served-definitions.js";
import type { StartTransportEndpointOverrides } from "./start-transport-endpoints.js";
import { createStartStreamedHtmlResponse, htmlChunk } from "./streaming.js";

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
  /** Transport endpoint paths for RPC and Action requests. */
  readonly endpoints?: StartTransportEndpointOverrides;
  /** Receives best-effort request diagnostics after runtime teardown. */
  readonly onRequestTrace?: StartRequestTraceHandler;
}

type ServerRegistry<Actions extends StartActionDefinition, ServerFunctions> = AppDefinitionRegistry<
  [Actions] extends [never] ? never : Actions,
  ServerFunctions extends AnyServerFunction ? ServerFunctions : never
>;

/**
 * Compile-time check that the server runtime (plus what each request runtime
 * adds) provides every service the root tree needs.
 */
type ServerServicesCheck<RootServices, ServerServices> = [
  Exclude<RootServices, RequestRuntimeProvidedRequirements<ServerServices>>,
] extends [never]
  ? {}
  : {
      readonly server: {
        readonly "server Layer is missing services the root needs": Exclude<
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
    const page = document?.({ request: context.request, match: context.match }) ?? {};
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
    return createStartStreamedHtmlResponse({
      shell: htmlChunk(shell.open),
      chunks: Stream.make(htmlChunk(`${body}${shell.closeRoot}`)),
      hydrationPlan: context.hydrationPlan,
      tail: htmlChunk(shell.close),
      ...(page.headers === undefined ? {} : { headers: page.headers }),
    });
  });

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
export const createRequestHandler = <
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
  ...[options]: [Exclude<RootServices, RequestRuntimeProvidedRequirements<never>>] extends [never]
    ? [
        options?: CreateRequestHandlerOptions<
          Routes,
          ServerServices,
          ServerError,
          ServerFunctions
        > &
          ServerServicesCheck<RootServices, ServerServices>,
      ]
    : [
        options: CreateRequestHandlerOptions<Routes, ServerServices, ServerError, ServerFunctions> &
          ServerServicesCheck<RootServices, ServerServices>,
      ]
): StartRequestHandler<
  StartRequestRequirements<
    Routes,
    ServerServices,
    ServerRegistry<Actions, ServerFunctions>,
    Actions
  >
> => {
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
    collections: app.collections,
    actions: app.actions,
    ...(serverOptions.endpoints === undefined ? {} : { endpoints: serverOptions.endpoints }),
    ...(serverOptions.onRequestTrace === undefined
      ? {}
      : { onRequestTrace: serverOptions.onRequestTrace }),
    render: (context) =>
      renderAppDocumentEffect(
        app,
        serverOptions.document,
        context as StartRenderContext<Routes, ServerServices, ServerError, any>,
      ),
  });
  // The Vite plugin reads what the handler serves to derive the app graph.
  return attachStartServedDefinitions(handler, {
    actions: app.actions,
    serverFunctions: serverOptions.serverFunctions ?? [],
  }) as StartRequestHandler<
    StartRequestRequirements<
      Routes,
      ServerServices,
      ServerRegistry<Actions, ServerFunctions>,
      Actions
    >
  >;
};
