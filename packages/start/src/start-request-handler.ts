import {
  Route,
  invokeEffectInput,
  makeResponseContext,
  runWithRuntime,
  type AppDefinition,
  type AppDefinitionRegistry,
  type AppDefinitionRegistryRequirements,
  type ActionDefinitionRequirements,
  type EffectInput,
  type EffectUiRuntime,
  type ResourceStore as ResourceStoreState,
} from "@effect-ui/core";
import { Effect, Scope } from "effect";
import { type StartCollectionHydrationOptions } from "./hydration.js";
import {
  makeRequestRuntime,
  provideRequestRuntime,
  type RequestRuntimeRemainingRequirements,
} from "./request-runtime.js";
import { startRequestTraceFactsEffect, type StartRequestTraceHandler } from "./request-trace.js";
import { runRequestRuntimeLifecycleEffect } from "./request-runtime-lifecycle.js";
import { recordStartRequestTracePreload } from "./request-trace-recorder.js";
import {
  createStartRenderHydrationPlanEffect,
  type StartRenderHydrationPlan,
} from "./render-hydration-plan.js";
import {
  isServerActionRequest,
  isServerRpcRequest,
  makeActionMap,
  type StartActionDefinition,
} from "./start-transport-protocol.js";
import type {
  StartActionEndpointManifest,
  StartServerFunctionEndpointManifest,
  StartTransportEndpointOverrides,
  StartTransportEndpointManifestSource,
} from "./start-transport-endpoints.js";
import { resolveStartTransportEndpointsEffect } from "./start-transport-endpoints.js";
import {
  createServerActionResponseEffectWithRuntime,
  createServerRpcResponseEffectWithRuntime,
} from "./start-request-endpoints.js";
import type {
  StartRequestHandlerInput,
  StartRequestHandlerRequirementsMarker,
} from "./start-host-adapter.js";
import {
  preloadRequestEffectWithRuntime,
  type StartPreloadResult,
} from "./start-request-preload.js";
import {
  normalizeStartRequestHandlerError,
  StartRequestHandlerError,
} from "./start-request-handler-error.js";

export {
  createServerActionResponseEffect,
  createServerRpcResponseEffect,
} from "./start-request-endpoints.js";
export {
  StartPreloadError,
  preloadRequest,
  preloadRequestEffect,
} from "./start-request-preload.js";
export type { StartCollectionPreload, StartPreloadResult } from "./start-request-preload.js";
export { StartRequestHandlerError } from "./start-request-handler-error.js";

/**
 * Per-request context passed to a Start SSR render function.
 *
 * The runtime and resource store are request-scoped. Start disposes them when
 * the response completes, including streamed responses. Non-streaming
 * renderers can include `legacyHydrationScript` in HTML to transfer the full
 * preloaded resource and collection state to the browser. Streaming renderers
 * should use `hydrationPlan` or `hydrationRootScript` so route resources are
 * emitted only through streamed hydration chunks.
 */
export interface StartRenderContext<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[] =
    readonly Route.Definition<string, unknown, unknown, any>[],
  Client = unknown,
  ServerServices = never,
  ServerError = never,
  Registry extends AppDefinitionRegistry = AppDefinitionRegistry,
> extends StartPreloadResult<Routes> {
  readonly request: Request;
  readonly app: AppDefinition<Routes, Client, ServerServices, ServerError, Registry>;
  readonly runtime: EffectUiRuntime<ServerServices, ServerError>;
  readonly resourceStore: ResourceStoreState;
  /** Full hydration payload script for non-streaming renderers. */
  readonly legacyHydrationScript: string;
  /** @deprecated Use `legacyHydrationScript` for full non-streaming payloads or `hydrationRootScript` for streamed renderers. */
  readonly hydrationScript: string;
  /** Root-only hydration script derived from `hydrationPlan` for streamed renderers. */
  readonly hydrationRootScript: string;
  readonly hydrationPlan: StartRenderHydrationPlan;
}

