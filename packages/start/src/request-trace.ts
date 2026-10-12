import type { Route, SunfallArcRuntime } from "@sunfall/arc-core";
import { Cause, Clock, Duration, Effect, Exit, Metric, Option, type Tracer } from "effect";
import * as Headers from "effect/http/Headers";
import * as HttpTraceContext from "effect/http/HttpTraceContext";
import {
  makeStartRequestId,
  serverActionPath,
  serverRpcPath,
  startRequestIdHeader,
} from "./rpc.js";

/** Start transport that handled a request. */
export type StartRequestTransport = "ssr" | "rpc" | "action";

/** Final request outcome. */
export type StartRequestStatus = "success" | "failure" | "cancelled";

/** Failure category recorded on the request span without exposing raw causes. */
export type StartRequestFailureKind =
  | "domain"
  | "validation"
  | "protocol"
  | "transport"
  | "defect"
  | "interruption";

/** Response body stream lifecycle recorded when a streamed response finalizes. */
export interface StartRequestStream {
  readonly name: string;
  readonly state: "closed" | "cancelled" | "errored";
  readonly chunkCount?: number;
  readonly failurePhase?: "Shell" | "Chunk" | "Tail";
}

/** Request runtime teardown recorded on the request span. */
export interface StartRequestTeardown {
  readonly runtimeDisposed: boolean;
  /** Live fibers left in the request runtime's Resource Store after disposal. */
  readonly fibersAfterDispose: number;
  readonly completedAt: number;
  readonly cleanupFailure?: string;
}

/**
 * Request-local facts. Observability lives on the `sunfall-arc.start.request`
 * span: route plan, failure kind, response, stream, and teardown are span
 * attributes, so any Effect `Tracer` (OpenTelemetry, Devtools) sees them.
 */
export interface StartRequestFacts {
  readonly requestId: string;
  readonly transport: StartRequestTransport;
  readonly startedAt: number;
  readonly span: Tracer.Span;
  routePath?: string;
  failureKind?: StartRequestFailureKind;
}

/** Effect Metric counter for total Start requests by transport, method, and path. */
export const startRequestCountMetric = Metric.counter("sunfall_arc_start_requests_total", {
  description: "Total Start requests handled by transport, method, and path.",
  incremental: true,
});

/** Effect Metric timer for Start request duration by transport, method, and path. */
export const startRequestDurationMetric = Metric.timer("sunfall_arc_start_request_duration", {
  description: "Start request handler duration by transport, method, and path.",
});

/** Effect Metric frequency for Start request outcomes by transport, method, path, and status. */
export const startRequestStatusMetric = Metric.frequency("sunfall_arc_start_request_status", {
  description: "Start request outcomes by transport, method, path, and status.",
});

const requestTransport = (pathname: string): StartRequestTransport =>
  pathname === serverRpcPath ? "rpc" : pathname === serverActionPath ? "action" : "ssr";

const incomingTraceParent = (request: Request): Tracer.ExternalSpan | undefined => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return Option.getOrUndefined(HttpTraceContext.fromHeaders(Headers.fromInput(headers)));
};

/** Opens the request span (parented on an incoming W3C/B3 trace) and request facts. */
export const startRequestFacts = (request: Request): Effect.Effect<StartRequestFacts> =>
  Effect.gen(function* () {
    const incomingRequestId = request.headers.get(startRequestIdHeader)?.trim();
    const requestId =
      incomingRequestId && !/[\r\n]/.test(incomingRequestId)
        ? incomingRequestId
        : yield* Effect.sync(makeStartRequestId);
    const path = new URL(request.url).pathname;
    const transport = requestTransport(path);
    const span = yield* Effect.makeSpan("sunfall-arc.start.request", {
      kind: "server",
      parent: incomingTraceParent(request),
      attributes: {
        "sunfall-arc.request.id": requestId,
        "sunfall-arc.request.transport": transport,
        "http.request.method": request.method,
        "url.path": path,
      },
    });
    return { requestId, transport, startedAt: yield* Clock.currentTimeMillis, span };
  });

/** Records a request failure category on the facts and the request span. */
export const recordStartRequestFailure = (
  facts: StartRequestFacts | undefined,
  failureKind: StartRequestFailureKind,
): void => {
  if (facts) {
    facts.failureKind = failureKind;
    facts.span.attribute("sunfall-arc.failure.kind", failureKind);
  }
};

