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
  type CreateRequestHandlerOptions,
  type HydrateFromDocumentOptions,
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
} from "@sunfall/arc-start";
import { Component } from "@sunfall/arc-solid";
import { Context, Effect, Layer, Schedule, Schema } from "effect";
import { Resource, type Action } from "@sunfall/arc-core";

const startExports: Array<unknown> = [
  App.define,
  App.launch,
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
  | App.Any
  | App.Definition
  | App.LaunchError
  | App.LaunchServices
  | App.LaunchOptions
  | App.RootProps
  | CreateRequestHandlerOptions
  | HydrateFromDocumentOptions
  | StartAction.FormOptions<{ readonly id: string }>
  | StartAction.InvalidationPlan
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
interface Greeting {
  readonly text: string;
}
const Greeting = Context.Service<Greeting>("Greeting");
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
// A persisted Resource needs a KeyValueStore; Start provides one on both
// sides (Web Storage in the browser, a no-op store during SSR).
const PersistedCount = Resource.define({
  name: "type-tests/start/persisted-count",
  input: Schema.String,
  policy: { persist: { key: "count" } },
  load: () => Effect.succeed(1),
});
const PersistedRoot = Component.define("PersistedRoot", function* (props: App.RootProps) {
  const count = yield* Component.resource(PersistedCount);
  return () => `${count(props.href)}`;
});
const persistedApp = App.define({ root: PersistedRoot, routes: [] });
createRequestHandler(persistedApp);
const NeedyRoot = Component.define("Needy", function* (props: { readonly id: string }) {
  yield* Effect.void;
  return () => props.id;
});
// @ts-expect-error the root receives `App.RootProps`; other required props cannot be supplied
App.define({ root: NeedyRoot, routes: [] });
const greetingLaunch: Effect.Effect<never, App.LaunchError> = App.launch(greetingApp, {
  href: "/",
  hydration: { timestamp: "now" },
});
void greetingHandler;
void greetingLaunch;
// @ts-expect-error hydration options are an object; there is no positional id
hydrateFromDocument(document, undefined, {});

declare const startActionDefinition: Action.Definition<
  { readonly id: string },
  unknown,
  never,
  never
>;
const startActionFormOptions: StartAction.FormOptions<{ readonly id: string }> = {
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

// Durable Action submissions: App.launch takes outbox options; the storage is
// the client Layer's `KeyValueStore`, never an App.launch option.
const launchOutboxOptions: App.LaunchOptions = {
  outbox: { retry: Schedule.spaced("1 second") },
};
// @ts-expect-error -- the outbox persists to the client Layer's KeyValueStore.
const launchOutboxStorage: App.LaunchOptions = { outbox: { storage: {} } };
void launchOutboxOptions;
void launchOutboxStorage;
