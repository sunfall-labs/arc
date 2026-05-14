import {
  Action,
  ActionInterrupted,
  ActionResult,
  currentOrDefaultRuntime,
  isResourceRef,
  isResourceTag,
  Resource,
  ResourceTagTypeId,
  Signal,
  runWithRuntime,
  applyResponseContext,
  makeResponseContext,
  provideRequest,
  provideResponse,
  Route,
  Server,
  ServerClient,
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
  type AppDefinition,
  type EffectUiRuntime,
  type ResponseContext,
  type ResourceStore as ResourceStoreState,
  type ResourceHydrationPayload,
  type ResourceInvalidation,
  type ResourceInvalidationCause,
  type ResourceInvalidationPlan,
  type ServerFunction,
  type ActionDefinition,
  type ActionState,
  type FormFieldErrors,
  type ReadableSignal
} from "@effect-ui/core";
import { Collection, type AnyCollection, type CollectionHydrationPayload } from "@effect-ui/db";
import { Cause, Clock, Effect, Exit, Fiber, Layer, Option, Schema, type Scope } from "effect";
import type { EffectInput } from "@effect-ui/core";
import { makeResourceStore, toEffect, withResourceStore } from "@effect-ui/core";
import {
  createHydrationScript,
  createStartHydrationPayload,
  hydrateStartPayloadEffect,
  type PreloadRequestOptions,
  type StartCollectionHydrationOptions,
  type StartHydrationPayload
} from "./hydration.js";
import {
  hasContentType,
  makeStartRequestIdEffect,
  serverActionPath,
  serverRpcPath,
  startJsonMediaType,
  startRequestIdHeader,
  startTraceparentHeader,
  startTransportDiagnosticsEffect,
  validateStartActionRequestEffect,
  validateStartRpcRequestEffect,
  validateStartRpcResponseEffect,
  withStartTransportDiagnostics,
  type StartTransportRequestError
} from "./rpc.js";

export * from "./hydration.js";
export * from "./streaming.js";
export * from "./server-function-manifest.js";
export * from "./action-manifest.js";
export * from "./app-graph.js";
export * from "./diagnostics-report.js";
export * from "./file-route-modules.js";
export * from "./file-route.js";

export {
  filePathToRouteManifestEntry,
  filePathToRouteManifestEntryEffect,
  createFileRouteManifest,
  deserializeFileRouteManifest,
  serializeFileRouteManifest,
  generateFileRouteManifest,
  generateFileRouteManifestArtifact,
  generateValidatedFileRouteManifestEffect,
  generateValidatedFileRouteManifestArtifactEffect,
  validateFileRouteManifestEffect,
  defaultFileRouteExtensions,
  FileRouteManifestDuplicateRoutePath,
  FileRouteManifestInvalidSegment,
  FileRouteManifestParseError,
  FileRouteManifestDuplicateModuleRole,
  FileRouteId,
  FileRouteSourceId,
  describeFileRouteManifest,
  filePathToFileRouteModule,
  filePathToFileRouteModuleEffect,
  generateFileRouteModules,
  makeFileRouteId,
  makeFileRouteSourceId,
  type FileRouteManifestError,
  type FileRouteManifest,
  type FileRouteManifestEntry,
  type FileRouteManifestModule,
  type FileRouteManifestOptions,
  type FileRouteModuleKind,
  type FileRouteParam,
  type FileRouteRouteMetadata,
  type FileRouteSegment
} from "./file-routes.js";

export interface StartPreloadResult<
  Routes extends readonly Route.Definition<string, unknown, unknown>[] = readonly Route.Definition<string, unknown, unknown>[]
> {
  readonly match: Route.Match<Routes[number]> | undefined;
  readonly resources: ResourceHydrationPayload;
  readonly collections: CollectionHydrationPayload;
  readonly collectionPreload: StartCollectionPreload;
  readonly hydration: StartHydrationPayload;
  readonly routePlan: Route.NavigationPlan<Routes[number]>;
}

export interface StartCollectionPreload {
  readonly routeTouchedCollections: ReadonlyArray<AnyCollection>;
  readonly routeDeclaredCollections: ReadonlyArray<AnyCollection>;
  readonly registeredCollections: ReadonlyArray<AnyCollection>;
  readonly dehydratedCollections: ReadonlyArray<AnyCollection>;
  readonly hydration: CollectionHydrationPayload;
}

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

export interface CreateRequestHandlerOptions<
  Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client = unknown,
  ServerServices = never,
  ServerError = never
> extends StartCollectionHydrationOptions {
  readonly render?: (context: StartRenderContext<Routes, Client, ServerServices, ServerError>) => EffectInput<string | Response>;
  readonly actions?: Iterable<StartActionDefinition>;
  readonly onRequestTrace?: StartRequestTraceHandler;
}

export type StartRequestHandlerEffect = (request: Request) => Effect.Effect<Response, unknown, unknown>;
export type StartRequestHandler = (request: Request) => Promise<Response>;

export interface ServerRpcClientOptions {
  readonly endpoint?: string | URL;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: HeadersInit | (() => HeadersInit);
}

export interface StartActionClientOptions extends ServerRpcClientOptions, StartCollectionHydrationOptions {
  readonly runtime?: EffectUiRuntime<unknown, unknown>;
}

export type StartRequestTraceTransport = "ssr" | "rpc" | "action" | "unknown";
export type StartRequestTraceStatus = "success" | "failure" | "cancelled";
export type StartRequestTraceStreamState = "open" | "closed" | "cancelled" | "errored";
export type StartRequestTraceFiberStatus = "running" | "done" | "interrupted" | "failed";

export interface StartRequestTraceHeader {
  readonly name: string;
  readonly value: string;
}

export interface StartRequestTraceCookie {
  readonly name: string;
  readonly value: string;
}

export interface StartRequestTraceRequest {
  readonly id?: string;
  readonly traceparent?: string;
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly transport: StartRequestTraceTransport;
  readonly headers?: ReadonlyArray<StartRequestTraceHeader>;
  readonly cookies?: ReadonlyArray<StartRequestTraceCookie>;
}

export interface StartRequestTraceResponse {
  readonly status: number;
  readonly statusText?: string;
  readonly headers?: ReadonlyArray<StartRequestTraceHeader>;
  readonly setCookieCount?: number;
}

export interface StartRequestTraceResource {
  readonly key: string;
  readonly family: string;
  readonly input?: unknown;
  readonly state?: string;
}

export interface StartRequestTraceCollection {
  readonly name: string;
  readonly state?: string;
  readonly eventCount?: number;
}

export interface StartRequestTraceServerFunction {
  readonly name: string;
  readonly status?: StartRequestTraceStatus;
}

export interface StartRequestTraceAction {
  readonly name: string;
  readonly state?: string;
  readonly invalidationIndexes?: ReadonlyArray<number>;
}

export interface StartRequestTraceFiber {
  readonly name: string;
  readonly status: StartRequestTraceFiberStatus;
}

export interface StartRequestTraceStream {
  readonly name: string;
  readonly state: StartRequestTraceStreamState;
  readonly chunkCount?: number;
}

export interface StartRequestTraceTeardownSnapshot {
  readonly fiberCount: number;
  readonly familyCount: number;
  readonly moduleCount: number;
  readonly tagCount: number;
}

export interface StartRequestTraceTeardown {
  readonly runtimeDisposed: boolean;
  readonly reason?: string;
  readonly at?: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly durationMillis?: number;
  readonly beforeDispose?: StartRequestTraceTeardownSnapshot;
  readonly afterDispose?: StartRequestTraceTeardownSnapshot;
}

export interface StartRequestTrace {
  readonly request: StartRequestTraceRequest;
  readonly response?: StartRequestTraceResponse;
  readonly services: ReadonlyArray<string>;
  readonly routePlan?: StartRequestTraceRoutePlan;
  readonly resources: ReadonlyArray<StartRequestTraceResource>;
  readonly collections: ReadonlyArray<StartRequestTraceCollection>;
  readonly serverFunctions: ReadonlyArray<StartRequestTraceServerFunction>;
  readonly actions: ReadonlyArray<StartRequestTraceAction>;
  readonly fibers: ReadonlyArray<StartRequestTraceFiber>;
  readonly streams: ReadonlyArray<StartRequestTraceStream>;
  readonly status: StartRequestTraceStatus;
  readonly teardown?: StartRequestTraceTeardown;
}

export interface StartRequestTraceRoutePlan {
  readonly _tag: "Matched" | "NotFound";
  readonly href: string;
  readonly match:
    | {
        readonly path: string;
        readonly href: string;
        readonly params: unknown;
        readonly search: unknown;
      }
    | undefined;
  readonly resources: ReadonlyArray<{
    readonly key: string;
    readonly family: string;
    readonly input: unknown;
  }>;
  readonly hydration: {
    readonly resourceCount: number;
  };
}

