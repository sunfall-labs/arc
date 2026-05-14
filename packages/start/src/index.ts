import {
  Action,
  ActionInterrupted,
  currentOrDefaultRuntime,
  Resource,
  Signal,
  runWithRuntime,
  applyResponseContext,
  makeResponseContext,
  Route,
  Server,
  ServerClient,
  ServerRpcProtocolError,
  ServerTransportError,
  type AppDefinition,
  type EffectUiRuntime,
  type ResponseContext,
  type ResourceStore as ResourceStoreState,
  type ResourceHydrationPayload,
  type ActionState,
  type ReadableSignal
} from "@effect-ui/core";
import { Collection, type AnyCollection, type CollectionHydrationPayload } from "@effect-ui/db";
import { Effect, Exit, Fiber, Layer } from "effect";
import type { EffectInput } from "@effect-ui/core";
import { toEffect } from "@effect-ui/core";
import {
  createHydrationScript,
  createStartHydrationPayload,
  type PreloadRequestOptions,
  type StartCollectionHydrationOptions,
  type StartHydrationPayload
} from "./hydration.js";

export {
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric
} from "./request-trace.js";
import {
  serverActionPath,
  serverRpcPath,
  startTransportDiagnosticsEffect,
  validateStartActionRequestEffect,
  validateStartRpcRequestEffect,
  withStartTransportDiagnostics
} from "./rpc.js";
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
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestTraceFactsEffect,
  startRequestStatusMetric,
  startRequestTraceTeardown,
  traceCollectionPreload,
  traceRoutePlan,
  withStartActionObservability,
  withStartRequestObservability,
  withStartRpcObservability,
  type StartRequestTraceFacts,
  type StartRequestTraceHandler
} from "./request-trace.js";
import {
  callStartFetchEffect,
  getStartTransportHeadersEffect as getRpcHeadersEffect,
  resolveStartFetchEffect,
  type ServerRpcClientOptions
} from "./start-fetch.js";
import {
  actionExitResponseEffect,
  actionFailureKindEffect,
  actionFunctionNotFoundResponse,
  actionProtocolFailureResponse,
  actionResponseMetaEffect,
  actionResponseMode,
  actionRuntimeFailureResponse,
  actionTransportRequestFailureResponse,
  decodeStartActionResponseEffect,
  decodeWithSchema,
  encodeWithSchema,
  exitToRpcResponse,
  functionNotFoundResponse,
  hydrateActionResponseEffect,
  isServerActionRequest,
  isServerRpcRequest,
  makeActionMap,
  parseRpcResponse,
  parseStartActionResponse,
  protocolFailureResponse,
  readJsonEffect,
  readStartActionRequestEffect,
  rpcFailureKindEffect,
  rpcRuntimeFailureResponse,
  rpcTransportRequestFailureResponse,
  type ActionDefinitionErrorValue,
  type ActionDefinitionInputValue,
  type ActionDefinitionOutputValue,
  type StartActionClientOptions,
  type StartActionDefinition,
  type StartActionInvalidationPlan,
  type StartActionRequest,
  type StartActionResultFor
} from "./start-transport-protocol.js";

export * from "./hydration.js";
export * from "./streaming.js";
export * from "./server-function-manifest.js";
export * from "./action-manifest.js";
export * from "./app-graph.js";
export * from "./effect-rpc-compat.js";
export * from "./diagnostics-report.js";
export * from "./file-route-modules.js";
export * from "./file-route.js";
export * from "./start-transport-protocol.js";

export {
  /** Builds the inline script that transfers Start hydration payloads to HTML. */
  createHydrationScript,
  /** Combines resource and collection payloads into the Start hydration shape. */
  createStartHydrationPayload,
  /** Hydrates resources and collections from a Start payload as an Effect. */
  hydrateStartPayloadEffect,
  /** Reads and hydrates Start payloads from a document as an Effect. */
  hydrateFromDocumentEffect,
  /** Reads and hydrates streamed hydration chunks as an Effect. */
  hydrateStartHydrationChunksEffect,
  /** Reads streamed hydration chunks from a document and hydrates them. */
  hydrateStartHydrationChunksFromDocumentEffect,
  /** Synchronous runtime boundary for hydrating a Start payload. */
  hydrateStartPayload,
  /** Synchronous runtime boundary for hydrating from a document. */
  hydrateFromDocument,
  /** Serializes a streamed hydration chunk into a script tag. */
  createStreamHydrationScript,
  /** Parses ordered streamed hydration chunks from a document-like object. */
  readStartHydrationChunks,
  /** Start SSR hydration payload for resources and collections. */
  type StartHydrationPayload,
  /** Shared options for request preload and client hydration collections. */
  type StartCollectionHydrationOptions,
  /** Options passed to request preload before SSR rendering. */
  type PreloadRequestOptions
} from "./hydration.js";

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