/**
 * Options for the main Start request handler.
 *
 * Configure SSR rendering, the server action set for this handler, and an
 * optional request trace hook. Handler execution stays Effect-first internally;
 * platform adapters decide where any Promise boundary lives.
 */
export interface CreateRequestHandlerOptions<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client = unknown,
  ServerServices = never,
  ServerError = never,
  Actions extends StartActionDefinition = StartActionDefinition,
  Registry extends AppDefinitionRegistry = AppDefinitionRegistry,
> extends StartCollectionHydrationOptions {
  /** Transport endpoint paths used to route RPC/action requests. */
  readonly endpoints?: StartTransportEndpointOverrides;
  /** RPC endpoint path used by this request handler. */
  readonly rpcPath?: string;
  /** Action endpoint path used by this request handler. */
  readonly actionPath?: string;
  /** Server-function manifest whose RPC path should be used by this request handler. */
  readonly serverFunctionManifest?: StartServerFunctionEndpointManifest;
  /** Action manifest whose action path should be used by this request handler. */
  readonly actionManifest?: StartActionEndpointManifest;
  /** App graph whose transport paths should be used by this request handler. */
  readonly appGraph?: StartTransportEndpointManifestSource;
  /** Render the preloaded request context to HTML or a custom Response. */
  readonly render?: (
    context: StartRenderContext<Routes, Client, ServerServices, ServerError, Registry>,
  ) => EffectInput<string | Response>;
  /** Actions served by the action transport. Defaults to globally registered actions. */
  readonly actions?: Iterable<Actions>;
  /** Receives best-effort request diagnostics after runtime teardown. */
  readonly onRequestTrace?: StartRequestTraceHandler;
}

type StartRequestRequirements<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition,
> = RequestRuntimeRemainingRequirements<
  | Route.PreloadRequirements<Routes[number]>
  | AppDefinitionRegistryRequirements<Registry>
  | ActionDefinitionRequirements<Actions>,
  ServerServices
>;

/** Effect-returning request handler used by the Start SSR/RPC/action pipeline. */
export type StartRequestHandlerEffect<Requirements = never> = StartRequestHandlerInput<
  StartRequestHandlerError,
  Scope.Scope | Requirements
> &
  StartRequestHandlerRequirementsMarker<Scope.Scope | Requirements>;
/**
 * Public Effect-returning handler consumed by platform adapters and server entries.
 *
 * This type is the Start library boundary. Fetch and Node adapters expose the
 * host Promise/callback facades; application request handlers stay Effect-first.
 */
export type StartRequestHandler<Requirements = never> = StartRequestHandlerInput<
  StartRequestHandlerError,
  Scope.Scope | Requirements
>;

/**
 * Builds the main Start request handler for SSR, RPC, and actions.
 *
 * The returned handler is platform-neutral and returns an Effect. Fetch, Node,
 * or test hosts should run that Effect at the host boundary, or adapt it with
 * the Start Node/fetch helpers.
 *
 * @example
 * ```ts
 * const handleRequest = createRequestHandlerEffect(app, {
 *   render: ({ hydrationRootScript }) => `<div id="app"></div>${hydrationRootScript}`
 * });
 * ```
 */
export const createRequestHandlerEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client,
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition = never,
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError, Registry>,
  options: CreateRequestHandlerOptions<
    Routes,
    Client,
    ServerServices,
    ServerError,
    Actions,
    Registry
  > = {},
): StartRequestHandlerEffect<
  StartRequestRequirements<Routes, ServerServices, Registry, Actions>