interface StartRequestTraceFacts {
  readonly requestId: string;
  readonly transport: StartRequestTraceTransport;
  readonly startedAt: number;
  routePlan?: StartRequestTraceRoutePlan;
  collections: StartRequestTraceCollection[];
  serverFunctions: StartRequestTraceServerFunction[];
  actions: StartRequestTraceAction[];
}

export type StartRequestTraceHandler = (trace: StartRequestTrace) => EffectInput<void, unknown, never>;

export interface StartActionRequest {
  readonly name: string;
  readonly input: unknown;
}

export type StartActionInvalidationTarget =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
      readonly input: unknown;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

export type StartActionInvalidationCause =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

export interface StartActionInvalidationPlan {
  readonly targets: ReadonlyArray<StartActionInvalidationTarget>;
  readonly entries: ReadonlyArray<{
    readonly ref: {
      readonly key: string;
      readonly family: string;
      readonly input: unknown;
    };
    readonly causes: ReadonlyArray<StartActionInvalidationCause>;
  }>;
}

export interface StartActionResponseMeta {
  readonly invalidation?: StartActionInvalidationPlan;
  readonly hydration?: StartHydrationPayload;
}

export type StartActionResponseBody =
  | ({ readonly _tag: "Success"; readonly value: unknown } & StartActionResponseMeta)
  | ({
      readonly _tag: "ValidationFailure";
      readonly fieldErrors: unknown;
      readonly formErrors: readonly unknown[];
      readonly cause?: unknown;
    } & StartActionResponseMeta)
  | ({
      readonly _tag: "Redirect";
      readonly location: string;
      readonly status: number;
      readonly headers?: Readonly<Record<string, string>>;
      readonly replace?: boolean;
    } & StartActionResponseMeta)
  | ({ readonly _tag: "Failure"; readonly error: unknown } & StartActionResponseMeta)
  | { readonly _tag: "ServerError"; readonly error: unknown }
  | { readonly _tag: "Defect"; readonly defect: unknown };

export type StartActionResult<A, Values extends object = Record<string, unknown>, ValidationError = unknown, E = unknown> =
  | ({ readonly _tag: "Success"; readonly value: A } & StartActionResponseMeta)
  | ({
      readonly _tag: "ValidationFailure";
      readonly fieldErrors: FormFieldErrors<Values, ValidationError>;
      readonly formErrors: readonly ValidationError[];
      readonly cause?: unknown;
    } & StartActionResponseMeta)
  | ({
      readonly _tag: "Redirect";
      readonly location: string;
      readonly status: number;
      readonly headers?: Readonly<Record<string, string>>;
      readonly replace?: boolean;
    } & StartActionResponseMeta)
  | ({ readonly _tag: "Failure"; readonly error: E } & StartActionResponseMeta);

type StartActionOutputSuccess<A> =
  [Extract<A, { readonly _tag: "Success"; readonly value: unknown }>] extends [never]
    ? A
    : Extract<A, { readonly _tag: "Success"; readonly value: unknown }> extends { readonly value: infer Success }
    ? Success
    : A;

type StartActionOutputValues<A> =
  [Extract<A, { readonly _tag: "ValidationFailure"; readonly fieldErrors: unknown }>] extends [never]
    ? Record<string, unknown>
    : Extract<A, { readonly _tag: "ValidationFailure"; readonly fieldErrors: unknown }> extends {
    readonly fieldErrors: FormFieldErrors<infer Values, infer _Error>;
  }
    ? Values
    : Record<string, unknown>;

type StartActionOutputValidationError<A> =
  [Extract<A, { readonly _tag: "ValidationFailure"; readonly formErrors: readonly unknown[] }>] extends [never]
    ? unknown
    : Extract<A, { readonly _tag: "ValidationFailure"; readonly formErrors: readonly unknown[] }> extends {
    readonly formErrors: readonly (infer ValidationError)[];
  }
    ? ValidationError
    : unknown;

type StartActionOutputFailure<A, E> =
  [Extract<A, { readonly _tag: "Failure"; readonly error: unknown }>] extends [never]
    ? E
    : Extract<A, { readonly _tag: "Failure"; readonly error: unknown }> extends { readonly error: infer Failure }
    ? E | Failure
    : E;

type ActionDefinitionInputValue<D> =
  D extends ActionDefinition<infer I, infer _A, infer _E, infer _R> ? I : never;

type ActionDefinitionOutputValue<D> =
  D extends ActionDefinition<infer _I, infer A, infer _E, infer _R> ? A : never;

type ActionDefinitionErrorValue<D> =
  D extends ActionDefinition<infer _I, infer _A, infer E, infer _R> ? E : never;

export type StartActionResultFor<A, E = unknown> =
  StartActionResult<
    StartActionOutputSuccess<A>,
    StartActionOutputValues<A>,
    StartActionOutputValidationError<A>,
    StartActionOutputFailure<A, E>
  >;

export interface StartActionFormField {
  readonly name: string;
  readonly value: string;
}

export interface StartActionForm {
  readonly method: "post";
  readonly action: string;
  readonly hiddenFields: readonly StartActionFormField[];
}

export interface StartActionFormOptions<I> {
  readonly action?: string;
  readonly input?: Partial<I>;
}

export type StartActionDefinition = ActionDefinition<any, any, any, any>;

export const startActionNameField = "__effect_ui_action";
export const startActionInputField = "__effect_ui_input";

export const startActionForm = <I, A, E, R>(
  definition: ActionDefinition<I, A, E, R>,
  options: StartActionFormOptions<I> = {}
): StartActionForm => ({
  method: "post",
  action: options.action ?? serverActionPath,
  hiddenFields: [
    {
      name: startActionNameField,
      value: definition.name
    },
    ...(options.input === undefined
      ? []
      : [
          {
            name: startActionInputField,
            value: JSON.stringify(options.input)
          }
        ])
  ]
});

const makeRequestRuntime = <
  Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>
): EffectUiRuntime<ServerServices, ServerError> =>
  withResourceStore(app.runtime, makeResourceStore());

const provideRequestRuntime = <A, E, R, RuntimeServices, RuntimeError>(
  runtime: EffectUiRuntime<RuntimeServices, RuntimeError>,
  request: Request,
  effect: Effect.Effect<A, E, R>,
  responseContext: ResponseContext = makeResponseContext()
): Effect.Effect<A, E | RuntimeError, Scope.Scope> =>
  runtime.provide(
    provideRequest(request)(
      provideResponse(responseContext)(provideLocalServerClient(effect))
    )
  );

const provideLocalServerClient = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const client = yield* Effect.serviceOption(ServerClient);
    if (Option.isSome(client)) {
      return yield* effect;
    }

    return yield* Effect.provideService(effect, ServerClient, Server.localClient());
  });

export const isServerRpcRequest = (request: Request): boolean =>
  new URL(request.url).pathname === serverRpcPath;

export const isServerActionRequest = (request: Request): boolean =>
  new URL(request.url).pathname === serverActionPath;

const startRequestTraceTransport = (request: Request): StartRequestTraceTransport =>
  isServerRpcRequest(request)
    ? "rpc"
    : isServerActionRequest(request)
      ? "action"
      : "ssr";

const traceHeaders = (headers: Headers): ReadonlyArray<StartRequestTraceHeader> => {
  const out: StartRequestTraceHeader[] = [];
  headers.forEach((value, name) => {
    out.push({ name, value });
  });
  return out.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName === 0 ? left.value.localeCompare(right.value) : byName;
  });
};