/**
 * Data Start prepares before rendering a request: the matched route, route
 * preload plan, resource payloads, collection payloads, and final hydration
 * payload for the client.
 */
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

/**
 * Collection preload details collected while planning a request.
 *
 * Use this when diagnostics or render code needs to distinguish collections
 * touched by route preload from collections explicitly registered for hydration.
 */
export interface StartCollectionPreload {
  readonly routeTouchedCollections: ReadonlyArray<AnyCollection>;
  readonly routeDeclaredCollections: ReadonlyArray<AnyCollection>;
  readonly registeredCollections: ReadonlyArray<AnyCollection>;
  readonly dehydratedCollections: ReadonlyArray<AnyCollection>;
  readonly hydration: CollectionHydrationPayload;
}

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

export type {
  ServerRpcClientOptions,
  StartFetch,
  StartFetchInit,
  StartFetchInput
} from "./start-fetch.js";

export type {
  StartRequestTrace,
  StartRequestTraceAction,
  StartRequestTraceCollection,
  StartRequestTraceCookie,
  StartRequestTraceFiber,
  StartRequestTraceFiberStatus,
  StartRequestTraceFailureKind,
  StartRequestTraceHandler,
  StartRequestTraceHeader,
  StartRequestTraceRequest,
  StartRequestTraceResource,
  StartRequestTraceResponse,
  StartRequestTraceRoutePlan,
  StartRequestTraceServerFunction,
  StartRequestTraceStatus,
  StartRequestTraceStream,
  StartRequestTraceStreamState,
  StartRequestTraceTeardown,
  StartRequestTraceTeardownSnapshot,
  StartRequestTraceTransport
} from "./request-trace.js";

export {
  describeStartActionInvalidationPlan,
  isServerActionRequest,
  isServerRpcRequest,
  startActionForm,
  startActionInputField,
  startActionNameField,
  type ActionDefinitionErrorValue,
  type ActionDefinitionInputValue,
  type ActionDefinitionOutputValue,
  type StartActionClientOptions,
  type StartActionDefinition,
  type StartActionForm,
  type StartActionFormField,
  type StartActionFormOptions,
  type StartActionInvalidationCause,
  type StartActionInvalidationPlan,
  type StartActionInvalidationTarget,
  type StartActionRequest,
  type StartActionResponseBody,
  type StartActionResponseMeta,
  type StartActionResult,
  type StartActionResultFor
} from "./start-transport-protocol.js";

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
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "transport";
          }
          return rpcTransportRequestFailureResponse(error);
        })
      )
    );
    if (validation instanceof Response) {
      return withStartTransportDiagnostics(validation, diagnostics);
    }

    const response = yield* provideRequestRuntime(
      runtime,
      request,
      Effect.gen(function* () {
        const payload = yield* readJsonEffect(request).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              if (traceFacts) {
                traceFacts.failureKind = "protocol";
              }
              return protocolFailureResponse(error);
            })
          )
        );
        if (payload instanceof Response) {
          return payload;
        }

        const decoded = yield* Server.decodeRpcRequest(payload).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              if (traceFacts) {
                traceFacts.failureKind = "protocol";
              }
              return protocolFailureResponse(
                new ServerRpcProtocolError({
                  message: error.message,
                  payload: Server.serializeDefect(error)
                })
              );
            })
          )
        );
        if (decoded instanceof Response) {
          return decoded;
        }

        const fn = Server.get(decoded.name);
        if (!fn) {
          if (traceFacts) {
            traceFacts.failureKind = "protocol";
          }
          traceFacts?.serverFunctions.push({
            name: decoded.name,
            status: "failure",
            failureKind: "protocol"
          });
          return functionNotFoundResponse(decoded.name);
        }

        const exit = yield* Effect.exit(
          withStartRpcObservability(decoded.name, fn.invoke(decoded.input))
        );
        const failureKind = Exit.isSuccess(exit)
          ? undefined
          : yield* rpcFailureKindEffect(fn, exit);
        if (failureKind !== undefined && traceFacts) {
          traceFacts.failureKind = failureKind;
        }
        traceFacts?.serverFunctions.push({
          name: decoded.name,
          status: Exit.isSuccess(exit) ? "success" : "failure",
          ...(failureKind === undefined ? {} : { failureKind })
        });
        return yield* exitToRpcResponse(fn, exit);
      }),
      responseContext
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "defect";
          }
          return rpcRuntimeFailureResponse(error);
        })
      )
    );

    return withStartTransportDiagnostics(response, diagnostics);
  });
};

