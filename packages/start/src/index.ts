import {
  ActionInterrupted,
  currentOrDefaultRuntime,
  Signal,
  Server,
  ServerClient,
  ServerTransportError,
  type ActionState,
  type ReadableSignal
} from "@effect-ui/core";
import { Effect, Fiber, Layer } from "effect";
import type { StartHydrationPayload } from "./hydration.js";

export {
  startRequestCountMetric,
  startRequestDurationMetric,
  startRequestStatusMetric
} from "./request-trace.js";
import {
  serverActionPath,
  serverRpcPath
} from "./rpc.js";
import {
  callStartFetchEffect,
  getStartTransportHeadersEffect as getRpcHeadersEffect,
  resolveStartFetchEffect,
  type ServerRpcClientOptions
} from "./start-fetch.js";
import {
  decodeStartActionResponseEffect,
  encodeWithSchema,
  hydrateActionResponseEffect,
  parseRpcResponse,
  parseStartActionResponse,
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

export {
  createRequestHandler,
  createRequestHandlerEffect,
  createServerActionResponseEffect,
  createServerHandler,
  createServerHandlerEffect,
  createServerRpcResponseEffect,
  preloadRequest,
  preloadRequestEffect
} from "./start-request-handler.js";
export type {
  CreateRequestHandlerOptions,
  StartCollectionPreload,
  StartPreloadResult,
  StartRenderContext,
  StartRequestHandler,
  StartRequestHandlerEffect
} from "./start-request-handler.js";

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