const traceCookies = (headers: Headers): ReadonlyArray<StartRequestTraceCookie> => {
  const cookie = headers.get("cookie");
  if (!cookie) {
    return [];
  }

  return cookie
    .split(";")
    .flatMap((part) => {
      const [rawName, ...rawValue] = part.trim().split("=");
      return rawName
        ? [
            {
              name: decodeURIComponent(rawName),
              value: decodeURIComponent(rawValue.join("="))
            }
          ]
        : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

const traceResponse = (response: Response): StartRequestTraceResponse => {
  const headers = traceHeaders(response.headers);
  const setCookieCount = response.headers.getSetCookie().length;
  return {
    status: response.status,
    ...(response.statusText === "" ? {} : { statusText: response.statusText }),
    ...(headers.length === 0 ? {} : { headers }),
    ...(setCookieCount === 0 ? {} : { setCookieCount })
  };
};

const traceRequest = (
  request: Request,
  facts: StartRequestTraceFacts
): StartRequestTraceRequest => {
  const url = new URL(request.url);
  const headers = traceHeaders(request.headers);
  const cookies = traceCookies(request.headers);
  const traceparent = request.headers.get(startTraceparentHeader)?.trim() || undefined;
  return {
    id: facts.requestId,
    ...(traceparent === undefined ? {} : { traceparent }),
    method: request.method,
    url: request.url,
    path: url.pathname,
    transport: facts.transport,
    ...(headers.length === 0 ? {} : { headers }),
    ...(cookies.length === 0 ? {} : { cookies })
  };
};

const traceResourceRefs = (
  refs: ReadonlyArray<{ readonly key: string; readonly family: { readonly options: { readonly name: string } }; readonly input: unknown }>
): ReadonlyArray<StartRequestTraceResource> =>
  refs.map((ref) => ({
    key: ref.key,
    family: ref.family.options.name,
    input: ref.input
  }));

const traceRoutePlan = (
  plan: Route.NavigationPlan
): StartRequestTraceRoutePlan => ({
  _tag: plan._tag,
  href: plan.href,
  match: plan.match
    ? {
        path: plan.match.route.path,
        href: plan.match.href,
        params: plan.match.params,
        search: plan.match.search
      }
    : undefined,
  resources: traceResourceRefs(plan.refs).map((resource) => ({
    key: resource.key,
    family: resource.family,
    input: resource.input
  })),
  hydration: {
    resourceCount: plan.resources.resources.length
  }
});

const collectionTraceState = (
  runtime: EffectUiRuntime<unknown, unknown>,
  collection: AnyCollection
): string | undefined => {
  try {
    return runWithRuntime(runtime, () => collection.state().get()._tag);
  } catch {
    return undefined;
  }
};

const traceCollectionPreload = (
  runtime: EffectUiRuntime<unknown, unknown>,
  collectionPreload: StartCollectionPreload
): ReadonlyArray<StartRequestTraceCollection> =>
  uniqueCollections([
    ...collectionPreload.routeTouchedCollections,
    ...collectionPreload.routeDeclaredCollections,
    ...collectionPreload.registeredCollections,
    ...collectionPreload.dehydratedCollections
  ])
    .map((collection) => {
      const state = collectionTraceState(runtime, collection);
      return {
        name: collection.name,
        ...(state === undefined ? {} : { state })
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

const startRequestTraceFactsEffect = (
  request: Request
): Effect.Effect<StartRequestTraceFacts> =>
  Effect.gen(function* () {
    const incomingRequestId = request.headers.get(startRequestIdHeader)?.trim();
    const startedAt = yield* Clock.currentTimeMillis;
    return {
      requestId: incomingRequestId && !/[\r\n]/.test(incomingRequestId)
        ? incomingRequestId
        : yield* makeStartRequestIdEffect,
      transport: startRequestTraceTransport(request),
      startedAt,
      collections: [],
      serverFunctions: [],
      actions: []
    };
  });

const emitStartRequestTraceEffect = (
  handler: StartRequestTraceHandler | undefined,
  trace: StartRequestTrace
): Effect.Effect<void> =>
  handler === undefined
    ? Effect.void
    : toEffect(handler(trace)).pipe(
        Effect.catchCause(() => Effect.void)
      );

const buildStartRequestTrace = (
  request: Request,
  facts: StartRequestTraceFacts,
  status: StartRequestTraceStatus,
  options: {
    readonly response?: Response;
    readonly teardown: StartRequestTraceTeardown;
    readonly stream?: StartRequestTraceStream;
  }
): StartRequestTrace => ({
  request: traceRequest(request, facts),
  ...(options.response === undefined ? {} : { response: traceResponse(options.response) }),
  services: ["RequestContext", "ResponseContext"],
  ...(facts.routePlan === undefined ? {} : { routePlan: facts.routePlan }),
  resources: facts.routePlan?.resources ?? [],
  collections: facts.collections,
  serverFunctions: [...facts.serverFunctions],
  actions: [...facts.actions],
  fibers: [
    {
      name: "request-runtime",
      status: status === "success" ? "done" : status === "cancelled" ? "interrupted" : "failed"
    }
  ],
  streams: options.stream === undefined ? [] : [options.stream],
  status,
  teardown: options.teardown
});

const requestRuntimeTeardownSnapshot = (
  runtime: EffectUiRuntime<unknown, unknown>
): StartRequestTraceTeardownSnapshot => ({
  fiberCount: runtime.resourceStore.fibers.size,
  familyCount: runtime.resourceStore.families.size,
  moduleCount: runtime.resourceStore.modules.size,
  tagCount: runtime.resourceStore.tagIndex.size
});

const requestRuntimeDisposeTraceEffect = (
  runtime: EffectUiRuntime<unknown, unknown>
): Effect.Effect<{
  readonly beforeDispose: StartRequestTraceTeardownSnapshot;
  readonly afterDispose: StartRequestTraceTeardownSnapshot;
  readonly completedAt: number;
}> =>
  Effect.gen(function* () {
    const beforeDispose = requestRuntimeTeardownSnapshot(runtime);
    yield* runtime.disposeEffect;
    const afterDispose = requestRuntimeTeardownSnapshot(runtime);
    const completedAt = yield* Clock.currentTimeMillis;
    return {
      beforeDispose,
      afterDispose,
      completedAt
    };
  });

const startRequestTraceTeardown = (
  facts: StartRequestTraceFacts,
  options: {
    readonly runtimeDisposed: boolean;
    readonly reason: string;
    readonly completedAt: number;
    readonly beforeDispose: StartRequestTraceTeardownSnapshot;
    readonly afterDispose: StartRequestTraceTeardownSnapshot;
  }
): StartRequestTraceTeardown => ({
  runtimeDisposed: options.runtimeDisposed,
  reason: options.reason,
  at: options.completedAt,
  startedAt: facts.startedAt,
  completedAt: options.completedAt,
  durationMillis: Math.max(0, options.completedAt - facts.startedAt),
  beforeDispose: options.beforeDispose,
  afterDispose: options.afterDispose
});

const rpcJson = (body: Server.RpcResponse, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": startJsonMediaType
    }
  });

const actionJson = (body: StartActionResponseBody, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": startJsonMediaType
    }
  });

const readJsonEffect = (request: Request): Effect.Effect<unknown, ServerRpcProtocolError> =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) =>
      new ServerRpcProtocolError({
        message: "Expected a JSON server function request body.",
        payload: Server.serializeDefect(cause)
      })
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const decodeWithSchema = <A>(
  schema: unknown,
  input: unknown
): Effect.Effect<A, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(input)
    : Effect.succeed(input as A);

const encodeWithSchema = (
  schema: unknown,
  input: unknown
): Effect.Effect<unknown, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.encodeUnknownEffect(schema as Schema.Encoder<unknown>)(input)
    : Effect.succeed(input);

const protocolErrorBody = (error: ServerRpcProtocolError): StartActionResponseBody => ({
  _tag: "ServerError",
  error: Server.serializeServerError(error)
});

const rpcRuntimeFailureResponse = (error: unknown): Response =>
  rpcJson(
    {
      _tag: "Defect",
      defect: Server.serializeDefect(error)
    },
    500
  );

const actionRuntimeFailureResponse = (error: unknown): Response =>
  actionJson(
    {
      _tag: "Defect",
      defect: Server.serializeDefect(error)
    },
    500
  );

const actionProtocolFailureResponse = (
  error: ServerRpcProtocolError,
  status = 400
): Response => actionJson(protocolErrorBody(error), status);

const withTransportRequestErrorHeaders = (
  response: Response,
  error: StartTransportRequestError
): Response => {
  if (error.allow) {
    response.headers.set("allow", error.allow);
  }
  return response;
};

const actionTransportRequestFailureResponse = (
  error: StartTransportRequestError
): Response =>
  withTransportRequestErrorHeaders(
    actionProtocolFailureResponse(error.error, error.status),
    error
  );

const actionFunctionNotFoundResponse = (actionName: string): Response =>
  actionJson(
    {
      _tag: "ServerError",
      error: Server.serializeServerError(new ServerFunctionNotFound({ functionName: actionName }))
    },
    404
  );

const readActionJsonEffect = (request: Request): Effect.Effect<StartActionRequest, ServerRpcProtocolError> =>
  Effect.gen(function* () {
    const payload = yield* readJsonEffect(request);
    if (
      !isRecord(payload) ||
      typeof payload.name !== "string" ||
      !("input" in payload)
    ) {
      return yield* new ServerRpcProtocolError({
        message: "Expected an action request with string name and input fields.",
        payload
      });
    }

    return {
      name: payload.name,
      input: payload.input
    };
  });

const formValue = (value: FormDataEntryValue): unknown =>
  typeof value === "string" ? value : value.name;

const formDataToObject = (formData: FormData): Record<string, unknown> => {
  const input: Record<string, unknown> = {};

  formData.forEach((value, key) => {
    if (key === startActionNameField || key === startActionInputField) {
      return;
    }

    const next = formValue(value);
    const existing = input[key];
    if (existing === undefined) {
      input[key] = next;
    } else if (Array.isArray(existing)) {
      existing.push(next);
    } else {
      input[key] = [existing, next];
    }
  });

  return input;
};

const readActionFormEffect = (request: Request): Effect.Effect<StartActionRequest, ServerRpcProtocolError> =>
  Effect.gen(function* () {
    const formData = yield* Effect.tryPromise({
      try: () => request.formData(),
      catch: (cause) =>
        new ServerRpcProtocolError({
          message: "Expected an action form body.",
          payload: Server.serializeDefect(cause)
        })
    });
    const name = formData.get(startActionNameField);
    if (typeof name !== "string" || name.length === 0) {
      return yield* new ServerRpcProtocolError({
        message: `Missing ${startActionNameField} form field.`
      });
    }

    const fieldInput = formDataToObject(formData);
    const encodedInput = formData.get(startActionInputField);
    if (typeof encodedInput !== "string" || encodedInput.length === 0) {
      return {
        name,
        input: fieldInput
      };
    }

    const baseInput = yield* Effect.try({
      try: () => JSON.parse(encodedInput) as unknown,
      catch: (cause) =>
        new ServerRpcProtocolError({
          message: `Could not parse ${startActionInputField} as JSON.`,
          payload: Server.serializeDefect(cause)
        })
    });

    return {
      name,
      input: isRecord(baseInput)
        ? {
            ...baseInput,
            ...fieldInput
          }
        : baseInput
    };
  });

const readStartActionRequestEffect = (
  request: Request
): Effect.Effect<StartActionRequest, ServerRpcProtocolError> => {
  return hasContentType(request.headers, [startJsonMediaType])
    ? readActionJsonEffect(request)
    : readActionFormEffect(request);
};

const firstFail = <E>(cause: Cause.Cause<E>): E | undefined => {
  const reason = cause.reasons.find(Cause.isFailReason);
  return reason?.error;
};

const firstDefect = <E>(cause: Cause.Cause<E>): unknown | undefined => {
  const reason = cause.reasons.find(Cause.isDieReason);
  return reason?.defect;
};

const protocolFailureResponse = (error: ServerRpcProtocolError, status = 400): Response =>
  rpcJson(
    {
      _tag: "ServerError",
      error: Server.serializeServerError(error)
    },
    status
  );

const rpcTransportRequestFailureResponse = (
  error: StartTransportRequestError
): Response =>
  withTransportRequestErrorHeaders(
    protocolFailureResponse(error.error, error.status),
    error
  );

const functionNotFoundResponse = (functionName: string): Response =>
  rpcJson(
    {
      _tag: "ServerError",
      error: Server.serializeServerError(new ServerFunctionNotFound({ functionName }))
    },
    404
  );

const exitToRpcResponse = (
  fn: ServerFunction<unknown, unknown, unknown, unknown>,
  exit: Exit.Exit<unknown, unknown>
): Effect.Effect<Response, never> => {
  if (Exit.isSuccess(exit)) {
    return Effect.succeed(
      rpcJson({
        _tag: "Success",
        value: exit.value
      })
    );
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed(
        protocolFailureResponse(
          new ServerRpcProtocolError({
            message: failure.message,
            payload: Server.serializeDefect(failure)
          })
        )
      );
    }

    return Effect.gen(function* () {
      const encoded = yield* Effect.exit(Server.encodeError(fn, failure));
      if (Exit.isSuccess(encoded)) {
        return rpcJson({
          _tag: "Failure",
          error: encoded.value
        });
      }

      return rpcJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encoded.cause))
        },
        500
      );
    });
  }

  if (exit.cause.reasons.some(Cause.isInterruptReason)) {
    return Effect.succeed(
      rpcJson(
        {
          _tag: "Defect",
          defect: {
            _tag: "Interrupted",
            message: "The server function fiber was interrupted."
          }
        },
        499
      )
    );
  }

  return Effect.succeed(
    rpcJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(firstDefect(exit.cause) ?? Cause.pretty(exit.cause))
      },
      500
    )
  );
};

const createServerRpcResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  _app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  responseContext: ResponseContext = makeResponseContext(),
  traceFacts?: StartRequestTraceFacts
): Effect.Effect<Response, never, unknown> => {
  return Effect.gen(function* () {
    const diagnostics = yield* startTransportDiagnosticsEffect("rpc", request);
    const validation = yield* validateStartRpcRequestEffect(request).pipe(
      Effect.as(undefined),
      Effect.catch((error) => Effect.succeed(rpcTransportRequestFailureResponse(error)))
    );
    if (validation instanceof Response) {
      return withStartTransportDiagnostics(validation, diagnostics);
    }

    const response = yield* provideRequestRuntime(
      runtime,
      request,
      Effect.gen(function* () {
        const payload = yield* readJsonEffect(request).pipe(
          Effect.catch((error) => Effect.succeed(protocolFailureResponse(error)))
        );
        if (payload instanceof Response) {
          return payload;
        }

        const decoded = yield* Server.decodeRpcRequest(payload).pipe(
          Effect.catch((error) =>
            Effect.succeed(
              protocolFailureResponse(
                new ServerRpcProtocolError({
                  message: error.message,
                  payload: Server.serializeDefect(error)
                })
              )
            )
          )
        );
        if (decoded instanceof Response) {
          return decoded;
        }

        const fn = Server.get(decoded.name);
        if (!fn) {
          traceFacts?.serverFunctions.push({
            name: decoded.name,
            status: "failure"
          });
          return functionNotFoundResponse(decoded.name);
        }

        const exit = yield* Effect.exit(fn.invoke(decoded.input));
        traceFacts?.serverFunctions.push({
          name: decoded.name,
          status: Exit.isSuccess(exit) ? "success" : "failure"
        });
        return yield* exitToRpcResponse(fn, exit);
      }),
      responseContext
    ).pipe(Effect.catch((error) => Effect.succeed(rpcRuntimeFailureResponse(error))));

    return withStartTransportDiagnostics(response, diagnostics);
  });
};

export const createServerRpcResponseEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request
): Effect.Effect<Response, never, unknown> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.map(
      createServerRpcResponseEffectWithRuntime(app, request, runtime, responseContext),
      (response) => applyResponseContext(responseContext, response)
    ),
    runtime.disposeEffect
  );
};

const makeActionMap = (
  actions?: Iterable<StartActionDefinition>
): ReadonlyMap<string, StartActionDefinition> =>
  actions === undefined
    ? Action.definitions()
    : new Map(Array.from(actions, (action) => [action.name, action]));

const describeStartActionInvalidationTarget = (
  target: ResourceInvalidationPlan["targets"][number]
): StartActionInvalidationTarget | undefined => {
  if (isResourceRef(target)) {
    return {
      _tag: "Ref",
      key: target.key,
      family: target.family.options.name,
      input: target.input
    };
  }

  if (isResourceTag(target)) {
    return {
      _tag: "Tag",
      key: target.key,
      name: target.name
    };
  }

  return undefined;
};

const describeStartActionInvalidationCause = (
  cause: ResourceInvalidationCause
): StartActionInvalidationCause =>
  cause._tag === "Ref"
    ? {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name
      }
    : {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name
      };

export const describeStartActionInvalidationPlan = (
  plan: ResourceInvalidationPlan
): StartActionInvalidationPlan => ({
  targets: plan.targets.flatMap((target) => {
    const described = describeStartActionInvalidationTarget(target);
    return described === undefined ? [] : [described];
  }),
  entries: plan.entries.map((entry) => ({
    ref: {
      key: entry.ref.key,
      family: entry.ref.family.options.name,
      input: entry.ref.input
    },
    causes: entry.causes.map(describeStartActionInvalidationCause)
  }))
});

const actionResponseMetaEffect = (
  plan: ResourceInvalidationPlan | undefined
): Effect.Effect<StartActionResponseMeta> =>
  plan === undefined
    ? Effect.succeed({})
    : Effect.gen(function* () {
        const resources = yield* Resource.hydrationPayloadEffect(plan.entries.map((entry) => entry.ref));
        const hydration = createStartHydrationPayload(resources);
        return {
          invalidation: describeStartActionInvalidationPlan(plan),
          ...(hydration.resources.length === 0 &&
            (hydration.collections?.length ?? 0) === 0
            ? {}
            : { hydration })
        };
      });

const actionResponseMode = (request: Request): "json" | "redirect" =>
  hasContentType(request.headers, [startJsonMediaType]) ? "json" : "redirect";

const encodeActionResultEffect = (
  action: StartActionDefinition,
  result: unknown
): Effect.Effect<unknown, Schema.SchemaError> =>
  encodeWithSchema(action.output, result);

const encodedActionResultOrSelf = (
  action: StartActionDefinition,
  result: unknown
): Effect.Effect<unknown> =>
  Effect.map(
    Effect.exit(encodeActionResultEffect(action, result)),
    (exit) => Exit.isSuccess(exit) ? exit.value : result
  );

