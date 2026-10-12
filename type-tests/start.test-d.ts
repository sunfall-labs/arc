import {
  App,
  createRequestHandler,
  currentStartStaticHref,
  hydrateFromDocument,
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
  StartRootMissing,
  StartStaticBasePathError,
  StartStaticNavigationHydrationError,
  StartStreamError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
  type AnyAppDefinition,
  type AppDefinition,
  type AppLaunchError,
  type AppLaunchServices,
  type CreateRequestHandlerOptions,
  type HydrateFromDocumentOptions,
  type StartActionFormOptions,
  type StartActionInvalidationPlan,
  type StartCollectionHydrationOptions,
  type StartDocument,
  type StartDocumentContext,
  type StartDocumentTagAttributes,
  type StartFetch,
  type StartFetchInit,
  type StartFetchInput,
  type StartHydrationDocument,
  type StartHydrationError,
  type StartHydrationPayload,
  type StartRequestHandler,
  type StartRequestTrace,
  type StartRequestTraceHandler,
  type StartStaticHistoryAdapterOptions,
  type StartStaticHistoryWindow,
  type StartTransportEndpointOverrides,
  FileRoute,
} from "@sunfall/arc-start";
import { Component } from "@sunfall/arc-solid";
import { Context, Effect, Layer, Schema } from "effect";
import { type ActionDefinition, Route } from "@sunfall/arc-core";

const startExports: Array<unknown> = [
  App.define,
  App.launch,
  createRequestHandler,
  currentStartStaticHref,
  FileRoute.define,
  hydrateFromDocument,
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
  StartRootMissing,
  StartStaticBasePathError,
  StartStaticNavigationHydrationError,
  StartStreamError,
  StartTransportEndpointConflictError,
  StartTransportEndpointPathError,
];
type StartTypes =
  | AnyAppDefinition
  | AppDefinition
  | AppLaunchError
  | AppLaunchServices
  | App.LaunchOptions
  | App.RootProps
  | CreateRequestHandlerOptions
  | HydrateFromDocumentOptions
  | StartActionFormOptions<{ readonly id: string }>
  | StartActionInvalidationPlan
  | StartCollectionHydrationOptions
  | StartDocument
  | StartDocumentContext
  | StartDocumentTagAttributes
  | StartFetch
  | StartFetchInit
  | StartFetchInput
  | StartHydrationDocument
  | StartHydrationError
  | StartHydrationPayload
  | StartRequestHandler
  | StartRequestTrace
  | StartRequestTraceHandler
  | StartStaticHistoryAdapterOptions
  | StartStaticHistoryWindow
  | StartTransportEndpointOverrides;
void startExports;
type _StartTypes = StartTypes;

// One app definition; the client and server Layers must each provide what the
// root needs.
class Greeting extends Context.Service<Greeting, { readonly text: string }>()("Greeting") {}
const GreetingLive = Layer.succeed(Greeting)({ text: "hi" });
const GreetingRoot = Component.define("GreetingRoot", function* (props: App.RootProps) {
  const greeting = yield* Greeting;
  return () => `${greeting.text} ${props.href}`;
});
const greetingApp = App.define({ root: GreetingRoot, routes: [], client: GreetingLive });
// @ts-expect-error the client Layer must provide the root's services
App.define({ root: GreetingRoot, routes: [] });
const greetingHandler: StartRequestHandler = createRequestHandler(greetingApp, {
  server: GreetingLive,
  document: ({ request }) => ({ title: request.url, lang: "en" }),
});
// @ts-expect-error the server Layer must provide the root's services
createRequestHandler(greetingApp);
const NeedyRoot = Component.define("Needy", function* (props: { readonly id: string }) {
  yield* Effect.void;
  return () => props.id;
});
// @ts-expect-error the root receives `App.RootProps`; other required props cannot be supplied
App.define({ root: NeedyRoot, routes: [] });
const greetingLaunch: Effect.Effect<never, AppLaunchError> = App.launch(greetingApp, {
  href: "/",
  hydration: { timestamp: "now" },
});
void greetingHandler;
void greetingLaunch;
// @ts-expect-error hydration options are an object; there is no positional id
hydrateFromDocument(document, undefined, {});

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
// @ts-expect-error StartAction no longer creates stateful client instances; use Component.action
StartAction.use(startActionDefinition);
void startActionFormMethod;
void startActionFormEncodeError;
void decodedStartActionFormDataEffect;

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

const traceHandler: StartRequestTraceHandler = (trace: StartRequestTrace) => {
  const status: StartRequestTrace["status"] = trace.status;
  void status;
};
void traceHandler;
