import type { SunfallArcRuntime, ResponseContext } from "@sunfall/arc-core";
import type { AppDefinitionRegistry } from "@sunfall/arc-core/internal";
import { Cause, Effect, type Scope } from "effect";
import {
  startRequestIdHeader,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportEndpointEnvelope,
  type StartTransportDiagnostics,
  type StartTransportRequestError,
  withStartTransportDiagnostics,
} from "./rpc.js";
import {
  provideRequestRuntime,
  type RequestRuntimeRemainingRequirements,
} from "./request-runtime.js";
import { recordStartRequestFailure, type StartRequestFacts } from "./request-trace.js";
import { logStartDefect } from "./start-defect.js";

interface StartTransportEndpointRunnerAdapter<Requirements> {
  readonly kind: "rpc" | "action";
  readonly validateRequest: (request: Request) => Effect.Effect<void, StartTransportRequestError>;
  readonly transportFailureResponse: (error: StartTransportRequestError) => Response;
  readonly run: () => Effect.Effect<Response, unknown, Requirements>;
  /** The opaque response for a failure of `run`; the runner logs the failure. */
  readonly runtimeFailureResponse: () => Response;
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
    ],
    { discard: true },
  ).pipe(Effect.orDie);

export const runStartTransportEndpoint = <RuntimeServices, RuntimeError, Requirements>(options: {
  readonly request: Request;
  readonly runtime: SunfallArcRuntime<RuntimeServices, RuntimeError>;
  readonly responseContext: ResponseContext;
  readonly registry?: AppDefinitionRegistry;
  readonly facts?: StartRequestFacts;
  readonly adapter: StartTransportEndpointRunnerAdapter<Requirements>;
}): Effect.Effect<
  Response,
  never,
  Scope.Scope | RequestRuntimeRemainingRequirements<Requirements, RuntimeServices>
> =>
  Effect.gen(function* () {
    const envelope = yield* startTransportEndpointEnvelope(options.adapter.kind, options.request, {
      requestId: options.facts?.requestId,
    });
    const diagnostics = envelope.diagnostics;
    const validation = yield* options.adapter.validateRequest(options.request).pipe(
      Effect.as(undefined),
      Effect.catch((error) =>
        Effect.sync(() => {
          recordStartRequestFailure(options.facts, "transport");
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
        logStartDefect(`Start ${options.adapter.kind} endpoint`, Cause.fail(error)).pipe(
          Effect.andThen(
            Effect.sync(() => {
              recordStartRequestFailure(options.facts, "defect");
              return options.adapter.runtimeFailureResponse();
            }),
          ),
        ),
      ),
    );

    return withStartTransportDiagnostics(response, diagnostics);
  });