const actionResultResponseEffect = (
  action: StartActionDefinition,
  result: unknown,
  meta: StartActionResponseMeta = {},
  mode: "json" | "redirect" = "redirect"
): Effect.Effect<Response, never> => {
  const actionResult = ActionResult.is(result) ? result : undefined;

  if (actionResult && ActionResult.isRedirect(actionResult)) {
    if (mode === "json") {
      return Effect.succeed(
        actionJson({
          _tag: "Redirect",
          location: actionResult.location,
          status: actionResult.status,
          ...(actionResult.headers === undefined ? {} : { headers: actionResult.headers }),
          ...(actionResult.replace === undefined ? {} : { replace: actionResult.replace }),
          ...meta
        })
      );
    }

    return Effect.succeed(
      new Response(null, {
        status: actionResult.status,
        headers: {
          location: actionResult.location,
          ...(actionResult.headers ?? {})
        }
      })
    );
  }

  if (actionResult && ActionResult.isValidationFailure(actionResult)) {
    return Effect.map(
      encodedActionResultOrSelf(action, result),
      (encoded) => {
        const source = (isRecord(encoded) && encoded._tag === "ValidationFailure"
          ? encoded
          : actionResult) as {
            readonly fieldErrors?: unknown;
            readonly formErrors?: unknown;
            readonly cause?: unknown;
          };
        return actionJson(
          {
            _tag: "ValidationFailure",
            fieldErrors: source.fieldErrors,
            formErrors: Array.isArray(source.formErrors) ? source.formErrors : [],
            ...(source.cause === undefined ? {} : { cause: Server.serializeDefect(source.cause) }),
            ...meta
          },
          422
        );
      }
    );
  }

  if (actionResult && ActionResult.isFailure(actionResult)) {
    return Effect.map(
      encodedActionResultOrSelf(action, result),
      (encoded) => {
        const source = (isRecord(encoded) && encoded._tag === "Failure"
          ? encoded
          : actionResult) as { readonly error?: unknown };
        return actionJson({
          _tag: "Failure",
          error: source.error,
          ...meta
        });
      }
    );
  }

  if (actionResult && ActionResult.isSuccess(actionResult)) {
    return Effect.gen(function* () {
      const encodedResult = yield* Effect.exit(encodeActionResultEffect(action, result));
      if (
        Exit.isSuccess(encodedResult) &&
        isRecord(encodedResult.value) &&
        encodedResult.value._tag === "Success" &&
        "value" in encodedResult.value
      ) {
        return actionJson({
          _tag: "Success",
          value: encodedResult.value.value,
          ...meta
        });
      }

      const encodedValue = yield* Effect.exit(encodeWithSchema(action.output, actionResult.value));
      if (Exit.isSuccess(encodedValue)) {
        return actionJson({
          _tag: "Success",
          value: encodedValue.value,
          ...meta
        });
      }

      return actionJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encodedValue.cause))
        },
        500
      );
    });
  }

  return Effect.gen(function* () {
    const encoded = yield* Effect.exit(encodeWithSchema(action.output, result));
    if (Exit.isSuccess(encoded)) {
      return actionJson({
        _tag: "Success",
        value: encoded.value,
        ...meta
      });
    }

    return actionJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(Cause.pretty(encoded.cause))
      },
      500
    );
  });
};

const actionExitResponseEffect = (
  action: StartActionDefinition,
  exit: Exit.Exit<unknown, unknown>,
  meta: StartActionResponseMeta = {},
  mode: "json" | "redirect" = "redirect"
): Effect.Effect<Response, never> => {
  if (Exit.isSuccess(exit)) {
    return actionResultResponseEffect(action, exit.value, meta, mode);
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed(
        actionProtocolFailureResponse(
          new ServerRpcProtocolError({
            message: failure.message,
            payload: Server.serializeDefect(failure)
          })
        )
      );
    }

    return Effect.gen(function* () {
      const encoded = yield* Effect.exit(encodeWithSchema(action.error, failure));
      if (Exit.isSuccess(encoded)) {
        return actionJson({
          _tag: "Failure",
          error: encoded.value,
          ...meta
        });
      }

      return actionJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encoded.cause))
        },
        500
      );
    });
  }

  if (exit.cause.reasons.some(Cause.isInterruptReason)) {
    return Effect.succeed(
      actionJson(
        {
          _tag: "Defect",
          defect: {
            _tag: "Interrupted",
            message: "The action fiber was interrupted."
          }
        },
        499
      )
    );
  }

  return Effect.succeed(
    actionJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(firstDefect(exit.cause) ?? Cause.pretty(exit.cause))
      },
      500
    )
  );
};

const createServerActionResponseEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  _app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  actions?: Iterable<StartActionDefinition>,
  responseContext: ResponseContext = makeResponseContext(),
  traceFacts?: StartRequestTraceFacts
): Effect.Effect<Response, never, unknown> => {
  return Effect.gen(function* () {
    const diagnostics = yield* startTransportDiagnosticsEffect("action", request);
    const validation = yield* validateStartActionRequestEffect(request).pipe(
      Effect.as(undefined),
      Effect.catch((error) => Effect.succeed(actionTransportRequestFailureResponse(error)))
    );
    if (validation instanceof Response) {
      return withStartTransportDiagnostics(validation, diagnostics);
    }

    const response = yield* provideRequestRuntime(
      runtime,
      request,
      Effect.gen(function* () {
        const decoded = yield* readStartActionRequestEffect(request).pipe(
          Effect.catch((error) => Effect.succeed(actionProtocolFailureResponse(error)))
        );
        if (decoded instanceof Response) {
          return decoded;
        }

        const action = makeActionMap(actions).get(decoded.name);
        if (!action) {
          traceFacts?.actions.push({
            name: decoded.name,
            state: "Failure"
          });
          return actionFunctionNotFoundResponse(decoded.name);
        }

        const input = yield* decodeWithSchema(action.input, decoded.input).pipe(
          Effect.catch((error) =>
            Effect.succeed(
              actionProtocolFailureResponse(
                new ServerRpcProtocolError({
                  message: error.message,
                  payload: Server.serializeDefect(error)
                })
              )
            )
          )
        );
        if (input instanceof Response) {
          return input;
        }

        const instance = Action.use(action, { runtime });
        const exit = yield* Effect.exit(instance.submitEffect(input));
        const meta = yield* actionResponseMetaEffect(instance.invalidationPlan.get());
        traceFacts?.actions.push({
          name: action.name,
          state: Exit.isSuccess(exit) ? "Success" : "Failure"
        });
        return yield* actionExitResponseEffect(action, exit, meta, actionResponseMode(request));
      }),
      responseContext
    ).pipe(Effect.catch((error) => Effect.succeed(actionRuntimeFailureResponse(error))));

    return withStartTransportDiagnostics(response, diagnostics);
  });
};

export const createServerActionResponseEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  actions?: Iterable<StartActionDefinition>
): Effect.Effect<Response, never, unknown> => {
  const runtime = makeRequestRuntime(app);
  const responseContext = makeResponseContext();
  return Effect.ensuring(
    Effect.map(
      createServerActionResponseEffectWithRuntime(app, request, runtime, actions, responseContext),
      (response) => applyResponseContext(responseContext, response)
    ),
    runtime.disposeEffect
  );
};

const getRpcHeadersEffect = (
  options: ServerRpcClientOptions
): Effect.Effect<Headers> =>
  Effect.gen(function* () {
    const headers = new Headers(
      typeof options.headers === "function" ? options.headers() : options.headers
    );
    if (!headers.has(startRequestIdHeader)) {
      headers.set(startRequestIdHeader, yield* makeStartRequestIdEffect);
    }
    headers.set("accept", startJsonMediaType);
    headers.set("content-type", startJsonMediaType);
    return headers;
  });

const parseRpcResponse = (
  response: Response
): Effect.Effect<Server.RpcResponse, ServerTransportError | Schema.SchemaError> =>
  Effect.gen(function* () {
    yield* validateStartRpcResponseEffect(response);
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Could not read the server function response body.",
          cause
        })
    });
    const payload = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Server function response was not valid JSON.",
          cause,
          payload: text
        })
    });
    return yield* Server.decodeRpcResponse(payload);
  });

const isStartActionResponseBody = (value: unknown): value is StartActionResponseBody =>
  isRecord(value) &&
  (
    value._tag === "Success" ||
    value._tag === "ValidationFailure" ||
    value._tag === "Redirect" ||
    value._tag === "Failure" ||
    value._tag === "ServerError" ||
    value._tag === "Defect"
  );

