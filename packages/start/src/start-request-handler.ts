import {
  Route,
  applyResponseContext,
  makeResponseContext,
  runWithRuntime,
  toEffect,
  type AppDefinition,
  type EffectInput,
  type EffectUiRuntime,
  type ResourceStore as ResourceStoreState
} from "@effect-ui/core";
import { Effect, Exit } from "effect";
import {
  createHydrationScript,
  type PreloadRequestOptions,
  type StartCollectionHydrationOptions,
  type StartHydrationPayload
} from "./hydration.js";
import {
  completeRequestRuntimeWithResponse,
  makeRequestRuntime,
  provideRequestRuntime,
  type RequestRuntimeFinalizeState,
  type RequestRuntimeStreamFinalizeState
} from "./request-runtime.js";
import {
  buildStartRequestTrace,
  emitStartRequestTraceEffect,
  requestRuntimeDisposeTraceEffect,
  startRequestTraceFactsEffect,
  startRequestTraceTeardown,
  withStartRequestObservability,
  type StartRequestTraceHandler
} from "./request-trace.js";
import { recordStartRequestTracePreload } from "./request-trace-recorder.js";
import {
  isServerActionRequest,
  isServerRpcRequest,
  type StartActionDefinition
} from "./start-transport-protocol.js";
import {
  createServerActionResponseEffectWithRuntime,
  createServerRpcResponseEffectWithRuntime
} from "./start-request-endpoints.js";
import {
  preloadRequestEffectWithRuntime,
  type StartCollectionPreload,
  type StartPreloadResult
} from "./start-request-preload.js";

export {
  createServerActionResponseEffect,
  createServerRpcResponseEffect
} from "./start-request-endpoints.js";
export {
  preloadRequest,
  preloadRequestEffect
} from "./start-request-preload.js";
export type {
  StartCollectionPreload,
  StartPreloadResult
} from "./start-request-preload.js";

/**
 * Per-request context passed to a Start SSR render function.
 *
 * The runtime and resource store are request-scoped. Start disposes them when
 * the response completes, including streamed responses. Include
 * `hydrationScript` in HTML to transfer preloaded resource and collection
 * state to the browser.
 */
export interface StartRenderContext<
  Routes extends readonly Route.Definition<string, unknown, unknown>[] = readonly Route.Definition<string, unknown, unknown>[],
  Client = unknown,
  ServerServices = never,
  ServerError = never
> extends StartPreloadResult<Routes> {
  readonly request: Request;
  readonly app: AppDefinition<Routes, Client, ServerServices, ServerError>;
  readonly runtime: EffectUiRuntime<ServerServices, ServerError>;
  readonly resourceStore: ResourceStoreState;
  readonly hydrationScript: string;
}

/**
 * Options for the main Start request handler.
 *
 * Configure SSR rendering, the server action set for this handler, and an
 * optional request trace hook. Handler execution stays Effect-first internally;
 * platform adapters decide where any Promise boundary lives.
 */
export interface CreateRequestHandlerOptions<
  Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client = unknown,
  ServerServices = never,
  ServerError = never
> extends StartCollectionHydrationOptions {
  /** Render the preloaded request context to HTML or a custom Response. */
  readonly render?: (context: StartRenderContext<Routes, Client, ServerServices, ServerError>) => EffectInput<string | Response>;
  /** Actions served by the action transport. Defaults to globally registered actions. */
  readonly actions?: Iterable<StartActionDefinition>;
  /** Receives best-effort request diagnostics after runtime teardown. */
  readonly onRequestTrace?: StartRequestTraceHandler;
}

