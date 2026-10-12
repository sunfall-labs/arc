import {
  Route,
  makeResponseContext,
  runWithRuntime,
  type AppDefinitionRegistry,
  type AppDefinitionRegistryRequirements,
  type ActionDefinitionRequirements,
  type AnySunfallArcRuntime,
  type EffectInput,
  type SunfallArcRuntime,
  type ResourceStore as ResourceStoreState,
} from "@sunfall/arc-core";
import { invokeEffectInput } from "@sunfall/arc-core/internal";
import { Effect, Scope } from "effect";
import { type StartCollectionHydrationOptions } from "./hydration.js";
import type { StartServerApp } from "./start-server-app.js";
import {
  makeRequestRuntime,
  provideRequestRuntime,
  type RequestRuntimeProvidedRequirements,
  type RequestRuntimeRemainingRequirements,
} from "./request-runtime.js";
import { startRequestTraceFactsEffect, type StartRequestTraceHandler } from "./request-trace.js";
import { runRequestRuntimeLifecycleEffect } from "./request-runtime-lifecycle.js";
import {
  recordStartRequestTraceFailure,
  recordStartRequestTracePreload,
} from "./request-trace-recorder.js";
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
  makeStartActionWorkflows,
  settledActionSubmissionsEffect,
} from "./start-action-workflow.js";
import { readStartActionOutboxCookie } from "./start-action-outbox-cookie.js";
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
export { StartPreloadError, preloadRequest } from "./start-request-preload.js";
export type { StartCollectionPreload, StartPreloadResult } from "./start-request-preload.js";
export { StartRequestHandlerError } from "./start-request-handler-error.js";

/**
 * Per-request context passed to the internal render step.
 *
 * The runtime and resource store are request-scoped. Start disposes them when
 * the response completes, including streamed responses. `hydrationPlan.root`
 * carries the root payload script for streamed renderers (route Resources go
 * through `hydrationPlan.streamedResourceChunks`); `hydrationPlan.legacy`
 * carries the full payload for buffered renderers.
 */
export interface StartRenderContext<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[] =
    readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices = never,
  ServerError = never,
  Registry extends AppDefinitionRegistry = AppDefinitionRegistry,
> extends StartPreloadResult<Routes> {
  readonly request: Request;
  readonly app: StartServerApp<Routes, ServerServices, ServerError, Registry>;
  readonly runtime: SunfallArcRuntime<ServerServices, ServerError>;
  readonly resourceStore: ResourceStoreState;
  readonly hydrationPlan: StartRenderHydrationPlan;
}

/**
 * Options for the internal request handler under `createRequestHandler`.
 *
 * Configures the render step, the served action set, and an optional request
 * trace hook. Handler execution stays Effect-first internally; platform
 * adapters decide where any Promise boundary lives.
 */
export interface StartRequestHandlerOptions<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
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
    context: StartRenderContext<Routes, ServerServices, ServerError, Registry>,
  ) => EffectInput<string | Response, never, RequestRuntimeProvidedRequirements<ServerServices>>;
  /** Actions served by the action transport. Defaults to globally registered actions. */
  readonly actions?: Iterable<Actions>;
  /** Receives best-effort request diagnostics after runtime teardown. */
  readonly onRequestTrace?: StartRequestTraceHandler;
}

export type StartRequestRequirements<
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

/**
 * Effect-returning request handler built by `createRequestHandler`.
 *
 * This type is the Start library boundary. The `./fetch` and `./node`
 * adapters expose host Promise/callback facades; application request handlers
 * stay Effect-first.
 */
export type StartRequestHandler<Requirements = never> = StartRequestHandlerInput<
  StartRequestHandlerError,
  Scope.Scope | Requirements
> &
  StartRequestHandlerRequirementsMarker<Scope.Scope | Requirements>;

/**
 * The request handler under `createRequestHandler`: SSR (through `render`),
 * RPC, and actions for a resolved server app. Internal to Start; apps use
 * `createRequestHandler(app, ...)`, which renders the app's root itself.
 */
export const createStartRequestHandler = <
  const Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices,
  ServerError,
  Registry extends AppDefinitionRegistry,
  Actions extends StartActionDefinition = never,
>(
  app: StartServerApp<Routes, ServerServices, ServerError, Registry>,
  options: StartRequestHandlerOptions<Routes, ServerServices, ServerError, Actions, Registry> = {},
): StartRequestHandler<StartRequestRequirements<Routes, ServerServices, Registry, Actions>> => {
  const explicitActionMap =
    options.actions === undefined ? undefined : makeActionMap(options.actions);
  // Durable Action submissions run as Workflows on the server Layer's
  // `WorkflowEngine`, or on this handler's in-memory engine.
  const workflows = makeStartActionWorkflows();

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
            workflows,
          );
        }

        const preloaded = yield* preloadRequestEffectWithRuntime(
          app,
          request,
          requestRuntime,
          requestOptions,
          responseContext,
          "render",
        );
        recordStartRequestTracePreload(
          traceFacts,
          requestRuntime,
          preloaded.routePlan,
          preloaded.collectionPreload,
        );
        // Probed after preload, so a submission reported settled is one the
        // preloaded state already reflects.
        const settledSubmissions = yield* settledActionSubmissionsEffect(
          workflows,
          requestRuntime as unknown as AnySunfallArcRuntime<unknown>,
          yield* Effect.try(() => makeActionMap(explicitActionMap, app.registry)).pipe(
            Effect.orElseSucceed(() => new Map()),
          ),
          readStartActionOutboxCookie(request),
        );
        const hydrationPlan = yield* createStartRenderHydrationPlanEffect({
          resources: preloaded.resources,
          collections: preloaded.collections,
          ...(preloaded.routeFailure === undefined ? {} : { routeFailure: preloaded.routeFailure }),
          settledSubmissions,
        });
        if (preloaded.routeFailure !== undefined) {
          // The page renders the route's failure view; `render` may still set
          // a more specific status through `ResponseContext`.
          recordStartRequestTraceFailure(traceFacts, "domain");
          yield* responseContext.setStatus(500);
        }
        const context = {
          app,
          request,
          match: preloaded.match,
          resources: preloaded.resources,
          collections: preloaded.collections,
          collectionPreload: preloaded.collectionPreload,
          hydration: preloaded.hydration,
          routePlan: preloaded.routePlan,
          ...(preloaded.routeFailure === undefined ? {} : { routeFailure: preloaded.routeFailure }),
          runtime: requestRuntime,
          resourceStore: requestRuntime.resourceStore,
          hydrationPlan,
        } satisfies StartRenderContext<Routes, ServerServices, ServerError, Registry>;

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
            framework: "sunfall-arc-start",
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
    >) as StartRequestHandler<StartRequestRequirements<Routes, ServerServices, Registry, Actions>>;
};