const parseStartActionResponse = (
  response: Response
): Effect.Effect<StartActionResponseBody, ServerTransportError> =>
  Effect.gen(function* () {
    yield* validateStartRpcResponseEffect(response);
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Could not read the action response body.",
          cause
        })
    });
    const payload = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Action response was not valid JSON.",
          cause,
          payload: text
        })
    });
    if (!isStartActionResponseBody(payload)) {
      return yield* new ServerTransportError({
        reason: "InvalidResponse",
        status: response.status,
        message: "Action response did not match the Effect UI Start action protocol.",
        payload
      });
    }

    return payload;
  });

const startActionResponseMeta = (
  body: StartActionResponseBody
): StartActionResponseMeta => ({
  ...("invalidation" in body && body.invalidation !== undefined ? { invalidation: body.invalidation } : {}),
  ...("hydration" in body && body.hydration !== undefined ? { hydration: body.hydration } : {})
});

const hasActionResultTag = (
  value: unknown
): value is Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }> =>
  isRecord(value) &&
  (
    value._tag === "Success" ||
    value._tag === "ValidationFailure" ||
    value._tag === "Redirect" ||
    value._tag === "Failure"
  );

const normalizeDecodedActionResult = (
  decoded: Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }>,
  meta: StartActionResponseMeta
): StartActionResult<unknown> => {
  switch (decoded._tag) {
    case "Success":
      return {
        _tag: "Success",
        value: decoded.value,
        ...meta
      };
    case "ValidationFailure":
      return {
        _tag: "ValidationFailure",
        fieldErrors: decoded.fieldErrors as FormFieldErrors<Record<string, unknown>, unknown>,
        formErrors: decoded.formErrors,
        ...(decoded.cause === undefined ? {} : { cause: decoded.cause }),
        ...meta
      };
    case "Redirect":
      return {
        _tag: "Redirect",
        location: decoded.location,
        status: decoded.status,
        ...(decoded.headers === undefined ? {} : { headers: decoded.headers }),
        ...(decoded.replace === undefined ? {} : { replace: decoded.replace }),
        ...meta
      };
    case "Failure":
      return {
        _tag: "Failure",
        error: decoded.error,
        ...meta
      };
  }
};

const decodeActionOutputResultEffect = (
  definition: StartActionDefinition,
  body: Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }>,
  meta: StartActionResponseMeta
): Effect.Effect<StartActionResult<unknown>, Schema.SchemaError> =>
  Effect.gen(function* () {
    const decoded = yield* Effect.exit(decodeWithSchema(definition.output, body));
    if (Exit.isSuccess(decoded) && hasActionResultTag(decoded.value)) {
      return normalizeDecodedActionResult(decoded.value, meta);
    }

    switch (body._tag) {
      case "Success":
        return {
          _tag: "Success",
          value: yield* decodeWithSchema(definition.output, body.value),
          ...meta
        };
      case "Failure":
        return {
          _tag: "Failure",
          error: yield* decodeWithSchema(definition.error, body.error),
          ...meta
        };
      case "ValidationFailure":
        return normalizeDecodedActionResult(body, meta);
      case "Redirect":
        return normalizeDecodedActionResult(body, meta);
    }
  });

const decodeStartActionResponseEffect = <D extends StartActionDefinition>(
  definition: D,
  body: Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }>
): Effect.Effect<
  StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>,
  Schema.SchemaError
> =>
  Effect.map(
    decodeActionOutputResultEffect(definition, body, startActionResponseMeta(body)),
    (decoded) => decoded as StartActionResultFor<
      ActionDefinitionOutputValue<D>,
      ActionDefinitionErrorValue<D>
    >
  );

const hydrateActionResponseEffect = (
  body: StartActionResponseBody,
  options: StartActionClientOptions
): Effect.Effect<void, never, unknown> => {
  const invalidationTargets = "invalidation" in body && body.invalidation
    ? body.invalidation.targets.flatMap((target): ReadonlyArray<ResourceInvalidation> =>
        target._tag === "Tag"
          ? [{
              [ResourceTagTypeId]: ResourceTagTypeId,
              name: target.name,
              key: target.key
            }]
          : []
      )
    : [];
  const hydrationKeys = new Set(
    "hydration" in body && body.hydration
      ? body.hydration.resources.map((resource) => resource.key)
      : []
  );
  const effect = Effect.gen(function* () {
    if ("hydration" in body && body.hydration !== undefined) {
      yield* hydrateStartPayloadEffect(body.hydration, options);
    }

    if (invalidationTargets.length > 0) {
      const plan = yield* Resource.planInvalidationEffect(invalidationTargets);
      yield* Resource.runInvalidationPlanEffect({
        targets: plan.targets,
        entries: plan.entries.filter((entry) => !hydrationKeys.has(entry.ref.key))
      });
    }
  });

  return options.runtime
    ? options.runtime.provide(effect).pipe(Effect.catch((error) => Effect.die(error)))
    : effect;
};

export const submitStartActionEffect = <D extends StartActionDefinition>(
  definition: D,
  input: ActionDefinitionInputValue<D>,
  options: StartActionClientOptions = {}
): Effect.Effect<
  StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>,
  Server.ClientError,
  unknown
> =>
  Effect.gen(function* () {
    const fetcher = options.fetch ?? globalThis.fetch;
    if (!fetcher) {
      return yield* new ServerTransportError({
        reason: "Network",
        message: "No fetch implementation is available for Start actions."
      });
    }

    const encodedInput = yield* encodeWithSchema(definition.input, input);
    const request: StartActionRequest = {
      name: definition.name,
      input: encodedInput
    };
    const body = yield* Effect.try({
      try: () => JSON.stringify(request),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          message: "Could not encode the action request body.",
          cause,
          payload: request
        })
    });
    const headers = yield* getRpcHeadersEffect(options);
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetcher(options.endpoint ?? serverActionPath, {
          method: "POST",
          headers,
          body,
          signal,
          redirect: "manual"
        }),
      catch: (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: "Start action request failed.",
          cause
        })
    });
    const actionResponse = yield* parseStartActionResponse(response);

    if (actionResponse._tag === "ServerError") {
      return yield* Effect.fail(Server.deserializeServerError(actionResponse.error));
    }

    if (actionResponse._tag === "Defect") {
      return yield* new ServerTransportError({
        reason: "Defect",
        status: response.status,
        message: "Start action failed with a defect.",
        payload: actionResponse.defect
      });
    }

    const decoded = yield* decodeStartActionResponseEffect(definition, actionResponse);
    yield* hydrateActionResponseEffect(actionResponse, options);
    return decoded;
  });

export const submitStartAction = <D extends StartActionDefinition>(
  definition: D,
  input: ActionDefinitionInputValue<D>,
  options: StartActionClientOptions = {}
): Promise<StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>> =>
  (options.runtime ?? currentOrDefaultRuntime()).runPromise(
    submitStartActionEffect(definition, input, options)
  );

const previousStartActionValue = <I, A, E>(
  state: ActionState<I, A, E>
): A | undefined => {
  switch (state._tag) {
    case "Success":
      return state.value;
    case "Failure":
    case "Pending":
      return state.previous;
    case "Idle":
      return undefined;
  }
};

export namespace StartAction {
  export type Result<D extends StartActionDefinition> =
    StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>;

  export type State<D extends StartActionDefinition> =
    ActionState<ActionDefinitionInputValue<D>, Result<D>, Server.ClientError>;

  export interface Instance<D extends StartActionDefinition> {
    readonly definition: D;
    readonly state: ReadableSignal<State<D>>;
    readonly invalidation: ReadableSignal<StartActionInvalidationPlan | undefined>;
    readonly hydration: ReadableSignal<StartHydrationPayload | undefined>;
    submitEffect(input: ActionDefinitionInputValue<D>): Effect.Effect<Result<D>, Server.ClientError | ActionInterrupted, unknown>;
    submit(input: ActionDefinitionInputValue<D>): Promise<Result<D>>;
    resetEffect(): Effect.Effect<void>;
    reset(): void;
  }

