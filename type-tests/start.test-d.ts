import {
  createHtmlResponseEffect,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  currentStartStaticHref,
  defineFileRoute,
  htmlChunk,
  hydrateFromDocument,
  hydrateFromDocumentEffect,
  makeRpcClientLayer,
  makeStartStaticHistoryAdapter,
  normalizeStartStaticBasePath,
  stripStartStaticBasePath,
  submitStartActionEffect,
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
  type HydrateFromDocumentEffectOptions,
  type HydrateFromDocumentOptions,
  type ServerFunctionManifestSource,
  type ServerRpcClientOptions,
  type StartActionClientOptions,
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
} from "@sunfall/arc-start";
import { Schema } from "effect";
import { route, type ActionDefinition, type Route } from "@sunfall/arc-core";

const startExports: Array<unknown> = [
  createHtmlResponseEffect,
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  currentStartStaticHref,
  defineFileRoute,
  htmlChunk,
  hydrateFromDocument,
  hydrateFromDocumentEffect,
  makeRpcClientLayer,
  makeStartStaticHistoryAdapter,
  normalizeStartStaticBasePath,
  stripStartStaticBasePath,
  submitStartActionEffect,
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
  | HydrateFromDocumentEffectOptions
  | HydrateFromDocumentOptions
  | ServerFunctionManifestSource
  | ServerRpcClientOptions
  | StartActionClientOptions
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

const typedFileRoute = defineFileRoute("/typed/:id")({
  preloadResources: [],
});
const typedFileRoutePath: "/typed/:id" = typedFileRoute.path;
const typedFileRouteParams: { readonly id: string } = {} as Route.Params<typeof typedFileRoute>;
const coreRoute = route("/typed/:id", { preloadResources: [] });
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
const decodedStartActionFormDataEffect = StartAction.decodeFormDataEffect(
  Schema.Struct({ id: Schema.String }),
  startActionBrowserFormData,
);
const startActionSubmitEffect = submitStartActionEffect(startActionDefinition, { id: "atlas" });
const startActionInstance: StartAction.Instance<typeof startActionDefinition> =
  StartAction.use(startActionDefinition);
type StartActionResultPin = StartAction.Result<typeof startActionDefinition>;
type StartActionStatePin = StartAction.State<typeof startActionDefinition>;
void startActionFormMethod;
void startActionFormEncodeError;
void decodedStartActionFormDataEffect;
void startActionSubmitEffect;
void startActionInstance;
type _StartActionPins = StartActionResultPin | StartActionStatePin;

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
