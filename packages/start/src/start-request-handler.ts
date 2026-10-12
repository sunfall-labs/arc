import {
  Route,
  makeResponseContext,
  runWithRuntime,
  type AnySunfallArcRuntime,
  type EffectInput,
  type SunfallArcRuntime,
  type ResourceStore as ResourceStoreState,
} from "@sunfall/arc-core";
import {
  invokeEffectInput,
  type AppDefinitionRegistry,
  type AppDefinitionRegistryRequirements,
  type ActionDefinitionRequirements,
} from "@sunfall/arc-core/internal";
import { Effect, Option, Scope } from "effect";
import type { StartServerApp } from "./start-server-app.js";
import {
  makeRequestRuntime,
  provideRequestRuntime,
  type RequestRuntimeProvidedRequirements,
  type RequestRuntimeRemainingRequirements,
} from "./request-runtime.js";
import {
  recordStartRequestFailure,
  recordStartRequestRoutePlan,
  startRequestFacts,
} from "./request-trace.js";
import { runRequestRuntimeLifecycle } from "./request-runtime-lifecycle.js";
import {
  createStartRenderHydrationPlan,
  type StartRenderHydrationPlan,
} from "./render-hydration-plan.js";
import {
  isServerActionRequest,
  isServerRpcRequest,
  makeActionMap,
  type StartActionDefinition,
} from "./start-transport-protocol.js";
import { makeStartActionWorkflows, settledActionSubmissions } from "./start-action-workflow.js";
import { readStartActionOutboxCookie } from "./start-action-outbox-cookie.js";
import { ensureRequestSubmitterOwner } from "./start-action-submitter.js";
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

export { createServerActionResponse, createServerRpcResponse } from "./start-request-endpoints.js";
export { StartPreloadError, preloadRequest } from "./start-request-preload.js";
export type { StartPreloadResult } from "./start-request-preload.js";
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
 * Configures the render step and the served action set. Handler execution stays Effect-first internally; platform
 * adapters decide where any Promise boundary lives.
 */
export interface StartRequestHandlerOptions<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[],
  ServerServices = never,
  ServerError = never,
  Actions extends StartActionDefinition = StartActionDefinition,
  Registry extends AppDefinitionRegistry = AppDefinitionRegistry,
> {
  /** Render the preloaded request context to HTML or a custom Response. */
  readonly render?: (
    context: StartRenderContext<Routes, ServerServices, ServerError, Registry>,
  ) => EffectInput<string | Response, never, RequestRuntimeProvidedRequirements<ServerServices>>;
  /** Actions served by the action transport. Defaults to globally registered actions. */
  readonly actions?: Iterable<Actions>;
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
      const requestRuntime = makeRequestRuntime(app);
      const responseContext = makeResponseContext();
      const facts = yield* startRequestFacts(request);
      const responseEffect = Effect.gen(function* () {
        if (isServerRpcRequest(request)) {
          return yield* createServerRpcResponseEffectWithRuntime(
            app,
            request,
            requestRuntime,
            responseContext,
            facts,
          );
        }

        if (isServerActionRequest(request)) {
          return yield* createServerActionResponseEffectWithRuntime(
            app,
            request,
            requestRuntime,
            explicitActionMap,
            responseContext,
            facts,
            workflows,
          );
        }

        const preloaded = yield* preloadRequestEffectWithRuntime(
          app,
          request,
          requestRuntime,
          responseContext,
          "render",
        );
        recordStartRequestRoutePlan(facts, preloaded.routePlan);
        // Probed after preload, so a submission reported settled is one the
        // preloaded state already reflects.
        const actionMap = yield* Effect.try(() =>
          makeActionMap(explicitActionMap, app.registry),
        ).pipe(Effect.orElseSucceed(() => new Map()));
        // An app with durable Actions gives every browser a submitter before
        // its first submission, so even a submission whose response is lost
        // replays under the submitter that recorded it.
        const hasDurableActions = [...actionMap.values()].some(
          (action) => action.durable !== undefined,
        );
        const owner = hasDurableActions
          ? Option.some(yield* ensureRequestSubmitterOwner(request, responseContext))
          : Option.none<string>();
        const settledSubmissions = yield* settledActionSubmissions(
          workflows,
          requestRuntime as unknown as AnySunfallArcRuntime<unknown>,
          actionMap,
          owner,
          readStartActionOutboxCookie(request),
        );
        const hydrationPlan = yield* createStartRenderHydrationPlan({
          resources: preloaded.resources,
          ...(preloaded.routeFailure === undefined ? {} : { routeFailure: preloaded.routeFailure }),
          settledSubmissions,
        });
        if (preloaded.routeFailure !== undefined) {
          // The page renders the route's failure view; `render` may still set
          // a more specific status through `ResponseContext`.
          recordStartRequestFailure(facts, "domain");
          yield* responseContext.setStatus(500);
        }
        const context = {
          app,
          request,
          match: preloaded.match,
          resources: preloaded.resources,
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
            hydration: preloaded.hydration,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
      });

      return yield* runRequestRuntimeLifecycle({
        request,
        runtime: requestRuntime,
        responseContext,
        facts,
        responseEffect,
      });
    }).pipe(
      Effect.mapError((cause) => normalizeStartRequestHandlerError(request, cause)),
    ) as Effect.Effect<
      Response,
      StartRequestHandlerError,
      Scope.Scope | StartRequestRequirements<Routes, ServerServices, Registry, Actions>
    >) as StartRequestHandler<StartRequestRequirements<Routes, ServerServices, Registry, Actions>>;
};
