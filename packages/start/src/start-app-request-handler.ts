import {
  isActionDefinition,
  isServerFunction,
  Resource,
  Signal,
  type Action,
  type Route,
  type RuntimeSource,
  type Server,
} from "@sunfall/arc-core";
import {
  settledRouteHead,
  storeResourceRefs,
  type ActionDefinitionRequirements,
  type AppDefinitionRegistry,
  type ServerFunctionRequirements,
} from "@sunfall/arc-core/internal";
import { Component } from "@sunfall/arc-solid";
import { createComponent, generateHydrationScript, renderToString } from "@solidjs/web";
import { Effect } from "effect";
import type { RequestRuntimeProvidedRequirements } from "./request-runtime.js";
import type { StartActionDefinition } from "./start-action-request-codec.js";
import type { App, AppDefinition } from "./start-app.js";
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
import { completeResponse } from "./streaming.js";
import { documentWithClientAssets } from "./start-client-assets.js";
import {
  createStartHydrationPayload,
  createStreamHydrationScript,
  type StartHydrationPayload,
} from "./hydration.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;
type AnyServerFunction = Server.Fn<any, any, any, any>;
type AnyAction = Action.Definition<any, any, any, any>;

/**
 * One server implementation Start serves: a served Action's
 * `Action.implement(...)`, a served Resource's `Resource.implement(...)`, or
 * a `Server.implement(...)` server function.
 */
export type StartImplementation = AnyAction | AnyServerFunction;

/** Options for `createRequestHandler(app, options)`: the server half of a Start app. */
export interface CreateRequestHandlerOptions<
  Routes extends readonly AnyRoute[] = readonly AnyRoute[],
  ServerServices = never,
  ServerError = never,
  Implementations extends StartImplementation = never,
> {
  /**
   * Server services: a Layer, ManagedRuntime, or SunfallArcRuntime. Each
   * request runs route preloads, the root render, and the implementations
   * on a request runtime derived from it.
   */
  readonly server?: RuntimeSource<ServerServices, ServerError>;
  /**
   * What the server runs for the app's served Actions and Resources
   * (`Action.implement(...)`, `Resource.implement(...)`) and its other
   * server functions (`Server.implement(...)`). They live in `*.server.ts`
   * modules, which never reach the browser bundle.
   */
  readonly implementations?: ReadonlyArray<Implementations>;
  /**
   * The document's language, links, browser entry, and response headers, per
   * request. The head's title and `<meta>` tags come from the matched route's
   * `head` through `App.define({ head })`.
   */
  readonly document?: (context: StartDocumentContext<Routes>) => StartDocument;
}

type ImplementedActions<Implementations> = Extract<Implementations, AnyAction>;
type ImplementedServerFunctions<Implementations> = Extract<Implementations, AnyServerFunction>;

type ServerRegistry<Implementations> = AppDefinitionRegistry<
  ImplementedActions<Implementations>,
  ImplementedServerFunctions<Implementations>
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

const htmlHeaders = (input: Readonly<Record<string, string>> | undefined): Headers => {
  const headers = new Headers(input);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return headers;
};