  export const use = <D extends StartActionDefinition>(
    definition: D,
    options: StartActionClientOptions = {}
  ): Instance<D> => {
    const runtime = options.runtime ?? currentOrDefaultRuntime();
    const state = Signal.make<State<D>>({ _tag: "Idle" });
    const invalidation = Signal.make<StartActionInvalidationPlan | undefined>(undefined);
    const hydration = Signal.make<StartHydrationPayload | undefined>(undefined);
    let version = 0;
    let currentSubmission:
      | {
          readonly token: object;
          fiber?: Fiber.Fiber<Result<D>, Server.ClientError | ActionInterrupted>;
          promise?: Promise<Result<D>>;
        }
      | undefined;

    const runWorkflow = (
      input: ActionDefinitionInputValue<D>,
      token: number,
      workflowOptions: {
        readonly interruptStale: boolean;
        readonly updateOnlyLatest: boolean;
      }
    ): Effect.Effect<Result<D>, Server.ClientError | ActionInterrupted, unknown> =>
      Effect.gen(function* () {
        const previous = previousStartActionValue(state.get());
        invalidation.set(undefined);
        hydration.set(undefined);
        state.set({
          _tag: "Pending",
          input,
          ...(previous === undefined ? {} : { previous })
        });

        const value = yield* submitStartActionEffect(definition, input, {
          ...options,
          runtime
        });
        const isLatest = token === version;
        if (workflowOptions.interruptStale && !isLatest) {
          return yield* new ActionInterrupted({ actionName: definition.name });
        }

        if (!workflowOptions.updateOnlyLatest || isLatest) {
          invalidation.set(value.invalidation);
          hydration.set(value.hydration);
          state.set({
            _tag: "Success",
            value,
            input
          });
        }

        return value;
      }).pipe(
        Effect.catch((error: Server.ClientError | ActionInterrupted): Effect.Effect<never, Server.ClientError | ActionInterrupted> => {
          if (error instanceof ActionInterrupted) {
            return Effect.fail(error);
          }

          const previous = previousStartActionValue(state.get());
          if (!workflowOptions.updateOnlyLatest || token === version) {
            state.set({
              _tag: "Failure",
              error,
              input,
              ...(previous === undefined ? {} : { previous })
            });
          }
          return Effect.fail(error);
        })
      );

    const submitEffect = (
      input: ActionDefinitionInputValue<D>
    ): Effect.Effect<Result<D>, Server.ClientError | ActionInterrupted, unknown> =>
      Effect.suspend(() => {
        const concurrency = definition.policy?.concurrency ?? "latest";
        const current = currentSubmission;
        if (concurrency === "exhaust" && current?.fiber) {
          return Fiber.join(current.fiber);
        }

        const previousFiber = concurrency === "latest" ? current?.fiber : undefined;
        const token = ++version;
        const submissionToken = {};
        return Effect.withFiber((fiber) => {
          if (concurrency !== "parallel") {
            currentSubmission = {
              token: submissionToken,
              fiber: fiber as Fiber.Fiber<Result<D>, Server.ClientError | ActionInterrupted>
            };
          }

          return Effect.gen(function* () {
            if (previousFiber && previousFiber !== fiber) {
              yield* Fiber.interrupt(previousFiber);
            }

            return yield* runWorkflow(input, token, {
              interruptStale: concurrency === "latest",
              updateOnlyLatest: true
            });
          }).pipe(Effect.ensuring(clearCurrentEffect(submissionToken)));
        });
      });

    const resetEffect = (): Effect.Effect<void> =>
      Effect.sync(() => {
        version++;
        invalidation.set(undefined);
        hydration.set(undefined);
        state.set({ _tag: "Idle" });
      });

    const clearCurrentEffect = (token: object): Effect.Effect<void> =>
      Effect.sync(() => {
        if (currentSubmission?.token === token) {
          currentSubmission = undefined;
        }
      });

    const submit = (input: ActionDefinitionInputValue<D>): Promise<Result<D>> => {
      const concurrency = definition.policy?.concurrency ?? "latest";

      if (concurrency === "exhaust") {
        const current = currentSubmission;
        if (current?.promise) {
          return current.promise;
        }
        if (current?.fiber) {
          return runtime.runPromise(Fiber.join(current.fiber));
        }
      }

      const previousFiber = concurrency === "latest" ? currentSubmission?.fiber : undefined;
      const token = ++version;
      const submissionToken = {};
      if (concurrency !== "parallel") {
        currentSubmission = { token: submissionToken };
      }

      const fiber = runtime.runFork(
        Effect.gen(function* () {
          if (previousFiber) {
            yield* Fiber.interrupt(previousFiber);
          }

          return yield* runWorkflow(input, token, {
            interruptStale: concurrency === "latest",
            updateOnlyLatest: true
          });
        })
      );

      const promise = runtime.runPromise(
        Fiber.join(fiber).pipe(
          Effect.ensuring(clearCurrentEffect(submissionToken))
        )
      );

      if (concurrency !== "parallel" && currentSubmission?.token === submissionToken) {
        currentSubmission.fiber = fiber;
        currentSubmission.promise = promise;
      }

      return promise;
    };

    return {
      definition,
      state,
      invalidation,
      hydration,
      submitEffect,
      submit,
      resetEffect,
      reset: () => {
        const submission = currentSubmission;
        if (submission?.fiber) {
          void runtime.runPromise(Fiber.interrupt(submission.fiber));
        }
        currentSubmission = undefined;
        runtime.runSync(resetEffect());
      }
    };
  };
}

export const makeRpcClient = (options: ServerRpcClientOptions = {}): ServerClient => ({
  call: (fn, input) =>
    Effect.gen(function* () {
      const fetcher = options.fetch ?? globalThis.fetch;
      if (!fetcher) {
        return yield* new ServerTransportError({
          reason: "Network",
          message: "No fetch implementation is available for server functions."
        });
      }

      const encodedInput = yield* Server.encodeInput(fn, input);
      const request: Server.RpcRequest = {
        name: fn.name,
        input: encodedInput
      };
      const body = yield* Effect.try({
        try: () => JSON.stringify(request),
        catch: (cause) =>
          new ServerTransportError({
            reason: "InvalidResponse",
            message: "Could not encode the server function request body.",
            cause,
            payload: request
          })
      });
      const headers = yield* getRpcHeadersEffect(options);
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetcher(options.endpoint ?? serverRpcPath, {
            method: "POST",
            headers,
            body,
            signal
          }),
        catch: (cause) =>
          new ServerTransportError({
            reason: "Network",
            message: "Server function request failed.",
            cause
          })
      });
      const rpcResponse = yield* parseRpcResponse(response);

      switch (rpcResponse._tag) {
        case "Success":
          if (!response.ok) {
            return yield* new ServerTransportError({
              reason: "BadStatus",
              status: response.status,
              message: `Server function succeeded with unexpected HTTP status ${response.status}.`,
              payload: rpcResponse
            });
          }
          return yield* Server.decodeOutput(fn, rpcResponse.value);
        case "Failure":
          if (!response.ok) {
            return yield* new ServerTransportError({
              reason: "BadStatus",
              status: response.status,
              message: `Server function failed with unexpected HTTP status ${response.status}.`,
              payload: rpcResponse
            });
          }
          return yield* Effect.fail(yield* Server.decodeError(fn, rpcResponse.error));
        case "ServerError":
          return yield* Effect.fail(Server.deserializeServerError(rpcResponse.error));
        case "Defect":
          return yield* new ServerTransportError({
            reason: "Defect",
            status: response.status,
            message: "Server function failed with a defect.",
            payload: rpcResponse.defect
          });
      }
    })
});

export const makeRpcClientLayer = (options: ServerRpcClientOptions = {}) =>
  Layer.succeed(ServerClient)(makeRpcClient(options));

export const BrowserRpcLive = makeRpcClientLayer();

const emptyCollectionHydrationPayload: CollectionHydrationPayload = { collections: [] };

const collectionArray = (
  collections: Iterable<AnyCollection> | undefined
): ReadonlyArray<AnyCollection> =>
  collections ? Array.from(collections) : [];

const uniqueCollections = (
  collections: Iterable<AnyCollection>
): ReadonlyArray<AnyCollection> => {
  const names = new Set<string>();
  const out: Array<AnyCollection> = [];
  for (const collection of collections) {
    if (!names.has(collection.name)) {
      names.add(collection.name);
      out.push(collection);
    }
  }
  return out;
};

const routeDeclaredCollections = (
  routePlan: Route.NavigationPlan
): ReadonlyArray<AnyCollection> => {
  if (routePlan._tag !== "Matched") {
    return [];
  }

  const definitions = Collection.definitions();
  return Route.preloadCollectionNames(routePlan.match.route)
    .flatMap((name) => {
      const collection = definitions.get(name);
      return collection ? [collection] : [];
    });
};

const preloadRouteDeclaredCollectionsEffect = (
  routeDeclaredCollections: ReadonlyArray<AnyCollection>,
  routeTouchedCollections: ReadonlyArray<AnyCollection>
): Effect.Effect<void, unknown, unknown> =>
  Effect.gen(function* () {
    const touchedNames = new Set(routeTouchedCollections.map((collection) => collection.name));
    for (const collection of routeDeclaredCollections) {
      if (!touchedNames.has(collection.name)) {
        yield* collection.preloadEffect();
      }
    }
  });