/**
 * Handles one server-function RPC request and encodes the protocol response.
 *
 * This is the low-level RPC endpoint handler. Most applications use
 * `createRequestHandlerEffect`, which routes RPC, actions, and SSR together.
 */
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
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "transport";
          }
          return actionTransportRequestFailureResponse(error);
        })
      )
    );
    if (validation instanceof Response) {
      return withStartTransportDiagnostics(validation, diagnostics);
    }

    const response = yield* provideRequestRuntime(
      runtime,
      request,
      Effect.gen(function* () {
        const decoded = yield* readStartActionRequestEffect(request).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              if (traceFacts) {
                traceFacts.failureKind = "protocol";
              }
              return actionProtocolFailureResponse(error);
            })
          )
        );
        if (decoded instanceof Response) {
          return decoded;
        }

        const action = makeActionMap(actions).get(decoded.name);
        if (!action) {
          if (traceFacts) {
            traceFacts.failureKind = "protocol";
          }
          traceFacts?.actions.push({
            name: decoded.name,
            state: "Failure",
            failureKind: "protocol"
          });
          return actionFunctionNotFoundResponse(decoded.name);
        }

        const input = yield* decodeWithSchema(action.input, decoded.input).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              if (traceFacts) {
                traceFacts.failureKind = "validation";
              }
              return actionProtocolFailureResponse(
                new ServerRpcProtocolError({
                  message: error.message,
                  payload: Server.serializeDefect(error)
                })
              );
            })
          )
        );
        if (input instanceof Response) {
          traceFacts?.actions.push({
            name: action.name,
            state: "Failure",
            failureKind: "validation"
          });
          return input;
        }

        const instance = Action.use(action, { runtime });
        const exit = yield* Effect.exit(
          withStartActionObservability(action.name, instance.submitEffect(input))
        );
        const meta = yield* actionResponseMetaEffect(instance.invalidationPlan.get());
        const failureKind = yield* actionFailureKindEffect(action, exit);
        if (failureKind !== undefined && traceFacts) {
          traceFacts.failureKind = failureKind;
        }
        traceFacts?.actions.push({
          name: action.name,
          state: failureKind === undefined ? "Success" : "Failure",
          ...(failureKind === undefined ? {} : { failureKind })
        });
        return yield* actionExitResponseEffect(action, exit, meta, actionResponseMode(request));
      }),
      responseContext
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (traceFacts) {
            traceFacts.failureKind = "defect";
          }
          return actionRuntimeFailureResponse(error);
        })
      )
    );

    return withStartTransportDiagnostics(response, diagnostics);
  });
};

/**
 * Handles one Start action request and encodes the protocol response.
 *
 * Accepts JSON action requests and progressively enhanced form posts. The
 * returned Effect runs the action inside a fresh request runtime and includes
 * hydration or invalidation metadata when needed.
 */
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

