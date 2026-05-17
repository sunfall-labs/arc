import {
  type AppDefinitionRegistry,
  type EffectUiRuntime,
  type ResponseContext,
} from "@effect-ui/core";
import { Effect, type Scope } from "effect";
import {
  startBaggageHeader,
  startRequestIdHeader,
  startTraceparentHeader,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportEndpointEnvelopeEffect,
  type StartTransportDiagnostics,
  type StartTransportRequestError,
  withStartTransportDiagnostics,
} from "./rpc.js";
import {
  provideRequestRuntime,
  type RequestRuntimeRemainingRequirements,
} from "./request-runtime.js";
import type { StartRequestTraceFacts, StartRequestTraceTransport } from "./request-trace.js";
import { recordStartRequestTraceFailure } from "./request-trace-recorder.js";

interface StartTransportEndpointRunnerAdapter<Requirements> {
  readonly kind: Extract<StartRequestTraceTransport, "rpc" | "action">;
  readonly validateRequest: (request: Request) => Effect.Effect<void, StartTransportRequestError>;
  readonly transportFailureResponse: (error: StartTransportRequestError) => Response;
  readonly run: () => Effect.Effect<Response, unknown, Requirements>;
  readonly runtimeFailureResponse: (error: unknown) => Response;
}

const setResponseContextTransportDiagnosticsEffect = (
  responseContext: ResponseContext,
  diagnostics: StartTransportDiagnostics,
): Effect.Effect<void> =>
  Effect.all(
    [
      responseContext.setHeader(startRequestIdHeader, diagnostics.requestId),
      responseContext.setHeader(startTransportKindHeader, diagnostics.kind),
      responseContext.setHeader(startTransportProtocolHeader, diagnostics.protocolVersion),
      ...(diagnostics.traceparent === undefined
        ? []
        : [responseContext.setHeader(startTraceparentHeader, diagnostics.traceparent)]),
      ...(diagnostics.baggage === undefined
        ? []
        : [responseContext.setHeader(startBaggageHeader, diagnostics.baggage)]),
    ],
    { discard: true },
  ).pipe(Effect.orDie);

export const runStartTransportEndpointEffect = <
  RuntimeServices,
  RuntimeError,
  Requirements,
>(options: {
  readonly request: Request;
  readonly runtime: EffectUiRuntime<RuntimeServices, RuntimeError>;
  readonly responseContext: ResponseContext;
  readonly registry?: AppDefinitionRegistry;
  readonly traceFacts?: StartRequestTraceFacts;
  readonly adapter: StartTransportEndpointRunnerAdapter<Requirements>;
}): Effect.Effect<
  Response,
  never,
  Scope.Scope | RequestRuntimeRemainingRequirements<Requirements, RuntimeServices>
> =>
  Effect.gen(function* () {
    const envelope = yield* startTransportEndpointEnvelopeEffect(
      options.adapter.kind,
      options.request,
      {
        requestId: options.traceFacts?.requestId,
      },
    );
    const diagnostics = envelope.diagnostics;
    const validation = yield* options.adapter.validateRequest(options.request).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.sync(() => {
          recordStartRequestTraceFailure(options.traceFacts, "transport");
          return options.adapter.transportFailureResponse(error);
        }),
      ),
    );
    if (validation instanceof Response) {
      return withStartTransportDiagnostics(validation, diagnostics);
    }

    const response = yield* provideRequestRuntime(
      options.runtime,
      options.request,
      options.adapter.run(),
      options.responseContext,
      options.registry,
    ).pipe(
      Effect.flatMap((response) =>
        setResponseContextTransportDiagnosticsEffect(options.responseContext, diagnostics).pipe(
          Effect.as(response),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          recordStartRequestTraceFailure(options.traceFacts, "defect");
          return options.adapter.runtimeFailureResponse(error);
        }),
      ),
    );

    return withStartTransportDiagnostics(response, diagnostics);
  });