> => {
  const explicitActionMap =
    options.actions === undefined ? undefined : makeActionMap(options.actions);

  return ((
    request: Request,
  ): Effect.Effect<
    Response,
    StartRequestHandlerError,
    Scope.Scope | StartRequestRequirements<Routes, ServerServices, Registry, Actions>
  > =>
    Effect.gen(function* () {
      const endpoints = yield* resolveStartTransportEndpointsEffect(options);
      const requestOptions = {
        ...options,
        endpoints,
      };
      const requestRuntime = makeRequestRuntime(app);
      const responseContext = makeResponseContext();
      const traceFacts = yield* startRequestTraceFactsEffect(request, requestOptions);
      const responseEffect = Effect.gen(function* () {
        if (isServerRpcRequest(request, requestOptions)) {
          return yield* createServerRpcResponseEffectWithRuntime(
            app,
            request,
            requestRuntime,
            responseContext,
            traceFacts,
          );
        }

        if (isServerActionRequest(request, requestOptions)) {
          return yield* createServerActionResponseEffectWithRuntime(
            app,
            request,
            requestRuntime,
            explicitActionMap,
            responseContext,
            traceFacts,
          );
        }

        const preloaded = yield* preloadRequestEffectWithRuntime(
          app,
          request,
          requestRuntime,
          requestOptions,
          responseContext,
        );
        recordStartRequestTracePreload(
          traceFacts,
          requestRuntime,
          preloaded.routePlan,
          preloaded.collectionPreload,
        );
        const hydrationPlan = yield* createStartRenderHydrationPlanEffect({
          resources: preloaded.resources,
          collections: preloaded.collections,
        });
        const context = {
          app,
          request,
          match: preloaded.match,
          resources: preloaded.resources,
          collections: preloaded.collections,
          collectionPreload: preloaded.collectionPreload,
          hydration: preloaded.hydration,
          routePlan: preloaded.routePlan,
          runtime: requestRuntime,
          resourceStore: requestRuntime.resourceStore,
          hydrationRootScript: hydrationPlan.root.script,
          hydrationPlan,
          get legacyHydrationScript() {
            return hydrationPlan.legacy.script;
          },
          get hydrationScript() {
            return hydrationPlan.legacy.script;
          },
        } satisfies StartRenderContext<Routes, Client, ServerServices, ServerError, Registry>;

        if (options.render) {
          const renderEffect = invokeEffectInput("Start.render", () =>
            runWithRuntime(requestRuntime, () => options.render!(context)),
          );
          const rendered = yield* provideRequestRuntime(
            requestRuntime,
            request,
            renderEffect,
            responseContext,
            app.registry,
          );
          return rendered instanceof Response
            ? rendered
            : new Response(rendered, {
                headers: {
                  "content-type": "text/html",
                },
              });
        }

        return new Response(
          JSON.stringify({
            framework: "effect-ui-start",
            fullStack: app.fullStack,
            routes: app.routes.map((routeDefinition) => routeDefinition.path),
            match: preloaded.match?.href,
            resources: preloaded.resources,
            collections: preloaded.collections,
            hydration: preloaded.hydration,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
      });

      return yield* runRequestRuntimeLifecycleEffect({
        request,
        runtime: requestRuntime,
        responseContext,
        traceFacts,
        responseEffect,
        ...(options.onRequestTrace === undefined ? {} : { onRequestTrace: options.onRequestTrace }),
      });
    }).pipe(
      Effect.mapError((cause) => normalizeStartRequestHandlerError(request, cause)),
    ) as Effect.Effect<
      Response,
      StartRequestHandlerError,
      Scope.Scope | StartRequestRequirements<Routes, ServerServices, Registry, Actions>
    >) as StartRequestHandlerEffect<
    StartRequestRequirements<Routes, ServerServices, Registry, Actions>
  >;
};

/**
 * Primary Start request handler factory for server entry modules.
 *
 * The returned handler returns an `Effect`; use the Fetch/Node adapters when a
 * host expects a Promise-returning or callback-style request function.
 */
export const createRequestHandler = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  Client,
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition = never,
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError, Registry>,
  options: CreateRequestHandlerOptions<
    Routes,
    Client,
    ServerServices,
    ServerError,
    Actions,
    Registry
  > = {},
): StartRequestHandlerEffect<StartRequestRequirements<Routes, ServerServices, Registry, Actions>> =>
  createRequestHandlerEffect(app, options);

/** Alias for `createRequestHandler` for server entry modules. */
export const createServerHandler = createRequestHandler;
/** Alias for `createRequestHandlerEffect` for server entry modules. */
export const createServerHandlerEffect = createRequestHandlerEffect;