const startCollectionPreloadEffect = (
  routeTouchedCollections: ReadonlyArray<AnyCollection>,
  routeDeclaredCollections: ReadonlyArray<AnyCollection>,
  options: StartCollectionHydrationOptions = {}
): Effect.Effect<StartCollectionPreload> =>
  Effect.gen(function* () {
    const registeredCollections = collectionArray(options.collections);
    const dehydratedCollections = uniqueCollections([
      ...registeredCollections,
      ...routeDeclaredCollections,
      ...routeTouchedCollections
    ]);
    const hydration = dehydratedCollections.length > 0
      ? yield* Collection.dehydrateEffect(dehydratedCollections)
      : emptyCollectionHydrationPayload;

    return {
      routeTouchedCollections,
      routeDeclaredCollections,
      registeredCollections,
      dehydratedCollections,
      hydration
    };
  });

const preloadRequestEffectWithRuntime = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  runtime: EffectUiRuntime<ServerServices, ServerError>,
  options: PreloadRequestOptions = {},
  responseContext: ResponseContext = makeResponseContext()
): Effect.Effect<StartPreloadResult<Routes>, unknown> =>
  Effect.scoped(
    provideRequestRuntime(runtime, request, Effect.gen(function* () {
      const collectedRoutePlan = yield* Collection.collectEffect(
        Route.planNavigationEffect(app.routes, new URL(request.url))
      );
      const routePlan = collectedRoutePlan.value;
      const declaredCollections = routeDeclaredCollections(routePlan);
      yield* preloadRouteDeclaredCollectionsEffect(declaredCollections, collectedRoutePlan.definitions);
      const collectionPreload = yield* startCollectionPreloadEffect(
        collectedRoutePlan.definitions,
        declaredCollections,
        options
      );
      const collections = collectionPreload.hydration;
      const hydration = createStartHydrationPayload(routePlan.resources, collections);
      return {
        match: routePlan.match,
        resources: routePlan.resources,
        collections,
        collectionPreload,
        hydration,
        routePlan
      };
    }), responseContext)
  );

const responseWithRuntimeFinalizer = (
  response: Response,
  runtime: EffectUiRuntime<unknown, unknown>,
  options: {
    readonly onFinalize?: (state: {
      readonly stream: StartRequestTraceStream;
      readonly status: StartRequestTraceStatus;
      readonly teardownReason: string;
      readonly beforeDispose: StartRequestTraceTeardownSnapshot;
      readonly afterDispose: StartRequestTraceTeardownSnapshot;
      readonly completedAt: number;
    }) => Effect.Effect<void>;
  } = {}
): Response => {
  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  let disposed = false;
  let chunkCount = 0;
  const disposeEffect = (
    stream: StartRequestTraceStream,
    status: StartRequestTraceStatus,
    teardownReason: string
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const shouldDispose = yield* Effect.sync(() => {
        if (disposed) {
          return false;
        }

        disposed = true;
        return true;
      });
      if (!shouldDispose) {
        return;
      }

      const teardown = yield* requestRuntimeDisposeTraceEffect(runtime);
      if (options.onFinalize) {
        yield* options.onFinalize({
          stream,
          status,
          teardownReason,
          ...teardown
        });
      }
    });

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      return runtime.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => reader.read(),
            catch: (cause) => cause
          });
          if (result.done) {
            yield* disposeEffect(
              {
                name: "response",
                state: "closed",
                chunkCount
              },
              "success",
              "stream-close"
            );
            yield* Effect.sync(() => {
              controller.close();
            });
            return;
          }

          yield* Effect.sync(() => {
            chunkCount += 1;
            controller.enqueue(result.value);
          });
        }).pipe(
          Effect.catch((cause) =>
            Effect.gen(function* () {
              yield* disposeEffect(
                {
                  name: "response",
                  state: "errored",
                  chunkCount
                },
                "failure",
                "stream-error"
              );
              yield* Effect.sync(() => {
                controller.error(cause);
              });
            })
          )
        )
      );
    },
    cancel(reason) {
      return runtime.runPromise(
        Effect.tryPromise({
          try: () => reader.cancel(reason),
          catch: (cause) => cause
        }).pipe(
          Effect.ensuring(
            disposeEffect(
              {
                name: "response",
                state: "cancelled",
                chunkCount
              },
              "cancelled",
              typeof reason === "string" ? reason : "stream-cancel"
            )
          )
        )
      );
    }
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
};

const completeRequestRuntimeWithResponse = (
  runtime: EffectUiRuntime<unknown, unknown>,
  response: Response,
  options: {
    readonly onFinalize?: (state: {
      readonly stream?: StartRequestTraceStream;
      readonly status: StartRequestTraceStatus;
      readonly teardownReason: string;
      readonly beforeDispose: StartRequestTraceTeardownSnapshot;
      readonly afterDispose: StartRequestTraceTeardownSnapshot;
      readonly completedAt: number;
    }) => Effect.Effect<void>;
    readonly onStreamFinalize?: (state: {
      readonly stream: StartRequestTraceStream;
      readonly status: StartRequestTraceStatus;
      readonly teardownReason: string;
      readonly beforeDispose: StartRequestTraceTeardownSnapshot;
      readonly afterDispose: StartRequestTraceTeardownSnapshot;
      readonly completedAt: number;
    }) => Effect.Effect<void>;
  } = {}
): Effect.Effect<Response> =>
  response.body
    ? Effect.succeed(
        responseWithRuntimeFinalizer(
          response,
          runtime,
          options.onStreamFinalize === undefined
            ? {}
            : { onFinalize: options.onStreamFinalize }
        )
      )
    : Effect.gen(function* () {
        const teardown = yield* requestRuntimeDisposeTraceEffect(runtime);
        if (options.onFinalize) {
          yield* options.onFinalize({
            status: "success",
            teardownReason: "response-end",
            ...teardown
          });
        }
        return response;
      });

export const preloadRequestEffect = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  options: PreloadRequestOptions = {}
): Effect.Effect<StartPreloadResult<Routes>, unknown> => {
  const runtime = makeRequestRuntime(app);
  return Effect.ensuring(
    preloadRequestEffectWithRuntime(app, request, runtime, options),
    runtime.disposeEffect
  );
};

export const preloadRequest = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  options: PreloadRequestOptions = {}
): Promise<StartPreloadResult<Routes>> =>
  app.runtime.runPromise(preloadRequestEffect(app, request, options));

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
      const responseExit = yield* Effect.exit(
        Effect.gen(function* () {
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
          traceFacts.routePlan = traceRoutePlan(preloaded.routePlan);
          traceFacts.collections = [
            ...traceCollectionPreload(requestRuntime, preloaded.collectionPreload)
          ];
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
        })
      );

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
            onFinalize: (state: {
              readonly stream?: StartRequestTraceStream;
              readonly status: StartRequestTraceStatus;
              readonly teardownReason: string;
              readonly beforeDispose: StartRequestTraceTeardownSnapshot;
              readonly afterDispose: StartRequestTraceTeardownSnapshot;
              readonly completedAt: number;
            }) =>
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
            onStreamFinalize: (state: {
              readonly stream: StartRequestTraceStream;
              readonly status: StartRequestTraceStatus;
              readonly teardownReason: string;
              readonly beforeDispose: StartRequestTraceTeardownSnapshot;
              readonly afterDispose: StartRequestTraceTeardownSnapshot;
              readonly completedAt: number;
            }) =>
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
    });

export const createRequestHandler =
  <
    const Routes extends readonly Route.Definition<string, unknown, unknown>[],
    Client,
    ServerServices,
    ServerError
  >(
    app: AppDefinition<Routes, Client, ServerServices, ServerError>,
    options: CreateRequestHandlerOptions<Routes, Client, ServerServices, ServerError> = {}
  ): StartRequestHandler => {
    const handler = createRequestHandlerEffect(app, options);
    return (request) => app.runtime.runPromise(handler(request));
  };

export const createServerHandler = createRequestHandler;
export const createServerHandlerEffect = createRequestHandlerEffect;
export {
  acceptsMediaType,
  hasContentType,
  makeStartRequestId,
  makeStartRequestIdEffect,
  mediaTypeOf,
  serverActionPath,
  serverRpcPath,
  startBaggageHeader,
  startFormUrlEncodedMediaType,
  startHtmlMediaType,
  startJsonMediaType,
  startMultipartFormDataMediaType,
  startRequestIdHeader,
  startTraceparentHeader,
  startTransportDiagnosticsEffect,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion,
  startTransportRequestHeaders,
  startTransportResponseHeaders,
  StartTransportRequestError,
  validateStartActionRequestEffect,
  validateStartRpcRequestEffect,
  validateStartRpcResponseEffect,
  validateStartTransportAcceptEffect,
  validateStartTransportContentTypeEffect,
  validateStartTransportMethodEffect,
  withStartTransportDiagnostics,
  type StartTransportDiagnostics,
  type StartTransportKind,
  type StartTransportRequestHeadersOptions
} from "./rpc.js";

export {
  Action,
  defineApp,
  read,
  Resource,
  route,
  Route,
  Server,
  ServerClient,
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
  Signal
} from "@effect-ui/core";
