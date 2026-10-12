import {
  createHtmlResponse,
  createRequestHandler,
  createStartStreamedHtmlResponse,
  currentStartStaticHref,
  htmlChunk,
  hydrateFromDocument,
  makeRpcClientLayer,
  makeStartStaticHistoryAdapter,
  normalizeStartStaticBasePath,
  stripStartStaticBasePath,
  makeActionTransportLayer,
  withStartStaticBasePath,
  StartAction,
  StartActionDuplicateName,
  StartActionFormEncodeError,
  StartCollectionDuplicateName,
  StartHydrationChunkParseError,
  StartHydrationPayloadParseError,
  StartHydrationPayloadSerializeError,
  StartPreloadError,
  StartRequestHandlerError,
  StartStaticBasePathError,
  StartStaticNavigationHydrationError,
  StartStreamError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
  type ActionManifestSource,
  type CreateRequestHandlerOptions,
  type HtmlResponseOptions,
  type HtmlStreamChunk,
  type HydrateFromDocumentOptions,
  type ServerFunctionManifestSource,
  type ServerRpcClientOptions,
  type ActionTransportLayerOptions,
  type StartActionFormOptions,
  type StartActionInvalidationPlan,
  type StartCollectionHydrationOptions,
  type StartFetch,
  type StartFetchInit,
  type StartFetchInput,
  type StartHydrationDocument,
  type StartHydrationError,
  type StartHydrationPayload,
  type StartRenderContext,
  type StartRequestHandler,
  type StartRequestTrace,
  type StartRequestTraceHandler,
  type StartStaticHistoryAdapterOptions,
  type StartStaticHistoryWindow,
  type StartStreamedHtmlResponseOptions,
  type StartTransportEndpointOverrides,
  FileRoute,
} from "@sunfall/arc-start";
import { Effect, type Layer, Schema } from "effect";
import {
  type ActionDefinition,
  type ActionTransport,
  Route,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";

const startExports: Array<unknown> = [
  createHtmlResponse,
  createRequestHandler,
  createStartStreamedHtmlResponse,
  currentStartStaticHref,
  FileRoute.define,
  htmlChunk,
  hydrateFromDocument,
  makeRpcClientLayer,
  makeStartStaticHistoryAdapter,
  normalizeStartStaticBasePath,
  stripStartStaticBasePath,
  withStartStaticBasePath,
  StartAction,
  StartActionDuplicateName,
  StartActionFormEncodeError,
  StartCollectionDuplicateName,
  StartHydrationChunkParseError,
  StartHydrationPayloadParseError,
  StartHydrationPayloadSerializeError,
  StartPreloadError,
  StartRequestHandlerError,
  StartStaticBasePathError,
  StartStaticNavigationHydrationError,
  StartStreamError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
];
type StartTypes =
  | ActionManifestSource
  | CreateRequestHandlerOptions<readonly Route.Definition<string, unknown, unknown, any>[]>
  | HtmlResponseOptions
  | HtmlStreamChunk
  | HydrateFromDocumentOptions
  | ServerFunctionManifestSource
  | ServerRpcClientOptions
  | ActionTransportLayerOptions
  | StartActionFormOptions<{ readonly id: string }>
  | StartActionInvalidationPlan
  | StartCollectionHydrationOptions
  | StartFetch
  | StartFetchInit
  | StartFetchInput
  | StartHydrationDocument
  | StartHydrationError
  | StartHydrationPayload
  | StartRenderContext
  | StartRequestHandler
  | StartRequestTrace
  | StartRequestTraceHandler
  | StartStaticHistoryAdapterOptions
  | StartStaticHistoryWindow
  | StartStreamedHtmlResponseOptions<never, never>
  | StartTransportEndpointOverrides;
void startExports;
type _StartTypes = StartTypes;

const typedFileRoute = FileRoute.define("/typed/:id")({
  preloadResources: [],
});
const typedFileRoutePath: "/typed/:id" = typedFileRoute.path;
const typedFileRouteParams: { readonly id: string } = {} as Route.Params<typeof typedFileRoute>;
const coreRoute = Route.define("/typed/:id", { preloadResources: [] });
const sameShape: typeof coreRoute = typedFileRoute;
void typedFileRoutePath;
void typedFileRouteParams;
void sameShape;

declare const startActionDefinition: ActionDefinition<
  { readonly id: string },
  unknown,
  never,
  never
>;
const startActionFormOptions: StartActionFormOptions<{ readonly id: string }> = {
  input: { id: "atlas" },
};
const startActionForm: StartAction.Form<typeof startActionDefinition> = StartAction.form(
  startActionDefinition,
  startActionFormOptions,
);
const startActionFormMethod: "post" = startActionForm.method;
const startActionFormEncodeError = new StartActionFormEncodeError({
  actionName: startActionDefinition.name,
  operation: "json-stringify",
  input: undefined,
  cause: "not serializable",
  guidance: "use serializable defaults",
});
declare const startActionBrowserFormData: FormData;
const decodedStartActionFormDataEffect = StartAction.decodeFormData(
  Schema.Struct({ id: Schema.String }),
  startActionBrowserFormData,
);
// Scripted UI submits through `Component.action`; Start routes served Actions
// over the network by providing the `ActionTransport` service.
const actionTransportLayer: Layer.Layer<ActionTransport> = makeActionTransportLayer({
  actions: [startActionDefinition],
});
declare const startActionTransportRuntime: SunfallArcRuntime<{ readonly token: string }>;
const runtimeBackedActionTransportLayer: Layer.Layer<ActionTransport> = makeActionTransportLayer({
  actions: [startActionDefinition],
  fetch: () => Effect.die("not used"),
  transportRuntime: startActionTransportRuntime,
});
// @ts-expect-error the transport needs the list of Actions the server serves
makeActionTransportLayer({});
// @ts-expect-error StartAction no longer creates stateful client instances; use Component.action
StartAction.use(startActionDefinition);
void startActionFormMethod;
void startActionFormEncodeError;
void decodedStartActionFormDataEffect;
void actionTransportLayer;
void runtimeBackedActionTransportLayer;

declare const startRenderContext: StartRenderContext;
const legacyHydrationScript: string = startRenderContext.legacyHydrationScript;
const hydrationRootScript: string = startRenderContext.hydrationRootScript;
void legacyHydrationScript;
void hydrationRootScript;

const endpointConflict = new StartTransportEndpointConflictError({
  rpcPath: "/same",
  actionPath: "/same",
  guidance: "Use distinct endpoint paths.",
});
const endpointPathError = new StartTransportEndpointPathError({
  field: "rpcPath",
  value: "rpc",
  reason: "NotOriginForm",
  guidance: "Use an origin-form path.",
});
const endpointOverrides: StartTransportEndpointOverrides = { rpcPath: "/rpc" };
void endpointConflict;
void endpointPathError;
void endpointOverrides;

const rpcClientLayer = makeRpcClientLayer();
void rpcClientLayer;

const traceHandler: StartRequestTraceHandler = (trace: StartRequestTrace) => {
  const status: StartRequestTrace["status"] = trace.status;
  void status;
};
void traceHandler;