const renderAppDocumentEffect = <Routes extends readonly AnyRoute[], ServerServices, ServerError>(
  app: AppDefinition<Routes, any, any, any>,
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
    // The head of the page the render's router settled on, read after the
    // render so it is the page the body shows. A root without a router has
    // no route head.
    const settled = Signal.peek(settledRouteHead(context.resourceStore));
    const head = app.head(
      settled?.head ?? {},
      settled?.status ?? (context.match === undefined ? "NotFound" : "Ready"),
    );
    const shell = renderStartDocumentShell(page, head, {
      solidHydration: generateHydrationScript(),
      rootHydration: context.hydrationPlan.root.script,
    });
    return renderedResourcesChunk(context).pipe(
      Effect.flatMap((rendered) =>
        Effect.forEach(
          rendered === undefined
            ? context.hydrationPlan.resourceChunks
            : [...context.hydrationPlan.resourceChunks, rendered],
          (payload, sequence) => createStreamHydrationScript(payload, sequence),
        ),
      ),
      // Payloads hold schema-encoded values, so serializing them cannot fail
      // unless an encoder produced something JSON cannot carry: a defect.
      Effect.orDie,
      // Rendered to a string, the page is complete: one body, written at once,
      // with the Resource hydration chunks after the root.
      Effect.map((hydrationScripts) =>
        completeResponse(
          `${shell.open}${body}${shell.closeRoot}${hydrationScripts.join("")}${shell.close}`,
          { headers: htmlHeaders(page.headers) },
        ),
      ),
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
  ServerServices,
  Implementations,
> = StartRequestHandler<
  StartRequestRequirements<
    Routes,
    ServerServices,
    ServerRegistry<Implementations>,
    ImplementedActions<Implementations>
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
 * app's root into Start's document, and the served Actions, Resources, and
 * server functions (`implementations`) over the action and RPC endpoints.
 *
 * Each page request preloads the matched route on a request runtime built from
 * `server`, renders `app.root` with `Component.embed`, and answers the
 * complete document with the hydration payload `App.launch` restores. The returned
 * handler is platform-neutral and returns an Effect; host adapters
 * (`@sunfall/arc-start/fetch`, `@sunfall/arc-start/node`) run it.
 *
 * @example
 * ```ts
 * export const handleRequest = createRequestHandler(app, {
 *   server: AppServerLive,
 *   implementations: [renameProject, projectById],
 *   document: () => ({ headers: { "cache-control": "no-store" } }),
 * });
 * ```
 */
export function createRequestHandler<
  const Routes extends readonly AnyRoute[],
  RootServices,
  ClientServices,
  ClientError,
>(
  app: AppDefinition<Routes, RootServices, ClientServices, ClientError> &
    ServerlessApp<RootServices>,
): AppRequestHandler<Routes, never, never>;
export function createRequestHandler<
  const Routes extends readonly AnyRoute[],
  RootServices,
  ClientServices,
  ClientError,
  ServerServices = never,
  ServerError = never,
  Implementations extends StartImplementation = never,
>(
  app: AppDefinition<Routes, RootServices, ClientServices, ClientError>,
  options: CreateRequestHandlerOptions<Routes, ServerServices, ServerError, Implementations> &
    ServerServicesCheck<
      | RootServices
      | ServerFunctionRequirements<ImplementedServerFunctions<Implementations>>
      | ActionDefinitionRequirements<ImplementedActions<Implementations>>,
      ServerServices
    >,
): AppRequestHandler<Routes, ServerServices, Implementations>;
export function createRequestHandler<
  const Routes extends readonly AnyRoute[],
  RootServices,
  ClientServices,
  ClientError,
  ServerServices,
  ServerError,
  Implementations extends StartImplementation,
>(
  app: AppDefinition<Routes, RootServices, ClientServices, ClientError>,
  options?: CreateRequestHandlerOptions<Routes, ServerServices, ServerError, Implementations>,
): AppRequestHandler<Routes, ServerServices, Implementations> {
  const serverOptions: CreateRequestHandlerOptions<
    Routes,
    ServerServices,
    ServerError,
    Implementations
  > = options ?? {};
  const implementations: ReadonlyArray<StartImplementation> = serverOptions.implementations ?? [];
  const actions = implementations.filter((implementation): implementation is AnyAction =>
    isActionDefinition(implementation),
  ) as ReadonlyArray<StartActionDefinition>;
  const serverApp = makeStartServerApp({
    routes: app.routes,
    ...(serverOptions.server === undefined ? {} : { server: serverOptions.server }),
    registry: {
      actions,
      serverFunctions: implementations.filter(isServerFunction),
    },
  });
  const handler = createStartRequestHandler(serverApp as never, {
    actions,
    render: (context) =>
      renderAppDocumentEffect(
        app,
        serverOptions.document,
        context as StartRenderContext<Routes, ServerServices, ServerError, any>,
      ),
  });
  return handler as AppRequestHandler<Routes, ServerServices, Implementations>;
}