/** Records the SSR route plan (matched route, preloaded and hydrated Resources). */
export const recordStartRequestRoutePlan = (
  facts: StartRequestFacts,
  plan: Route.NavigationPlan,
): void => {
  if (plan.match) {
    facts.routePath = plan.match.route.path;
    facts.span.attribute("http.route", plan.match.route.path);
  }
  facts.span.attribute("sunfall-arc.route.href", plan.href);
  facts.span.attribute(
    "sunfall-arc.route.resources",
    plan.refs.map((ref) => ref.key),
  );
  facts.span.attribute(
    "sunfall-arc.hydration.resources",
    plan.resources.resources.map((resource) => resource.key),
  );
};

/** Runs request work under the request span with request log annotations. */
export const withStartRequestObservability = <A, E, R>(
  request: Request,
  facts: StartRequestFacts,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.annotateLogs({
      "sunfall-arc.request.id": facts.requestId,
      "sunfall-arc.request.transport": facts.transport,
      "http.request.method": request.method,
      "url.path": new URL(request.url).pathname,
    }),
    Effect.withParentSpan(facts.span),
  );

const childSpan =
  (kind: "rpc" | "action") =>
  <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.annotateLogs(`sunfall-arc.${kind}.name`, name),
      Effect.withSpan(`sunfall-arc.start.${kind}`, {
        kind: "server",
        attributes: { [`sunfall-arc.${kind}.name`]: name },
      }),
    );

export const withStartRpcObservability = childSpan("rpc");
export const withStartActionObservability = childSpan("action");

const cleanupFailureMessage = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);
  const nested = (error as { readonly cause?: unknown } | null)?.cause;
  return Cause.isCause(nested)
    ? cleanupFailureMessage(nested)
    : error instanceof Error
      ? error.message
      : String(error);
};

/** Disposes the request runtime and reports what was left behind. */
export const disposeRequestRuntime = <RuntimeServices, RuntimeError>(
  runtime: SunfallArcRuntime<RuntimeServices, RuntimeError>,
): Effect.Effect<StartRequestTeardown> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(runtime.dispose);
    const after = yield* runtime.resourceStore.diagnostics.snapshot;
    return {
      runtimeDisposed: Exit.isSuccess(exit),
      fibersAfterDispose: after.fiberCount,
      completedAt: yield* Clock.currentTimeMillis,
      ...(Exit.isSuccess(exit) ? {} : { cleanupFailure: cleanupFailureMessage(exit.cause) }),
    };
  });

/**
 * Ends the request span (after any streamed body finishes) and updates the
 * request metrics.
 */
export const finishStartRequest = (
  request: Request,
  facts: StartRequestFacts,
  options: {
    readonly status: StartRequestStatus;
    readonly teardownReason: string;
    readonly teardown: StartRequestTeardown;
    readonly response?: Response;
    readonly stream?: StartRequestStream;
    readonly cause?: Cause.Cause<unknown>;
  },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const status =
      facts.failureKind === undefined || options.status === "cancelled"
        ? options.status
        : "failure";
    const { span } = facts;
    const { teardown, stream } = options;
    span.attribute("sunfall-arc.request.status", status);
    if (options.response) {
      span.attribute("http.response.status_code", options.response.status);
    }
    if (stream) {
      span.attribute("sunfall-arc.stream.state", stream.state);
      span.attribute("sunfall-arc.stream.chunks", stream.chunkCount ?? 0);
      if (stream.failurePhase) {
        span.attribute("sunfall-arc.stream.failure_phase", stream.failurePhase);
      }
    }
    span.attribute("sunfall-arc.teardown.reason", options.teardownReason);
    span.attribute("sunfall-arc.teardown.runtime_disposed", teardown.runtimeDisposed);
    span.attribute("sunfall-arc.teardown.fibers", teardown.fibersAfterDispose);
    if (teardown.cleanupFailure !== undefined) {
      span.attribute("sunfall-arc.teardown.cleanup_failure", teardown.cleanupFailure);
    }
    span.end(
      yield* Clock.currentTimeNanos,
      options.cause !== undefined
        ? Exit.failCause(options.cause)
        : status === "success"
          ? Exit.void
          : Exit.fail(facts.failureKind ?? status),
    );

    const attributes = {
      transport: facts.transport,
      method: request.method,
      path:
        facts.transport === "ssr"
          ? (facts.routePath ?? "<unmatched>")
          : new URL(request.url).pathname,
    };
    yield* Metric.update(Metric.withAttributes(startRequestCountMetric, attributes), 1);
    yield* Metric.update(
      Metric.withAttributes(startRequestDurationMetric, attributes),
      Duration.millis(Math.max(0, teardown.completedAt - facts.startedAt)),
    );
    yield* Metric.update(
      Metric.withAttributes(startRequestStatusMetric, { ...attributes, status }),
      status,
    );
  });