/**
 * Submits a Start action over the action transport.
 *
 * The returned Effect encodes input, performs `fetch` when run, decodes the
 * result, hydrates any returned resources or collections, and invalidates stale
 * resources. Use this from Effect workflows; run it with a runtime at UI or
 * platform boundaries.
 *
 * @example
 * ```ts
 * const result = yield* submitStartActionEffect(RenameProject, {
 *   id: "atlas",
 *   name: "Atlas"
 * });
 * ```
 */
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
    const fetcher = yield* resolveStartFetchEffect(
      options.fetch,
      "No fetch implementation is available for Start actions."
    );

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
    const response = yield* callStartFetchEffect(
      fetcher,
      options.endpoint ?? serverActionPath,
      {
        method: "POST",
        headers,
        body,
        redirect: "manual"
      },
      (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: "Start action request failed.",
          cause
        })
    );
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

/** Stateful client helpers for Start actions. */
export namespace StartAction {
  /** Typed result emitted by a Start action definition. */
  export type Result<D extends StartActionDefinition> =
    StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>;

  /** Signal state used by a Start action client instance. */
  export type State<D extends StartActionDefinition> =
    ActionState<ActionDefinitionInputValue<D>, Result<D>, Server.ClientError>;

  /** Client-side action instance with state, metadata, and submissions. */
  export interface Instance<D extends StartActionDefinition> {
    readonly definition: D;
    readonly state: ReadableSignal<State<D>>;
    readonly invalidation: ReadableSignal<StartActionInvalidationPlan | undefined>;
    readonly hydration: ReadableSignal<StartHydrationPayload | undefined>;
    /** Submit through the action transport and update instance signals. */
    submitEffect(input: ActionDefinitionInputValue<D>): Effect.Effect<Result<D>, Server.ClientError | ActionInterrupted, unknown>;
    /** Reset state and clear response metadata. */
    resetEffect(): Effect.Effect<void>;
    /** Interrupt an in-flight submission, then reset synchronously. */
    reset(): void;
  }

  /**
   * Creates a stateful Start action client.
   *
   * `submitEffect` honors the core action concurrency policy and updates
   * signals for pending, success, failure, invalidation, and hydration.
   *
   * @example
   * ```ts
   * const rename = StartAction.use(RenameProject);
   * const result = yield* rename.submitEffect({ id: "atlas", name: "Atlas" });
   * ```
   */
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

    return {
      definition,
      state,
      invalidation,
      hydration,
      submitEffect,
      resetEffect,
      reset: () => {
        const submission = currentSubmission;
        if (submission?.fiber) {
          void runtime.runFork(Fiber.interrupt(submission.fiber));
        }
        currentSubmission = undefined;
        runtime.runSync(resetEffect());
      }
    };
  };
}

/**
 * Creates a `ServerClient` that invokes server functions through Start RPC.
 *
 * Calls remain Effects. The HTTP request is performed only when the server
 * function Effect is run.
 */
export const makeRpcClient = (options: ServerRpcClientOptions = {}): ServerClient => ({
  call: (fn, input) =>
    Effect.gen(function* () {
      const fetcher = yield* resolveStartFetchEffect(
        options.fetch,
        "No fetch implementation is available for server functions."
      );

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
      const response = yield* callStartFetchEffect(
        fetcher,
        options.endpoint ?? serverRpcPath,
        {
          method: "POST",
          headers,
          body
        },
        (cause) =>
          new ServerTransportError({
            reason: "Network",
            message: "Server function request failed.",
            cause
          })
      );
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

/** Layer that provides a Start RPC-backed `ServerClient`. */
export const makeRpcClientLayer = (options: ServerRpcClientOptions = {}) =>
  Layer.succeed(ServerClient)(makeRpcClient(options));

/** Default browser RPC layer using `globalThis.fetch` and the Start RPC path. */
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

/**
 * Matches a request URL and preloads route resources and collections.
 *
 * Creates a request-scoped runtime, runs route preload, builds hydration
 * payloads, then disposes the runtime when the Effect completes.
 */
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

/** Alias for `preloadRequestEffect` on the current Effect-first surface. */
export const preloadRequest = <
  const Routes extends readonly Route.Definition<string, unknown, unknown>[],
  Client,
  ServerServices,
  ServerError
>(
  app: AppDefinition<Routes, Client, ServerServices, ServerError>,
  request: Request,
  options: PreloadRequestOptions = {}
): Effect.Effect<StartPreloadResult<Routes>, unknown> =>
  preloadRequestEffect(app, request, options);

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