/** Effect-returning request handler used by the Start SSR/RPC/action pipeline. */
export type StartRequestHandlerEffect = (request: Request) => Effect.Effect<Response, unknown, unknown>;
/** Public handler type consumed by platform adapters and server entries. */
export type StartRequestHandler = StartRequestHandlerEffect;

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
 *   render: ({ hydrationScript }) => `<div id="app"></div>${hydrationScript}`
 * });
 * ```
 */
export const createRequestHandlerEffect =
  <
    const Routes extends readonly Route.Definition<string, unknown, unknown>[],
    Client,
    ServerServices,
    ServerError
  >(
    app: AppDefinition<Routes, Client, ServerServices, ServerError>,
    options: CreateRequestHandlerOptions<Routes, Client, ServerServices, ServerError> = {}
  ): StartRequestHandlerEffect =>
  (request: Request): Effect.Effect<Response, unknown, unknown> =>
    Effect.gen(function* () {
      const requestRuntime = makeRequestRuntime(app);
      const responseContext = makeResponseContext();
      const traceFacts = yield* startRequestTraceFactsEffect(request);
      const responseEffect = Effect.gen(function* () {
        if (isServerRpcRequest(request)) {
          return yield* createServerRpcResponseEffectWithRuntime(
            app,
            request,
            requestRuntime,
            responseContext,
            traceFacts
          );
        }

        if (isServerActionRequest(request)) {
          return yield* createServerActionResponseEffectWithRuntime(
            app,
            request,
            requestRuntime,
            options.actions,
            responseContext,
            traceFacts
          );
        }

        const preloaded = yield* preloadRequestEffectWithRuntime(
          app,
          request,
          requestRuntime,
          options,
          responseContext
        );
        recordStartRequestTracePreload(
          traceFacts,
          requestRuntime,
          preloaded.routePlan,
          preloaded.collectionPreload
        );
        const context: StartRenderContext<Routes, Client, ServerServices, ServerError> = {
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
          hydrationScript: createHydrationScript(preloaded.hydration)
        };

        if (options.render) {
          const renderEffect = Effect.suspend(() =>
            toEffect(runWithRuntime(requestRuntime, () => options.render!(context)))
          );
          const rendered = yield* provideRequestRuntime(
            requestRuntime,
            request,
            renderEffect,
            responseContext
          );
          return rendered instanceof Response
            ? rendered
            : new Response(rendered, {
                headers: {
                  "content-type": "text/html"
                }
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
            hydration: preloaded.hydration
          }),
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );
      });

      return yield* withStartRequestObservability(
        request,
        traceFacts,
        Effect.gen(function* () {
          const responseExit = yield* Effect.exit(responseEffect);

          if (Exit.isFailure(responseExit)) {
            const teardown = yield* requestRuntimeDisposeTraceEffect(requestRuntime);
            if (options.onRequestTrace !== undefined) {
              yield* emitStartRequestTraceEffect(
                options.onRequestTrace,
                buildStartRequestTrace(request, traceFacts, "failure", {
                  teardown: startRequestTraceTeardown(traceFacts, {
                    runtimeDisposed: true,
                    reason: "request-failure",
                    ...teardown
                  })
                })
              );
            }
            return yield* Effect.failCause(responseExit.cause);
          }

          const response = applyResponseContext(responseContext, responseExit.value);
          const traceFinalizeOptions = options.onRequestTrace === undefined
            ? {}
            : {
                onFinalize: (state: RequestRuntimeFinalizeState) =>
                  emitStartRequestTraceEffect(
                    options.onRequestTrace,
                    buildStartRequestTrace(request, traceFacts, state.status, {
                      response,
                      teardown: startRequestTraceTeardown(traceFacts, {
                        runtimeDisposed: true,
                        reason: state.teardownReason,
                        beforeDispose: state.beforeDispose,
                        afterDispose: state.afterDispose,
                        completedAt: state.completedAt
                      }),
                      ...(state.stream === undefined ? {} : { stream: state.stream })
                    })
                  ),
                onStreamFinalize: (state: RequestRuntimeStreamFinalizeState) =>
                  emitStartRequestTraceEffect(
                    options.onRequestTrace,
                    buildStartRequestTrace(request, traceFacts, state.status, {
                      response,
                      teardown: startRequestTraceTeardown(traceFacts, {
                        runtimeDisposed: true,
                        reason: state.teardownReason,
                        beforeDispose: state.beforeDispose,
                        afterDispose: state.afterDispose,
                        completedAt: state.completedAt
                      }),
                      stream: state.stream
                    })
                  )
              };
          return yield* completeRequestRuntimeWithResponse(
            requestRuntime,
            response,
            traceFinalizeOptions
          );
        })
      );
    });

/** Primary Start request handler factory for server entry modules. */
export const createRequestHandler =
  <
    const Routes extends readonly Route.Definition<string, unknown, unknown>[],
    Client,
    ServerServices,
    ServerError
  >(
    app: AppDefinition<Routes, Client, ServerServices, ServerError>,
    options: CreateRequestHandlerOptions<Routes, Client, ServerServices, ServerError> = {}
  ): StartRequestHandler =>
    createRequestHandlerEffect(app, options);

/** Alias for `createRequestHandler` for server entry modules. */
export const createServerHandler = createRequestHandler;
/** Alias for `createRequestHandlerEffect` for server entry modules. */
export const createServerHandlerEffect = createRequestHandlerEffect;
